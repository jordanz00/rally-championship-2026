/**
 * Mountain + Lakeside photographic ground PBR (Poly Haven CC0).
 *
 * WHO THIS IS FOR: Track.buildAsync on the Mountain and Lakeside stages.
 * WHAT IT DOES: same contract as forest-pbr / desert-pbr — albedo + normal +
 *   roughness (+AO) sets for tarmac / cobble / gravel / dirt / sand ribbons and
 *   the land + skirt plane. Replaces the 339x678 canvas paint those two stages
 *   shipped with. World-XZ stochastic projection lives in gfx/pbr.js; this file
 *   only supplies the photos and the physical tile size (projScale = 5.5 / m).
 * HOW IT CONNECTS: track.js awaits prepareStagePbr(scenery) before _buildMesh.
 *   Sources: tools/fetch-stage-pbr-textures.py, assets/env/ATTRIBUTION.txt.
 */

import * as THREE from "../../vendor/three.module.js";
import { bootPbrSet, cloneTracked } from "./pbr-stream.js?v=13";

/** Physical size (m) of one photo tile, from the Poly Haven asset page. */
const SPEC = {
  mountain: {
    tarmac: { base: "assets/env/mountain", stem: "tarmac", tileMeters: 3.0, tint: "#6e6e6e" },
    cobble: { base: "assets/env/mountain", stem: "cobble", tileMeters: 2.0, tint: "#8a8478" },
    gravel: { base: "assets/env/mountain", stem: "gravel", tileMeters: 2.0, tint: "#80786c" },
    dirt: { base: "assets/env/mountain", stem: "dirt", tileMeters: 2.0, tint: "#8a6a4c" },
    land: { base: "assets/env/mountain", stem: "land", tileMeters: 3.2, tint: "#6a7a44" },
  },
  lakeside: {
    // Tarmac / gravel / dirt are shared with Mountain on disk (same photos).
    tarmac: { base: "assets/env/mountain", stem: "tarmac", tileMeters: 3.0, tint: "#74777a" },
    cobble: { base: "assets/env/lakeside", stem: "cobble", tileMeters: 2.4, tint: "#8c8070" },
    gravel: { base: "assets/env/mountain", stem: "gravel", tileMeters: 2.0, tint: "#80786c" },
    dirt: { base: "assets/env/mountain", stem: "dirt", tileMeters: 2.0, tint: "#8a6a4c" },
    sand: { base: "assets/env/lakeside", stem: "sand", tileMeters: 12.0, tint: "#b8a888" },
    land: { base: "assets/env/lakeside", stem: "land", tileMeters: 2.8, tint: "#7a5a30" },
  },
};

/** @typedef {{map:THREE.Texture, normalMap:THREE.Texture|null, roughnessMap:THREE.Texture|null, aoMap:THREE.Texture|null, tileMeters:number}} PbrSet */
/** @type {Record<string, Record<string, PbrSet>|null>} */
const SETS = { mountain: null, lakeside: null };
/** @type {Record<string, Promise<void>|null>} */
const PREP = { mountain: null, lakeside: null };

/**
 * Base projection tile in gfx/pbr.js is 5.5 m per photo; scale it so one photo
 * covers its real-world size (cobbles stay cobble-sized, asphalt grain stays fine).
 * @param {PbrSet|null} set
 * @returns {number}
 */
export function stageProjScale(set) {
  const m = set && set.tileMeters > 0 ? set.tileMeters : 5.5;
  return 5.5 / m;
}

/**
 * @param {THREE.Texture|null} tex
 * @param {number} rx
 * @param {number} ry
 * @returns {THREE.Texture|null}
 */
export function cloneStageMap(tex, rx, ry) {
  return cloneTracked(tex, rx, ry);
}

/**
 * @param {number} span
 * @param {number} [tileMeters]
 * @returns {number}
 */
export function stageLandRepeat(span, tileMeters = 3) {
  return Math.max(4, span / Math.max(0.5, tileMeters));
}

/**
 * Ribbon UV repeats: u spans road width once, v is dist * ROAD_UV_SCALE.
 * @param {number} vScale
 * @param {number} tileMeters
 * @param {number} [roadWidthM]
 * @returns {{x:number,y:number}}
 */
export function stageRoadRepeat(vScale, tileMeters, roadWidthM = 17.4) {
  const tile = Math.max(0.5, tileMeters);
  const metersPerV = 1 / Math.max(0.02, vScale);
  return { x: roadWidthM / tile, y: metersPerV / tile };
}

/**
 * Boot stub sets immediately; photos stream onto the same textures.
 * @param {"mountain"|"lakeside"} scenery
 * @returns {Promise<void>}
 */
export function prepareStagePbr(scenery) {
  const spec = SPEC[scenery];
  if (!spec) return Promise.resolve();
  if (PREP[scenery]) return PREP[scenery];
  PREP[scenery] = (async () => {
    if (typeof document === "undefined" || typeof Image === "undefined") return;
    const loader = new THREE.TextureLoader();
    const keys = Object.keys(spec);
    const sets = await Promise.all(keys.map((k) => bootPbrSet(loader, spec[k])));
    const out = {};
    keys.forEach((k, i) => {
      out[k] = sets[i];
    });
    SETS[scenery] = out;
  })();
  return PREP[scenery];
}

/**
 * @param {string} scenery
 * @returns {boolean}
 */
export function stagePbrReady(scenery) {
  const s = SETS[scenery];
  return !!(s && s.tarmac && s.tarmac.map);
}

/**
 * @param {string} scenery
 * @param {string} surfaceId
 * @returns {PbrSet|null}
 */
export function stageRoadMaps(scenery, surfaceId) {
  const s = SETS[scenery];
  if (!s) return null;
  if (surfaceId === "tarmac") return s.tarmac;
  if (surfaceId === "cobble") return s.cobble || s.tarmac;
  if (surfaceId === "gravel") return s.gravel || s.dirt;
  if (surfaceId === "sand") return s.sand || s.dirt;
  return s.dirt || s.gravel;
}

/**
 * @param {string} scenery
 * @returns {PbrSet|null}
 */
export function stageLandMaps(scenery) {
  const s = SETS[scenery];
  return s ? s.land || null : null;
}
