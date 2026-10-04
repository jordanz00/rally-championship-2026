/**
 * WebTSR appearance net — hand-authored residual after temporal SR.
 *
 * WHO THIS IS FOR: the WebTSR SDK and this rally title. Legal analog of
 *   DLSS-class *appearance* (lighting / material richness), not NVIDIA.
 * WHAT IT DOES: half-res 3×3 kernels read reconstructed colour + depth +
 *   view-space normals + motion, write a residual only, then composite
 *   that residual onto the full-res TSR buffer *before* ACES. Never stacked with TSR present RCAS.
 *   Never replaces the resolve with a
 *   bilinear upsample (that was softening LOOK).
 * HOW IT CONNECTS: createWebTsr({ appearance: true }) runs this after
 *   TSR + guided residual, then the host still presents presentScene.
 *
 * v1 is authored GLSL, not a trained weight file. No NGX, no Streamline,
 * no leaked checkpoints. Resume language: "original browser TSR + 3D-
 * guided appearance residual (DLSS-class capability, not NVIDIA)."
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../../vendor/three.module.js";

export const APPEAR_FLAG = "appear";
export const APPEAR_STORAGE_KEY = "rally-appear-v1";
export const APPEAR_BUDGET_MS = 1.8;
export const APPEAR_LUMA_HEADROOM = 1.02;
/**
 * Desktop default ON — this is the DLSS-class appearance residual the
 * player asked to see. Phones never compile it (`wantsHeavyWebTsr`).
 * `?appear=0` or Pause LOOK still kill it. G-buffer walk still aborts
 * if it exceeds APPEAR_BUDGET_MS.
 */
export const APPEAR_DEFAULT = true;

/**
 * @param {Iterable<string>|URLSearchParams|null} [debug]
 * @returns {{ enabled: boolean|null }}
 */
export function parseAppearParams(debug) {
  const params = debug instanceof URLSearchParams
    ? debug
    : (typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams());
  if (params.has(APPEAR_FLAG)) {
    const v = String(params.get(APPEAR_FLAG) || "").toLowerCase();
    if (v === "0" || v === "off" || v === "false") return { enabled: false };
    if (v === "1" || v === "on" || v === "true" || v === "") return { enabled: true };
  }
  try {
    const stored = localStorage.getItem(APPEAR_STORAGE_KEY);
    if (stored === "0") return { enabled: false };
    if (stored === "1") return { enabled: true };
  } catch { /* private mode */ }
  return { enabled: APPEAR_DEFAULT };
}

/**
 * @param {boolean} on
 */
export function persistAppearEnabled(on) {
  try {
    localStorage.setItem(APPEAR_STORAGE_KEY, on ? "1" : "0");
  } catch { /* ignore */ }
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Half-res residual field. Writes the *delta* only so the compose pass
 * can add it back onto the full-res TSR colour.
 */
const FIELD_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform sampler2D tVel;
uniform sampler2D tResHist;
uniform vec2 texel;
uniform vec2 uLowSize;
uniform vec2 uOutSize;
uniform float cameraNear;
uniform float cameraFar;
uniform float uHasNormal;
uniform float uHasVel;
uniform float uHasHist;
uniform float uGain;
varying vec2 vUv;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float perspectiveDepthToViewZ(float invClipZ, float near, float far) {
  return (near * far) / ((far - near) * invClipZ - far);
}

vec3 decodeN(vec2 uv) {
  vec3 packed = texture2D(tNormal, uv).xyz;
  return normalize(packed * 2.0 - 1.0);
}

void main() {
  vec3 src = texture2D(tColor, vUv).rgb;
  vec2 lowUv = vUv;
  float depth = texture2D(tDepth, lowUv).x;
  if (depth > 0.999) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 px = 1.0 / max(uOutSize, vec2(1.0));
  vec2 nPx = 1.0 / max(uLowSize, vec2(1.0));

  vec3 c00 = texture2D(tColor, vUv + vec2(-px.x, -px.y)).rgb;
  vec3 c10 = texture2D(tColor, vUv + vec2( 0.0, -px.y)).rgb;
  vec3 c20 = texture2D(tColor, vUv + vec2( px.x, -px.y)).rgb;
  vec3 c01 = texture2D(tColor, vUv + vec2(-px.x,  0.0)).rgb;
  vec3 c21 = texture2D(tColor, vUv + vec2( px.x,  0.0)).rgb;
  vec3 c02 = texture2D(tColor, vUv + vec2(-px.x,  px.y)).rgb;
  vec3 c12 = texture2D(tColor, vUv + vec2( 0.0,  px.y)).rgb;
  vec3 c22 = texture2D(tColor, vUv + vec2( px.x,  px.y)).rgb;

  vec3 edgeH = (c20 + 2.0 * c21 + c22) - (c00 + 2.0 * c01 + c02);
  vec3 edgeV = (c02 + 2.0 * c12 + c22) - (c00 + 2.0 * c10 + c20);
  vec3 edge = sqrt(edgeH * edgeH + edgeV * edgeV) * 0.25;
  vec3 contact = (src * 4.0 + c10 + c01 + c21 + c12) * 0.125;
  vec3 sheen = src * 4.0 - (c00 + c20 + c02 + c22) * 0.25;
  vec3 bounce = (c00 + c10 + c20 + c01 + c21 + c02 + c12 + c22) * 0.125;

  float viewZ = perspectiveDepthToViewZ(depth, cameraNear, cameraFar);
  float dist = max(1.0, -viewZ);
  float distFade = 1.0 - smoothstep(28.0, 72.0, dist);

  vec3 nrm = vec3(0.0, 0.0, 1.0);
  float nDotV = 1.0;
  if (uHasNormal > 0.5) {
    nrm = decodeN(lowUv);
    vec3 nx = decodeN(clamp(lowUv + vec2(nPx.x, 0.0), nPx, 1.0 - nPx));
    vec3 ny = decodeN(clamp(lowUv + vec2(0.0, nPx.y), nPx, 1.0 - nPx));
    float crease = clamp(1.0 - max(dot(nrm, nx), dot(nrm, ny)), 0.0, 1.0);
    nDotV = clamp(nrm.z, 0.0, 1.0);
    contact *= 1.0 - crease * 0.28;
    bounce += src * crease * 0.08;
  }

  float motion = 0.0;
  if (uHasVel > 0.5) {
    vec2 vel = texture2D(tVel, lowUv).xy;
    motion = clamp(length(vel) * 24.0, 0.0, 1.0);
  }

  float srcL = luma(src);
  float wet = smoothstep(0.08, 0.28, srcL) * (1.0 - smoothstep(0.55, 0.88, srcL)) * nDotV;
  // Ringing guard: do not push a residual along a hard luma edge.
  float ring = clamp(luma(edge) * 1.8, 0.0, 1.0);
  float still = (1.0 - motion) * distFade * (1.0 - ring * 0.65);

  vec3 residual = vec3(0.0);
  residual -= edge * (0.10 * still);
  residual += (bounce - src) * (0.08 * still);
  residual += sheen * (0.045 * wet * still);
  residual += (contact - src) * (0.06 * still);

  if (uHasHist > 0.5) {
    vec3 hist = texture2D(tResHist, vUv).rgb;
    residual = mix(residual, hist, 0.38 * (1.0 - motion));
  }

  gl_FragColor = vec4(residual * uGain, 1.0);
}
`;

/**
 * Full-res compose: TSR colour + upsampled residual, luma-clamped.
 */
const COMPOSE_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tColor;
uniform sampler2D tResidual;
uniform float uHeadroom;
uniform float uPassthrough;
varying vec2 vUv;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

void main() {
  vec3 src = texture2D(tColor, vUv).rgb;
  if (uPassthrough > 0.5) {
    gl_FragColor = vec4(src, 1.0);
    return;
  }
  vec3 res = texture2D(tResidual, vUv).rgb;
  vec3 outC = src + res;
  float srcL = luma(src);
  float outL = luma(outC);
  float cap = srcL * uHeadroom;
  if (outL > cap && outL > 1e-5) {
    outC *= cap / outL;
  }
  if (outL > srcL && srcL < 0.12) {
    outC = src;
  }
  gl_FragColor = vec4(max(outC, vec3(0.0)), 1.0);
}
`;

const BLIT_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tSrc;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tSrc, vUv);
}
`;

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {{ gain?: number }} [opts]
 */
export function createAppearance(renderer, opts = {}) {
  const gain = opts.gain != null ? opts.gain : 1.0;
  const supported = !!(renderer && renderer.capabilities && renderer.capabilities.isWebGL2);

  let fieldMat = null;
  let composeMat = null;
  let blitMat = null;
  let geom = null;
  let quad = null;
  let scene = null;
  let cam = null;

  let fieldRT = null;
  let histRT = null;
  let w = 0;
  let h = 0;
  let lastMs = 0;
  let samples = 0;
  let sumMs = 0;
  let warmupSkips = 0;
  let pinned = false;
  let enabled = supported && APPEAR_DEFAULT;
  let frames = 0;
  let needReset = true;
  const dummy = new THREE.Texture();

  function ensureMaterials() {
    if (fieldMat || !supported) return;
    fieldMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        tNormal: { value: null },
        tVel: { value: null },
        tResHist: { value: null },
        texel: { value: new THREE.Vector2(1, 1) },
        uLowSize: { value: new THREE.Vector2(1, 1) },
        uOutSize: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.18 },
        cameraFar: { value: 1400 },
        uHasNormal: { value: 0 },
        uHasVel: { value: 0 },
        uHasHist: { value: 0 },
        uGain: { value: gain },
      },
      vertexShader: VERT,
      fragmentShader: FIELD_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      lights: false,
    });
    composeMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tResidual: { value: null },
        uHeadroom: { value: APPEAR_LUMA_HEADROOM },
        uPassthrough: { value: 1 },
      },
      vertexShader: VERT,
      fragmentShader: COMPOSE_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      lights: false,
    });
    blitMat = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null } },
      vertexShader: VERT,
      fragmentShader: BLIT_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      lights: false,
    });
    geom = new THREE.PlaneGeometry(2, 2);
    quad = new THREE.Mesh(geom, fieldMat);
    scene = new THREE.Scene();
    scene.add(quad);
    cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  function ensure(nw, nh) {
    const fw = Math.max(1, Math.floor(nw * 0.5));
    const fh = Math.max(1, Math.floor(nh * 0.5));
    if (fieldRT && fieldRT.width === fw && fieldRT.height === fh) {
      w = nw;
      h = nh;
      return;
    }
    if (fieldRT) fieldRT.dispose();
    if (histRT) histRT.dispose();
    const optsRT = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.LinearSRGBColorSpace,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    };
    fieldRT = new THREE.WebGLRenderTarget(fw, fh, optsRT);
    histRT = new THREE.WebGLRenderTarget(fw, fh, optsRT);
    w = nw;
    h = nh;
    needReset = true;
  }

  /**
   * @param {THREE.Texture} color
   * @param {THREE.WebGLRenderTarget} dest
   * @param {{
   *   depth?: THREE.Texture,
   *   normal?: THREE.Texture,
   *   velocity?: THREE.Texture,
   *   depthWidth?: number,
   *   depthHeight?: number,
   *   near?: number,
   *   far?: number,
   * }} [guide]
   */
  function render(color, dest, guide) {
    if (!supported || !enabled || !color || !dest) return;
    ensureMaterials();
    const nw = dest.width || w;
    const nh = dest.height || h;
    ensure(nw, nh);
    const g = guide || {};
    const u = fieldMat.uniforms;
    u.tColor.value = color;
    u.tDepth.value = g.depth || dummy;
    u.tNormal.value = g.normal || dummy;
    u.tVel.value = g.velocity || dummy;
    u.tResHist.value = histRT.texture;
    u.texel.value.set(1 / Math.max(1, fieldRT.width), 1 / Math.max(1, fieldRT.height));
    u.uLowSize.value.set(g.depthWidth || fieldRT.width, g.depthHeight || fieldRT.height);
    u.uOutSize.value.set(nw, nh);
    u.cameraNear.value = g.near != null ? g.near : 0.18;
    u.cameraFar.value = g.far != null ? g.far : 1400;
    u.uHasNormal.value = g.normal ? 1 : 0;
    u.uHasVel.value = g.velocity ? 1 : 0;
    u.uHasHist.value = needReset ? 0 : 1;
    u.uGain.value = gain;
    quad.material = fieldMat;
    const t0 = performance.now();
    renderer.setRenderTarget(fieldRT);
    renderer.render(scene, cam);

    blitMat.uniforms.tSrc.value = fieldRT.texture;
    quad.material = blitMat;
    renderer.setRenderTarget(histRT);
    renderer.render(scene, cam);

    frames += 1;
    // First two frames: compile + empty hist. Pass TSR colour through so
    // LOOK cannot flash a black or half-soft frame on enable / spawn.
    const pass = needReset || frames <= 2;
    composeMat.uniforms.tColor.value = color;
    composeMat.uniforms.tResidual.value = fieldRT.texture;
    composeMat.uniforms.uHeadroom.value = APPEAR_LUMA_HEADROOM;
    composeMat.uniforms.uPassthrough.value = pass ? 1 : 0;
    quad.material = composeMat;
    renderer.setRenderTarget(dest);
    renderer.render(scene, cam);
    lastMs = performance.now() - t0;
    needReset = false;
    if (lastMs < 8) {
      samples += 1;
      sumMs += lastMs;
    } else {
      warmupSkips += 1;
    }
    if (samples >= 24 && sumMs / samples > APPEAR_BUDGET_MS && !pinned) {
      enabled = false;
    }
  }

  return {
    supported,
    get enabled() {
      return enabled;
    },
    set enabled(v) {
      enabled = !!v && supported;
      if (enabled) {
        frames = 0;
        needReset = true;
      }
    },
    /** URL `?appear=1` / Pause LOOK on — do not auto-off on a compile spike. */
    pin(on) {
      pinned = !!on;
      if (pinned) enabled = supported;
    },
    get lastMs() {
      return lastMs;
    },
    get p50Ms() {
      return samples ? sumMs / samples : 0;
    },
    setSize(nw, nh) {
      if (!supported) return;
      ensure(Math.max(1, Math.floor(nw)), Math.max(1, Math.floor(nh)));
    },
    reset() {
      frames = 0;
      needReset = true;
    },
    render,
    measure(color, dest, guide) {
      render(color, dest, guide);
      return lastMs;
    },
    dispose() {
      if (fieldRT) fieldRT.dispose();
      if (histRT) histRT.dispose();
      if (fieldMat) fieldMat.dispose();
      if (composeMat) composeMat.dispose();
      if (blitMat) blitMat.dispose();
      if (geom) geom.dispose();
      fieldRT = null;
      histRT = null;
      fieldMat = null;
      composeMat = null;
      blitMat = null;
    },
  };
}
