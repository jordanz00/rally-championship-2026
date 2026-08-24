/**
 * Painted sky — seamless procedural atmosphere + volumetric-style clouds.
 *
 * WHO THIS IS FOR: the renderer.
 * WHAT IT DOES: fills the frame with a per-course gradient, analytic
 *   Rayleigh/Mie tint, and direction-based fBm clouds (no equirectangular seam).
 * HOW IT CONNECTS: game.js calls createSky() once, applySky() per stage, and
 *   tickSky() every frame.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../vendor/three.module.js";
import { gradientTexture } from "./gfx/saturn.js?v=1";
import { VISUAL } from "./config.js?v=127";

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uGrad;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uCloudLit;
uniform vec3 uCloudDark;
uniform vec3 uHorizonGlow;
uniform float uHorizonStrength;
uniform float uDust;
uniform float uCloudCover;
uniform float uCloudScale;
uniform float uExposure;
uniform float uTime;
uniform vec3 uGroundBounce;
uniform float uGroundBounceMix;
uniform float uSunBloom;
uniform float uZenithBoost;
uniform float uRayleigh;
uniform float uMie;
uniform float uAtmoBlend;
uniform float uCloudDetail;

varying vec3 vDir;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p, int octaves) {
  float v = 0.0;
  float a = 0.5;
  mat3 rot = mat3(0.8, 0.6, 0.0, -0.6, 0.8, 0.0, 0.0, 0.0, 1.0);
  for (int i = 0; i < 6; i++) {
    if (i >= octaves) break;
    v += a * noise3(p);
    p = rot * p * 2.04 + vec3(1.7, 1.3, 2.1);
    a *= 0.5;
  }
  return v;
}

vec3 atmosphericScatter(vec3 rd, vec3 sunDir) {
  float y = max(rd.y, 0.0);
  float mu = max(dot(rd, sunDir), 0.0);
  vec3 zenith = vec3(0.18, 0.42, 0.92);
  vec3 horizon = vec3(0.78, 0.86, 0.94);
  vec3 rayleigh = mix(horizon, zenith, pow(y, 0.38)) * uRayleigh;
  float miePhase = pow(mu, 8.0) * 0.12 + pow(mu, 64.0) * 0.28 + pow(mu, 512.0) * 1.4;
  vec3 mie = uSunColor * miePhase * uMie;
  return rayleigh + mie;
}

float cloudShellMask(float y) {
  return smoothstep(0.08, 0.26, y) * (1.0 - smoothstep(0.56, 0.9, y));
}

float cloudDensity(vec3 p, int octaves) {
  float n1 = fbm(p, octaves);
  float n2 = fbm(p * 2.08 + vec3(2.1, 0.4, 1.7), max(2, octaves - 1));
  float n3 = fbm(p * 4.2 + vec3(-1.3, 1.8, 0.6), max(2, octaves - 2));
  return n1 * 0.55 + n2 * 0.3 + n3 * 0.15;
}

vec3 volumetricClouds(vec3 rd, vec3 sunDir, vec3 wind, float cover, float scale, int octaves) {
  float hMask = cloudShellMask(max(rd.y, 0.0));
  if (hMask < 0.001 || cover < 0.02) return vec3(0.0);

  vec3 base = rd * scale + wind;
  float dens = cloudDensity(base, octaves);
  float edge = 1.0 - cover * 0.54;
  float coverage = smoothstep(edge, edge + 0.22, dens) * hMask;

  // Cheap thickness pass — samples along view on the cloud shell (no seam; 3D coords).
  float thickness = 0.0;
  float lightAcc = 0.0;
  float trans = 1.0;
  for (int i = 0; i < 4; i++) {
    float t = float(i) * 0.11 + 0.06;
    vec3 sampleP = base + rd * t + sunDir * (float(i) * 0.04);
    float d = smoothstep(edge - 0.04, edge + 0.2, cloudDensity(sampleP, max(2, octaves - 1)));
    float sunLit = pow(max(dot(normalize(sampleP), sunDir), 0.0), 0.75);
    float shadow = cloudDensity(sampleP + sunDir * 0.42, max(2, octaves - 2));
    float lit = mix(0.38, 1.0, sunLit) * (1.0 - shadow * 0.45);
    lightAcc += trans * d * lit * 0.28;
    trans *= 1.0 - d * 0.38;
    thickness += d;
  }
  thickness = 1.0 - exp(-thickness * 1.35);
  float alpha = clamp(coverage * 0.72 + thickness * 0.48, 0.0, 1.0);

  float mu = max(dot(rd, sunDir), 0.0);
  vec3 cloudCol = mix(uCloudDark, uCloudLit, 0.42 + 0.58 * pow(mu, 0.82));
  cloudCol = mix(cloudCol, uCloudLit * 1.08, lightAcc * 0.65);
  return cloudCol * alpha;
}

void main() {
  vec3 rd = normalize(vDir);
  vec3 sunDir = normalize(uSun);

  float v = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = texture2D(uGrad, vec2(0.5, v)).rgb;

  vec3 scatter = atmosphericScatter(rd, sunDir);
  col = mix(col, scatter, uAtmoBlend);

  float groundBand = 1.0 - smoothstep(-0.08, 0.2, rd.y);
  col = mix(col, uGroundBounce, groundBand * uGroundBounceMix);

  float horizonBand = 1.0 - smoothstep(0.02, 0.28, rd.y);
  col = mix(col, uHorizonGlow, horizonBand * uHorizonStrength * 0.55);

  float zenith = smoothstep(0.45, 1.0, v);
  col = mix(col, col * vec3(0.92, 0.97, 1.08), zenith * uZenithBoost);

  if (uDust > 0.001) {
    float dustBand = pow(1.0 - smoothstep(-0.04, 0.36, rd.y), 1.35);
    vec3 dustCol = mix(uHorizonGlow, vec3(0.96, 0.93, 0.86), 0.32);
    col = mix(col, dustCol, dustBand * uDust * 0.48);
  }

  float mu = max(dot(rd, sunDir), 0.0);
  float bloom = max(0.2, uSunBloom);
  col += uSunColor * (pow(mu, 8.0) * 0.07 + pow(mu, 56.0) * 0.16 + pow(mu, 900.0) * 1.85) * bloom;
  col += uSunColor * vec3(1.0, 0.95, 0.86) * pow(mu, 3.2) * 0.04 * bloom;

  int octaves = int(clamp(uCloudDetail, 3.0, 6.0));
  vec3 wind = vec3(uTime * 0.014, uTime * 0.0035, uTime * 0.009);
  vec3 clouds = volumetricClouds(rd, sunDir, wind, uCloudCover, uCloudScale, octaves);
  col = mix(col, clouds, clamp(length(clouds), 0.0, 1.0));

  gl_FragColor = vec4(col * uExposure, 1.0);
}
`;

/**
 * Camera-locked sky dome. Place it in the scene once.
 * @returns {THREE.Mesh}
 */
export function createSky() {
  const cloudDetail = (VISUAL.tier || 0) >= 13 || VISUAL.cinemaRealism ? 5 : 4;
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uGrad: { value: null },
      uSun: { value: new THREE.Vector3(0.6, 0.72, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(1.0, 0.93, 0.76) },
      uCloudLit: { value: new THREE.Color(1.0, 0.97, 0.92) },
      uCloudDark: { value: new THREE.Color(0.55, 0.56, 0.6) },
      uHorizonGlow: { value: new THREE.Color(0.92, 0.78, 0.58) },
      uHorizonStrength: { value: 0.38 },
      uDust: { value: 0 },
      uCloudCover: { value: 0.28 },
      uCloudScale: { value: 1.6 },
      uExposure: { value: 1.0 },
      uTime: { value: 0 },
      uGroundBounce: { value: new THREE.Color(0.55, 0.42, 0.28) },
      uGroundBounceMix: { value: 0.28 },
      uSunBloom: { value: 1.0 },
      uZenithBoost: { value: 0.28 },
      uRayleigh: { value: 1.0 },
      uMie: { value: 0.85 },
      uAtmoBlend: { value: 0.42 },
      uCloudDetail: { value: cloudDetail },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), mat);
  mesh.scale.setScalar(40);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2000;
  mesh.name = "pbr-sky";
  return mesh;
}

/**
 * Turn a LIGHTING entry into a painted vertical ramp.
 *
 * @param {object} L LIGHTING entry
 * @returns {THREE.Texture|null}
 */
function skyRamp(L) {
  const fog = new THREE.Color(L.fog != null ? L.fog : 0xc9b48a);
  const high = new THREE.Color(L.skyBack != null ? L.skyBack : 0x7aa8d0);
  const zenith = L.skyZenith != null ? new THREE.Color(L.skyZenith) : high.clone().multiplyScalar(0.68);
  const haze = fog.clone().lerp(new THREE.Color(0xffffff), 0.08);
  const ground = fog.clone().multiplyScalar(0.52);
  const mid = fog.clone().lerp(high, 0.48);

  if (L.skyGradient && L.skyGradient.length >= 3) {
    const key = `sky40|${L.skyGradient.map((s) => `${s[0]}:${s[1]}`).join("|")}`;
    return gradientTexture(key, L.skyGradient, 512);
  }

  const key = `sky40|${hex(zenith)}|${hex(high)}|${hex(haze)}|${hex(ground)}|${hex(mid)}`;
  return gradientTexture(
    key,
    [
      [0.0, `#${hex(ground)}`],
      [0.42, `#${hex(ground)}`],
      [0.48, `#${hex(haze)}`],
      [0.52, `#${hex(mid)}`],
      [0.62, `#${hex(fog.clone().lerp(high, 0.55))}`],
      [0.78, `#${hex(high)}`],
      [1.0, `#${hex(zenith)}`],
    ],
    512
  );
}

/**
 * @param {THREE.Color} c
 * @returns {string} six-digit hex without the leading hash
 */
function hex(c) {
  return c.getHexString();
}

/**
 * Push stage atmosphere onto the sky uniforms.
 * @param {THREE.Mesh} mesh
 * @param {object} L LIGHTING entry
 */
export function applySky(mesh, L) {
  if (!mesh || !mesh.material || !mesh.material.uniforms || !L) return;
  try {
    const u = mesh.material.uniforms;
    const dir = Array.isArray(L.sunDir) && L.sunDir.length === 3 ? L.sunDir : [0.6, 0.72, 0.3];
    u.uSun.value.set(dir[0], dir[1], dir[2]).normalize();
    u.uGrad.value = skyRamp(L);
    u.uSunColor.value
      .setHex(L.sun != null ? L.sun : 0xfff1c8)
      .convertLinearToSRGB()
      .multiplyScalar(L.sunSkyBoost != null ? L.sunSkyBoost : 0.85);
    u.uCloudLit.value.setHex(0xffffff).convertLinearToSRGB();
    u.uCloudDark.value
      .setHex((VISUAL.tier || 0) >= 13 || VISUAL.cinemaRealism ? 0xb8c4d4 : 0xd0d8e4)
      .convertLinearToSRGB();
    u.uCloudCover.value = L.cloudCover != null ? L.cloudCover : 0.28;
    u.uCloudScale.value = L.cloudScale != null ? L.cloudScale : 1.6;
    const fogHex = L.fog != null ? L.fog : 0xc9b48a;
    u.uHorizonGlow.value
      .setHex(L.horizonGlow != null ? L.horizonGlow : fogHex)
      .convertLinearToSRGB();
    u.uHorizonStrength.value = L.horizonStrength != null ? L.horizonStrength : 0.38;
    u.uDust.value =
      VISUAL.envAtmosphere === false ? 0 : L.dustStrength != null ? L.dustStrength : 0;
    u.uGroundBounce.value
      .setHex(L.hemiGround != null ? L.hemiGround : L.fog != null ? L.fog : 0xc9b48a)
      .convertLinearToSRGB()
      .multiplyScalar(0.85);
    u.uGroundBounceMix.value = L.groundBounceMix != null ? L.groundBounceMix : 0.28;
    u.uSunBloom.value = L.sunBloom != null ? L.sunBloom : 1.0;
    u.uZenithBoost.value = L.zenithBoost != null ? L.zenithBoost : 0.28;
    u.uRayleigh.value = L.skyRayleigh != null ? L.skyRayleigh : 1.0;
    u.uMie.value = L.skyMie != null ? L.skyMie * 180.0 : 0.75;
    u.uAtmoBlend.value = L.skyAtmoBlend != null ? L.skyAtmoBlend : 0.38;
    const e = L.skyExposure != null ? L.skyExposure : 0.46;
    u.uExposure.value = Math.max(0.75, Math.min(1.32, 0.74 + e * 0.55));
    u.uCloudDetail.value = (VISUAL.tier || 0) >= 13 || VISUAL.cinemaRealism ? 5 : 4;
  } catch (err) {
    console.warn("applySky failed", err);
  }
}

/**
 * @param {THREE.Mesh} mesh
 * @param {number} seconds
 */
export function tickSky(mesh, seconds) {
  if (mesh && mesh.material && mesh.material.uniforms) {
    mesh.material.uniforms.uTime.value = seconds;
  }
}
