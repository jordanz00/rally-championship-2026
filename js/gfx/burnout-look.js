/**
 * Race present — photographic grade, not the teal arcade look.
 *
 * WHO THIS IS FOR: PhotoRealPost. The teal/amber grade, speed fringe, and
 *   rush bloom stay off (player cut, 2026-11-01).
 * WHAT IT DOES: A small lift in contrast, color, and sun bloom so paint and
 *   dirt read as a finished photograph. Lakeside stays quieter.
 * HOW IT CONNECTS: postfx.syncFromConfig / render. config.js is not edited.
 */

/** @typedef {{contrast:number,sat:number,warmth:number,bloom:number,thresh:number,teal:number,vig:number,roll:number}} BurnoutBase */

/** @type {Record<string, BurnoutBase>} */
const STAGE = {
  desert: {
    contrast: 1.06,
    sat: 1.08,
    warmth: 0.04,
    bloom: 0.22,
    thresh: 0.7,
    teal: 0,
    vig: 0.18,
    roll: 0.22,
  },
  forest: {
    contrast: 1.05,
    sat: 1.06,
    warmth: 0,
    bloom: 0.2,
    thresh: 0.72,
    teal: 0,
    vig: 0.2,
    roll: 0.22,
  },
  mountain: {
    contrast: 1.06,
    sat: 1.07,
    warmth: 0.02,
    bloom: 0.2,
    thresh: 0.7,
    teal: 0,
    vig: 0.18,
    roll: 0.22,
  },
  lakeside: {
    contrast: 1.02,
    sat: 0.98,
    warmth: 0,
    bloom: 0.12,
    thresh: 0.78,
    teal: 0,
    vig: 0.16,
    roll: 0.24,
  },
};

/**
 * Speed fringe stays off.
 * @param {number} _speedMs
 * @returns {number}
 */
export function burnoutSpeedAmt(_speedMs) {
  return 0;
}

/**
 * Stage photograph. Rush, fire, and speed do not change it.
 * @param {string} [courseId]
 * @param {{speed?:number,title?:boolean,tunnel?:number,rush?:number,fire?:number}} [opts]
 * @returns {BurnoutBase & {speedAmt:number,chroma:number,courseId:string}}
 */
export function burnoutLookFor(courseId, opts = {}) {
  const id = STAGE[courseId] ? courseId : "desert";
  const base = STAGE[id];
  const title = !!(opts && opts.title);
  return {
    courseId: id,
    contrast: title ? Math.min(base.contrast, 1.04) : base.contrast,
    sat: title ? Math.min(base.sat, 1.04) : base.sat,
    warmth: base.warmth,
    bloom: title ? Math.min(base.bloom, 0.12) : base.bloom,
    thresh: base.thresh,
    teal: 0,
    vig: title ? 0.14 : base.vig,
    roll: base.roll,
    speedAmt: 0,
    chroma: 0,
  };
}
