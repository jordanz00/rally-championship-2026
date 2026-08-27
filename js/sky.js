/**
 * Sky — analytic Rayleigh/Mie atmosphere + raymarched cumulus in a planet shell.
 *
 * WHO THIS IS FOR: the renderer.
 * WHAT IT DOES: fills the frame with a single-scattering atmosphere (air-mass
 *   driven luminance gradient, Rayleigh + Mie phase, sun-relative forward
 *   scatter) and marches a cloud shell lit from the SAME sun vector the shadow
 *   rig uses. The horizon converges onto the scene fog colour so sky and fog
 *   meet without a seam.
 * HOW IT CONNECTS: game.js calls createSky() once, applySky() per stage, and
 *   tickSky() every frame. setSkyQuality() follows the perf tier.
 *
 * WHAT THE CLOUDS ACTUALLY ARE (do not overstate this):
 *   A real raymarch — 4 to 16 view steps through a spherical shell, with
 *   Beer-Lambert extinction, 1-2 shadow samples toward the sun, and a two-lobe
 *   Henyey-Greenstein phase. It is NOT a film-grade volumetric renderer: the
 *   step count is a fraction of what an offline march uses, the noise is
 *   procedural value-noise rather than a curl-advected 3D texture, and there is
 *   no temporal reprojection. It reads as volume because the density field is
 *   genuinely 3D and self-shadowed, not because the march is thorough.
 *
 * WHY THE 2026-08 REWRITE (the defect it fixes):
 *   The previous field saturated. `islands` mapped cover 0.55 onto a smoothstep
 *   window that sat BELOW the weather fBm's mean, so density was non-zero over
 *   the entire sky; and per-step optical depth (dens · dt · absorb · 2.05) with
 *   an uncapped horizon chord drove transmittance to ~1e-4 on every ray. Result:
 *   an opaque flat ceiling painted in the cloud ambient colour, with the
 *   gradient, the scatter and the sun disc all computed and then covered up.
 *   Desert rendered as brown overcast. The three structural fixes here are:
 *     1. the weather fBm is NORMALISED (fbmN) so `cover` is a real sky fraction;
 *     2. the traversed chord is CAPPED (CLOUD_MAX_SPAN) so grazing rays cannot
 *        integrate unbounded optical depth;
 *     3. clouds fade into the horizon haze, so the layer reads as a layer at
 *        altitude instead of wallpaper welded to the dome.
 *
 * BUDGET (M1 Pro / Chrome, measured — see tools/qa-frame-probe.mjs):
 *   Sky is a unit sphere (64x40) drawn first, depth test and write both off.
 *   Cloud work is skipped entirely below the horizon and once transmittance
 *   falls under 0.02. Steps by tier: 16 high / 10 medium / 6 low / 4 min, with
 *   2 / 2 / 1 / 1 shadow samples. Stable step centres — no temporal hash dither,
 *   which is what produced the grain a previous sprint removed.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../vendor/three.module.js";
import { gradientTexture } from "./gfx/saturn.js?v=1";
import { VISUAL } from "./config.js?v=148";

/**
 * GPU budget + technique — QA greps this object; do not rename keys.
 */
export const CLOUD_BUDGET = {
  technique: "planet-shell-raymarch",
  maxViewSteps: 16,
  cinemaViewSteps: 16,
  mediumViewSteps: 10,
  lowViewSteps: 6,
  minViewSteps: 4,
  maxLightSteps: 2,
  notes:
    "16x2 high / 10x2 medium / 6x1 low / 4x1 min. Stable step centres (no temporal dither). Chord capped at CLOUD_MAX_SPAN so grazing rays cannot saturate. Early-out below the horizon and when transmittance < 0.02.",
};

/**
 * Per-stage cumulus palettes.
 *
 * `lit` is the sunlit top, `dark` the sky-lit shadow — which is a cool grey
 * BLUE, not brown, because the shadowed side of a cloud is lit by the sky. Warm
 * ground bounce is added separately from the stage's hemiGround, so a desert
 * cumulus still picks up sand light on its base without the whole cloud turning
 * to mud (which is exactly how the old desert `dark: 0x5c4a42` read).
 *
 * `cover` is a floor on the sky fraction; LIGHTING.cloudCover wins when higher.
 */
export const STAGE_CLOUD_PALETTES = {
  desert: { lit: 0xfff6ec, dark: 0x96a5ba, absorb: 3.1, silver: 0.85, cover: 0.2 },
  forest: { lit: 0xf9fcff, dark: 0x74849c, absorb: 3.4, silver: 0.74, cover: 0.28 },
  mountain: { lit: 0xf8fbff, dark: 0x6f849e, absorb: 3.0, silver: 0.9, cover: 0.22 },
  lakeside: { lit: 0xf4fafd, dark: 0x76889c, absorb: 3.3, silver: 0.78, cover: 0.26 },
  // Showroom sky — warm lit faces, cooler shadowed volumes, thicker cover.
  title: { lit: 0xfff4e6, dark: 0x5a6e88, absorb: 3.55, silver: 0.92, cover: 0.34 },
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

varying vec3 vDir;

/* Shell geometry, in units where the planet radius is 8. The layer sits just
   above the surface so a grazing ray still enters it near the horizon, which is
   what makes distant cumulus stack up along the skyline. */
const float PLANET_R = 8.0;
const float CLOUD_INNER = 8.06;
const float CLOUD_OUTER = 9.28;
const int MAX_VIEW = 16;
const int MAX_LIGHT = 2;

/**
 * Longest chord we will integrate, in shell units.
 *
 * A ray leaving the eye near the horizon is almost tangent to the shell, so its
 * geometric chord grows without bound — the old shader integrated that whole
 * length and every horizon pixel came out fully opaque. Real distant cloud is
 * washed out by air, not stacked to black, so the march stops here and the
 * remainder is handed to the horizon haze below.
 */
const float CLOUD_MAX_SPAN = 2.9;

/**
 * Single scalar that converts the scattering model's relative radiance into the
 * renderer's linear units. Calibrated once, against ACES at the stage exposure,
 * so that a clear zenith lands near 0.18 linear (mid grey) and the horizon sits
 * a few stops above it without clipping. Change this and every stage moves
 * together, which is the point — it is a unit conversion, not an art knob.
 */
const float SCATTER_GAIN = 3.30;

/**
 * Contrast stretch applied to the cloud weather field about its mean. A
 * normalised fBm has a standard deviation near 0.11, which is far too narrow
 * for a coverage threshold to carve distinct cumulus out of — every threshold
 * either opens everywhere or closes everywhere. Widening it first is what makes
 * uCloudCover behave like a sky fraction.
 */
const float WEATHER_CONTRAST = 2.3;

/**
 * Noise frequencies, expressed per unit of SHELL space (planet radius 8, shell
 * thickness 1.22) after the uCloudScale multiply.
 *
 * WHY THIS MATTERS MORE THAN IT LOOKS: the previous shader chained two scale
 * factors (p * 0.155 * uCloudScale, then * 0.28 for weather) which worked out to
 * roughly 0.06 noise units per shell unit. A ray sweeping 30 degrees of sky
 * moves under one twentieth of a noise cell, so the weather field was very
 * nearly CONSTANT across the whole visible sky — every pixel got the same
 * coverage verdict, which is the other half of why the layer rendered as a flat
 * sheet. Cumulus want a group scale of a few shell units, so the weather field
 * has to change by about 1 noise unit every 3 shell units.
 */
const float WEATHER_FREQ = 0.85;
const float BODY_FREQ = 2.45;
const float DETAIL_FREQ = 4.4;

/**
 * Cloud radiance calibration, in the same linear units as SCATTER_GAIN.
 *
 * A sunlit cumulus is the brightest thing in a daytime frame apart from the sun
 * itself, but it is not 20x mid grey — these put a fully lit face near 1.0
 * linear and a sky-lit shadow near 0.2, which is roughly the real ratio and
 * leaves ACES somewhere to roll off to. The previous shader summed an
 * unnormalised in-scatter of about 3.5 and clipped the whole sky to white.
 */
const float CLOUD_SUN_GAIN = 0.50;
const float CLOUD_AMBIENT_GAIN = 0.72;

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

  // Rayleigh extinction is wavelength^-4; these are relative RGB coefficients.
  vec3 betaR = vec3(5.8, 13.5, 33.1) * 0.01 * uRayleigh;
  // Mie is broadly wavelength independent and scales with haze/turbidity.
  vec3 betaM = vec3(1.0) * (0.008 + 0.004 * max(uTurbidity - 1.0, 0.0));
  vec3 betaT = betaR + betaM;

  // Sunlight reaching the view ray, reddened by its own slant path. This is why
  // a low sun warms the whole sky rather than just the disc. The 0.55 keeps a
  // high midday sun from over-reddening — at full strength it pulled so much
  // blue out that the zenith went grey-teal instead of blue.
  vec3 sunT = exp(-betaT * sunAm * 0.55);

  float phaseR = 0.0596831 * (1.0 + mu * mu);
  // Clamped: the HG lobe is unbounded as mu -> 1 and would otherwise put a
  // hard-edged hotspot in the sky next to the actual sun disc.
  float phaseM = 0.0796 * min(hgPhase(mu, clamp(uMieG, 0.3, 0.9)), 24.0);

  // Bounded single scattering:  L = (beta_s * phase / beta_t) * (1 - e^-beta_t*s)
  //
  // The (1 - e^-tau) factor is the important one. It approaches 1 as the path
  // lengthens, so the horizon SATURATES instead of growing without limit, and
  // the ratio beta_s/beta_t tends to neutral grey — which is precisely the
  // Rayleigh desaturation that makes a skyline read as distance. The previous
  // formulation multiplied by air mass directly, so horizon radiance ran away
  // and every stage clipped to white at the skyline.
  vec3 tau = betaT * am;
  vec3 depth = vec3(1.0) - exp(-tau);
  vec3 scatterAlbedo = (betaR * phaseR + betaM * phaseM * uMie) / betaT;
  vec3 col = scatterAlbedo * depth * sunT * uSunColor * SCATTER_GAIN;

  // Sky light bounced back off the ground tints the lowest band toward the
  // stage's own horizon colour. Blended, not added: adding two warm colours on
  // top of a blue sky produced a green band right where the skyline sits.
  float bounce = pow(1.0 - cz, 5.0) * 0.30;
  col = mix(col, uHorizonGlow * (0.30 + 0.45 * uSunColor.g), bounce);
  return col;
}

/** 0..1 height across the cloud shell. */
float shellH(vec3 p) {
  return clamp((length(p) - CLOUD_INNER) / max(CLOUD_OUTER - CLOUD_INNER, 0.001), 0.0, 1.0);
}

/**
 * Cumulus vertical profile: crisp flat base, widest a third of the way up,
 * eroded cauliflower top. Multiplying density by this is what stops the layer
 * reading as a slab with a hard bottom edge.
 */
float heightProfile(float h) {
  float base = smoothstep(0.0, 0.09, h);
  float top = 1.0 - smoothstep(0.30, 0.98, h);
  return base * top;
}

/**
 * Cloud density at a point in the shell, 0..1.
 *
 * Two fields: a large-scale WEATHER field that decides where clouds exist at
 * all (this is what cover gates, as a sky fraction), and a smaller-scale BODY
 * field that gives each cloud its billows. Keeping them separate is what
 * produces distinct cumulus with clear blue between them instead of a
 * continuous overcast sheet.
 */
float cloudDensity(vec3 p, int octaves, bool useWorley) {
  float h = shellH(p);
  float prof = heightProfile(h);
  if (prof < 0.004) return 0.0;

  vec3 q = p * (0.55 * uCloudScale);

  // WHERE clouds are. A normalised fBm clusters tightly around 0.5, so it is
  // stretched about its mean first — otherwise no threshold can produce both
  // dense cores and genuinely empty sky, and the layer becomes a sheet.
  float w = fbmN(q * WEATHER_FREQ, 3);
  w = clamp((w - 0.5) * WEATHER_CONTRAST + 0.5, 0.0, 1.0);
  float thr = mix(0.94, 0.18, clamp(uCloudCover, 0.0, 1.0));
  float mask = smoothstep(thr, thr + 0.22, w);
  if (mask < 0.004) return 0.0;

  // WHAT each cloud looks like.
  float body = fbmN(q * BODY_FREQ, octaves);
  if (useWorley) {
    float cells = worleyPuff(q * BODY_FREQ * 0.72 + vec3(2.2, 0.4, 1.1));
    body = mix(body, cells, 0.42);
  }
  // Ridged detail sharpens the cauliflower highlights on the sunward side.
  float ridged = 1.0 - abs(fbmN(q * DETAIL_FREQ + vec3(9.1, 2.4, 4.7), max(2, octaves - 1)) * 2.0 - 1.0);
  float shape = body * 0.62 + ridged * 0.38;

  // Erode toward the top so the cauliflower crown breaks up.
  shape -= smoothstep(0.40, 1.0, h) * 0.20;

  // Multiplying by the mask BEFORE the threshold is what erodes cloud edges:
  // the mask falls off gradually, so the boundary dissolves into wisps instead
  // of being cut out with scissors.
  // A wide threshold window on purpose. A narrow one makes the density field
  // almost binary, and a 4-to-16 step march through a near-binary field shows
  // its step planes as terracing inside the shadowed billows.
  float d = smoothstep(0.20, 0.68, shape * mask) * prof;
  return clamp(d, 0.0, 1.0);
}

/**
 * Optical depth from a point toward the sun — the self-shadow that gives the
 * layer its form. Sampling along the real sun vector (the same one the shadow
 * rig uses for the car and terrain) is what keeps the sky coherent with the
 * ground; a cloud lit from a different angle is the single biggest tell.
 */
float sunOptical(vec3 p, vec3 sunDir, int octaves, bool useWorley) {
  int lights = int(clamp(uLightSteps, 1.0, 2.0));
  float od = 0.0;
  float stride = 0.26;
  for (int i = 0; i < MAX_LIGHT; i++) {
    if (i >= lights) break;
    float t = (float(i) + 0.6) * stride * (1.0 + float(i) * 1.4);
    od += cloudDensity(p + sunDir * t, max(2, octaves - 1), useWorley && i == 0) * stride * (1.0 + float(i) * 1.4);
  }
  return od;
}

/**
 * March the cloud shell. Returns premultiplied scattered radiance in .rgb and
 * coverage in .a, so the caller composites energy-conservingly.
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

  // Cap the chord. Without this a grazing ray integrates tens of shell units
  // and every horizon pixel saturates to opaque — the shipped defect.
  float span = min(t1 - t0, CLOUD_MAX_SPAN);

  int steps = int(clamp(uCloudSteps, 4.0, 16.0));
  int octaves = int(clamp(uCloudDetail, 2.0, 5.0));
  bool useWorley = uUseWorley > 0.5;
  float dt = span / float(steps);
  float t = t0 + dt * 0.5;

  vec3 wind = uWind * uTime * 0.0065;
  float mu = dot(rd, sunDir);
  // Forward lobe for the silver lining, plus a wide back lobe for the ambient
  // multiple-scattering wash. Clamped so a near-sun pixel cannot spike.
  float phase = 0.7 * hgPhase(mu, 0.62) + 0.3 * hgPhase(mu, -0.22);
  phase = clamp(phase, 0.35, 2.2);

  float sigma = max(0.8, uAbsorb);
  // Undersampling compensation. With 4 steps each dt is large, so a single
  // bright sample carries a big (1 - beers) weight and sunlit cores overshoot
  // into clipping. Easing the forward-scatter gain at low step counts keeps the
  // cheap tiers reading like the expensive ones instead of like blown blobs —
  // the look is the same sky, only softer.
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
      float sunVis = exp(-shadow * sigma);
      // Powder / dark-edge term: thin edges scatter forward strongly, which is
      // what makes a backlit cloud rim glow.
      float powder = 1.0 - exp(-dens * 5.0);

      // Sky-lit ambient, brighter at the top where more sky is visible, with
      // warm ground bounce added under the base. This replaces the old muddy
      // brown "dark" colour that made desert cumulus read as dirt.
      vec3 ambient = mix(uCloudDark, uCloudLit * 0.72, 0.22 + 0.62 * h);
      ambient += uGroundBounce * (0.9 * (1.0 - h)) * uGroundBounceMix;
      ambient *= CLOUD_AMBIENT_GAIN;

      // Sunlight on cloud is only lightly tinted: liquid water is spectrally
      // flat, so a sunlit cumulus is close to white even under a warm sun. Using
      // the full sun tint turned desert cloud tops to cream.
      vec3 sunTint = mix(vec3(1.0), uSunColor, 0.45);
      vec3 direct = sunTint * uCloudLit * CLOUD_SUN_GAIN * phase * sunVis
        * (0.42 + uSilver * powder * 0.8 * stepComp);

      vec3 inS = ambient + direct;
      // Energy-correct integration of in-scattering over the step.
      scatter += trans * inS * (1.0 - beers);
      trans *= beers;
    }
    t += dt;
  }

  float alpha = clamp(1.0 - trans, 0.0, 1.0);

  // Aerial perspective: cloud near the skyline is seen through a long column of
  // haze, so it loses contrast and hands over to the fog colour. This is what
  // makes the layer sit at altitude instead of being welded to the dome, and it
  // is also what removes the hard line the old shader left at the horizon.
  //
  // The band this covers is deliberately narrow (about 12 degrees). The chase
  // camera only ever shows roughly the lowest 15 degrees of sky, so this range
  // IS the shipped view: too wide and the clouds vanish in play, too narrow and
  // grazing rays pile into an opaque bank across the skyline.
  float haze = smoothstep(0.0, 0.22, rd.y);
  scatter = mix(uFogColor * alpha, scatter, 0.16 + 0.84 * haze);
  alpha *= smoothstep(0.0, 0.04, rd.y) * (0.18 + 0.82 * haze);

  return vec4(scatter, alpha);
}

void main() {
  vec3 rd = normalize(vDir);
  vec3 sunDir = normalize(uSun);

  // Painted ramp: art direction on top of the physical model, not instead of it.
  float v = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 painted = texture2D(uGrad, vec2(0.5, v)).rgb;
  vec3 scatter = atmosphericScatter(rd, sunDir);
  vec3 col = mix(painted, scatter, uAtmoBlend);

  float cz = max(rd.y, 0.0);

  // Sun aureole and disc. Tight core so it reads as the sun rather than as a
  // blown hole in the sky; the wide skirt is the Mie aureole.
  float mu = max(dot(rd, sunDir), 0.0);
  float bloom = max(0.2, uSunBloom);
  vec3 sun = uSunColor * (
    pow(mu, 8.0) * 0.030 +
    pow(mu, 128.0) * 0.10 +
    pow(mu, 1200.0) * 0.42 +
    pow(mu, 12000.0) * 1.30
  ) * bloom;
  col += sun;

  // Zenith is deeper and cooler than the mid sky.
  col *= mix(vec3(1.0), vec3(0.90, 0.95, 1.10), smoothstep(0.35, 1.0, cz) * uZenithBoost);

  // Dust band — Safari haze sitting on the skyline, above the fog handoff.
  if (uDust > 0.001) {
    float dustBand = pow(1.0 - smoothstep(-0.02, 0.30, rd.y), 1.6);
    vec3 dustCol = mix(uHorizonGlow, uFogColor, 0.35);
    col = mix(col, dustCol, dustBand * uDust);
  }

  // Clouds, then the fog handoff. Clouds composite BEFORE the fog blend so a
  // cumulus sitting on the skyline recedes into haze exactly like terrain does.
  vec4 clouds = volumetricClouds(rd, sunDir);
  col = col * (1.0 - clouds.a) + clouds.rgb;

  // FOG CONTINUITY: the last few degrees above the horizon converge onto the
  // scene fog colour, so distant terrain fading to fog meets a sky of the same
  // colour and there is no seam to see. Below the horizon the dome is pure fog
  // colour, because anything down there is behind terrain anyway.
  float toFog = 1.0 - smoothstep(-0.012, 0.075, rd.y);
  col = mix(col, uFogColor, toFog * 0.96);

  // Horizon glow rides on top of the fog handoff, never under it.
  float glowBand = 1.0 - smoothstep(0.02, 0.28, rd.y);
  col = mix(col, mix(col, uHorizonGlow, 0.5), glowBand * uHorizonStrength);

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
      uCloudDetail: { value: hi ? 4 : 3 },
      uWind: { value: new THREE.Vector3(1.2, 0, 0.4) },
      uCloudSteps: { value: hi ? CLOUD_BUDGET.cinemaViewSteps : CLOUD_BUDGET.mediumViewSteps },
      uLightSteps: { value: 2 },
      uAbsorb: { value: 3.1 },
      uSilver: { value: 0.85 },
      uUseWorley: { value: 1 },
      uMieG: { value: 0.76 },
      uTurbidity: { value: 2.0 },
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
    u.uSunBloom.value = L.sunBloom != null ? L.sunBloom : 0.88;
    u.uZenithBoost.value = L.zenithBoost != null ? L.zenithBoost : 0.32;
    u.uRayleigh.value = L.skyRayleigh != null ? L.skyRayleigh : 1.0;
    // skyMie is authored as a physical-ish coefficient; the shader wants a
    // unitless multiplier on the Mie term.
    u.uMie.value = L.skyMie != null ? Math.max(0.2, L.skyMie * 260.0) : 1.0;
    u.uMieG.value = L.skyMieG != null ? L.skyMieG : 0.76;
    u.uTurbidity.value = L.skyTurbidity != null ? L.skyTurbidity : 2.0;
    u.uAtmoBlend.value = L.skyAtmoBlend != null ? L.skyAtmoBlend : 0.82;
    const e = L.skyExposure != null ? L.skyExposure : 0.46;
    let exp = Math.max(0.9, Math.min(1.2, 0.62 + e * 0.48));
    // Title may run a touch hotter than race so lacquer pops; still capped.
    if (stageId === "title" || L.bodyEnv != null) exp = Math.min(exp, 1.14);
    u.uExposure.value = exp;
    const wind = Array.isArray(L.wind) && L.wind.length >= 3 ? L.wind : [1.2, 0, 0.4];
    u.uWind.value.set(wind[0], wind[1] || 0, wind[2]);
    const hi = cinemaCloud();
    u.uCloudDetail.value = hi ? 4 : 3;
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
    // 3 octaves, not 2: the second octave is what stops a cumulus reading as a
    // featureless blob, and one extra octave of value noise is far cheaper than
    // an extra march step.
    u.uCloudDetail.value = 3;
    u.uUseWorley.value = 0;
  } else if (perfTier === "low") {
    u.uCloudSteps.value = CLOUD_BUDGET.lowViewSteps;
    u.uLightSteps.value = 1;
    u.uCloudDetail.value = 3;
    u.uUseWorley.value = 0;
  } else if (perfTier === "medium") {
    u.uCloudSteps.value = CLOUD_BUDGET.mediumViewSteps;
    u.uLightSteps.value = 2;
    u.uCloudDetail.value = 4;
    u.uUseWorley.value = 1;
  } else {
    u.uCloudSteps.value = hi ? CLOUD_BUDGET.cinemaViewSteps : CLOUD_BUDGET.mediumViewSteps;
    u.uLightSteps.value = 2;
    u.uCloudDetail.value = hi ? 4 : 3;
    u.uUseWorley.value = 1;
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
