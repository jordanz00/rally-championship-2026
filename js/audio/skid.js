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

import { loadSample } from "./bank.js?v=2";

/** How the two recorded beds mix for each driving surface. */
const MIX = {
  tarmac: { asphalt: 1, gravel: 0.05, mud: 0 },
  cobble: { asphalt: 0.7, gravel: 0.35, mud: 0 },
  gravel: { asphalt: 0.08, gravel: 1, mud: 0 },
  mud: { asphalt: 0, gravel: 0.25, mud: 0.9 },
  dirt: { asphalt: 0.05, gravel: 0.75, mud: 0.28 },
  sand: { asphalt: 0.1, gravel: 0.85, mud: 0.12 },
  grass: { asphalt: 0, gravel: 0.4, mud: 0.55 },
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
    this._mix.asphalt += (target.asphalt - this._mix.asphalt) * 0.12;
    this._mix.gravel += (target.gravel - this._mix.gravel) * 0.12;
    this._mix.mud += (target.mud - this._mix.mud) * 0.12;

    const dust = s.surfaceDust != null ? s.surfaceDust : 0.25;
    const rumble = 1 + dust * 0.5 + (s.bump || 0) * 2.4 + (s.shock || 0) * 0.7;
    const road = live && speed > 4 ? clamp((speed - 3) / 28, 0, 1) : 0;
    const yawAmt = yaw > 0.09 ? clamp((yaw - 0.09) / 0.22, 0, 1) : 0;
    const slipAmt = slip > 0.16 ? clamp((slip - 0.16) / 0.4, 0, 1) : 0;
    const spdAmt = speed > 8 ? clamp((speed - 6) / 22, 0.28, 1) : 0;
    const skid = live ? yawAmt * Math.max(slipAmt, 0.35 * yawAmt) * spdAmt : 0;

    const a = this._mix.asphalt;
    const g = this._mix.gravel;
    const m = this._mix.mud;

    this.asphaltGain.gain.setTargetAtTime((road * a * 0.09 + skid * a * 0.38) * rumble, now, 0.07);
    this.gravelGain.gain.setTargetAtTime((road * g * 0.22 + skid * g * 0.42) * rumble, now, 0.06);
    this.mudGain.gain.setTargetAtTime((road * m * 0.2 + skid * m * 0.36) * rumble, now, 0.09);

    // AM3: gravel/mud spatialize to the door on the direction of travel.
    // Vehicle driftAngle: + = body-left slip → StereoPanner −1 = left ear.
    if (this.pan) {
      const loose = clamp(g + m * 0.85, 0, 1);
      const strength = skid * (0.35 + loose * 0.65);
      const pan = clamp((-signedYaw / 0.32) * strength, -0.92, 0.92);
      this.pan.pan.setTargetAtTime(pan, now, 0.07);
    }

    const aRate = clamp(0.82 + speed * 0.01 + skid * 0.12, 0.7, 1.45);
    const gRate = clamp(0.78 + speed * 0.012 + skid * 0.08, 0.65, 1.5);
    if (this.asphaltSrc) this.asphaltSrc.playbackRate.setTargetAtTime(aRate, now, 0.1);
    if (this.gravelSrc) this.gravelSrc.playbackRate.setTargetAtTime(gRate, now, 0.1);
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
    ashHp.frequency.value = 280;
    const ashLp = ctx.createBiquadFilter();
    ashLp.type = "lowpass";
    ashLp.frequency.value = 6200;
    this.asphaltGain = ctx.createGain();
    this.asphaltGain.gain.value = 0;
    this.asphaltIn.connect(ashHp);
    ashHp.connect(ashLp);
    ashLp.connect(this.asphaltGain);
    this.asphaltGain.connect(out);

    this.gravelIn = ctx.createGain();
    this.gravelIn.gain.value = 1;
    const grHp = ctx.createBiquadFilter();
    grHp.type = "highpass";
    grHp.frequency.value = 90;
    const grLp = ctx.createBiquadFilter();
    grLp.type = "lowpass";
    grLp.frequency.value = 4800;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    this.gravelIn.connect(grHp);
    grHp.connect(grLp);
    grLp.connect(this.gravelGain);
    this.gravelGain.connect(out);

    const mudHp = ctx.createBiquadFilter();
    mudHp.type = "highpass";
    mudHp.frequency.value = 60;
    this.mudLp = ctx.createBiquadFilter();
    this.mudLp.type = "lowpass";
    this.mudLp.frequency.value = 520;
    this.mudLp.Q.value = 0.7;
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
