/**
 * Per-car engine / exhaust voice — recorded 44.1 kHz beds + live layers.
 *
 * WHO THIS IS FOR: RallyAudio (engine.js) and the race loop.
 * WHAT IT DOES: unique recorded exhaust per car (Celica 3S-GTE, Delta turbo
 *   four, Stratos V6), pitch-tracked to RPM, with a high-load scream layer,
 *   cylinder pulse, turbo whistle, gear-shift blip, and dynamic EQ so the
 *   voice reads as that chassis under throttle — not a single stretched loop.
 * HOW IT CONNECTS: game.js passes rpm, throttle, gear, brake, carId each tick.
 *
 * See assets/sfx/ATTRIBUTION.txt for sample licenses.
 */

import { loadSample, playHit } from "./bank.js?v=3";

/** Unique recorded beds + tone profile per featured engine. */
export const POWERTRAINS = {
  celica: {
    id: "celica",
    name: "3S-GTE",
    idle: 950,
    redline: 7500,
    turbo: true,
    cylinders: 4,
    idleUrl: "assets/sfx/celica-idle.mp3",
    loadUrl: "assets/sfx/celica-load.mp3",
    liftUrl: "assets/sfx/celica-lift.mp3",
    recIdle: 980,
    recLoad: 4600,
    /** High-load scream uses the load bed pitched from this RPM centre. */
    recHigh: 6200,
    rateMul: 1,
    idleVol: 0.52,
    loadVol: 0.92,
    highVol: 0.66,
    pulseVol: 0.13,
    whistleVol: 0.085,
    hp: 62,
    lp: 8600,
    body: 1.85,
    presence: 2.45,
    presenceHz: 2350,
    spoolUp: 2.5,
    spoolDown: 6.2,
    bovDrop: 0.18,
    bovBoost: 0.28,
    crackle: true,
  },
  delta: {
    id: "delta",
    name: "Integrale 16v turbo",
    idle: 950,
    redline: 7500,
    turbo: true,
    cylinders: 4,
    idleUrl: "assets/sfx/delta-idle.mp3",
    loadUrl: "assets/sfx/delta-load.mp3",
    liftUrl: "assets/sfx/delta-lift.mp3",
    recIdle: 960,
    recLoad: 4300,
    recHigh: 5800,
    rateMul: 0.98,
    idleVol: 0.56,
    loadVol: 0.95,
    highVol: 0.58,
    pulseVol: 0.14,
    whistleVol: 0.065,
    hp: 48,
    lp: 6400,
    body: 4.0,
    presence: 0.7,
    presenceHz: 1700,
    spoolUp: 2.9,
    spoolDown: 7.0,
    bovDrop: 0.16,
    bovBoost: 0.26,
    crackle: true,
  },
  stratos: {
    id: "stratos",
    name: "Dino 2.4 V6",
    idle: 1100,
    redline: 7800,
    turbo: false,
    cylinders: 6,
    idleUrl: "assets/sfx/stratos-idle.mp3",
    loadUrl: "assets/sfx/stratos-load.mp3",
    liftUrl: "assets/sfx/stratos-lift.mp3",
    recIdle: 900,
    recLoad: 4200,
    recHigh: 6400,
    rateMul: 1.04,
    idleVol: 0.58,
    loadVol: 0.88,
    highVol: 0.76,
    pulseVol: 0.1,
    whistleVol: 0,
    hp: 72,
    lp: 9800,
    body: 1.05,
    presence: 3.35,
    presenceHz: 2750,
    spoolUp: 0,
    spoolDown: 0,
    bovDrop: 1,
    bovBoost: 1,
    crackle: false,
  },
};

const OVERRUN_URL = "assets/sfx/overrun.mp3";

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
    this._prevGear = 1;
    this._lastBov = 0;
    this._lastShift = 0;
    this._t = ctx.currentTime;
    this.ready = false;
    /** @type {Record<string, AudioBuffer|null>} */
    this._buf = {};
    this.idleSrc = null;
    this.loadSrc = null;
    this.highSrc = null;
    this._noiseSrc = null;
    this._pulseLfo = null;
    this._buildGraph();
  }

  /**
   * Decode exhaust beds. Safe to call once from RallyAudio.unlock().
   */
  boot() {
    const urls = new Set([OVERRUN_URL]);
    for (const p of Object.values(POWERTRAINS)) {
      urls.add(p.idleUrl);
      urls.add(p.loadUrl);
      urls.add(p.liftUrl);
    }
    Promise.all(
      [...urls].map(async (url) => {
        const fade = /-(lift|overrun)\./.test(url) ? 0 : 0.1;
        this._buf[url] = await loadSample(this.ctx, url, fade);
      })
    ).then(() => {
      this.ready = true;
      this._startLoops();
      this._startPulse();
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
    this._applyTone(true);
    if (this.ready) {
      this._startLoops();
      this._retunePulse();
    }
  }

  /**
   * @param {{
   *   rpm?:number,throttle?:number,brake?:number,slip?:number,speed?:number,
   *   gear?:number,active?:boolean,carId?:string,idleHum?:boolean
   * }} s
   */
  setState(s) {
    if (s.carId) this.setCar(s.carId);
    if (!this.ready) return;
    const p = POWERTRAINS[this.carId];
    const now = this.ctx.currentTime;
    const dt = Math.min(0.08, Math.max(0.001, now - this._t));
    this._t = now;

    const live = s.active !== false;
    const rpm = clamp(s.rpm || p.idle, p.idle * 0.85, p.redline * 1.04);
    const throttle = live ? clamp(s.throttle || 0, 0, 1) : 0;
    const brake = live ? clamp(s.brake || 0, 0, 1) : 0;
    const speed = live ? Math.max(0, s.speed || 0) : 0;
    const gear = s.gear != null ? s.gear | 0 : this._prevGear;
    const rpmN = clamp((rpm - p.idle) / (p.redline - p.idle), 0, 1);

    this._tickBoost(p, throttle, rpm, dt);
    this._maybeGearShift(p, gear, rpm, throttle, now);
    this._maybeLift(p, throttle, rpm, now);

    const mute = live ? 1 : s.idleHum ? 0.1 : 0;
    // Engine braking: closed throttle at speed still pulls the load bed.
    const coast = clamp((1 - throttle) * clamp((rpmN - 0.22) * 1.4, 0, 1) * clamp(speed / 18, 0, 1), 0, 0.55);
    const brakeLoad = brake * 0.35 * rpmN;

    // Smooth crossfade — idle owns park; load owns WOT mid; high opens near redline.
    const idleMix =
      mute *
      (1 - rpmN) *
      (0.62 + 0.38 * (1 - throttle)) *
      (1 - throttle * 0.35);
    const loadMix =
      mute *
      (rpmN * 0.38 + throttle * 0.78 + coast * 0.45 + brakeLoad) *
      (1 - Math.max(0, rpmN - 0.72) * 0.55);
    const highMix =
      mute *
      Math.pow(clamp((rpmN - 0.48) / 0.52, 0, 1), 1.35) *
      (0.35 + throttle * 0.75 + coast * 0.25);

    this.idleGain.gain.setTargetAtTime(idleMix * p.idleVol, now, 0.055);
    this.loadGain.gain.setTargetAtTime(loadMix * p.loadVol, now, 0.045);
    this.highGain.gain.setTargetAtTime(highMix * p.highVol, now, 0.04);

    const idleRate = clamp((rpm / p.recIdle) * p.rateMul, 0.7, 2.05);
    const loadRate = clamp((rpm / p.recLoad) * p.rateMul, 0.55, 1.68);
    const highRate = clamp((rpm / p.recHigh) * p.rateMul, 0.62, 1.55);
    if (this.idleSrc) this.idleSrc.playbackRate.setTargetAtTime(idleRate, now, 0.048);
    if (this.loadSrc) this.loadSrc.playbackRate.setTargetAtTime(loadRate, now, 0.042);
    if (this.highSrc) this.highSrc.playbackRate.setTargetAtTime(highRate, now, 0.04);

    this._tickPulse(p, rpm, throttle, mute, now);
    this._tickWhistle(p, throttle, rpmN, mute, now);
    this._tickDynamicEq(p, rpmN, throttle, mute, now);

    this._prevThrottle = throttle;
    this._prevGear = gear;
  }

  _tickBoost(p, throttle, rpm, dt) {
    if (!p.turbo) {
      this.boost = 0;
      return;
    }
    const map = clamp((rpm - 1600) / 4000, 0, 1);
    const target = throttle * map;
    const rate = target > this.boost ? p.spoolUp : p.spoolDown;
    this.boost += (target - this.boost) * (1 - Math.exp(-rate * dt));
    this.boost = clamp(this.boost, 0, 1);
  }

  /**
   * Momentary load dip + soft overrun on an up/down shift so gears feel mechanical.
   * @param {typeof POWERTRAINS.celica} p
   * @param {number} gear
   * @param {number} rpm
   * @param {number} throttle
   * @param {number} now
   */
  _maybeGearShift(p, gear, rpm, throttle, now) {
    if (gear === this._prevGear) return;
    if (now - this._lastShift < 0.12) return;
    if (rpm < p.idle * 1.15) return;
    this._lastShift = now;
    const up = gear > this._prevGear;
    const dip = up ? 0.22 : 0.14;
    const cur = this.loadGain.gain.value;
    this.loadGain.gain.cancelScheduledValues(now);
    this.loadGain.gain.setValueAtTime(cur, now);
    this.loadGain.gain.linearRampToValueAtTime(Math.max(0.02, cur * (1 - dip)), now + 0.04);
    this.loadGain.gain.linearRampToValueAtTime(cur, now + 0.14);
    if (this.highGain) {
      const h = this.highGain.gain.value;
      this.highGain.gain.cancelScheduledValues(now);
      this.highGain.gain.setValueAtTime(h, now);
      this.highGain.gain.linearRampToValueAtTime(Math.max(0.01, h * 0.55), now + 0.035);
      this.highGain.gain.linearRampToValueAtTime(h, now + 0.12);
    }
    // Soft mechanical edge — recorded overrun, not a synth click.
    playHit(this.ctx, this.dest, this._buf[OVERRUN_URL], {
      gain: (up ? 0.12 : 0.18) * (0.45 + throttle * 0.4),
      rate: 0.85 + rpm / p.redline * 0.35,
      dur: 0.28,
    });
  }

  /**
   * Recorded dump valve / overrun on a real lift.
   * @param {typeof POWERTRAINS.celica} p
   * @param {number} throttle
   * @param {number} rpm
   * @param {number} now
   */
  _maybeLift(p, throttle, rpm, now) {
    const drop = this._prevThrottle - throttle;
    if (drop < (p.turbo ? p.bovDrop : 0.32)) return;
    if (now - this._lastBov < 0.16) return;
    if (rpm < 2600) return;
    this._lastBov = now;
    const intensity = clamp((p.turbo ? this.boost * 0.75 : 0.55) + drop * 0.55, 0.28, 1);
    playHit(this.ctx, this.dest, this._buf[p.liftUrl], {
      gain: (p.turbo ? 0.48 : 0.36) * intensity,
      rate: 0.88 + (p.turbo ? this.boost : rpm / p.redline) * 0.22,
      dur: 0.58,
    });
    if (p.crackle && this._buf[OVERRUN_URL]) {
      const jitter = 0.92 + ((Math.floor(rpm) % 17) / 17) * 0.12;
      playHit(this.ctx, this.dest, this._buf[OVERRUN_URL], {
        gain: 0.16 * intensity,
        rate: jitter,
        dur: 0.35,
      });
    }
    if (p.turbo) this.boost *= 0.3;
  }

  _tickPulse(p, rpm, throttle, mute, now) {
    if (!this.pulseGain || !this._pulseLfo) return;
    const fireHz = (rpm / 60) * (p.cylinders / 2);
    this._pulseLfo.frequency.setTargetAtTime(clamp(fireHz, 8, 220), now, 0.05);
    const amt =
      mute *
      p.pulseVol *
      (0.35 + throttle * 0.65) *
      (0.55 + clamp((rpm - p.idle) / (p.redline - p.idle), 0, 1) * 0.55);
    this.pulseGain.gain.setTargetAtTime(amt, now, 0.06);
  }

  _tickWhistle(p, throttle, rpmN, mute, now) {
    if (!this.whistleGain) return;
    if (!p.turbo || p.whistleVol <= 0) {
      this.whistleGain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }
    const open = this.boost * throttle * clamp((rpmN - 0.12) / 0.55, 0, 1);
    this.whistleGain.gain.setTargetAtTime(mute * p.whistleVol * open, now, 0.07);
    if (this.whistleFilt) {
      this.whistleFilt.frequency.setTargetAtTime(3200 + this.boost * 4200 + rpmN * 1800, now, 0.08);
    }
  }

  _tickDynamicEq(p, rpmN, throttle, mute, now) {
    // Presence and air open with throttle; idle stays darker / thicker.
    const load = mute * (rpmN * 0.45 + throttle * 0.7);
    this.presence.gain.setTargetAtTime(p.presence * (0.55 + load * 0.7), now, 0.07);
    this.presence.frequency.setTargetAtTime(p.presenceHz * (0.92 + throttle * 0.14), now, 0.08);
    this.lp.frequency.setTargetAtTime(p.lp * (0.72 + load * 0.38), now, 0.08);
    this.body.gain.setTargetAtTime(p.body * (1.05 - throttle * 0.18), now, 0.08);
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.idleGain = ctx.createGain();
    this.idleGain.gain.value = 0;
    this.loadGain = ctx.createGain();
    this.loadGain.gain.value = 0;
    this.highGain = ctx.createGain();
    this.highGain.gain.value = 0;
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;

    this.hp = ctx.createBiquadFilter();
    this.hp.type = "highpass";
    this.hp.frequency.value = 70;
    this.hp.Q.value = 0.7;

    this.body = ctx.createBiquadFilter();
    this.body.type = "lowshelf";
    this.body.frequency.value = 135;
    this.body.gain.value = 1.6;

    this.presence = ctx.createBiquadFilter();
    this.presence.type = "peaking";
    this.presence.frequency.value = 2100;
    this.presence.Q.value = 0.85;
    this.presence.gain.value = 1.2;

    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 7200;
    this.lp.Q.value = 0.7;

    // Soft bus compressor — recorded beds stay punchy without clipping the SFX bus.
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -15;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 2.3;
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.12;

    this.idleGain.connect(this.hp);
    this.loadGain.connect(this.hp);
    this.highGain.connect(this.hp);
    this.hp.connect(this.body);
    this.body.connect(this.presence);
    this.presence.connect(this.lp);
    this.lp.connect(this.comp);
    this.comp.connect(this.dest);

    // Cylinder pulse: filtered noise amplitude-modulated at firing frequency.
    this.pulseFilt = ctx.createBiquadFilter();
    this.pulseFilt.type = "bandpass";
    this.pulseFilt.frequency.value = 180;
    this.pulseFilt.Q.value = 2.4;
    this.pulseGain.connect(this.pulseFilt);
    this.pulseFilt.connect(this.body);

    // Turbo whistle: high bandpass on shared noise.
    this.whistleFilt = ctx.createBiquadFilter();
    this.whistleFilt.type = "bandpass";
    this.whistleFilt.frequency.value = 4800;
    this.whistleFilt.Q.value = 6.5;
    this.whistleGain.connect(this.whistleFilt);
    this.whistleFilt.connect(this.presence);

    this._applyTone(true);
  }

  _startPulse() {
    if (this._noiseSrc) return;
    const ctx = this.ctx;
    const seconds = 1.5;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;

    // LFO gates the noise into a soft firing pulse (depth via pulseGain).
    this._pulseLfo = ctx.createOscillator();
    this._pulseLfo.type = "sine";
    this._pulseLfo.frequency.value = 40;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.55;
    const pulseGate = ctx.createGain();
    pulseGate.gain.value = 0.45;
    this._pulseLfo.connect(lfoGain);
    lfoGain.connect(pulseGate.gain);

    noise.connect(pulseGate);
    pulseGate.connect(this.pulseGain);
    // Same noise also feeds the whistle path (gain 0 until spool).
    noise.connect(this.whistleGain);

    noise.start();
    this._pulseLfo.start();
    this._noiseSrc = noise;
    this._retunePulse();
  }

  _retunePulse() {
    const p = POWERTRAINS[this.carId];
    if (!this.pulseFilt) return;
    const now = this.ctx.currentTime;
    // 4-cyl sits lower / thicker; V6 a bit higher and thinner.
    const centre = p.cylinders >= 6 ? 220 : 155;
    this.pulseFilt.frequency.setTargetAtTime(centre, now, 0.1);
    this.pulseFilt.Q.setTargetAtTime(p.cylinders >= 6 ? 1.8 : 2.6, now, 0.1);
  }

  /**
   * @param {boolean} [snap]
   */
  _applyTone(snap = false) {
    const p = POWERTRAINS[this.carId];
    const now = this.ctx.currentTime;
    const tau = snap ? 0.02 : 0.08;
    this.hp.frequency.setTargetAtTime(p.hp, now, tau);
    this.lp.frequency.setTargetAtTime(p.lp, now, tau);
    this.body.gain.setTargetAtTime(p.body, now, tau);
    this.presence.gain.setTargetAtTime(p.presence, now, tau);
    this.presence.frequency.setTargetAtTime(p.presenceHz, now, tau);
  }

  _startLoops() {
    this._restart("idleSrc", "idleGain", this._idleBuf());
    this._restart("loadSrc", "loadGain", this._loadBuf());
    this._restart("highSrc", "highGain", this._loadBuf());
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
   * @param {"idleSrc"|"loadSrc"|"highSrc"} srcKey
   * @param {"idleGain"|"loadGain"|"highGain"} gainKey
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
   * Ramp looping beds to silence at the finish line.
   * @param {number} [durationSec]
   */
  fadeOut(durationSec = 1.35) {
    if (!this.ready || !this.ctx) return;
    const now = this.ctx.currentTime;
    const dur = Math.max(0.25, durationSec);
    for (const g of [this.idleGain, this.loadGain, this.highGain, this.pulseGain, this.whistleGain]) {
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
