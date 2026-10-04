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
