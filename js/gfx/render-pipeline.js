/**
 * RenderPipeline — present / resize / compile facade (Phase R).
 *
 * WHO THIS IS FOR: RallyGame present path.
 * WHAT IT DOES: One place to present (post or direct), resize, and warm-compile
 *   across WebGLRenderer and WebGPURenderer without forking gameplay.
 * HOW IT CONNECTS: created after createGameRenderer(); _render / _onResize call it.
 *
 * POWER BI MAPPING: none
 */

import { RENDER_CAPS } from "./render-caps.js?v=1";

export class RenderPipeline {
  /**
   * @param {{
   *   renderer: import("three").WebGLRenderer,
   *   post?: { enabled?: boolean, render?: Function, setSize?: Function } | null,
   * }} opts
   */
  constructor(opts) {
    this.renderer = opts.renderer;
    this.post = opts.post || null;
    this.api = RENDER_CAPS.api;
  }

  /**
   * @param {import("three").Scene} scene
   * @param {import("three").Camera} camera
   * @param {{ usePost?: boolean }} [opts]
   */
  present(scene, camera, opts = {}) {
    const usePost =
      opts.usePost !== false &&
      this.post &&
      this.post.enabled &&
      RENDER_CAPS.glslCustom &&
      typeof this.post.render === "function";
    if (usePost) this.post.render(scene, camera);
    else this.renderer.render(scene, camera);
  }

  /**
   * @param {number} w
   * @param {number} h
   * @param {number} pr
   * @param {{ updatePost?: boolean }} [opts]
   */
  resize(w, h, pr, opts = {}) {
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (opts.updatePost !== false && this.post && this.post.setSize && RENDER_CAPS.glslCustom) {
      this.post.setSize(w, h, pr);
    }
  }

  /**
   * Soft fill-rate scale under lockRaceQuality (QualityManager).
   * Multiplies effective pixel ratio without mid-race tier dumps.
   * @param {number} scale 0.55–1
   */
  setRenderScale(scale) {
    const s = Math.max(0.5, Math.min(1, Number(scale) || 1));
    if (Math.abs(s - (this._renderScale || 1)) < 0.001) return;
    this._renderScale = s;
  }

  /** @returns {number} */
  getRenderScale() {
    return this._renderScale != null ? this._renderScale : 1;
  }

  /**
   * Warm shader compile — sync on WebGL, async fire-and-forget on WebGPU.
   * @param {import("three").Scene} scene
   * @param {import("three").Camera} camera
   */
  compile(scene, camera) {
    const r = this.renderer;
    if (!r || typeof r.compile !== "function") return;
    try {
      const out = r.compile(scene, camera);
      if (out && typeof out.then === "function") out.catch(() => {});
    } catch (err) {
      console.warn("RenderPipeline.compile", err);
    }
  }

  /**
   * @returns {string}
   */
  backendLabel() {
    return RENDER_CAPS.api || "webgl";
  }
}
