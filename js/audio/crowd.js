/**
 * Trackside crowd beds — clap + cheer with pass-by Doppler.
 *
 * WHO THIS IS FOR: RallyAudio during a race.
 * WHAT IT DOES: synthesises subtle clap and sports-cheer loops, places a few
 *   PannerNodes on the nearest spectator clusters, and pitches them by closing
 *   speed (manual Doppler — browsers dropped PannerNode.dopplerFactor).
 * HOW IT CONNECTS: RallyAudio.updateCrowd(listener, velocity, crowdPoints).
 */

/** Speed of sound used for Doppler (m/s). Arcade exaggeration sits a bit low. */
const SOUND_SPEED = 280;
const EMITTERS = 3;
const MAX_RANGE = 72;

/**
 * @param {AudioContext} ctx
 * @param {AudioNode} dest
 */
export class CrowdVoice {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} dest
   */
  constructor(ctx, dest) {
    this.ctx = ctx;
    this.dest = dest;
    this.ready = false;
    /** @type {Array<{panner:PannerNode, clap:AudioBufferSourceNode, cheer:AudioBufferSourceNode, clapGain:GainNode, cheerGain:GainNode, clapRate:AudioParam, cheerRate:AudioParam, x:number, y:number, z:number, alive:boolean}>} */
    this._slots = [];
    this._clapBuf = null;
    this._cheerBuf = null;
    this._tmp = { x: 0, y: 0, z: 0 };
  }

  boot() {
    if (this.ready) return;
    const ctx = this.ctx;
    this._clapBuf = makeClapLoop(ctx);
    this._cheerBuf = makeCheerLoop(ctx);
    for (let i = 0; i < EMITTERS; i++) {
      const panner = ctx.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = 8;
      panner.maxDistance = MAX_RANGE;
      panner.rolloffFactor = 1.15;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 360;

      const clapGain = ctx.createGain();
      clapGain.gain.value = 0.0001;
      const cheerGain = ctx.createGain();
      cheerGain.gain.value = 0.0001;

      const clap = ctx.createBufferSource();
      clap.buffer = this._clapBuf;
      clap.loop = true;
      clap.playbackRate.value = 1;
      const cheer = ctx.createBufferSource();
      cheer.buffer = this._cheerBuf;
      cheer.loop = true;
      cheer.playbackRate.value = 1;

      clap.connect(clapGain);
      cheer.connect(cheerGain);
      clapGain.connect(panner);
      cheerGain.connect(panner);
      panner.connect(this.dest);

      try {
        clap.start();
        cheer.start();
      } catch {
        /* already started */
      }

      this._slots.push({
        panner,
        clap,
        cheer,
        clapGain,
        cheerGain,
        clapRate: clap.playbackRate,
        cheerRate: cheer.playbackRate,
        x: 0,
        y: 0,
        z: 0,
        alive: false,
      });
    }
    this.ready = true;
  }

  /**
   * @param {{x:number,y:number,z:number}} listener
   * @param {{x:number,y:number,z:number}} velocity world m/s
   * @param {Array<{x:number,y:number,z:number}>} crowdPoints
   * @param {number} [master=1] 0..1 from SFX bus / race mute
   */
  update(listener, velocity, crowdPoints, master = 1) {
    if (!this.ready || !listener) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const clusters = pickClusters(crowdPoints, listener, EMITTERS);

    for (let i = 0; i < this._slots.length; i++) {
      const slot = this._slots[i];
      const c = clusters[i];
      if (!c || master <= 0.001) {
        slot.alive = false;
        slot.clapGain.gain.setTargetAtTime(0.0001, now, 0.08);
        slot.cheerGain.gain.setTargetAtTime(0.0001, now, 0.08);
        continue;
      }

      slot.alive = true;
      slot.x = c.x;
      slot.y = c.y;
      slot.z = c.z;
      if (slot.panner.positionX) {
        slot.panner.positionX.setTargetAtTime(c.x, now, 0.05);
        slot.panner.positionY.setTargetAtTime(c.y, now, 0.05);
        slot.panner.positionZ.setTargetAtTime(c.z, now, 0.05);
      } else {
        slot.panner.setPosition(c.x, c.y, c.z);
      }

      const dx = c.x - listener.x;
      const dy = c.y - listener.y;
      const dz = c.z - listener.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const closing = (velocity.x * dx + velocity.y * dy + velocity.z * dz) / dist;
      // Approaching → higher pitch; fleeing → lower.
      const doppler = clamp(1 + closing / SOUND_SPEED, 0.86, 1.18);
      slot.clapRate.setTargetAtTime(doppler * (0.96 + (i % 3) * 0.02), now, 0.08);
      slot.cheerRate.setTargetAtTime(doppler * (0.94 + (i % 2) * 0.03), now, 0.1);

      const near = clamp(1 - dist / MAX_RANGE, 0, 1);
      const presence = near * near * master;
      slot.clapGain.gain.setTargetAtTime(0.0001 + presence * 0.11, now, 0.1);
      slot.cheerGain.gain.setTargetAtTime(0.0001 + presence * 0.09, now, 0.12);
    }
  }

  /**
   * Keep the AudioListener at the car/camera so HRTF matches the chase view.
   * @param {{x:number,y:number,z:number}} pos
   * @param {{x:number,y:number,z:number}} [fwd]
   * @param {{x:number,y:number,z:number}} [up]
   */
  setListener(pos, fwd, up) {
    if (!this.ready || !pos) return;
    const ctx = this.ctx;
    const L = ctx.listener;
    const now = ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, now, 0.04);
      L.positionY.setTargetAtTime(pos.y, now, 0.04);
      L.positionZ.setTargetAtTime(pos.z, now, 0.04);
    } else if (L.setPosition) {
      L.setPosition(pos.x, pos.y, pos.z);
    }
    if (fwd && up) {
      if (L.forwardX) {
        L.forwardX.setTargetAtTime(fwd.x, now, 0.04);
        L.forwardY.setTargetAtTime(fwd.y, now, 0.04);
        L.forwardZ.setTargetAtTime(fwd.z, now, 0.04);
        L.upX.setTargetAtTime(up.x, now, 0.04);
        L.upY.setTargetAtTime(up.y, now, 0.04);
        L.upZ.setTargetAtTime(up.z, now, 0.04);
      } else if (L.setOrientation) {
        L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
      }
    }
  }

  mute() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    for (let i = 0; i < this._slots.length; i++) {
      this._slots[i].clapGain.gain.setTargetAtTime(0.0001, now, 0.05);
      this._slots[i].cheerGain.gain.setTargetAtTime(0.0001, now, 0.05);
    }
  }
}

/**
 * @param {Array<{x:number,y:number,z:number}>} points
 * @param {{x:number,y:number,z:number}} listener
 * @param {number} count
 */
function pickClusters(points, listener, count) {
  if (!points || !points.length) return [];
  /** @type {Array<{x:number,y:number,z:number,d:number}>} */
  const scored = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const dx = p.x - listener.x;
    const dy = (p.y || 0) - listener.y;
    const dz = p.z - listener.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > MAX_RANGE) continue;
    scored.push({ x: p.x, y: p.y || 1.2, z: p.z, d });
  }
  scored.sort((a, b) => a.d - b.d);

  // Spread picks so three emitters are not the same pack.
  const out = [];
  for (let i = 0; i < scored.length && out.length < count; i++) {
    const c = scored[i];
    let ok = true;
    for (let j = 0; j < out.length; j++) {
      const o = out[j];
      const dx = c.x - o.x;
      const dz = c.z - o.z;
      if (dx * dx + dz * dz < 36) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(c);
  }
  return out;
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/**
 * Soft periodic hand-claps — noise bursts with a wooden transient.
 * @param {AudioContext} ctx
 */
function makeClapLoop(ctx) {
  const sr = ctx.sampleRate;
  const dur = 1.15;
  const n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  const claps = [0.05, 0.22, 0.38, 0.55, 0.72, 0.9];
  for (let i = 0; i < n; i++) d[i] = 0;
  for (let c = 0; c < claps.length; c++) {
    const start = Math.floor(claps[c] * sr);
    const len = Math.floor(0.045 * sr);
    for (let i = 0; i < len && start + i < n; i++) {
      const t = i / len;
      const env = Math.exp(-t * 14) * (1 - t * 0.2);
      const noise = (Math.random() * 2 - 1) * env;
      const tick = Math.sin((i / sr) * 2400 * Math.PI * 2) * env * 0.35;
      d[start + i] += (noise * 0.7 + tick) * 0.55;
    }
  }
  return buf;
}

/**
 * Distant sports-fan wash — band-limited noise with slow amplitude swell.
 * @param {AudioContext} ctx
 */
function makeCheerLoop(ctx) {
  const sr = ctx.sampleRate;
  const dur = 2.4;
  const n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const swell = 0.55 + 0.45 * Math.sin(t * 1.7) * Math.sin(t * 0.4 + 1.1);
    const raw = Math.random() * 2 - 1;
    lp = lp * 0.92 + raw * 0.08;
    const hiss = raw * 0.25 + lp * 0.75;
    const vowel = Math.sin(t * 220 * Math.PI * 2) * 0.08 + Math.sin(t * 340 * Math.PI * 2) * 0.05;
    d[i] = (hiss * 0.85 + vowel) * swell * 0.4;
  }
  return buf;
}
