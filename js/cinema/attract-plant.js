/**
 * Attract-only chassis plant — same millimetres as the live Celica.
 *
 * WHO THIS IS FOR: title reel + QA.
 * WHAT IT DOES: maps ribbon/deck Y to chassis origin Y after plantOnContactPatch.
 * HOW IT CONNECTS: AttractReel.update poses every pack car. Race physics
 *   (vehicle.js TIRE_PLANT + chassisDeckEmbed) stays untouched.
 *
 * Origin after plantOnContactPatch is the contact patch. Do not subtract
 * wheel radius again — that would bury the hubs through the ribbon.
 */

/** Same 14 mm as vehicle.js TIRE_PLANT — do not import config. */
export const ATTRACT_TIRE_PLANT = 0.014;

/** plantOnContactPatch default sink (tirePlantSink on the mesh). */
export const ATTRACT_TIRE_SINK_DEFAULT = 0.012;

/** 2 mm kiss so the tread meets paint without a z-fight hover. */
export const ATTRACT_WHEEL_KISS = 0.002;

/**
 * Chassis origin Y for a planted rival/hero mesh on a ribbon deck.
 * @param {number} deckY ribbon / painted-deck height
 * @returns {number}
 */
export function attractChassisY(deckY) {
  return deckY - ATTRACT_TIRE_PLANT;
}

/**
 * Hub lift matching celica.chassisDeckEmbed when there is no physics vehicle.
 * @param {number} [tirePlantSink]
 * @returns {number}
 */
export function attractDeckLift(tirePlantSink = ATTRACT_TIRE_SINK_DEFAULT) {
  const sink = Number.isFinite(tirePlantSink) ? tirePlantSink : ATTRACT_TIRE_SINK_DEFAULT;
  return ATTRACT_TIRE_PLANT + sink - ATTRACT_WHEEL_KISS;
}

/**
 * World Y of the tire contact after chassis plant + hub lift.
 * Equals deckY − kiss (a couple of millimetres into the slab, never a hover).
 * @param {number} deckY
 * @param {number} [tirePlantSink]
 * @returns {number}
 */
export function attractRubberY(deckY, tirePlantSink = ATTRACT_TIRE_SINK_DEFAULT) {
  const sink = Number.isFinite(tirePlantSink) ? tirePlantSink : ATTRACT_TIRE_SINK_DEFAULT;
  return attractChassisY(deckY) - sink + attractDeckLift(sink);
}

/**
 * rubber − deck. Negative = kiss into the slab. Must stay within a few cm.
 * @param {number} deckY
 * @param {number} [tirePlantSink]
 * @returns {number}
 */
export function attractPlantGap(deckY, tirePlantSink = ATTRACT_TIRE_SINK_DEFAULT) {
  return attractRubberY(deckY, tirePlantSink) - deckY;
}

/** Play-lane half-width — matches the attract ribbon. */
export const ATTRACT_ROAD_HALF = 7.4;

/** Sand / forest tiles under the asphalt must sit this far below deck. */
export const ATTRACT_SAND_DROP = 0.48;

/** How far past the painted edge the trench still hides grit. */
export const ATTRACT_LANE_PAD = 2.6;

/** Half wheelbase for a pitch around the contact patch (Celica-ish). */
export const ATTRACT_HALF_WHEELBASE = 1.35;

/** Hull AABB may kiss this far into the slab — never a buried bumper. */
export const ATTRACT_HULL_EPS = 0.03;

/**
 * Extra chassis Y so a pitch/roll around the contact patch does not
 * bury a bumper or a wheel under the ribbon. Zero when the car is flat.
 * @param {number} pitch
 * @param {number} [roll]
 * @param {number} [halfLen]
 * @returns {number}
 */
export function attractPitchClearance(pitch = 0, roll = 0, halfLen = ATTRACT_HALF_WHEELBASE) {
  const p = Number.isFinite(pitch) ? pitch : 0;
  const r = Number.isFinite(roll) ? roll : 0;
  return Math.abs(Math.sin(p)) * halfLen + Math.abs(Math.sin(r)) * 0.85;
}

/**
 * Chassis Y after the v985 plant, plus jump/cut clearance so the hull
 * stays above deck − kiss. Does not add the old 16 cm hover pad.
 * @param {number} deckY
 * @param {number} [pitch]
 * @param {number} [roll]
 * @returns {number}
 */
export function attractChassisYCleared(deckY, pitch = 0, roll = 0) {
  return attractChassisY(deckY) + attractPitchClearance(pitch, roll);
}

/**
 * Lowest wheel / hull Y after plant + pitch clearance.
 * @param {number} deckY
 * @param {number} [tirePlantSink]
 * @returns {number}
 */
export function attractHullMinY(deckY, tirePlantSink = ATTRACT_TIRE_SINK_DEFAULT) {
  return attractRubberY(deckY, tirePlantSink);
}

/**
 * Land / forest Y allowed in the play lane. Always below the ribbon.
 * @param {number} deckY
 * @returns {number}
 */
export function attractPlayLaneLandY(deckY) {
  return deckY - ATTRACT_SAND_DROP;
}

/**
 * Backdrop height. Play lane is a trench so grit cannot poke through paint.
 * @param {number} deckY
 * @param {number} dist distance from ribbon centre
 * @param {number} [dune]
 * @returns {number}
 */
export function attractBackdropY(deckY, dist, dune = 0) {
  const d = Math.max(0, dist);
  if (d <= ATTRACT_ROAD_HALF + ATTRACT_LANE_PAD) {
    return attractPlayLaneLandY(deckY);
  }
  if (d < 24) {
    const span = 24 - ATTRACT_ROAD_HALF - ATTRACT_LANE_PAD;
    const u = (d - ATTRACT_ROAD_HALF - ATTRACT_LANE_PAD) / Math.max(0.001, span);
    const berm = Math.sin(Math.min(1, u) * Math.PI) * 0.82;
    return Math.min(deckY - 0.16, deckY - 0.22 + berm * u + dune * 0.18 * u);
  }
  if (d < 110) {
    const u = (d - 24) / 86;
    return deckY * (1 - u) * 0.22 + (-1.15 + dune) * (0.5 + u * 0.5);
  }
  return -1.45 + dune;
}

/**
 * True when a sand / forest tile would show in the play lane.
 * @param {number} deckY
 * @param {number} landY
 * @param {number} [dist]
 * @returns {boolean}
 */
export function attractSandPokesRoad(deckY, landY, dist = 0) {
  if (dist > ATTRACT_ROAD_HALF + 0.35) return false;
  return landY > attractPlayLaneLandY(deckY) + 1e-6;
}
