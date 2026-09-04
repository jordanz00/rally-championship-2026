/**
 * World-generation config — named tolerances (no magic numbers in unrelated files).
 *
 * WHO THIS IS FOR: TrackConform, Clearance, TunnelVolume, WorldGeometryValidator.
 * WHAT IT DOES: Central Track / Terrain / Environment / Performance knobs for generation QA.
 * HOW IT CONNECTS: docs/QUALITY_STANDARD.md · docs/WORLD_GEOMETRY_RULES.md
 *
 * POWER BI MAPPING: none
 */

/** @type {Readonly<{
 *   minWidth: number,
 *   maxWidth: number,
 *   minStraightLength: number,
 *   minCurveRadius: number,
 *   maxAbsAngleDeg: number,
 *   minStageLength: number,
 *   maxGradePerMetre: number,
 * }>} */
export const TrackConfig = Object.freeze({
  minWidth: 6,
  maxWidth: 28,
  minStraightLength: 4,
  minCurveRadius: 8,
  maxAbsAngleDeg: 200,
  minStageLength: 400,
  /** Soft cap for authored dy / length — steeper fails compile warn/error. */
  maxGradePerMetre: 0.22,
});

/**
 * Terrain conformity — road vs ground.
 * WHY: floatTol matches “visible float” playtest; buryTol is tighter (clipping hurts more).
 */
export const TerrainConfig = Object.freeze({
  /** Road Y − ground Y above this (m) ⇒ FLOATING_ROAD (non-jump, non-tunnel). */
  floatTol: 2.8,
  /** Ground Y − road Y above this (m) ⇒ BURIED_ROAD. */
  buryTol: 1.6,
  sampleStep: 8,
});

/** Environment exclusion — see track-clearance.js for per-scenery pads. */
export const EnvironmentConfig = Object.freeze({
  roadShoulder: 3.2,
  /** Intentional hero props may set allowInClearance — default reject. */
  allowIntentionalClearanceTags: true,
});

/** Tunnel bore defaults — tunnel-volume.js. */
export const TunnelConfig = Object.freeze({
  height: 6.2,
  margin: 4.5,
  minLength: 12,
});

/** Soft budgets until headed baselines exist — document, then tighten. */
export const PerformanceConfig = Object.freeze({
  targetFps: 60,
  frameBudgetMs: 16.67,
  /** Placeholder until StagePerformanceProfile measured. */
  warnDrawCalls: 2500,
  warnTriangles: 2_500_000,
});

export const RenderingConfig = Object.freeze({
  qualityPresets: ["low", "medium", "high", "ultra"],
  defaultPreset: "high",
});
