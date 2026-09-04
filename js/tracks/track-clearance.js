/**
 * TrackClearanceSystem — road corridor exclusion for environment placement.
 *
 * WHO THIS IS FOR: scenery planting, WorldGeometryValidator, stage authors.
 * WHAT IT DOES: Computes road / shoulder / safety / scenery exclusion half-widths
 *   so props are not spawned on the racing line (unless intentional).
 * HOW IT CONNECTS: track.js scenery offsets; validator uses same math.
 *
 * POWER BI MAPPING: none
 */

import { EnvironmentConfig } from "./world-config.js?v=1";

/** Painted verge beyond the ribbon edge (metres) — props stay outside. */
export const ROAD_SHOULDER = EnvironmentConfig.roadShoulder;

/** Extra safety for tall canopy / rock radius. */
export const SAFETY_MARGIN = {
  desert: 13.3,
  forest: 12.0,
  mountain: 10.3,
  lakeside: 5.0,
  default: 5.0,
};

/** Extra environment exclusion beyond safety (asymmetric planting starts here). */
export const SCENERY_MARGIN = {
  desert: 0,
  forest: 0,
  mountain: 0,
  lakeside: 0,
  default: 0,
};

/**
 * Half-width from centerline to first allowed plant (metres).
 * Plant offset = this + random spread (variation lives *outside* the corridor).
 *
 * @param {string} scenery
 * @param {number} roadWidth
 * @returns {number}
 */
export function exclusionHalfWidth(scenery, roadWidth) {
  const w = Math.max(6, roadWidth || 10);
  const safety = SAFETY_MARGIN[scenery] ?? SAFETY_MARGIN.default;
  const sceneryPad = SCENERY_MARGIN[scenery] ?? SCENERY_MARGIN.default;
  return w * 0.5 + ROAD_SHOULDER + safety + sceneryPad;
}

/**
 * Shoulder pad only (beyond half road width) — matches prior stage-specific pads.
 * @param {string} scenery
 * @returns {number}
 */
export function shoulderPadForScenery(scenery) {
  // Keep parity with pre-existing planting pads so density does not jump.
  if (scenery === "desert") return 16.5;
  if (scenery === "forest") return 15.2;
  if (scenery === "mountain") return 13.5;
  return 8.2;
}

/**
 * Full corridor description for a sample along the road.
 * @param {{ width?: number }} point
 * @param {string} scenery
 * @returns {{
 *   roadHalf: number,
 *   shoulder: number,
 *   safety: number,
 *   scenery: number,
 *   exclusionHalf: number,
 * }}
 */
export function clearanceAt(point, scenery) {
  const roadHalf = Math.max(3, (point.width || 10) * 0.5);
  const shoulder = ROAD_SHOULDER;
  const safety = SAFETY_MARGIN[scenery] ?? SAFETY_MARGIN.default;
  const sceneryM = SCENERY_MARGIN[scenery] ?? SCENERY_MARGIN.default;
  return {
    roadHalf,
    shoulder,
    safety,
    scenery: sceneryM,
    exclusionHalf: roadHalf + shoulder + safety + sceneryM,
  };
}

/**
 * True if a world XZ at lateral offset `off` from centerline is inside exclusion.
 * @param {number} off distance from centerline (metres)
 * @param {number} roadWidth
 * @param {string} scenery
 * @returns {boolean}
 */
export function insideExclusion(off, roadWidth, scenery) {
  return Math.abs(off) < exclusionHalfWidth(scenery, roadWidth);
}
