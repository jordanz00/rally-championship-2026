/**
 * Nanite-like screen-space LOD — hero near + impostor far.
 *
 * WHO THIS IS FOR: Track.update streaming (hi/lo mesh pairs).
 * WHAT IT DOES: Picks the hi (authored GLB) vs lo (pack card) band from
 *   distance × approximate screen size × facing, not metres alone. Clusters
 *   dead-ahead stay detailed past lodNear; peripheral/behind swap to cards
 *   sooner. Does not add geometry or explode poly count.
 * HOW IT CONNECTS: track.js stream tick; STREAM.lodNear / lodHysteresis remain
 *   the base radii. WebGPU compute cull is not required — this runs on WebGL.
 *
 * POWER BI MAPPING: none
 */

/** Approx focal length in pixels at 16:9 ~1280 — relative, not a true projection. */
const DEFAULT_FOCAL_PX = 640;
const HERO_FACING = 0.52;
const HERO_SCREEN_PX = 42;
const HERO_EXTEND = 0.32;
const SIDE_FACING = 0.28;
const SIDE_CUT = 0.18;
const MIN_NEAR = 48;

/**
 * Choose LOD band with hysteresis.
 *
 * @param {number} prevBand 0 unknown, 1 hi (authored), 2 lo (impostor)
 * @param {number} dNear metres from nearest stream anchor to sphere surface
 * @param {number} radius bounding-sphere radius (metres)
 * @param {{
 *   lodNear: number,
 *   hysteresis?: number,
 *   facing?: number,
 *   focalPx?: number,
 * }} opts facing 0..1 (1 = dead ahead of travel yaw)
 * @returns {1|2}
 */
export function selectLodBand(prevBand, dNear, radius, opts) {
  const lodNear = opts && opts.lodNear != null ? opts.lodNear : 148;
  const hyst = opts && opts.hysteresis != null ? opts.hysteresis : 28;
  const facing = opts && opts.facing != null ? opts.facing : 0.5;
  const r = Math.max(0.5, radius || 1);
  const dist = Math.max(1, dNear + r);
  const focal = opts && opts.focalPx != null ? opts.focalPx : DEFAULT_FOCAL_PX;
  const screenPx = (r * focal) / dist;

  const hero =
    facing > HERO_FACING && screenPx > HERO_SCREEN_PX
      ? lodNear * HERO_EXTEND * facing
      : 0;
  const side =
    facing < SIDE_FACING
      ? (lodNear * SIDE_CUT * (SIDE_FACING - facing)) / SIDE_FACING
      : 0;
  const near = Math.max(MIN_NEAR, lodNear + hero - side);

  let band = prevBand | 0;
  if (dNear < near) band = 1;
  else if (dNear > near + hyst) band = 2;
  else if (!band) band = dNear < near + hyst * 0.5 ? 1 : 2;
  return band === 2 ? 2 : 1;
}
