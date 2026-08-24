/**
 * Trackside foliage — painted canopy cards, bark, and contact shadows.
 *
 * WHO THIS IS FOR: Forest, Mountain, and Lakeside scenery.
 * WHAT IT DOES: paints pine / cedar / oak / fern / shrub silhouettes and bark,
 *   then builds three crossed-plane crown geometry so trees read as volume
 *   from every rally-camera angle instead of flipping like a postcard.
 * HOW IT CONNECTS: Track._addScenery() instances these per streaming chunk.
 *
 * WHY MATERIALS ARE CACHED: scenery is split into spline chunks so the
 *   frustum can throw most of it away. foliageMaterial() is called once per
 *   kind *per chunk — dozens of times a stage. One material per kind keeps
 *   shader count flat.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../../vendor/three.module.js";
import { mergeGeometries } from "../../vendor/BufferGeometryUtils.js";
import { VISUAL } from "../config.js?v=126";

/** @type {THREE.BufferGeometry|null} */
let CROWN_GEO = null;
/** @type {THREE.BufferGeometry|null} */
let TRUNK_GEO = null;
/** @type {THREE.BufferGeometry|null} */
let SHADOW_GEO = null;
/** @type {Record<string, THREE.BufferGeometry>} */
const FOLIAGE_GEO = {};
/** @type {Record<string, THREE.CanvasTexture>} */
const FOLIAGE_TEX = {};
/** @type {Record<string, THREE.Material>} */
const FOLIAGE_MAT = {};
/** @type {Record<string, THREE.Material>} */
const SOLID_FOLIAGE_MAT = {};
/** @type {THREE.CanvasTexture|null} */
let BARK_TEX = null;
/** @type {THREE.Material|null} */
let BARK_MAT = null;
/** @type {THREE.Material|null} */
let SHADOW_MAT = null;

const FOLIAGE_SEG = VISUAL.realisticArcade ? 12 : 9;
const FOLIAGE_SEG_SIDE = VISUAL.realisticArcade ? 10 : 7;
const TRUNK_SEG = VISUAL.realisticArcade ? 8 : 6;

/**
 * Three vertical cards at 120° — enough volume for close passes without the
 * fourth plane most billboard forests pay for.
 * @returns {THREE.BufferGeometry}
 */
export function crownGeometry() {
  if (CROWN_GEO) return CROWN_GEO;
  const planes = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.rotateY((i * Math.PI * 2) / 3);
    planes.push(g);
  }
  CROWN_GEO = mergeGeometries(planes, false);
  CROWN_GEO.computeVertexNormals();
  CROWN_GEO.userData.shared = true;
  return CROWN_GEO;
}

/**
 * Fuller 3D canopy for close forest reads. Cards are fast, but the Stage 2 ask
 * is specifically "stop looking low poly", so Forest swaps to merged primitive
 * crowns that keep actual silhouette from every angle.
 * @param {"pine"|"cedar"|"oak"|"shrub"|"autumn"|"autumnGold"} kind
 * @returns {THREE.BufferGeometry}
 */
export function foliageGeometry(kind) {
  if (FOLIAGE_GEO[kind]) return FOLIAGE_GEO[kind];
  const parts = [];
  if (kind === "pine" || kind === "cedar") {
    const tiers = kind === "cedar" ? 8 : 7;
    const topY = kind === "cedar" ? 0.16 : 0.1;
    for (let i = 0; i < tiers; i++) {
      const t = i / Math.max(1, tiers - 1);
      const radius = kind === "cedar" ? 0.2 + Math.sin(t * Math.PI) * 0.22 : 0.12 + t * 0.34;
      const height = kind === "cedar" ? 0.18 + (1 - t) * 0.06 : 0.16 + (1 - t) * 0.08;
      const y = topY + t * 0.72;
      const cone = new THREE.ConeGeometry(radius, height, FOLIAGE_SEG, 1);
      cone.translate(0, y, 0);
      parts.push(cone);
      if (kind === "pine" && i < tiers - 1) {
        const side = new THREE.ConeGeometry(radius * 0.52, height * 0.58, FOLIAGE_SEG_SIDE, 1);
        side.rotateZ(0.3);
        side.translate(radius * 0.22, y + height * 0.05, 0);
        parts.push(side);
        const side2 = new THREE.ConeGeometry(radius * 0.48, height * 0.54, FOLIAGE_SEG_SIDE, 1);
        side2.rotateZ(-0.28);
        side2.translate(-radius * 0.2, y + height * 0.02, 0);
        parts.push(side2);
      }
    }
  } else {
    const clumpColorless = [
      [-0.18, 0.48, 0.02, 0.28],
      [0.18, 0.46, -0.06, 0.26],
      [0, 0.58, 0.16, 0.3],
      [-0.04, 0.7, -0.12, 0.25],
      [0.12, 0.74, 0.1, 0.23],
      [-0.14, 0.66, -0.18, 0.22],
    ];
    for (let i = 0; i < clumpColorless.length; i++) {
      const [x, y, z, r] = clumpColorless[i];
      const blob = new THREE.IcosahedronGeometry(r, kind === "shrub" ? 1 : 2);
      blob.translate(x, y, z);
      parts.push(blob);
    }
    const branch = new THREE.CylinderGeometry(0.04, 0.06, 0.42, TRUNK_SEG);
    branch.rotateZ(0.55);
    branch.translate(-0.12, 0.42, -0.02);
    parts.push(branch);
    const branch2 = new THREE.CylinderGeometry(0.035, 0.05, 0.36, TRUNK_SEG);
    branch2.rotateZ(-0.46);
    branch2.translate(0.12, 0.5, 0.04);
    parts.push(branch2);
  }
  // Some primitives ship UV, some don't; some are indexed, some aren't.
  // Rebuild to a uniform non-indexed position/normal/uv set before merge.
  for (let i = 0; i < parts.length; i++) {
    parts[i] = mergeReadyFoliage(parts[i]);
  }
  const geo = mergeGeometries(parts, false);
  if (!geo) {
    const fallback = crownGeometry().clone();
    fallback.userData.shared = true;
    FOLIAGE_GEO[kind] = fallback;
    return fallback;
  }
  geo.computeVertexNormals();
  geo.userData.shared = true;
  FOLIAGE_GEO[kind] = geo;
  return geo;
}

/**
 * @param {THREE.BufferGeometry} geo
 * @returns {THREE.BufferGeometry}
 */
function mergeReadyFoliage(geo) {
  const flat = geo.toNonIndexed();
  const pos = flat.getAttribute("position");
  const out = new THREE.BufferGeometry();
  if (pos) {
    if (pos.isInterleavedBufferAttribute) {
      const arr = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        arr[i * 3] = pos.getX(i);
        arr[i * 3 + 1] = pos.getY(i);
        arr[i * 3 + 2] = pos.getZ(i);
      }
      out.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
    } else {
      out.setAttribute("position", pos.clone());
    }
  }
  out.computeVertexNormals();
  const count = out.getAttribute("position")?.count || 0;
  const uv = new Float32Array(count * 2);
  const p = out.getAttribute("position");
  for (let i = 0; i < count; i++) {
    uv[i * 2] = p.getX(i) * 0.85 + 0.5;
    uv[i * 2 + 1] = p.getY(i) * 0.85 + 0.15;
  }
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  if (flat !== geo) flat.dispose();
  return out;
}

/**
 * @param {THREE.BufferGeometry} geo
 */
function ensureFoliageUv(geo) {
  if (geo.getAttribute("uv")) return;
  const pos = geo.getAttribute("position");
  if (!pos) return;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * 0.85 + 0.5;
    uv[i * 2 + 1] = pos.getY(i) * 0.85 + 0.15;
  }
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
}

/**
 * Tapered trunk in local Y. Scale sy to height, sx/sz to radius.
 * @returns {THREE.BufferGeometry}
 */
export function trunkGeometry() {
  if (TRUNK_GEO) return TRUNK_GEO;
  TRUNK_GEO = new THREE.CylinderGeometry(0.16, 0.28, 1, TRUNK_SEG, 1, true);
  TRUNK_GEO.userData.shared = true;
  return TRUNK_GEO;
}

/**
 * Ground contact blob — flattened on XZ. More segments = softer silhouette.
 * @returns {THREE.BufferGeometry}
 */
export function shadowGeometry() {
  if (SHADOW_GEO) return SHADOW_GEO;
  SHADOW_GEO = new THREE.CircleGeometry(1, 24);
  SHADOW_GEO.rotateX(-Math.PI / 2);
  SHADOW_GEO.userData.shared = true;
  return SHADOW_GEO;
}

/** @type {THREE.CanvasTexture|null} */
let SOFT_SHADOW_TEX = null;

/**
 * Soft radial alpha for contact discs — kills hard circle edges and z-fight flash.
 * @returns {THREE.CanvasTexture}
 */
export function softShadowTexture() {
  if (SOFT_SHADOW_TEX) return SOFT_SHADOW_TEX;
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size * 0.5, size * 0.5, 0, size * 0.5, size * 0.5, size * 0.5);
  g.addColorStop(0, "rgba(0,0,0,0.92)");
  g.addColorStop(0.35, "rgba(0,0,0,0.55)");
  g.addColorStop(0.7, "rgba(0,0,0,0.18)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  SOFT_SHADOW_TEX = new THREE.CanvasTexture(c);
  SOFT_SHADOW_TEX.colorSpace = THREE.NoColorSpace;
  SOFT_SHADOW_TEX.needsUpdate = true;
  SOFT_SHADOW_TEX.userData.shared = true;
  return SOFT_SHADOW_TEX;
}

/**
 * Soft contact shadow under cars — separate from tree discs so we can tune opacity.
 * @returns {THREE.MeshBasicMaterial}
 */
export function carShadowMaterial() {
  const map = softShadowTexture();
  const mat = new THREE.MeshBasicMaterial({
    map,
    color: 0x1c1610,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    depthTest: true,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    side: THREE.DoubleSide,
  });
  mat.userData.carShadow = true;
  return mat;
}

/**
 * @param {"pine"|"cedar"|"oak"|"shrub"|"fern"|"autumn"|"autumnGold"|"acacia"} kind
 * @returns {THREE.MeshLambertMaterial}
 */
export function foliageMaterial(kind) {
  if (FOLIAGE_MAT[kind]) return FOLIAGE_MAT[kind];
  const map = foliageTexture(kind);
  let mat;
  if (VISUAL.realisticArcade) {
    mat = new THREE.MeshStandardMaterial({
      map: map || null,
      color: map ? 0xffffff : 0x2f6a28,
      alphaTest: 0.42,
      roughness: 0.92,
      metalness: 0,
      envMapIntensity: (VISUAL.tier || 0) >= 3 ? 0.16 : 0.12,
      side: THREE.DoubleSide,
      fog: true,
      flatShading: false,
    });
  } else {
    mat = new THREE.MeshLambertMaterial({
      map: map || null,
      color: map ? 0xffffff : 0x2f6a28,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      fog: true,
    });
  }
  mat.userData.shared = true;
  FOLIAGE_MAT[kind] = mat;
  return mat;
}

/**
 * Forest close-up material: solid shaded foliage reads far better on 3D crowns
 * than leaf-card textures stretched across cones and blobs.
 * @param {"pine"|"cedar"|"oak"|"shrub"|"autumn"|"autumnGold"} kind
 * @returns {THREE.MeshLambertMaterial}
 */
export function solidFoliageMaterial(kind) {
  if (SOLID_FOLIAGE_MAT[kind]) return SOLID_FOLIAGE_MAT[kind];
  const color =
    kind === "pine"
      ? 0x365f26
        : kind === "cedar"
          ? 0x4d7c38
        : kind === "autumn"
          ? 0x9c5620
          : kind === "autumnGold"
            ? 0xcc9830
            : kind === "shrub"
              ? 0x426828
              : 0x567634;
  const mat = VISUAL.realisticArcade
    ? new THREE.MeshStandardMaterial({
        color,
        roughness: 0.9,
        metalness: 0,
        envMapIntensity: (VISUAL.tier || 0) >= 3 ? 0.18 : 0.14,
        flatShading: false,
        fog: true,
      })
    : new THREE.MeshLambertMaterial({ color, flatShading: false, fog: true });
  mat.userData.shared = true;
  SOLID_FOLIAGE_MAT[kind] = mat;
  return mat;
}

/** @returns {THREE.MeshLambertMaterial} */
export function barkMaterial() {
  if (BARK_MAT) return BARK_MAT;
  const map = barkTexture();
  BARK_MAT = VISUAL.realisticArcade
    ? new THREE.MeshStandardMaterial({
        map: map || null,
        color: map ? 0xffffff : 0x4a3318,
        roughness: 0.94,
        metalness: 0,
        envMapIntensity: 0.1,
        flatShading: false,
        fog: true,
      })
    : new THREE.MeshLambertMaterial({
        map: map || null,
        color: map ? 0xffffff : 0x4a3318,
        fog: true,
      });
  BARK_MAT.userData.shared = true;
  return BARK_MAT;
}

/** @type {THREE.MeshLambertMaterial|null} */
let SHADOW_MAT_T5 = null;

/** @returns {THREE.MeshLambertMaterial} */
export function shadowMaterial() {
  const tier5 = (VISUAL.tier || 0) >= 5 && VISUAL.contactShadowBoost !== false;
  if (tier5) {
    if (SHADOW_MAT_T5) return SHADOW_MAT_T5;
    SHADOW_MAT_T5 = new THREE.MeshLambertMaterial({
      color: 0x0a0806,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    SHADOW_MAT_T5.userData.shared = true;
    return SHADOW_MAT_T5;
  }
  if (SHADOW_MAT) return SHADOW_MAT;
  SHADOW_MAT = new THREE.MeshLambertMaterial({
    color: 0x120e08,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  SHADOW_MAT.userData.shared = true;
  return SHADOW_MAT;
}

/**
 * @param {string} kind
 * @returns {THREE.CanvasTexture|null}
 */
function foliageTexture(kind) {
  if (FOLIAGE_TEX[kind] !== undefined) return FOLIAGE_TEX[kind];
  let tex = null;
  try {
    const w = 256;
    const h = kind === "shrub" || kind === "fern" ? 256 : 512;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2D context");
    g.clearRect(0, 0, w, h);
    if (kind === "pine") paintPine(g, w, h);
    else if (kind === "cedar") paintCedar(g, w, h);
    else if (kind === "shrub") paintShrub(g, w, h);
    else if (kind === "fern") paintFern(g, w, h);
    else if (kind === "autumn") paintOak(g, w, h, AUTUMN_RUST);
    else if (kind === "autumnGold") paintOak(g, w, h, AUTUMN_GOLD);
    else if (kind === "acacia") paintAcacia(g, w, h);
    else paintOak(g, w, h, SUMMER_GREEN);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 16;
    tex.premultiplyAlpha = false;
    tex.needsUpdate = true;
    tex.userData.shared = true;
  } catch (err) {
    console.warn(`Foliage texture "${kind}" failed`, err);
    tex = null;
  }
  FOLIAGE_TEX[kind] = tex;
  return tex;
}

function barkTexture() {
  if (BARK_TEX !== null) return BARK_TEX;
  try {
    const w = 96;
    const h = 192;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2D context");
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = hash2(x, y, 3);
        const n2 = hash2(x >> 1, y, 9);
        const furrow = Math.abs(Math.sin(x * 0.55 + y * 0.035 + n2 * 3));
        const mossBand = Math.max(0, 1 - y / (h * 0.32));
        const lichen = hash2(x, y, 17) > 0.92 ? 0.18 : 0;
        const i = (y * w + x) * 4;
        d[i] = 58 + n * 28 + furrow * 26 + mossBand * 14 + lichen * 40;
        d[i + 1] = 40 + n * 14 + furrow * 12 + mossBand * 34 + lichen * 38;
        d[i + 2] = 24 + n * 8 + mossBand * 8 + lichen * 22;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    for (let k = 0; k < 18; k++) {
      const x = 8 + hash2(k, 2, 1) * (w - 16);
      const y = 16 + hash2(k, 5, 2) * (h - 32);
      g.fillStyle = `rgba(22,16,10,${0.22 + hash2(k, 1, 4) * 0.35})`;
      g.beginPath();
      g.ellipse(x, y, 1.5 + hash2(k, 3, 6) * 2.5, 5 + hash2(k, 7, 8) * 10, 0, 0, Math.PI * 2);
      g.fill();
    }
    for (let k = 0; k < 8; k++) {
      const x = 10 + hash2(k, 11, 5) * (w - 20);
      const y = h * 0.08 + hash2(k, 13, 7) * (h * 0.22);
      g.fillStyle = `rgba(48,62,32,${0.35 + hash2(k, 19, 3) * 0.3})`;
      g.beginPath();
      g.ellipse(x, y, 4 + hash2(k, 23, 9) * 6, 3 + hash2(k, 29, 11) * 4, 0, 0, Math.PI * 2);
      g.fill();
    }
    BARK_TEX = new THREE.CanvasTexture(c);
    BARK_TEX.colorSpace = THREE.SRGBColorSpace;
    BARK_TEX.wrapS = THREE.RepeatWrapping;
    BARK_TEX.wrapT = THREE.RepeatWrapping;
    BARK_TEX.repeat.set(1, 2.2);
    BARK_TEX.needsUpdate = true;
    BARK_TEX.userData.shared = true;
  } catch (err) {
    console.warn("Bark texture failed", err);
    BARK_TEX = null;
  }
  return BARK_TEX;
}

function hash2(x, y, s) {
  let n = Math.imul(x + s * 17, 374761393) ^ Math.imul(y + s * 13, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n >>> 0) % 10000) / 10000;
}

function rngAt(seed) {
  let s = seed | 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUMMER_GREEN = ["#142a10", "#2e5018", "#5a8430"];
const AUTUMN_RUST = ["#4a2410", "#8a4416", "#c47420"];
const AUTUMN_GOLD = ["#5a3a0e", "#a8761a", "#e0b03a"];

/**
 * European rally conifer — layered whorls, needle stipple, trunk read at base.
 */
function paintPine(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.moveTo(w * 0.5, h * 0.01);
  g.lineTo(w * 0.04, h * 0.99);
  g.lineTo(w * 0.96, h * 0.99);
  g.closePath();
  g.clip();
  g.fillStyle = "#0a1608";
  g.fillRect(0, 0, w, h);

  const layers = 11;
  for (let i = 0; i < layers; i++) {
    const t = i / (layers - 1);
    const y = h * (0.06 + t * 0.88);
    const half = w * (0.06 + t * 0.44);
    const thick = h * (0.055 + (1 - t) * 0.02);
    whorl(g, w * 0.5, y, half, thick, "#0c1e0a", "#224818", "#4a7830", "#6a9838");
    if (i > 0 && i < layers - 1) {
      whorl(g, w * 0.5 - half * 0.38, y + thick * 0.35, half * 0.48, thick * 0.62, "#0a1a08", "#1e4014", "#3a6828", "#588830");
      whorl(g, w * 0.5 + half * 0.36, y + thick * 0.42, half * 0.46, thick * 0.58, "#0c200a", "#224818", "#427028", "#609838");
    }
  }

  g.fillStyle = "#2a1a0c";
  g.fillRect(w * 0.46, h * 0.82, w * 0.08, h * 0.18);
  g.fillStyle = "#3a2814";
  g.fillRect(w * 0.47, h * 0.84, w * 0.06, h * 0.14);
  needleField(g, w, h, 0.08, 0.98, 0.14, "#1a3810");
  g.restore();
}

/** Tall narrow cedar — drooping side sprays, darker interior. */
function paintCedar(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.moveTo(w * 0.5, h * 0.01);
  g.quadraticCurveTo(w * 0.14, h * 0.38, w * 0.12, h * 0.99);
  g.lineTo(w * 0.88, h * 0.99);
  g.quadraticCurveTo(w * 0.86, h * 0.38, w * 0.5, h * 0.01);
  g.closePath();
  g.clip();
  g.fillStyle = "#081408";
  g.fillRect(0, 0, w, h);

  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const y = h * (0.05 + t * 0.9);
    const half = w * (0.08 + Math.sin(t * Math.PI) * 0.2);
    const thick = h * 0.048;
    whorl(g, w * 0.5, y, half, thick, "#081408", "#183410", "#305824", "#487030");
    const droop = half * 0.72;
    spray(g, w * 0.5 - droop * 0.55, y + thick * 1.4, droop * 0.55, thick * 1.8, "#0a180a", "#1c3814", "#345020");
    spray(g, w * 0.5 + droop * 0.52, y + thick * 1.5, droop * 0.52, thick * 1.7, "#0a1a0c", "#1e3a16", "#365422");
  }
  needleField(g, w, h, 0.06, 0.96, 0.1, "#142c0c");
  g.restore();
}

/**
 * Broadleaf canopy — lobed masses, branch forks, sun/shade separation.
 * @param {CanvasRenderingContext2D} g
 * @param {number} w
 * @param {number} h
 * @param {string[]} palette dark / mid / light
 */
function paintOak(g, w, h, palette) {
  const r = rngAt(3319);
  g.clearRect(0, 0, w, h);
  g.save();
  cloudPath(g, w, h, r);
  g.clip();
  g.fillStyle = palette[0];
  g.fillRect(0, 0, w, h);

  g.strokeStyle = "rgba(38,24,12,0.82)";
  g.lineWidth = 5;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(w * 0.5, h * 0.96);
  g.quadraticCurveTo(w * 0.47, h * 0.62, w * 0.32, h * 0.38);
  g.moveTo(w * 0.5, h * 0.74);
  g.quadraticCurveTo(w * 0.6, h * 0.52, w * 0.72, h * 0.34);
  g.moveTo(w * 0.5, h * 0.58);
  g.lineTo(w * 0.38, h * 0.42);
  g.stroke();

  for (let i = 0; i < 24; i++) {
    const lx = w * (0.18 + r() * 0.64);
    const ly = h * (0.12 + r() * 0.72);
    const rx = w * (0.11 + r() * 0.14);
    const ry = h * (0.07 + r() * 0.09);
    leafMass(g, lx, ly, rx, ry, palette[0], palette[1], palette[2]);
  }
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.08})`;
    g.beginPath();
    g.ellipse(w * (0.2 + r() * 0.6), h * (0.3 + r() * 0.55), w * 0.06, h * 0.04, r() * 0.5, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Flat-topped acacia for Safari gallery. */
function paintAcacia(g, w, h) {
  const r = rngAt(5527);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = "#4a3a22";
  g.lineWidth = 8;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(w * 0.5, h);
  g.lineTo(w * 0.5, h * 0.5);
  g.moveTo(w * 0.5, h * 0.58);
  g.lineTo(w * 0.22, h * 0.4);
  g.moveTo(w * 0.5, h * 0.6);
  g.lineTo(w * 0.78, h * 0.42);
  g.stroke();
  g.save();
  g.beginPath();
  g.ellipse(w * 0.5, h * 0.32, w * 0.48, h * 0.2, 0, 0, Math.PI * 2);
  g.ellipse(w * 0.28, h * 0.38, w * 0.25, h * 0.12, 0, 0, Math.PI * 2);
  g.ellipse(w * 0.74, h * 0.38, w * 0.23, h * 0.11, 0, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = "#283c16";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 18; i++) {
    leafMass(g, w * (0.08 + r() * 0.84), h * (0.2 + r() * 0.24), w * (0.1 + r() * 0.1), h * (0.04 + r() * 0.04), "#243814", "#446028", "#789840");
  }
  g.restore();
}

/** Low bush mound for verge clutter. */
function paintShrub(g, w, h) {
  const r = rngAt(4421);
  g.clearRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.ellipse(w * 0.5, h * 0.64, w * 0.48, h * 0.34, 0, 0, Math.PI * 2);
  g.ellipse(w * 0.3, h * 0.56, w * 0.3, h * 0.28, 0, 0, Math.PI * 2);
  g.ellipse(w * 0.72, h * 0.57, w * 0.28, h * 0.27, 0, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = "#162810";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 16; i++) {
    leafMass(g, w * (0.18 + r() * 0.64), h * (0.38 + r() * 0.44), w * (0.12 + r() * 0.12), h * (0.08 + r() * 0.08), "#1a3012", "#345020", "#5a7830");
  }
  g.restore();
}

/** Forest-floor fern fronds — understory between trunks. */
function paintFern(g, w, h) {
  const r = rngAt(7711);
  g.clearRect(0, 0, w, h);
  const fronds = 7 + ((r() * 4) | 0);
  for (let i = 0; i < fronds; i++) {
    const ang = -Math.PI * 0.5 + (i / (fronds - 1 || 1)) * Math.PI - 0.35 + (r() - 0.5) * 0.4;
    const len = h * (0.38 + r() * 0.28);
    const cx = w * 0.5;
    const cy = h * 0.88;
    const ex = cx + Math.cos(ang) * len;
    const ey = cy + Math.sin(ang) * len;
    const cpX = cx + Math.cos(ang) * len * 0.45 + (r() - 0.5) * w * 0.08;
    const cpY = cy + Math.sin(ang) * len * 0.45 - h * 0.06;
    g.strokeStyle = "#1a3810";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx, cy);
    g.quadraticCurveTo(cpX, cpY, ex, ey);
    g.stroke();
    const steps = 10 + ((r() * 6) | 0);
    for (let j = 1; j <= steps; j++) {
      const t = j / steps;
      const bx = cx + (ex - cx) * t * 0.92 + (cpX - cx) * t * (1 - t) * 2;
      const by = cy + (ey - cy) * t * 0.92 + (cpY - cy) * t * (1 - t) * 2;
      const leafW = w * (0.04 + (1 - t) * 0.06);
      const leafH = h * 0.028;
      g.fillStyle = j % 2 ? "#2a5018" : "#3a6828";
      g.beginPath();
      g.ellipse(bx - leafW * 0.55, by, leafW, leafH, ang - 0.4, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.ellipse(bx + leafW * 0.55, by, leafW * 0.9, leafH * 0.85, ang + 0.4, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function cloudPath(g, w, h, r) {
  g.beginPath();
  g.ellipse(w * 0.5, h * 0.48, w * 0.4, h * 0.38, 0, 0, Math.PI * 2);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + r() * 0.25;
    const x = w * 0.5 + Math.cos(a) * w * 0.28;
    const y = h * 0.48 + Math.sin(a) * h * 0.3;
    g.ellipse(x, y, w * (0.12 + r() * 0.1), h * (0.1 + r() * 0.1), a, 0, Math.PI * 2);
  }
}

/** Conifer branch whorl — tapered ellipse stack. */
function whorl(g, x, y, rx, ry, dark, mid, light, tip) {
  const grd = g.createRadialGradient(x - rx * 0.28, y - ry * 0.42, 0, x, y, Math.max(rx, ry));
  grd.addColorStop(0, tip || light);
  grd.addColorStop(0.35, light);
  grd.addColorStop(0.68, mid);
  grd.addColorStop(1, dark);
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

/** Drooping cedar spray hanging below a whorl. */
function spray(g, x, y, rx, ry, dark, mid, light) {
  const grd = g.createRadialGradient(x, y - ry * 0.2, 0, x, y + ry * 0.3, Math.max(rx, ry));
  grd.addColorStop(0, light);
  grd.addColorStop(0.5, mid);
  grd.addColorStop(1, dark);
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0.15, 0, Math.PI * 2);
  g.fill();
}

/** Broadleaf lobe with directional light. */
function leafMass(g, x, y, rx, ry, dark, mid, light) {
  const grd = g.createRadialGradient(x - rx * 0.32, y - ry * 0.4, 0, x, y, Math.max(rx, ry));
  grd.addColorStop(0, light);
  grd.addColorStop(0.45, mid);
  grd.addColorStop(1, dark);
  g.fillStyle = grd;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

/** Fine needle stipple inside the silhouette — reads as texture at speed. */
function needleField(g, w, h, y0, y1, density, color) {
  const r = rngAt(9021);
  const n = (w * h * density * 0.00035) | 0;
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = r() * w;
    const y = h * (y0 + r() * (y1 - y0));
    const s = 0.6 + r() * 1.4;
    g.fillRect(x, y, s, s * 2.2);
  }
}
