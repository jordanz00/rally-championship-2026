/**
 * Road micro-terrain — deterministic ruts, washboard, and rally patches.
 *
 * WHO THIS IS FOR: Track.query height and the vehicle suspension path.
 * WHAT IT DOES: adds centimetre-to-decimetre height variation on the driving
 *   ribbon so no line is perfectly flat. Lateral offset matters — the pattern
 *   differs left vs right so you can hunt for a smoother strip.
 * HOW IT CONNECTS: track.js adds this to query height and road mesh vertices;
 *   vehicle.js uses bumpField for yaw kick and roadChatter for tiny HF bobble.
 */

import { SURFACES } from "../config.js?v=163";

/** @param {number} n */
function hash1(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Deterministic ribbon roughness at a point on the stage.
 * @param {number} dist metres along the racing line
 * @param {number} lateral metres from ribbon centre (+ = left)
 */
export function bumpField(dist, lateral) {
  return (
    Math.sin(dist * 0.73 + lateral * 0.41) * 0.58 +
    Math.sin(dist * 1.61 + lateral * 0.9 + 1.7) * 0.3 +
    Math.sin(dist * 3.7 - lateral * 1.7) * 0.12
  );
}

/** Which side the current bump lifts: +1 = right of centre, -1 = left. */
export function bumpSideAt(dist, lateral) {
  return Math.sin(dist * 0.51 + lateral * 0.3) >= 0 ? 1 : -1;
}

/**
 * Surface-scaled amplitude for micro height (metres).
 * @param {string} surface
 */
function surfaceMicroAmp(surface) {
  const s = SURFACES[surface] || SURFACES.dirt;
  const b = s.bump != null ? s.bump : 0.036;
  const id = s.id || surface;
  if (id === "tarmac") return b * 0.42;
  if (id === "cobble") return b * 1.28;
  if (id === "sand") return b * 0.62;
  if (id === "mud") return b * 0.82;
  if (id === "grass") return b * 0.5;
  return b;
}

/**
 * Occasional rut band or repair patch — smooth envelope over ~40–55 m.
 * @param {number} dist
 * @param {number} lateral
 * @param {number} amp
 */
function patchBump(dist, lateral, amp) {
  const cellLen = 48;
  const cell = Math.floor(dist / cellLen);
  const h = hash1(cell);
  if (h < 0.38) return 0;
  const local = (dist % cellLen) / cellLen;
  const env = Math.sin(local * Math.PI);
  if (env < 0.06) return 0;
  const patchAmp = amp * (0.62 + h * 1.05);
  const wave = Math.sin(dist * 0.29 + lateral * 0.24 + h * 6.28);
  const corrug = Math.sin(dist * 5.4 + lateral * 1.15) * 0.26;
  return env * patchAmp * (wave * 0.68 + corrug);
}

/**
 * Height offset (metres) for the driving ribbon at dist/lateral.
 * Zero on jumps, gaps, and tunnels.
 *
 * @param {number} dist
 * @param {number} lateral
 * @param {string} surface
 * @param {string|null} [jumpKind]
 * @param {boolean} [tunnel]
 */
export function roadMicroHeight(dist, lateral, surface, jumpKind, tunnel) {
  if (tunnel) return 0;
  if (jumpKind === "ramp" || jumpKind === "crest" || jumpKind === "land" || jumpKind === "gap") return 0;
  const amp = surfaceMicroAmp(surface);
  if (amp < 0.002) return 0;
  const continuous =
    bumpField(dist, lateral) * amp * 0.78 +
    Math.sin(dist * 0.19 + lateral * 0.33) * amp * 0.46 +
    Math.sin(dist * 4.8 + lateral * 0.7) * amp * 0.2;
  return continuous + patchBump(dist, lateral, amp * 1.65);
}

/**
 * Tiny high-frequency chassis bobble on top of query height — kept small so
 * the main unevenness lives in Track.query and axle probes.
 */
export function roadChatter(dist, lateral, amp) {
  if (amp < 0.002) return 0;
  const a = amp * 0.32;
  return Math.sin(dist * 8.6 + lateral * 1.35) * a * 0.28;
}
