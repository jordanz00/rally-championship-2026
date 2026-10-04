/**
 * Burnout-style arcade present — hot grade, speed bloom, teal/amber split.
 *
 * WHO THIS IS FOR: PhotoRealPost + RallyGame race present.
 * WHAT IT DOES: Stage look tables that sit on top of authored VISUAL without
 *   editing config.js. Lakeside stays pulled so the sky does not blow out.
 * HOW IT CONNECTS: postfx.syncFromConfig / render. Camera FOV punch stays off
 *   on medium chase — speed reads through grade, bloom, and CA instead.
 */

/** @typedef {{contrast:number,sat:number,warmth:number,bloom:number,thresh:number,teal:number,vig:number,roll:number}} BurnoutBase */

/** @type {Record<string, BurnoutBase>} */
const STAGE = {
  desert: {
    contrast: 1.2,
    sat: 1.18,
    warmth: 0.34,
    bloom: 0.36,
    thresh: 0.56,
    teal: 0.16,
    vig: 0.88,
    roll: 0.08,
  },
  forest: {
    contrast: 1.16,
    sat: 1.12,
    warmth: 0.2,
    bloom: 0.3,
    thresh: 0.6,
    teal: 0.08,
    vig: 0.9,
    roll: 0.1,
  },
  mountain: {
    contrast: 1.18,
    sat: 1.14,
    warmth: 0.16,
    bloom: 0.3,
    thresh: 0.58,
    teal: 0.18,
    vig: 0.9,
    roll: 0.09,
  },
  lakeside: {
    contrast: 1.1,
    sat: 1.06,
    warmth: 0.04,
    bloom: 0.16,
    thresh: 0.7,
    teal: 0.06,
    vig: 0.78,
    roll: 0.2,
  },
};

/**
 * Speed 0–1 for CA / bloom punch. Starts around 40 mph, full at ~90 mph.
 * @param {number} speedMs
 * @returns {number}
 */
export function burnoutSpeedAmt(speedMs) {
  const s = Number(speedMs) || 0;
  return Math.max(0, Math.min(1, (s - 18) / 42));
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
  const lake = id === "lakeside";
  const tunnel = Math.max(0, Math.min(1, Number(opts.tunnel) || 0));
  const rush = title ? 0 : Math.max(0, Math.min(1, Number(opts.rush) || 0));
  const fire = title ? 0 : Math.max(0, Math.min(1, Number(opts.fire) || 0));
  const speedAmt = title
    ? 0
    : Math.min(1, Math.max(burnoutSpeedAmt(opts.speed), rush * 0.92, fire * 0.7));
  const bloom = title
    ? Math.min(base.bloom, 0.22)
    : base.bloom * (1 + speedAmt * 0.42 + rush * 0.38 + fire * (lake ? 0.12 : 0.48));
  return {
    courseId: id,
    contrast: title ? Math.min(base.contrast, 1.14) : base.contrast + fire * (lake ? 0.02 : 0.06),
    sat: title ? Math.min(base.sat, 1.12) : base.sat * (1 + fire * (lake ? 0.02 : 0.06)),
    warmth: base.warmth + tunnel * 0.1 + rush * 0.04 + fire * (lake ? 0.02 : 0.08),
    bloom,
    thresh: Math.max(0.48, base.thresh - rush * 0.04 - fire * (lake ? 0.02 : 0.06)),
    teal: base.teal * (1 - 0.72 * tunnel),
    vig: title ? Math.min(base.vig, 0.55) : base.vig + speedAmt * 0.14 + fire * 0.06,
    roll: base.roll,
    speedAmt,
    chroma: title ? 0 : 0.0046 + rush * 0.0038 + fire * (lake ? 0.001 : 0.0042),
  };
}
