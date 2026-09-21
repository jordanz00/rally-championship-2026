/**
 * Desert photoreal PBR — Poly Haven 1k boot, 2k stream.
 *
 * WHO THIS IS FOR: Track.buildAsync on the Desert stage.
 * WHAT IT DOES: tiled albedo + normal + roughness for the driving ribbon
 *   and land plane. World-XZ projection still lives in pbr.js.
 * HOW IT CONNECTS: track.js awaits prepareDesertPbr() before _buildMesh
 *   (1k color only). Normals / 2k swap in on the shared texture Source.
 */

import * as THREE from "../../vendor/three.module.js";
import { bootPbrSet, cloneTracked } from "./pbr-stream.js?v=4";

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
  return cloneTracked(tex, rx, ry);
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
 * Boot 1k albedo only. Detail / 2k continue in the background.
 * @returns {Promise<void>}
 */
export async function prepareDesertPbr() {
  if (prepared) return;
  prepared = true;
  if (typeof document === "undefined" || typeof Image === "undefined") return;

  const loader = new THREE.TextureLoader();
  const [sand, dirt, gravel, tarmac] = await Promise.all([
    bootPbrSet(loader, { base: BASE, stem: "sand", tileMeters: TILE_SAND_M, tint: "#e8d4a8" }),
    bootPbrSet(loader, { base: BASE, stem: "dirt", tileMeters: TILE_DIRT_M, tint: "#c4a878" }),
    bootPbrSet(loader, { base: BASE, stem: "gravel", tileMeters: TILE_GRAVEL_M, tint: "#c8b090" }),
    bootPbrSet(loader, { base: BASE, stem: "tarmac", tileMeters: TILE_TARMAC_M, tint: "#8a8680" }),
  ]);
  sandSet = sand;
  dirtSet = dirt;
  gravelSet = gravel;
  tarmacSet = tarmac;
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
