/**
 * Legal 3D-guided reconstruct — depth-aware residual after TSR.
 *
 * WHO THIS IS FOR: RallyGame._render, after TSR resolve.
 * WHAT IT DOES: WebGL2 half-float 3×3 RCAS + EASU-style residual using the
 *   hand-authored kernels in recon-weights.js, now gated by scene depth
 *   (and cheap depth-derived normals). Protects car/tree silhouettes, kills
 *   sky/horizon ringing, sharpens contact edges. Missing extension →
 *   Catmull-Rom bicubic passthrough (no residual). No TensorFlow, no
 *   downloaded / NVIDIA / NGX weights.
 * HOW IT CONNECTS: createReconstruct(renderer) → { setSize, render, dispose }.
 *   Default on for desktop + TSR. `?recon=0` or Pause → Refine off.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../../vendor/three.module.js";
import {
  RECON_WEIGHTS,
  RECON_BUDGET_MS,
  GUIDED_RECON_BUDGET_MS,
  RECON_FLAG,
  RECON_STORAGE_KEY,
} from "./recon-weights.js?v=3";

export { RECON_WEIGHTS, RECON_BUDGET_MS, GUIDED_RECON_BUDGET_MS, RECON_FLAG, RECON_STORAGE_KEY };

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * One-pass 3×3 reconstruct, optionally guided by a depth texture.
 *   1. Fetch the 3×3 colour (and depth when uHasDepth).
 *   2. EASU-lite centre, depth-bilateral so a silhouette neighbour is out.
 *   3. Directional residual, gated by luma + depth + n·n.
 *   4. Sky / far fade — no horizon ringing. Contact boost on mid depth edges.
 *   5. RCAS 5-tap (skipped on sky). Hard 3×3 clamp — no-halo contract.
 *
 * Normals are reconstructed from the 3×3 linear-Z taps (no extra G-buffer
 * pass, no MeshNormalMaterial override).
 */
const RECON_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform vec2 uDepthTexel;
uniform vec2 uDepthSize;
uniform vec2 uJitter;
uniform vec2 uSrcSize;
uniform vec2 uOutSize;
uniform float uGain;
uniform float uEdgeKnee;
uniform float uRcasSharp;
uniform float uClampSlack;
uniform float uRangeSigma;
uniform float uHasDepth;
uniform float uNear;
uniform float uFar;
uniform float uDepthSigmaM;
uniform float uSkyCut;
uniform float uHorizonStart;
uniform float uHorizonEnd;
uniform float uContactBoost;
uniform float uHaloGate;
uniform float uNormalGate;
uniform sampler2D tVel;
uniform float uHasVel;
uniform float uMotionSoftPx;
uniform float uDirH[9];
uniform float uDirV[9];
uniform float uDirD1[9];
uniform float uDirD2[9];
uniform float uIso[9];
varying vec2 vUv;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 tap(vec2 uv) {
  return texture2D(tColor, clamp(uv, uTexel * 0.5, 1.0 - uTexel * 0.5)).rgb;
}

float tapD(vec2 uv) {
  return texture2D(tDepth, clamp(uv, uDepthTexel * 0.5, 1.0 - uDepthTexel * 0.5)).r;
}

/**
 * Nearest low-res depth at an output UV. Bilinear depth is the halo case
 * (car colour leaking onto a tree). When uDepthSize is set (TSR), the 3×3
 * is taken in *low-res texels* so a silhouette is a real neighbour.
 */
float fetchDepth(vec2 outUv, vec2 lowOff) {
  if (uDepthSize.x > 1.5) {
    vec2 q = outUv * uDepthSize + uJitter;
    vec2 lim = max(uDepthSize - 1.0, vec2(0.0));
    vec2 i = clamp(floor(q) + lowOff, vec2(0.0), lim);
    vec2 uv = (i + 0.5) / uDepthSize;
    return texture2D(tDepth, uv).r;
  }
  return tapD(outUv + lowOff * uDepthTexel);
}

float linZ(float d) {
  float z = d * 2.0 - 1.0;
  return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
}

void main() {
  vec2 srcUv = vUv;
  vec2 srcPx = srcUv * uSrcSize;
  vec2 base = floor(srcPx - 0.5);
  vec2 f = srcPx - 0.5 - base;
  vec2 uv00 = (base + 0.5) * uTexel;

  vec3 s[9];
  float y[9];
  float dv[9];
  float zv[9];
  vec3 nmin = vec3(1.0e6);
  vec3 nmax = vec3(-1.0e6);
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      int k = j * 3 + i;
      vec2 uv = uv00 + vec2(float(i) - 1.0, float(j) - 1.0) * uTexel;
      s[k] = tap(uv);
      y[k] = luma(s[k]);
      if (uHasDepth > 0.5) {
        dv[k] = fetchDepth(vUv, vec2(float(i) - 1.0, float(j) - 1.0));
        zv[k] = linZ(clamp(dv[k], 0.0, 0.999999));
      } else {
        dv[k] = 0.5;
        zv[k] = 8.0;
      }
    }
  }

  float dC = dv[4];
  float zC = zv[4];
  bool sky = uHasDepth > 0.5 && dC >= uSkyCut;
  float skyFade = sky ? 0.0 : 1.0;
  float farFade = 1.0;
  if (uHasDepth > 0.5 && !sky) {
    farFade = 1.0 - smoothstep(uHorizonStart, uHorizonEnd, zC);
  }

  // Depth-derived view normal from the cross (cheap, no extra pass).
  vec3 nrm = vec3(0.0, 0.0, 1.0);
  vec3 pn[9];
  if (uHasDepth > 0.5 && !sky) {
    for (int k = 0; k < 9; k++) {
      float col = float(k - (k / 3) * 3) - 1.0;
      float row = float(k / 3) - 1.0;
      pn[k] = vec3(col * uTexel.x * zC, row * uTexel.y * zC, -zv[k]);
    }
    vec3 dx = pn[5] - pn[3];
    vec3 dy = pn[7] - pn[1];
    nrm = normalize(cross(dx, dy) + vec3(0.0, 0.0, 1.0e-5));
  }

  float scaleX = uSrcSize.x / max(uOutSize.x, 1.0);
  bool up = scaleX < 0.97;
  vec3 centre = s[4];
  if (up && !sky) {
    float wSum = 0.0;
    vec3 acc = vec3(0.0);
    float yRef = mix(mix(y[4], y[5], f.x), mix(y[7], y[8], f.x), f.y);
    float sig2 = max(uRangeSigma * uRangeSigma, 1.0e-5);
    float sigZ = max(uDepthSigmaM * uDepthSigmaM, 1.0e-4);
    for (int j = 0; j < 3; j++) {
      for (int i = 0; i < 3; i++) {
        int k = j * 3 + i;
        vec2 d = vec2(float(i) - 1.0, float(j) - 1.0) - f;
        float spat = exp(-dot(d, d) * 1.65);
        float dy = y[k] - yRef;
        float range = exp(-(dy * dy) / sig2);
        float depthW = 1.0;
        if (uHasDepth > 0.5) {
          float dz = zv[k] - zC;
          depthW = mix(1.0, exp(-(dz * dz) / sigZ), uHaloGate);
          if (dv[k] >= uSkyCut && dC < uSkyCut) depthW = 0.0;
        }
        float w = spat * range * depthW;
        wSum += w;
        acc += s[k] * w;
      }
    }
    centre = acc / max(wSum, 1.0e-5);
  }

  // Sobel luma + linear-Z so a dark car on a dark trunk still counts as an edge.
  float gx = (y[2] + 2.0 * y[5] + y[8]) - (y[0] + 2.0 * y[3] + y[6]);
  float gy = (y[6] + 2.0 * y[7] + y[8]) - (y[0] + 2.0 * y[1] + y[2]);
  float mag = sqrt(gx * gx + gy * gy);
  float edge = smoothstep(uEdgeKnee, uEdgeKnee * 3.4, mag);
  float zGrad = 0.0;
  if (uHasDepth > 0.5 && !sky) {
    float zgx = (zv[2] + 2.0 * zv[5] + zv[8]) - (zv[0] + 2.0 * zv[3] + zv[6]);
    float zgy = (zv[6] + 2.0 * zv[7] + zv[8]) - (zv[0] + 2.0 * zv[1] + zv[2]);
    zGrad = sqrt(zgx * zgx + zgy * zgy);
    float depthEdge = smoothstep(0.08, 0.55, zGrad);
    edge = max(edge, depthEdge);
  }
  float ang = atan(gy, gx);
  if (uHasDepth > 0.5 && mag < uEdgeKnee * 1.4 && zGrad > 0.08) {
    float zgx = (zv[2] + 2.0 * zv[5] + zv[8]) - (zv[0] + 2.0 * zv[3] + zv[6]);
    float zgy = (zv[6] + 2.0 * zv[7] + zv[8]) - (zv[0] + 2.0 * zv[1] + zv[2]);
    ang = atan(zgy, zgx);
  }
  float a = ang / 3.14159265;
  float wV = max(0.0, 1.0 - abs(a) * 2.0);
  float wH = max(0.0, 1.0 - abs(abs(a) - 0.5) * 2.0);
  float wD1 = max(0.0, 1.0 - abs(abs(a) - 0.25) * 2.0);
  float wD2 = max(0.0, 1.0 - abs(abs(a) - 0.75) * 2.0);
  float wIso = 1.0 - edge;
  float wN = max(wH + wV + wD1 + wD2 + wIso, 1.0e-5);

  vec3 residual = vec3(0.0);
  float yC = luma(centre);
  float sigR = max(uRangeSigma * uRangeSigma, 1.0e-5);
  float sigZ = max(uDepthSigmaM * uDepthSigmaM, 1.0e-4);
  for (int k = 0; k < 9; k++) {
    float kk = (uDirH[k] * wH + uDirV[k] * wV + uDirD1[k] * wD1 + uDirD2[k] * wD2 + uIso[k] * wIso) / wN;
    float dy = y[k] - yC;
    float gate = exp(-(dy * dy) / sigR);
    if (uHasDepth > 0.5) {
      float dz = zv[k] - zC;
      float depthW = mix(1.0, exp(-(dz * dz) / sigZ), uHaloGate);
      if (dv[k] >= uSkyCut && dC < uSkyCut) depthW = 0.0;
      float nDot = 1.0;
      if (!sky) {
        vec3 toN = pn[k] - pn[4];
        float toLen = length(toN);
        // Same-plane neighbours sit perpendicular to the depth normal;
        // a car/tree step has a large |n·offset| and must not feed residual.
        float planeErr = toLen > 1.0e-4 ? abs(dot(nrm, toN)) / toLen : 0.0;
        nDot = mix(1.0, 1.0 - smoothstep(uNormalGate * 0.35, 0.62, planeErr), uHaloGate);
      }
      gate *= depthW * nDot;
    }
    residual += s[k] * kk * gate;
  }

  float contact = 0.0;
  if (uHasDepth > 0.5 && !sky) {
    contact = smoothstep(0.06, 0.22, zGrad) * (1.0 - smoothstep(1.4, 4.5, zGrad));
  }
  // DLSS-class: do not spatially sharpen along screen motion (cars / camera).
  float motionFade = 1.0;
  if (uHasVel > 0.5 && uHasDepth > 0.5 && !sky) {
    vec2 qv = vUv * uDepthSize + uJitter;
    vec2 limv = max(uDepthSize - 1.0, vec2(0.0));
    vec2 iv = clamp(floor(qv), vec2(0.0), limv);
    vec4 vel = texture2D(tVel, (iv + 0.5) / uDepthSize);
    float motionPx = vel.a > 0.5 ? length(vel.xy) * uOutSize.x * 0.5 : 0.0;
    motionFade = 1.0 - smoothstep(2.0, max(uMotionSoftPx, 4.0), motionPx);
  }
  float gainMul = skyFade * farFade * motionFade * (1.0 + uContactBoost * contact);
  vec3 outC = centre + residual * (uGain * edge * gainMul);

  if (uRcasSharp > 0.001 && skyFade > 0.02) {
    vec3 b = s[1];
    vec3 d = s[3];
    vec3 e = outC;
    vec3 f = s[5];
    vec3 h = s[7];
    float zLim = uDepthSigmaM * 2.6;
    if (uHasDepth > 0.5) {
      if (abs(zv[1] - zC) > zLim || dv[1] >= uSkyCut) b = e;
      if (abs(zv[3] - zC) > zLim || dv[3] >= uSkyCut) d = e;
      if (abs(zv[5] - zC) > zLim || dv[5] >= uSkyCut) f = e;
      if (abs(zv[7] - zC) > zLim || dv[7] >= uSkyCut) h = e;
    }
    vec3 mn4 = min(min(b, d), min(f, h));
    vec3 mx4 = max(max(b, d), max(f, h));
    vec3 hitMin = min(mn4, e) / (4.0 * mx4 + 1.0e-4);
    vec3 hitMax = (1.0 - max(mx4, e)) / (4.0 * mn4 - 4.0 + 1.0e-4);
    vec3 lobeRGB = max(-hitMin, hitMax);
    float lobe = max(-0.1875, min(max(lobeRGB.r, max(lobeRGB.g, lobeRGB.b)), 0.0)) * (uRcasSharp * 4.0 * skyFade * farFade);
    float rcpL = 1.0 / (4.0 * lobe + 1.0);
    outC = (lobe * (b + d + f + h) + e) * rcpL;
  }

  if (sky) {
    outC = s[4];
  }

  nmin = s[4];
  nmax = s[4];
  float zLimC = uDepthSigmaM * 2.6;
  for (int k = 0; k < 9; k++) {
    bool same = true;
    if (uHasDepth > 0.5) {
      same = dv[k] < uSkyCut && abs(zv[k] - zC) <= zLimC && (zv[k] == zv[k]);
    }
    if (same) {
      nmin = min(nmin, s[k]);
      nmax = max(nmax, s[k]);
    }
  }
  vec3 lo = nmin - vec3(uClampSlack);
  vec3 hi = nmax + vec3(uClampSlack);
  outC = clamp(outC, lo, hi);
  if (outC != outC) outC = s[4];
  gl_FragColor = vec4(max(outC, 0.0), 1.0);
}
`;

/**
 * Catmull-Rom bicubic — used when half-float render targets are missing.
 * Passthrough: no residual, no claim of reconstruct.
 */
const BICUBIC_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;

vec4 cubic(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}

vec3 bicubic(vec2 uv) {
  vec2 inv = 1.0 / max(uTexel, vec2(1.0e-6));
  vec2 px = uv * inv - 0.5;
  vec2 fpx = floor(px);
  vec2 f = px - fpx;
  vec4 xcub = cubic(f.x);
  vec4 ycub = cubic(f.y);
  vec4 c = vec4(fpx.x - 0.5, fpx.x + 1.5, fpx.y - 0.5, fpx.y + 1.5);
  vec4 s = vec4(xcub.x + xcub.y, xcub.z + xcub.w, ycub.x + ycub.y, ycub.z + ycub.w);
  vec4 off = c + vec4(xcub.y, xcub.w, ycub.y, ycub.w) / s;
  vec2 t0 = vec2(off.x, off.z) * uTexel;
  vec2 t1 = vec2(off.y, off.z) * uTexel;
  vec2 t2 = vec2(off.x, off.w) * uTexel;
  vec2 t3 = vec2(off.y, off.w) * uTexel;
  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  vec3 a = mix(texture2D(tColor, t1).rgb, texture2D(tColor, t0).rgb, sx);
  vec3 b = mix(texture2D(tColor, t3).rgb, texture2D(tColor, t2).rgb, sx);
  return mix(b, a, sy);
}

void main() {
  gl_FragColor = vec4(max(bicubic(vUv), 0.0), 1.0);
}
`;

/**
 * Remember Pause → Refine so the next boot stays set.
 * @param {boolean} on
 */
export function persistReconEnabled(on) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(RECON_STORAGE_KEY, on ? "1" : "0");
    }
  } catch {
    /* private mode */
  }
}

/**
 * Parse `?recon=` / stored Refine. Default on (desktop decision is in game.js).
 * @param {string} [search]
 * @returns {{ enabled: boolean, forced: boolean }}
 */
export function parseReconParams(search) {
  let stored = "";
  try {
    stored = typeof localStorage !== "undefined" ? localStorage.getItem(RECON_STORAGE_KEY) || "" : "";
  } catch {
    stored = "";
  }
  let enabled = stored === "0" ? false : true;
  let forced = false;
  try {
    const p = new URLSearchParams(search != null ? search : (typeof location !== "undefined" ? location.search : ""));
    const m = (p.get(RECON_FLAG) || "").toLowerCase();
    if (m === "0" || m === "off" || m === "false" || m === "none") {
      enabled = false;
      forced = true;
    } else if (m === "1" || m === "on" || m === "residual" || m === "guided" || m === "true") {
      enabled = true;
      forced = true;
    }
  } catch {
    /* no URL */
  }
  return { enabled, forced };
}

/**
 * WebGL2 + a renderable half-float target.
 * @param {THREE.WebGLRenderer} renderer
 * @returns {boolean}
 */
export function reconHalfFloatOk(renderer) {
  if (!renderer) return false;
  const caps = renderer.capabilities;
  const gl = typeof renderer.getContext === "function" ? renderer.getContext() : null;
  if (!(caps && caps.isWebGL2) || !gl) return false;
  try {
    return !!(renderer.extensions.has("EXT_color_buffer_float") ||
      renderer.extensions.has("EXT_color_buffer_half_float"));
  } catch {
    return false;
  }
}

/**
 * Spatial reconstruct pass (depth-guided when a depth texture is supplied).
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ gain?: number }} [opts]
 * @returns {{
 *   setSize: (w: number, h: number) => void,
 *   render: (colorTex: THREE.Texture|THREE.WebGLRenderTarget, outTarget: THREE.WebGLRenderTarget|null, guide?: object) => void,
 *   dispose: () => void,
 *   supported: boolean,
 *   enabled: boolean,
 *   fallback: string,
 *   stats: { lastMs: number, w: number, h: number, guided: boolean }
 * }}
 */
export function createReconstruct(renderer, opts = {}) {
  const supported = reconHalfFloatOk(renderer);
  const W = RECON_WEIGHTS;
  const gain = opts.gain != null ? opts.gain : W.gain;

  const dummyDepth = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  dummyDepth.needsUpdate = true;

  const uniforms = {
    tColor: { value: null },
    tDepth: { value: dummyDepth },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uDepthTexel: { value: new THREE.Vector2(1, 1) },
    uDepthSize: { value: new THREE.Vector2(1, 1) },
    uJitter: { value: new THREE.Vector2() },
    uSrcSize: { value: new THREE.Vector2(1, 1) },
    uOutSize: { value: new THREE.Vector2(1, 1) },
    uGain: { value: gain },
    uEdgeKnee: { value: W.edgeKnee },
    uRcasSharp: { value: W.rcasSharp },
    uClampSlack: { value: W.clampSlack },
    uRangeSigma: { value: W.rangeSigma },
    uHasDepth: { value: 0 },
    uNear: { value: 0.18 },
    uFar: { value: 1400 },
    uDepthSigmaM: { value: W.depthSigmaM != null ? W.depthSigmaM : 0.72 },
    uSkyCut: { value: W.skyCut != null ? W.skyCut : 0.99915 },
    uHorizonStart: { value: W.horizonStartM != null ? W.horizonStartM : 160 },
    uHorizonEnd: { value: W.horizonEndM != null ? W.horizonEndM : 480 },
    uContactBoost: { value: W.contactBoost != null ? W.contactBoost : 0.42 },
    uHaloGate: { value: W.haloGate != null ? W.haloGate : 1 },
    uNormalGate: { value: W.normalGate != null ? W.normalGate : 0.42 },
    tVel: { value: dummyDepth },
    uHasVel: { value: 0 },
    uMotionSoftPx: { value: 16 },
    uDirH: { value: Array.from(W.dirH) },
    uDirV: { value: Array.from(W.dirV) },
    uDirD1: { value: Array.from(W.dirD1) },
    uDirD2: { value: Array.from(W.dirD2) },
    uIso: { value: Array.from(W.iso) },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: supported ? RECON_FRAG : BICUBIC_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
    fog: false,
    lights: false,
  });

  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);

  let outW = 1;
  let outH = 1;
  const stats = { lastMs: 0, w: 1, h: 1, guided: false };

  /**
   * @param {THREE.Texture|THREE.WebGLRenderTarget} colorTex
   * @returns {THREE.Texture|null}
   */
  function asTexture(colorTex) {
    if (!colorTex) return null;
    if (colorTex.isWebGLRenderTarget) return colorTex.texture;
    return colorTex;
  }

  /**
   * @param {THREE.Texture} tex
   * @returns {{ w: number, h: number }}
   */
  function texSize(tex) {
    const img = tex && (tex.image || (tex.source && tex.source.data));
    const w = (img && (img.width || img.videoWidth)) || (tex && tex.width) || outW;
    const h = (img && (img.height || img.videoHeight)) || (tex && tex.height) || outH;
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  const api = {
    supported,
    enabled: true,
    fallback: supported ? "residual" : "bicubic",
    stats,
    setSize(w, h) {
      outW = Math.max(1, Math.floor(w));
      outH = Math.max(1, Math.floor(h));
      uniforms.uOutSize.value.set(outW, outH);
      stats.w = outW;
      stats.h = outH;
    },
    /**
     * @param {THREE.Texture|THREE.WebGLRenderTarget} colorTex
     * @param {THREE.WebGLRenderTarget|null} outTarget
     * @param {{ depth?: THREE.Texture, velocity?: THREE.Texture, near?: number, far?: number, depthWidth?: number, depthHeight?: number, jitter?: {x:number,y:number} }} [guide]
     */
    render(colorTex, outTarget, guide) {
      const tex = asTexture(colorTex);
      if (!tex || !renderer) return;
      const { w, h } = texSize(tex);
      uniforms.tColor.value = tex;
      uniforms.uTexel.value.set(1 / w, 1 / h);
      uniforms.uSrcSize.value.set(w, h);
      if (outTarget && outTarget.width && outTarget.height) {
        uniforms.uOutSize.value.set(outTarget.width, outTarget.height);
      } else {
        uniforms.uOutSize.value.set(outW, outH);
      }
      const depth = guide && guide.depth;
      if (depth) {
        uniforms.tDepth.value = depth;
        const ds = texSize(depth);
        const dw = guide.depthWidth || guide.lowW || ds.w;
        const dh = guide.depthHeight || guide.lowH || ds.h;
        uniforms.uDepthTexel.value.set(1 / Math.max(1, dw), 1 / Math.max(1, dh));
        uniforms.uDepthSize.value.set(Math.max(1, dw), Math.max(1, dh));
        if (guide.jitter) uniforms.uJitter.value.set(guide.jitter.x || 0, guide.jitter.y || 0);
        else uniforms.uJitter.value.set(0, 0);
        uniforms.uHasDepth.value = 1;
        uniforms.uNear.value = guide.near != null ? guide.near : 0.18;
        uniforms.uFar.value = guide.far != null ? guide.far : 1400;
        const vel = guide.velocity;
        if (vel) {
          uniforms.tVel.value = vel;
          uniforms.uHasVel.value = 1;
        } else {
          uniforms.tVel.value = dummyDepth;
          uniforms.uHasVel.value = 0;
        }
        stats.guided = true;
      } else {
        uniforms.tDepth.value = dummyDepth;
        uniforms.uDepthTexel.value.set(1, 1);
        uniforms.uDepthSize.value.set(1, 1);
        uniforms.uJitter.value.set(0, 0);
        uniforms.uHasDepth.value = 0;
        uniforms.tVel.value = dummyDepth;
        uniforms.uHasVel.value = 0;
        stats.guided = false;
      }
      const prev = renderer.getRenderTarget();
      const prevAuto = renderer.autoClear;
      const t0 = performance.now();
      renderer.autoClear = true;
      renderer.setRenderTarget(outTarget || null);
      renderer.render(quadScene, quadCam);
      renderer.setRenderTarget(prev);
      renderer.autoClear = prevAuto;
      stats.lastMs = performance.now() - t0;
    },
    /**
     * QA: same draw with gl.finish so lastMs is GPU time.
     * @param {THREE.Texture|THREE.WebGLRenderTarget} colorTex
     * @param {THREE.WebGLRenderTarget|null} outTarget
     * @param {object} [guide]
     * @returns {number}
     */
    measure(colorTex, outTarget, guide) {
      const gl = renderer && typeof renderer.getContext === "function" ? renderer.getContext() : null;
      if (gl && gl.finish) gl.finish();
      const t0 = performance.now();
      api.render(colorTex, outTarget, guide);
      if (gl && gl.finish) gl.finish();
      stats.lastMs = performance.now() - t0;
      return stats.lastMs;
    },
    dispose() {
      mat.dispose();
      quad.geometry.dispose();
      dummyDepth.dispose();
    },
  };

  return api;
}
