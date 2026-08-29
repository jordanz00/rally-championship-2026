/**
 * PBR lighting rig — physically based sun, sky rim, and shadow follow (Sprint 32).
 *
 * WHO THIS IS FOR: game.js race/title lighting path.
 * WHAT IT DOES: Kelvin sun colour, hemisphere ratios, cheap sky-rim fill (no extra
 *   shadow pass), and a tight ortho shadow frustum that tracks the player.
 * HOW IT CONNECTS: RallyGame._applyLighting / _updateLights call these helpers.
 *
 * PERFORMANCE: one extra DirectionalLight with castShadow=false; shadow map size
 *   unchanged — only the ortho bounds tighten for sharper contact reads.
 */

import * as THREE from "../../vendor/three.module.js";
import { GFX, TUNNEL, VISUAL } from "../config.js?v=164";

/**
 * Blackbody-ish RGB from colour temperature (Kelvin).
 * Good enough for sun/sky key tints without a full spectral model.
 *
 * @param {number} kelvin
 * @returns {THREE.Color}
 */
export function kelvinToColor(kelvin) {
  const t = Math.max(1800, Math.min(12000, kelvin)) / 100;
  let r;
  let g;
  let b;
  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return new THREE.Color(
    Math.max(0, Math.min(255, r)) / 255,
    Math.max(0, Math.min(255, g)) / 255,
    Math.max(0, Math.min(255, b)) / 255
  );
}

/**
 * Apply authored stage LIGHTING block onto the fixed light pool.
 *
 * @param {{ sun: THREE.DirectionalLight, fill: THREE.DirectionalLight, hemi: THREE.HemisphereLight, ambient: THREE.AmbientLight, skyRim?: THREE.DirectionalLight }} lights
 * @param {object} L LIGHTING[courseId]
 */
export function applyStageLights(lights, L) {
  if (L.sunKelvin != null && lights.sun) {
    lights.sun.color.copy(kelvinToColor(L.sunKelvin));
  } else if (L.sun != null && lights.sun) {
    lights.sun.color.setHex(L.sun);
  }
  if (lights.sun && L.sunInt != null) lights.sun.intensity = L.sunInt;

  if (lights.hemi) {
    if (L.hemiSky != null) lights.hemi.color.setHex(L.hemiSky);
    if (L.hemiGround != null) lights.hemi.groundColor.setHex(L.hemiGround);
    if (L.hemi != null) lights.hemi.intensity = L.hemi;
  }

  if (lights.fill) {
    if (L.fill != null) lights.fill.color.setHex(L.fill);
    if (L.fillInt != null) lights.fill.intensity = L.fillInt;
  }

  if (lights.ambient) {
    if (L.ambient != null) lights.ambient.color.setHex(L.ambient);
    if (L.ambientInt != null) lights.ambient.intensity = L.ambientInt;
  }

  if (lights.skyRim) {
    lights.skyRim.color.setHex(L.rimSky != null ? L.rimSky : L.hemiSky != null ? L.hemiSky : 0xb0d0f0);
    lights.skyRim.intensity = L.rimInt != null ? L.rimInt : 0.24;
    lights.skyRim.castShadow = false;
  }
}

/**
 * Follow the player with key/fill/rim positions. Sun target stays on the car.
 *
 * @param {{ sun: THREE.DirectionalLight, fill: THREE.DirectionalLight, skyRim?: THREE.DirectionalLight }} lights
 * @param {THREE.Vector3} anchor player / camera anchor
 * @param {THREE.Vector3} sunDir normalized sun direction
 * @param {number} tunnelBlend 0..1 tunnel shade
 * @param {object} L LIGHTING[courseId]
 */
export function updateRaceLightFollow(lights, anchor, sunDir, tunnelBlend, L) {
  const p = anchor;
  const d = sunDir;
  const t = tunnelBlend;

  lights.sun.position.set(p.x + d.x * 42, p.y + d.y * 42, p.z + d.z * 42);
  lights.sun.target.position.set(p.x, p.y, p.z);
  lights.sun.target.updateMatrixWorld();

  const hemiKill = 1 - (TUNNEL.hemiRetain != null ? TUNNEL.hemiRetain : 0.48);
  const fillKill = 1 - (TUNNEL.fillRetain != null ? TUNNEL.fillRetain : 0.22);
  const ambFloor = TUNNEL.ambientFloor != null ? TUNNEL.ambientFloor : 0.58;
  const baseSun = L.sunInt != null ? L.sunInt : 2.4;
  const baseFill = L.fillInt != null ? L.fillInt : 0.34;
  const baseHemi = L.hemi != null ? L.hemi : 0.78;
  const baseAmb = L.ambientInt != null ? L.ambientInt : 0.28;

  lights.sun.intensity = baseSun * (1 - t);
  lights.fill.intensity = baseFill * (1 - t * fillKill);
  lights.hemi.intensity = baseHemi * (1 - t * hemiKill);
  lights.ambient.intensity = baseAmb * (1 - t) + t * ambFloor;

  lights.fill.position.set(p.x - d.x * 26, p.y + 20, p.z - d.z * 26);

  if (lights.skyRim) {
    const rimBase = L.rimInt != null ? L.rimInt : 0.24;
    lights.skyRim.intensity = rimBase * (1 - t * 0.88);
    lights.skyRim.position.set(p.x - d.x * 36, p.y + 30, p.z - d.z * 36);
    lights.skyRim.target.position.set(p.x, p.y + 0.45, p.z);
    lights.skyRim.target.updateMatrixWorld();
  }
}

/**
 * Tight ortho shadow frustum — higher texel density on the driving patch
 * while still covering chase-cam mid-ground (GFX.shadowExtentRace).
 *
 * @param {THREE.DirectionalLight} sun
 * @param {number} [extent]
 * @param {number} [near]
 * @param {number} [far]
 */
export function updateShadowFrustum(sun, extent, near, far) {
  if (!sun || !sun.shadow || !sun.shadow.camera) return;
  const ext = extent != null ? extent : GFX.shadowExtentRace != null ? GFX.shadowExtentRace : 18;
  const cam = sun.shadow.camera;
  cam.left = -ext;
  cam.right = ext;
  cam.top = ext;
  cam.bottom = -ext;
  if (near != null) cam.near = near;
  if (far != null) cam.far = far;
  cam.updateProjectionMatrix();
}

/**
 * Renderer knobs for physically based outdoor lighting.
 *
 * @param {THREE.WebGLRenderer} renderer
 */
export function configurePBRRenderer(renderer) {
  if (!renderer) return;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const cinema = (VISUAL.tier || 0) >= 13 || VISUAL.cinemaRealism === true;
  renderer.toneMapping = cinema ? THREE.ACESFilmicToneMapping : THREE.ReinhardToneMapping;
  if (VISUAL.physicalLighting !== false && renderer.useLegacyLights != null) {
    renderer.useLegacyLights = false;
  }
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

/**
 * PMREM capture range for sky-only IBL bakes.
 *
 * @returns {{ sigma: number, near: number, far: number }}
 */
export function skyPmremCapture() {
  return {
    sigma: VISUAL.pbrSkySigma != null ? VISUAL.pbrSkySigma : 0,
    near: 0.08,
    far: GFX.pmremFar != null ? GFX.pmremFar : 240,
  };
}
