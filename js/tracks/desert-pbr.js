/**
 * Desert photoreal PBR — Poly Haven 1k sand / dirt / gravel / tarmac.
 *
 * WHO THIS IS FOR: Track.buildAsync on the Desert stage.
 * WHAT IT DOES: tiled albedo + normal + roughness + AO for the driving ribbon
 *   and land plane. World-XZ projection still lives in pbr.js.
 * HOW IT CONNECTS: track.js awaits prepareDesertPbr() before _buildMesh.
 *   Forest keeps forest-pbr.js. Node QA skips the Image load.
 */

import * as THREE from "../../vendor/three.module.js";

const ASSET_V = "1";
const BASE = "assets/env/desert";

const TILE_SAND_M = 8.0;
const TILE_DIRT_M = 2.2;
const TILE_GRAVEL_M = 6.0;
const TILE_TARMAC_M = 4.0;

let prepared = false;
/** @type {{map:THREE.Texture, normalMap:THREE.Texture|null, roughnessMap:THREE.Texture|null, aoMap:THREE.Texture|null, tileMeters:number}|null} */
let sandSet = null;
/** @type {typeof sandSet} */
let dirtSet = null;
/** @type {typeof sandSet} */
let gravelSet = null;
/** @type {typeof sandSet} */
let tarmacSet = null;

/**
 * @param {THREE.Texture|null} tex
 * @param {number} rx
 * @param {number} ry
 * @returns {THREE.Texture|null}
 */
export function cloneDesertMap(tex, rx, ry) {
  if (!tex) return null;
  const copy = tex.clone();
  copy.wrapS = THREE.RepeatWrapping;
  copy.wrapT = THREE.RepeatWrapping;
  copy.repeat.set(rx, ry);
  copy.needsUpdate = true;
  return copy;
}

/**
 * @param {number} span
 * @param {number} [tileMeters]
 * @returns {number}
 */
export function desertLandRepeat(span, tileMeters = TILE_SAND_M) {
  return Math.max(6, span / Math.max(0.5, tileMeters));
}

/**
 * @param {number} vScale
 * @param {number} [tileMeters]
 * @param {number} [roadWidthM]
 * @returns {{x:number,y:number}}
 */
export function desertRoadRepeat(vScale, tileMeters = TILE_DIRT_M, roadWidthM = 17.4) {
  const tile = Math.max(0.5, tileMeters);
  const metersPerV = 1 / Math.max(0.02, vScale);
  return { x: roadWidthM / tile, y: metersPerV / tile };
}

/**
 * @returns {Promise<void>}
 */
export async function prepareDesertPbr() {
  if (prepared) return;
  prepared = true;
  if (typeof document === "undefined" || typeof Image === "undefined") return;

  const loader = new THREE.TextureLoader();
  sandSet = await loadSet(loader, "sand", TILE_SAND_M);
  dirtSet = await loadSet(loader, "dirt", TILE_DIRT_M);
  gravelSet = await loadSet(loader, "gravel", TILE_GRAVEL_M);
  tarmacSet = await loadSet(loader, "tarmac", TILE_TARMAC_M);
}

/**
 * @returns {boolean}
 */
export function desertPbrReady() {
  return !!(sandSet && sandSet.map);
}

/**
 * @param {string} surfaceId
 * @returns {typeof sandSet}
 */
export function desertRoadMaps(surfaceId) {
  if (surfaceId === "tarmac") return tarmacSet || dirtSet;
  if (surfaceId === "gravel") return gravelSet || dirtSet;
  if (surfaceId === "sand") return sandSet || dirtSet;
  return dirtSet;
}

/**
 * Desert land / skirt — aerial sand.
 * @returns {typeof sandSet}
 */
export function desertLandMaps() {
  return sandSet;
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
