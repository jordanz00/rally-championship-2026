/**
 * Photoreal post stack — bloom, colour grade, vignette (60 Hz budget).
 *
 * WHO THIS IS FOR: the race / title render path (Sprint 23–24).
 * WHAT IT DOES: scene → RT, cheap quarter-res bloom, then a single composite
 *   with grade + vignette. Quality auto-scales so control lag cannot return.
 * HOW IT CONNECTS: RallyGame creates PhotoRealPost; _render / _onResize drive it.
 *
 * Sprint 24: FXAA/sharpen off by default (MSAA/canvas AA is enough), bloom at
 * 1/4 res with one separable pair, and a 'low' path that skips bloom entirely
 * when frame time climbs.
 */

import * as THREE from "../../vendor/three.module.js";
import { VISUAL } from "../config.js?v=138";

const BRIGHT_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tDiffuse;
uniform float threshold;
uniform float knee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float soft = clamp(lum - threshold + knee, 0.0, 2.0 * knee);
  soft = (soft * soft) / (4.0 * knee + 1e-4);
  float contrib = max(lum - threshold, soft);
  gl_FragColor = vec4(c * (contrib / max(lum, 1e-4)), 1.0);
}
`;

const BLUR_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tDiffuse;
uniform vec2 direction;
uniform vec2 texel;
varying vec2 vUv;
void main() {
  vec2 step = direction * texel;
  vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.227027;
  sum += texture2D(tDiffuse, vUv + step * 1.384615).rgb * 0.316216;
  sum += texture2D(tDiffuse, vUv - step * 1.384615).rgb * 0.316216;
  sum += texture2D(tDiffuse, vUv + step * 3.230769).rgb * 0.070270;
  sum += texture2D(tDiffuse, vUv - step * 3.230769).rgb * 0.070270;
  gl_FragColor = vec4(sum, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform float bloomStrength;
uniform float vignette;
uniform float contrast;
uniform float saturation;
uniform float warmth;
uniform float grain;
uniform float time;
uniform float highlightRolloff;
varying vec2 vUv;

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec3 color = texture2D(tDiffuse, vUv).rgb;
  if (bloomStrength > 0.001) {
    color += texture2D(tBloom, vUv).rgb * bloomStrength;
  }
  color = (color - 0.5) * contrast + 0.5;
  float l = luma(color);
  color = mix(vec3(l), color, saturation);
  color.r += warmth * 0.035;
  color.b -= warmth * 0.028;
  color = max(color, 0.0);
  if (highlightRolloff > 0.001) {
    float peak = max(max(color.r, color.g), color.b);
    color *= 1.0 / (1.0 + peak * highlightRolloff);
  }
  float d = distance(vUv, vec2(0.5));
  float vig = smoothstep(0.45, 1.05, d) * vignette;
  color *= 1.0 - vig * 0.48;
  if (grain > 0.001) {
    float n = hash(vUv * vec2(1280.0, 720.0) + time);
    color += (n - 0.5) * grain;
  }
  gl_FragColor = vec4(color, 1.0);
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
 * Fullscreen photoreal compositor with adaptive quality.
 */
export class PhotoRealPost {
  /**
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = VISUAL.postFx !== false && (VISUAL.tier || 0) >= 9;
    /** @type {'high'|'balanced'|'low'} */
    this.quality = "balanced";
    /** @type {THREE.WebGLRenderTarget|null} */
    this.sceneRT = null;
    /** @type {THREE.WebGLRenderTarget|null} */
    this.brightRT = null;
    /** @type {THREE.WebGLRenderTarget|null} */
    this.blurA = null;
    /** @type {THREE.WebGLRenderTarget|null} */
    this.blurB = null;

    this._cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
    this._quad.frustumCulled = false;
    this._scene = new THREE.Scene();
    this._scene.add(this._quad);

    this._brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        threshold: { value: VISUAL.bloomThreshold ?? 0.72 },
        knee: { value: 0.18 },
      },
      vertexShader: VERT,
      fragmentShader: BRIGHT_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this._blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        direction: { value: new THREE.Vector2(1, 0) },
        texel: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: VERT,
      fragmentShader: BLUR_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this._compMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        bloomStrength: { value: VISUAL.bloomStrength ?? 0.28 },
        vignette: { value: VISUAL.vignette ?? 0.85 },
        contrast: { value: VISUAL.gradeContrast ?? 1.1 },
        saturation: { value: VISUAL.gradeSaturation ?? 1.06 },
        warmth: { value: VISUAL.gradeWarmth ?? 0.28 },
        grain: { value: VISUAL.filmGrain ?? 0 },
        time: { value: 0 },
        highlightRolloff: { value: VISUAL.highlightRolloff ?? 0.1 },
      },
      vertexShader: VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

    this._w = 0;
    this._h = 0;
    this._bloomDiv = 4;
  }

  /**
   * @param {'high'|'balanced'|'low'} q
   */
  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q === "high" || q === "low" ? q : "balanced";
  }

  /**
   * @param {object} [L]
   */
  syncFromConfig(L = null) {
    this.enabled = VISUAL.postFx !== false && (VISUAL.tier || 0) >= 9;
    const u = this._compMat.uniforms;
    u.bloomStrength.value = VISUAL.bloomStrength ?? 0.28;
    u.vignette.value = VISUAL.vignette ?? 0.85;
    u.contrast.value = VISUAL.gradeContrast ?? 1.1;
    u.saturation.value = VISUAL.gradeSaturation ?? 1.06;
    u.warmth.value = L && L.gradeWarmth != null ? L.gradeWarmth : VISUAL.gradeWarmth ?? 0.28;
    u.grain.value = VISUAL.filmGrain ?? 0;
    u.highlightRolloff.value = VISUAL.highlightRolloff ?? 0.1;
    this._brightMat.uniforms.threshold.value = VISUAL.bloomThreshold ?? 0.72;
  }

  /**
   * @param {number} width
   * @param {number} height
   * @param {number} pixelRatio
   */
  setSize(width, height, pixelRatio = 1) {
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    this._disposeTargets();
    const opts = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.SRGBColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
    };
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, opts);
    // Quarter-res bloom — the big Sprint 24 win vs half-res ×4 blurs.
    const bw = Math.max(1, w >> 2);
    const bh = Math.max(1, h >> 2);
    const bloomOpts = { ...opts, depthBuffer: false };
    this.brightRT = new THREE.WebGLRenderTarget(bw, bh, bloomOpts);
    this.blurA = new THREE.WebGLRenderTarget(bw, bh, bloomOpts);
    this.blurB = new THREE.WebGLRenderTarget(bw, bh, bloomOpts);
  }

  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  render(scene, camera) {
    if (!this.enabled || !this.sceneRT) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }

    const r = this.renderer;
    const prevAuto = r.autoClear;
    r.autoClear = true;
    const q = this.quality;

    // Low: grade/vignette only — one RT + one blit. Keeps feel when GPU is hot.
    if (q === "low") {
      r.setRenderTarget(this.sceneRT);
      r.clear();
      r.render(scene, camera);
      this._compMat.uniforms.tDiffuse.value = this.sceneRT.texture;
      this._compMat.uniforms.tBloom.value = this.sceneRT.texture;
      this._compMat.uniforms.bloomStrength.value = 0;
      this._compMat.uniforms.grain.value = 0;
      this._compMat.uniforms.time.value = performance.now() * 0.001;
      this._quad.material = this._compMat;
      r.setRenderTarget(null);
      r.clear();
      r.render(this._scene, this._cam);
      this._compMat.uniforms.bloomStrength.value = VISUAL.bloomStrength ?? 0.28;
      r.autoClear = prevAuto;
      return;
    }

    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    this._blit(this.sceneRT.texture, this.brightRT, this._brightMat);

    const texel = this._blurMat.uniforms.texel;
    texel.value.set(1 / this.blurA.width, 1 / this.blurA.height);
    // One separable pair (was four blits) — enough for a soft sun bloom.
    this._blurMat.uniforms.direction.value.set(1, 0);
    this._blit(this.brightRT.texture, this.blurA, this._blurMat);
    this._blurMat.uniforms.direction.value.set(0, 1);
    this._blit(this.blurA.texture, this.blurB, this._blurMat);

    const bloomAmt = (VISUAL.bloomStrength ?? 0.28) * (q === "high" ? 1 : 0.85);
    this._compMat.uniforms.tDiffuse.value = this.sceneRT.texture;
    this._compMat.uniforms.tBloom.value = this.blurB.texture;
    this._compMat.uniforms.bloomStrength.value = bloomAmt;
    this._compMat.uniforms.grain.value = q === "low" ? 0 : VISUAL.filmGrain ?? 0;
    this._compMat.uniforms.time.value = performance.now() * 0.001;
    this._quad.material = this._compMat;
    r.setRenderTarget(null);
    r.clear();
    r.render(this._scene, this._cam);

    r.autoClear = prevAuto;
  }

  /**
   * @param {THREE.Texture} tex
   * @param {THREE.WebGLRenderTarget} target
   * @param {THREE.ShaderMaterial} mat
   */
  _blit(tex, target, mat) {
    mat.uniforms.tDiffuse.value = tex;
    this._quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this._scene, this._cam);
  }

  _disposeTargets() {
    this.sceneRT?.dispose();
    this.brightRT?.dispose();
    this.blurA?.dispose();
    this.blurB?.dispose();
    this.sceneRT = this.brightRT = this.blurA = this.blurB = null;
  }

  dispose() {
    this._disposeTargets();
    this._brightMat.dispose();
    this._blurMat.dispose();
    this._compMat.dispose();
    this._quad.geometry.dispose();
  }
}
