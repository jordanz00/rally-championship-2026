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
 *   Tunnel/title/cabin lights live on dedicated layers so outdoor PBR does not
 *   pay NUM_POINT_LIGHTS=16 (Windows/ANGLE 5 fps cliff).
 * PHOTOREAL (WebGL, not Lumen): Kelvin sun + sky IBL/PMREM + ACES exposure.
 *   Do not "fix" look by adding outdoor point lights or boosting bloom.
 */

import * as THREE from "../../vendor/three.module.js";
import { GFX, TUNNEL, VISUAL } from "../config.js?v=223";

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
 * Desert earth bias lives in LIGHTING.desert (warm fill/hemiGround/Kelvin) —
 * do not compensate with bloom alone.
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
  const t = tunnelBlend < 0 ? 0 : tunnelBlend > 1 ? 1 : tunnelBlend;

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

  // Soft sun kill — keep a whisper of key in deep shade so ACES does not crush
  // the bore to ink; outdoor (t=0) is always full authored intensity.
  const sunFloor = 0.06;
  lights.sun.intensity = baseSun * (1 - t * (1 - sunFloor));
  lights.fill.intensity = baseFill * (1 - t * fillKill);
  lights.hemi.intensity = baseHemi * (1 - t * hemiKill);
  lights.ambient.intensity = baseAmb * (1 - t) + t * ambFloor;

  lights.fill.position.set(p.x - d.x * 26, p.y + 20, p.z - d.z * 26);

  if (lights.skyRim) {
    const rimBase = L.rimInt != null ? L.rimInt : 0.24;
    lights.skyRim.intensity = rimBase * (1 - t * 0.72);
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
  const n = near != null ? near : cam.near;
  const f = far != null ? far : cam.far;
  if (
    cam.left === -ext &&
    cam.right === ext &&
    cam.top === ext &&
    cam.bottom === -ext &&
    cam.near === n &&
    cam.far === f
  ) {
    return;
  }
  cam.left = -ext;
  cam.right = ext;
  cam.top = ext;
  cam.bottom = -ext;
  cam.near = n;
  cam.far = f;
  cam.updateProjectionMatrix();
}

/**
 * Renderer knobs for physically based outdoor lighting.
 *
 * Visual Pass V1 — color-management contract (locked):
 *   textures (albedo) → SRGBColorSpace
 *   HDR / RGBE sky    → LinearSRGBColorSpace
 *   renderer output   → SRGBColorSpace
 *   tone mapping      → ACESFilmicToneMapping (always; never Reinhard mid-race)
 *   exposure          → authored LIGHTING[stage].exposure (± tiny tunnel boost)
 *   AA                → canvas MSAA when post OFF; when post ON, MSAA off
 *                       (post RTs), rely on capped DPR + soft grade (no FXAA stack)
 *   DPR               → min(devicePixelRatio, GFX.maxPixelRatio) + pixel budget
 *
 * @param {THREE.WebGLRenderer} renderer
 */
export function configurePBRRenderer(renderer) {
  if (!renderer) return;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // V1: ACES is the production present path for every stage / title / race.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  if (VISUAL.physicalLighting !== false && renderer.useLegacyLights != null) {
    renderer.useLegacyLights = false;
  }
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

/**
 * Shared soft-PCF shadow contract for championship stages (V1).
 * Call once at race arm / title boot — stages must not drift bias independently.
 *
 * @param {THREE.DirectionalLight} sun
 * @param {{ cinema?: boolean }} [opts]
 */
export function applyShadowQualityContract(sun, opts = {}) {
  if (!sun || !sun.shadow) return;
  const cinema = opts.cinema === true || (VISUAL.tier || 0) >= 13 || VISUAL.cinemaRealism === true;
  sun.shadow.bias = GFX.shadowBias != null ? GFX.shadowBias : cinema ? -0.00018 : -0.00012;
  sun.shadow.normalBias =
    GFX.shadowNormalBias != null ? GFX.shadowNormalBias : cinema ? 0.045 : 0.038;
  sun.shadow.radius = GFX.shadowRadius != null ? GFX.shadowRadius : cinema ? 2.6 : 2.2;
  if (sun.shadow.camera) {
    const near = GFX.shadowNear != null ? GFX.shadowNear : 2.5;
    const far = GFX.shadowFar != null ? GFX.shadowFar : 140;
    sun.shadow.camera.near = near;
    sun.shadow.camera.far = far;
    sun.shadow.camera.updateProjectionMatrix();
  }
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

/**
 * Local lights (tunnel sconces, cave spot, title kick, cabin fill) must not
 * sit on layer 0. Three.js folds every visible PointLight into NUM_POINT_LIGHTS
 * for *all* MeshStandardMaterials that share a layer — 14 intensity-0 sconces
 * plus kick/cabin/spot is a Windows/ANGLE fragment cliff (~5 fps) with no
 * outdoor look change. Lights on TUNNEL/TITLE layers only shade receivers
 * that enable those layers (tunnel meshes, cars, title pad).
 */
export const TUNNEL_LIGHT_LAYER = 2;
export const TITLE_LIGHT_LAYER = 3;

/**
 * @param {THREE.Light | null | undefined} light
 * @param {number} layer
 */
export function setLightLayer(light, layer) {
  if (!light || !light.layers) return;
  light.layers.set(layer);
  if (light.target && light.target.layers) light.target.layers.set(layer);
}

/**
 * Isolate local lights so outdoor PBR (trees, road, terrain) compiles with
 * sun + fill + hemi + ambient only. Never toggle `visible` — that still
 * changes NUM_*_LIGHTS and hitch-recompiles at the tunnel mouth.
 *
 * @param {{
 *   wallLights?: THREE.Light[],
 *   caveLight?: THREE.Light,
 *   titleRim?: THREE.Light,
 *   titleKick?: THREE.Light,
 *   cabinFill?: THREE.Light,
 * }} lights
 */
export function isolateLocalLights(lights) {
  if (!lights) return;
  const walls = lights.wallLights || [];
  for (let i = 0; i < walls.length; i++) setLightLayer(walls[i], TUNNEL_LIGHT_LAYER);
  setLightLayer(lights.caveLight, TUNNEL_LIGHT_LAYER);
  setLightLayer(lights.titleRim, TITLE_LIGHT_LAYER);
  setLightLayer(lights.titleKick, TITLE_LIGHT_LAYER);
  setLightLayer(lights.cabinFill, TUNNEL_LIGHT_LAYER);
}

/**
 * Cars and tunnel linings receive the isolated local lights.
 * @param {THREE.Object3D | null | undefined} object
 * @param {number} [layer]
 */
export function enableLocalLightReceiver(object, layer = TUNNEL_LIGHT_LAYER) {
  if (!object || !object.traverse) return;
  object.traverse((node) => {
    if (node.layers) node.layers.enable(layer);
  });
}

/**
 * Tag authored tunnel meshes so they receive sconces without walking the
 * whole forest into NUM_POINT_LIGHTS. Does not rewrite Track.create.
 * @param {THREE.Object3D | null | undefined} root
 */
export function tagTunnelWorldReceivers(root) {
  if (!root || !root.traverse) return;
  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isInstancedMesh) return;
    const u = obj.userData || {};
    if (
      u.tunnelPortal ||
      u.tunnelBoreLining ||
      u.tunnelBoreRib ||
      u.tunnelVolume ||
      u.tunnel
    ) {
      obj.layers.enable(TUNNEL_LIGHT_LAYER);
    }
  });
}
