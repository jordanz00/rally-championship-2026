/**
 * Gauge readouts — believable Stage Celica numbers on a hot arcade chassis.
 *
 * WHO THIS IS FOR: chase HUD + POV cluster.
 * WHAT IT DOES: maps true ground mph to a calibrated cluster mph so WOT
 *   does not read like a highway supercar. Physics stays unchanged.
 */

/** Celica soft ceiling used as the calibration anchor (km/h → mph). */
const REF_TRUE_MPH = 255 * 0.621371;
/**
 * What the speedo should show at that anchor — Group A stage pace, not 160 mph.
 * Dirt / rush still climb a bit under the dial red.
 */
const REF_GAUGE_MPH = 118;
/** Face top — classic rally cluster, room past the red arc. */
export const GAUGE_DIAL_MAX_MPH = 140;
/** Red paint starts here on the speedo face. */
export const GAUGE_DIAL_RED_MPH = 120;

const MPH_SCALE = REF_GAUGE_MPH / REF_TRUE_MPH;

/**
 * True ground speed (mph) → cluster mph.
 * @param {number} trueMph
 * @returns {number}
 */
export function gaugeMph(trueMph) {
  if (!(trueMph > 0)) return 0;
  return trueMph * MPH_SCALE;
}

/**
 * True ground speed (km/h) → cluster mph.
 * @param {number} kmh
 * @returns {number}
 */
export function gaugeMphFromKmh(kmh) {
  return gaugeMph((kmh || 0) * 0.621371);
}
