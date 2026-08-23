/**
 * Per-car engine / exhaust voice — recorded 44.1 kHz loops.
 *
 * WHO THIS IS FOR: RallyAudio (engine.js) and the race loop.
 * WHAT IT DOES: plays a unique recorded exhaust bed per car — Celica
 *   3S-GTE WRC, Integrale-style turbo 4, Stratos-style V6 — pitch-tracked
 *   to RPM and crossfaded idle↔load. Lift-off triggers that car's dump.
 * HOW IT CONNECTS: game.js passes rpm, throttle, carId each tick.
 *
 * See assets/sfx/ATTRIBUTION.txt for licenses.
 */

import { loadSample, playHit } from "./bank.js?v=1";

/** Unique recorded beds per featured engine. */
export const POWERTRAINS = {
  celica: {
    id: "celica",
    name: "3S-GTE",
    idle: 950,
    redline: 7500,
    turbo: true,
    idleUrl: "assets/sfx/celica-idle.mp3",
    loadUrl: "assets/sfx/celica-load.mp3",
    liftUrl: "assets/sfx/celica-lift.mp3",
    recIdle: 980,
    recLoad: 4600,
    rateMul: 1,
    idleVol: 0.44,
    loadVol: 0.76,
    hp: 72,
    lp: 7200,
    body: 1.4,
    presence: 1.8,
    spoolUp: 2.35,
    spoolDown: 6.5,
    bovDrop: 0.2,
    bovBoost: 0.3,
  },
  delta: {
    id: "delta",
    name: "Integrale 16v turbo",
    idle: 950,
    redline: 7500,
    turbo: true,
    idleUrl: "assets/sfx/delta-idle.mp3",
    loadUrl: "assets/sfx/delta-load.mp3",
    liftUrl: "assets/sfx/delta-lift.mp3",
    recIdle: 960,
    recLoad: 4300,
    rateMul: 1,
    idleVol: 0.48,
    loadVol: 0.8,
    hp: 58,
    lp: 5400,
    body: 3.4,
    presence: 0.3,
    spoolUp: 2.75,
    spoolDown: 7.2,
    bovDrop: 0.18,
    bovBoost: 0.28,
  },
  stratos: {
    id: "stratos",
    name: "Dino 2.4 V6",
    idle: 1100,
    redline: 7800,
    turbo: false,
    idleUrl: "assets/sfx/stratos-idle.mp3",
    loadUrl: "assets/sfx/stratos-load.mp3",
    liftUrl: "assets/sfx/stratos-lift.mp3",
    recIdle: 900,
    recLoad: 4200,
    rateMul: 1.02,
    idleVol: 0.5,
    loadVol: 0.72,
    hp: 68,
    lp: 8200,
    body: 0.8,
    presence: 2.6,
    spoolUp: 0,
    spoolDown: 0,
    bovDrop: 1,
    bovBoost: 1,
  },
};

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 */
export class PowertrainVoice {
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.dest = dest;
    this.carId = "celica";
    this.boost = 0;
    this._prevThrottle = 0;
    this._lastBov = 0;
    this._t = ctx.currentTime;
    this.ready = false;
    /** @type {Record<string, AudioBuffer|null>} */
    this._buf = {};
    this.idleSrc = null;
    this.loadSrc = null;
    this._buildGraph();
  }

  /**
   * Decode exhaust beds. Safe to call once from RallyAudio.unlock().
   */
  boot() {
    const urls = new Set();
    for (const p of Object.values(POWERTRAINS)) {
      urls.add(p.idleUrl);
      urls.add(p.loadUrl);
      urls.add(p.liftUrl);
    }
    Promise.all(
      [...urls].map(async (url) => {
        const fade = url.indexOf("-lift.") >= 0 ? 0 : 0.1;
        this._buf[url] = await loadSample(this.ctx, url, fade);
      })
    ).then(() => {
      this.ready = true;
      this._startLoops();
    });
  }

  /**
   * Switch Celica / Delta / Stratos voicing.
   * @param {string} id
   */
  setCar(id) {
    const next = POWERTRAINS[id] ? id : "celica";
    if (next === this.carId) return;
    this.carId = next;
    this.boost = 0;
    this._applyTone();
    if (this.ready) this._startLoops();
  }

  /**
   * @param {{rpm?:number,throttle?:number,slip?:number,speed?:number,gear?:number,active?:boolean,carId?:string}} s
   */
  setState(s) {
    if (s.carId) this.setCar(s.carId);
    if (!this.ready) return;
    const p = POWERTRAINS[this.carId];
    const now = this.ctx.currentTime;
    const dt = Math.min(0.08, Math.max(0.001, now - this._t));
    this._t = now;

    const live = s.active !== false;
    const rpm = clamp(s.rpm || p.idle, p.idle * 0.85, p.redline * 1.02);
    const throttle = live ? clamp(s.throttle || 0, 0, 1) : 0;
    const rpmN = clamp((rpm - p.idle) / (p.redline - p.idle), 0, 1);

    this._tickBoost(p, throttle, rpm, dt);
    this._maybeLift(p, throttle, rpm, now);

    const mute = live ? 1 : s.idleHum ? 0.08 : 0;
    const idleMix = mute * (1 - rpmN) * (0.55 + 0.45 * (1 - throttle));
    const loadMix = mute * (rpmN * 0.42 + throttle * 0.7);

    this.idleGain.gain.setTargetAtTime(idleMix * p.idleVol, now, 0.06);
    this.loadGain.gain.setTargetAtTime(loadMix * p.loadVol, now, 0.05);

    const idleRate = clamp((rpm / p.recIdle) * p.rateMul, 0.72, 2.15);
    const loadRate = clamp((rpm / p.recLoad) * p.rateMul, 0.58, 1.72);
    if (this.idleSrc) this.idleSrc.playbackRate.setTargetAtTime(idleRate, now, 0.05);
    if (this.loadSrc) this.loadSrc.playbackRate.setTargetAtTime(loadRate, now, 0.045);

    this._prevThrottle = throttle;
  }

  _tickBoost(p, throttle, rpm, dt) {
    if (!p.turbo) {
      this.boost = 0;
      return;
    }
    const map = clamp((rpm - 1700) / 3800, 0, 1);
    const target = throttle * map;
    const rate = target > this.boost ? p.spoolUp : p.spoolDown;
    this.boost += (target - this.boost) * (1 - Math.exp(-rate * dt));
    this.boost = clamp(this.boost, 0, 1);
  }

  /**
   * Recorded dump valve / overrun on a real lift, not a synth chirp.
   * @param {typeof POWERTRAINS.celica} p
   * @param {number} throttle
   * @param {number} rpm
   * @param {number} now
   */
  _maybeLift(p, throttle, rpm, now) {
    const drop = this._prevThrottle - throttle;
    if (drop < (p.turbo ? p.bovDrop : 0.35)) return;
    if (now - this._lastBov < 0.18) return;
    if (rpm < 2800) return;
    this._lastBov = now;
    const intensity = clamp((p.turbo ? this.boost * 0.7 : 0.5) + drop * 0.5, 0.25, 1);
    playHit(this.ctx, this.dest, this._buf[p.liftUrl], {
      gain: (p.turbo ? 0.4 : 0.3) * intensity,
      rate: 0.9 + (p.turbo ? this.boost : rpm / p.redline) * 0.18,
      dur: 0.52,
    });
    if (p.turbo) this.boost *= 0.32;
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.idleGain = ctx.createGain();
    this.idleGain.gain.value = 0;
    this.loadGain = ctx.createGain();
    this.loadGain.gain.value = 0;

    this.hp = ctx.createBiquadFilter();
    this.hp.type = "highpass";
    this.hp.frequency.value = 75;
    this.hp.Q.value = 0.7;

    this.body = ctx.createBiquadFilter();
    this.body.type = "lowshelf";
    this.body.frequency.value = 140;
    this.body.gain.value = 1.6;

    this.presence = ctx.createBiquadFilter();
    this.presence.type = "peaking";
    this.presence.frequency.value = 2100;
    this.presence.Q.value = 0.8;
    this.presence.gain.value = 1.2;

    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 6800;
    this.lp.Q.value = 0.7;

    this.idleGain.connect(this.hp);
    this.loadGain.connect(this.hp);
    this.hp.connect(this.body);
    this.body.connect(this.presence);
    this.presence.connect(this.lp);
    this.lp.connect(this.dest);

    this._applyTone();
  }

  _applyTone() {
    const p = POWERTRAINS[this.carId];
    const now = this.ctx.currentTime;
    this.hp.frequency.setTargetAtTime(p.hp, now, 0.08);
    this.lp.frequency.setTargetAtTime(p.lp, now, 0.08);
    this.body.gain.setTargetAtTime(p.body, now, 0.08);
    this.presence.gain.setTargetAtTime(p.presence, now, 0.08);
  }

  _startLoops() {
    this._restart("idleSrc", "idleGain", this._idleBuf());
    this._restart("loadSrc", "loadGain", this._loadBuf());
  }

  /** @returns {AudioBuffer|null} */
  _idleBuf() {
    return this._buf[POWERTRAINS[this.carId].idleUrl] || null;
  }

  /** @returns {AudioBuffer|null} */
  _loadBuf() {
    return this._buf[POWERTRAINS[this.carId].loadUrl] || null;
  }

  /**
   * @param {"idleSrc"|"loadSrc"} srcKey
   * @param {"idleGain"|"loadGain"} gainKey
   * @param {AudioBuffer|null} buf
   */
  _restart(srcKey, gainKey, buf) {
    if (this[srcKey]) {
      try {
        this[srcKey].stop();
      } catch {
        /* already stopped */
      }
      try {
        this[srcKey].disconnect();
      } catch {
        /* ignore */
      }
      this[srcKey] = null;
    }
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this[gainKey]);
    src.start();
    this[srcKey] = src;
  }

  /**
   * Ramp looping idle/load beds to silence at the finish line.
   * @param {number} [durationSec]
   */
  fadeOut(durationSec = 1.35) {
    if (!this.ready || !this.ctx) return;
    const now = this.ctx.currentTime;
    const dur = Math.max(0.25, durationSec);
    for (const g of [this.idleGain, this.loadGain]) {
      if (!g) continue;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + dur);
    }
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
