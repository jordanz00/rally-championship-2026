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
import { GFX, TUNNEL, VISUAL } from "../config.js?v=241";

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

const _hemiHor = new THREE.Color();
const _fogHor = new THREE.Color();
const _fogGlow = new THREE.Color();

/**
 * Forest / Mountain open-daylight floors (after _seatSunShadows).
 * Shade under a bright sky must still read — do not lower these.
 */
export const DAYLIGHT_FLOORS = {
  forest: { ambient: 0.2, fill: 0.32, hemi: 0.62 },
  mountain: { ambient: 0.2, fill: 0.32, hemi: 0.62 },
};

/**
 * Infer stage from the authored LIGHTING block (config.js is locked).
 * @param {object} L
 * @param {string} [courseId]
 * @returns {"desert"|"forest"|"mountain"|"lakeside"|"title"|"other"}
 */
export function lightingStageId(L, courseId) {
  if (courseId === "desert" || courseId === "forest" || courseId === "mountain" || courseId === "lakeside" || courseId === "title") {
    return courseId;
  }
  if (!L) return "other";
  if (L.fogFar === 260) return "forest";
  if (L.sunKelvin === 6300) return "mountain";
  if (L.fogFar === 720) return "lakeside";
  if (L.sunKelvin === 5350 || L.sunInt === 2.42) return "desert";
  if (L.kickInt != null) return "title";
  return "other";
}

/**
 * Hemisphere sky lobe from the visible sky (authored hemiSky + horizon).
 * Do not lerp the dark zenith — linear sRGB→linear midpoints go muddy grey.
 *
 * @param {THREE.HemisphereLight | null | undefined} hemi
 * @param {object} L
 */
export function applyHemiFromSky(hemi, L) {
  if (!hemi || !L) return;
  // Driving-camera sky is the horizon, not the dark zenith. Linear-lerp of
  // 0x0a4088 → sand goes muddy grey under ACES color management.
  const skyHex = L.hemiSky != null ? L.hemiSky : L.skyHorizon;
  const horHex = L.skyHorizon != null ? L.skyHorizon : skyHex;
  if (skyHex != null) {
    hemi.color.setHex(skyHex);
    if (horHex != null && horHex !== skyHex) {
      _hemiHor.setHex(horHex);
      hemi.color.lerp(_hemiHor, 0.3);
    }
  }
  if (L.hemiGround != null) hemi.groundColor.setHex(L.hemiGround);
}

/**
 * Fog that dissolves land into the sky photo horizon (not a gray/yellow band).
 * Forest is the exception: skyHorizon is #a8cce8, so matching it turns every
 * far tree into light-blue haze. Stage 2 uses woodland air — olive-gray mist.
 *
 * @param {object} L
 * @param {THREE.Color} [out]
 * @param {string} [courseId]
 * @returns {THREE.Color}
 */
export function horizonFogColor(L, out, courseId) {
  const col = out || new THREE.Color();
  const stage = lightingStageId(L, courseId);
  if (stage === "forest") {
    // Humid canopy atmosphere. Not Rayleigh blue, not the sky photo.
    col.setHex(0x8f937a);
    if (L && L.hemiGround != null) {
      _fogGlow.setHex(L.hemiGround);
      col.lerp(_fogGlow, 0.18);
    }
    return col;
  }
  if (L && L.skyHorizon != null) col.setHex(L.skyHorizon);
  else if (L && L.fog != null) col.setHex(L.fog);
  else col.setHex(0xc8d4dc);
  if (L && L.horizonGlow != null) {
    const hs = Math.max(0, Math.min(1, Number(L.horizonStrength) || 0));
    _fogGlow.setHex(L.horizonGlow);
    col.lerp(_fogGlow, Math.min(0.42, hs * 0.7));
  }
  return col;
}

/**
 * After _seatSunShadows: keep the seated sun, restore a daylight sun/sky
 * ratio, pin Forest/Mountain floors, and write fog = horizon.
 * Does not change ACES or the `sun *= 1 - 0.22 * open` line.
 *
 * @param {{ sun?: THREE.DirectionalLight, fill?: THREE.DirectionalLight, hemi?: THREE.HemisphereLight, ambient?: THREE.AmbientLight, skyRim?: THREE.DirectionalLight }} lights
 * @param {THREE.Color | null | undefined} fogColor scene.fog.color
 * @param {object} L
 * @param {number} tunnelBlend
 * @param {THREE.Color | null | undefined} tunnelFog
 * @param {string} [courseId]
 */
export function applyDaylightLook(lights, fogColor, L, tunnelBlend, tunnelFog, courseId) {
  if (!L) return;
  const t = tunnelBlend < 0 ? 0 : tunnelBlend > 1 ? 1 : tunnelBlend;
  const open = 1 - t;
  const stage = lightingStageId(L, courseId);

  applyHemiFromSky(lights && lights.hemi, L);
  if (lights && lights.skyRim && (L.skyHorizon != null || L.rimSky != null)) {
    lights.skyRim.color.setHex(L.skyHorizon != null ? L.skyHorizon : L.rimSky);
  }

  if (open > 0.85 && lights) {
    if (stage === "desert") {
      // Seat boosts fill ×2.15 / ambient ×1.7 and flattens the key.
      // Cap sky bounce so the Kelvin sun still sculpts sand and the car.
      if (lights.fill) lights.fill.intensity = Math.min(lights.fill.intensity, 0.4);
      if (lights.ambient) lights.ambient.intensity = Math.min(lights.ambient.intensity, 0.28);
      if (lights.hemi) {
        lights.hemi.intensity = Math.min(Math.max(lights.hemi.intensity, 0.52), 0.66);
      }
    } else if (stage === "forest" || stage === "mountain") {
      const fl = DAYLIGHT_FLOORS[stage];
      if (lights.ambient && lights.ambient.intensity < fl.ambient) lights.ambient.intensity = fl.ambient;
      if (lights.fill && lights.fill.intensity < fl.fill) lights.fill.intensity = fl.fill;
      if (lights.hemi && lights.hemi.intensity < fl.hemi) lights.hemi.intensity = fl.hemi;
    }
  }

  if (fogColor) {
    horizonFogColor(L, _fogHor, courseId);
    if (t <= 0.002 || !tunnelFog) fogColor.copy(_fogHor);
    else fogColor.lerpColors(_fogHor, tunnelFog, t);
  }
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
    applyHemiFromSky(lights.hemi, L);
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
    lights.skyRim.color.setHex(
      L.skyHorizon != null ? L.skyHorizon : L.rimSky != null ? L.rimSky : L.hemiSky != null ? L.hemiSky : 0xb0d0f0
    );
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
 * @param {object} [tunnelCfg] TUNNEL / tunnelLightingFor(courseId)
 */
export function updateRaceLightFollow(lights, anchor, sunDir, tunnelBlend, L, tunnelCfg) {
  const p = anchor;
  const d = sunDir;
  const t = tunnelBlend < 0 ? 0 : tunnelBlend > 1 ? 1 : tunnelBlend;
  const TC = tunnelCfg || TUNNEL;

  lights.sun.position.set(p.x + d.x * 42, p.y + d.y * 42, p.z + d.z * 42);
  lights.sun.target.position.set(p.x, p.y, p.z);
  lights.sun.target.updateMatrixWorld();

  const hemiKill = 1 - (TC.hemiRetain != null ? TC.hemiRetain : 0.48);
  const fillKill = 1 - (TC.fillRetain != null ? TC.fillRetain : 0.22);
  const ambFloor = TC.ambientFloor != null ? TC.ambientFloor : 0.58;
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

const _snapForward = new THREE.Vector3();
const _snapRight = new THREE.Vector3();
const _snapUp = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _worldX = new THREE.Vector3(1, 0, 0);

/**
 * Lock the sun shadow camera to whole texels in light space.
 * A frustum that follows the car in sub-texel steps makes every shadow
 * edge crawl across the road. Snapping both the light and its target
 * keeps the sun direction and moves the map in whole texels only.
 *
 * @param {THREE.DirectionalLight} sun
 * @param {number} [mapSize] shadow map width in texels
 */
export function snapShadowCamera(sun, mapSize) {
  if (!sun || !sun.shadow || !sun.shadow.camera || !sun.target) return;
  const cam = sun.shadow.camera;
  const size =
    mapSize > 0 ? mapSize : sun.shadow.mapSize && sun.shadow.mapSize.x ? sun.shadow.mapSize.x : 1024;
  const span = cam.right - cam.left;
  const texel = span / size;
  if (!(texel > 1e-6)) return;

  _snapForward.subVectors(sun.target.position, sun.position);
  if (_snapForward.lengthSq() < 1e-8) return;
  _snapForward.normalize();
  _snapRight.crossVectors(_snapForward, _worldUp);
  if (_snapRight.lengthSq() < 1e-8) _snapRight.crossVectors(_snapForward, _worldX);
  _snapRight.normalize();
  _snapUp.crossVectors(_snapRight, _snapForward).normalize();

  const tx = sun.target.position.dot(_snapRight);
  const ty = sun.target.position.dot(_snapUp);
  const dx = Math.round(tx / texel) * texel - tx;
  const dy = Math.round(ty / texel) * texel - ty;
  if (Math.abs(dx) < 1e-5 && Math.abs(dy) < 1e-5) return;

  sun.target.position.addScaledVector(_snapRight, dx).addScaledVector(_snapUp, dy);
  sun.position.addScaledVector(_snapRight, dx).addScaledVector(_snapUp, dy);
  sun.target.updateMatrixWorld();
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
  sun.shadow.normalBias = Math.min(
    GFX.shadowNormalBias != null ? GFX.shadowNormalBias : cinema ? 0.045 : 0.038,
    0.016
  );
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
