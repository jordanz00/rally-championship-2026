/**
 * Saturn art kit — procedural canvas textures and a shared flat-material cache.
 *
 * WHO THIS IS FOR: every graphics module in this project.
 * WHAT IT DOES: paints textures in code (so nothing extra has to download) and
 *   hands out cached, shared materials so a fifteen-car pack plus a full course
 *   does not upload hundreds of near-identical material programs.
 * HOW IT CONNECTS: pbr.js, sky.js, tracks/track.js, tracks/trees.js, cars/celica.js.
 *
 * WHY FLAT SHADING: AM3 shipped full-colour textures on few, large polygons
 *   (docs/AM3-RESEARCH.md section 5). Detail belongs in the texture, not in a
 *   clearcoat lobe, so vertex-lit surfaces are both cheaper and more faithful.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../../vendor/three.module.js";

/** @type {Map<string, THREE.Texture|null>} */
const TEX_CACHE = new Map();
/** @type {Map<string, THREE.Material>} */
const MAT_CACHE = new Map();

/**
 * Stable value hash in [0, 1). Used everywhere a texture needs grain that is
 * identical between reloads (so a course never re-rolls its own look).
 * @param {number} x
 * @param {number} y
 * @param {number} s salt
 * @returns {number}
 */
export function hash2(x, y, s) {
  let n = Math.imul(x + s * 17, 374761393) ^ Math.imul(y + s * 13, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n >>> 0) % 100000) / 100000;
}

/**
 * Deterministic small PRNG so painted detail is reproducible.
 * @param {number} seed
 * @returns {() => number}
 */
export function rng(seed) {
  let s = seed | 0;
  return () => {
    s += 0x6d2b79f5;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Offscreen 2D canvas. Returns null instead of throwing when a browser refuses
 * a context, so every caller can degrade to a flat colour.
 * @param {number} w
 * @param {number} h
 * @returns {{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}|null}
 */
export function makeCanvas(w, h) {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    return { canvas, ctx };
  } catch (err) {
    console.warn("Saturn art: no 2D canvas", err);
    return null;
  }
}

/**
 * Build (or reuse) a painted texture.
 *
 * Every texture handed out here is tagged `userData.shared` so Track.dispose()
 * leaves it alone between championship stages.
 *
 * @param {string} key cache key
 * @param {(ctx: CanvasRenderingContext2D, w: number, h: number) => void} paint
 * @param {{w?:number, h?:number, repeat?:[number,number], nearest?:boolean, srgb?:boolean, mips?:boolean, aniso?:number}} [opts]
 * @returns {THREE.CanvasTexture|null}
 */
export function paintedTexture(key, paint, opts = {}) {
  if (TEX_CACHE.has(key)) return TEX_CACHE.get(key);
  const w = opts.w || 128;
  const h = opts.h || 128;
  let tex = null;
  const surface = makeCanvas(w, h);
  if (surface) {
    try {
      paint(surface.ctx, w, h);
      tex = new THREE.CanvasTexture(surface.canvas);
      tex.colorSpace = opts.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      if (opts.repeat) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(opts.repeat[0], opts.repeat[1]);
      }
      tex.magFilter = opts.nearest ? THREE.NearestFilter : THREE.LinearFilter;
      // Mipmaps matter more than filtering here: a tiling dirt texture without
      // them shimmers into noise at speed, which reads as a frame-rate problem.
      tex.minFilter = opts.mips === false ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = opts.mips !== false;
      if (opts.aniso) tex.anisotropy = opts.aniso;
      tex.needsUpdate = true;
      tex.userData.shared = true;
    } catch (err) {
      console.warn(`Saturn art: texture "${key}" failed`, err);
      tex = null;
    }
  }
  TEX_CACHE.set(key, tex);
  return tex;
}

/**
 * Vertical gradient strip, used for skies and any painted falloff.
 * @param {string} key
 * @param {Array<[number, string]>} stops [position 0..1, css colour]
 * @param {number} [height]
 * @returns {THREE.CanvasTexture|null}
 */
export function gradientTexture(key, stops, height = 256) {
  return paintedTexture(
    key,
    (g, w, h) => {
      const grd = g.createLinearGradient(0, h, 0, 0);
      for (const [t, color] of stops) grd.addColorStop(Math.max(0, Math.min(1, t)), color);
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    },
    { w: 4, h: height, mips: false, srgb: false }
  );
}

/** Material parameters a flat Saturn surface is allowed to carry. */
const FLAT_KEYS = [
  "map",
  "alphaMap",
  "alphaTest",
  "transparent",
  "opacity",
  "side",
  "depthWrite",
  "depthTest",
  "vertexColors",
  "flatShading",
  "fog",
  "emissive",
  "emissiveIntensity",
  "emissiveMap",
  "toneMapped",
  "polygonOffset",
  "polygonOffsetFactor",
  "polygonOffsetUnits",
  "blending",
  "name",
  "envMap",
  "reflectivity",
  "combine",
];

/**
 * Drop PBR-only parameters (roughness, metalness, clearcoat, transmission…)
 * before they reach a Lambert/Phong material, otherwise three.js logs a warning
 * per material and we build hundreds of them.
 * @param {object} extra
 * @returns {object}
 */
export function flatParams(extra = {}) {
  const out = {};
  for (const key of FLAT_KEYS) {
    if (extra[key] !== undefined) out[key] = extra[key];
  }
  return out;
}

/**
 * Cached flat surface. Callers that need to mutate a material at runtime
 * (brake lamps, tinted paint) must build their own instead.
 * @param {string} key
 * @param {() => THREE.Material} make
 * @returns {THREE.Material}
 */
export function sharedMaterial(key, make) {
  const hit = MAT_CACHE.get(key);
  if (hit) return hit;
  const mat = make();
  mat.userData.shared = true;
  MAT_CACHE.set(key, mat);
  return mat;
}

/**
 * Shared vertex-lit surface — the default Saturn material.
 * @param {number} color
 * @param {object} [extra]
 * @returns {THREE.MeshLambertMaterial}
 */
export function sharedFlat(color, extra = {}) {
  const params = flatParams(extra);
  const key = `flat|${color}|${JSON.stringify(params, matReplacer)}`;
  return /** @type {THREE.MeshLambertMaterial} */ (
    sharedMaterial(key, () => new THREE.MeshLambertMaterial({ color, ...params }))
  );
}

/**
 * JSON.stringify cannot serialise textures; key them by uuid instead.
 * @param {string} k
 * @param {unknown} v
 */
function matReplacer(k, v) {
  if (v && typeof v === "object" && /** @type {any} */ (v).isTexture) {
    return /** @type {any} */ (v).uuid;
  }
  return v;
}

/**
 * Warm-to-cool ramp helper for biome tints. Keeps colour separation strong:
 * the research asks for high contrast, not a mushy grey blend.
 * @param {THREE.Color} out
 * @param {number} lowHex
 * @param {number} highHex
 * @param {number} t
 */
export function ramp(out, lowHex, highHex, t) {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  const lr = ((lowHex >> 16) & 255) / 255;
  const lg = ((lowHex >> 8) & 255) / 255;
  const lb = (lowHex & 255) / 255;
  const hr = ((highHex >> 16) & 255) / 255;
  const hg = ((highHex >> 8) & 255) / 255;
  const hb = (highHex & 255) / 255;
  out.setRGB(lr + (hr - lr) * k, lg + (hg - lg) * k, lb + (hb - lb) * k);
  return out;
}

/** Free every cached texture/material. Only for a full teardown. */
export function clearSaturnCache() {
  for (const tex of TEX_CACHE.values()) if (tex) tex.dispose();
  for (const mat of MAT_CACHE.values()) mat.dispose();
  TEX_CACHE.clear();
  MAT_CACHE.clear();
}
