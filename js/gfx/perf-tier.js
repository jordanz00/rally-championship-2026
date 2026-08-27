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
  /** Sun shadow atlas ceiling (PCFSoft, re-rendered every frame). */
  maxShadowMap: 4096,
  /** Volumetric cloud raymarch ceiling — matches sky.js CLOUD_BUDGET. */
  maxCloudViewSteps: 16,
  maxCloudLightSteps: 2,
  /** Rearview render target — readable cabin glass, ~1/4 framebuffer width. */
  maxMirrorW: 384,
  maxMirrorH: 120,
};

/** Presented frames a verdict must hold before the tier moves. */
const DOWN_HOLD = 24;
const UP_HOLD = 150;
/**
 * Presented frames of settled, over-deadline cost before the scaler gives up one
 * more quality tier in pursuit of 60 Hz.
 */
const PUSH_HOLD = 90;
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
 * WHY SO MUCH LONGER THAN PUSH_HOLD: halving the frame rate is the most drastic
 * thing the scaler can do and it does not reverse until the next stage, so a
 * dense village section or a background app must not spend it. Ten seconds of
 * evidence at the cheapest tier is the bar.
 */
const LOCK30_HOLD = 600;
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
  const minDpr = Math.max(0.6, Math.min(1, gfx.minPixelRatio || 0.75));
  const lowShadow = Math.min(capShadow, gfx.integratedShadowMap || 2048);
  // `shadowEvery` is the sun atlas re-render interval in presented frames. The
  // shadow pass is a second full geometry pass over the visible world, so at 1
  // it is one of the largest single line items in the frame. Sunlight barely
  // moves, so re-baking it every other frame is imperceptible on a soft PCF
  // shadow while returning a large share of the budget.
  return [
    {
      id: "high",
      floorMs: 0,
      dpr: 1,
      shadow: capShadow,
      post: "high",
      sky: "high",
      mirrorEvery: 1,
      shadowEvery: 1,
    },
    {
      id: "medium",
      floorMs: gfx.integratedFloorMs ?? 18.5,
      dpr: Math.max(minDpr, 0.92),
      shadow: Math.min(capShadow, 3072),
      post: "balanced",
      sky: "medium",
      mirrorEvery: 2,
      shadowEvery: 1,
    },
    {
      id: "low",
      floorMs: gfx.adaptHighMs ?? 22,
      dpr: Math.max(minDpr, 0.85),
      shadow: lowShadow,
      post: "low",
      sky: "low",
      mirrorEvery: 3,
      shadowEvery: 2,
    },
    {
      id: "min",
      floorMs: 27,
      dpr: minDpr,
      shadow: Math.min(lowShadow, 1536),
      post: "low",
      sky: "min",
      mirrorEvery: 4,
      shadowEvery: 2,
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
  if (opts.startTier) {
    const want = ladder.findIndex((t) => t.id === opts.startTier);
    if (want >= 0) {
      index = want;
      emaMs = Math.max(emaMs, (ladder[index].floorMs || 0) + 0.4);
    }
  }
  let downFor = 0;
  let upFor = 0;
  let hardFor = 0;
  /** 0 while targeting GFX.targetFps; 30 once the stage has given up on 60. */
  let lockedHz = 0;
  let lock30For = 0;
  const targetHz = gfx.targetFps || 60;
  /**
   * The interval we must beat to call 60 Hz held. 6% of slack keeps EMA noise
   * and a single late vsync from arming the cadence lock.
   */
  const deadlineMs = Math.min(gfx.lock30AboveMs ?? 20, (1000 / targetHz) * 1.06);

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

      // Spend quality first, then cadence.
      //
      // The ladder only classifies cost into a tier — it does not chase a
      // deadline, so a machine sitting at a steady 24 ms would settle on `low`
      // and deliver a permanently juddering 41 fps. That was the shipped
      // behaviour. Instead: once the ladder has reached equilibrium and we are
      // still over the 60 Hz deadline, step down one more tier; when there is
      // nothing left to give, halve the cadence and hold it.
      const settled = !changed && downFor === 0 && upFor === 0;
      if (settled && emaMs > deadlineMs) {
        lock30For += 1;
        const atFloor = index >= ladder.length - 1;
        if (!atFloor && lock30For >= PUSH_HOLD) {
          lock30For = 0;
          index += 1;
          changed = true;
        } else if (atFloor && lock30For >= LOCK30_HOLD) {
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
