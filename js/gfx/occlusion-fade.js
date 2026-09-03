/**
 * Camera occlusion fade — punch holes only in geometry that sits on the
 * chase-camera → car line of sight, and ghost rival cars on that same tube.
 *
 * WHO THIS IS FOR: chase-cam driving.
 * WHAT IT DOES: tagged world meshes discard fragments inside a tight tube
 *   between cam and car. Non-player cars on that tube drop to leftover
 *   opacity so the player's car stays readable. POV passes on=false.
 * HOW IT CONNECTS: Track tags tunnel meshes; game.js updates uniforms and
 *   paints the pack after the mirror capture so the rearview stays solid.
 */

import * as THREE from "../../vendor/three.module.js";
import { VISUAL } from "../config.js?v=183";

const UNIFORMS = {
  uOccludeCam: { value: new THREE.Vector3() },
  uOccludeCar: { value: new THREE.Vector3() },
  uOccludeOn: { value: 0 },
  /** Tube radius (m) — roughly half car width + margin. */
  uOccludeRadius: { value: 1.85 },
};

const VERT_PREFIX = /* glsl */ `
varying vec3 vCamFadeWorld;
`;

const VERT_INJECT = /* glsl */ `
  {
    vec4 fadeWorld = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      fadeWorld = instanceMatrix * fadeWorld;
    #endif
    fadeWorld = modelMatrix * fadeWorld;
    vCamFadeWorld = fadeWorld.xyz;
  }
`;

const FRAG_PREFIX = /* glsl */ `
uniform vec3 uOccludeCam;
uniform vec3 uOccludeCar;
uniform float uOccludeOn;
uniform float uOccludeRadius;
varying vec3 vCamFadeWorld;
`;

/** Discard only when the fragment blocks the cam→car sightline. */
const FRAG_INJECT = /* glsl */ `
  if ( uOccludeOn > 0.5 ) {
    vec3 camToFrag = vCamFadeWorld - uOccludeCam;
    vec3 camToCar = uOccludeCar - uOccludeCam;
    float carLen = max( length( camToCar ), 0.08 );
    vec3 dir = camToCar / carLen;
    float along = dot( camToFrag, dir );
    float perp = length( camToFrag - dir * along );
    // Strictly between camera and car (not past the car, not at the lens).
    float between = step( 0.55, along ) * step( along, carLen - 0.35 );
    float inTube = 1.0 - smoothstep( uOccludeRadius * 0.72, uOccludeRadius, perp );
    if ( between * inTube > 0.62 ) discard;
  }
`;

/**
 * Patch a material so occluding fragments discard. Stays opaque otherwise —
 * transparent + depthWrite:false on every tunnel wall was killing FPS.
 * @param {THREE.Material} mat
 * @returns {THREE.Material}
 */
export function patchCameraFadeMaterial(mat) {
  if (!mat) return mat;
  if (mat.userData.camFadePatched) return mat;
  mat.userData.camFadePatched = true;
  // Keep opaque sorting / depth. Soft alpha overdraw was the tunnel hitch.
  mat.transparent = false;
  mat.depthWrite = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === "function") prev(shader, renderer);
    Object.assign(shader.uniforms, UNIFORMS);
    shader.vertexShader = VERT_PREFIX + shader.vertexShader.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\n" + VERT_INJECT
    );
    shader.fragmentShader = FRAG_PREFIX + shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      FRAG_INJECT + "\n#include <dithering_fragment>"
    );
  };
  mat.customProgramCacheKey = () => "camFade-v3-tube";
  mat.needsUpdate = true;
  return mat;
}

/**
 * Walk a subtree and patch every mesh tagged `userData.cameraFade`.
 * @param {THREE.Object3D} root
 */
export function armCameraFade(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.userData.cameraFade) return;
    const list = [].concat(obj.material || []);
    const next = list.map((m) => {
      if (!m) return m;
      if (m.userData.camFadePatched) return m;
      if (m.userData._fadeClone) return m.userData._fadeClone;
      const faded = patchCameraFadeMaterial(m.clone());
      m.userData._fadeClone = faded;
      return faded;
    });
    obj.material = next.length === 1 ? next[0] : next;
  });
}

/**
 * @param {THREE.Vector3} camPos
 * @param {THREE.Vector3} carPos
 * @param {boolean} on chase cameras only — POV sits inside the car
 */
export function updateCameraFade(camPos, carPos, on) {
  if (camPos) UNIFORMS.uOccludeCam.value.copy(camPos);
  if (carPos) UNIFORMS.uOccludeCar.value.copy(carPos);
  const active = on && VISUAL.cameraOcclusionFade !== false;
  UNIFORMS.uOccludeOn.value = active ? 1 : 0;
}

/** Tube radius (m) around the cam→player sightline. ~car half-width + a slice. */
const PACK_TUBE_IN = 1.72;
const PACK_TUBE_OUT = 2.04;
/** Lift contact-patch origins up to body height so the tube hits the hull. */
const PACK_BODY_LIFT = 0.74;
/** Leftover opacity when a rival fully blocks the shot. */
const PACK_GHOST_OP = 0.18;
const _camToCar = new THREE.Vector3();
const _camToRival = new THREE.Vector3();
const _perp = new THREE.Vector3();
const _carBody = new THREE.Vector3();
const _rivalBody = new THREE.Vector3();

/**
 * Clone this car's materials so opacity changes cannot tint the rest of the pack.
 * Shared rival paints live on one Material; mutating it would ghost every AI car.
 * @param {THREE.Object3D} root
 */
function armPackSeeThrough(root) {
  if (!root || root.userData.packFadeArmed) return;
  root.userData.packFadeArmed = true;
  const slots = [];
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const list = [].concat(obj.material);
    const next = list.map((src) => {
      if (!src) return src;
      const mat = src.clone();
      mat.userData = Object.assign({}, src.userData, { shared: false, packFadeClone: true });
      slots.push({
        mat,
        baseOp: src.opacity != null ? src.opacity : 1,
        wasTrans: !!src.transparent,
        depthWrite: src.depthWrite !== false,
        glass: !!(src.transparent && (src.opacity == null || src.opacity < 0.92)),
      });
      return mat;
    });
    obj.material = next.length === 1 ? next[0] : next;
  });
  root.userData.packFadeSlots = slots;
}

/**
 * @param {THREE.Object3D} root
 * @param {number} amount 0 solid .. 1 fully ghosted
 */
function applyPackSeeThrough(root, amount) {
  if (amount > 0.02) armPackSeeThrough(root);
  const slots = root.userData.packFadeSlots;
  if (!slots) return;
  const ghost = amount > 0.04;
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i];
    const mat = s.mat;
    if (s.glass) {
      mat.opacity = s.baseOp * (ghost ? 0.28 + 0.72 * (1 - amount) : 1);
      continue;
    }
    const nextOp = s.baseOp * (1 - amount * (1 - PACK_GHOST_OP));
    const trans = ghost || s.wasTrans;
    if (mat.transparent !== trans) {
      mat.transparent = trans;
      mat.needsUpdate = true;
    }
    mat.opacity = nextOp;
    mat.depthWrite = !ghost && s.depthWrite;
  }
}

/**
 * True when `rivalPos` sits in the cam→player tube.
 * @param {THREE.Vector3} cam
 * @param {THREE.Vector3} car
 * @param {THREE.Vector3} rival
 * @param {number} radius
 */
function rivalInSightline(cam, car, rival, radius) {
  _camToCar.subVectors(car, cam);
  const len = _camToCar.length();
  if (len < 2.5) return false;
  _camToCar.multiplyScalar(1 / len);
  _camToRival.subVectors(rival, cam);
  const along = _camToRival.dot(_camToCar);
  if (along < 0.9 || along > len - 0.85) return false;
  _perp.copy(_camToRival).addScaledVector(_camToCar, -along);
  return _perp.lengthSq() <= radius * radius;
}

/**
 * Update ghost amounts for any non-player car on the chase-camera → player
 * sightline. Does not paint — call paintPackSeeThrough after mirror/cube
 * captures so those views keep a solid pack.
 *
 * POV skips this — the camera is the player. Restores opacity when they leave.
 *
 * @param {THREE.Object3D[]} roots rival (and ghost) meshes
 * @param {THREE.Vector3} camPos
 * @param {THREE.Vector3} carPos player contact patch
 * @param {boolean} on chase cameras only
 * @param {number} dt
 */
export function updatePackSeeThrough(roots, camPos, carPos, on, dt) {
  if (!roots || !camPos || !carPos) return;
  const follow = 1 - Math.exp(-12 * Math.max(1 / 120, dt || 1 / 60));
  _carBody.copy(carPos);
  _carBody.y += PACK_BODY_LIFT;
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    if (!root) continue;
    let want = 0;
    if (on) {
      root.getWorldPosition(_rivalBody);
      _rivalBody.y += PACK_BODY_LIFT;
      const latched = !!root.userData.packFadeLatch;
      const radius = latched ? PACK_TUBE_OUT : PACK_TUBE_IN;
      const hit = rivalInSightline(camPos, _carBody, _rivalBody, radius);
      root.userData.packFadeLatch = hit;
      want = hit ? 1 : 0;
    } else {
      root.userData.packFadeLatch = false;
    }
    let amt = root.userData.packFadeAmt || 0;
    amt += (want - amt) * follow;
    if (amt < 0.015 && want === 0) amt = 0;
    root.userData.packFadeAmt = amt;
  }
}

/**
 * Paint stored ghost amounts. `scale` 0 forces solid (mirror / cube);
 * `scale` 1 applies the chase-cam leftover opacity.
 *
 * @param {THREE.Object3D[]} roots
 * @param {number} [scale=1]
 */
export function paintPackSeeThrough(roots, scale = 1) {
  if (!roots) return;
  const mul = scale > 0 ? 1 : 0;
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    if (!root) continue;
    const amt = (root.userData.packFadeAmt || 0) * mul;
    if (amt > 0 || root.userData.packFadeArmed) applyPackSeeThrough(root, amt);
  }
}
