/**
 * Jump kit — shared, tested jump presets for stage definitions.
 *
 * WHO THIS IS FOR: stage authors (desert/forest/mountain/lakeside definitions).
 * WHAT IT DOES: names the jump TYPES so every stage gets a varied set instead
 *   of one copy-pasted hop. Every preset ends in a long flat land pad (the
 *   arrival is flat, forgiving) and a modest drop; qa-stage-fun.mjs asserts
 *   the pad / exit grades and that air distance fits the pad.
 * HOW IT CONNECTS: spread into a `kind: "jump"` segment, compiled by
 *   track-definition.js → Track._buildSpline (ramp / crest / gap / land).
 *
 * TYPES
 *   hop     small kick — boosts the Rush tank, never scary
 *   medium  clean mid-size launch
 *   table   long flat lip then a medium gap (table-top: carry speed over it)
 *   big     big hang-time launch for a long straight
 */

/** @type {Record<string, {ramp:number,rise:number,lip:number,gap:number,drop:number,land:number}>} */
export const JUMP_KIT = {
  hop: { ramp: 12, rise: 1.05, lip: 4, gap: 8, drop: 0.65, land: 20 },
  medium: { ramp: 18, rise: 2.1, lip: 5.5, gap: 20, drop: 1.45, land: 30 },
  table: { ramp: 18, rise: 2.3, lip: 12, gap: 20, drop: 1.5, land: 34 },
  big: { ramp: 22, rise: 3.0, lip: 6, gap: 40, drop: 2.1, land: 42 },
};

/**
 * Build a jump segment from a preset.
 * @param {"hop"|"medium"|"table"|"big"} type
 * @param {{surface?:string,width?:number,purpose?:string,visual?:string}} extra
 * @returns {object}
 */
export function jumpSeg(type, extra = {}) {
  const k = JUMP_KIT[type];
  if (!k) throw new Error(`jump-kit: unknown jump type "${type}"`);
  return { kind: "jump", jumpType: type, ...k, ...extra };
}
