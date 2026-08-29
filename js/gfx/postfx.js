/**
 * Photoreal post stack — bloom, AO, colour grade, vignette (60 Hz budget).
 *
 * WHO THIS IS FOR: the race / title render path (Sprint 23–24, cinema ground).
 * WHAT IT DOES: scene → RT with depth, half-res SSAO, cheap quarter-res bloom,
 *   then a single composite with grade + vignette. Quality auto-scales so
 *   control lag cannot return.
 * HOW IT CONNECTS: RallyGame creates PhotoRealPost; _render / _onResize drive it.
 *
 * Sprint 24: FXAA/sharpen off by default, bloom at 1/4 res with one separable
 * pair, and a 'low' path that skips bloom and AO when frame time climbs.
 */

import * as THREE from "../../vendor/three.module.js";
import { VISUAL } from "../config.js?v=163";

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

const AO_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tDepth;
uniform vec2 texel;
uniform float cameraNear;
uniform float cameraFar;
uniform float proj00;
uniform float proj11;
uniform float aoRadius;
uniform float aoBias;
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
    gl_FragColor = vec4(1.0);
    return;
  }
  vec3 origin = viewPos(vUv);
  float dist = max(8.0, -origin.z);
  vec2 scale = (aoRadius / dist) * vec2(1.0, proj00 / max(proj11, 1e-4));
  vec2 k[8];
  k[0] = vec2( 1.0,  0.0);
  k[1] = vec2(-1.0,  0.0);
  k[2] = vec2( 0.0,  1.0);
  k[3] = vec2( 0.0, -1.0);
  k[4] = vec2( 0.707,  0.707);
  k[5] = vec2(-0.707,  0.707);
  k[6] = vec2( 0.707, -0.707);
  k[7] = vec2(-0.707, -0.707);
  float occ = 0.0;
  for (int i = 0; i < 8; i++) {
    vec2 uv = clamp(vUv + k[i] * scale, texel, 1.0 - texel);
    float sampleD = texture2D(tDepth, uv).x;
    if (sampleD > 0.999) continue;
    vec3 other = viewPos(uv);
    float dz = other.z - origin.z;
    float range = 1.0 - smoothstep(0.0, aoRadius * 2.4, abs(dz));
    occ += step(aoBias, dz) * range;
  }
  float ao = 1.0 - occ / 8.0;
  ao = mix(1.0, ao, 0.92);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */ `
precision mediump float;
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform sampler2D tAO;
uniform float bloomStrength;
uniform float aoStrength;
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
  if (aoStrength > 0.001) {
    float ao = texture2D(tAO, vUv).r;
    color *= mix(1.0, ao, aoStrength);
  }
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
    this.aoRT = null;
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

    const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    white.needsUpdate = true;
    this._whiteTex = white;

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
    this._aoMat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null },
        texel: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 0.2 },
        cameraFar: { value: 1400 },
        proj00: { value: 1 },
        proj11: { value: 1 },
        aoRadius: { value: VISUAL.aoRadius ?? 1.35 },
        aoBias: { value: 0.045 },
      },
      vertexShader: VERT,
      fragmentShader: AO_FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this._compMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tBloom: { value: null },
        tAO: { value: white },
        bloomStrength: { value: VISUAL.bloomStrength ?? 0.28 },
        aoStrength: { value: VISUAL.aoStrength ?? 0 },
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
    u.aoStrength.value = VISUAL.aoStrength ?? 0.55;
    u.vignette.value = VISUAL.vignette ?? 0.85;
    u.contrast.value = VISUAL.gradeContrast ?? 1.1;
    u.saturation.value = VISUAL.gradeSaturation ?? 1.06;
    u.warmth.value = L && L.gradeWarmth != null ? L.gradeWarmth : VISUAL.gradeWarmth ?? 0.28;
    u.grain.value = VISUAL.filmGrain ?? 0;
    u.highlightRolloff.value = VISUAL.highlightRolloff ?? 0.1;
    this._brightMat.uniforms.threshold.value = VISUAL.bloomThreshold ?? 0.72;
    this._aoMat.uniforms.aoRadius.value = VISUAL.aoRadius ?? 1.35;
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
    const depth = new THREE.DepthTexture(w, h);
    depth.format = THREE.DepthFormat;
    depth.type = THREE.UnsignedIntType;
    const opts = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.SRGBColorSpace,
      depthBuffer: true,
      stencilBuffer: false,
      samples: 0,
      depthTexture: depth,
    };
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, opts);
    const aw = Math.max(1, w >> 1);
    const ah = Math.max(1, h >> 1);
    const aoOpts = {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
      stencilBuffer: false,
    };
    this.aoRT = new THREE.WebGLRenderTarget(aw, ah, aoOpts);
    const bw = Math.max(1, w >> 2);
    const bh = Math.max(1, h >> 2);
    const bloomOpts = { ...aoOpts };
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
    const titlePad = !!this._titleShowroom;
    const useAo =
      !titlePad &&
      q !== "low" &&
      (VISUAL.aoStrength ?? 0) > 0.001 &&
      this.aoRT &&
      this.sceneRT.depthTexture;

    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    if (useAo) {
      this._prepAo(camera);
      this._blitDepth(this.aoRT, this._aoMat);
    }

    if (q === "low") {
      this._compMat.uniforms.tDiffuse.value = this.sceneRT.texture;
      this._compMat.uniforms.tBloom.value = this.sceneRT.texture;
      this._compMat.uniforms.tAO.value = this._whiteTex;
      this._compMat.uniforms.bloomStrength.value = 0;
      this._compMat.uniforms.aoStrength.value = 0;
      this._compMat.uniforms.grain.value = 0;
      this._compMat.uniforms.time.value = performance.now() * 0.001;
      this._quad.material = this._compMat;
      r.setRenderTarget(null);
      r.clear();
      r.render(this._scene, this._cam);
      this._compMat.uniforms.bloomStrength.value = VISUAL.bloomStrength ?? 0.28;
      this._compMat.uniforms.aoStrength.value = VISUAL.aoStrength ?? 0.55;
      r.autoClear = prevAuto;
      return;
    }

    this._blit(this.sceneRT.texture, this.brightRT, this._brightMat);

    const texel = this._blurMat.uniforms.texel;
    texel.value.set(1 / this.blurA.width, 1 / this.blurA.height);
    this._blurMat.uniforms.direction.value.set(1, 0);
    this._blit(this.brightRT.texture, this.blurA, this._blurMat);
    this._blurMat.uniforms.direction.value.set(0, 1);
    this._blit(this.blurA.texture, this.blurB, this._blurMat);

    const bloomAmt = titlePad
      ? 0.18
      : (VISUAL.bloomStrength ?? 0.28) * (q === "high" ? 1 : 0.85);
    this._compMat.uniforms.tDiffuse.value = this.sceneRT.texture;
    this._compMat.uniforms.tBloom.value = this.blurB.texture;
    this._compMat.uniforms.tAO.value = useAo ? this.aoRT.texture : this._whiteTex;
    this._compMat.uniforms.bloomStrength.value = bloomAmt;
    this._compMat.uniforms.aoStrength.value = useAo ? VISUAL.aoStrength ?? 0.55 : 0;
    this._compMat.uniforms.grain.value = titlePad ? 0 : VISUAL.filmGrain ?? 0;
    if (titlePad && this._compMat.uniforms.vignette) {
      this._compMat.uniforms.vignette.value = 0.48;
    }
    this._compMat.uniforms.time.value = performance.now() * 0.001;
    this._quad.material = this._compMat;
    r.setRenderTarget(null);
    r.clear();
    r.render(this._scene, this._cam);

    r.autoClear = prevAuto;
  }

  /**
   * @param {THREE.Camera} camera
   */
  _prepAo(camera) {
    const u = this._aoMat.uniforms;
    u.tDepth.value = this.sceneRT.depthTexture;
    u.texel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height);
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    const e = camera.projectionMatrix.elements;
    u.proj00.value = e[0];
    u.proj11.value = e[5];
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

  /**
   * @param {THREE.WebGLRenderTarget} target
   * @param {THREE.ShaderMaterial} mat
   */
  _blitDepth(target, mat) {
    this._quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this._scene, this._cam);
  }

  _disposeTargets() {
    this.sceneRT?.dispose();
    this.aoRT?.dispose();
    this.brightRT?.dispose();
    this.blurA?.dispose();
    this.blurB?.dispose();
    this.sceneRT = this.aoRT = this.brightRT = this.blurA = this.blurB = null;
  }

  dispose() {
    this._disposeTargets();
    this._brightMat.dispose();
    this._blurMat.dispose();
    this._aoMat.dispose();
    this._compMat.dispose();
    this._whiteTex.dispose();
    this._quad.geometry.dispose();
  }
}
