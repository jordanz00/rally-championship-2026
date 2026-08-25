/**
 * Painted sky — Rayleigh/Mie atmosphere + raymarched volumetric cumulus.
 *
 * WHO THIS IS FOR: the renderer.
 * WHAT IT DOES: fills the frame with a per-course gradient, analytic scatter,
 *   and a planet-shell raymarch through 3D noise (Beer-Lambert + sun shadow).
 * HOW IT CONNECTS: game.js calls createSky() once, applySky() per stage, and
 *   tickSky() every frame. setSkyQuality() follows the perf tier.
 *
 * BUDGET (2020-class laptop / Chrome 60 Hz):
 *   Sky is a unit sphere (32×20) drawn first (depthWrite off). Clouds run only
 *   on sky fragments (rd.y > 0). Cinema: 6 view steps × 2 light samples, 3-octave
 *   fBm + cheap Worley. Low/min tier: 4 view × 1 light, 2-octave, no Worley.
 *   Not a 128-step fullscreen volume — fixed steps along the shell, dithered.
 *   Horizon path is longer, so each step covers more distance (froxel-style).
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../vendor/three.module.js";
import { gradientTexture } from "./gfx/saturn.js?v=1";
import { VISUAL } from "./config.js?v=138";

/**
 * GPU budget + technique — QA greps this object; do not rename keys.
 */
export const CLOUD_BUDGET = {
  technique: "planet-shell-raymarch",
  maxViewSteps: 8,
  cinemaViewSteps: 6,
  lowViewSteps: 4,
  maxLightSteps: 2,
  notes:
    "6×2 cinema / 4×1 low. Early-out below horizon and when transmittance < 0.02. No full-screen 128-step march.",
};

/**
 * Per-stage cumulus palettes. Colours match time-of-day / scenery, not a nebula.
 * cover is a floor — LIGHTING.cloudCover still wins when it is higher.
 */
export const STAGE_CLOUD_PALETTES = {
  desert: { lit: 0xfff1dc, dark: 0x8a7464, absorb: 1.05, silver: 0.62, cover: 0.42 },
  forest: { lit: 0xf4f7fb, dark: 0x5e6c78, absorb: 1.22, silver: 0.5, cover: 0.5 },
  mountain: { lit: 0xf8fbff, dark: 0x536878, absorb: 0.95, silver: 0.68, cover: 0.36 },
  lakeside: { lit: 0xeef6f8, dark: 0x5c7380, absorb: 1.12, silver: 0.54, cover: 0.44 },
  title: { lit: 0xfff6ec, dark: 0x6a7684, absorb: 1.02, silver: 0.64, cover: 0.44 },
};

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
uniform vec3 uWind;
uniform float uCloudSteps;
uniform float uLightSteps;
uniform float uAbsorb;
uniform float uSilver;
uniform float uUseWorley;

varying vec3 vDir;

const float PLANET_R = 8.0;
const float CLOUD_INNER = 8.12;
const float CLOUD_OUTER = 8.92;
const int MAX_VIEW = 8;
const int MAX_LIGHT = 2;

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
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    v += a * noise3(p);
    p = rot * p * 2.04 + vec3(1.7, 1.3, 2.1);
    a *= 0.5;
  }
  return v;
}

float worleyPuff(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  float d = 1.0;
  for (int z = 0; z <= 1; z++) {
    for (int y = 0; y <= 1; y++) {
      for (int xx = 0; xx <= 1; xx++) {
        vec3 g = vec3(float(xx), float(y), float(z));
        float h = hash13(i + g);
        vec3 o = vec3(h, fract(h * 17.13), fract(h * 31.71));
        vec3 r = g + o - f;
        d = min(d, dot(r, r));
      }
    }
  }
  return 1.0 - clamp(d * 1.35, 0.0, 1.0);
}

float hgPhase(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / pow(max(1e-4, 1.0 + g2 - 2.0 * g * mu), 1.5);
}

vec2 raySphere(vec3 ro, vec3 rd, float rad) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1.0, -1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
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

float cloudHeightMask(vec3 p) {
  float h = (length(p) - CLOUD_INNER) / max(CLOUD_OUTER - CLOUD_INNER, 0.001);
  float base = smoothstep(0.0, 0.16, h);
  float top = 1.0 - smoothstep(0.52, 1.0, h);
  return base * top * mix(0.72, 1.18, h);
}

float cloudDensity(vec3 p, int octaves, bool useWorley) {
  float hMask = cloudHeightMask(p);
  if (hMask < 0.001) return 0.0;
  vec3 q = p * (0.36 * uCloudScale);
  vec3 view = normalize(p - vec3(0.0, PLANET_R, 0.0));
  float az = atan(view.z, view.x);
  float el = view.y;
  float dirMacro = fbm(vec3(az * 2.7, el * 4.0, 0.16), octaves);
  float n = fbm(q, octaves);
  float ridged = 1.0 - abs(fbm(q * 0.7 + vec3(9.1, 2.4, 4.7), max(2, octaves - 1)) * 2.0 - 1.0);
  float shape = n * 0.38 + ridged * 0.62;
  if (useWorley) {
    float cells = worleyPuff(q * 0.9 + vec3(2.2, 0.4, 1.1));
    shape = mix(shape, cells, 0.34);
  }
  float erosion = fbm(q * 2.0 + vec3(-1.4, 3.1, 0.6), max(2, octaves - 1));
  shape -= erosion * 0.12 * (1.0 - hMask);
  float cover = clamp(uCloudCover, 0.0, 1.0);
  float islands = smoothstep(0.38 - cover * 0.12, 0.7 - cover * 0.08, dirMacro);
  shape *= islands;
  float d = smoothstep(0.18, 0.52, shape) * hMask;
  return clamp(d, 0.0, 1.0);
}

float sunOptical(vec3 p, vec3 sunDir, float stepHint, int octaves, bool useWorley) {
  int lights = int(clamp(uLightSteps, 1.0, 2.0));
  float od = 0.0;
  for (int i = 0; i < MAX_LIGHT; i++) {
    if (i >= lights) break;
    float t = (float(i) + 0.55) * stepHint * 1.35;
    od += cloudDensity(p + sunDir * t, max(2, octaves - 1), useWorley && i == 0);
  }
  return od / max(float(lights), 1.0);
}

vec4 volumetricClouds(vec3 rd, vec3 sunDir) {
  if (rd.y < 0.02 || uCloudCover < 0.02) return vec4(0.0);

  vec3 ro = vec3(0.0, PLANET_R, 0.0);
  vec2 outer = raySphere(ro, rd, CLOUD_OUTER);
  if (outer.y < outer.x || outer.y < 0.0) return vec4(0.0);
  float t0 = max(outer.x, 0.0);
  float t1 = outer.y;
  vec2 inner = raySphere(ro, rd, CLOUD_INNER);
  if (inner.y > inner.x && inner.y > 0.0) {
    t0 = max(inner.y, 0.0);
    t1 = outer.y;
  }
  if (t1 <= t0) return vec4(0.0);

  int steps = int(clamp(uCloudSteps, 3.0, 8.0));
  int octaves = int(clamp(uCloudDetail, 2.0, 5.0));
  bool useWorley = uUseWorley > 0.5;
  float span = t1 - t0;
  float dt = span / float(steps);
  float dither = hash13(rd * 131.7 + vec3(uTime * 0.07));
  float t = t0 + dt * (0.18 + dither * 0.64);

  vec3 wind = uWind * uTime * 0.011;
  float mu = dot(rd, sunDir);
  float phase = 0.72 * hgPhase(mu, 0.48) + 0.28 * hgPhase(mu, -0.18);
  phase = clamp(phase, 0.15, 2.4);

  vec3 scatter = vec3(0.0);
  float trans = 1.0;
  float absorb = max(0.35, uAbsorb);

  for (int i = 0; i < MAX_VIEW; i++) {
    if (i >= steps || trans < 0.02) break;
    vec3 p = ro + rd * t + wind;
    float dens = cloudDensity(p, octaves, useWorley);
    if (dens > 0.004) {
      float stepOd = dens * dt * absorb * 1.15;
      float beers = exp(-stepOd);
      float powder = 1.0 - exp(-dens * 2.2);
      float shadow = sunOptical(p, sunDir, dt, octaves, useWorley);
      float sunVis = exp(-shadow * absorb * 1.55);
      float wrap = mix(0.38, 1.0, sunVis);
      vec3 ambient = mix(uCloudDark, uCloudLit * 0.78, 0.28 + 0.5 * cloudHeightMask(p));
      vec3 direct = uCloudLit * wrap * phase * (0.7 + uSilver * powder);
      vec3 inS = (ambient + direct * sunVis) * dens;
      scatter += trans * inS * (1.0 - beers) / max(dens, 0.04);
      trans *= beers;
    }
    t += dt;
  }

  float alpha = clamp(1.0 - trans, 0.0, 1.0);
  float horizonFade = smoothstep(-0.01, 0.05, rd.y);
  alpha *= horizonFade;
  scatter *= 1.25;
  return vec4(scatter, alpha);
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

  vec4 clouds = volumetricClouds(rd, sunDir);
  col = col * (1.0 - clouds.a) + clouds.rgb;

  gl_FragColor = vec4(col * uExposure, 1.0);
}
`;

function cinemaCloud() {
  return (VISUAL.tier || 0) >= 13 || VISUAL.cinemaRealism;
}

/**
 * Camera-locked sky dome. Place it in the scene once.
 * @returns {THREE.Mesh}
 */
export function createSky() {
  const hi = cinemaCloud();
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
      uCloudCover: { value: 0.34 },
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
      uCloudDetail: { value: hi ? 4 : 3 },
      uWind: { value: new THREE.Vector3(1.2, 0, 0.4) },
      uCloudSteps: { value: hi ? CLOUD_BUDGET.cinemaViewSteps : 5 },
      uLightSteps: { value: hi ? 2 : 1 },
      uAbsorb: { value: 1.12 },
      uSilver: { value: 0.55 },
      uUseWorley: { value: hi ? 1 : 0 },
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
  mesh.userData.volumetricClouds = true;
  mesh.userData.cloudTechnique = CLOUD_BUDGET.technique;
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
 * Pick a cumulus palette from the stage id or LIGHTING fingerprints.
 * @param {object} L
 * @param {string} [stageId]
 */
function cloudPalette(L, stageId) {
  if (stageId && STAGE_CLOUD_PALETTES[stageId]) return STAGE_CLOUD_PALETTES[stageId];
  if (L && L.bodyEnv != null) return STAGE_CLOUD_PALETTES.title;
  const z = L && L.skyZenith;
  if (z === 0x1e6aa8) return STAGE_CLOUD_PALETTES.desert;
  if (z === 0x1868b0) return STAGE_CLOUD_PALETTES.forest;
  if (z === 0x1058b0) return STAGE_CLOUD_PALETTES.mountain;
  if (z === 0x1468a8) return STAGE_CLOUD_PALETTES.lakeside;
  return STAGE_CLOUD_PALETTES.desert;
}

/**
 * Push stage atmosphere onto the sky uniforms.
 * @param {THREE.Mesh} mesh
 * @param {object} L LIGHTING entry
 * @param {string} [stageId]
 */
export function applySky(mesh, L, stageId) {
  if (!mesh || !mesh.material || !mesh.material.uniforms || !L) return;
  try {
    const u = mesh.material.uniforms;
    const pal = cloudPalette(L, stageId);
    const dir = Array.isArray(L.sunDir) && L.sunDir.length === 3 ? L.sunDir : [0.6, 0.72, 0.3];
    u.uSun.value.set(dir[0], dir[1], dir[2]).normalize();
    u.uGrad.value = skyRamp(L);
    u.uSunColor.value
      .setHex(L.sun != null ? L.sun : 0xfff1c8)
      .convertLinearToSRGB()
      .multiplyScalar(L.sunSkyBoost != null ? L.sunSkyBoost : 0.85);
    const litHex = L.cloudLit != null ? L.cloudLit : pal.lit;
    const darkHex = L.cloudDark != null ? L.cloudDark : pal.dark;
    u.uCloudLit.value.setHex(litHex).convertLinearToSRGB();
    u.uCloudDark.value.setHex(darkHex).convertLinearToSRGB();
    let cover = L.cloudCover != null ? L.cloudCover : pal.cover;
    if (stageId === "title" || L.bodyEnv != null) cover = Math.max(cover, pal.cover);
    else cover = Math.max(cover, pal.cover * 0.85);
    u.uCloudCover.value = cover;
    const scale = L.cloudScale != null ? L.cloudScale : 1.6;
    u.uCloudScale.value = stageId === "title" || L.bodyEnv != null ? Math.max(scale, 1.55) : Math.max(scale, 1.35);
    u.uAbsorb.value = pal.absorb;
    u.uSilver.value = pal.silver;
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
    const wind = Array.isArray(L.wind) && L.wind.length >= 3 ? L.wind : [1.2, 0, 0.4];
    u.uWind.value.set(wind[0], wind[1] || 0, wind[2]);
    const hi = cinemaCloud();
    u.uCloudDetail.value = hi ? 4 : 3;
    u.uCloudSteps.value = hi ? CLOUD_BUDGET.cinemaViewSteps : 5;
    u.uLightSteps.value = hi ? 2 : 1;
    u.uUseWorley.value = hi ? 1 : 0;
  } catch (err) {
    console.warn("applySky failed", err);
  }
}

/**
 * Drop raymarch quality when the integrated GPU is in the red.
 * @param {THREE.Mesh} mesh
 * @param {string} perfTier high | medium | low | min
 */
export function setSkyQuality(mesh, perfTier) {
  if (!mesh || !mesh.material || !mesh.material.uniforms) return;
  const u = mesh.material.uniforms;
  const hi = cinemaCloud();
  if (perfTier === "min" || perfTier === "low") {
    u.uCloudSteps.value = CLOUD_BUDGET.lowViewSteps;
    u.uLightSteps.value = 1;
    u.uCloudDetail.value = 2;
    u.uUseWorley.value = 0;
  } else if (perfTier === "medium") {
    u.uCloudSteps.value = 5;
    u.uLightSteps.value = 1;
    u.uCloudDetail.value = 3;
    u.uUseWorley.value = 0;
  } else {
    u.uCloudSteps.value = hi ? CLOUD_BUDGET.cinemaViewSteps : 5;
    u.uLightSteps.value = hi ? 2 : 1;
    u.uCloudDetail.value = hi ? 4 : 3;
    u.uUseWorley.value = hi ? 1 : 0;
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
