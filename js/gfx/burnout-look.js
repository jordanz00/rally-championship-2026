/**
 * Race present grade — authored rally look, no arcade punch.
 *
 * WHO THIS IS FOR: PhotoRealPost + RallyGame race present.
 * WHAT IT DOES: Holds contrast, bloom, and vignette at the config grade.
 *   Speed, rush, and On Fire do not add bloom, teal split, or color fringing.
 * HOW IT CONNECTS: postfx.syncFromConfig / render. config.js is not edited.
 */

/** @typedef {{contrast:number,sat:number,warmth:number,bloom:number,thresh:number,teal:number,vig:number,roll:number}} BurnoutBase */

/** @type {Record<string, BurnoutBase>} */
const STAGE = {
  desert: { contrast: 1.08, sat: 1.02, warmth: 0.06, bloom: 0.14, thresh: 0.72, teal: 0, vig: 0.11, roll: 0.2 },
  forest: { contrast: 1.08, sat: 1.02, warmth: 0.05, bloom: 0.14, thresh: 0.72, teal: 0, vig: 0.11, roll: 0.2 },
  mountain: { contrast: 1.08, sat: 1.02, warmth: 0.05, bloom: 0.14, thresh: 0.72, teal: 0, vig: 0.11, roll: 0.2 },
  lakeside: { contrast: 1.06, sat: 1.0, warmth: 0.04, bloom: 0.1, thresh: 0.76, teal: 0, vig: 0.1, roll: 0.22 },
};

/**
 * Speed 0–1 for CA / bloom punch. Starts around 40 mph, full at ~90 mph.
 * @param {number} speedMs
 * @returns {number}
 */
export function burnoutSpeedAmt(_speedMs) {
  return 0;
}

/**
 * @param {string} [courseId]
 * @param {{speed?:number,title?:boolean,tunnel?:number,rush?:number,fire?:number}} [opts]
 * @returns {BurnoutBase & {speedAmt:number,chroma:number,courseId:string}}
 */
export function burnoutLookFor(courseId, opts = {}) {
  const id = STAGE[courseId] ? courseId : "desert";
  const base = STAGE[id];
  const title = !!opts.title;
  return {
    courseId: id,
    contrast: base.contrast,
    sat: base.sat,
    warmth: title ? Math.min(base.warmth, 0.04) : base.warmth,
    bloom: title ? Math.min(base.bloom, 0.1) : base.bloom,
    thresh: base.thresh,
    teal: 0,
    vig: title ? Math.min(base.vig, 0.08) : base.vig,
    roll: base.roll,
    speedAmt: 0,
    chroma: 0,
  };
}
