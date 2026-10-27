/**
 * Race present — Burnout juice on dirt.
 *
 * WHO THIS IS FOR: PhotoRealPost + RallyGame race present.
 * WHAT IT DOES: Teal shadows, amber highlights, sun bloom, speed fringe.
 *   Title stays still. Lakeside stays under Desert. On Fire lifts bloom only.
 * HOW IT CONNECTS: postfx.syncFromConfig / render. config.js is not edited.
 */

/** @typedef {{contrast:number,sat:number,warmth:number,bloom:number,thresh:number,teal:number,vig:number,roll:number}} BurnoutBase */

/** @type {Record<string, BurnoutBase>} */
const STAGE = {
  desert: { contrast: 1.2, sat: 1.16, warmth: 0.12, bloom: 0.3, thresh: 0.6, teal: 0.26, vig: 0.16, roll: 0.15 },
  forest: { contrast: 1.16, sat: 1.1, warmth: 0.06, bloom: 0.24, thresh: 0.64, teal: 0.2, vig: 0.18, roll: 0.16 },
  mountain: { contrast: 1.16, sat: 1.08, warmth: 0.08, bloom: 0.22, thresh: 0.64, teal: 0.16, vig: 0.16, roll: 0.16 },
  lakeside: { contrast: 1.08, sat: 1.02, warmth: 0.04, bloom: 0.14, thresh: 0.74, teal: 0.06, vig: 0.1, roll: 0.22 },
};

/**
 * Speed 0–1 for the fringe. Quiet under ~42 mph, full by ~97 mph.
 * @param {number} speedMs
 * @returns {number}
 */
export function burnoutSpeedAmt(speedMs) {
  const mph = (speedMs || 0) * 2.23694;
  if (mph < 42) return 0;
  return Math.min(1, (mph - 42) / 55);
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
  const tunnel = Math.max(0, Math.min(1, opts.tunnel || 0));
  const rush = Math.max(0, Math.min(1, opts.rush || 0));
  const fire = opts.fire ? 1 : 0;
  const speedAmt = title ? 0 : burnoutSpeedAmt(opts.speed || 0);
  const pulled = id === "lakeside";
  const bloom =
    (title ? Math.min(base.bloom, 0.18) : base.bloom * (1 - tunnel * 0.4)) +
    (title ? 0 : fire * (pulled ? 0.03 : 0.07) + rush * (pulled ? 0.012 : 0.028));
  return {
    courseId: id,
    contrast: base.contrast,
    sat: base.sat,
    warmth: title ? Math.min(base.warmth, 0.08) : base.warmth + (pulled ? 0 : fire * 0.03),
    bloom,
    thresh: base.thresh,
    teal: title ? base.teal * 0.6 : base.teal * (1 - tunnel * 0.35),
    vig: title ? Math.min(base.vig, 0.2) : base.vig + tunnel * 0.06,
    roll: base.roll,
    speedAmt,
    chroma: title || speedAmt <= 0 ? 0 : 0.008,
  };
}
