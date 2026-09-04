/**
 * QualityManager — dynamic resolution + present budget bridge (Phase R).
 *
 * WHO THIS IS FOR: game.js present path / RenderPipeline.
 * WHAT IT DOES: Owns render-scale suggestions from frame-time EMA without
 *   inventing a second tier ladder (perf-tier.js remains the quality authority).
 * HOW IT CONNECTS: tick() after each present; apply via pipeline.setRenderScale.
 *
 * POWER BI MAPPING: none
 */

const TARGET_MS = 16.7;
const SAMPLE_CLAMP = 48;
const DOWN_HOLD = 36;
const UP_HOLD = 120;

export class QualityManager {
  constructor() {
    this.renderScale = 1;
    this._ema = TARGET_MS;
    this._down = 0;
    this._up = 0;
    this.minScale = 0.78;
    this.maxScale = 1;
  }

  /**
   * @param {{ minScale?: number, maxScale?: number }} [opts]
   */
  configure(opts = {}) {
    if (opts.minScale != null) this.minScale = opts.minScale;
    if (opts.maxScale != null) this.maxScale = opts.maxScale;
  }

  /**
   * @param {number} frameMs presented-frame interval
   * @returns {{ changed: boolean, renderScale: number }}
   */
  tick(frameMs) {
    const sample = Math.min(SAMPLE_CLAMP, Math.max(1, frameMs || TARGET_MS));
    this._ema = this._ema * 0.88 + sample * 0.12;
    let next = this.renderScale;
    if (this._ema > TARGET_MS * 1.12) {
      this._down += 1;
      this._up = 0;
      if (this._down >= DOWN_HOLD) {
        next = Math.max(this.minScale, Math.round((this.renderScale - 0.05) * 100) / 100);
        this._down = 0;
      }
    } else if (this._ema < TARGET_MS * 0.78) {
      this._up += 1;
      this._down = 0;
      if (this._up >= UP_HOLD) {
        next = Math.min(this.maxScale, Math.round((this.renderScale + 0.05) * 100) / 100);
        this._up = 0;
      }
    } else {
      this._down = 0;
      this._up = 0;
    }
    const changed = next !== this.renderScale;
    this.renderScale = next;
    return { changed, renderScale: this.renderScale };
  }

  reset(scale = 1) {
    this.renderScale = scale;
    this._ema = TARGET_MS;
    this._down = 0;
    this._up = 0;
  }
}
