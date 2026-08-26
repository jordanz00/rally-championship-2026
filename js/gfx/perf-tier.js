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
  return [
    { id: "high", floorMs: 0, dpr: 1, shadow: capShadow, post: "high", sky: "high", mirrorEvery: 1 },
    {
      id: "medium",
      floorMs: gfx.integratedFloorMs ?? 18.5,
      dpr: Math.max(minDpr, 0.92),
      shadow: Math.min(capShadow, 3072),
      post: "balanced",
      sky: "medium",
      mirrorEvery: 2,
    },
    {
      id: "low",
      floorMs: gfx.adaptHighMs ?? 22,
      dpr: Math.max(minDpr, 0.85),
      shadow: lowShadow,
      post: "low",
      sky: "low",
      mirrorEvery: 3,
    },
    {
      id: "min",
      floorMs: 27,
      dpr: minDpr,
      shadow: Math.min(lowShadow, 1536),
      post: "low",
      sky: "min",
      mirrorEvery: 4,
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
      return emaMs >= emergencyMs;
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
      hardFor = raw >= hardFloorMs ? hardFor + 1 : 0;

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

      const want = wantIndex(emaMs);
      if (want > index) {
        upFor = 0;
        downFor += 1;
        if (downFor >= DOWN_HOLD) {
          index = want;
          downFor = 0;
          changed = true;
        }
      } else if (want < index && emaMs < ladder[index].floorMs * UP_MARGIN) {
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
      };
    },
  };
}
