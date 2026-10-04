/**
 * Rally start / finish cloth flags — CPU Verlet fabric in the stage wind.
 *
 * WHO THIS IS FOR: the chase / medium camera at START and FINISH.
 * WHAT IT DOES: plants a steel pole plus a modest cloth grid (8×12) and
 *   integrates gravity, damping, stretch-limited springs, pole pins, and
 *   LIGHTING.wind each frame. Not a Kenney toy mesh. Not a UV wiggle shader.
 * HOW IT CONNECTS: Track._addStageGates() plants; Track.update() ticks.
 *   Wind comes from config LIGHTING[scenery].wind — no second weather system.
 *   Each flag carries phase / seed offsets so a finish row never sync-waves.
 *
 * Cost: every stage start is a ten-flag festive avenue; finish is ten checkers.
 * 96 particles each. Far flags skip frames. No extra physics world.
 */

import * as THREE from "../../vendor/three.module.js";
import { LIGHTING, VISUAL } from "../config.js?v=241";

const COLS = 8;
const ROWS = 12;
const FLAG_W = 1.92;
const FLAG_H = 1.28;
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
 * Per-flag `phase` / `gustPhase` desync the envelope so a row never flaps as one.
 * @param {string} scenery
 * @param {number} time
 * @param {{phase?:number,gustPhase?:number,windMul?:number,dirBias?:number}|number} [opts]
 * @returns {{x:number,y:number,z:number,mag:number}}
 */
export function stageWind(scenery, time, opts) {
  const o =
    opts && typeof opts === "object"
      ? opts
      : { phase: typeof opts === "number" ? opts : 0 };
  const phase = o.phase || 0;
  const gustPhase = o.gustPhase != null ? o.gustPhase : phase * 1.37;
  const windMul = o.windMul != null ? o.windMul : 1;
  const dirBias = o.dirBias || 0;
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
  const gust =
    1 +
    gustAmp *
      Math.sin(time * fa + 0.4 + phase) *
      Math.sin(time * fb + 1.1 + gustPhase);
  // Small yaw bias so neighbouring poles do not share one wind vector.
  const cosb = Math.cos(dirBias);
  const sinb = Math.sin(dirBias);
  const wx = (w[0] * cosb - w[2] * sinb) * gust * windMul;
  const wz = (w[0] * sinb + w[2] * cosb) * gust * windMul;
  return {
    x: wx,
    y: ((w[1] || 0) + mag * 0.1) * windMul,
    z: wz,
    mag: mag * windMul,
  };
}

/**
 * Fabric albedo. Checkers, solid rally colours, and simple event marks.
 * Hoist (pole) is the left edge. Not a licensed sponsor lockup.
 * @param {string} kind
 * @returns {THREE.CanvasTexture}
 */
function flagTexture(kind) {
  const key = FLAG_PAINT[kind] ? kind : "red";
  const hit = FLAG_TEX.get(key);
  if (hit) return hit;
  const w = 768;
  const h = 512;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  FLAG_PAINT[key](g, w, h);
  finishCloth(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  tex.userData.shared = true;
  FLAG_TEX.set(key, tex);
  return tex;
}

/** @param {CanvasRenderingContext2D} g @param {number} w @param {number} h @param {string} color */
function hoistBar(g, w, h, color) {
  g.fillStyle = color;
  g.fillRect(0, 0, Math.max(18, w * 0.042), h);
}

/**
 * Stage start avenue — ten unique festive faces, one per pole.
 * @param {string} scenery
 * @returns {string[]}
 */
export function startFlagKinds(scenery) {
  if (scenery === "desert") {
    return ["gold", "orange", "maroon", "navy", "checkers", "sunrise", "ember", "ivory", "medina", "yellow"];
  }
  if (scenery === "forest") {
    return ["green", "gold", "white", "red", "maroon", "jade", "lime", "ivory", "tricolor", "orange"];
  }
  if (scenery === "mountain") {
    return ["white", "navy", "gold", "red", "indigo", "wave", "ivory", "maroon", "checkers", "blue"];
  }
  if (scenery === "lakeside") {
    return ["wave", "jade", "gold", "orange", "white", "cyan", "sunrise", "navy", "lime", "ivory"];
  }
  return ["red", "gold", "navy", "white", "orange", "green", "maroon", "yellow", "indigo", "checkers"];
}

/**
 * Rally / event flag faces. Festive originals — not national lockups.
 * @type {Record<string, function(CanvasRenderingContext2D, number, number): void>}
 */
const FLAG_PAINT = {
  checkers(g, w, h) {
    const cols = 8;
    const rows = 6;
    const cw = w / cols;
    const rh = h / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        g.fillStyle = (x + y) % 2 === 0 ? "#161618" : "#efeae0";
        g.fillRect(x * cw, y * rh, cw + 0.6, rh + 0.6);
      }
    }
  },
  red(g, w, h) {
    fillV(g, w, h, "#dc1c22", "#8a1016");
    hoistBar(g, w, h, "#f3efe6");
  },
  yellow(g, w, h) {
    g.fillStyle = "#f0c218";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#1a1a1c";
    g.fillRect(0, h * 0.34, w, h * 0.32);
    hoistBar(g, w, h, "#f7f3ea");
  },
  green(g, w, h) {
    fillV(g, w, h, "#249844", "#0c5820");
    hoistBar(g, w, h, "#f4f0e6");
  },
  blue(g, w, h) {
    g.fillStyle = "#1a4f9c";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#f4f0e6";
    g.beginPath();
    g.arc(w * 0.58, h * 0.5, h * 0.28, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1a4f9c";
    g.beginPath();
    g.arc(w * 0.58, h * 0.5, h * 0.16, 0, Math.PI * 2);
    g.fill();
    hoistBar(g, w, h, "#f4f0e6");
  },
  white(g, w, h) {
    g.fillStyle = "#f3efe6";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#c41218";
    g.lineWidth = 32;
    g.strokeRect(18, 18, w - 36, h - 36);
    hoistBar(g, w, h, "#c41218");
  },
  orange(g, w, h) {
    g.fillStyle = "#e25a12";
    g.fillRect(0, 0, w, h);
    chevron(g, w, h, "#f6f1e6", 0.26);
    hoistBar(g, w, h, "#f6f1e6");
  },
  navy(g, w, h) {
    g.fillStyle = "#14243f";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#d4b15a";
    g.fillRect(0, h * 0.38, w, h * 0.24);
    hoistBar(g, w, h, "#d4b15a");
  },
  maroon(g, w, h) {
    g.fillStyle = "#7a1830";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#f0e6d2";
    g.lineWidth = 40;
    g.beginPath();
    g.moveTo(0, h);
    g.lineTo(w, 0);
    g.stroke();
    hoistBar(g, w, h, "#f0e6d2");
  },
  gold(g, w, h) {
    fillV(g, w, h, "#ecc86a", "#b07e28");
    chevron(g, w, h, "#1c1a16", 0.34);
    hoistBar(g, w, h, "#1c1a16");
  },
  sunrise(g, w, h) {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#ff8a3a");
    grad.addColorStop(0.45, "#e43a5c");
    grad.addColorStop(1, "#6a1848");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#ffd27a";
    g.beginPath();
    g.arc(w * 0.72, h * 0.28, h * 0.16, 0, Math.PI * 2);
    g.fill();
    hoistBar(g, w, h, "#ffd27a");
  },
  ember(g, w, h) {
    g.fillStyle = "#141210";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#e02418";
    g.beginPath();
    g.moveTo(w * 0.12, h);
    g.lineTo(w * 0.38, h * 0.42);
    g.lineTo(w * 0.5, h * 0.72);
    g.lineTo(w * 0.66, h * 0.28);
    g.lineTo(w * 0.88, h);
    g.closePath();
    g.fill();
    hoistBar(g, w, h, "#e02418");
  },
  ivory(g, w, h) {
    g.fillStyle = "#f4ecda";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#2a6a68";
    g.fillRect(0, 0, w, h * 0.14);
    g.fillRect(0, h * 0.86, w, h * 0.14);
    hoistBar(g, w, h, "#2a6a68");
  },
  medina(g, w, h) {
    g.fillStyle = "#c45a2c";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#f3e2c4";
    g.fillRect(0, h * 0.22, w, h * 0.16);
    g.fillRect(0, h * 0.62, w, h * 0.16);
    hoistBar(g, w, h, "#f3e2c4");
  },
  jade(g, w, h) {
    fillV(g, w, h, "#1aa888", "#0a5a4a");
    g.fillStyle = "#e8c86a";
    g.beginPath();
    g.moveTo(w * 0.58, h * 0.18);
    g.lineTo(w * 0.78, h * 0.5);
    g.lineTo(w * 0.58, h * 0.82);
    g.lineTo(w * 0.38, h * 0.5);
    g.closePath();
    g.fill();
    hoistBar(g, w, h, "#e8c86a");
  },
  lime(g, w, h) {
    g.fillStyle = "#8fd12a";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#c41868";
    g.fillRect(w * 0.42, 0, w * 0.22, h);
    hoistBar(g, w, h, "#f4f0e6");
  },
  tricolor(g, w, h) {
    g.fillStyle = "#1c3a8c";
    g.fillRect(0, 0, w * 0.34, h);
    g.fillStyle = "#f0d24a";
    g.fillRect(w * 0.34, 0, w * 0.32, h);
    g.fillStyle = "#c4142c";
    g.fillRect(w * 0.66, 0, w * 0.34, h);
    hoistBar(g, w, h, "#f4f0e6");
  },
  indigo(g, w, h) {
    g.fillStyle = "#2a1a68";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#d4b15a";
    g.beginPath();
    g.moveTo(w * 0.55, h * 0.16);
    g.lineTo(w * 0.78, h * 0.5);
    g.lineTo(w * 0.55, h * 0.84);
    g.lineTo(w * 0.32, h * 0.5);
    g.closePath();
    g.fill();
    hoistBar(g, w, h, "#d4b15a");
  },
  wave(g, w, h) {
    fillV(g, w, h, "#3ab0c8", "#0c4a68");
    g.fillStyle = "#f4f0e6";
    g.beginPath();
    g.moveTo(0, h * 0.42);
    g.quadraticCurveTo(w * 0.28, h * 0.18, w * 0.52, h * 0.46);
    g.quadraticCurveTo(w * 0.74, h * 0.72, w, h * 0.38);
    g.lineTo(w, h * 0.58);
    g.quadraticCurveTo(w * 0.74, h * 0.88, w * 0.52, h * 0.64);
    g.quadraticCurveTo(w * 0.28, h * 0.38, 0, h * 0.62);
    g.closePath();
    g.fill();
    hoistBar(g, w, h, "#f4f0e6");
  },
  cyan(g, w, h) {
    g.fillStyle = "#14c4c0";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#0a2a3a";
    g.fillRect(0, h * 0.18, w, h * 0.1);
    g.fillRect(0, h * 0.72, w, h * 0.1);
    hoistBar(g, w, h, "#0a2a3a");
  },
};

function fillV(g, w, h, top, bot) {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bot);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}

function chevron(g, w, h, color, x0) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(w * x0, 0);
  g.lineTo(w * (x0 + 0.34), h * 0.5);
  g.lineTo(w * x0, h);
  g.lineTo(w * (x0 - 0.14), h);
  g.lineTo(w * (x0 + 0.2), h * 0.5);
  g.lineTo(w * (x0 - 0.14), 0);
  g.closePath();
  g.fill();
}

/**
 * Weave, hems, and fly-edge wear so the canvas reads as dyed cloth.
 * @param {CanvasRenderingContext2D} g
 * @param {number} w
 * @param {number} h
 */
function finishCloth(g, w, h) {
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const px = (i / 4) % w;
    const py = ((i / 4) / w) | 0;
    const u = px / w;
    const v = py / h;
    const warp = ((px * 19 + py * 3) % 6) - 2.5;
    const weft = ((py * 23 + px * 5) % 6) - 2.5;
    const n = warp * 1.6 + weft * 1.15;
    const hem = v < 0.035 || v > 0.965 ? -18 : 0;
    const fly = u > 0.9 ? -12 * (u - 0.9) * 10 : 0;
    const hoist = u < 0.06 ? -8 : 0;
    d[i] = clampByte(d[i] + n + hem + fly + hoist);
    d[i + 1] = clampByte(d[i + 1] + n + hem + fly + hoist);
    d[i + 2] = clampByte(d[i + 2] + n * 0.92 + hem + fly + hoist);
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = "rgba(20,16,12,0.28)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(w * 0.05, 4);
  g.lineTo(w - 6, 4);
  g.moveTo(w * 0.05, h - 4);
  g.lineTo(w - 6, h - 4);
  g.stroke();
}

function clampByte(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function clothMaterial(kind) {
  const key = FLAG_PAINT[kind] ? kind : "red";
  let m = CLOTH_MAT.get(key);
  if (m) return m;
  const cinema = (VISUAL.tier || 0) >= 8 && VISUAL.realisticArcade !== false;
  m = cinema
    ? new THREE.MeshStandardMaterial({
        map: flagTexture(key),
        roughness: 0.78,
        metalness: 0.0,
        side: THREE.DoubleSide,
        envMapIntensity: 0.34,
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
 * Stable 0..1 hash from plant index + world xz (reproducible, not Math.random sync).
 * @param {number} a
 * @param {number} b
 * @param {number} c
 */
function hash3(a, b, c) {
  const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * @param {object} opts
 * @param {number} opts.x
 * @param {number} opts.y land height
 * @param {number} opts.z
 * @param {number} opts.heading road heading
 * @param {number} opts.side -1 left / +1 right (along nx)
 * @param {string} opts.kind checkers, red, or a desert start-avenue colour
 * @param {string} opts.scenery
 * @param {number} opts.nx
 * @param {number} opts.nz
 * @param {number} [opts.seed] plant index / unique id for independent dynamics
 * @param {number} [opts.phase] optional explicit wind phase (radians)
 * @returns {ClothFlag}
 */
export function createClothFlag(opts) {
  const kind = FLAG_PAINT[opts.kind] ? opts.kind : "red";
  const scenery = opts.scenery || "forest";
  const nx = opts.nx || 0;
  const nz = opts.nz || 1;
  const side = opts.side >= 0 ? 1 : -1;
  const ox = nx * side;
  const oz = nz * side;
  const ry = Math.atan2(-oz, ox);
  const seed = opts.seed != null ? opts.seed : hash3(opts.x || 0, opts.z || 0, side) * 97;
  const h0 = hash3(seed, 1.1, 2.3);
  const h1 = hash3(seed, 4.7, 8.9);
  const h2 = hash3(seed, 13.1, 17.3);
  const h3 = hash3(seed, 19.7, 23.9);
  const phase = opts.phase != null ? opts.phase : h0 * Math.PI * 2;
  const gustPhase = h1 * Math.PI * 2;
  const turbPhase = h2 * Math.PI * 2;
  const windMul = 0.82 + h3 * 0.38;
  const dirBias = (h0 - 0.5) * 0.55;
  const dampMul = 0.96 + h1 * 0.04;

  const group = new THREE.Group();
  group.name = kind === "checkers" ? "cloth-flag-finish" : "cloth-flag-start";
  group.position.set(opts.x, opts.y, opts.z);
  group.rotation.y = ry;
  group.userData.clothFlag = true;
  group.userData.envProp = false;
  group.userData.clothSeed = seed;

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
  // Seeded micro-jitter so warm-up starts from unique rest shapes.
  const jx = (h2 - 0.5) * 0.02;
  const jz = (h3 - 0.5) * 0.028;
  for (let i = 0; i < count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const col = i % COLS;
    const row = (i / COLS) | 0;
    const j = hash3(seed, col + 0.3, row + 0.7);
    cur[i * 3] = x + (col === 0 ? 0 : jx * (j - 0.5));
    cur[i * 3 + 1] = y;
    cur[i * 3 + 2] = z + (col === 0 ? 0 : jz * (j - 0.5));
    prev[i * 3] = cur[i * 3];
    prev[i * 3 + 1] = cur[i * 3 + 1];
    prev[i * 3 + 2] = cur[i * 3 + 2];
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
    seed,
    phase,
    gustPhase,
    turbPhase,
    windMul,
    dirBias,
    dampMul,
  };

  // Unique warm-up clock so neighbours do not share one settled pose.
  const warmT0 = h0 * 2.4;
  for (let i = 0; i < 28; i++) stepCloth(flag, 1 / 60, warmT0 + i / 60, scenery, 1);
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
  const phase = flag.phase || 0;
  const gustPhase = flag.gustPhase || 0;
  const turbPhase = flag.turbPhase || 0;
  const windMul = flag.windMul != null ? flag.windMul : 1;
  const dirBias = flag.dirBias || 0;
  const damp = DAMPING * (flag.dampMul != null ? flag.dampMul : 1);
  const wind = stageWind(scenery, time, { phase, gustPhase, windMul, dirBias });
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
    const fly = col / (COLS - 1);
    const turb =
      0.28 *
      Math.sin(time * 2.35 + col * 0.82 + phase + flag.x * 0.05) *
      Math.sin(time * 1.45 + row * 0.5 + turbPhase + flag.z * 0.04);
    const flap =
      fly * fly * 0.42 * Math.sin(time * 3.6 + col * 1.1 + row * 0.28 + turbPhase);
    const edge = 0.5 + fly * 0.92;
    const vx = (cur[i3] - prev[i3]) * damp;
    const vy = (cur[i3 + 1] - prev[i3 + 1]) * damp;
    const vz = (cur[i3 + 2] - prev[i3 + 2]) * damp;
    prev[i3] = cur[i3];
    prev[i3 + 1] = cur[i3 + 1];
    prev[i3 + 2] = cur[i3 + 2];
    const ax = (lx + turb * lz + flap) * (8.4 * edge);
    const ay = GRAVITY + ly * 2.6 + flap * 1.8;
    const az = (lz + turb + flap * 0.55) * (8.4 * edge);
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
 *   seed: number,
 *   phase: number,
 *   gustPhase: number,
 *   turbPhase: number,
 *   windMul: number,
 *   dirBias: number,
 *   dampMul: number,
 * }} ClothFlag
 */
