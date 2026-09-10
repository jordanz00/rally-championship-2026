/**
 * Tires and road — recorded asphalt squeal and gravel beds.
 *
 * WHO THIS IS FOR: RallyAudio and the race loop.
 * WHAT IT DOES: always plays a quiet road texture from speed + surface,
 *   then adds a heavier scrape when the car is in a yaw slide. Asphalt
 *   is a real tire loop; gravel/dirt/sand use a recorded gravel road;
 *   mud is that bed through a dark filter. During a drift, gravel spatialize
 *   to the travel-side door (AM3 / Mizuguchi: grit hits the door on the
 *   direction of travel, not from the front).
 * HOW IT CONNECTS: game.js passes driftAngle, slip, surfaceId, speed,
 *   onGround, surfaceDust, bump, and shock through RallyAudio.setState().
 *
 * See assets/sfx/ATTRIBUTION.txt for licenses.
 * See docs/AM3-RESEARCH.md §6 and docs/AM3-DOC-TRANSCRIPT.md.
 */

import { loadSample } from "./bank.js?v=3";

/** How the two recorded beds mix for each driving surface. */
const MIX = {
  tarmac: { asphalt: 1, gravel: 0.04, mud: 0 },
  cobble: { asphalt: 0.68, gravel: 0.4, mud: 0 },
  gravel: { asphalt: 0.06, gravel: 1, mud: 0 },
  mud: { asphalt: 0, gravel: 0.22, mud: 0.95 },
  dirt: { asphalt: 0.04, gravel: 0.78, mud: 0.3 },
  sand: { asphalt: 0.08, gravel: 0.88, mud: 0.14 },
  grass: { asphalt: 0, gravel: 0.38, mud: 0.58 },
};

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 */
export class SkidVoice {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} dest
   */
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.dest = dest;
    this.ready = false;
    this._mix = { asphalt: 1, gravel: 0, mud: 0 };
    this.asphaltSrc = null;
    this.gravelSrc = null;
    this._build();
  }

  /**
   * Decode tire / gravel loops after audio unlock.
   */
  boot() {
    Promise.all([
      loadSample(this.ctx, "assets/sfx/skid-asphalt.mp3", 0.12),
      loadSample(this.ctx, "assets/sfx/road-gravel.mp3", 0.14),
    ]).then(([asphalt, gravel]) => {
      this._start("asphaltSrc", this.asphaltIn, asphalt);
      this._start("gravelSrc", this.gravelIn, gravel);
      this.ready = true;
    });
  }

  /**
   * Road rumble from speed; extra scrape only on a heavy yaw slide.
   * Signed driftAngle pans grit toward the travel-side door (AM3).
   *
   * @param {{
   *   slip?: number,
   *   speed?: number,
   *   surfaceId?: string,
   *   driftAngle?: number,
   *   onGround?: boolean,
   *   active?: boolean,
   *   surfaceDust?: number,
   *   bump?: number,
   *   shock?: number
   * }} s
   */
  setState(s) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    const live = s.active !== false && s.onGround !== false;
    const speed = s.speed || 0;
    const signedYaw = Number(s.driftAngle) || 0;
    const yaw = Math.abs(signedYaw);
    const slip = s.slip || 0;
    const target = MIX[s.surfaceId] || MIX.dirt;
    this._mix.asphalt += (target.asphalt - this._mix.asphalt) * 0.14;
    this._mix.gravel += (target.gravel - this._mix.gravel) * 0.14;
    this._mix.mud += (target.mud - this._mix.mud) * 0.14;

    const dust = s.surfaceDust != null ? s.surfaceDust : 0.25;
    const shock = s.shock || 0;
    const bump = s.bump || 0;
    // Landing shock briefly fattens road texture — sells the plant with tires.
    const rumble = 1 + dust * 0.62 + bump * 2.85 + shock * 1.35;
    const road = live && speed > 3.2 ? clamp((speed - 2.2) / 24, 0, 1) : 0;
    // Speak earlier on yaw/slip so the first Desert corner reads as a slide.
    const yawAmt = yaw > 0.055 ? clamp((yaw - 0.055) / 0.18, 0, 1) : 0;
    const slipAmt = slip > 0.09 ? clamp((slip - 0.09) / 0.34, 0, 1) : 0;
    const spdAmt = speed > 6 ? clamp((speed - 4) / 18, 0.35, 1) : 0;
    const skid = live ? yawAmt * Math.max(slipAmt, 0.38 * yawAmt) * spdAmt : 0;

    const a = this._mix.asphalt;
    const g = this._mix.gravel;
    const m = this._mix.mud;

    // Friend-demo beds: road rumble + scrape read at chase distance without
    // restoring the harsh cabin whistle the feel pass softened.
    this.asphaltGain.gain.setTargetAtTime((road * a * 0.17 + skid * a * 0.58) * rumble, now, 0.055);
    this.gravelGain.gain.setTargetAtTime((road * g * 0.36 + skid * g * 0.64) * rumble, now, 0.05);
    this.mudGain.gain.setTargetAtTime((road * m * 0.3 + skid * m * 0.5) * rumble, now, 0.075);

    // Surface EQ — asphalt brighter when sliding; mud stays dark.
    if (this.ashLp) {
      this.ashLp.frequency.setTargetAtTime(5400 + skid * 2000 + road * 700, now, 0.1);
    }
    if (this.ashPresence) {
      this.ashPresence.gain.setTargetAtTime(1.35 + skid * 3.6 + road * 0.7, now, 0.08);
    }
    if (this.grLp) {
      this.grLp.frequency.setTargetAtTime(4000 + skid * 1100 + dust * 700, now, 0.1);
    }
    if (this.mudLp) {
      this.mudLp.frequency.setTargetAtTime(500 + m * 90 + shock * 140, now, 0.12);
    }

    // AM3: gravel/mud spatialize to the door on the direction of travel.
    if (this.pan) {
      const loose = clamp(g + m * 0.85, 0, 1);
      const strength = skid * (0.5 + loose * 0.72);
      const pan = clamp((-signedYaw / 0.28) * strength, -0.95, 0.95);
      this.pan.pan.setTargetAtTime(pan, now, 0.06);
    }

    const aRate = clamp(0.78 + speed * 0.012 + skid * 0.16, 0.66, 1.55);
    const gRate = clamp(0.74 + speed * 0.014 + skid * 0.12 + bump * 0.09, 0.6, 1.58);
    if (this.asphaltSrc) this.asphaltSrc.playbackRate.setTargetAtTime(aRate, now, 0.09);
    if (this.gravelSrc) this.gravelSrc.playbackRate.setTargetAtTime(gRate, now, 0.09);
  }

  /**
   * Ramp tire loops to silence when the stage ends.
   * @param {number} [durationSec]
   */
  fadeOut(durationSec = 1.35) {
    if (!this.ready || !this.ctx) return;
    const now = this.ctx.currentTime;
    const dur = Math.max(0.25, durationSec);
    for (const g of [this.asphaltGain, this.gravelGain, this.mudGain]) {
      if (!g) continue;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(0.0001, now + dur);
    }
    if (this.pan) {
      this.pan.pan.cancelScheduledValues(now);
      this.pan.pan.setValueAtTime(this.pan.pan.value, now);
      this.pan.pan.linearRampToValueAtTime(0, now + Math.min(0.4, dur));
    }
  }

  _build() {
    const ctx = this.ctx;

    this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (this.pan) {
      this.pan.pan.value = 0;
      this.pan.connect(this.dest);
    }
    const out = this.pan || this.dest;

    this.asphaltIn = ctx.createGain();
    this.asphaltIn.gain.value = 1;
    const ashHp = ctx.createBiquadFilter();
    ashHp.type = "highpass";
    ashHp.frequency.value = 220;
    this.ashPresence = ctx.createBiquadFilter();
    this.ashPresence.type = "peaking";
    this.ashPresence.frequency.value = 2800;
    this.ashPresence.Q.value = 0.9;
    this.ashPresence.gain.value = 1.4;
    this.ashLp = ctx.createBiquadFilter();
    this.ashLp.type = "lowpass";
    this.ashLp.frequency.value = 6800;
    this.asphaltGain = ctx.createGain();
    this.asphaltGain.gain.value = 0;
    this.asphaltIn.connect(ashHp);
    ashHp.connect(this.ashPresence);
    this.ashPresence.connect(this.ashLp);
    this.ashLp.connect(this.asphaltGain);
    this.asphaltGain.connect(out);

    this.gravelIn = ctx.createGain();
    this.gravelIn.gain.value = 1;
    const grHp = ctx.createBiquadFilter();
    grHp.type = "highpass";
    grHp.frequency.value = 75;
    const grBody = ctx.createBiquadFilter();
    grBody.type = "lowshelf";
    grBody.frequency.value = 180;
    grBody.gain.value = 2.2;
    this.grLp = ctx.createBiquadFilter();
    this.grLp.type = "lowpass";
    this.grLp.frequency.value = 4600;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    this.gravelIn.connect(grHp);
    grHp.connect(grBody);
    grBody.connect(this.grLp);
    this.grLp.connect(this.gravelGain);
    this.gravelGain.connect(out);

    const mudHp = ctx.createBiquadFilter();
    mudHp.type = "highpass";
    mudHp.frequency.value = 48;
    this.mudLp = ctx.createBiquadFilter();
    this.mudLp.type = "lowpass";
    this.mudLp.frequency.value = 480;
    this.mudLp.Q.value = 0.75;
    this.mudGain = ctx.createGain();
    this.mudGain.gain.value = 0;
    this.gravelIn.connect(mudHp);
    mudHp.connect(this.mudLp);
    this.mudLp.connect(this.mudGain);
    this.mudGain.connect(out);
  }

  /**
   * @param {"asphaltSrc"|"gravelSrc"} key
   * @param {GainNode} node
   * @param {AudioBuffer|null} buf
   */
  _start(key, node, buf) {
    if (!buf) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(node);
    src.start();
    this[key] = src;
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
