/**
 * Engine, surfaces, and CD soundtrack — Web Audio.
 *
 * WHO THIS IS FOR: the game loop.
 * WHAT IT DOES: recorded 44.1 kHz powertrain and tire beds, checkpoint
 *   blips from a real rev, and a jazz-fusion music bus mixed Saturn-style
 *   under the PCM. A shared SFX low-pass keeps the mix from going shrill.
 * HOW IT CONNECTS: game.js calls setCar(), setState(), and syncMusic().
 *
 * See assets/sfx/ATTRIBUTION.txt and assets/music/ATTRIBUTION.txt.
 */

import { CdSoundtrack } from "./soundtrack.js?v=136";
import { PowertrainVoice } from "./powertrain.js?v=28";
import { SkidVoice } from "./skid.js?v=9";
import { loadSample, playHit, playClip } from "./bank.js?v=3";
import { CrowdVoice } from "./crowd.js?v=5";
import { ReverbZones, zoneFromSample } from "./reverb-zones.js?v=1";

/** Default SFX bus level (slider at 100%). */
const SFX_GAIN = 0.64;
/** Navigator VO sits off the SFX compressor so calls stay intelligible. */
const NAV_GAIN = 0.82;
const VOL_MUSIC_KEY = "rally-vol-music";
const VOL_SFX_KEY = "rally-vol-sfx";
const VOL_NAV_KEY = "rally-vol-navigator";
const NAV_CLIPS = [
  "easy-left",
  "easy-right",
  "medium-left",
  "medium-right",
  "hard-left",
  "hard-right",
  "hairpin-left",
  "hairpin-right",
  "jump",
  "long",
  "maybe",
  "finish",
  "count-3",
  "count-2",
  "count-1",
  "count-go",
];
/** Grade clips that may chain long / maybe qualifiers. */
const NAV_GRADE = new Set([
  "easy-left",
  "easy-right",
  "medium-left",
  "medium-right",
  "hard-left",
  "hard-right",
  "hairpin-left",
  "hairpin-right",
  "jump",
  "finish",
]);

/**
 * True in Cursor / VS Code Simple Browser (and `?mute=1`).
 * Work previews should stay silent; Chrome at 127.0.0.1 still plays.
 * Escape hatch: `?audio=on`.
 */
export function isWorkPreview() {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search);
    const audio = (q.get("audio") || "").toLowerCase();
    if (audio === "on" || audio === "1") return false;
    const mute = (q.get("mute") || "").toLowerCase();
    if (mute === "1" || mute === "true") return true;
    const ua = navigator.userAgent || "";
    if (/Cursor\//i.test(ua)) return true;
    if (/Electron/i.test(ua) && /Cursor|VSCode|Code\//i.test(ua)) return true;
    // Cursor Simple Browser is Electron; Chrome playtests on :8765 are not.
    const local = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    if (/Electron/i.test(ua) && local) return true;
    const brands = navigator.userAgentData && navigator.userAgentData.brands;
    if (Array.isArray(brands) && brands.some((b) => /cursor/i.test(b.brand || ""))) {
      return true;
    }
    if (typeof window.acquireVsCodeApi === "function") return true;
  } catch {
    /* private / odd UA */
  }
  return false;
}

export class RallyAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.cd = null;
    this.voice = null;
    this.skid = null;
    this._musicKey = "";
    this._pendingCar = "celica";
    this._screen = "title";
    this.musicVol = loadVol(VOL_MUSIC_KEY, 1);
    this.sfxVol = loadVol(VOL_SFX_KEY, 1);
    this.navVol = loadVol(VOL_NAV_KEY, 1);
    // Old loadVol treated missing localStorage as 0 and the pause slider
    // then wrote that mute. A stored 0 is almost never a deliberate mute
    // from a first-run session — restore so the new discs are audible.
    if (this.musicVol === 0) this.musicVol = 1;
    this._workMute = isWorkPreview();
    if (this._workMute) {
      this.musicVol = 0;
      this.sfxVol = 0;
      this.navVol = 0;
    } else {
      this._bindFirstGesture();
    }
    this._sfxPreviewAt = 0;
    this._visBound = false;
    this._kickAt = 0;
    this._wallAt = 0;
    this._carAt = 0;
    this._landAt = 0;
    /** Last landing recipe index — avoid playing the same mix twice in a row. */
    this._landRecipe = -1;
    /** Finish / DNF — looping beds stay muted until the next stage. */
    this._raceLoopsMuted = false;
    /** @type {Record<string, AudioBuffer|null>} */
    this._hits = {};
    /** @type {Record<string, AudioBuffer|null>} */
    this._navClips = {};
    this._navBooted = false;
    /** @type {AudioBufferSourceNode|null} */
    this._navSrc = null;
    this._navPlayingKey = "";
    /** @type {string[]} queued long / grade / maybe phrase */
    this._navQueue = [];
    /** Start-grid 3-2-1-GO — separate so a late pace decode cannot cut GO. */
    this._countSrc = null;
    /** @type {CrowdVoice|null} */
    this.crowd = null;
    this._sfxReady = false;
    this._unlocking = false;
  }

  /**
   * First gesture: resume the context and start the title bed only.
   * Decoding every stage MP3 + baking loop tails here froze Chrome
   * ("Page Unresponsive") on PRESS START.
   */
  unlock() {
    if (this._workMute) return;
    if (this.ready) {
      this._kickContext();
      return;
    }
    if (this._unlocking) {
      this._kickContext();
      return;
    }
    this._unlocking = true;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this._kickContext();

    const music = ctx.createGain();
    music.gain.value = 1;
    music.connect(ctx.destination);
    this.cd = new CdSoundtrack(ctx, music);
    try {
      this.cd.boot();
    } catch (err) {
      console.warn("CD soundtrack failed", err);
      this.cd = null;
    }
    if (this.cd) {
      this.cd.setUserVolume(this.musicVol);
      this.cd.sync(this._screen || "title", "");
    }
    this.ready = true;
    this._bindVisibility();
    this._ensureNavBus();
    const later =
      typeof requestIdleCallback === "function"
        ? (fn) => requestIdleCallback(fn, { timeout: 1600 })
        : (fn) => setTimeout(fn, 480);
    later(() => this._bootSfxGraph());
  }

  /**
   * Engine / tires / hits after music is already playing.
   */
  _bootSfxGraph() {
    if (this._sfxReady || !this.ctx || this._workMute) return;
    this._sfxReady = true;
    const ctx = this.ctx;

    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 55;
    hp.Q.value = 0.65;

    const sfxMerge = ctx.createGain();
    sfxMerge.gain.value = 1;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 9800;
    lp.Q.value = 0.6;

    const airCut = ctx.createBiquadFilter();
    airCut.type = "peaking";
    airCut.frequency.value = 4500;
    airCut.Q.value = 0.85;
    airCut.gain.value = -2.2;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 2.2;
    comp.attack.value = 0.008;
    comp.release.value = 0.16;

    const sfx = ctx.createGain();
    sfx.gain.value = SFX_GAIN * this.sfxVol;
    hp.connect(lp);
    lp.connect(airCut);
    airCut.connect(comp);
    comp.connect(sfx);
    sfx.connect(ctx.destination);
    this.master = sfx;
    this._sfxIn = sfxMerge;
    this._sfxHp = hp;
    this._sfxLp = lp;
    // Impacts / landings bypass the surface high-pass (180–320 Hz) that was
    // killing body thumps — join at the shared low-pass with a gentle HP.
    const impactIn = ctx.createGain();
    impactIn.gain.value = 1;
    const impactHp = ctx.createBiquadFilter();
    impactHp.type = "highpass";
    impactHp.frequency.value = 42;
    impactHp.Q.value = 0.55;
    impactIn.connect(impactHp);
    impactHp.connect(lp);
    this._impactIn = impactIn;
    this._reverb = new ReverbZones(ctx, hp);
    this._reverb.connectSource(sfxMerge);

    this.voice = new PowertrainVoice(ctx, sfxMerge);
    this.voice.setCar(this._pendingCar);
    this.voice.boot();
    this.skid = new SkidVoice(ctx, sfxMerge);
    this.skid.boot();
    this.crowd = new CrowdVoice(ctx, sfxMerge);
    this.crowd.boot();
    this._ensureNavBus();
    this._initWind();
    this._bootHits();
    this._hits.noise = makeNoiseBuffer(ctx, 0.18);
    this._hits.thump = makeNoiseBuffer(ctx, 0.28, 0.55);
    // Multi-band land buffers — body knock + tire plant; impact bus keeps bass.
    this._hits.landSoftPool = [
      makeLandNoise(ctx, 0.32, "soft"),
      makeLandNoise(ctx, 0.28, "soft"),
      makeLandNoise(ctx, 0.36, "soft"),
      makeLandNoise(ctx, 0.26, "soft"),
    ];
    this._hits.landMidPool = [
      makeLandNoise(ctx, 0.2, "mid"),
      makeLandNoise(ctx, 0.18, "mid"),
      makeLandNoise(ctx, 0.22, "mid"),
      makeLandNoise(ctx, 0.16, "mid"),
    ];
    this._hits.landHardPool = [
      makeLandNoise(ctx, 0.12, "hard"),
      makeLandNoise(ctx, 0.1, "hard"),
      makeLandNoise(ctx, 0.14, "hard"),
      makeLandNoise(ctx, 0.11, "hard"),
    ];
    this._hits.landScrapePool = [
      makeLandNoise(ctx, 0.18, "scrape"),
      makeLandNoise(ctx, 0.15, "scrape"),
      makeLandNoise(ctx, 0.2, "scrape"),
    ];
    this._hits.landSoft = this._hits.landSoftPool[0];
    this._hits.landMid = this._hits.landMidPool[0];
    this._hits.landHard = this._hits.landHardPool[0];
    this._hits.landScrape = this._hits.landScrapePool[0];
  }

  /**
   * Browsers start AudioContext as "suspended" until a user gesture calls resume().
   * Also kicks a context that Chrome parked after a long main-thread stall.
   */
  _kickContext() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state !== "suspended" && ctx.state !== "interrupted") return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - this._kickAt < 250) return;
    this._kickAt = now;
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* autoplay still blocked — next click retries */
    }
  }

  /**
   * First click / key is the only moment Chrome will let us resume the context.
   * Title-screen PRESS START already calls unlock(); this covers clicks that
   * never go through _leaveTitle (garage drop, volume slider, etc.).
   */
  _bindFirstGesture() {
    if (typeof window === "undefined") return;
    const go = () => {
      try {
        this.unlock();
      } catch {
        /* autoplay still blocked */
      }
    };
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
  }

  /**
   * Resume the mix when the tab comes back (Safari often suspends in the background).
   */
  _bindVisibility() {
    if (this._visBound || typeof document === "undefined") return;
    this._visBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this._kickContext();
    });
  }

  /**
   * Cabin rush as speed builds — arcade, not a wind tunnel recording.
   */
  _initWind() {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 1.15);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 780;
    bp.Q.value = 0.65;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp);
    bp.connect(g);
    g.connect(this._sfxIn);
    src.start();
    this._windFilt = bp;
    this._windGain = g;
  }

  _bootHits() {
    loadSample(this.ctx, "assets/sfx/checkpoint.mp3").then((buf) => {
      this._hits.checkpoint = buf;
    });
    loadSample(this.ctx, "assets/sfx/overrun.mp3").then((buf) => {
      this._hits.overrun = buf;
    });
    loadSample(this.ctx, "assets/sfx/skid-asphalt.mp3").then((buf) => {
      this._hits.chirp = buf;
    });
    loadSample(this.ctx, "assets/sfx/road-gravel.mp3").then((buf) => {
      this._hits.gravel = buf;
    });
  }

  /**
   * Navigator bus + clip decode as soon as the context exists so the first
   * corner is not silent while engine/tire beds are still booting.
   */
  _ensureNavBus() {
    if (!this.ctx || this._workMute) return;
    if (!this._navGain) {
      const nav = this.ctx.createGain();
      nav.gain.value = NAV_GAIN * this.navVol;
      nav.connect(this.ctx.destination);
      this._navGain = nav;
    }
    this._bootNavClips();
  }

  _bootNavClips() {
    if (this._navBooted || !this.ctx) return;
    this._navBooted = true;
    for (const key of NAV_CLIPS) {
      loadSample(this.ctx, `assets/sfx/nav/${key}.mp3?v=6`).then((buf) => {
        this._navClips[key] = buf;
      });
    }
  }

  /**
   * Play a recorded co-driver line. Optional long / maybe chain (AM3 style).
   * Stops the previous call so phrases never stack.
   * @param {string} key grade or jump clip id
   * @param {{long?:boolean, maybe?:boolean}} [opts]
   * @returns {boolean}
   */
  paceCall(key, opts = {}) {
    if (!this.ready || this._workMute || this.navVol <= 0.001) return false;
    if (!NAV_GRADE.has(key)) return false;
    if (!this._navGain) return false;
    this._kickContext();

    /** @type {string[]} */
    const queue = [];
    // Finish is a one-shot — never chain long/maybe qualifiers.
    if (key !== "finish" && opts.long && this._navClips.long) queue.push("long");
    queue.push(key);
    if (key !== "finish" && opts.maybe && this._navClips.maybe) queue.push("maybe");

    // Grade must be decoded; qualifiers are optional until their buffers land.
    if (!this._navClips[key]) return false;

    const phraseKey = queue.join("+");
    // Same phrase already playing — do not restart every frame while buffers load.
    if (this._navSrc && this._navPlayingKey === phraseKey) return true;

    if (this._navSrc) {
      try {
        this._navSrc.stop();
      } catch {
        /* already ended */
      }
      this._navSrc = null;
    }
    this._navQueue = queue.slice(1);
    this._navPlayingKey = phraseKey;
    return this._playNavClip(queue[0], phraseKey);
  }

  /**
   * @param {string} key
   * @param {string} phraseKey
   * @returns {boolean}
   */
  _playNavClip(key, phraseKey) {
    const buf = this._navClips[key];
    if (!buf || !this._navGain) return false;
    this._navSrc = playClip(this.ctx, this._navGain, buf, { gain: 1 });
    if (!this._navSrc) return false;
    this._navSrc.onended = () => {
      if (this._navPlayingKey !== phraseKey) return;
      const next = this._navQueue.shift();
      if (next) {
        this._playNavClip(next, phraseKey);
        return;
      }
      this._navPlayingKey = "";
      this._navSrc = null;
    };
    return true;
  }

  /**
   * Bind the player car's real engine layout (turbo I4 vs NA V6).
   * @param {string} id
   */
  setCar(id) {
    this._pendingCar = id || "celica";
    if (this.ready && this.voice) this.voice.setCar(this._pendingCar);
  }

  /**
   * Pause-menu MUSIC slider. 0 = mute, 1 = default mix.
   * @param {number} v
   */
  setMusicVolume(v) {
    this.musicVol = clamp01(v);
    if (!this._workMute) saveVol(VOL_MUSIC_KEY, this.musicVol);
    if (this.cd) this.cd.setUserVolume(this.musicVol);
  }

  /**
   * Pause-menu SFX slider. Covers engine, tires, hits, and crowd — not navigator.
   * @param {number} v
   */
  setSfxVolume(v) {
    this.sfxVol = clamp01(v);
    if (!this._workMute) saveVol(VOL_SFX_KEY, this.sfxVol);
    if (this.ready && this.master && this.ctx) {
      this.master.gain.setTargetAtTime(
        SFX_GAIN * this.sfxVol,
        this.ctx.currentTime,
        0.04
      );
    }
  }

  /**
   * Pause-menu NAVIGATOR slider. Recorded VO, not the SFX compressor.
   * @param {number} v
   */
  setNavVolume(v) {
    this.navVol = clamp01(v);
    if (!this._workMute) saveVol(VOL_NAV_KEY, this.navVol);
    if (this.ready && this._navGain && this.ctx) {
      this._navGain.gain.setTargetAtTime(
        NAV_GAIN * this.navVol,
        this.ctx.currentTime,
        0.04
      );
    }
  }

  /**
   * Short chirp while dragging the SFX slider so the level is audible.
   */
  previewSfx() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this._sfxPreviewAt < 0.14) return;
    this._sfxPreviewAt = now;
    this.paceBeep(1);
  }

  /**
   * Saturn mix: CD guitar bed follows screen, ducked in pause / under the engine.
   * @param {string} state
   * @param {string} courseId
   */
  syncMusic(state, courseId) {
    if (!this.ready || !this.cd) return;
    this._kickContext();
    this._screen = state;
    const key = `${state}:${courseId || ""}`;
    if (key !== this._musicKey) {
      this._musicKey = key;
      this.cd.sync(state, courseId);
    }
  }

  /**
   * @param {{rpm:number,throttle:number,slip:number,speed:number,surfaceDust?:number,surfaceId?:string,driftAngle?:number,onGround?:boolean,carId?:string,gear?:number,active?:boolean,reverbZone?:string,inTunnel?:boolean,scenery?:string}} s
   */
  setState(s) {
    if (!this.ready || !this.voice) return;
    this._kickContext();
    const live = s.active !== false && !this._raceLoopsMuted;
    const mix = live ? s : { ...s, active: false, throttle: 0, speed: 0, slip: 0 };
    this.voice.setState(mix);
    if (this.skid) this.skid.setState(mix);
    if (this._reverb) {
      const zone = s.reverbZone || (s.inTunnel ? "tunnel" : "open");
      this._reverb.setZone(zone, s.speed || 0);
    }
    if (this._sfxHp && this.ctx && s.surfaceId) {
      const now = this.ctx.currentTime;
      const id = String(s.surfaceId);
      // Keep cabin/road beds dark enough for body weight — old 180–320 Hz
      // floors erased landings and suspension knocks on the shared bus.
      let hpHz = 72;
      if (/mud|sand|grass|dirt/.test(id)) hpHz = 55;
      else if (/tarmac|cobble/.test(id)) hpHz = 95;
      else if (/gravel/.test(id)) hpHz = 70;
      this._sfxHp.frequency.setTargetAtTime(hpHz, now, 0.2);
    }
    if (this._sfxLp && this.ctx) {
      const now = this.ctx.currentTime;
      const spd = mix.speed || 0;
      const open = live ? Math.min(1, spd / 42) : 0;
      this._sfxLp.frequency.setTargetAtTime(7200 + open * 3200, now, 0.15);
    }
    if (this._windGain && this.ctx) {
      const spd = mix.speed || 0;
      /**
       * Cabin rush: open earlier (~22 km/h) and hit a clear hiss by ~120 km/h.
       */
      const air = live ? Math.min(1.15, Math.max(0, (spd - 6) / 28)) : 0;
      const now = this.ctx.currentTime;
      this._windGain.gain.setTargetAtTime(air * 0.28 * this.sfxVol, now, 0.08);
      if (this._windFilt) {
        this._windFilt.frequency.setTargetAtTime(420 + spd * 38, now, 0.12);
      }
    }
    if (this.cd) {
      this.cd.setDrive({
        state: this._screen,
        throttle: live ? s.throttle : 0,
        rpm: s.rpm,
      });
    }
  }

  /**
   * Pass-by clap / cheer with Doppler. Call each race frame after setState.
   * @param {{x:number,y:number,z:number}} listenerPos
   * @param {{x:number,y:number,z:number}} listenerVel
   * @param {Array<{x:number,y:number,z:number}>} crowdPoints
   * @param {{x:number,y:number,z:number}} [fwd]
   * @param {{x:number,y:number,z:number}} [up]
   */
  updateCrowd(listenerPos, listenerVel, crowdPoints, fwd, up) {
    if (!this.ready || !this.crowd) return;
    if (this._raceLoopsMuted || this._workMute || this.sfxVol <= 0.001) {
      this.crowd.mute();
      return;
    }
    this.crowd.setListener(listenerPos, fwd, up);
    this.crowd.update(listenerPos, listenerVel || { x: 0, y: 0, z: 0 }, crowdPoints || [], this.sfxVol);
  }

  /**
   * Fade engine, tire, and cabin loops when crossing the finish gantry.
   * One-shot stings (GO, game over) stay on the bus — only loops ramp down.
   * @param {number} [durationSec]
   */
  fadeOutRaceLoops(durationSec = 1.35) {
    if (!this.ready || this._raceLoopsMuted) return;
    this._raceLoopsMuted = true;
    const dur = Math.max(0.25, durationSec);
    if (this.voice) this.voice.fadeOut(dur);
    if (this.skid) this.skid.fadeOut(dur);
    if (this.crowd) this.crowd.mute();
    if (this._windGain && this.ctx) {
      const now = this.ctx.currentTime;
      this._windGain.gain.cancelScheduledValues(now);
      this._windGain.gain.setValueAtTime(this._windGain.gain.value, now);
      this._windGain.gain.linearRampToValueAtTime(0, now + dur);
    }
  }

  /** Re-enable looping beds at the next countdown / stage load. */
  restoreRaceLoops() {
    this._raceLoopsMuted = false;
  }

  beep() {
    if (!this.ready) return;
    playHit(this.ctx, this._sfxIn, this._hits.checkpoint, {
      gain: 0.42,
      rate: 1,
      dur: 0.55,
    });
  }

  /**
   * Soft chirp when the player gains a race place — lighter than checkpoint.
   * @param {number} place 1-based pack position after the pass
   */
  placeGain(place) {
    if (!this.ready) return;
    const p = Math.max(1, place | 0);
    const rate = p === 1 ? 1.38 : p === 2 ? 1.24 : p === 3 ? 1.14 : 1.06;
    const gain = p <= 3 ? 0.2 : 0.12;
    playHit(this.ctx, this._sfxIn, this._hits.chirp || this._hits.checkpoint, {
      gain,
      rate,
      dur: 0.16,
    });
  }

  /**
   * Recorded co-driver 3 / 2 / 1, locked to the HUD number. Quiet beep under
   * the line so a late decode still reads as a start light.
   * @param {number} n
   */
  countBeep(n) {
    if (!this.ready) return;
    const key = n >= 3 ? "count-3" : n === 2 ? "count-2" : "count-1";
    this._playCountVo(key);
    const rate = n >= 3 ? 0.82 : n === 2 ? 1 : 1.18;
    playHit(this.ctx, this._sfxIn, this._hits.checkpoint, {
      gain: 0.14,
      rate,
      dur: 0.16,
    });
  }

  /** Recorded "GO" on the same tick the HUD flips to GO! */
  countGo() {
    if (!this.ready) return;
    this._playCountVo("count-go");
    playHit(this.ctx, this._sfxIn, this._hits.checkpoint, {
      gain: 0.22,
      rate: 1.42,
      dur: 0.28,
    });
  }

  /**
   * Start-grid VO on the navigator bus (same voice as pace notes). If that
   * slider is down, fall through to SFX so 3-2-1-GO still fires.
   * @param {string} key
   */
  _playCountVo(key) {
    const buf = this._navClips[key];
    if (!buf) return;
    this._kickContext();
    const navUp = this.navVol > 0.04 && this._navGain;
    const dest = navUp ? this._navGain : this._sfxIn;
    if (!dest) return;
    if (this._countSrc) {
      try {
        this._countSrc.stop();
      } catch {
        /* already ended */
      }
      this._countSrc = null;
    }
    this._countSrc = playClip(this.ctx, dest, buf, { gain: navUp ? 1 : 0.9 });
  }

  /**
   * Jump landing one-shot — short subtle body/tire plant. Varies by fall
   * speed, surface, hang time, and recipe so consecutive lands never match.
   * Plays on the impact bus so the cabin high-pass cannot mute it.
   *
   * @param {number} impact descent rate m/s
   * @param {string} [surfaceId]
   * @param {{upset?:number, airTime?:number}} [meta]
   */
  landThump(impact, surfaceId, meta = {}) {
    if (!this.ready || this._workMute || !this._sfxIn) return;
    if (this.sfxVol <= 0.001) return;
    const dest = this._impactIn || this._sfxIn;
    const now = this.ctx.currentTime;
    if (now - this._landAt < 0.065) return;
    const airRaw = Math.max(0, meta.airTime || 0);
    // Reject curb ticks; allow short hop landings once they leave the deck.
    if (airRaw < 0.045 && impact < 1.8) return;
    const amt = Math.max(0, Math.min(1, (impact - 0.75) / 11));
    if (amt < 0.018 && airRaw < 0.09) return;
    this._landAt = now;

    const id = surfaceId || "dirt";
    const upset = Math.max(0, Math.min(1, meta.upset || 0));
    const air = Math.max(0, Math.min(1.8, airRaw));
    const jitter = Math.random();
    const jitter2 = Math.random();

    let recipe = amt < 0.22 ? 0 : amt < 0.48 ? 1 : 2;
    if (upset > 0.42 || (amt > 0.5 && upset > 0.28)) recipe = 3;
    if (jitter > 0.55) {
      const nudge = jitter2 < 0.5 ? -1 : 1;
      const next = clampInt(recipe + nudge, 0, 3);
      if (!(next === 3 && upset < 0.22 && amt < 0.42)) recipe = next;
    }
    if (recipe === this._landRecipe && jitter > 0.35) {
      const alts = [0, 1, 2].filter((r) => r !== recipe);
      recipe = alts[Math.floor(jitter2 * alts.length)] ?? recipe;
    }
    this._landRecipe = recipe;

    const pick = (pool, fallback) => {
      const list = pool && pool.length ? pool : null;
      if (!list) return fallback;
      return list[Math.floor(Math.random() * list.length)] || fallback;
    };
    const soft = pick(this._hits.landSoftPool, this._hits.landSoft || this._hits.thump);
    const mid = pick(this._hits.landMidPool, this._hits.landMid || this._hits.thump);
    const hard = pick(this._hits.landHardPool, this._hits.landHard || this._hits.noise);
    const scrape = pick(this._hits.landScrapePool, this._hits.landScrape || this._hits.noise);
    const body =
      recipe === 0 ? soft : recipe === 1 ? mid : recipe === 2 ? hard : scrape;

    let rateMul = 1;
    let gainMul = 1;
    let grit = 0;
    let chirp = 0;
    let gritRate = 1.1;
    let bodyLp = 4200;
    if (id === "tarmac" || id === "cobble") {
      rateMul = 1.08 + jitter * 0.14;
      gainMul = 1.12;
      chirp = 0.28 + amt * 0.4;
      gritRate = 1.4 + jitter * 0.18;
      bodyLp = 5200;
    } else if (id === "gravel") {
      rateMul = 0.9 + jitter * 0.16;
      gainMul = 1.05;
      grit = 0.55 + amt * 0.38;
      gritRate = 0.82 + jitter * 0.26;
      bodyLp = 3800;
    } else if (id === "sand" || id === "dirt") {
      rateMul = 0.76 + jitter * 0.16;
      gainMul = 0.98;
      grit = 0.32 + amt * 0.32;
      gritRate = 0.62 + jitter * 0.18;
      bodyLp = 3400;
    } else if (id === "mud" || id === "grass") {
      rateMul = 0.6 + jitter * 0.14;
      gainMul = 0.9;
      grit = 0.2 + amt * 0.22;
      gritRate = 0.46 + jitter * 0.12;
      bodyLp = 2800;
    } else {
      rateMul = 0.86 + jitter * 0.12;
      grit = 0.24 + amt * 0.22;
    }

    const airBoost = 0.92 + Math.min(0.4, air * 0.24);
    // Short + subtle — readable under the engine, never a slam unless hard.
    const bodyGain = (0.14 + amt * 0.28 + recipe * 0.028) * gainMul * airBoost;
    const bodyRate = (0.52 + amt * 0.28 + recipe * 0.05) * rateMul;
    const bodyDur =
      recipe === 0 ? 0.14 + amt * 0.08 + jitter * 0.03 : recipe === 3 ? 0.16 + upset * 0.1 : 0.1 + amt * 0.1;

    playHit(this.ctx, dest, body, {
      gain: bodyGain,
      rate: bodyRate + (jitter - 0.5) * 0.14,
      dur: bodyDur,
      attack: 0.003,
      lp: bodyLp,
      hp: 38,
    });

    // Soft second layer — suspension settle, detuned.
    if (jitter2 > 0.22 && body) {
      playHit(this.ctx, dest, body, {
        gain: bodyGain * (0.28 + jitter * 0.16),
        rate: bodyRate * (0.72 + jitter2 * 0.26),
        dur: bodyDur * (0.65 + jitter * 0.2),
        attack: 0.01,
        lp: bodyLp * 0.85,
        when: now + 0.012,
      });
    }

    if (this._hits.overrun) {
      const knockGain =
        recipe === 0
          ? 0.07 + amt * 0.1
          : recipe === 3
            ? 0.09 + amt * 0.14
            : 0.1 + amt * 0.18;
      playHit(this.ctx, dest, this._hits.overrun, {
        gain: knockGain * gainMul,
        rate: (0.4 + amt * 0.22 + recipe * 0.05) * rateMul + (jitter - 0.5) * 0.1,
        dur: recipe === 0 ? 0.18 + jitter * 0.04 : 0.11 + amt * 0.08,
        attack: 0.004,
        lp: 3600,
        hp: 55,
      });
    }

    if (recipe >= 2 && this._hits.thump) {
      playHit(this.ctx, dest, this._hits.thump, {
        gain: 0.07 + amt * 0.12,
        rate: 0.48 + amt * 0.16 + (jitter - 0.5) * 0.08,
        dur: 0.09 + amt * 0.07,
        attack: 0.002,
        lp: 2400,
      });
    }

    if (grit > 0.12) {
      const gritBuf = this._hits.gravel || this._hits.noise || this._hits.overrun;
      playHit(this.ctx, dest, gritBuf, {
        gain: (0.045 + grit * 0.11) * (0.75 + amt),
        rate: gritRate + (jitter - 0.5) * 0.18,
        dur: 0.08 + grit * 0.12 + amt * 0.06,
        attack: 0.005,
        hp: 120,
        lp: 5200,
      });
    }

    if ((chirp > 0.2 || recipe === 3) && this._hits.chirp) {
      playHit(this.ctx, dest, this._hits.chirp, {
        gain: 0.02 + (chirp + upset) * 0.05,
        rate: recipe === 3 ? 0.48 + upset * 0.3 + jitter * 0.08 : 0.75 + amt * 0.38 + jitter * 0.1,
        dur: recipe === 3 ? 0.1 + upset * 0.08 : 0.05 + amt * 0.04,
        attack: 0.003,
        hp: 400,
        lp: 7000,
      });
    }
  }

  /**
   * Short wall / barrier glance. Intensity follows contact speed.
   * @param {number} mag
   */
  wallGlance(mag) {
    if (!this.ready || this._workMute || this.sfxVol <= 0.001) return;
    const dest = this._impactIn || this._sfxIn;
    const now = this.ctx.currentTime;
    if (now - this._wallAt < 0.1) return;
    const amt = Math.max(0, Math.min(1, mag / 14));
    if (amt < 0.08) return;
    this._wallAt = now;
    playHit(this.ctx, dest, this._hits.noise || this._hits.overrun, {
      gain: 0.09 + amt * 0.22,
      rate: 1.55 + amt * 0.55,
      dur: 0.06 + amt * 0.07,
      attack: 0.002,
      hp: 280,
      lp: 7800,
    });
    playHit(this.ctx, dest, this._hits.chirp || this._hits.overrun, {
      gain: 0.04 + amt * 0.1,
      rate: 0.58 + amt * 0.22,
      dur: 0.07 + amt * 0.04,
      attack: 0.003,
      hp: 200,
      lp: 5500,
    });
    if (amt > 0.35 && this._hits.overrun) {
      playHit(this.ctx, dest, this._hits.overrun, {
        gain: 0.05 + amt * 0.1,
        rate: 0.55 + amt * 0.15,
        dur: 0.09,
        attack: 0.004,
        lp: 3200,
      });
    }
  }

  /**
   * Heavier body-to-body rub. Distinct from a wall tick.
   * @param {number} mag
   */
  carBump(mag) {
    if (!this.ready || this._workMute || this.sfxVol <= 0.001) return;
    const dest = this._impactIn || this._sfxIn;
    const now = this.ctx.currentTime;
    if (now - this._carAt < 0.16) return;
    const amt = Math.max(0, Math.min(1, mag / 9));
    if (amt < 0.04) return;
    this._carAt = now;
    playHit(this.ctx, dest, this._hits.overrun, {
      gain: 0.09 + amt * 0.18,
      rate: 0.32 + amt * 0.12,
      dur: 0.1 + amt * 0.09,
      attack: 0.004,
      lp: 2800,
      hp: 50,
    });
    if (this._hits.thump) {
      playHit(this.ctx, dest, this._hits.thump, {
        gain: 0.07 + amt * 0.12,
        rate: 0.4 + amt * 0.08,
        dur: 0.11 + amt * 0.07,
        attack: 0.003,
        lp: 1800,
      });
    }
  }

  /**
   * Short rubber chirp — higher rate = tighter corner.
   * @param {number} [severity]
   */
  paceBeep(severity = 1) {
    if (!this.ready) return;
    playHit(this.ctx, this._sfxIn, this._hits.chirp, {
      gain: 0.12,
      rate: 0.9 + severity * 0.18,
      dur: 0.11,
    });
  }

  /**
   * Result / timeout sting role (not Sega's "GAME OVER YEAH" recording).
   * Three falling overrun hits + a short checkpoint chirp over the CC0
   * result music bed already started by syncMusic("result").
   */
  gameOverYeah() {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    const rates = [1.08, 0.9, 0.74];
    rates.forEach((rate, i) => {
      playHit(this.ctx, this._sfxIn, this._hits.overrun, {
        gain: 0.36,
        rate,
        when: t0 + i * 0.17,
        dur: 0.3,
      });
    });
    if (this._hits.checkpoint) {
      playHit(this.ctx, this._sfxIn, this._hits.checkpoint, {
        gain: 0.28,
        rate: 0.62,
        when: t0 + 0.52,
        dur: 0.45,
      });
    }
  }
}

/**
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function loadVol(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    // getItem returns null when unset. Number(null) is 0, which would mute
    // every first-time (or new-origin) session if we treated that as a value.
    if (raw == null || raw === "") return fallback;
    const n = Number(raw);
    if (Number.isFinite(n)) return clamp01(n);
  } catch {
    /* private mode */
  }
  return fallback;
}

/**
 * @param {string} key
 * @param {number} v
 */
function saveVol(key, v) {
  try {
    localStorage.setItem(key, String(v));
  } catch {
    /* private mode */
  }
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

/**
 * Short decaying noise burst for wall ticks and heavy body thumps.
 * @param {AudioContext} ctx
 * @param {number} seconds
 * @param {number} [low]
 * @returns {AudioBuffer}
 */
function makeNoiseBuffer(ctx, seconds, low = 0) {
  const len = Math.max(32, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  let acc = 0;
  for (let i = 0; i < len; i++) {
    const env = 1 - i / len;
    const n = Math.random() * 2 - 1;
    acc = acc * low + n * (1 - low);
    data[i] = (low > 0 ? acc : n) * env * env;
  }
  return buf;
}

/**
 * Landing body noise — multi-band plant (sub thump + body + tire tick).
 * @param {AudioContext} ctx
 * @param {number} seconds
 * @param {"soft"|"mid"|"hard"|"scrape"} [kind]
 * @returns {AudioBuffer}
 */
function makeLandNoise(ctx, seconds, kind = "mid") {
  const len = Math.max(64, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  const sr = ctx.sampleRate;
  let acc = 0;
  let acc2 = 0;
  const low =
    kind === "soft" ? 0.72 : kind === "hard" ? 0.28 : kind === "scrape" ? 0.12 : 0.48;
  const tone = kind === "soft" ? 70 + Math.random() * 40 : 95 + Math.random() * 90;
  const tickHz = 420 + Math.random() * 380;
  const bright = kind === "scrape" ? 0.7 : kind === "hard" ? 0.55 : 0.32 + Math.random() * 0.25;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const n = i / len;
    // Fast attack, short body — "subtle plant", not a long whoosh.
    const env =
      kind === "soft"
        ? Math.pow(1 - n, 1.15) * (0.55 + 0.45 * Math.min(1, n * 18))
        : Math.pow(1 - n, 1.45 + (kind === "hard" ? 0.35 : 0)) * (0.4 + 0.6 * Math.min(1, n * 28));
    const white = Math.random() * 2 - 1;
    acc = acc * low + white * (1 - low);
    acc2 = acc2 * 0.35 + white * 0.65;
    // Sub / body sine sweep (suspension compress).
    const f0 = tone * (1 - n * 0.45);
    const thump = Math.sin(2 * Math.PI * f0 * t) * Math.exp(-t * (10 + (kind === "soft" ? 4 : 14)));
    // Contact tick at plant.
    const tick = Math.sin(2 * Math.PI * tickHz * t) * Math.exp(-t * (28 + Math.random() * 16));
    const grit = kind === "scrape" ? acc2 * 0.55 : acc2 * bright * 0.28;
    data[i] = (acc * 0.42 + thump * 0.55 + tick * 0.32 + grit) * env;
  }
  // Soft peak normalize so recipes match loudness.
  let peak = 0.0001;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(data[i]));
  const norm = 0.92 / peak;
  for (let i = 0; i < len; i++) data[i] *= norm;
  return buf;
}

function clampInt(v, a, b) {
  return Math.max(a, Math.min(b, v | 0));
}
