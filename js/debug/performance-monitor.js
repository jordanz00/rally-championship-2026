/**
 * PerformanceMonitor — lightweight debug overlay (Phase 1).
 *
 * WHO THIS IS FOR: developers (`?debug=1` / `?perfmon=1` / localStorage rally-debug).
 * WHAT IT DOES: FPS, frame/CPU/physics/present ms, draw calls, triangles, DPR.
 * HOW IT CONNECTS: RallyGame begins/ends sections each loop; HUD stays player-facing.
 *
 * POWER BI MAPPING: none
 */

function wantsPerfMon() {
  try {
    if (typeof location !== "undefined") {
      if (/[?&]perfmon=1(?:&|$)/.test(location.search)) return true;
      if (/[?&]debug=1(?:&|$)/.test(location.search)) return true;
    }
    if (typeof localStorage !== "undefined" && localStorage.getItem("rally-debug") === "1") {
      return true;
    }
  } catch {
    /* private mode */
  }
  return false;
}

/**
 * @returns {PerformanceMonitor}
 */
export function createPerformanceMonitor() {
  return new PerformanceMonitor();
}

export class PerformanceMonitor {
  constructor() {
    this.enabled = wantsPerfMon();
    this.el = null;
    this._frameT0 = 0;
    this._physT0 = 0;
    this._presentT0 = 0;
    this.physMs = 0;
    this.presentMs = 0;
    this.cpuMs = 0;
    this.fps = 60;
    this._fpsAccum = 0;
    this._fpsFrames = 0;
    this._fpsLast = 0;
    this._hist = new Float32Array(120);
    this._histI = 0;
    this.renderScale = 1;
    this.tier = "";
    this.shadowEvery = 1;
    this.loadedChunks = 0;
    this.api = "";
    if (this.enabled) this._ensureDom();
  }

  /**
   * Turn on overlay mid-session (TECH → Enable live metrics).
   */
  enable() {
    this.enabled = true;
    this._ensureDom();
  }

  _ensureDom() {
    if (this.el || typeof document === "undefined") return;
    const el = document.createElement("pre");
    el.id = "perf-mon";
    el.setAttribute("aria-hidden", "true");
    Object.assign(el.style, {
      position: "fixed",
      left: "8px",
      bottom: "8px",
      zIndex: "90",
      margin: "0",
      padding: "8px 10px",
      font: "11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
      color: "#d8ffe0",
      background: "rgba(0, 12, 8, 0.72)",
      border: "1px solid rgba(120, 200, 140, 0.35)",
      borderRadius: "4px",
      pointerEvents: "none",
      whiteSpace: "pre",
      maxWidth: "min(360px, 92vw)",
    });
    document.body.appendChild(el);
    this.el = el;
  }

  beginFrame() {
    if (!this.enabled) return;
    this._frameT0 = performance.now();
  }

  beginPhysics() {
    if (!this.enabled) return;
    this._physT0 = performance.now();
  }

  endPhysics() {
    if (!this.enabled) return;
    this.physMs = performance.now() - this._physT0;
  }

  beginPresent() {
    if (!this.enabled) return;
    this._presentT0 = performance.now();
  }

  /**
   * @param {object} [renderer]
   * @param {{ tier?: string, renderScale?: number, shadowEvery?: number, loadedChunks?: number, api?: string }} [meta]
   */
  endPresent(renderer, meta) {
    if (!this.enabled) return;
    this.presentMs = performance.now() - this._presentT0;
    this.cpuMs = performance.now() - this._frameT0;
    this._hist[this._histI % this._hist.length] = this.cpuMs;
    this._histI += 1;
    if (meta) {
      if (meta.tier != null) this.tier = meta.tier;
      if (meta.renderScale != null) this.renderScale = meta.renderScale;
      if (meta.shadowEvery != null) this.shadowEvery = meta.shadowEvery;
      if (meta.loadedChunks != null) this.loadedChunks = meta.loadedChunks;
      if (meta.api != null) this.api = meta.api;
    }
    this._fpsAccum += this.cpuMs;
    this._fpsFrames += 1;
    if (this._fpsAccum >= 500) {
      this.fps = Math.round((this._fpsFrames * 1000) / this._fpsAccum);
      this._fpsAccum = 0;
      this._fpsFrames = 0;
    }
    this._paint(renderer);
  }

  /**
   * @param {import("../../vendor/three.module.js").WebGLRenderer} [renderer]
   */
  _paint(renderer) {
    this._ensureDom();
    if (!this.el) return;
    const info = renderer && renderer.info ? renderer.info : null;
    const draw = info && info.render ? info.render.calls : 0;
    const tris = info && info.render ? info.render.triangles : 0;
    const geo = info && info.memory ? info.memory.geometries : 0;
    const tex = info && info.memory ? info.memory.textures : 0;
    const dpr = renderer && renderer.getPixelRatio ? renderer.getPixelRatio() : 0;
    let avg = 0;
    const n = Math.min(this._histI, this._hist.length);
    for (let i = 0; i < n; i++) avg += this._hist[i];
    avg = n ? avg / n : this.cpuMs;
    this.el.textContent =
      `FPS ${this.fps}   frame ${this.cpuMs.toFixed(1)} ms  (avg ${avg.toFixed(1)})\n` +
      `CPU  phys ${this.physMs.toFixed(1)}  present ${this.presentMs.toFixed(1)}\n` +
      `API  ${this.api || "—"}\n` +
      `Draw ${draw}   tris ${tris}   geo ${geo}   tex ${tex}\n` +
      `DPR ${dpr.toFixed(2)}   scale ${this.renderScale.toFixed(2)}   tier ${this.tier || "—"}\n` +
      `Shadow every ${this.shadowEvery}   stream chunks ${this.loadedChunks}`;
  }
}
