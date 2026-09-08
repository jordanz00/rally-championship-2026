/**
 * Rally start / finish cloth flags — CPU Verlet fabric in the stage wind.
 *
 * WHO THIS IS FOR: the chase / medium camera at START and FINISH.
 * WHAT IT DOES: plants a steel pole plus a modest cloth grid (8×12) and
 *   integrates gravity, damping, stretch-limited springs, pole pins, and
 *   LIGHTING.wind each frame. Not a Kenney toy mesh. Not a UV wiggle shader.
 * HOW IT CONNECTS: Track._addStageGates() plants; Track.update() ticks.
 *   Wind comes from config LIGHTING[scenery].wind — no second weather system.
 *
 * Cost: a handful of flags (≈4–8). 96 particles each. No extra physics world.
 */

import * as THREE from "../../vendor/three.module.js";
import { LIGHTING, VISUAL } from "../config.js?v=220";

const COLS = 8;
const ROWS = 12;
const FLAG_W = 1.68;
const FLAG_H = 1.14;
const POLE_H = 5.42;
const POLE_R = 0.042;
const HOIST_TOP = 5.22;
const HOIST_BOT = HOIST_TOP - FLAG_H;
const STRUCT_ITERS = 5;
const MAX_STRETCH = 1.13;
const GRAVITY = -10.4;
const DAMPING = 0.978;
const NEAR_M = 88;
const FAR_SKIP = 3;

/** @type {Map<string, THREE.CanvasTexture>} */
const FLAG_TEX = new Map();
/** @type {THREE.CylinderGeometry|null} */
let POLE_GEO = null;
/** @type {THREE.SphereGeometry|null} */
let FINIAL_GEO = null;
/** @type {THREE.TorusGeometry|null} */
let RING_GEO = null;
/** @type {THREE.MeshStandardMaterial|null} */
let STEEL_MAT = null;
/** @type {THREE.MeshStandardMaterial|null} */
let BRASS_MAT = null;
/** @type {Map<string, THREE.MeshStandardMaterial>} */
const CLOTH_MAT = new Map();

let reduceMotion = null;

/**
 * Stage wind from the lighting profile, plus a gust envelope.
 * Desert / Mountain gust harder; Forest stays sheltered.
 * @param {string} scenery
 * @param {number} time
 * @returns {{x:number,y:number,z:number,mag:number}}
 */
export function stageWind(scenery, time) {
  const L = LIGHTING[scenery] || LIGHTING.forest || {};
  const w = L.wind || [0.4, 0, 0.4];
  const mag = Math.hypot(w[0], w[2]) || 0.45;
  let gustAmp = 0.16;
  let fa = 0.48;
  let fb = 0.13;
  if (scenery === "desert") {
    gustAmp = 0.52;
    fa = 1.12;
    fb = 0.36;
  } else if (scenery === "mountain") {
    gustAmp = 0.64;
    fa = 1.68;
    fb = 0.49;
  } else if (scenery === "lakeside") {
    gustAmp = 0.3;
    fa = 0.74;
    fb = 0.22;
  }
  const gust = 1 + gustAmp * Math.sin(time * fa + 0.4) * Math.sin(time * fb + 1.1);
  return {
    x: w[0] * gust,
    y: (w[1] || 0) + mag * 0.1,
    z: w[2] * gust,
    mag,
  };
}

/**
 * Fabric albedo — checkered finish or solid rally red, with a faint weave.
 * @param {"checkers"|"red"} kind
 * @returns {THREE.CanvasTexture}
 */
function flagTexture(kind) {
  const key = kind === "checkers" ? "checkers" : "red";
  const hit = FLAG_TEX.get(key);
  if (hit) return hit;
  const w = 512;
  const h = 352;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (key === "checkers") {
    const cols = 8;
    const rows = 6;
    const cw = w / cols;
    const rh = h / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const dark = (x + y) % 2 === 0;
        g.fillStyle = dark ? "#1a1a1c" : "#e8e4dc";
        g.fillRect(x * cw, y * rh, cw + 0.6, rh + 0.6);
      }
    }
  } else {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#d0181c");
    grad.addColorStop(0.55, "#b41018");
    grad.addColorStop(1, "#8c1014");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#f0ece4";
    g.fillRect(0, 0, 18, h);
    g.fillStyle = "rgba(255,220,220,0.12)";
    g.fillRect(0, 0, w, 10);
    g.fillRect(0, h - 10, w, 10);
  }
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % w;
    const py = (i / 4 / w) | 0;
    const weave = ((px * 17 + py * 13) % 7) - 3;
    const n = weave * 2.2 + ((px * 31 + py * 19) % 5) - 2;
    d[i] = clampByte(d[i] + n);
    d[i + 1] = clampByte(d[i + 1] + n);
    d[i + 2] = clampByte(d[i + 2] + n);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  FLAG_TEX.set(key, tex);
  return tex;
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function clothMaterial(kind) {
  const key = kind === "checkers" ? "checkers" : "red";
  let m = CLOTH_MAT.get(key);
  if (m) return m;
  const cinema = (VISUAL.tier || 0) >= 8 && VISUAL.realisticArcade !== false;
  m = cinema
    ? new THREE.MeshStandardMaterial({
        map: flagTexture(key),
        roughness: 0.84,
        metalness: 0.0,
        side: THREE.DoubleSide,
        envMapIntensity: 0.28,
        flatShading: false,
      })
    : new THREE.MeshLambertMaterial({
        map: flagTexture(key),
        side: THREE.DoubleSide,
        flatShading: false,
      });
  m.userData.kind = "cloth-flag";
  CLOTH_MAT.set(key, m);
  return m;
}

function steelMaterial() {
  if (STEEL_MAT) return STEEL_MAT;
  const cinema = (VISUAL.tier || 0) >= 8 && VISUAL.realisticArcade !== false;
  STEEL_MAT = cinema
    ? new THREE.MeshStandardMaterial({
        color: 0x4a5058,
        roughness: 0.34,
        metalness: 0.72,
        envMapIntensity: 0.55,
      })
    : new THREE.MeshLambertMaterial({ color: 0x4a5058 });
  STEEL_MAT.userData.kind = "flag-pole";
  return STEEL_MAT;
}

function brassMaterial() {
  if (BRASS_MAT) return BRASS_MAT;
  const cinema = (VISUAL.tier || 0) >= 8 && VISUAL.realisticArcade !== false;
  BRASS_MAT = cinema
    ? new THREE.MeshStandardMaterial({
        color: 0xb08a38,
        roughness: 0.3,
        metalness: 0.82,
        envMapIntensity: 0.7,
      })
    : new THREE.MeshLambertMaterial({ color: 0xb08a38 });
  return BRASS_MAT;
}

function poleGeos() {
  if (!POLE_GEO) {
    POLE_GEO = new THREE.CylinderGeometry(POLE_R * 0.82, POLE_R * 1.12, POLE_H, 10, 1);
    FINIAL_GEO = new THREE.SphereGeometry(0.075, 10, 8);
    RING_GEO = new THREE.TorusGeometry(POLE_R + 0.018, 0.012, 6, 10);
  }
  return { pole: POLE_GEO, finial: FINIAL_GEO, ring: RING_GEO };
}

function prefersReduce() {
  if (reduceMotion != null) return reduceMotion;
  try {
    reduceMotion = !!(
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  } catch {
    reduceMotion = false;
  }
  return reduceMotion;
}

/**
 * @param {object} opts
 * @param {number} opts.x
 * @param {number} opts.y land height
 * @param {number} opts.z
 * @param {number} opts.heading road heading
 * @param {number} opts.side -1 left / +1 right (along nx)
 * @param {"checkers"|"red"} opts.kind
 * @param {string} opts.scenery
 * @param {number} opts.nx
 * @param {number} opts.nz
 * @returns {ClothFlag}
 */
export function createClothFlag(opts) {
  const kind = opts.kind === "checkers" ? "checkers" : "red";
  const scenery = opts.scenery || "forest";
  const nx = opts.nx || 0;
  const nz = opts.nz || 1;
  const side = opts.side >= 0 ? 1 : -1;
  const ox = nx * side;
  const oz = nz * side;
  const ry = Math.atan2(-oz, ox);

  const group = new THREE.Group();
  group.name = kind === "checkers" ? "cloth-flag-finish" : "cloth-flag-start";
  group.position.set(opts.x, opts.y, opts.z);
  group.rotation.y = ry;
  group.userData.clothFlag = true;
  group.userData.envProp = false;

  const geos = poleGeos();
  const pole = new THREE.Mesh(geos.pole, steelMaterial());
  pole.position.y = POLE_H * 0.5 - 0.28;
  pole.castShadow = true;
  pole.receiveShadow = true;
  pole.userData.clothFlag = true;
  group.add(pole);

  const finial = new THREE.Mesh(geos.finial, brassMaterial());
  finial.position.y = POLE_H - 0.22;
  finial.castShadow = true;
  finial.userData.clothFlag = true;
  group.add(finial);

  const ring = new THREE.Mesh(geos.ring, brassMaterial());
  ring.position.y = HOIST_TOP;
  ring.rotation.x = Math.PI * 0.5;
  ring.userData.clothFlag = true;
  group.add(ring);

  const geo = new THREE.PlaneGeometry(FLAG_W, FLAG_H, COLS - 1, ROWS - 1);
  geo.translate(FLAG_W * 0.5 + POLE_R + 0.02, (HOIST_TOP + HOIST_BOT) * 0.5, 0);
  const pos = geo.attributes.position;
  pos.setUsage(THREE.DynamicDrawUsage);
  const count = pos.count;
  const cur = new Float32Array(count * 3);
  const prev = new Float32Array(count * 3);
  const pin = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    cur[i * 3] = x;
    cur[i * 3 + 1] = y;
    cur[i * 3 + 2] = z + (Math.random() - 0.5) * 0.012;
    prev[i * 3] = cur[i * 3];
    prev[i * 3 + 1] = cur[i * 3 + 1];
    prev[i * 3 + 2] = cur[i * 3 + 2];
    const col = i % COLS;
    if (col === 0) pin[i] = 1;
  }

  const restH = [];
  const restV = [];
  const restD = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      if (c + 1 < COLS) restH.push(dist3(cur, i, i + 1));
      if (r + 1 < ROWS) restV.push(dist3(cur, i, i + COLS));
      if (r + 1 < ROWS && c + 1 < COLS) restD.push(dist3(cur, i, i + COLS + 1));
      if (r + 1 < ROWS && c > 0) restD.push(dist3(cur, i, i + COLS - 1));
    }
  }

  const mesh = new THREE.Mesh(geo, clothMaterial(kind));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.clothFlag = true;
  mesh.frustumCulled = false;
  group.add(mesh);

  /** @type {ClothFlag} */
  const flag = {
    group,
    mesh,
    geo,
    cur,
    prev,
    pin,
    restH,
    restV,
    restD,
    ry,
    kind,
    scenery,
    x: opts.x,
    y: opts.y,
    z: opts.z,
    frame: 0,
  };

  for (let i = 0; i < 28; i++) stepCloth(flag, 1 / 60, i / 60, scenery, 1);
  writeCloth(flag);
  return flag;
}

/**
 * Integrate every planted flag. Far flags skip most frames.
 * @param {ClothFlag[]} flags
 * @param {number} dt
 * @param {number} time
 * @param {string} scenery
 * @param {{x:number,z:number}|null} [camera]
 */
export function updateClothFlags(flags, dt, time, scenery, camera) {
  if (!flags || !flags.length || dt <= 0) return;
  const windScale = prefersReduce() ? 0.32 : 1;
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    f.frame++;
    if (camera) {
      const dx = f.x - camera.x;
      const dz = f.z - camera.z;
      if (dx * dx + dz * dz > NEAR_M * NEAR_M && f.frame % FAR_SKIP) continue;
    }
    stepCloth(f, dt, time, scenery || f.scenery, windScale);
    writeCloth(f);
  }
}

/**
 * @param {ClothFlag} flag
 * @param {number} dt
 * @param {number} time
 * @param {string} scenery
 * @param {number} windScale
 */
function stepCloth(flag, dt, time, scenery, windScale) {
  const h = Math.min(0.042, Math.max(0.008, dt));
  const h2 = h * h;
  const wind = stageWind(scenery, time);
  const c = Math.cos(flag.ry);
  const s = Math.sin(flag.ry);
  let lx = (c * wind.x - s * wind.z) * windScale;
  const ly = wind.y * windScale;
  let lz = (s * wind.x + c * wind.z) * windScale;
  const cur = flag.cur;
  const prev = flag.prev;
  const pin = flag.pin;
  const n = pin.length;

  for (let i = 0; i < n; i++) {
    if (pin[i]) continue;
    const i3 = i * 3;
    const col = i % COLS;
    const row = (i / COLS) | 0;
    const turb =
      0.22 *
      Math.sin(time * 2.1 + col * 0.7 + flag.x * 0.05) *
      Math.sin(time * 1.3 + row * 0.45 + flag.z * 0.04);
    const edge = 0.55 + col / (COLS - 1);
    const vx = (cur[i3] - prev[i3]) * DAMPING;
    const vy = (cur[i3 + 1] - prev[i3 + 1]) * DAMPING;
    const vz = (cur[i3 + 2] - prev[i3 + 2]) * DAMPING;
    prev[i3] = cur[i3];
    prev[i3 + 1] = cur[i3 + 1];
    prev[i3 + 2] = cur[i3 + 2];
    const ax = (lx + turb * lz) * (7.2 * edge);
    const ay = GRAVITY + ly * 2.4;
    const az = (lz + turb) * (7.2 * edge);
    cur[i3] += vx + ax * h2;
    cur[i3 + 1] += vy + ay * h2;
    cur[i3 + 2] += vz + az * h2;
  }

  for (let iter = 0; iter < STRUCT_ITERS; iter++) {
    constrainGrid(flag);
    collidePole(flag);
  }
}

/**
 * @param {ClothFlag} flag
 */
function constrainGrid(flag) {
  const cur = flag.cur;
  const pin = flag.pin;
  let hi = 0;
  let vi = 0;
  let di = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      if (c + 1 < COLS) {
        satisfy(cur, pin, i, i + 1, flag.restH[hi++]);
      }
      if (r + 1 < ROWS) {
        satisfy(cur, pin, i, i + COLS, flag.restV[vi++]);
      }
      if (r + 1 < ROWS && c + 1 < COLS) {
        satisfy(cur, pin, i, i + COLS + 1, flag.restD[di++]);
      }
      if (r + 1 < ROWS && c > 0) {
        satisfy(cur, pin, i, i + COLS - 1, flag.restD[di++]);
      }
    }
  }
}

/**
 * Structural / shear spring with a hard stretch cap.
 * @param {Float32Array} cur
 * @param {Uint8Array} pin
 * @param {number} ia
 * @param {number} ib
 * @param {number} rest
 */
function satisfy(cur, pin, ia, ib, rest) {
  const a = ia * 3;
  const b = ib * 3;
  let dx = cur[b] - cur[a];
  let dy = cur[b + 1] - cur[a + 1];
  let dz = cur[b + 2] - cur[a + 2];
  let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1e-6) dist = 1e-6;
  if (dist > rest * MAX_STRETCH) {
    const clamp = (rest * MAX_STRETCH) / dist;
    dx *= clamp;
    dy *= clamp;
    dz *= clamp;
    dist = rest * MAX_STRETCH;
    const mx = (cur[a] + cur[b]) * 0.5;
    const my = (cur[a + 1] + cur[b + 1]) * 0.5;
    const mz = (cur[a + 2] + cur[b + 2]) * 0.5;
    if (!pin[ia]) {
      cur[a] = mx - dx * 0.5;
      cur[a + 1] = my - dy * 0.5;
      cur[a + 2] = mz - dz * 0.5;
    }
    if (!pin[ib]) {
      cur[b] = mx + dx * 0.5;
      cur[b + 1] = my + dy * 0.5;
      cur[b + 2] = mz + dz * 0.5;
    }
    return;
  }
  const diff = (dist - rest) / dist;
  const corr = diff * 0.5;
  if (pin[ia] && pin[ib]) return;
  if (pin[ia]) {
    cur[b] -= dx * diff;
    cur[b + 1] -= dy * diff;
    cur[b + 2] -= dz * diff;
    return;
  }
  if (pin[ib]) {
    cur[a] += dx * diff;
    cur[a + 1] += dy * diff;
    cur[a + 2] += dz * diff;
    return;
  }
  cur[a] += dx * corr;
  cur[a + 1] += dy * corr;
  cur[a + 2] += dz * corr;
  cur[b] -= dx * corr;
  cur[b + 1] -= dy * corr;
  cur[b + 2] -= dz * corr;
}

/**
 * Keep free particles off the pole shaft.
 * @param {ClothFlag} flag
 */
function collidePole(flag) {
  const cur = flag.cur;
  const pin = flag.pin;
  const minR = POLE_R + 0.028;
  const minR2 = minR * minR;
  for (let i = 0; i < pin.length; i++) {
    if (pin[i]) continue;
    const i3 = i * 3;
    const x = cur[i3];
    const z = cur[i3 + 2];
    const y = cur[i3 + 1];
    if (y < 0.2 || y > POLE_H + 0.2) continue;
    const d2 = x * x + z * z;
    if (d2 >= minR2 || d2 < 1e-8) continue;
    const d = Math.sqrt(d2);
    const s = minR / d;
    cur[i3] = x * s;
    cur[i3 + 2] = z * s;
  }
}

/**
 * @param {ClothFlag} flag
 */
function writeCloth(flag) {
  const pos = flag.geo.attributes.position;
  const cur = flag.cur;
  for (let i = 0; i < pinCount(flag); i++) {
    pos.setXYZ(i, cur[i * 3], cur[i * 3 + 1], cur[i * 3 + 2]);
  }
  pos.needsUpdate = true;
  flag.geo.computeVertexNormals();
}

function pinCount(flag) {
  return flag.pin.length;
}

function dist3(cur, ia, ib) {
  const a = ia * 3;
  const b = ib * 3;
  const dx = cur[b] - cur[a];
  const dy = cur[b + 1] - cur[a + 1];
  const dz = cur[b + 2] - cur[a + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
}

/**
 * @typedef {{
 *   group: THREE.Group,
 *   mesh: THREE.Mesh,
 *   geo: THREE.BufferGeometry,
 *   cur: Float32Array,
 *   prev: Float32Array,
 *   pin: Uint8Array,
 *   restH: number[],
 *   restV: number[],
 *   restD: number[],
 *   ry: number,
 *   kind: string,
 *   scenery: string,
 *   x: number,
 *   y: number,
 *   z: number,
 *   frame: number,
 * }} ClothFlag
 */
