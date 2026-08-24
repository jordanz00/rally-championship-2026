/**
 * Camera occlusion fade — punch holes only in geometry that sits on the
 * chase-camera → car line of sight.
 *
 * WHO THIS IS FOR: chase-cam driving.
 * WHAT IT DOES: tagged meshes stay opaque; fragments inside a tight tube
 *   between cam and car are discarded. No wide near-camera ghosting.
 * HOW IT CONNECTS: Track tags tunnel (and similar) meshes; game.js updates
 *   uniforms each frame. POV passes on=false.
 */

import * as THREE from "../../vendor/three.module.js";
import { VISUAL } from "../config.js?v=127";

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
