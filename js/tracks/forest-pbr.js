/**
 * Forest photogrammetry PBR — Poly Haven 1k dirt / gravel / forest floor.
 *
 * WHO THIS IS FOR: Track.buildAsync on the Forest stage only.
 * WHAT IT DOES: loads tiled albedo + normal + roughness + AO for the driving
 *   ribbon and land plane. Procedural code still decides *where* the road is;
 *   these maps replace canvas grain as the close-range material.
 * HOW IT CONNECTS: track.js awaits prepareForestPbr() before _buildMesh.
 *   Other stages keep painted textures. Node QA skips the Image load.
 *
 * Tile scale is the authored Poly Haven metre size (~2 m), not span/15.
 * That is the anti-stretch rule: a 15 m repeat of a 2 m photo reads fake.
 */

import * as THREE from "../../vendor/three.module.js";

const ASSET_V = "1";
const BASE = "assets/env/forest";

/** Authored tile size in metres (Poly Haven 1k sets are ~2–2.1 m). */
const TILE_DIRT_M = 2.0;
const TILE_GRAVEL_M = 2.0;
const TILE_FLOOR_M = 2.1;

let prepared = false;
/** @type {{map:THREE.Texture, normalMap:THREE.Texture|null, roughnessMap:THREE.Texture|null, aoMap:THREE.Texture|null, tileMeters:number}|null} */
let dirtSet = null;
/** @type {typeof dirtSet} */
let gravelSet = null;
/** @type {typeof dirtSet} */
let landSet = null;

/**
 * Clone a shared GPU texture so each material can set its own repeat.
 * @param {THREE.Texture|null} tex
 * @param {number} rx
 * @param {number} ry
 * @returns {THREE.Texture|null}
 */
export function cloneForestMap(tex, rx, ry) {
  if (!tex) return null;
  const copy = tex.clone();
  copy.wrapS = THREE.RepeatWrapping;
  copy.wrapT = THREE.RepeatWrapping;
  copy.repeat.set(rx, ry);
  copy.needsUpdate = true;
  return copy;
}

/**
 * Land / skirt UV repeats for a heightmap tile of `span` metres.
 * @param {number} span
 * @param {number} [tileMeters]
 * @returns {number}
 */
export function forestLandRepeat(span, tileMeters = TILE_FLOOR_M) {
  return Math.max(8, span / Math.max(0.5, tileMeters));
}

/**
 * Ribbon UV repeats: u spans road width once, v is dist * ROAD_UV_SCALE.
 * @param {number} vScale ROAD_UV_SCALE[id]
 * @param {number} [tileMeters]
 * @param {number} [roadWidthM]
 * @returns {{x:number,y:number}}
 */
export function forestRoadRepeat(vScale, tileMeters = TILE_DIRT_M, roadWidthM = 17.4) {
  const tile = Math.max(0.5, tileMeters);
  const metersPerV = 1 / Math.max(0.02, vScale);
  return { x: roadWidthM / tile, y: metersPerV / tile };
}

/**
 * Load Forest 1k PBR sets. Safe to call more than once. No-ops in Node.
 * @returns {Promise<void>}
 */
export async function prepareForestPbr() {
  if (prepared) return;
  prepared = true;
  if (typeof document === "undefined" || typeof Image === "undefined") return;

  const loader = new THREE.TextureLoader();
  dirtSet = await loadSet(loader, "dirt_floor", TILE_DIRT_M);
  gravelSet = await loadSet(loader, "gravel_road", TILE_GRAVEL_M);
  landSet = await loadSet(loader, "forest_floor", TILE_FLOOR_M);
}

/**
 * True once at least the dirt albedo is on the GPU.
 * @returns {boolean}
 */
export function forestPbrReady() {
  return !!(dirtSet && dirtSet.map);
}

/**
 * Dirt / gravel / mud Forest ribbon maps. Null if not loaded.
 * @param {string} surfaceId
 * @returns {typeof dirtSet}
 */
export function forestRoadMaps(surfaceId) {
  if (surfaceId === "gravel") return gravelSet || dirtSet;
  return dirtSet;
}

/**
 * Forest land / skirt maps.
 * @returns {typeof landSet}
 */
export function forestLandMaps() {
  return landSet;
}

/**
 * @param {THREE.TextureLoader} loader
 * @param {string} stem
 * @param {number} tileMeters
 */
async function loadSet(loader, stem, tileMeters) {
  const map = await loadTex(loader, `${BASE}/${stem}_diff_1k.jpg`, true);
  if (!map) return null;
  const normalMap = await loadTex(loader, `${BASE}/${stem}_nor_gl_1k.jpg`, false);
  const roughnessMap = await loadTex(loader, `${BASE}/${stem}_rough_1k.jpg`, false);
  const aoMap = await loadTex(loader, `${BASE}/${stem}_ao_1k.jpg`, false);
  return { map, normalMap, roughnessMap, aoMap, tileMeters };
}

/**
 * @param {THREE.TextureLoader} loader
 * @param {string} url
 * @param {boolean} srgb
 * @returns {Promise<THREE.Texture|null>}
 */
function loadTex(loader, url, srgb) {
  const href = `${url}?v=${ASSET_V}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (tex) => {
      if (settled) return;
      settled = true;
      resolve(tex);
    };
    const timer = setTimeout(() => finish(null), 14000);
    loader.load(
      href,
      (tex) => {
        clearTimeout(timer);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = 4;
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.needsUpdate = true;
        finish(tex);
      },
      undefined,
      () => {
        clearTimeout(timer);
        finish(null);
      }
    );
  });
}
