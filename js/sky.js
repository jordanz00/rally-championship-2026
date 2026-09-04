/**
 * Sky — equirectangular HDR skybox (realistic photo clouds).
 *
 * WHO THIS IS FOR: the renderer.
 * WHAT IT DOES: displays a Poly Haven pure-sky HDR as a BackSide sphere
 *   (standard skybox). No volumetric raymarch. Stage picks which HDR;
 *   PMREM IBL still bakes from this mesh in game.js.
 * HOW IT CONNECTS: game.js createSky / applySky / tickSky / setSkyQuality.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../vendor/three.module.js";
import { RGBELoader } from "../vendor/RGBELoader.js";
import { VISUAL } from "./config.js?v=201";

/**
 * GPU budget + technique — QA greps this object; do not rename keys.
 * View/light steps stay exported as zeros so older QA that reads caps
 * still sees a bounded (non-raymarch) sky.
 */
export const CLOUD_BUDGET = {
  technique: "equirect-skybox",
  maxViewSteps: 0,
  cinemaViewSteps: 0,
  mediumViewSteps: 0,
  lowViewSteps: 0,
  minViewSteps: 0,
  maxLightSteps: 0,
  notes:
    "Sprint 549: volumetric raymarch removed. Poly Haven CC0 pure-sky HDR equirect skybox (2k). setSkyQuality is a no-op.",
};

/**
 * Per-stage HDR paths (CC0 Poly Haven pure skies — see ATTRIBUTION.txt).
 */
export const STAGE_SKYBOX = {
  desert: "assets/sky/kloofendal_partly_cloudy_2k.hdr",
  forest: "assets/sky/sunflowers_2k.hdr",
  mountain: "assets/sky/kloppenheim_06_2k.hdr",
  // Cool misty pure-sky — lakeside must not share forest's sunflower field.
  lakeside: "assets/sky/kloofendal_28d_misty_2k.hdr",
  title: "assets/sky/kloofendal_partly_cloudy_2k.hdr",
};

/** @deprecated Palette kept so older imports/QA do not crash; unused by skybox path. */
export const STAGE_CLOUD_PALETTES = {
  desert: { lit: 0xfff4e4, dark: 0x7a6a58, absorb: 2.05, silver: 1.18, cover: 0.24 },
  forest: { lit: 0xf9fcff, dark: 0x647c98, absorb: 2.35, silver: 1.12, cover: 0.34 },
  mountain: { lit: 0xf8fbff, dark: 0x62809c, absorb: 2.2, silver: 1.18, cover: 0.24 },
  lakeside: { lit: 0xf5fafd, dark: 0x687e96, absorb: 2.3, silver: 1.1, cover: 0.3 },
  title: { lit: 0xfff7ec, dark: 0x546c88, absorb: 2.45, silver: 1.2, cover: 0.38 },
};

const _texCache = Object.create(null);
const _loadWait = Object.create(null);
let _loader = null;

function rgbeLoader() {
  if (!_loader) {
    _loader = new RGBELoader();
    // Half-float matches Three r160 HDR path; falls back inside loader if needed.
    if (THREE.HalfFloatType != null) _loader.setDataType(THREE.HalfFloatType);
  }
  return _loader;
}

/**
 * Load (or reuse) an equirect HDR skybox texture.
 * @param {string} url
 * @returns {Promise<THREE.DataTexture>}
 */
export function loadSkyboxTexture(url) {
  if (_texCache[url]) return Promise.resolve(_texCache[url]);
  if (_loadWait[url]) return _loadWait[url];
  _loadWait[url] = new Promise((resolve, reject) => {
    rgbeLoader().load(
      url,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        if (THREE.LinearSRGBColorSpace != null) tex.colorSpace = THREE.LinearSRGBColorSpace;
        tex.needsUpdate = true;
        _texCache[url] = tex;
        resolve(tex);
      },
      undefined,
      (err) => {
        delete _loadWait[url];
        reject(err || new Error(`Skybox load failed: ${url}`));
      }
    );
  });
  return _loadWait[url];
}

/**
 * Resolve stage id → skybox URL.
 * @param {string} [stageId]
 * @returns {string}
 */
export function skyboxUrlForStage(stageId) {
  if (stageId && STAGE_SKYBOX[stageId]) return STAGE_SKYBOX[stageId];
  return STAGE_SKYBOX.desert;
}

/**
 * Camera-locked sky dome with an HDR equirect map.
 * @returns {THREE.Mesh}
 */
export function createSky() {
  const mat = new THREE.MeshBasicMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
    color: 0xffffff,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
  mesh.scale.setScalar(40);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2000;
  mesh.name = "pbr-sky";
  mesh.userData.volumetricClouds = false;
  mesh.userData.skybox = true;
  mesh.userData.cloudTechnique = CLOUD_BUDGET.technique;
  mesh.userData.lensFlare = false;
  mesh.userData.skyReady = false;
  mesh.userData.skyGen = 0;

  // Warm the default desert/title sky immediately so first paint is not blue void.
  const warmUrl = STAGE_SKYBOX.desert;
  loadSkyboxTexture(warmUrl)
    .then((tex) => {
      if (!mesh.material) return;
      mesh.material.map = tex;
      mesh.material.needsUpdate = true;
      mesh.userData.skyReady = true;
      mesh.userData.skyUrl = warmUrl;
    })
    .catch((err) => console.warn("Default skybox warm failed", err));

  // Prefetch the other stage skies in the background.
  for (const url of new Set(Object.values(STAGE_SKYBOX))) {
    if (url !== warmUrl) loadSkyboxTexture(url).catch(() => {});
  }

  return mesh;
}

/**
 * Assign the stage skybox. Returns a promise that resolves when the map is on the mesh.
 * @param {THREE.Mesh} mesh
 * @param {object} L LIGHTING entry (sunDir still used by the light rig)
 * @param {string} [stageId]
 * @returns {Promise<void>}
 */
export function applySky(mesh, L, stageId) {
  if (!mesh || !mesh.material) return Promise.resolve();
  const id = stageId && STAGE_SKYBOX[stageId] ? stageId : "desert";
  const url = skyboxUrlForStage(id);
  const gen = (mesh.userData.skyGen = (mesh.userData.skyGen || 0) + 1);
  mesh.userData.skyStage = id;
  mesh.userData.skyUrl = url;
  mesh.userData.skyReady = false;

  // Stash sun so debug / future flare helpers can read it without uniforms.
  if (L && Array.isArray(L.sunDir) && L.sunDir.length === 3) {
    if (!mesh.userData.sunDir) mesh.userData.sunDir = new THREE.Vector3();
    mesh.userData.sunDir.set(L.sunDir[0], L.sunDir[1], L.sunDir[2]).normalize();
  }

  // Soft sky↔haze seam: photo HDR stays dominant; slight lean toward stage
  // horizon glow / fog so the dome does not hard-cut against land dissolve.
  if (L && mesh.material.color) {
    const hs = Math.max(0, Math.min(1, Number(L.horizonStrength) || 0));
    const amount = Math.min(0.26, hs * 0.42 + (Number(L.dustStrength) || 0) * 0.18);
    const tint = new THREE.Color(0xffffff);
    if (L.horizonGlow != null) tint.lerp(new THREE.Color(L.horizonGlow), amount);
    if (L.fog != null) tint.lerp(new THREE.Color(L.fog), amount * 0.4);
    mesh.material.color.copy(tint);
  } else {
    void VISUAL;
  }

  return loadSkyboxTexture(url)
    .then((tex) => {
      if (!mesh.material || mesh.userData.skyGen !== gen) return;
      mesh.material.map = tex;
      mesh.material.needsUpdate = true;
      mesh.userData.skyReady = true;
    })
    .catch((err) => {
      console.warn("applySky skybox failed", id, err);
    });
}

/**
 * Skybox has no raymarch knobs — kept so the perf tier API stays stable.
 * @param {THREE.Mesh} mesh
 * @param {string} _perfTier
 */
export function setSkyQuality(mesh, _perfTier) {
  if (!mesh || !mesh.userData) return;
  mesh.userData.skyQuality = _perfTier || "medium";
}

/**
 * Skybox is static (photo). Optional slow yaw was rejected — it reads as the
 * world spinning under a locked sun. No-op retained for the game loop.
 * @param {THREE.Mesh} mesh
 * @param {number} _seconds
 * @param {THREE.Vector3} [_camFwd]
 */
export function tickSky(mesh, _seconds, _camFwd) {
  /* skybox — no per-frame uniforms */
}

/**
 * True once the current stage map is assigned (or a warm default is up).
 * @param {THREE.Mesh} mesh
 * @returns {boolean}
 */
export function isSkyReady(mesh) {
  return !!(mesh && mesh.userData && mesh.userData.skyReady && mesh.material && mesh.material.map);
}
