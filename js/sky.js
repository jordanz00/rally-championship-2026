/**
 * Sky — analytic Rayleigh/Mie atmosphere + fluffy raymarched cumulus + lens flare.
 *
 * WHO THIS IS FOR: the renderer.
 * WHAT IT DOES: fills the frame with a single-scattering atmosphere (air-mass
 *   driven luminance gradient, Rayleigh + Mie phase, sun-relative forward
 *   scatter) and marches a cloud shell lit from the SAME sun vector the shadow
 *   rig uses. Dense Worley-sculpted cumulus cores leave clear blue gaps so the
 *   sun peeks through; a procedural lens flare (streak + ghosts) rides the
 *   camera forward. Horizon converges onto scene fog colour.
 * HOW IT CONNECTS: game.js calls createSky() once, applySky() per stage, and
 *   tickSky(mesh, t, camFwd) every frame. setSkyQuality() follows the perf tier.
 *
 * WHAT THE CLOUDS ACTUALLY ARE (do not overstate this):
 *   A real raymarch — 4 to 16 view steps through a spherical shell, with
 *   Beer-Lambert extinction, 1–3 shadow samples toward the sun, dual-lobe HG
 *   phase, and a cheap multiple-scatter lift for soft white interiors. Procedural
 *   value + Worley noise (not a 3D texture / film volume). Reads as fluffy volume
 *   because density has opaque cauliflower cores and soft rims — not smoke sheets.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../vendor/three.module.js";
import { gradientTexture } from "./gfx/saturn.js?v=1";
import { VISUAL } from "./config.js?v=167";

/**
 * GPU budget + technique — QA greps this object; do not rename keys.
 */
export const CLOUD_BUDGET = {
  technique: "planet-shell-raymarch",
  maxViewSteps: 10,
  cinemaViewSteps: 10,
  mediumViewSteps: 8,
  lowViewSteps: 5,
  minViewSteps: 3,
  maxLightSteps: 2,
  notes:
    "10x2 high / 8x2 medium / 5x1 low / 3x1 min (Sprint 536 M1 budget). Fluffy Worley cores + lens flare. Chord capped at CLOUD_MAX_SPAN. Early-out below horizon / transmittance < 0.02.",
};

/**
 * Per-stage cumulus palettes — bright lit tops, cool sky-lit shadows (not mud).
 * Lower absorb + higher silver = light peeks through thin edges / sun rims.
 */
export const STAGE_CLOUD_PALETTES = {
  desert: { lit: 0xfffaf6, dark: 0x7a94b4, absorb: 2.35, silver: 1.08, cover: 0.22 },
  forest: { lit: 0xf8fcff, dark: 0x6e849e, absorb: 2.65, silver: 0.95, cover: 0.3 },
  mountain: { lit: 0xf7fbff, dark: 0x6a829c, absorb: 2.45, silver: 1.05, cover: 0.24 },
  lakeside: { lit: 0xf4fafd, dark: 0x70869c, absorb: 2.55, silver: 0.98, cover: 0.28 },
  title: { lit: 0xfff6ea, dark: 0x5a708c, absorb: 2.7, silver: 1.1, cover: 0.36 },
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
uniform vec3 uFogColor;
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
uniform float uMieG;
uniform float uTurbidity;
uniform vec3 uCamFwd;
uniform float uLensFlare;

varying vec3 vDir;

/* Shell geometry, in units where the planet radius is 8. Slightly thicker shell
   so cumulus read as tall fluffy towers instead of a thin smoke sheet. */
const float PLANET_R = 8.0;
const float CLOUD_INNER = 8.05;
const float CLOUD_OUTER = 9.55;
const int MAX_VIEW = 10;
const int MAX_LIGHT = 2;

/**
 * Longest chord we will integrate, in shell units.
 */
const float CLOUD_MAX_SPAN = 3.15;

const float SCATTER_GAIN = 3.55;

/**
 * Contrast stretch on the weather field — higher = distinct puff islands with
 * clear blue between (anti-smoke sheet).
 */
const float WEATHER_CONTRAST = 2.85;

const float WEATHER_FREQ = 0.72;
const float BODY_FREQ = 2.15;
const float DETAIL_FREQ = 5.1;

const float CLOUD_SUN_GAIN = 0.58;
const float CLOUD_AMBIENT_GAIN = 0.68;

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
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

/**
 * fBm normalised to roughly 0..1 with a mean near 0.5.
 *
 * THIS IS THE FIX for the opaque-sky defect. Raw fbm() with halving gain sums
 * to (1 - 2^-octaves), so a 3-octave field peaks at 0.875 and averages 0.4375.
 * The old shader compared that field against thresholds derived as
 * (0.46 - cover * 0.48), which for any usable cover landed BELOW the field mean
 * — so the coverage mask was open almost everywhere and the sky was overcast at
 * every setting. Dividing by the octave weight makes the field's statistics
 * known, so a threshold expressed as a sky FRACTION actually behaves like one.
 */
float fbmN(vec3 p, int octaves) {
  float w = 1.0 - pow(0.5, float(octaves));
  return fbm(p, octaves) / max(w, 0.001);
}

float worleyPuff(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  float d = 1.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int xx = -1; xx <= 1; xx++) {
        vec3 g = vec3(float(xx), float(y), float(z));
        float h = hash13(i + g);
        vec3 o = vec3(h, fract(h * 17.13), fract(h * 31.71));
        vec3 r = g + o - f;
        d = min(d, dot(r, r));
      }
    }
  }
  return 1.0 - clamp(d * 1.15, 0.0, 1.0);
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

/**
 * Relative air mass along a view ray, normalised to 1 at the zenith.
 *
 * The path through the atmosphere lengthens as the ray flattens, which is the
 * whole reason a clear sky is deep blue overhead and pale at the skyline. Doing
 * this properly is what replaces "make the horizon lighter by hand".
 *
 * WHY THIS IS NOT KASTEN-YOUNG: the true geometric air mass reaches about 38 at
 * the horizon. Fed through single scattering that predicts a horizon roughly 13x
 * brighter than the zenith, where a real clear sky is 3-5x — because reality
 * gets there via multiple scattering and extinction of distant scattered light,
 * neither of which a one-bounce model has. Using the geometric value clipped the
 * skyline to white. This bounded form tops out near 5.5 air masses, which lands
 * the gradient where a photograph does.
 */
float airMass(float cosZenith) {
  return 1.0 / (max(cosZenith, 0.0) * 0.82 + 0.18);
}

/**
 * Single-scattering sky radiance.
 *
 * Rayleigh gives the blue and the 1 + cos^2 angular term; Mie gives the warm
 * aureole around the sun and the haze that thickens toward the skyline. Both are
 * attenuated by the same air mass, so the luminance gradient, the colour
 * gradient and the sun glow all come from one consistent geometry rather than
 * three hand-painted bands.
 */
vec3 atmosphericScatter(vec3 rd, vec3 sunDir) {
  float cz = max(rd.y, 0.0);
  float am = airMass(cz);
  float mu = dot(rd, sunDir);
  float sunAm = airMass(max(sunDir.y, 0.02));

  // Rayleigh extinction is wavelength^-4; richer blue zenith coeffs.
  vec3 betaR = vec3(5.5, 13.0, 33.8) * 0.011 * uRayleigh;
  // Mie is broadly wavelength independent and scales with haze/turbidity.
  vec3 betaM = vec3(1.0) * (0.0065 + 0.0035 * max(uTurbidity - 1.0, 0.0));
  vec3 betaT = betaR + betaM;

  // Sunlight reaching the view ray, reddened by its own slant path.
  vec3 sunT = exp(-betaT * sunAm * 0.48);

  float phaseR = 0.0596831 * (1.0 + mu * mu);
  float phaseM = 0.0796 * min(hgPhase(mu, clamp(uMieG, 0.3, 0.9)), 28.0);

  vec3 tau = betaT * am;
  vec3 depth = vec3(1.0) - exp(-tau);
  vec3 scatterAlbedo = (betaR * phaseR + betaM * phaseM * uMie) / betaT;
  vec3 col = scatterAlbedo * depth * sunT * uSunColor * SCATTER_GAIN;

  // Warm ground bounce only in the lowest band — keeps zenith clean blue.
  float bounce = pow(1.0 - cz, 5.5) * 0.26;
  col = mix(col, uHorizonGlow * (0.28 + 0.42 * uSunColor.g), bounce);
  return col;
}

/** 0..1 height across the cloud shell. */
float shellH(vec3 p) {
  return clamp((length(p) - CLOUD_INNER) / max(CLOUD_OUTER - CLOUD_INNER, 0.001), 0.0, 1.0);
}

/**
 * Tall fluffy cumulus profile: crisp base, fat mid belly, eroded cauliflower top.
 */
float heightProfile(float h) {
  float base = smoothstep(0.0, 0.07, h);
  float belly = smoothstep(0.06, 0.28, h) * (1.0 - smoothstep(0.42, 0.95, h));
  float crown = 1.0 - smoothstep(0.55, 1.0, h);
  return base * mix(belly, crown, 0.28) * (0.85 + 0.15 * belly);
}

/**
 * Fluffy cumulus density — opaque cauliflower cores, soft rims, clear gaps.
 * Weather mask carves islands; Worley + ridged detail sells billows (not smoke).
 */
float cloudDensity(vec3 p, int octaves, bool useWorley) {
  float h = shellH(p);
  float prof = heightProfile(h);
  if (prof < 0.004) return 0.0;

  vec3 q = p * (0.52 * uCloudScale);

  float w = fbmN(q * WEATHER_FREQ, 3);
  w = clamp((w - 0.5) * WEATHER_CONTRAST + 0.5, 0.0, 1.0);
  // Narrower cover window → distinct puff islands, blue sky between.
  float thr = mix(0.96, 0.22, clamp(uCloudCover, 0.0, 1.0));
  float mask = smoothstep(thr, thr + 0.14, w);
  if (mask < 0.004) return 0.0;

  float body = fbmN(q * BODY_FREQ, octaves);
  if (useWorley) {
    float cells = worleyPuff(q * BODY_FREQ * 0.85 + vec3(2.2, 0.4, 1.1));
    float cells2 = worleyPuff(q * BODY_FREQ * 1.55 + vec3(5.1, 1.8, 0.3));
    body = mix(body, max(cells, cells2 * 0.85), 0.58);
  }
  float ridged = 1.0 - abs(fbmN(q * DETAIL_FREQ + vec3(9.1, 2.4, 4.7), max(2, octaves - 1)) * 2.0 - 1.0);
  float shape = body * 0.48 + ridged * 0.52;

  // Carve cauliflower crowns.
  shape -= smoothstep(0.38, 1.0, h) * 0.28;
  // Soft underside fade keeps bases from reading as floating smoke blobs.
  shape *= 0.72 + 0.28 * smoothstep(0.05, 0.22, h);

  // Dense cores (pow) + soft edge window — fluffy volume, not grey fog.
  float core = smoothstep(0.28, 0.52, shape * mask);
  float d = pow(core, 0.78) * prof;
  return clamp(d, 0.0, 1.0);
}

/**
 * Optical depth toward the sun — self-shadow for fluffy form.
 */
float sunOptical(vec3 p, vec3 sunDir, int octaves, bool useWorley) {
  int lights = int(clamp(uLightSteps, 1.0, 2.0));
  float od = 0.0;
  float stride = 0.22;
  for (int i = 0; i < MAX_LIGHT; i++) {
    if (i >= lights) break;
    float t = (float(i) + 0.55) * stride * (1.0 + float(i) * 1.35);
    od += cloudDensity(p + sunDir * t, max(2, octaves - 1), useWorley && i == 0) * stride * (1.0 + float(i) * 1.25);
  }
  return od;
}

/**
 * March the cloud shell. Premultiplied scatter in .rgb, coverage in .a.
 */
vec4 volumetricClouds(vec3 rd, vec3 sunDir) {
  if (rd.y < 0.004 || uCloudCover < 0.02) return vec4(0.0);

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

  float span = min(t1 - t0, CLOUD_MAX_SPAN);

  int steps = int(clamp(uCloudSteps, 4.0, 16.0));
  int octaves = int(clamp(uCloudDetail, 2.0, 5.0));
  bool useWorley = uUseWorley > 0.5;
  float dt = span / float(steps);
  float t = t0 + dt * 0.5;

  vec3 wind = uWind * uTime * 0.0048;
  float mu = dot(rd, sunDir);
  float phase = 0.65 * hgPhase(mu, 0.68) + 0.35 * hgPhase(mu, -0.18);
  phase = clamp(phase, 0.4, 2.6);

  float sigma = max(0.7, uAbsorb);
  float stepComp = clamp(uCloudSteps / 16.0, 0.55, 1.0);
  vec3 scatter = vec3(0.0);
  float trans = 1.0;

  for (int i = 0; i < MAX_VIEW; i++) {
    if (i >= steps || trans < 0.02) break;
    vec3 p = ro + rd * t + wind;
    float dens = cloudDensity(p, octaves, useWorley);
    if (dens > 0.004) {
      float h = shellH(p);
      float stepOd = dens * dt * sigma;
      float beers = exp(-stepOd);

      float shadow = sunOptical(p, sunDir, octaves, useWorley);
      float sunVis = exp(-shadow * sigma * 0.92);
      float powder = 1.0 - exp(-dens * 6.5);

      // Soft white multiple-scatter lift in lit fluff interiors (anti-smoke grey).
      float ms = dens * (0.22 + 0.45 * sunVis) * (0.35 + 0.65 * h);

      vec3 ambient = mix(uCloudDark, uCloudLit * 0.78, 0.28 + 0.58 * h);
      ambient += uGroundBounce * (0.75 * (1.0 - h)) * uGroundBounceMix;
      ambient *= CLOUD_AMBIENT_GAIN * (1.0 + ms);

      vec3 sunTint = mix(vec3(1.0), uSunColor, 0.32);
      vec3 direct = sunTint * uCloudLit * CLOUD_SUN_GAIN * phase * sunVis
        * (0.38 + uSilver * powder * 0.95 * stepComp);

      // Extra silver lining when looking toward the sun through a rim.
      float rim = powder * pow(max(mu, 0.0), 6.0) * uSilver * 0.55;
      direct += sunTint * uCloudLit * rim * sunVis;

      vec3 inS = ambient + direct;
      scatter += trans * inS * (1.0 - beers);
      // Soften extinction on thin edges so the sun can peek through gaps.
      float edgeSoft = mix(0.82, 1.0, dens);
      trans *= mix(1.0, beers, edgeSoft);
    }
    t += dt;
  }

  float alpha = clamp(1.0 - trans, 0.0, 1.0);

  // Sun peek: residual transmittance near the disc blooms through the fluff.
  float peek = pow(max(mu, 0.0), 48.0) * trans * 1.35;
  scatter += uSunColor * uCloudLit * peek * 0.55;

  float haze = smoothstep(0.0, 0.20, rd.y);
  scatter = mix(uFogColor * alpha, scatter, 0.22 + 0.78 * haze);
  alpha *= smoothstep(0.0, 0.035, rd.y) * (0.22 + 0.78 * haze);

  return vec4(scatter, alpha);
}

/**
 * Procedural lens flare — anamorphic streak + chromatic ghosts along the
 * sun↔anti-sun axis in camera-forward projected space.
 */
vec3 lensFlare(vec3 rd, vec3 sunDir) {
  if (uLensFlare < 0.01) return vec3(0.0);
  vec3 fwd = normalize(uCamFwd);
  float sunInFront = dot(sunDir, fwd);
  if (sunInFront < 0.08) return vec3(0.0);

  vec3 right = cross(fwd, vec3(0.0, 1.0, 0.0));
  if (dot(right, right) < 1e-4) right = cross(fwd, vec3(1.0, 0.0, 0.0));
  right = normalize(right);
  vec3 up = cross(right, fwd);

  float sw = max(dot(sunDir, fwd), 0.04);
  float pw = max(dot(rd, fwd), 0.04);
  vec2 sunUV = vec2(dot(sunDir, right), dot(sunDir, up)) / sw;
  vec2 pixUV = vec2(dot(rd, right), dot(rd, up)) / pw;
  vec2 d = pixUV - sunUV;

  float toward = max(dot(rd, sunDir), 0.0);
  float gate = smoothstep(0.12, 0.55, sunInFront) * uLensFlare;

  // Anamorphic horizontal streak through the disc.
  float streak = exp(-abs(d.y) * 95.0) * exp(-abs(d.x) * 5.5) * pow(toward, 3.5);
  vec3 f = uSunColor * streak * 0.42;

  // Ghost orbs along the line through screen centre (origin in this plane).
  for (int i = 0; i < 5; i++) {
    float tt = (float(i) + 0.35) / 5.0;
    vec2 gPos = mix(sunUV, -sunUV * 0.75, tt);
    float r = length(pixUV - gPos);
    float ghost = exp(-r * r * (140.0 + float(i) * 55.0));
    vec3 chroma = vec3(1.05 + float(i) * 0.06, 0.92, 1.12 - float(i) * 0.07);
    f += uSunColor * chroma * ghost * (0.14 - float(i) * 0.018);
  }

  // Soft iris ring offset toward anti-sun.
  float ring = abs(length(pixUV - sunUV * 0.28) - 0.11);
  f += uSunColor * vec3(1.05, 0.95, 1.15) * exp(-ring * 90.0) * 0.1 * pow(toward, 2.0);

  return f * gate;
}

void main() {
  vec3 rd = normalize(vDir);
  vec3 sunDir = normalize(uSun);

  float v = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 painted = texture2D(uGrad, vec2(0.5, v)).rgb;
  vec3 scatter = atmosphericScatter(rd, sunDir);
  vec3 col = mix(painted, scatter, uAtmoBlend);

  float cz = max(rd.y, 0.0);

  // Tight sun disc + warm Mie aureole (sun peeks through cloud gaps later).
  float mu = max(dot(rd, sunDir), 0.0);
  float bloom = max(0.25, uSunBloom);
  vec3 sun = uSunColor * (
    pow(mu, 6.0) * 0.028 +
    pow(mu, 64.0) * 0.09 +
    pow(mu, 400.0) * 0.28 +
    pow(mu, 2000.0) * 0.55 +
    pow(mu, 16000.0) * 1.55
  ) * bloom;
  col += sun;

  // Deeper cooler zenith.
  col *= mix(vec3(1.0), vec3(0.88, 0.94, 1.14), smoothstep(0.32, 1.0, cz) * uZenithBoost);

  if (uDust > 0.001) {
    float dustBand = pow(1.0 - smoothstep(-0.02, 0.28, rd.y), 1.7);
    vec3 dustCol = mix(uHorizonGlow, uFogColor, 0.32);
    col = mix(col, dustCol, dustBand * uDust * 0.85);
  }

  vec4 clouds = volumetricClouds(rd, sunDir);
  col = col * (1.0 - clouds.a) + clouds.rgb;

  // Lens flare composites after clouds so ghosts ride over the sky.
  col += lensFlare(rd, sunDir) * (0.55 + 0.45 * (1.0 - clouds.a));

  float toFog = 1.0 - smoothstep(-0.012, 0.075, rd.y);
  col = mix(col, uFogColor, toFog * 0.96);

  float glowBand = 1.0 - smoothstep(0.02, 0.26, rd.y);
  col = mix(col, mix(col, uHorizonGlow, 0.48), glowBand * uHorizonStrength);

  gl_FragColor = vec4(max(col, 0.0) * uExposure, 1.0);
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
      uCloudDark: { value: new THREE.Color(0.5, 0.56, 0.65) },
      uHorizonGlow: { value: new THREE.Color(0.92, 0.78, 0.58) },
      uFogColor: { value: new THREE.Color(0.78, 0.8, 0.84) },
      uHorizonStrength: { value: 0.22 },
      uDust: { value: 0 },
      uCloudCover: { value: 0.34 },
      uCloudScale: { value: 1.9 },
      uExposure: { value: 1.0 },
      uTime: { value: 0 },
      uGroundBounce: { value: new THREE.Color(0.55, 0.42, 0.28) },
      uGroundBounceMix: { value: 0.12 },
      uSunBloom: { value: 0.9 },
      uZenithBoost: { value: 0.32 },
      uRayleigh: { value: 1.0 },
      uMie: { value: 1.0 },
      uAtmoBlend: { value: 0.82 },
      uCloudDetail: { value: hi ? 5 : 4 },
      uWind: { value: new THREE.Vector3(1.2, 0, 0.4) },
      uCloudSteps: { value: hi ? CLOUD_BUDGET.cinemaViewSteps : CLOUD_BUDGET.mediumViewSteps },
      uLightSteps: { value: 2 },
      uAbsorb: { value: 2.5 },
      uSilver: { value: 1.0 },
      uUseWorley: { value: 1 },
      uMieG: { value: 0.78 },
      uTurbidity: { value: 1.85 },
      uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
      uLensFlare: { value: 1.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 40), mat);
  mesh.scale.setScalar(40);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2000;
  mesh.name = "pbr-sky";
  mesh.userData.volumetricClouds = true;
  mesh.userData.cloudTechnique = CLOUD_BUDGET.technique;
  mesh.userData.lensFlare = true;
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
  if (z === 0x1e6aa8 || z === 0x0c4a98) return STAGE_CLOUD_PALETTES.desert;
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
    u.uSunColor.value.setHex(L.sun != null ? L.sun : 0xfff1c8);
    if (L.sunSkyBoost != null) u.uSunColor.value.multiplyScalar(L.sunSkyBoost);
    const litHex = L.cloudLit != null ? L.cloudLit : pal.lit;
    const darkHex = L.cloudDark != null ? L.cloudDark : pal.dark;
    u.uCloudLit.value.setHex(litHex);
    u.uCloudDark.value.setHex(darkHex);
    // `cover` is now a real sky fraction, so the palette floor is a floor and
    // not a multiplier on an already-saturated field.
    let cover = L.cloudCover != null ? L.cloudCover : pal.cover;
    cover = Math.max(cover, pal.cover);
    u.uCloudCover.value = Math.min(0.92, cover);
    const scale = L.cloudScale != null ? L.cloudScale : 1.9;
    u.uCloudScale.value = Math.max(scale, 1.6);
    u.uAbsorb.value = pal.absorb;
    u.uSilver.value = pal.silver;
    const fogHex = L.fog != null ? L.fog : 0xc9b48a;
    // The scene fog colour is a uniform now, because the horizon has to
    // converge onto exactly the colour distant terrain fades to.
    u.uFogColor.value.setHex(fogHex);
    u.uHorizonGlow.value.setHex(L.horizonGlow != null ? L.horizonGlow : fogHex);
    u.uHorizonStrength.value = L.horizonStrength != null ? L.horizonStrength : 0.22;
    u.uDust.value =
      VISUAL.envAtmosphere === false ? 0 : L.dustStrength != null ? L.dustStrength : 0;
    u.uGroundBounce.value.setHex(L.hemiGround != null ? L.hemiGround : L.fog != null ? L.fog : 0xc9b48a);
    u.uGroundBounceMix.value = L.groundBounceMix != null ? L.groundBounceMix : 0.12;
    u.uSunBloom.value = L.sunBloom != null ? L.sunBloom : 1.05;
    u.uZenithBoost.value = L.zenithBoost != null ? L.zenithBoost : 0.4;
    u.uRayleigh.value = L.skyRayleigh != null ? L.skyRayleigh : 1.15;
    // skyMie is authored as a physical-ish coefficient; the shader wants a
    // unitless multiplier on the Mie term.
    u.uMie.value = L.skyMie != null ? Math.max(0.2, L.skyMie * 260.0) : 1.05;
    u.uMieG.value = L.skyMieG != null ? L.skyMieG : 0.78;
    u.uTurbidity.value = L.skyTurbidity != null ? L.skyTurbidity : 1.85;
    u.uAtmoBlend.value = L.skyAtmoBlend != null ? L.skyAtmoBlend : 0.88;
    u.uLensFlare.value =
      VISUAL.lensFlare === false ? 0 : L.lensFlare != null ? L.lensFlare : 1.0;
    const e = L.skyExposure != null ? L.skyExposure : 0.5;
    let exp = Math.max(0.92, Math.min(1.22, 0.64 + e * 0.48));
    // Title may run a touch hotter than race so lacquer pops; still capped.
    if (stageId === "title" || L.bodyEnv != null) exp = Math.min(exp, 1.16);
    u.uExposure.value = exp;
    const wind = Array.isArray(L.wind) && L.wind.length >= 3 ? L.wind : [1.2, 0, 0.4];
    u.uWind.value.set(wind[0], wind[1] || 0, wind[2]);
    const hi = cinemaCloud();
    u.uCloudDetail.value = hi ? 5 : 4;
    u.uCloudSteps.value = hi ? CLOUD_BUDGET.cinemaViewSteps : CLOUD_BUDGET.mediumViewSteps;
    u.uLightSteps.value = 2;
    u.uUseWorley.value = 1;
  } catch (err) {
    console.warn("applySky failed", err);
  }
}

/**
 * Drop raymarch quality when the GPU is in the red.
 *
 * The cheap tiers must still look INTENTIONAL, not broken. So what degrades is
 * the step count and the octave count — the coverage, the palette, the sun
 * coherence and the fog handoff are identical at every tier. A `min` sky is a
 * simpler cloud with softer detail, not a missing cloud or a flat gradient.
 *
 * @param {THREE.Mesh} mesh
 * @param {string} perfTier high | medium | low | min
 */
export function setSkyQuality(mesh, perfTier) {
  if (!mesh || !mesh.material || !mesh.material.uniforms) return;
  const u = mesh.material.uniforms;
  const hi = cinemaCloud();
  if (perfTier === "min") {
    u.uCloudSteps.value = CLOUD_BUDGET.minViewSteps;
    u.uLightSteps.value = 1;
    u.uCloudDetail.value = 3;
    u.uUseWorley.value = 0;
    if (u.uLensFlare) u.uLensFlare.value = 0;
  } else if (perfTier === "low") {
    u.uCloudSteps.value = CLOUD_BUDGET.lowViewSteps;
    u.uLightSteps.value = 1;
    u.uCloudDetail.value = 3;
    u.uUseWorley.value = 0;
    if (u.uLensFlare) u.uLensFlare.value = 0;
  } else if (perfTier === "medium") {
    u.uCloudSteps.value = CLOUD_BUDGET.mediumViewSteps;
    u.uLightSteps.value = 2;
    u.uCloudDetail.value = 4;
    u.uUseWorley.value = 1;
  } else {
    u.uCloudSteps.value = hi ? CLOUD_BUDGET.cinemaViewSteps : CLOUD_BUDGET.mediumViewSteps;
    u.uLightSteps.value = 2;
    u.uCloudDetail.value = hi ? 5 : 4;
    u.uUseWorley.value = 1;
  }
}

/**
 * @param {THREE.Mesh} mesh
 * @param {number} seconds
 * @param {THREE.Vector3} [camFwd] camera world forward for lens flare
 */
export function tickSky(mesh, seconds, camFwd) {
  if (!mesh || !mesh.material || !mesh.material.uniforms) return;
  const u = mesh.material.uniforms;
  u.uTime.value = seconds;
  if (camFwd && u.uCamFwd) {
    u.uCamFwd.value.copy(camFwd);
  }
}
