/**
 * Live telemetry ring buffer — QA + GPT optimization export (Sprint 40).
 *
 * WHO THIS IS FOR: headed playtests, regression diffs, ChatGPT analysis handoff.
 * WHAT IT DOES: samples grip, slide, fps, frame ms, perf tier, reverb zone each
 *   race frame; exports JSON snapshot on demand or race end.
 * HOW IT CONNECTS: game.js _raceStep; tools/qa-sprint40-telemetry.mjs gate.
 */

const MAX_SAMPLES = 3600;

export class LiveTelemetry {
  constructor() {
    /** @type {Array<Record<string, number|string>>} */
    this.buffer = [];
    this.active = false;
    this._t = 0;
  }

  start() {
    this.buffer = [];
    this.active = true;
    this._t = 0;
  }

  stop() {
    this.active = false;
  }

  /**
   * @param {number} dt
   * @param {Record<string, number|string|boolean>} row
   */
  sample(dt, row) {
    if (!this.active) return;
    this._t += dt;
    if (this.buffer.length >= MAX_SAMPLES) this.buffer.shift();
    this.buffer.push({ t: Math.round(this._t * 1000) / 1000, ...row });
  }

  /**
   * @returns {string} JSON for download / GPT paste
   */
  exportJSON() {
    const rows = this.buffer;
    if (!rows.length) return "{}";
    const fps = rows.filter((r) => r.frameMs > 0).map((r) => 1000 / Number(r.frameMs));
    const summary = {
      samples: rows.length,
      durationS: rows[rows.length - 1]?.t || 0,
      fpsAvg: fps.length ? Math.round((fps.reduce((a, b) => a + b, 0) / fps.length) * 10) / 10 : 0,
      fpsMin: fps.length ? Math.round(Math.min(...fps) * 10) / 10 : 0,
      gripAvg:
        rows.filter((r) => r.grip != null).reduce((s, r) => s + Number(r.grip), 0) /
          Math.max(1, rows.filter((r) => r.grip != null).length) || 0,
    };
    return JSON.stringify({ summary, rows }, null, 0);
  }

  /** Attach to window for console QA during playtest. */
  exposeGlobal() {
    if (typeof window !== "undefined") {
      window.__rallyTelemetry = this;
    }
  }
}

/**
 * Push telemetry to console + optional download link (headed QA).
 * @param {LiveTelemetry} tel
 * @param {string} label
 */
export function dumpTelemetry(tel, label = "rally-telemetry") {
  const json = tel.exportJSON();
  if (typeof console !== "undefined") console.info(`[telemetry] ${label}`, json.slice(0, 500) + "…");
  if (typeof document === "undefined") return;
  try {
    const blob = new Blob([json], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${label}.json`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    /* download blocked */
  }
}
