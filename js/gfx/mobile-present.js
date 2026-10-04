/**
 * Mobile present — cheap FXAA for iPhone / Android.
 *
 * WHO THIS IS FOR: phone play and `?perf=low|min` desktop probes.
 * WHAT IT DOES: one fullscreen FXAA pass after a native scene capture.
 *   No history ping-pong, no resurrection, no appearance net, no WebGPU.
 *   Shaders and the capture RT are created on first race present — not
 *   during title first paint.
 * HOW IT CONNECTS: RallyGame._render presents `presentScene` the same way
 *   it presents WebTSR. createWebTsr is never constructed on this path.
 *
 * POWER BI MAPPING: none
 */

import * as THREE from "../../vendor/three.module.js";

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Compact luma-edge FXAA. texture2D only — no texelFetch, no fragDepth.
 * Original GLSL. Softens shimmer on foliage / tunnel lips without a
 * temporal history the phone cannot hold.
 */
const FXAA_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tColor;
uniform vec2 uOutSize;
uniform float uReady;
varying vec2 vUv;

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 px = 1.0 / max(uOutSize, vec2(1.0));
  vec3 rgbM = texture2D(tColor, vUv).rgb;
  if (uReady < 0.5) {
    gl_FragColor = vec4(rgbM, 1.0);
    return;
  }
  vec3 rgbNW = texture2D(tColor, vUv + vec2(-px.x, -px.y)).rgb;
  vec3 rgbNE = texture2D(tColor, vUv + vec2( px.x, -px.y)).rgb;
  vec3 rgbSW = texture2D(tColor, vUv + vec2(-px.x,  px.y)).rgb;
  vec3 rgbSE = texture2D(tColor, vUv + vec2( px.x,  px.y)).rgb;
  float lumaM = luma(rgbM);
  float lumaNW = luma(rgbNW);
  float lumaNE = luma(rgbNE);
  float lumaSW = luma(rgbSW);
  float lumaSE = luma(rgbSE);
  float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
  vec2 dir = vec2(
    -((lumaNW + lumaNE) - (lumaSW + lumaSE)),
    ((lumaNW + lumaSW) - (lumaNE + lumaSE))
  );
  float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * 0.03125, 0.0078125);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * px;
  vec3 rgbA = 0.5 * (
    texture2D(tColor, vUv + dir * (1.0 / 3.0 - 0.5)).rgb +
    texture2D(tColor, vUv + dir * (2.0 / 3.0 - 0.5)).rgb
  );
  vec3 rgbB = rgbA * 0.5 + 0.25 * (
    texture2D(tColor, vUv + dir * -0.5).rgb +
    texture2D(tColor, vUv + dir * 0.5).rgb
  );
  float lumaB = luma(rgbB);
  vec3 outC = (lumaB < lumaMin || lumaB > lumaMax) ? rgbA : rgbB;
  gl_FragColor = vec4(outC, 1.0);
}
`;

/**
 * @param {THREE.WebGLRenderer} renderer
 * @returns {{
 *   supported: boolean,
 *   active: boolean,
 *   presentScene: THREE.Scene|null,
 *   presentMaterial: THREE.ShaderMaterial|null,
 *   stats: object,
 *   setSize: Function,
 *   render: Function,
 *   reset: Function,
 *   dispose: Function,
 * }}
 */
export function createMobilePresent(renderer) {
  const caps = renderer && renderer.capabilities;
  const supported = !!(caps && caps.isWebGL2);
  let w = 0;
  let h = 0;
  let capture = null;
  let mat = null;
  let presentScene = null;
  let quad = null;
  let ready = false;
  let frames = 0;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const drawSize = new THREE.Vector2();
  const stats = { outW: 0, outH: 0, bytes: 0, compiled: false, lastMs: 0 };

  function ensureMaterials() {
    if (mat || !supported) return;
    mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        uOutSize: { value: new THREE.Vector2(1, 1) },
        uReady: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FXAA_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
      fog: false,
      lights: false,
    });
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    presentScene = new THREE.Scene();
    presentScene.background = null;
    presentScene.add(quad);
  }

  function ensureRT(nw, nh) {
    const rw = Math.max(1, Math.floor(nw));
    const rh = Math.max(1, Math.floor(nh));
    if (capture && capture.width === rw && capture.height === rh) return;
    if (capture) {
      if (capture.depthTexture) capture.depthTexture.dispose();
      capture.dispose();
    }
    const depth = new THREE.DepthTexture(rw, rh);
    depth.format = THREE.DepthFormat;
    depth.type = THREE.UnsignedShortType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    capture = new THREE.WebGLRenderTarget(rw, rh, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
      generateMipmaps: false,
      depthTexture: depth,
    });
    w = rw;
    h = rh;
    stats.outW = rw;
    stats.outH = rh;
    stats.bytes = rw * rh * 6;
  }

  /**
   * Capture the world, then arm the FXAA quad. Host presents `presentScene`.
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  function render(scene, camera) {
    if (!supported || !renderer || !scene || !camera) return;
    const t0 = performance.now();
    ensureMaterials();
    renderer.getDrawingBufferSize(drawSize);
    ensureRT(drawSize.x, drawSize.y);
    const prevTarget = renderer.getRenderTarget();
    const prevAuto = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(capture);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAuto;
    frames += 1;
    // Frame 1 compiles. Present a straight blit so the first race frame
    // cannot flash a half-linked WebKit program.
    const live = frames > 1;
    ready = true;
    mat.uniforms.tColor.value = capture.texture;
    mat.uniforms.uOutSize.value.set(w, h);
    mat.uniforms.uReady.value = live ? 1 : 0;
    stats.compiled = live;
    stats.lastMs = performance.now() - t0;
  }

  return {
    supported,
    get active() {
      return supported;
    },
    get presentScene() {
      return presentScene;
    },
    get presentMaterial() {
      return mat;
    },
    stats,
    /**
     * Hint. Next render sizes from the drawing buffer.
     * @param {number} nw
     * @param {number} nh
     */
    setSize(nw, nh) {
      if (!supported) return;
      const rw = Math.max(1, Math.floor(nw));
      const rh = Math.max(1, Math.floor(nh));
      if (capture && (capture.width !== rw || capture.height !== rh)) {
        if (capture.depthTexture) capture.depthTexture.dispose();
        capture.dispose();
        capture = null;
        w = 0;
        h = 0;
      }
    },
    render,
    reset() {
      frames = 0;
    },
    dispose() {
      if (capture) {
        if (capture.depthTexture) capture.depthTexture.dispose();
        capture.dispose();
        capture = null;
      }
      if (mat) mat.dispose();
      if (quad && quad.geometry) quad.geometry.dispose();
      mat = null;
      quad = null;
      presentScene = null;
      ready = false;
    },
  };
}
