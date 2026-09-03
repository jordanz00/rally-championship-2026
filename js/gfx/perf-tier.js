/**
 * Quality scaler — the one system that decides how much GPU this frame may cost.
 *
 * WHO THIS IS FOR: the game.js present path.
 * WHAT IT DOES: watches the interval between presented frames (EMA), picks one of four tiers,
 *   and hands back every knob that tier implies — pixel ratio, shadow atlas,
 *   post stack, sky raymarch, mirror capture cadence. Nothing else in the
 *   renderer is allowed to invent its own adaptive rule.
 * HOW IT CONNECTS: game.js calls tick() once per presented frame and applies
 *   the returned tier only when `changed` is true, so a reallocation (DPR,
 *   shadow atlas) happens on a tier transition and never per frame.
 *
 * WHY ONE SYSTEM: before Sprint 76 there were two — an inline post-quality
 * ladder in the loop and a tier object whose dprScale/shadow decisions were
 * computed and then thrown away. Low-end machines therefore ran slow instead
 * of degrading. Tiers now carry the caps and game.js is the only applier.
 *
 * POWER BI MAPPING: none
 */

/**
 * Hard ceilings. These are not tunables the tiers may exceed — they are the
 * device-agnostic contract QA asserts against (tools/qa-sprint76-perf.mjs).
 */
export const QUALITY_CAPS = {
  /** Never allocate more than this pixel ratio, whatever the display reports. */
  maxPixelRatio: 1.5,
  /**
   * Sun shadow atlas ceiling (PCFSoft). Race default is lower (GFX.shadowMap);
   * this is the hard QA contract — never allocate above it.
   */
  maxShadowMap: 4096,
  /** Volumetric cloud raymarch removed (Sprint 549 skybox). Caps stay 0. */
  maxCloudViewSteps: 0,
  maxCloudLightSteps: 0,
  /** Rearview render target — readable cabin glass, ~1/4 framebuffer width. */
  maxMirrorW: 384,
  maxMirrorH: 120,
};

/** Presented frames a verdict must hold before the tier moves. */
const DOWN_HOLD = 16;
const UP_HOLD = 150;
/**
 * Presented frames of settled, over-deadline cost before the scaler gives up one
 * more quality tier in pursuit of 60 Hz.
 */
const PUSH_HOLD = 48;
/**
 * Presented frames of settled, over-deadline cost *at the cheapest tier* before
 * the present cadence drops from 60 Hz to a deliberate 30 Hz.
 *
 * WHY A LOCK AT ALL: a machine that renders a frame in ~18 ms cannot hit the
 * 16.7 ms vsync deadline, so it waits for the next one — 33.3 ms. Mixed with
 * frames that do make it, the player sees an uneven 46 fps with visible judder.
 * Presenting every second vsync costs frame rate but delivers an even cadence,
 * which reads as far smoother. Measured on an M1 Pro: p50 16.8 ms with p95
 * 34.0 ms and 65% of frames over budget — the worst case for feel.
 *
 * WHY NOT TEN SECONDS: Sprint 536 probe showed ~50 fps judder at `min` for the
 * whole sample. ~0.8 s of evidence (48 presents at 60 Hz) is enough to prefer
 * a clean 30 — especially once race DPR is raised (Sprint 547).
 */
/** ~0.8 s at 60 Hz — lock before ~50 fps judder settles in as “the race feel”. */
const LOCK30_HOLD = 48;
/**
 * Ceiling on a single sample folded into the EMA. A shader compile or a GC
 * pause can present one 1000 ms frame; letting that raw number into the EMA
 * would trip the 30 fps floor and strip the stage of shadows and pixels for a
 * blip the player already stopped noticing. A stall counts as one bad frame.
 */
const SAMPLE_CLAMP_MS = 50;
/** Consecutive over-floor samples before the emergency drop to `min` fires. */
const HARD_HOLD = 8;
/** Step up only when cost is comfortably under the tier we would return to. */
const UP_MARGIN = 0.82;

/**
 * Build the ladder from GFX. `floorMs` is the *interval between presented
 * frames* at which a tier takes over — the only signal that sees GPU cost.
 *
 * Calibration: render is capped at 60, so a healthy machine sits at 16.7 ms.
 * The floors therefore start above that, not below it:
 *   18.5 ms ≈ 54 fps, 22 ms ≈ 45 fps, 27 ms ≈ 37 fps, 33.3 ms = the 30 fps floor.
 *
 * Thresholds live in config.js (GFX.adapt* / GFX.integrated*) so there is one
 * tuning surface; this file owns the policy that reads them.
 *
 * @param {typeof import("../config.js").GFX} gfx
 */
function buildLadder(gfx) {
  const capShadow = Math.min(QUALITY_CAPS.maxShadowMap, gfx.shadowMap || QUALITY_CAPS.maxShadowMap);
  const minDpr = Math.max(0.5, Math.min(1, gfx.minPixelRatio || 0.55));
  const lowShadow = Math.min(capShadow, gfx.integratedShadowMap || 1024);
  // `shadowEvery` is the sun atlas re-render interval in presented frames. The
  // shadow pass is a second full geometry pass over the visible world. Soft
  // PCF hides a skipped bake. Sprint 536: high/medium bake every 3rd present;
  // min disables the atlas in game.js when shadow ≤ 512.
  return [
    {
      id: "high",
      floorMs: 0,
      dpr: 1,
      shadow: capShadow,
      post: "high",
      sky: "high",
      mirrorEvery: 2,
      shadowEvery: 3,
    },
    {
      id: "medium",
      floorMs: gfx.integratedFloorMs ?? 17.5,
      dpr: Math.max(minDpr, 0.9),
      shadow: Math.min(capShadow, 1280),
      post: "balanced",
      sky: "medium",
      mirrorEvery: 4,
      shadowEvery: 4,
    },
    {
      id: "low",
      floorMs: gfx.adaptHighMs ?? 20,
      dpr: Math.max(minDpr, 0.72),
      shadow: Math.min(lowShadow, 768),
      post: "low",
      sky: "low",
      mirrorEvery: 4,
      shadowEvery: 4,
    },
    {
      id: "min",
      floorMs: 26,
      dpr: minDpr,
      shadow: 512,
      post: "low",
      sky: "min",
      mirrorEvery: 6,
      shadowEvery: 8,
    },
  ];
}

/**
 * @param {typeof import("../config.js").GFX} gfx
 * @param {{startTier?: "high"|"medium"|"low"|"min"}} [opts]
 */
export function createPerfTier(gfx, opts = {}) {
  const ladder = buildLadder(gfx);
  /** Present cost above this is a 30 fps emergency — drop to min without waiting. */
  const hardFloorMs = gfx.adaptFloorMs ?? 33.3;
  const emergencyMs = gfx.integratedEmergencyMs ?? 22;

  let index = 0;
  let emaMs = 16.5;
  let downFor = 0;
  let upFor = 0;
  let hardFor = 0;
  /** 0 while targeting GFX.targetFps; 30 once the stage has given up on 60. */
  let lockedHz = 0;
  let lock30For = 0;
  const targetHz = gfx.targetFps || 60;
  /**
   * Interval we must beat to call 60 Hz held — drives quality PUSH only.
   * 6% slack keeps EMA noise from dumping a tier.
   */
  const deadlineMs = (1000 / targetHz) * 1.06;
  /**
   * Cadence lock bar — deliberately above deadlineMs so a machine that holds
   * ~54 fps (18 ms) keeps free-running at 60 target instead of sticky 30.
   * Sprint 536: Math.min(lock30AboveMs, deadline) made 21 collapse to 17.7.
   */
  const lock30Ms = Math.max(deadlineMs + 2, gfx.lock30AboveMs ?? 21);
  if (opts.startTier) {
    const want = ladder.findIndex((t) => t.id === opts.startTier);
    if (want >= 0) {
      index = want;
      emaMs = 16.5;
    }
  }

  /** @param {number} ms */
  function wantIndex(ms) {
    let want = 0;
    for (let i = 0; i < ladder.length; i++) {
      if (ms >= ladder[i].floorMs) want = i;
    }
    return want;
  }

  return {
    get tier() {
      return ladder[index].id;
    },
    get emaMs() {
      return emaMs;
    },
    get caps() {
      return QUALITY_CAPS;
    },
    /** True while the scaler has given up post bloom to hold the floor. */
    get emergency() {
      // Once locked to 30 the interval is 33.3 ms *by design*, so the 22 ms
      // threshold would read as a permanent emergency. Judge against the
      // cadence we actually committed to.
      if (lockedHz) return emaMs >= (1000 / lockedHz) * 1.12;
      return emaMs >= emergencyMs;
    },

    /**
     * Presentation cadence in Hz — 60 normally, 30 once this stage has proven it
     * cannot hold 60 at the cheapest tier. Downward-only within a stage, for the
     * same reason the DPR and shadow floors are: a cadence that flips back and
     * forth is worse than either steady rate. A new stage re-grades from 60.
     * @returns {number}
     */
    get presentHz() {
      return lockedHz || targetHz;
    },

    /** True when this stage deliberately gave up 60 fps for an even 30. */
    get locked30() {
      return lockedHz === 30;
    },

    /**
     * Fold one presented frame into the ladder.
     *
     * Down-shifts need DOWN_HOLD frames of evidence so a single shader compile
     * or GC pause cannot dump quality; up-shifts need UP_HOLD plus a margin so
     * the scaler cannot oscillate between two tiers (which would reallocate
     * the framebuffer repeatedly — a worse artefact than a soft frame).
     *
     * @param {number} frameMs milliseconds since the previous presented frame
     * @returns {{id:string, dpr:number, shadow:number, post:string, sky:string, mirrorEvery:number, changed:boolean}}
     */
    tick(frameMs) {
      const raw = Number.isFinite(frameMs) && frameMs > 0 ? frameMs : emaMs;
      emaMs = emaMs * 0.9 + Math.min(raw, SAMPLE_CLAMP_MS) * 0.1;
      // Scale the emergency floor to the cadence we committed to. Once locked at
      // 30 Hz a 33 ms interval *is* the target, not a sub-30 emergency.
      const cadenceScale = lockedHz ? targetHz / lockedHz : 1;
      hardFor = raw >= hardFloorMs * cadenceScale ? hardFor + 1 : 0;

      let changed = false;
      // Sustained sub-30 fps is not worth deliberating over: take the cheapest
      // tier now. HARD_HOLD frames of it, though — one compile stall is not a
      // reason to spend the rest of the stage at min.
      if (hardFor >= HARD_HOLD && index < ladder.length - 1) {
        index = ladder.length - 1;
        downFor = 0;
        upFor = 0;
        hardFor = 0;
        return { ...ladder[index], changed: true };
      }
      // Already at min and still missing even a 30 fps free-run — lock cadence
      // immediately so the player never lives in the 24–60 judder band.
      if (
        !lockedHz &&
        hardFor >= HARD_HOLD &&
        index >= ladder.length - 1 &&
        emaMs > lock30Ms
      ) {
        lockedHz = 30;
        hardFor = 0;
      }

      // While locked at 30 Hz the present interval is 33.3 ms by construction,
      // so it no longer says anything about what a frame costs. Grading quality
      // from it would drive every locked machine to `min` for no reason, so the
      // tier freezes at whatever the machine nearly held at 60.
      if (lockedHz) return { ...ladder[index], changed };

      const want = wantIndex(emaMs);
      if (want > index) {
        upFor = 0;
        downFor += 1;
        if (downFor >= DOWN_HOLD) {
          index = want;
          downFor = 0;
          changed = true;
        }
      } else if (
        want < index &&
        emaMs < ladder[index].floorMs * UP_MARGIN &&
        // Never buy quality back while we are still missing the frame deadline.
        // Without this the scaler climbed out of a tier it had deliberately
        // been pushed into, then got pushed back down — a visible oscillation.
        emaMs <= deadlineMs
      ) {
        downFor = 0;
        upFor += 1;
        if (upFor >= UP_HOLD) {
          index -= 1;
          upFor = 0;
          changed = true;
        }
      } else {
        downFor = 0;
        upFor = 0;
      }

      // Cadence lock. preferLock30 counts over-deadline frames even while the
      // ladder is still walking down — otherwise DOWN_HOLD resets lock30For
      // every step and we only lock after already sitting at min.
      const settled = !changed && downFor === 0 && upFor === 0;
      if (emaMs > deadlineMs) {
        lock30For += 1;
        const atFloor = index >= ladder.length - 1;
        const preferLock = !!gfx.preferLock30;
        if (preferLock && lock30For >= PUSH_HOLD) {
          lock30For = 0;
          lockedHz = 30;
        } else if (settled && !atFloor && lock30For >= PUSH_HOLD) {
          lock30For = 0;
          index += 1;
          changed = true;
        } else if (settled && atFloor && emaMs > lock30Ms && lock30For >= LOCK30_HOLD) {
          lock30For = 0;
          lockedHz = 30;
        }
      } else {
        lock30For = 0;
      }
      return { ...ladder[index], changed };
    },

    /** Current tier knobs without folding a new sample in. */
    current() {
      return { ...ladder[index], changed: false };
    },

    /**
     * After GPU settle / countdown, forget compile-cost EMA so the stage does
     * not inherit a sticky emergency from shader warm frames. When preferLock30
     * is on, keep a deliberate 30 Hz lock — clearing it after GO re-opened the
     * ~50 fps judder band (Sprint 547).
     */
    resetCadence() {
      emaMs = 16.5;
      downFor = 0;
      upFor = 0;
      hardFor = 0;
      lock30For = 0;
      if (!gfx.preferLock30) lockedHz = 0;
    },

    /**
     * Arm an even 30 Hz present cadence at the current quality tier (used when
     * the race pixel budget prefers clean 30 over chasing 60 down to min).
     */
    forceLock30() {
      lockedHz = 30;
      lock30For = 0;
    },

    /** Metrics for live telemetry export. */
    metrics() {
      return {
        tier: ladder[index].id,
        emaMs,
        emergency: emaMs >= emergencyMs,
        dprScale: ladder[index].dpr,
        shadowMap: ladder[index].shadow,
        presentHz: lockedHz || targetHz,
        locked30: lockedHz === 30,
      };
    },
  };
}
