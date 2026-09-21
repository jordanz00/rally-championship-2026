/**
 * Forest photogrammetry PBR — Poly Haven 1k boot, 2k stream.
 *
 * WHO THIS IS FOR: Track.buildAsync on the Forest stage only.
 * WHAT IT DOES: tiled albedo + normal + roughness for the driving ribbon
 *   and land plane. Tile scale is the authored Poly Haven metre size (~2 m).
 * HOW IT CONNECTS: track.js awaits prepareForestPbr() before _buildMesh
 *   (1k color only). Normals / 2k swap in on the shared texture Source.
 */

import * as THREE from "../../vendor/three.module.js";
import { bootPbrSet, cloneTracked } from "./pbr-stream.js?v=4";

const BASE = "assets/env/forest";

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
  return cloneTracked(tex, rx, ry);
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
 * Boot 1k albedo only. Detail / 2k continue in the background.
 * @returns {Promise<void>}
 */
export async function prepareForestPbr() {
  if (prepared) return;
  prepared = true;
  if (typeof document === "undefined" || typeof Image === "undefined") return;

  const loader = new THREE.TextureLoader();
  const [dirt, gravel, land] = await Promise.all([
    bootPbrSet(loader, { base: BASE, stem: "dirt_floor", tileMeters: TILE_DIRT_M, tint: "#8a6a40" }),
    bootPbrSet(loader, { base: BASE, stem: "gravel_road", tileMeters: TILE_GRAVEL_M, tint: "#9a8a70" }),
    bootPbrSet(loader, { base: BASE, stem: "forest_floor", tileMeters: TILE_FLOOR_M, tint: "#4a5a38" }),
  ]);
  dirtSet = dirt;
  gravelSet = gravel;
  landSet = land;
}

/**
 * True once at least the dirt albedo slot exists.
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
