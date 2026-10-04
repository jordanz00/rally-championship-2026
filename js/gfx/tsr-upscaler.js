/**
 * TSR upscaler — legal browser clone of Unreal Engine Temporal Super Resolution.
 *
 * Capability classes from Epic's public TSR docs (not their .usf, not Streamline):
 *   History, Parallax Disocclusion, Shading Rejection, Flickering Temporal
 *   Analysis, History Resurrection, Spatial Anti-Aliaser (FXAA-style on
 *   rejected pixels). Nyquist 200% history is NOT shipped — 4× resolve cost
 *   would miss the Forest 33 ms gate. This is our GLSL. Not Unreal Engine.
 *
 * WHO THIS IS FOR: the race present path (RallyGame._render).
 * WHAT IT DOES: renders the scene at a reduced internal resolution with a
 *   sub-pixel Halton jitter on the projection, then reconstructs a full
 *   output-resolution frame by accumulating the jittered samples over time:
 *   depth-based reprojection (camera motion) + a cheap per-object velocity
 *   pass (visible body/wheels only, dedicated scene — never a Forest walk),
 *   Catmull-Rom history when the camera is still / bilinear when it is not,
 *   YCoCg variance clipping, car-silhouette history kill (colour-only —
 *   chase-locked hulls cannot ghost), and RCAS on present unless guided
 *   reconstruct already sharpened. The result is handed to PhotoRealPost as
 *   if it were the scene pass (colour + depth), so bloom / AO / grade keep
 *   running at output resolution.
 * HOW IT CONNECTS: `new TsrUpscaler(renderer, opts)` in RallyGame._initRenderer;
 *   `_render` calls `tsr.render(scene, camera)` and then presents
 *   `tsr.presentScene` through the normal post / pipeline path.
 *   `?tsr=quality|balanced|performance|dlaa|off`, `?tsrdebug=split,nohistory,noclip,nojitter,nosharp`.
 *
 * Nothing here lowers renderer.setPixelRatio: the scale lives inside the
 * low-res render target and the output is always the full drawing buffer.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../../vendor/three.module.js";

/** Internal render scale per mode — same ratios DLSS uses. */
export const TSR_MODES = Object.freeze({
  off: 0,
  dlaa: 1.0,
  quality: 0.77,
  balanced: 0.67,
  performance: 0.59,
});

/**
 * Default when the URL has no `?tsr=` and the player has not set Pause IMAGE.
 * Quality is back on for desktop: Forest 600 m IDE p50 matches Off (30 Hz
 * quantum) after the velocity pass dropped from 214 meshes to hero body/wheels.
 */
export const TSR_DEFAULT_MODE = "quality";

/**
 * History sample count per output pixel (Epic r.TSR.History.SampleCount).
 * Does not grow memory — only the minimum current-frame weight (1/N).
 * Quality uses 16 (Epic default). Rally clamps motion to 2.0 like Fortnite.
 */
export const TSR_HISTORY_SAMPLES = Object.freeze({
  off: 0,
  dlaa: 8,
  quality: 16,
  balanced: 12,
  performance: 8,
});

/** Epic r.TSR.Velocity.WeightClampingSampleCount — rally wants sharp cars. */
export const TSR_VEL_CLAMP_SAMPLES = 2.0;

/**
 * Live race cars never keep TSR history. Chase locks the hull on screen, so
 * last frame is a near-register copy — blending it is the ghost / smear /
 * double image. Quality and cheap resolve both honour this.
 */
export const TSR_CAR_HISTORY_KILL = true;

/** Persistent-frame interval (Epic default is 31, must be odd). */
export const TSR_RESURRECT_INTERVAL = 31;

/** Pause-menu persistence. Written only from Pause → IMAGE, never constructor. */
export const TSR_STORAGE_KEY = "rally-tsr-mode";

/**
 * Marks a real Pause IMAGE choice. Constructor `setMode` used to persist
 * Quality on first boot; without this flag that leftover key would keep
 * Quality on for anyone who never touched the menu.
 */
export const TSR_USER_CHOICE_KEY = "rally-tsr-user-choice";

/** Scene layer kept for debug / old callers — velocity now uses a proxy scene. */
export const TSR_VELOCITY_LAYER = 29;

/** Only cars inside this radius get a per-object velocity draw. */
const VEL_NEAR_M = 48;
/** Hard cap — player body/wheels + a couple of nearby rivals. */
const VEL_MESH_CAP = 18;
/** Rescan body/wheel list this often (plus on reset / pack change). */
const VEL_SCAN_EVERY = 90;
/** Drop the G-buffer override if the extra walk costs more than this. */
export const NORMAL_BUDGET_MS = 1.5;

/** Output pixels of screen motion at which accumulation length starts to drop. */
const MOTION_SOFT_PX = 10;
/** Hard reject — a teleport the CPU cut-detect missed. */
const MOTION_KILL_PX = 48;

const VEL_SKIP_RE = /cabin|interior|cockpit|seat|dash|leather|dial|carpet|glass|window|windshield|windscreen|lamp|light|mirror|grill|badge|number|brake|head/;
const VEL_KEEP_RE = /wheel|tire|tyre|rim|hub|body|paint|chassis|shell|hood|door|fender|bumper|car_body/;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Per-object velocity (NDC delta + previous device depth) for the cars.
 * Depth-tested manually against the low-res scene depth so a car behind a
 * tree does not stamp its motion over the tree.
 */
const VEL_VERT = /* glsl */ `
uniform mat4 uPrevViewProj;
uniform mat4 uPrevModel;
uniform vec2 uJitterNdc;
varying vec4 vCurr;
varying vec4 vPrev;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * viewMatrix * wp;
  gl_Position = clip;
  vCurr = vec4(clip.xy - uJitterNdc * clip.w, clip.zw);
  vPrev = uPrevViewProj * uPrevModel * vec4(position, 1.0);
}
`;

const VEL_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tDepth;
varying vec4 vCurr;
varying vec4 vPrev;
void main() {
  float sceneD = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).r;
  if (gl_FragCoord.z > sceneD + 2.0e-5) discard;
  vec2 c = vCurr.xy / vCurr.w;
  vec3 p = vPrev.xyz / vPrev.w;
  gl_FragColor = vec4(c - p.xy, p.z * 0.5 + 0.5, 1.0);
}
`;

/**
 * Temporal resolve at output resolution. Writes linear HDR colour in rgb and
 * the accumulated sample count in a.
 */
const RESOLVE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tPrevDepth;
uniform sampler2D tVel;
uniform sampler2D tHistory;
uniform vec2 uLowSize;
uniform vec2 uOutSize;
uniform vec2 uJitter;
uniform vec2 uPrevJitter;
uniform float uScale;
uniform mat4 uInvViewProj;
uniform mat4 uPrevViewProj;
uniform float uNear;
uniform float uFar;
uniform float uMaxN;
uniform float uKernelSigma;
uniform float uClipGamma;
uniform float uDepthTol;
uniform float uHistoryOn;
uniform float uClipOn;
uniform float uReset;
uniform float uCheap;
uniform sampler2D tResurrect;
uniform float uResurrectOn;
uniform float uFlickerOn;
uniform float uSpatialOn;
uniform float uShadeRejectOn;
uniform float uThinOn;
uniform float uVelClampN;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 karis(vec3 c) { return c / (1.0 + luma(c)); }
vec3 karisInv(vec3 c) { return c / max(1.0 - luma(c), 1.0e-3); }
vec3 toYCoCg(vec3 c) {
  return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
vec3 fromYCoCg(vec3 c) {
  return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}
vec3 sane(vec3 c) {
  c = clamp(c, vec3(0.0), vec3(64.0));
  return (c == c) ? c : vec3(0.0);
}
float linZ(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

/** Clip a point toward the AABB centre (Karis / INSIDE style). */
vec3 clipAabb(vec3 bmin, vec3 bmax, vec3 p) {
  vec3 centre = 0.5 * (bmax + bmin);
  vec3 ext = 0.5 * (bmax - bmin) + 1.0e-4;
  vec3 v = p - centre;
  vec3 unit = abs(v / ext);
  float m = max(unit.x, max(unit.y, unit.z));
  return m > 1.0 ? centre + v / m : p;
}

#if !CHEAP_RESOLVE
/** 9-tap Catmull-Rom with bilinear taps (Jimenez). */
vec4 catmullRom(sampler2D tex, vec2 uv, vec2 size) {
  vec2 pos = uv * size;
  vec2 c = floor(pos - 0.5) + 0.5;
  vec2 f = pos - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 off12 = w2 / w12;
  vec2 t0 = (c - 1.0) / size;
  vec2 t3 = (c + 2.0) / size;
  vec2 t12 = (c + off12) / size;
  vec4 r = vec4(0.0);
  r += texture2D(tex, vec2(t0.x, t0.y)) * w0.x * w0.y;
  r += texture2D(tex, vec2(t12.x, t0.y)) * w12.x * w0.y;
  r += texture2D(tex, vec2(t3.x, t0.y)) * w3.x * w0.y;
  r += texture2D(tex, vec2(t0.x, t12.y)) * w0.x * w12.y;
  r += texture2D(tex, vec2(t12.x, t12.y)) * w12.x * w12.y;
  r += texture2D(tex, vec2(t3.x, t12.y)) * w3.x * w12.y;
  r += texture2D(tex, vec2(t0.x, t3.y)) * w0.x * w3.y;
  r += texture2D(tex, vec2(t12.x, t3.y)) * w12.x * w3.y;
  r += texture2D(tex, vec2(t3.x, t3.y)) * w3.x * w3.y;
  return r;
}
#endif

void main() {
  // Where this output pixel's unjittered content landed in the low-res image.
  vec2 q = vUv * uLowSize + uJitter;
  ivec2 ic = ivec2(floor(q));
  ivec2 maxI = ivec2(uLowSize) - 1;

  vec3 cur;
  vec3 bmin;
  vec3 bmax;
  float conf;
  float closeD = 1.0;
  ivec2 closeI = clamp(ic, ivec2(0), maxI);

#if CHEAP_RESOLVE
  // High screen motion: bilinear upsample. The 3×3 gather cannot hold a
  // trail anyway (nCap drops to 2), so spend the ALU on the still path.
  cur = sane(texture2D(tColor, q / uLowSize).rgb);
  conf = 1.0;
  closeD = texelFetch(tDepth, closeI, 0).r;
  vec3 mean = toYCoCg(karis(cur));
  bmin = mean - vec3(0.10);
  bmax = mean + vec3(0.10);
#else
  float sig2 = 2.0 * uKernelSigma * uKernelSigma * uScale * uScale;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  vec3 m1 = vec3(0.0);
  vec3 m2 = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 i = clamp(ic + ivec2(x, y), ivec2(0), maxI);
      vec3 c = sane(texelFetch(tColor, i, 0).rgb);
      vec3 cc = toYCoCg(karis(c));
      m1 += cc;
      m2 += cc * cc;
      vec2 d = (vec2(i) + 0.5) - q;
      float w = exp(-dot(d, d) / sig2);
      sum += c * w;
      wsum += w;
      float dd = texelFetch(tDepth, i, 0).r;
      if (dd < closeD) { closeD = dd; closeI = i; }
    }
  }
  vec3 mean = m1 / 9.0;
  vec3 var = max(m2 / 9.0 - mean * mean, vec3(0.0));
  vec3 sigma = sqrt(var);
  bmin = mean - uClipGamma * sigma;
  bmax = mean + uClipGamma * sigma;
  vec3 bilin = sane(texture2D(tColor, q / uLowSize).rgb);
  cur = wsum > 1.0e-4 ? sum / wsum : bilin;
  cur = mix(bilin, cur, smoothstep(0.0, 0.08, wsum));
  conf = clamp(wsum, 0.0, 1.0);
#endif
  vec3 curCC = toYCoCg(karis(cur));

  // Reprojection: car velocity only where THIS pixel wrote it.
  // Do not dilate the vector — a neighbour inheriting car motion
  // reprojects the old hull onto the road (ghost trail).
  vec4 vel = texelFetch(tVel, closeI, 0);
  float car = step(0.5, vel.a);
  // Dilate the CAR MASK only (Quality + cheap) so a 1-texel silhouette
  // that missed the velocity pass cannot keep history.
  if (car < 0.5) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec4 nv = texelFetch(tVel, clamp(ic + ivec2(x, y), ivec2(0), maxI), 0);
        if (nv.a > 0.5) car = 1.0;
      }
    }
  }
  vec2 prevUv;
  float expPrevD;
  if (vel.a > 0.5) {
    prevUv = vUv - vel.xy * 0.5;
    expPrevD = vel.z;
  } else {
    vec4 ndc = vec4(vUv * 2.0 - 1.0, closeD * 2.0 - 1.0, 1.0);
    vec4 wp = uInvViewProj * ndc;
    wp /= wp.w;
    vec4 pc = uPrevViewProj * wp;
    pc.xyz /= pc.w;
    prevUv = pc.xy * 0.5 + 0.5;
    expPrevD = pc.z * 0.5 + 0.5;
  }

  float valid = uHistoryOn * (1.0 - uReset);
  if (any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0)))) valid = 0.0;

  // Disocclusion: compare where this point should have been against the
  // depth actually recorded there last frame (low-res, previous jitter).
  if (closeD < 0.9999 && valid > 0.0) {
    vec2 pq = prevUv * uLowSize + uPrevJitter;
    float prevD = texelFetch(tPrevDepth, clamp(ivec2(floor(pq)), ivec2(0), maxI), 0).r;
    float zE = linZ(clamp(expPrevD, 0.0, 1.0));
    float zP = linZ(prevD);
    float tol = uDepthTol * zE + 0.08;
    if (abs(zP - zE) > tol) valid = 0.0;
  }

#if CHEAP_RESOLVE
  vec4 hist = texture2D(tHistory, prevUv);
#else
  vec4 hist = catmullRom(tHistory, prevUv, uOutSize);
#endif
  hist.rgb = sane(hist.rgb);
  float n = (hist.a == hist.a) ? clamp(hist.a, 0.0, uMaxN) : 0.0;
  n *= valid;
  // Car silhouette: drop history (colour-only). Chase keeps the hull
  // nearly still on screen, so last frame is a near-register copy —
  // blending it is the player-visible ghost / smear / double image.
  // Quality and cheap resolve share this kill. Spatial AA covers n<2.4.
  if (car > 0.5) {
    valid = 0.0;
    n = 0.0;
  }

  vec3 histCC = toYCoCg(karis(hist.rgb));
  float highFreq = length(bmax - bmin);

  // History Resurrection (FAQ): use the oldest persistent frame only when
  // (1) it matches current better than last frame AND (2) last frame does
  // not match enough. No optical flow — cars already dropped history.
  if (uResurrectOn > 0.5 && valid > 0.5 && car < 0.5) {
    vec4 rez = texture2D(tResurrect, prevUv);
    rez.rgb = sane(rez.rgb);
    float nRez = (rez.a == rez.a) ? clamp(rez.a, 0.0, uMaxN) : 0.0;
    if (nRez > 2.0) {
      vec3 rezCC = toYCoCg(karis(rez.rgb));
      float dHist = length(histCC - curCC);
      float dRez = length(rezCC - curCC);
      if (dHist > 0.08 && dRez + 0.02 < dHist) {
        hist = rez;
        histCC = rezCC;
        n = min(nRez, uMaxN * 0.8) * valid;
      }
    }
  }

  // Thin Geometry Detection (UE5 r.TSR.ThinGeometryDetection): depth-edge
  // + high-contrast line → relax ClampBlend so Forest fences / tree edges
  // do not boil. No GBuffer shading-model ID — depth + luma only.
  // A *wall* (large z jump, not a thin line) is a tunnel mouth / crest —
  // drop history so the far side cannot ghost for a frame.
  float thin = 0.0;
  float wall = 0.0;
#if !CHEAP_RESOLVE
  if (closeD < 0.999) {
    float zC = linZ(closeD);
    float zL = linZ(texelFetch(tDepth, clamp(closeI + ivec2(-1, 0), ivec2(0), maxI), 0).r);
    float zR = linZ(texelFetch(tDepth, clamp(closeI + ivec2( 1, 0), ivec2(0), maxI), 0).r);
    float zU = linZ(texelFetch(tDepth, clamp(closeI + ivec2(0, -1), ivec2(0), maxI), 0).r);
    float zDlin = linZ(texelFetch(tDepth, clamp(closeI + ivec2(0,  1), ivec2(0), maxI), 0).r);
    float zJump = max(max(abs(zL - zC), abs(zR - zC)), max(abs(zU - zC), abs(zDlin - zC)));
    float line = step(0.11, highFreq);
    if (uThinOn > 0.5) {
      float edge = step(0.28, zJump);
      thin = max(edge, line);
      if (thin > 0.5) {
        vec3 widen = (bmax - bmin) * 0.32 + vec3(0.035);
        bmin -= widen;
        bmax += widen;
      }
    }
    wall = step(2.4, zJump) * (1.0 - line);
  }
#endif
  if (wall > 0.5) {
    valid = 0.0;
    n = 0.0;
  }

  // ClampBlend (UE4 TAA-style) — keep history inside the current AABB.
  vec3 clipped = histCC;
  if (uClipOn > 0.5) {
    clipped = clipAabb(bmin, bmax, histCC);
    float moved = length(clipped - histCC) / max(length(bmax - bmin), 1.0e-3);
    n *= 1.0 / (1.0 + 6.0 * moved);
  }

  float motionPx = length((vUv - prevUv) * uOutSize);
  if (motionPx > MOTION_KILL_PX_F) { valid = 0.0; n = 0.0; }
  // Velocity weight clamp (FAQ / Fortnite 2.0): sharpness in motion.
  float nCap = mix(uMaxN, uVelClampN, clamp((motionPx - 1.5) / MOTION_SOFT_PX_F, 0.0, 1.0));
  n = min(n, nCap);

  float yDelta = abs(curCC.x - histCC.x);
  float still = 1.0 - clamp((motionPx - 0.6) / 3.0, 0.0, 1.0);
  // FAQ: flicker analysis is off on moving objects / big parallax (pink).
  // Use the dilated car mask so a silhouette edge cannot re-accumulate.
  float flickerOk = still * (1.0 - car);
  if (uFlickerOn > 0.5 && flickerOk > 0.55 && thin < 0.5 && highFreq > 0.07 && yDelta > 0.035 && valid > 0.5) {
    clipped = mix(clipped, histCC, 0.62);
    n = min(n + 2.0, uMaxN);
  } else if (uShadeRejectOn > 0.5 && still > 0.7 && thin < 0.5 && yDelta > 0.16) {
    // BlendFinal = 1 (FAQ): drop history, spatial AA hides the native sample.
    n = 0.0;
    clipped = curCC;
  }
  // Specular lock — a bright highlight that flipped vs history is this
  // frame's sun/glint, not a surface to accumulate. Stops wet-road swim.
  float specFlip = step(0.40, curCC.x) * step(0.075, yDelta) * still;
  if (specFlip > 0.5 && thin < 0.5 && wall < 0.5) {
    n *= 0.22;
    clipped = mix(clipped, curCC, 0.78);
  }

  if (uSpatialOn > 0.5 && n < 2.4) {
    vec2 texel = 1.0 / max(uLowSize, vec2(1.0));
    vec2 cuv = q / uLowSize;
    vec3 sL = sane(texture2D(tColor, cuv + vec2(-texel.x, 0.0)).rgb);
    vec3 sR = sane(texture2D(tColor, cuv + vec2( texel.x, 0.0)).rgb);
    vec3 sU = sane(texture2D(tColor, cuv + vec2(0.0, -texel.y)).rgb);
    vec3 sD = sane(texture2D(tColor, cuv + vec2(0.0,  texel.y)).rgb);
    float eH = abs(luma(sL) - luma(sR));
    float eV = abs(luma(sU) - luma(sD));
    vec3 fx = eH > eV ? 0.5 * (sL + sR) : 0.5 * (sU + sD);
    cur = mix(cur, fx, 0.52);
    curCC = toYCoCg(karis(cur));
  }

  // Final car kill — flicker / specular lock must not restore history.
  if (car > 0.5) {
    n = 0.0;
    clipped = curCC;
  }

  float wCur = conf + 0.02;
  float nNew = n + wCur;
  vec3 outCC = (clipped * n + curCC * wCur) / max(nNew, 1.0e-4);
  vec3 outC = karisInv(fromYCoCg(outCC));
  gl_FragColor = vec4(sane(outC), min(nNew, uMaxN));
}
`
  .replace("MOTION_SOFT_PX_F", MOTION_SOFT_PX.toFixed(1))
  .replace("MOTION_KILL_PX_F", MOTION_KILL_PX.toFixed(1));

/**
 * Present: RCAS sharpen (FidelityFX formulation) of the resolved frame, plus
 * the reconstructed depth written so PhotoRealPost AO / SSGI keep working.
 * Tone mapping / output encoding chunks are no-ops when the target is an RT.
 */
const PRESENT_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tResolved;
uniform sampler2D tDepth;
uniform sampler2D tNative;
uniform sampler2D tNativeDepth;
uniform vec2 uLowSize;
uniform vec2 uOutSize;
uniform vec2 uJitter;
uniform float uSharpCon;
uniform float uSharpOn;
uniform float uSplit;
varying vec2 vUv;

vec3 fetchC(ivec2 p, ivec2 mx) {
  return clamp(texelFetch(tResolved, clamp(p, ivec2(0), mx), 0).rgb, vec3(0.0), vec3(64.0));
}

void main() {
  ivec2 mx = max(ivec2(uOutSize) - 1, ivec2(0));
  ivec2 p = clamp(ivec2(floor(vUv * uOutSize)), ivec2(0), mx);
  vec3 e = fetchC(p, mx);
  vec3 outC = e;
  if (uSharpOn > 0.5) {
    vec3 b = fetchC(p + ivec2(0, -1), mx);
    vec3 d = fetchC(p + ivec2(-1, 0), mx);
    vec3 f = fetchC(p + ivec2(1, 0), mx);
    vec3 h = fetchC(p + ivec2(0, 1), mx);
    vec3 mn4 = min(min(b, d), min(f, h));
    vec3 mx4 = max(max(b, d), max(f, h));
    vec2 peakC = vec2(1.0, -4.0);
    vec3 hitMin = min(mn4, e) / (4.0 * mx4 + 1.0e-4);
    vec3 hitMax = (peakC.x - max(mx4, e)) / (4.0 * mn4 + peakC.y);
    vec3 lobeRGB = max(-hitMin, hitMax);
    float edgeN = max(mx4.r - mn4.r, max(mx4.g - mn4.g, mx4.b - mn4.b));
    float ringGate = 1.0 - smoothstep(0.28, 0.62, edgeN);
    float lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * uSharpCon * mix(0.42, 1.0, ringGate);
    float rcpL = 1.0 / (4.0 * lobe + 1.0);
    outC = (lobe * (b + d + f + h) + e) * rcpL;
  }
  vec2 q = vUv * uLowSize + uJitter;
  ivec2 li = clamp(ivec2(floor(q)), ivec2(0), ivec2(uLowSize) - 1);
  float depth = texelFetch(tDepth, li, 0).r;
  if (uSplit > 0.5) {
    // Left half: the native unjittered scene pass; right half: TSR.
    if (vUv.x < 0.5) {
      outC = clamp(texelFetch(tNative, p, 0).rgb, vec3(0.0), vec3(64.0));
      depth = texelFetch(tNativeDepth, p, 0).r;
    }
    if (abs(vUv.x - 0.5) * float(mx.x + 1) < 1.0) outC = vec3(1.0, 0.85, 0.1);
  }
  // WebGL2 core — Three r160 maps gl_FragDepthEXT → gl_FragDepth and does not
  // emit the WebGL1 EXT_frag_depth pragma. PhotoRealPost AO reads this depth.
  gl_FragDepth = depth;
  gl_FragColor = vec4(max(outC, 0.0), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Van der Corput radical inverse.
 * @param {number} i
 * @param {number} base
 * @returns {number}
 */
function radicalInverse(i, base) {
  let f = 1;
  let r = 0;
  let n = i;
  while (n > 0) {
    f /= base;
    r += f * (n % base);
    n = Math.floor(n / base);
  }
  return r;
}

/**
 * Remember the last Pause → IMAGE mode. Do not call from constructor setMode.
 * @param {string} mode
 */
export function persistTsrMode(mode) {
  try {
    if (typeof localStorage !== "undefined" && Object.prototype.hasOwnProperty.call(TSR_MODES, mode)) {
      localStorage.setItem(TSR_STORAGE_KEY, mode);
      localStorage.setItem(TSR_USER_CHOICE_KEY, "1");
    }
  } catch {
    /* private mode */
  }
}

/**
 * Parse `?tsr=` / `?tsrdebug=` from a search string.
 * Stored Quality is used only after a Pause IMAGE choice (`rally-tsr-user-choice`).
 * @param {string} [search]
 * @returns {{ mode: string, debug: Set<string> }}
 */
export function parseTsrParams(search) {
  let stored = "";
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(TSR_USER_CHOICE_KEY) === "1") {
      stored = localStorage.getItem(TSR_STORAGE_KEY) || "";
    }
  } catch {
    stored = "";
  }
  let mode = Object.prototype.hasOwnProperty.call(TSR_MODES, stored) ? stored : TSR_DEFAULT_MODE;
  const debug = new Set();
  try {
    const p = new URLSearchParams(search != null ? search : (typeof location !== "undefined" ? location.search : ""));
    const m = (p.get("tsr") || "").toLowerCase();
    if (m && Object.prototype.hasOwnProperty.call(TSR_MODES, m)) mode = m;
    else if (m === "0" || m === "false" || m === "none") mode = "off";
    const d = (p.get("tsrdebug") || "").toLowerCase();
    for (const tok of d.split(/[,\s]+/)) if (tok) debug.add(tok);
  } catch {
    /* no URL */
  }
  return { mode, debug };
}

const SKIP_VEL_NAME = /cabin|interior|cockpit|seat|dash|dial|gauge|carpet|leather|collision|colmesh|lod[2-9]|shadow|steer|mirror|needle|hud/;
const WHEEL_VEL_NAME = /wheel|tyre|tire|rim|hub/;
const BODY_VEL_NAME = /body|chassis|paint|shell|car_body|celica|lancer|escort|delta|coupe/;

/**
 * @param {THREE.Object3D} o
 * @returns {string}
 */
function velName(o) {
  const p = o.parent && o.parent.name ? o.parent.name : "";
  return `${o.name || ""} ${p}`.toLowerCase();
}

/**
 * Largest useful radius for hero ranking. Tiny trim does not need velocity.
 * @param {THREE.Mesh} o
 * @returns {number}
 */
function meshRadius(o) {
  const g = o.geometry;
  if (!g) return 0;
  if (!g.boundingSphere) g.computeBoundingSphere();
  return g.boundingSphere ? g.boundingSphere.radius : 0;
}

/**
 * Visible body + one mesh per wheel hub. Caps so a 40-part Celica GLB does
 * not become a 214-mesh velocity scan.
 * @param {THREE.Object3D} root
 * @returns {THREE.Mesh[]}
 */
function collectHeroVelMeshes(root) {
  const wheels = [];
  const body = [];
  const hubs = root.userData && Array.isArray(root.userData.wheels) ? root.userData.wheels : [];
  for (let i = 0; i < hubs.length; i++) {
    const hub = hubs[i];
    if (!hub || !hub.isObject3D) continue;
    let best = hub.isMesh && hub.geometry ? hub : null;
    let bestR = best ? meshRadius(best) : -1;
    hub.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry) return;
      if ((o.layers.mask & 1) === 0) return;
      const r = meshRadius(o);
      if (r > bestR) {
        bestR = r;
        best = o;
      }
    });
    if (best) wheels.push(best);
  }
  root.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || !o.geometry) return;
    if ((o.layers.mask & 1) === 0) return;
    const n = velName(o);
    if (SKIP_VEL_NAME.test(n)) return;
    if (WHEEL_VEL_NAME.test(n)) return;
    const kind = !Array.isArray(o.material) && o.material && o.material.userData
      ? o.material.userData.kind
      : "";
    if (kind === "paint" || kind === "chrome" || BODY_VEL_NAME.test(n)) body.push(o);
  });
  body.sort((a, b) => meshRadius(b) - meshRadius(a));
  const out = [];
  const seen = new Set();
  const add = (o) => {
    if (!o || seen.has(o)) return;
    seen.add(o);
    out.push(o);
  };
  for (let i = 0; i < Math.min(4, wheels.length); i++) add(wheels[i]);
  for (let i = 0; i < body.length && out.length < 8; i++) add(body[i]);
  // Name miss: still stamp the largest hull pieces so the car mask covers
  // the silhouette. Without coverage, Quality TSR ghosts the live race car.
  if (out.length < 6) {
    const all = [];
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.geometry) return;
      if ((o.layers.mask & 1) === 0) return;
      if (SKIP_VEL_NAME.test(velName(o))) return;
      all.push(o);
    });
    all.sort((a, b) => meshRadius(b) - meshRadius(a));
    for (let i = 0; i < all.length && out.length < 8; i++) add(all[i]);
  }
  return out;
}

/**
 * Temporal super-resolution upscaler for WebGL2 / Three r160.
 */
export class TsrUpscaler {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {{ mode?: string, debug?: Iterable<string> }} [opts]
   */
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    const caps = renderer && renderer.capabilities;
    const gl = renderer && typeof renderer.getContext === "function" ? renderer.getContext() : null;
    /** WebGL2 + a renderable half-float target are required; otherwise stay off. */
    this.supported =
      !!(caps && caps.isWebGL2) &&
      !!gl &&
      !!(renderer.extensions.has("EXT_color_buffer_float") ||
        renderer.extensions.has("EXT_color_buffer_half_float"));
    this.mode = "off";
    this.scale = 0;
    this.debug = new Set(opts.debug || []);
    /** @type {number} RCAS sharpness 0..1 (softer than 0.5 — less fence ring). */
    this.sharpness = 0.38;
    this.maxHistory = 12;
    this.kernelSigma = 0.47;
    this.clipGamma = 1.0;
    this.frame = 0;
    this.jitterCount = 8;
    this._outW = 0;
    this._outH = 0;
    this._lowW = 0;
    this._lowH = 0;
    this._needReset = true;
    this._lowRT = [null, null];
    this._velRT = null;
    this._normalRT = null;
    this._histRT = [null, null];
    this._resurrectRT = null;
    this._nativeRT = null;
    this._copyMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null } },
      vertexShader: VERT,
      fragmentShader: "varying vec2 vUv; uniform sampler2D tSrc; void main(){ gl_FragColor = texture2D(tSrc, vUv); }",
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    /** Low-res MeshNormalMaterial override. Off unless opted in; abort >1.5 ms. */
    this.writeNormals = opts.writeNormals === true;
    this._normalMat = new THREE.MeshNormalMaterial({ fog: false });
    this._normalClear = new THREE.Color(0x8080ff);
    this._normalMsSum = 0;
    this._normalMsN = 0;
    this._normalsAborted = false;
    this._histIndex = 0;
    this._jitter = new THREE.Vector2();
    this._prevJitter = new THREE.Vector2();
    this._viewProj = new THREE.Matrix4();
    this._prevViewProj = new THREE.Matrix4();
    this._invViewProj = new THREE.Matrix4();
    this._prevCamPos = new THREE.Vector3();
    this._prevCamQuat = new THREE.Quaternion();
    this._havePrevCam = false;
    this._lastFrameAt = 0;
    this._savedProj = new Float32Array(16);
    this._savedInv = new Float32Array(16);
    this._size = new THREE.Vector2();
    this._clearColor = new THREE.Color();
    /** @type {Object3D[]} car roots whose hero meshes get the velocity pass. */
    this._dynamicRoots = [];
    /** @type {Array<{mesh: THREE.Mesh, proxy: THREE.Mesh, mat: THREE.ShaderMaterial, prev: THREE.Matrix4, player: boolean}>} */
    this._velMeshes = [];
    this._velScanTick = 0;
    this._rootsDirty = true;
    /** Skip TSR RCAS when guided reconstruct already sharpened. */
    this.skipPresentSharp = false;
    this._velScene = new THREE.Scene();
    this._velScene.autoUpdate = false;
    this._velFrustum = new THREE.Frustum();
    this._velSphere = new THREE.Sphere();
    this._velWorld = new THREE.Vector3();
    this._velFwd = new THREE.Vector3();
    /** Last frame's timings / sizes for the QA readout. */
    this.stats = {
      lowW: 0,
      lowH: 0,
      outW: 0,
      outH: 0,
      bytes: 0,
      resets: 0,
      velMeshes: 0,
      velScanned: 0,
      velMs: 0,
      normalMs: 0,
      resolveMs: 0,
      cheap: 0,
      feedMPs: 0,
      spp1Ms: 0,
    };

    this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    this._quad.frustumCulled = false;
    this._quadScene = new THREE.Scene();
    this._quadScene.add(this._quad);

    const resolveUniforms = {
      tColor: { value: null },
      tDepth: { value: null },
      tPrevDepth: { value: null },
      tVel: { value: null },
      tHistory: { value: null },
      uLowSize: { value: new THREE.Vector2(1, 1) },
      uOutSize: { value: new THREE.Vector2(1, 1) },
      uJitter: { value: new THREE.Vector2() },
      uPrevJitter: { value: new THREE.Vector2() },
      uScale: { value: 1 },
      uInvViewProj: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uNear: { value: 0.18 },
      uFar: { value: 1400 },
      uMaxN: { value: 12 },
      uKernelSigma: { value: 0.47 },
      uClipGamma: { value: 1.0 },
      uDepthTol: { value: 0.06 },
      uHistoryOn: { value: 1 },
      uClipOn: { value: 1 },
      uReset: { value: 1 },
      uCheap: { value: 0 },
      tResurrect: { value: null },
      uResurrectOn: { value: 1 },
      uFlickerOn: { value: 1 },
      uSpatialOn: { value: 1 },
      uShadeRejectOn: { value: 1 },
      uThinOn: { value: 1 },
      uVelClampN: { value: TSR_VEL_CLAMP_SAMPLES },
    };
    const resolveOpts = {
      uniforms: resolveUniforms,
      vertexShader: VERT,
      fragmentShader: RESOLVE_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    };
    this._resolveMat = new THREE.ShaderMaterial({
      ...resolveOpts,
      defines: { CHEAP_RESOLVE: 0 },
    });
    this._resolveMatCheap = new THREE.ShaderMaterial({
      ...resolveOpts,
      defines: { CHEAP_RESOLVE: 1 },
    });
    this._resolveMatCheap.uniforms = this._resolveMat.uniforms;

    /** Fullscreen quad that PhotoRealPost / the canvas renders as "the scene". */
    this.presentMaterial = new THREE.ShaderMaterial({
      uniforms: {
        tResolved: { value: null },
        tDepth: { value: null },
        tNative: { value: null },
        tNativeDepth: { value: null },
        uLowSize: { value: new THREE.Vector2(1, 1) },
        uOutSize: { value: new THREE.Vector2(1, 1) },
        uJitter: { value: new THREE.Vector2() },
        uSharpCon: { value: 1 },
        uSharpOn: { value: 1 },
        uSplit: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: PRESENT_FRAG,
      depthTest: true,
      depthFunc: THREE.AlwaysDepth,
      depthWrite: true,
      toneMapped: true,
      extensions: { fragDepth: true },
    });
    this.presentMaterial.extensions.fragDepth = true;
    const presentQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.presentMaterial);
    presentQuad.frustumCulled = false;
    this.presentScene = new THREE.Scene();
    this.presentScene.background = null;
    this.presentScene.add(presentQuad);
    this._presentQuad = presentQuad;

    this.setMode(opts.mode || TSR_DEFAULT_MODE);
  }

  /**
   * Hint output size and drop history so a resize cannot smear the last frame.
   * Next `render()` still sizes from the drawing buffer.
   * @param {number} w
   * @param {number} h
   */
  setSize(w, h) {
    const nw = Math.max(1, Math.floor(w));
    const nh = Math.max(1, Math.floor(h));
    if (nw === this._outW && nh === this._outH && this._lowRT[0]) return;
    this._outW = 0;
    this._outH = 0;
    this._needReset = true;
    this._havePrevCam = false;
  }

  /** @returns {boolean} true when the next render should go through TSR. */
  get active() {
    return this.supported && this.scale > 0;
  }

  /** Low-res car velocity (NDC delta in rg, coverage in a). Residual uses this. */
  get velocityTexture() {
    return this._velRT ? this._velRT.texture : null;
  }

  /** Packed view-space normals at TSR internal size, or null if the pass aborted. */
  get normalTexture() {
    return this.writeNormals && this._normalRT ? this._normalRT.texture : null;
  }

  /**
   * @param {string} mode off|dlaa|quality|balanced|performance
   */
  setMode(mode) {
    const m = Object.prototype.hasOwnProperty.call(TSR_MODES, mode) ? mode : "off";
    if (m === this.mode) return;
    this.mode = m;
    this.scale = TSR_MODES[m];
    this.jitterCount = this.scale >= 0.999 ? 8 : 16;
    this.maxHistory = TSR_HISTORY_SAMPLES[m] != null ? TSR_HISTORY_SAMPLES[m] : 8;
    this._disposeTargets();
    this._needReset = true;
    this._havePrevCam = false;
    this._lastFrameAt = 0;
  }

  /** Drop the history — call on any hard camera cut (spawn / reset / lap). */
  reset() {
    this._needReset = true;
    this._havePrevCam = false;
    this._lastFrameAt = 0;
    this._velScanTick = 0;
    const list = this._velMeshes;
    for (let i = 0; i < list.length; i++) list[i].hasPrev = false;
  }

  /**
   * Car roots (player + rivals). Each entry may be an Object3D or `{ mesh }`.
   * Identity-stable — a new array of the same meshes does not rescan.
   * @param {Array<any>} roots
   */
  setDynamicRoots(roots) {
    const next = [];
    if (roots) {
      for (let i = 0; i < roots.length; i++) {
        const r = roots[i];
        const o = r && r.isObject3D ? r : r && r.mesh && r.mesh.isObject3D ? r.mesh : null;
        if (o) next.push(o);
      }
    }
    const prev = this._dynamicRoots;
    if (prev.length === next.length) {
      let same = true;
      for (let i = 0; i < next.length; i++) {
        if (prev[i] !== next[i]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this._dynamicRoots = next;
    this._rootsDirty = true;
  }

  /**
   * @param {string} flag
   * @returns {boolean}
   */
  _dbg(flag) {
    return this.debug.has(flag);
  }

  /**
   * Render the scene through TSR. Afterwards `presentScene` holds the
   * reconstructed frame; present it with the game camera through post or
   * straight to the canvas.
   * @param {THREE.Scene} scene
   * @param {THREE.PerspectiveCamera} camera
   */
  render(scene, camera) {
    const r = this.renderer;
    r.getDrawingBufferSize(this._size);
    const outW = Math.max(1, Math.floor(this._size.x));
    const outH = Math.max(1, Math.floor(this._size.y));
    if (outW !== this._outW || outH !== this._outH || !this._lowRT[0]) {
      this._allocate(outW, outH);
    }
    const now = performance.now();
    const frameDt = this._lastFrameAt > 0 ? now - this._lastFrameAt : 16.7;
    if (this._lastFrameAt > 0 && frameDt > 250) this._needReset = true;
    this._lastFrameAt = now;
    this._detectCut(camera);
    const motionPx = this._cameraMotionPx(camera);
    const cheap = motionPx > 12;

    this.frame += 1;
    const lowIdx = this.frame & 1;
    const lowRT = this._lowRT[lowIdx];
    const prevLowRT = this._lowRT[lowIdx ^ 1];
    const lw = this._lowW;
    const lh = this._lowH;

    // Halton (2,3), centred, in low-res pixels.
    const k = (this.frame % this.jitterCount) + 1;
    const jx = this._dbg("nojitter") ? 0 : radicalInverse(k, 2) - 0.5;
    const jy = this._dbg("nojitter") ? 0 : radicalInverse(k, 3) - 0.5;
    this._jitter.set(jx, jy);
    const jNdcX = (2 * jx) / lw;
    const jNdcY = (2 * jy) / lh;

    // Unjittered view-projection for reprojection (camera world matrix is
    // current — the game updates it before present).
    camera.updateMatrixWorld();
    this._viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._invViewProj.copy(this._viewProj).invert();

    const prevAutoClear = r.autoClear;
    const prevTarget = r.getRenderTarget();

    // 1. Jittered low-res scene pass (colour + depth).
    const pe = camera.projectionMatrix.elements;
    const pi = camera.projectionMatrixInverse.elements;
    for (let i = 0; i < 16; i++) {
      this._savedProj[i] = pe[i];
      this._savedInv[i] = pi[i];
    }
    pe[8] -= jNdcX;
    pe[9] -= jNdcY;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    r.autoClear = true;
    r.setRenderTarget(lowRT);
    r.clear();
    r.render(scene, camera);

    // Optional native pass for the split-screen compare (debug only).
    if (this._dbg("split") && this._nativeRT) {
      for (let i = 0; i < 16; i++) {
        pe[i] = this._savedProj[i];
        pi[i] = this._savedInv[i];
      }
      r.setRenderTarget(this._nativeRT);
      r.clear();
      r.render(scene, camera);
      pe[8] -= jNdcX;
      pe[9] -= jNdcY;
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }

    // 2. Low-res view-space normals (appearance net). Same jittered lens.
    this._renderNormals(scene, camera);

    // 3. Velocity pass for cars — same jittered lens so depth texels line up.
    this._renderVelocity(scene, camera, lowRT, jNdcX, jNdcY);

    for (let i = 0; i < 16; i++) {
      pe[i] = this._savedProj[i];
      pi[i] = this._savedInv[i];
    }

    // 4. Temporal resolve into the history ping-pong.
    const histIn = this._histRT[this._histIndex];
    const histOut = this._histRT[this._histIndex ^ 1];
    const u = this._resolveMat.uniforms;
    u.tColor.value = lowRT.texture;
    u.tDepth.value = lowRT.depthTexture;
    u.tPrevDepth.value = prevLowRT.depthTexture;
    u.tVel.value = this._velRT.texture;
    u.tHistory.value = histIn.texture;
    u.uLowSize.value.set(lw, lh);
    u.uOutSize.value.set(this._outW, this._outH);
    u.uJitter.value.copy(this._jitter);
    u.uPrevJitter.value.copy(this._prevJitter);
    u.uScale.value = this.scale;
    u.uInvViewProj.value.copy(this._invViewProj);
    u.uPrevViewProj.value.copy(this._needReset ? this._viewProj : this._prevViewProj);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uMaxN.value = this.maxHistory;
    u.uKernelSigma.value = this.kernelSigma;
    u.uClipGamma.value = this.clipGamma;
    u.uHistoryOn.value = this._dbg("nohistory") ? 0 : 1;
    u.uClipOn.value = this._dbg("noclip") ? 0 : 1;
    u.uReset.value = this._needReset ? 1 : 0;
    u.uCheap.value = cheap ? 1 : 0;
    u.tResurrect.value = this._resurrectRT ? this._resurrectRT.texture : histIn.texture;
    u.uResurrectOn.value = this._dbg("noresurrect") ? 0 : 1;
    u.uFlickerOn.value = this._dbg("noflicker") ? 0 : 1;
    u.uSpatialOn.value = this._dbg("nospatial") || cheap ? 0 : 1;
    u.uShadeRejectOn.value = this._dbg("noreject") ? 0 : 1;
    u.uThinOn.value = this._dbg("nothin") ? 0 : 1;
    u.uVelClampN.value = this._dbg("novclamp") ? this.maxHistory : TSR_VEL_CLAMP_SAMPLES;
    this._quad.material = cheap ? this._resolveMatCheap : this._resolveMat;
    const tResolve = performance.now();
    r.setRenderTarget(histOut);
    r.clear();
    r.render(this._quadScene, this._quadCam);
    this.stats.resolveMs = performance.now() - tResolve;
    this.stats.cheap = cheap ? 1 : 0;
    this._histIndex ^= 1;
    // Persistent frame every 31 (Epic r.TSR.Resurrection.PersistentFrameInterval).
    if (!this._needReset && this._resurrectRT && this.frame % TSR_RESURRECT_INTERVAL === 0) {
      this._copyMat.uniforms.tSrc.value = histOut.texture;
      this._quad.material = this._copyMat;
      r.setRenderTarget(this._resurrectRT);
      r.render(this._quadScene, this._quadCam);
    }

    // 5. Arm the present quad (RCAS + depth) for post / canvas.
    const pm = this.presentMaterial.uniforms;
    pm.tResolved.value = histOut.texture;
    pm.tDepth.value = lowRT.depthTexture;
    pm.uLowSize.value.set(lw, lh);
    pm.uOutSize.value.set(this._outW, this._outH);
    pm.uJitter.value.copy(this._jitter);
    // FidelityFX: 0 stops = sharpest, 2 = softest. sharpness 0.3 → 1.4 stops.
    pm.uSharpCon.value = Math.pow(2, -2 * (1 - this.sharpness));
    pm.uSharpOn.value = this._dbg("nosharp") || this.skipPresentSharp ? 0 : 1;
    pm.uSplit.value = this._dbg("split") && this._nativeRT ? 1 : 0;
    if (this._nativeRT) {
      pm.tNative.value = this._nativeRT.texture;
      pm.tNativeDepth.value = this._nativeRT.depthTexture;
    }

    r.setRenderTarget(prevTarget);
    r.autoClear = prevAutoClear;

    if (this._needReset) this.stats.resets += 1;
    const fps = frameDt > 1 && frameDt < 200 ? 1000 / frameDt : 30;
    const lowPx = this._lowW * this._lowH;
    this.stats.feedMPs = (lowPx * fps) / 1e6;
    const sp2 = this.scale * this.scale;
    this.stats.spp1Ms = sp2 > 1e-4 ? 1000 / (sp2 * fps) : 0;
    this._needReset = false;
    this._prevJitter.copy(this._jitter);
    this._prevViewProj.copy(this._viewProj);
    this._prevCamPos.copy(camera.position);
    this._prevCamQuat.copy(camera.quaternion);
    this._havePrevCam = true;
  }

  /**
   * Packed view-space normals at TSR internal size. Extra scene walk —
   * auto-off if p50 exceeds NORMAL_BUDGET_MS. No albedo (that would blow
   * the 1.5 ms cap on Forest).
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  _renderNormals(scene, camera) {
    const r = this.renderer;
    if (!this.writeNormals || !r) {
      this.stats.normalMs = 0;
      return;
    }
    if (!this._normalRT && this._lowW > 0) {
      const d = new THREE.DepthTexture(this._lowW, this._lowH);
      d.format = THREE.DepthFormat;
      d.type = THREE.FloatType;
      d.minFilter = THREE.NearestFilter;
      d.magFilter = THREE.NearestFilter;
      this._normalRT = new THREE.WebGLRenderTarget(this._lowW, this._lowH, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
        generateMipmaps: false,
        depthTexture: d,
      });
    }
    if (!this._normalRT) {
      this.stats.normalMs = 0;
      return;
    }
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    const prevFog = scene.fog;
    const t0 = performance.now();
    scene.overrideMaterial = this._normalMat;
    scene.background = this._normalClear;
    scene.fog = null;
    r.setRenderTarget(this._normalRT);
    r.clear();
    r.render(scene, camera);
    scene.overrideMaterial = prevOverride;
    scene.background = prevBg;
    scene.fog = prevFog;
    const ms = performance.now() - t0;
    this.stats.normalMs = ms;
    this._normalMsN += 1;
    // Frame 1 is shader compile. Frame 2+ is the real walk — abort immediately
    // if it misses the 1.5 ms budget (Forest override is ~47 ms).
    if (this._normalMsN >= 2 && ms > NORMAL_BUDGET_MS) {
      this.writeNormals = false;
      this._normalsAborted = true;
    }
  }

  /**
   * Hard cut heuristics: a teleport (spawn / respawn) or a snap turn kills
   * the history. Smooth camera blends reproject fine and are left alone.
   * @param {THREE.Camera} camera
   */
  _detectCut(camera) {
    if (!this._havePrevCam) {
      this._needReset = true;
      return;
    }
    const p = camera.position;
    const dx = p.x - this._prevCamPos.x;
    const dy = p.y - this._prevCamPos.y;
    const dz = p.z - this._prevCamPos.z;
    if (dx * dx + dy * dy + dz * dz > 16) this._needReset = true; // > 4 m in one frame
    const qd = Math.abs(camera.quaternion.dot(this._prevCamQuat));
    if (qd < 0.966) this._needReset = true; // > ~30° in one frame
  }

  /**
   * Rough output-pixel motion of the chase point. Used to drop Catmull-Rom
   * and the 3×3 gather when history cannot accumulate anyway.
   * @param {THREE.Camera} camera
   * @returns {number}
   */
  _cameraMotionPx(camera) {
    if (!this._havePrevCam) return 999;
    const dx = camera.position.x - this._prevCamPos.x;
    const dy = camera.position.y - this._prevCamPos.y;
    const dz = camera.position.z - this._prevCamPos.z;
    const move = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const qd = Math.abs(camera.quaternion.dot(this._prevCamQuat));
    const rot = 1 - Math.min(1, qd);
    return move * 90 + rot * 2200;
  }

  /**
   * Draw hero car proxies into the low-res velocity RT. Dedicated scene —
   * never walks Forest trees. `scene` is unused; kept so call sites stay put.
   * @param {THREE.Scene} _scene
   * @param {THREE.Camera} camera
   * @param {THREE.WebGLRenderTarget} lowRT
   * @param {number} jNdcX
   * @param {number} jNdcY
   */
  _renderVelocity(_scene, camera, lowRT, jNdcX, jNdcY) {
    const r = this.renderer;
    const t0 = performance.now();
    this._velScanTick += 1;
    if (this._rootsDirty || !this._velMeshes.length || this._velScanTick % VEL_SCAN_EVERY === 1) {
      this._scanDynamic();
      this._rootsDirty = false;
    }
    const list = this._velMeshes;
    r.getClearColor(this._clearColor);
    const prevClearAlpha = r.getClearAlpha();
    r.setRenderTarget(this._velRT);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.setClearColor(this._clearColor, prevClearAlpha);
    if (!list.length || this._needReset) {
      for (let i = 0; i < list.length; i++) {
        list[i].prev.copy(list[i].mesh.matrixWorld);
        list[i].hasPrev = true;
      }
      this.stats.velMeshes = 0;
      this.stats.velMs = performance.now() - t0;
      return;
    }
    this._velFrustum.setFromProjectionMatrix(this._viewProj);
    camera.getWorldDirection(this._velFwd);
    const prevShadow = r.shadowMap.needsUpdate;
    r.shadowMap.needsUpdate = false;
    let drawn = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const mesh = e.mesh;
      const proxy = e.proxy;
      const show = this._velMeshVisible(e, camera) && (e.player || drawn < VEL_MESH_CAP);
      proxy.visible = show;
      if (!show) continue;
      proxy.matrixWorld.copy(mesh.matrixWorld);
      const mu = e.mat.uniforms;
      mu.uPrevViewProj.value.copy(this._needReset ? this._viewProj : this._prevViewProj);
      mu.uPrevModel.value.copy(e.hasPrev && !this._needReset ? e.prev : mesh.matrixWorld);
      mu.uJitterNdc.value.set(jNdcX, jNdcY);
      mu.tDepth.value = lowRT.depthTexture;
      drawn += 1;
    }
    const prevAuto = r.autoClear;
    r.autoClear = false;
    try {
      if (drawn) r.render(this._velScene, camera);
    } finally {
      for (let i = 0; i < list.length; i++) {
        const e = list[i];
        if (e.proxy.visible) {
          e.prev.copy(e.mesh.matrixWorld);
          e.hasPrev = true;
        }
      }
      r.shadowMap.needsUpdate = prevShadow;
      r.autoClear = prevAuto;
    }
    this.stats.velMeshes = drawn;
    this.stats.velMs = performance.now() - t0;
  }

  /**
   * Body/wheels that are on-screen and close enough to need their own motion.
   * Distant / behind-camera cars reproject from depth only.
   * @param {{mesh: THREE.Mesh, player: boolean}} e
   * @param {THREE.Camera} camera
   * @returns {boolean}
   */
  _velMeshVisible(e, camera) {
    const mesh = e.mesh;
    if (!mesh || !mesh.parent || mesh.visible === false) return false;
    mesh.getWorldPosition(this._velWorld);
    const dx = this._velWorld.x - camera.position.x;
    const dy = this._velWorld.y - camera.position.y;
    const dz = this._velWorld.z - camera.position.z;
    const dist2 = dx * dx + dy * dy + dz * dz;
    const maxM = e.player ? 140 : 80;
    if (dist2 > maxM * maxM) return false;
    if (dist2 > 36) {
      const along = dx * this._velFwd.x + dy * this._velFwd.y + dz * this._velFwd.z;
      if (along < -2) return false;
    }
    const g = mesh.geometry;
    if (g) {
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (g.boundingSphere) {
        this._velSphere.copy(g.boundingSphere);
        this._velSphere.applyMatrix4(mesh.matrixWorld);
        if (!this._velFrustum.intersectsSphere(this._velSphere)) return false;
      }
    }
    return true;
  }

  /** Rebuild the hero-mesh velocity list (body + wheels, not the whole GLB). */
  _scanDynamic() {
    const roots = this._dynamicRoots;
    const prevByMesh = new Map();
    for (const e of this._velMeshes) prevByMesh.set(e.mesh, e);
    const next = [];
    const keep = new Set();
    for (let i = 0; i < roots.length; i++) {
      const heroes = collectHeroVelMeshes(roots[i]);
      for (let h = 0; h < heroes.length; h++) {
        const o = heroes[h];
        let e = prevByMesh.get(o);
        if (!e) {
          const mat = this._makeVelocityMaterial();
          const proxy = new THREE.Mesh(o.geometry, mat);
          proxy.matrixAutoUpdate = false;
          proxy.matrixWorldAutoUpdate = false;
          proxy.frustumCulled = false;
          proxy.castShadow = false;
          proxy.receiveShadow = false;
          this._velScene.add(proxy);
          e = {
            mesh: o,
            proxy,
            mat,
            prev: new THREE.Matrix4(),
            hasPrev: false,
            player: i === 0,
          };
        } else {
          e.player = i === 0;
          if (e.proxy.geometry !== o.geometry) e.proxy.geometry = o.geometry;
        }
        keep.add(e);
        next.push(e);
      }
    }
    for (const e of this._velMeshes) {
      if (keep.has(e)) continue;
      if (e.proxy && e.proxy.parent) e.proxy.parent.remove(e.proxy);
      e.mat.dispose();
    }
    this._velMeshes = next;
    this.stats.velScanned = next.length;
  }

  /** @returns {THREE.ShaderMaterial} */
  _makeVelocityMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: {
        uPrevViewProj: { value: new THREE.Matrix4() },
        uPrevModel: { value: new THREE.Matrix4() },
        uJitterNdc: { value: new THREE.Vector2() },
        tDepth: { value: null },
      },
      vertexShader: VEL_VERT,
      fragmentShader: VEL_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
      fog: false,
      lights: false,
    });
  }

  /**
   * (Re)allocate every render target for a new output size.
   * @param {number} outW
   * @param {number} outH
   */
  _allocate(outW, outH) {
    this._disposeTargets();
    this._outW = outW;
    this._outH = outH;
    const s = this.scale > 0 ? this.scale : 1;
    const lw = Math.max(1, Math.round(outW * s));
    const lh = Math.max(1, Math.round(outH * s));
    this._lowW = lw;
    this._lowH = lh;
    const mkDepth = (w, h) => {
      const d = new THREE.DepthTexture(w, h);
      d.format = THREE.DepthFormat;
      d.type = THREE.FloatType;
      d.minFilter = THREE.NearestFilter;
      d.magFilter = THREE.NearestFilter;
      return d;
    };
    const colorOpts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
      generateMipmaps: false,
    };
    for (let i = 0; i < 2; i++) {
      this._lowRT[i] = new THREE.WebGLRenderTarget(lw, lh, { ...colorOpts, depthTexture: mkDepth(lw, lh) });
    }
    this._velRT = new THREE.WebGLRenderTarget(lw, lh, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    });
    // LOOK G-buffer only — skip the extra walk + RT while appearance is off.
    if (this.writeNormals) {
      this._normalRT = new THREE.WebGLRenderTarget(lw, lh, {
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
        generateMipmaps: false,
        depthTexture: mkDepth(lw, lh),
      });
    } else {
      this._normalRT = null;
    }
    const histOpts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    for (let i = 0; i < 2; i++) {
      this._histRT[i] = new THREE.WebGLRenderTarget(outW, outH, histOpts);
    }
    this._resurrectRT = new THREE.WebGLRenderTarget(outW, outH, histOpts);
    if (this._dbg("split")) {
      this._nativeRT = new THREE.WebGLRenderTarget(outW, outH, { ...colorOpts, depthTexture: mkDepth(outW, outH) });
    }
    // Touch every target once so a never-rendered history / previous depth is
    // a real (black) texture rather than an unbound sampler on the first frame.
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    r.getClearColor(this._clearColor);
    const prevAlpha = r.getClearAlpha();
    r.setClearColor(0x000000, 0);
    const touch = (rt) => {
      if (!rt) return;
      r.setRenderTarget(rt);
      r.clear(true, true, false);
    };
    touch(this._lowRT[0]);
    touch(this._lowRT[1]);
    touch(this._velRT);
    touch(this._normalRT);
    touch(this._histRT[0]);
    touch(this._histRT[1]);
    touch(this._resurrectRT);
    touch(this._nativeRT);
    r.setClearColor(this._clearColor, prevAlpha);
    r.setRenderTarget(prevTarget);
    this._histIndex = 0;
    this._needReset = true;
    const lowPx = lw * lh;
    const outPx = outW * outH;
    let bytes = 2 * lowPx * (8 + 4) + lowPx * 8 + lowPx * 8 + 3 * outPx * 8;
    if (this._nativeRT) bytes += outPx * (8 + 4);
    this.stats.lowW = lw;
    this.stats.lowH = lh;
    this.stats.outW = outW;
    this.stats.outH = outH;
    this.stats.bytes = bytes;
  }

  _disposeTargets() {
    for (let i = 0; i < 2; i++) {
      if (this._lowRT[i]) {
        this._lowRT[i].depthTexture?.dispose();
        this._lowRT[i].dispose();
        this._lowRT[i] = null;
      }
      if (this._histRT[i]) {
        this._histRT[i].dispose();
        this._histRT[i] = null;
      }
    }
    if (this._velRT) {
      this._velRT.dispose();
      this._velRT = null;
    }
    if (this._resurrectRT) {
      this._resurrectRT.dispose();
      this._resurrectRT = null;
    }
    if (this._normalRT) {
      this._normalRT.depthTexture?.dispose();
      this._normalRT.dispose();
      this._normalRT = null;
    }
    if (this._nativeRT) {
      this._nativeRT.depthTexture?.dispose();
      this._nativeRT.dispose();
      this._nativeRT = null;
    }
    this._outW = 0;
    this._outH = 0;
  }

  dispose() {
    this._disposeTargets();
    for (const e of this._velMeshes) {
      if (e.proxy && e.proxy.parent) e.proxy.parent.remove(e.proxy);
      e.mat.dispose();
    }
    this._velMeshes.length = 0;
    this._resolveMat.dispose();
    if (this._resolveMatCheap) this._resolveMatCheap.dispose();
    if (this._copyMat) this._copyMat.dispose();
    if (this._normalMat) this._normalMat.dispose();
    this.presentMaterial.dispose();
    this._quad.geometry.dispose();
    this._presentQuad.geometry.dispose();
  }
}
