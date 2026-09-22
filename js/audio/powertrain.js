/**
 * Per-car engine / exhaust voice — throaty recorded idle/load beds.
 *
 * WHO THIS IS FOR: RallyAudio (engine.js) and the race loop.
 * WHAT IT DOES: Celica / Delta / Stratos recorded loops, pitch-tracked with
 *   compressed playback. An octave-down copy of the same load bed fills the
 *   chest (80–250 Hz). Mild saturation adds exhaust harmonics. No synth
 *   cylinder pulse, turbo kettle, or helium scream.
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
    recHigh: 6200,
    rateMul: 0.86,
    idleVol: 0.56,
    loadVol: 0.82,
    throatVol: 0.58,
    highVol: 0,
    pulseVol: 0,
    whistleVol: 0,
    hp: 28,
    lp: 2400,
    body: 5.4,
    bodyHz: 92,
    throatHz: 205,
    throatEqDb: 4.8,
    noteHz: 365,
    noteGain: 2.6,
    raspHz: 2200,
    raspDb: -6.5,
    spoolUp: 2.5,
    spoolDown: 6.2,
    bovDrop: 0.28,
    bovBoost: 0.28,
    crackle: false,
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
    rateMul: 0.84,
    idleVol: 0.58,
    loadVol: 0.84,
    throatVol: 0.64,
    highVol: 0,
    pulseVol: 0,
    whistleVol: 0,
    hp: 24,
    lp: 2200,
    body: 6.2,
    bodyHz: 84,
    throatHz: 175,
    throatEqDb: 5.4,
    noteHz: 320,
    noteGain: 2.2,
    raspHz: 2000,
    raspDb: -7.2,
    spoolUp: 2.9,
    spoolDown: 7.0,
    bovDrop: 0.26,
    bovBoost: 0.26,
    crackle: false,
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
    rateMul: 0.88,
    idleVol: 0.6,
    loadVol: 0.8,
    throatVol: 0.5,
    highVol: 0,
    pulseVol: 0,
    whistleVol: 0,
    hp: 30,
    lp: 2550,
    body: 4.4,
    bodyHz: 102,
    throatHz: 240,
    throatEqDb: 4.2,
    noteHz: 445,
    noteGain: 3.0,
    raspHz: 2400,
    raspDb: -5.8,
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
    this.throatSrc = null;
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
    if (this.ready) this._startLoops();
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

    const mute = live ? 1 : s.idleHum ? 0.12 : 0;
    const coast = clamp((1 - throttle) * clamp((rpmN - 0.22) * 1.4, 0, 1) * clamp(speed / 18, 0, 1), 0, 0.55);
    const brakeLoad = brake * 0.35 * rpmN;

    const idleMix = mute * (1 - rpmN) * (0.72 + 0.28 * (1 - throttle));
    // Working-band WOT is chesty, not a limiter scream. Extra RPM past ~0.68
    // (cruise 4th) adds little gain — the engine is doing its job, not straining.
    const cruise = clamp((rpmN - 0.68) / 0.32, 0, 1);
    const loadMix =
      mute *
      (rpmN * 0.4 + throttle * 0.68 + coast * 0.32 + brakeLoad) *
      lerp(1, 0.66, cruise * throttle);
    const throatMix = mute * p.throatVol * (0.26 + loadMix * 0.7 + idleMix * 0.22);

    this.idleGain.gain.setTargetAtTime(idleMix * p.idleVol, now, 0.07);
    this.loadGain.gain.setTargetAtTime(loadMix * p.loadVol, now, 0.055);
    this.throatGain.gain.setTargetAtTime(throatMix, now, 0.06);
    if (this.highGain) this.highGain.gain.setTargetAtTime(0, now, 0.04);

    const idleRate = loopRate(rpm, p.recIdle, p.rateMul);
    const loadRate = loopRate(rpm, p.recLoad, p.rateMul);
    if (this.idleSrc) this.idleSrc.playbackRate.setTargetAtTime(idleRate, now, 0.055);
    if (this.loadSrc) this.loadSrc.playbackRate.setTargetAtTime(loadRate, now, 0.05);
    if (this.throatSrc) this.throatSrc.playbackRate.setTargetAtTime(clamp(loadRate * 0.5, 0.4, 0.62), now, 0.06);

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
    playHit(this.ctx, this.dest, this._buf[OVERRUN_URL], {
      gain: (up ? 0.05 : 0.08) * (0.4 + throttle * 0.35),
      rate: 0.82 + (rpm / p.redline) * 0.22,
      dur: 0.22,
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
      gain: (p.turbo ? 0.16 : 0.12) * intensity,
      rate: 0.92 + (p.turbo ? this.boost : rpm / p.redline) * 0.1,
      dur: 0.42,
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

  _tickDynamicEq(p, rpmN, throttle, mute, now) {
    const load = mute * (rpmN * 0.4 + throttle * 0.6);
    this.throatEq.gain.setTargetAtTime(p.throatEqDb * (0.78 + load * 0.4), now, 0.07);
    this.throatEq.frequency.setTargetAtTime(p.throatHz * (0.9 + throttle * 0.12), now, 0.08);
    this.noteEq.gain.setTargetAtTime(p.noteGain * (0.55 + load * 0.5), now, 0.07);
    this.lp.frequency.setTargetAtTime(p.lp * (0.82 + load * 0.16), now, 0.08);
    this.body.gain.setTargetAtTime(p.body * (0.92 + throttle * 0.22), now, 0.08);
  }

  _buildGraph() {
    const ctx = this.ctx;

    this.idleGain = ctx.createGain();
    this.idleGain.gain.value = 0;
    this.loadGain = ctx.createGain();
    this.loadGain.gain.value = 0;
    this.throatGain = ctx.createGain();
    this.throatGain.gain.value = 0;
    this.highGain = ctx.createGain();
    this.highGain.gain.value = 0;
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;

    this.hp = ctx.createBiquadFilter();
    this.hp.type = "highpass";
    this.hp.frequency.value = 28;
    this.hp.Q.value = 0.55;

    this.body = ctx.createBiquadFilter();
    this.body.type = "lowshelf";
    this.body.frequency.value = 92;
    this.body.gain.value = 5.2;

    this.throatEq = ctx.createBiquadFilter();
    this.throatEq.type = "peaking";
    this.throatEq.frequency.value = 205;
    this.throatEq.Q.value = 0.85;
    this.throatEq.gain.value = 4.6;

    this.noteEq = ctx.createBiquadFilter();
    this.noteEq.type = "peaking";
    this.noteEq.frequency.value = 365;
    this.noteEq.Q.value = 0.7;
    this.noteEq.gain.value = 2.4;

    this.rasp = ctx.createBiquadFilter();
    this.rasp.type = "highshelf";
    this.rasp.frequency.value = 2200;
    this.rasp.gain.value = -6.5;

    this.lp = ctx.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 2400;
    this.lp.Q.value = 0.65;

    this.throatLp = ctx.createBiquadFilter();
    this.throatLp.type = "lowpass";
    this.throatLp.frequency.value = 520;
    this.throatLp.Q.value = 0.7;

    this.drive = ctx.createWaveShaper();
    this.drive.curve = makeThroatCurve(2.35);
    this.drive.oversample = "2x";
    this.driveTrim = ctx.createGain();
    this.driveTrim.gain.value = 0.78;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16;
    this.comp.knee.value = 14;
    this.comp.ratio.value = 2.0;
    this.comp.attack.value = 0.008;
    this.comp.release.value = 0.14;

    this.idleGain.connect(this.hp);
    this.loadGain.connect(this.hp);
    this.throatGain.connect(this.throatLp);
    this.throatLp.connect(this.hp);
    this.hp.connect(this.body);
    this.body.connect(this.throatEq);
    this.throatEq.connect(this.noteEq);
    this.noteEq.connect(this.rasp);
    this.rasp.connect(this.lp);
    this.lp.connect(this.drive);
    this.drive.connect(this.driveTrim);
    this.driveTrim.connect(this.comp);
    this.comp.connect(this.dest);

    this._applyTone(true);
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
    this.body.frequency.setTargetAtTime(p.bodyHz, now, tau);
    this.body.gain.setTargetAtTime(p.body, now, tau);
    this.throatEq.frequency.setTargetAtTime(p.throatHz, now, tau);
    this.throatEq.gain.setTargetAtTime(p.throatEqDb, now, tau);
    this.noteEq.frequency.setTargetAtTime(p.noteHz, now, tau);
    this.noteEq.gain.setTargetAtTime(p.noteGain, now, tau);
    this.rasp.frequency.setTargetAtTime(p.raspHz, now, tau);
    this.rasp.gain.setTargetAtTime(p.raspDb, now, tau);
  }

  _startLoops() {
    this._restart("idleSrc", "idleGain", this._idleBuf());
    this._restart("loadSrc", "loadGain", this._loadBuf());
    this._restart("throatSrc", "throatGain", this._loadBuf());
    this._restart("highSrc", "highGain", null);
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
   * @param {"idleSrc"|"loadSrc"|"throatSrc"|"highSrc"} srcKey
   * @param {"idleGain"|"loadGain"|"throatGain"|"highGain"} gainKey
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
    for (const g of [this.idleGain, this.loadGain, this.throatGain, this.highGain]) {
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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Map RPM onto a loop without helium stretch.
 * Linear rpm/rec at redline is ~1.6× (chipmunk). Compress the delta so the
 * recorded centre stays honest and the top is a growl.
 */
function loopRate(rpm, rec, mul) {
  const recHz = Math.max(200, rec);
  const n = (rpm - recHz) / recHz;
  const compressed = 1 + n * 0.4 * mul;
  return clamp(compressed * 0.93, 0.8, 1.18);
}

/**
 * Soft saturator — even harmonics from the recording, not a synth oscillator.
 * @param {number} k
 * @returns {Float32Array}
 */
function makeThroatCurve(k) {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / (n - 1) - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  return curve;
}
