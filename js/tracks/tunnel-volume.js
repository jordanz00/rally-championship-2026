/**
 * TunnelVolume — authored tunnel as a carved corridor, not a mesh through terrain.
 *
 * WHO THIS IS FOR: Track builder, WorldGeometryValidator, lighting.
 * WHAT IT DOES: Builds volume descriptors from contiguous tunnel spline runs
 *   exposes a stable volume API consumed by Track mouth prisms, prop exclusion,
 *   trench sizing, and WorldGeometryValidator (?worldvalidate=1).
 * HOW IT CONNECTS: Track._markTunnelRuns builds volumes first, then prisms.
 *
 * POWER BI MAPPING: none
 */

/**
 * @typedef {{
 *   id: string,
 *   dist0: number,
 *   dist1: number,
 *   width: number,
 *   height: number,
 *   margin: number,
 *   entranceDist: number,
 *   exitDist: number,
 *   pointIndex0: number,
 *   pointIndex1: number,
 * }} TunnelVolume
 */

import { TunnelConfig } from "./world-config.js?v=1";

/** Default bore height (metres) — interior clearance above deck. */
export const TUNNEL_HEIGHT = TunnelConfig.height;

/** Extra lateral margin beyond road width for terrain carve / prop ban. */
export const TUNNEL_MARGIN = TunnelConfig.margin;

/**
 * Build TunnelVolume list from Track spline points with `tunnel: true`.
 * @param {{ dist: number, width?: number, tunnel?: boolean }[]} points
 * @returns {TunnelVolume[]}
 */
export function buildTunnelVolumes(points) {
  /** @type {TunnelVolume[]} */
  const vols = [];
  if (!points || !points.length) return vols;

  let i = 0;
  let run = 0;
  while (i < points.length) {
    if (!points[i].tunnel) {
      i++;
      continue;
    }
    const i0 = i;
    let maxW = points[i].width || 12;
    while (i < points.length && points[i].tunnel) {
      maxW = Math.max(maxW, points[i].width || 12);
      i++;
    }
    const i1 = i - 1;
    const dist0 = points[i0].dist;
    const dist1 = points[i1].dist;
    vols.push({
      id: `tunnel_${run++}`,
      dist0,
      dist1,
      width: maxW,
      height: TUNNEL_HEIGHT,
      margin: TUNNEL_MARGIN,
      entranceDist: dist0,
      exitDist: dist1,
      pointIndex0: i0,
      pointIndex1: i1,
    });
  }
  return vols;
}

/**
 * True if distance-along-track is inside any tunnel volume (with margin along).
 * @param {TunnelVolume[]} volumes
 * @param {number} dist
 * @param {number} [alongPad=2]
 * @returns {TunnelVolume|null}
 */
export function tunnelAtDist(volumes, dist, alongPad = 2) {
  for (let i = 0; i < volumes.length; i++) {
    const v = volumes[i];
    if (dist >= v.dist0 - alongPad && dist <= v.dist1 + alongPad) return v;
  }
  return null;
}

/**
 * Lateral half-width that must stay clear of exterior props / terrain spikes.
 * @param {TunnelVolume} vol
 * @returns {number}
 */
export function tunnelExclusionHalf(vol) {
  return vol.width * 0.5 + vol.margin;
}
