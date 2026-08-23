/**
 * Dynamic reverb zones — Wwise-style wet/dry sends per environment (Sprint 37).
 *
 * WHO THIS IS FOR: RallyAudio mixer bus.
 * WHAT IT DOES: procedural impulse responses for open/tunnel/forest/mountain/stadium;
 *   smooth wet crossfade from track sample flags (tunnel, scenery, surface).
 * HOW IT CONNECTS: engine.js RallyMixer; game.js passes zone hints in setState().
 */

/** Zone presets — wet amount + IR character. */
export const REVERB_ZONES = {
  open: { wet: 0.06, decay: 0.9, predelay: 0.012, damp: 0.55 },
  desert: { wet: 0.08, decay: 1.1, predelay: 0.01, damp: 0.62 },
  forest: { wet: 0.14, decay: 1.6, predelay: 0.018, damp: 0.48 },
  tunnel: { wet: 0.42, decay: 2.4, predelay: 0.028, damp: 0.35 },
  mountain: { wet: 0.11, decay: 1.3, predelay: 0.014, damp: 0.5 },
  stadium: { wet: 0.22, decay: 1.8, predelay: 0.02, damp: 0.42 },
  water: { wet: 0.16, decay: 1.4, predelay: 0.016, damp: 0.52 },
};

/**
 * Build a short procedural impulse for ConvolverNode (no external IR files).
 * @param {AudioContext} ctx
 * @param {{decay:number, damp:number}} preset
 * @returns {AudioBuffer}
 */
export function buildImpulse(ctx, preset) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * Math.min(2.8, preset.decay * 1.2));
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const env = Math.exp(-t * (3.2 / preset.decay)) * (1 - t / (len / rate));
      const damp = 1 - preset.damp * (t / preset.decay);
      data[i] = (Math.random() * 2 - 1) * env * damp * 0.35;
    }
  }
  return buf;
}

/**
 * Resolve zone id from track sample + course metadata.
 * @param {{tunnel?:boolean, surface?:string}} sample
 * @param {string} [scenery]
 * @returns {keyof typeof REVERB_ZONES}
 */
export function zoneFromSample(sample, scenery) {
  if (sample?.tunnel) return "tunnel";
  const sc = (scenery || "").toLowerCase();
  if (sc === "forest") return "forest";
  if (sc === "mountain") return "mountain";
  if (sc === "lakeside") return "water";
  if (sc === "desert") return "desert";
  const surf = (sample?.surface || "").toLowerCase();
  if (/mud|water/.test(surf)) return "water";
  return "open";
}

/**
 * Web Audio reverb send — parallel wet path on the SFX bus.
 */
export class ReverbZones {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} dryDest node that already receives dry SFX (hp input)
   */
  constructor(ctx, dryDest) {
    this.ctx = ctx;
    this._zone = "open";
    this._wet = 0.06;
    this._ir = {};

    this._dry = ctx.createGain();
    this._dry.gain.value = 1;
    this._wetGain = ctx.createGain();
    this._wetGain.gain.value = this._wet;
    this._conv = ctx.createConvolver();
    this._conv.normalize = true;
    this._conv.buffer = this._impulse("open");

    this._predelay = ctx.createDelay(0.05);
    this._predelay.delayTime.value = REVERB_ZONES.open.predelay;

    this._dry.connect(dryDest);
    this._predelay.connect(this._conv);
    this._conv.connect(this._wetGain);
    this._wetGain.connect(dryDest);
  }

  /** @param {AudioNode} source */
  connectSource(source) {
    source.connect(this._dry);
    source.connect(this._predelay);
  }

  _impulse(zone) {
    if (!this._ir[zone]) {
      const preset = REVERB_ZONES[zone] || REVERB_ZONES.open;
      this._ir[zone] = buildImpulse(this.ctx, preset);
    }
    return this._ir[zone];
  }

  /**
   * @param {keyof typeof REVERB_ZONES} zone
   * @param {number} [speed] m/s for predelay tweak
   */
  setZone(zone, speed = 0) {
    const z = REVERB_ZONES[zone] ? zone : "open";
    if (z !== this._zone) {
      this._zone = z;
      this._conv.buffer = this._impulse(z);
    }
    const preset = REVERB_ZONES[z];
    const targetWet = preset.wet + Math.min(0.04, speed * 0.0012);
    const now = this.ctx.currentTime;
    this._wetGain.gain.setTargetAtTime(targetWet, now, 0.22);
    this._predelay.delayTime.setTargetAtTime(preset.predelay, now, 0.18);
  }
}
