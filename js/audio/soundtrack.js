/**
 * CD soundtrack — recorded 44.1 kHz stereo beds (not Sega’s album).
 *
 * WHO THIS IS FOR: the race loop and menus.
 * WHAT IT DOES: decodes MP3 beds into AudioBuffers, bakes a short
 *   end→start crossfade so loops are gapless, then plays them on a music
 *   bus like Saturn CD-DA under the engine PCM. EQ, compressor, and a
 *   light engine-sidechain duck keep the jazz-fusion bed present without
 *   masking the 3S-GTE.
 * HOW IT CONNECTS: RallyAudio.unlock() constructs this; game.js calls
 *   syncMusic(state, courseId); setState() drives live ducking.
 *
 * See assets/music/ATTRIBUTION.txt for licenses.
 */

/** Master after EQ. Beds are loudnorm’d to about −12 LUFS. */
const MUSIC_GAIN = 0.44;

/**
 * Per-disc linear trim. Loudnorm already matches stages; leave at 1.
 */
const DISC_TRIM = {
  title: 1,
  desert: 1,
  forest: 1,
  mountain: 1,
  lakeside: 1,
  result: 1,
};

/** Stage / menu discs. Paths are from the page root. */
const DISCS = {
  title: "assets/music/title.mp3?v=3",
  desert: "assets/music/desert.mp3?v=4",
  forest: "assets/music/forest.mp3?v=4",
  mountain: "assets/music/mountain.mp3?v=4",
  lakeside: "assets/music/lakeside.mp3?v=4",
  result: "assets/music/result.mp3?v=4",
};

const FADE_SEC = 0.55;
/** End of file mixed onto the start so BufferSource loops do not click. */
const LOOP_XFADE_SEC = 0.28;

/**
 * Race / countdown / pause use the stage disc. Menus stay on the title bed.
 * @param {string} state
 * @param {string} courseId
 */
function trackIdFor(state, courseId) {
  if (state === "result") return "result";
  if (state === "countdown" || state === "race" || state === "paused") {
    return DISCS[courseId] ? courseId : "desert";
  }
  return "title";
}

export class CdSoundtrack {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} dest
   */
  constructor(ctx, dest) {
    this.ctx = ctx;
    this._state = "title";
    /** @type {string} disc the game last asked for (may still be decoding) */
    this._wanted = "";
    this.current = "";
    this.ready = false;

    this.hp = ctx.createBiquadFilter();
    this.hp.type = "highpass";
    this.hp.frequency.value = 85;
    this.hp.Q.value = 0.7;

    this.mud = ctx.createBiquadFilter();
    this.mud.type = "peaking";
    this.mud.frequency.value = 320;
    this.mud.Q.value = 0.8;
    this.mud.gain.value = -2.4;

    this.mid = ctx.createBiquadFilter();
    this.mid.type = "peaking";
    this.mid.frequency.value = 3200;
    this.mid.Q.value = 0.85;
    this.mid.gain.value = 2.4;

    this.air = ctx.createBiquadFilter();
    this.air.type = "highshelf";
    this.air.frequency.value = 7200;
    this.air.gain.value = 1.2;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 12;
    this.comp.ratio.value = 2.2;
    this.comp.attack.value = 0.012;
    this.comp.release.value = 0.22;

    this.out = ctx.createGain();
    this.out.gain.value = MUSIC_GAIN;
    /** Player music fader 0–1, applied on top of the Saturn duck. */
    this.userVol = 1;
    this._duck = 1;

    this.hp.connect(this.mud);
    this.mud.connect(this.mid);
    this.mid.connect(this.air);
    this.air.connect(this.comp);
    this.comp.connect(this.out);
    this.out.connect(dest);

    /** @type {Record<string, AudioBuffer>} */
    this._buffers = {};
    /** @type {Record<string, Promise<AudioBuffer>>} */
    this._loading = {};
    /** @type {{src: AudioBufferSourceNode, level: GainNode, id: string} | null} */
    this._voice = null;
    /** @type {{src: AudioBufferSourceNode, level: GainNode, id: string}[]} */
    this._dying = [];
    this._warmingRest = false;
  }

  /**
   * Decode the title disc only. Stage beds wait for warmIdle() so the first
   * click cannot decode ~60 MB of MP3 and freeze Chrome.
   */
  boot() {
    this.ready = true;
    this._load("title");
  }

  /**
   * One remaining disc at a time, after the title bed is already playing.
   */
  warmIdle() {
    if (this._warmingRest) return;
    this._warmingRest = true;
    const rest = Object.keys(DISCS).filter((id) => id !== "title");
    let i = 0;
    const step = () => {
      if (i >= rest.length) return;
      const id = rest[i++];
      this._load(id)
        .catch(() => {})
        .finally(() => setTimeout(step, 480));
    };
    setTimeout(step, 700);
  }

  /**
   * Fetch + decode one disc. Starts playback if this id is still wanted.
   * @param {string} id
   * @returns {Promise<AudioBuffer>}
   */
  _load(id) {
    if (this._buffers[id]) return Promise.resolve(this._buffers[id]);
    if (this._loading[id]) return this._loading[id];
    this._loading[id] = (async () => {
      const res = await fetch(DISCS[id]);
      if (!res.ok) throw new Error("music fetch " + id);
      const raw = await res.arrayBuffer();
      const decoded = await decodeAudio(this.ctx, raw);
      // Do not sample-walk a 3–6 min stereo buffer on the click that
      // unlocked audio — that was a Chrome "Page Unresponsive" stall.
      this._buffers[id] = decoded;
      if (this._wanted === id && this.current !== id) this._crossfadeTo(id);
      return decoded;
    })().catch((err) => {
      delete this._loading[id];
      console.warn("CD soundtrack: failed to load " + id, err);
      throw err;
    });
    return this._loading[id];
  }

  /**
   * @param {string} state
   * @param {string} courseId
   */
  sync(state, courseId) {
    if (!this.ready) return;
    this._state = state;
    this.setDrive({ state, throttle: 0, rpm: 0 });
    this.play(trackIdFor(state, courseId));
  }

  /**
   * Saturn mix: music bed recedes a little under a loaded engine, comes back on lift.
   * @param {{state?:string, throttle?:number, rpm?:number}} s
   */
  setDrive(s) {
    if (!this.ready) return;
    const state = s.state || this._state;
    this._state = state;
    let duck = 1;
    if (state === "paused") {
      // Keep the bed audible so the pause MUSIC slider can be judged.
      duck = 0.7;
    } else if (state === "race") {
      const throttle = clamp(s.throttle || 0, 0, 1);
      const rpmN = clamp(((s.rpm || 2000) - 1800) / 5200, 0, 1);
      const load = throttle * 0.7 + rpmN * 0.3;
      duck = 0.92 - load * 0.18;
    } else if (state === "countdown") {
      duck = 0.94;
    } else if (state === "result") {
      duck = 0.98;
    }
    const tau = state === "race" ? 0.22 : 0.16;
    this._duck = duck;
    this._applyMix(tau);
  }

  /**
   * Pause-menu MUSIC slider. 1 = default mix, 0 = mute.
   * @param {number} v
   */
  setUserVolume(v) {
    this.userVol = clamp(v, 0, 1);
    if (!this.ready) return;
    this._applyMix(0.04);
  }

  /**
   * @param {number} tau
   */
  _applyMix(tau) {
    const g = MUSIC_GAIN * this._duck * this.userVol;
    this.out.gain.setTargetAtTime(g, this.ctx.currentTime, tau);
  }

  /**
   * Crossfade to a disc. Same id stays running so the loop does not restart.
   * Queues if the buffer is still decoding.
   * @param {string} id
   */
  play(id) {
    if (!this.ready || !DISCS[id]) return;
    this._wanted = id;
    if (id === this.current) return;
    if (!this._buffers[id]) {
      this._load(id);
      return;
    }
    this._crossfadeTo(id);
  }

  /**
   * @param {string} id
   */
  _crossfadeTo(id) {
    if (id === this.current || !this._buffers[id]) return;
    const now = this.ctx.currentTime;
    if (this._voice) {
      this._stopVoice(this._voice, now, FADE_SEC);
      this._dying.push(this._voice);
      this._voice = null;
    }
    this._pruneDying();
    this.current = id;
    const src = this.ctx.createBufferSource();
    src.buffer = this._buffers[id];
    src.loop = true;
    const dur = src.buffer.duration;
    src.loopStart = Math.min(0.04, dur * 0.002);
    src.loopEnd = Math.max(src.loopStart + 0.5, dur - 0.04);
    const level = this.ctx.createGain();
    const trim = DISC_TRIM[id] || 1;
    level.gain.setValueAtTime(0.0001, now);
    level.gain.linearRampToValueAtTime(trim, now + FADE_SEC);
    src.connect(level);
    level.connect(this.hp);
    src.start(now);
    this._voice = { src, level, id };
  }

  /**
   * @param {{src: AudioBufferSourceNode, level: GainNode, id: string}} voice
   * @param {number} now
   * @param {number} fade
   */
  _stopVoice(voice, now, fade) {
    voice.level.gain.cancelScheduledValues(now);
    voice.level.gain.setValueAtTime(Math.max(0.0001, voice.level.gain.value), now);
    voice.level.gain.linearRampToValueAtTime(0.0001, now + fade);
    try {
      voice.src.stop(now + fade + 0.04);
    } catch {
      /* already stopped */
    }
  }

  /**
   * Keep a few fading voices so BufferSources can finish their stop() ramp.
   */
  _pruneDying() {
    if (this._dying.length > 4) this._dying.splice(0, this._dying.length - 4);
  }

  stop() {
    const now = this.ctx.currentTime;
    this._wanted = "";
    this.current = "";
    if (this._voice) {
      this._stopVoice(this._voice, now, 0.08);
      this._voice = null;
    }
  }
}

/**
 * Decode MP3 bytes. Copies the buffer because decodeAudioData detaches it.
 * @param {AudioContext} ctx
 * @param {ArrayBuffer} data
 * @returns {Promise<AudioBuffer>}
 */
function decodeAudio(ctx, data) {
  const copy = data.slice(0);
  try {
    const p = ctx.decodeAudioData(copy);
    if (p && typeof p.then === "function") return p;
  } catch {
    /* older WebKit wants the callback form */
  }
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(data.slice(0), resolve, reject);
  });
}

/**
 * Mix the last `fadeSec` onto the start and drop that tail so a full-buffer
 * loop is continuous (no MediaElement gap / MP3 encoder padding click).
 * @param {AudioContext} ctx
 * @param {AudioBuffer} src
 * @param {number} fadeSec
 * @returns {AudioBuffer}
 */
function bakeLoop(ctx, src, fadeSec) {
  const sr = src.sampleRate;
  const fade = Math.min(
    Math.floor(fadeSec * sr),
    Math.floor(src.length / 6)
  );
  if (fade < 64) return src;
  const outLen = src.length - fade;
  const out = ctx.createBuffer(src.numberOfChannels, outLen, sr);
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    const a = src.getChannelData(ch);
    const b = out.getChannelData(ch);
    for (let i = 0; i < outLen; i++) {
      if (i < fade) {
        const t = i / fade;
        b[i] = a[i] * t + a[src.length - fade + i] * (1 - t);
      } else {
        b[i] = a[i];
      }
    }
  }
  return out;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
