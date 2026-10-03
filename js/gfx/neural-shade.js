/**
 * Legal 3D-guided look stand-in — screen-space contact GI / horizon occlusion.
 *
 * WHO THIS IS FOR: PhotoRealPost (race present). Not a neural net.
 * WHAT IT DOES: one half-res GLSL pass reads colour + depth and writes a
 *   field of openness (alpha) plus albedo-tinted bounce (rgb). Tree wells
 *   and the under-car contact get fuller shade. Luma is never raised.
 * HOW IT CONNECTS: PhotoRealPost.render() after sceneRT is filled, before
 *   AO / SSGI / bloom / composite. Do not hook game.js _render (TSR).
 *
 * LICENSE: MIT. Our GLSL. No NVIDIA weights, no downloads, no TF train.
 */

import * as THREE from "../../vendor/three.module.js";

/**
 * Exact later hook — PhotoRealPost owns scene colour + DepthTexture.
 * game.js _render must stay TSR-only.
 */
export const NSHADE_HOOK =
  "PhotoRealPost.render() after r.render(scene, camera) into this.sceneRT " +
  "(colour + this.sceneRT.depthTexture), before AO / SSGI / bloom / composite. " +
  "Call NeuralShade.apply(renderer, color, depth, camera). " +
  "Do not hook RallyGame._render (TSR workers).";

/** Half-res field. 4 dirs × 3 steps + 2 normal probes. */
const FIELD_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float cameraNear;
uniform float cameraFar;
uniform float proj00;
uniform float proj11;
uniform float radius;
uniform float intensity;
varying vec2 vUv;

float perspectiveDepthToViewZ(float invClipZ, float near, float far) {
  return (near * far) / ((far - near) * invClipZ - far);
}

vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float viewZ = perspectiveDepthToViewZ(d, cameraNear, cameraFar);
  vec2 ndc = uv * 2.0 - 1.0;
  float w = -viewZ;
  return vec3(ndc.x * w / max(proj00, 1e-4), ndc.y * w / max(proj11, 1e-4), viewZ);
}

void main() {
  float depth = texture2D(tDepth, vUv).x;
  if (depth > 0.999) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec3 origin = viewPos(vUv);
  float dist = max(4.0, -origin.z);
  // Far scenery already has fog; keep the pass for hero / chase contact.
  float distFade = 1.0 - smoothstep(48.0, 92.0, dist);
  if (distFade < 0.02) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  vec3 px = viewPos(clamp(vUv + vec2(texel.x, 0.0), texel, 1.0 - texel));
  vec3 py = viewPos(clamp(vUv + vec2(0.0, texel.y), texel, 1.0 - texel));
  vec3 nrm = normalize(cross(px - origin, py - origin));

  vec2 scale = (radius / dist) * vec2(1.0, proj00 / max(proj11, 1e-4));
  vec2 dir[4];
  dir[0] = vec2( 1.00,  0.12);
  dir[1] = vec2(-0.82,  0.55);
  dir[2] = vec2( 0.18,  1.00);
  dir[3] = vec2(-0.22, -0.97);

  float occ = 0.0;
  float wsum = 0.0;
  vec3 bounce = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    for (int s = 1; s <= 3; s++) {
      float step = float(s) * 0.34;
      vec2 uv = clamp(vUv + dir[i] * scale * step, texel, 1.0 - texel);
      float sampleD = texture2D(tDepth, uv).x;
      if (sampleD > 0.999) continue;
      vec3 other = viewPos(uv);
      vec3 v = other - origin;
      float d2 = dot(v, v);
      float len = sqrt(max(d2, 1e-8));
      float range = 1.0 - smoothstep(0.0, radius * radius * 2.8, d2);
      if (range < 0.02) continue;
      // Coplanar floor at a grazing chase angle must not count as a well.
      if (abs(dot(nrm, v)) < 0.14 * len) continue;
      float closer = max(other.z - origin.z - 0.05, 0.0);
      if (closer < 0.02) continue;
      float ndv = max(dot(nrm, v / len) - 0.16, 0.0);
      float hit = (closer / (closer + 0.42)) * ndv * range;
      float nearW = 1.0 - smoothstep(0.12, radius * 1.05, len);
      // Same-surface curvature (a crown, a bonnet) is not a well.
      float self = 1.0 - smoothstep(0.06, 0.55, closer);
      float w = hit * (0.28 + 0.72 * nearW) * (1.0 - self * 0.88);
      occ += w;
      wsum += 0.55 + nearW;
      bounce += texture2D(tDiffuse, uv).rgb * w;
    }
  }

  float open = 1.0;
  vec3 tint = vec3(0.0);
  if (wsum > 0.001) {
    float raw = occ / max(wsum, 1e-3);
    raw = clamp(raw * intensity, 0.0, 0.52);
    open = 1.0 - raw * distFade;
    tint = (occ > 1e-4 ? bounce / occ : vec3(0.0));
    // Keep bounce in the shade — desaturate slightly so foliage does not neon.
    float tl = dot(tint, vec3(0.299, 0.587, 0.114));
    tint = mix(vec3(tl), tint, 0.62) * raw * distFade;
  }
  gl_FragColor = vec4(tint, open);
}
`;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * @returns {boolean}
 */
export function nshadeWanted() {
  try {
    const v = new URLSearchParams(globalThis.location?.search || "").get("nshade");
    if (v === "0" || v === "off" || v === "false") return false;
    if (v === "1" || v === "on" || v === "true") return true;
  } catch {
    /* ignore */
  }
  // Default on for the PhotoRealPost desktop path. Flip to false (require
  // ?nshade=1) if headed p50 of apply() exceeds 1.0 ms.
  return true;
}

/**
 * Half-res contact-GI / horizon-occlusion field.
 */
export class NeuralShade {
  constructor() {
    this.enabled = nshadeWanted();
    /** Composite mix — wells fill in; the luma clamp forbids a lift. */
    this.strength = 0.46;
    /** @type {THREE.WebGLRenderTarget|null} */
    this.target = null;
    this.lastMs = 0;
    this._w = 0;
    this._h = 0;

    this._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    this._quad.frustumCulled = false;
    this._scene = new THREE.Scene();
    this._scene.add(this._quad);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: null },
        texel: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.2 },
        cameraFar: { value: 1400 },
        proj00: { value: 1 },
        proj11: { value: 1 },
        radius: { value: 0.92 },
        intensity: { value: 1.55 },
      },
      vertexShader: VERT,
      fragmentShader: FIELD_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this._quad.material = this.material;
  }

  /**
   * Half of the scene buffer. Colour is sampled from the full-res RT.
   * @param {number} width
   * @param {number} height
   */
  setSize(width, height) {
    const w = Math.max(1, width >> 1);
    const h = Math.max(1, height >> 1);
    if (w === this._w && h === this._h && this.target) return;
    this._w = w;
    this._h = h;
    if (this.target) this.target.dispose();
    this.target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.material.uniforms.texel.value.set(1 / w, 1 / h);
  }

  /**
   * @param {THREE.Texture} color
   * @param {THREE.Texture} depth
   * @param {THREE.Camera} camera
   */
  prepare(color, depth, camera) {
    const u = this.material.uniforms;
    u.tDiffuse.value = color;
    u.tDepth.value = depth;
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    const e = camera.projectionMatrix.elements;
    u.proj00.value = e[0];
    u.proj11.value = e[5];
  }

  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Texture} color
   * @param {THREE.Texture} depth
   * @param {THREE.Camera} camera
   * @param {{ time?: boolean }} [opts]
   * @returns {THREE.Texture|null}
   */
  apply(renderer, color, depth, camera, opts = {}) {
    if (!this.enabled || !this.target || !color || !depth || !camera) return null;
    this.prepare(color, depth, camera);
    const time = !!opts.time;
    const t0 = time ? performance.now() : 0;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this._scene, this._cam);
    renderer.setRenderTarget(prev);
    if (time) {
      const gl = renderer.getContext();
      if (gl && gl.finish) gl.finish();
      this.lastMs = performance.now() - t0;
    }
    return this.target.texture;
  }

  /** @returns {THREE.Texture|null} */
  get texture() {
    return this.target ? this.target.texture : null;
  }

  dispose() {
    this.target?.dispose();
    this.target = null;
    this.material.dispose();
    this._quad.geometry.dispose();
  }
}
