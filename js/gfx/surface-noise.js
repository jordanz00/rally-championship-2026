/**
 * World-space surface grit — a noise pass over albedo and roughness.
 *
 * WHO THIS IS FOR: roads, land, skirts, and trackside props.
 * WHAT IT DOES: multiplies materials by high-frequency dirt / aggregate /
 *   bark grain in world metres. This is surface texture, not film grain.
 * HOW IT CONNECTS: pbr.js projected maps include the GLSL. upgradeWorld
 *   arms leftover Standard materials that have no projection.
 */

import * as THREE from "../../vendor/three.module.js";

/** Shared GLSL. Callers must declare `varying vec3` world and `uniform float` amount. */
export const SURFACE_NOISE_GLSL = /* glsl */ `
float snHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float snValue(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = snHash(i);
  float b = snHash(i + vec2(1.0, 0.0));
  float c = snHash(i + vec2(0.0, 1.0));
  float d = snHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float snFbm(vec2 p) {
  return snValue(p) * 0.46
    + snValue(p * 2.17 + 3.1) * 0.28
    + snValue(p * 4.83 + 8.2) * 0.16
    + snValue(p * 9.61 + 17.0) * 0.1;
}
vec3 surfaceGrit(vec3 world, float amt) {
  float n = snFbm(world.xz * 1.72);
  float fine = snFbm(world.xz * 6.4 + 11.0);
  float speckle = snHash(floor(world.xz * 52.0 + 0.5));
  float grit = (n - 0.5) * 0.34 + (fine - 0.5) * 0.16;
  float fleck = speckle > 0.955 ? 0.1 : speckle < 0.04 ? -0.08 : 0.0;
  float k = clamp(amt, 0.0, 1.0);
  return vec3(1.0 + (grit + fleck) * k);
}
float surfaceGritRough(vec3 world) {
  return snFbm(world.xz * 3.4 + 5.0);
}
`;

const SKIP_KIND = /water|paint|glass|chrome|hud|flag|cloth|wiper|blob/;

/**
 * @param {THREE.Material|null} mat
 */
function shouldSkip(mat) {
  if (!mat) return true;
  if (mat.userData.surfaceNoiseArmed || mat.userData.projArmed) return true;
  if (mat.userData.hud || mat.userData.povHud || mat.userData.skipNoise) return true;
  if (mat.userData.blobShadow) return true;
  if (mat.userData.lockEnv && mat.userData.kind === "water") return true;
  const kind = `${mat.userData.kind || ""} ${mat.userData.propKind || ""}`.toLowerCase();
  if (SKIP_KIND.test(kind)) return true;
  if (mat.transparent && mat.opacity < 0.35) return true;
  return false;
}

/**
 * Arm a leftover Standard material that has no world projection.
 * @param {THREE.Material|null} mat
 * @param {number} [amount]
 */
export function armSurfaceNoise(mat, amount = 0.22) {
  if (shouldSkip(mat)) return;
  if (!mat.isMeshStandardMaterial && !mat.isMeshPhysicalMaterial && !mat.isMeshLambertMaterial) {
    return;
  }
  mat.userData.surfaceNoiseArmed = true;
  const amt = amount;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    if (typeof prev === "function") prev(shader, renderer);
    if (shader.uniforms.uSnAmt) return;
    shader.uniforms.uSnAmt = { value: amt };
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying vec3 vSnWorld;"
      )
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>
vSnWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uSnAmt;
varying vec3 vSnWorld;
${SURFACE_NOISE_GLSL}`
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
	diffuseColor.rgb *= surfaceGrit( vSnWorld, uSnAmt );`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
	roughnessFactor = clamp( roughnessFactor * ( 0.9 + surfaceGritRough( vSnWorld ) * 0.18 * uSnAmt * 4.0 ), 0.05, 1.0 );`
      );
  };
  mat.customProgramCacheKey = function surfaceNoiseCacheKey() {
    return `sn-v1-${amt.toFixed(2)}`;
  };
  mat.needsUpdate = true;
}

/**
 * Walk a stage root and grit every leftover grounded material.
 * @param {THREE.Object3D|null} root
 */
export function applySurfaceNoisePass(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return;
    const list = [].concat(obj.material || []);
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m) continue;
      const kind = `${m.userData.kind || ""}`;
      const amt =
        kind === "terrain" ? 0.3 : kind === "prop" || m.userData.propKind ? 0.2 : 0.18;
      armSurfaceNoise(m, amt);
    }
  });
}
