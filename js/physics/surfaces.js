/**
 * Surfaces — sample grip under each tire.
 *
 * WHO THIS IS FOR: vehicle physics and HUD surface readout.
 * WHAT IT DOES: blends SURFACES config by track query + off-road runoff.
 * HOW IT CONNECTS: Track.query() returns a surface id; Vehicle asks blend().
 */

import { SURFACES } from "./config.js";

export function getSurface(id) {
  return SURFACES[id] || SURFACES.dirt;
}

/**
 * Blend two surfaces (e.g. left tires on gravel, right on grass).
 */
export function blendSurfaces(a, b, t) {
  const sa = getSurface(a);
  const sb = getSurface(b);
  const k = Math.max(0, Math.min(1, t));
  return {
    id: k > 0.5 ? sb.id : sa.id,
    label: k > 0.5 ? sb.label : sa.label,
    muPeak: sa.muPeak + (sb.muPeak - sa.muPeak) * k,
    muSlide: sa.muSlide + (sb.muSlide - sa.muSlide) * k,
    roll: sa.roll + (sb.roll - sa.roll) * k,
    sink: sa.sink + (sb.sink - sa.sink) * k,
    bump: sa.bump + (sb.bump - sa.bump) * k,
    dust: sa.dust + (sb.dust - sa.dust) * k,
    speedScale: sa.speedScale + (sb.speedScale - sa.speedScale) * k,
    driftEase: sa.driftEase + (sb.driftEase - sa.driftEase) * k,
    color: sa.color,
  };
}
