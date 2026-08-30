/**
 * Surfaces — sample grip under each tire.
 *
 * WHO THIS IS FOR: vehicle physics and HUD surface readout.
 * WHAT IT DOES: blends SURFACES config by track query + off-road runoff, and
 *   reports how far apart two surfaces are so the vehicle can stage a shock
 *   when the ribbon changes under the car.
 * HOW IT CONNECTS: Track.query() returns a surface id; Vehicle asks blend().
 *   Vehicle blends the FRONT and REAR axle separately, which is what produces
 *   the staggered drift when a texture change catches one axle first.
 */

import { SURFACES } from "../config.js?v=170";

/** Fields that are a simple numeric lerp between two surfaces. */
const LERP_FIELDS = [
  "muPeak",
  "muSlide",
  "slipPeak",
  "brakeHold",
  "brakeYaw",
  "slideHold",
  "gripSnap",
  "bumpSteer",
  "roll",
  "sink",
  "bump",
  "dust",
  "speedScale",
  "driftEase",
];

/** Fallbacks so a course that names a surface we never tuned still drives. */
const DEFAULTS = {
  muPeak: 1.14,
  muSlide: 0.86,
  slipPeak: 0.1,
  brakeHold: 0.55,
  brakeYaw: 0.4,
  slideHold: 0.9,
  gripSnap: 1.22,
  bumpSteer: 0.95,
  roll: 0.03,
  sink: 0.022,
  bump: 0.036,
  dust: 1,
  speedScale: 0.9,
  driftEase: 1.0,
};

export function getSurface(id) {
  return SURFACES[id] || SURFACES.dirt;
}

/**
 * Read one tuned field with a safe fallback.
 * @param {object} s surface entry
 * @param {string} key
 */
function field(s, key) {
  const v = s[key];
  return typeof v === "number" && Number.isFinite(v) ? v : DEFAULTS[key];
}

/**
 * Blend two surfaces (e.g. left tires on gravel, right on grass).
 *
 * Pass `out` on the hot path — a 15-car grid blends up to three times per car
 * per step and this used to allocate a fresh object every time.
 *
 * @param {string} a surface id we are coming from
 * @param {string} b surface id we are going to
 * @param {number} t 0 = fully `a`, 1 = fully `b`
 * @param {object} [out] reusable bag
 */
export function blendSurfaces(a, b, t, out) {
  const sa = getSurface(a);
  const sb = getSurface(b);
  const k = Math.max(0, Math.min(1, t));
  const r = out || {};
  r.id = k > 0.55 ? sb.id : sa.id;
  r.label = k > 0.55 ? sb.label : sa.label;
  for (let i = 0; i < LERP_FIELDS.length; i++) {
    const key = LERP_FIELDS[i];
    const va = field(sa, key);
    r[key] = va + (field(sb, key) - va) * k;
  }
  r.color = sa.color;
  return r;
}

/**
 * Signed grip gap between two surfaces, normalised roughly to -1..1.
 *
 * The vehicle uses this twice: front-vs-rear (which axle stepped out first)
 * and now-vs-a-moment-ago (how hard the transition should slap the car). A
 * positive value means `to` has MORE grip than `from`.
 *
 * @param {string|object} from surface id or blended surface
 * @param {string|object} to surface id or blended surface
 */
export function gripGap(from, to) {
  const a = typeof from === "string" ? getSurface(from) : from;
  const b = typeof to === "string" ? getSurface(to) : to;
  if (!a || !b) return 0;
  const muA = field(a, "muPeak");
  const muB = field(b, "muPeak");
  return Math.max(-1, Math.min(1, (muB - muA) / 0.55));
}
