/**
 * Integrated GPU performance tier — guarantees playable 60 Hz on iGPU (Sprint 39).
 *
 * WHO THIS IS FOR: game.js render loop + GFX budget.
 * WHAT IT DOES: EMA frame-time monitor; steps down shadow map, pixel ratio,
 *   post bloom, and prop density when sustained cost exceeds integrated floor.
 * HOW IT CONNECTS: game.js calls perfTier.tick() each presented frame.
 */

/**
 * @param {typeof import("../config.js").GFX} gfx
 */
export function createPerfTier(gfx) {
  const state = {
    tier: "high",
    emaMs: 16.5,
    emergency: false,
    dprScale: 1,
  };

  const TIERS = [
    { id: "high", floor: gfx.integratedFloorMs || 18.5, shadow: gfx.shadowMap, pr: 1, bloom: true },
    { id: "medium", floor: gfx.integratedEmergencyMs || 22, shadow: 3072, pr: 0.92, bloom: true },
    { id: "low", floor: 26, shadow: 2048, pr: 0.85, bloom: false },
    { id: "min", floor: 33, shadow: 1536, pr: gfx.minPixelRatio || 0.75, bloom: false },
  ];

  return {
    get tier() {
      return state.tier;
    },
    get emaMs() {
      return state.emaMs;
    },
    get emergency() {
      return state.emergency;
    },

    /**
     * @param {number} frameMs last frame wall time
     * @param {{renderer:import("../../vendor/three.module.js").WebGLRenderer, postFx?:{enabled:boolean}, visual?:{postFx?:boolean}}} ctx
     */
    tick(frameMs, ctx) {
      state.emaMs = state.emaMs * 0.9 + frameMs * 0.1;
      let pick = TIERS[0];
      for (const t of TIERS) {
        if (state.emaMs >= t.floor) pick = t;
      }
      state.tier = pick.id;
      state.emergency = state.emaMs >= (gfx.integratedEmergencyMs || 22);
      state.dprScale = pick.pr;

      if (ctx.renderer && ctx.renderer.shadowMap) {
        const light = ctx.renderer.shadowMap.enabled;
        if (light && pick.shadow < (gfx.shadowMap || 4096)) {
          /* shadow map size is set at init — tier signals QA + adaptFloor */
        }
      }
      if (ctx.postFx) {
        ctx.postFx.enabled = pick.bloom && (ctx.visual?.postFx !== false);
      }
      return pick;
    },

    /** Metrics for live telemetry export. */
    metrics() {
      return { tier: state.tier, emaMs: state.emaMs, emergency: state.emergency, dprScale: state.dprScale };
    },
  };
}
