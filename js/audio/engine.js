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

import { CdSoundtrack } from "./soundtrack.js?v=134";
import { PowertrainVoice } from "./powertrain.js?v=25";
import { SkidVoice } from "./skid.js?v=6";
import { loadSample, playHit, playClip } from "./bank.js?v=2";
import { CrowdVoice } from "./crowd.js?v=4";
import { ReverbZones, zoneFromSample } from "./reverb-zones.js?v=1";

/** Default SFX bus level (slider at 100%). */
const SFX_GAIN = 0.58;
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
  "count-3",
  "count-2",
  "count-1",
  "count-go",
];

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
    hp.frequency.value = 70;
    hp.Q.value = 0.7;

    const sfxMerge = ctx.createGain();
    sfxMerge.gain.value = 1;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 7600;
    lp.Q.value = 0.65;

    const airCut = ctx.createBiquadFilter();
    airCut.type = "peaking";
    airCut.frequency.value = 4200;
    airCut.Q.value = 0.9;
    airCut.gain.value = -3.5;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 10;
    comp.ratio.value = 2.4;
    comp.attack.value = 0.01;
    comp.release.value = 0.18;

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
    this._hits.landSoft = makeNoiseBuffer(ctx, 0.42, 0.88);
    this._hits.landMid = makeNoiseBuffer(ctx, 0.22, 0.62);
    this._hits.landHard = makeNoiseBuffer(ctx, 0.12, 0.28);
    this._hits.landScrape = makeNoiseBuffer(ctx, 0.2, 0.12);
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
      loadSample(this.ctx, `assets/sfx/nav/${key}.mp3?v=4`).then((buf) => {
        this._navClips[key] = buf;
      });
    }
  }

  /**
   * Play a recorded co-driver line. Stops the previous call so they never stack.
   * @param {string} key
   * @returns {boolean}
   */
  paceCall(key) {
    if (!this.ready || this._workMute || this.navVol <= 0.001) return false;
    if (!NAV_CLIPS.includes(key)) return false;
    const buf = this._navClips[key];
    if (!buf || !this._navGain) return false;
    this._kickContext();
    // Same line already playing — do not restart every frame while the clip loads.
    if (this._navSrc && this._navPlayingKey === key) return true;
    if (this._navSrc) {
      try {
        this._navSrc.stop();
      } catch {
        /* already ended */
      }
      this._navSrc = null;
    }
    this._navPlayingKey = key;
    this._navSrc = playClip(this.ctx, this._navGain, buf, { gain: 1 });
    if (this._navSrc) {
      this._navSrc.onended = () => {
        if (this._navPlayingKey === key) this._navPlayingKey = "";
      };
    }
    return !!this._navSrc;
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
      let hpHz = 240;
      if (/mud|sand|grass|dirt/.test(id)) hpHz = 180;
      else if (/tarmac|cobble/.test(id)) hpHz = 320;
      else if (/gravel/.test(id)) hpHz = 260;
      this._sfxHp.frequency.setTargetAtTime(hpHz, now, 0.18);
    }
    if (this._windGain && this.ctx) {
      const spd = mix.speed || 0;
      /**
       * Cabin rush: open earlier (~22 km/h) and hit a clear hiss by ~120 km/h.
       * Before: (spd-10)/44 × 0.2 → ~0.11 at 33 m/s. After: (spd-6)/28 × 0.34 → ~0.33.
       */
      const air = live ? Math.min(1.15, Math.max(0, (spd - 6) / 28)) : 0;
      const now = this.ctx.currentTime;
      this._windGain.gain.setTargetAtTime(air * 0.34 * this.sfxVol, now, 0.08);
      if (this._windFilt) {
        this._windFilt.frequency.setTargetAtTime(480 + spd * 32, now, 0.12);
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
   * Jump landing one-shot — varies by fall speed, surface, and how flat the
   * chassis arrived. Soft hops, packed hard landings, and botched nose-high
   * scrapes use different body + grit layers so consecutive jumps never sound
   * like one looped thump.
   *
   * @param {number} impact descent rate m/s
   * @param {string} [surfaceId]
   * @param {{upset?:number, airTime?:number}} [meta]
   */
  landThump(impact, surfaceId, meta = {}) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this._landAt < 0.07) return;
    const amt = Math.max(0, Math.min(1, (impact - 1.2) / 14));
    if (amt < 0.04) return;
    this._landAt = now;

    const id = surfaceId || "dirt";
    const upset = Math.max(0, Math.min(1, meta.upset || 0));
    const air = Math.max(0, Math.min(1.6, meta.airTime || 0));
    const jitter = Math.random();

    // Recipe bands: soft / mid / hard / scrape (botched). Prefer a different
    // band than last time when impact sits near a boundary.
    let recipe = amt < 0.28 ? 0 : amt < 0.55 ? 1 : 2;
    if (upset > 0.42 || (amt > 0.5 && upset > 0.28)) recipe = 3;
    if (recipe === this._landRecipe) {
      const alts = [0, 1, 2, 3].filter((r) => r !== recipe);
      recipe = alts[Math.floor(jitter * alts.length)] ?? recipe;
      // Keep scrape only when the landing actually deserved it.
      if (recipe === 3 && upset < 0.28 && amt < 0.48) recipe = amt < 0.4 ? 0 : 1;
    }
    this._landRecipe = recipe;

    const soft = this._hits.landSoft || this._hits.thump;
    const mid = this._hits.landMid || this._hits.thump;
    const hard = this._hits.landHard || this._hits.noise;
    const scrape = this._hits.landScrape || this._hits.noise;
    const body =
      recipe === 0 ? soft : recipe === 1 ? mid : recipe === 2 ? hard : scrape;

    // Surface character — hard pack vs muffling sand/mud vs grit gravel.
    let rateMul = 1;
    let gainMul = 1;
    let grit = 0;
    let chirp = 0;
    let gritRate = 1.1;
    if (id === "tarmac" || id === "cobble") {
      rateMul = 1.18 + jitter * 0.08;
      gainMul = 1.12;
      chirp = 0.35 + amt * 0.45;
      gritRate = 1.55;
    } else if (id === "gravel") {
      rateMul = 0.98 + jitter * 0.1;
      gainMul = 1.05;
      grit = 0.55 + amt * 0.4;
      gritRate = 0.92 + jitter * 0.2;
    } else if (id === "sand" || id === "dirt") {
      rateMul = 0.78 + jitter * 0.12;
      gainMul = 0.9;
      grit = 0.28 + amt * 0.35;
      gritRate = 0.7 + jitter * 0.15;
    } else if (id === "mud" || id === "grass") {
      rateMul = 0.62 + jitter * 0.1;
      gainMul = 0.82;
      grit = 0.18 + amt * 0.22;
      gritRate = 0.55;
    } else {
      rateMul = 0.88 + jitter * 0.1;
      grit = 0.22 + amt * 0.25;
    }

    const airBoost = 0.85 + Math.min(0.35, air * 0.22);
    const bodyGain = (0.1 + amt * 0.34 + recipe * 0.03) * gainMul * airBoost;
    const bodyRate = (0.38 + amt * 0.28 + recipe * 0.06) * rateMul;
    const bodyDur =
      recipe === 0 ? 0.34 + amt * 0.12 : recipe === 3 ? 0.28 + upset * 0.12 : 0.16 + amt * 0.14;

    playHit(this.ctx, this._sfxIn, body, {
      gain: bodyGain,
      rate: bodyRate + (jitter - 0.5) * 0.08,
      dur: bodyDur,
    });

    // Recorded body knock — different rates so soft vs hard do not share pitch.
    if (this._hits.overrun) {
      const knockGain =
        recipe === 0
          ? 0.06 + amt * 0.1
          : recipe === 3
            ? 0.1 + amt * 0.16
            : 0.12 + amt * 0.28;
      playHit(this.ctx, this._sfxIn, this._hits.overrun, {
        gain: knockGain * gainMul,
        rate: (0.42 + amt * 0.22 + recipe * 0.05) * rateMul + (jitter - 0.5) * 0.06,
        dur: recipe === 0 ? 0.32 : 0.18 + amt * 0.1,
      });
    }

    // Suspension bottom-out on hard landings.
    if (recipe >= 2 && this._hits.thump) {
      playHit(this.ctx, this._sfxIn, this._hits.thump, {
        gain: 0.07 + amt * 0.2,
        rate: 0.48 + amt * 0.12 + (jitter - 0.5) * 0.05,
        dur: 0.14 + amt * 0.08,
      });
    }

    // Loose-surface grit / scrub (gravel bed slice or noise).
    if (grit > 0.12) {
      const gritBuf = this._hits.gravel || this._hits.noise || this._hits.overrun;
      playHit(this.ctx, this._sfxIn, gritBuf, {
        gain: (0.04 + grit * 0.12) * (0.7 + amt),
        rate: gritRate + (jitter - 0.5) * 0.12,
        dur: 0.12 + grit * 0.16 + amt * 0.08,
      });
    }

    // Tarmac slap / botched scrape chirp.
    if ((chirp > 0.2 || recipe === 3) && this._hits.chirp) {
      playHit(this.ctx, this._sfxIn, this._hits.chirp, {
        gain: 0.02 + (chirp + upset) * 0.06,
        rate: recipe === 3 ? 0.55 + upset * 0.25 : 0.85 + amt * 0.35,
        dur: recipe === 3 ? 0.14 + upset * 0.1 : 0.07 + amt * 0.05,
      });
    }
  }

  /**
   * Short wall / barrier glance. Intensity follows contact speed.
   * @param {number} mag
   */
  wallGlance(mag) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this._wallAt < 0.11) return;
    const amt = Math.max(0, Math.min(1, mag / 14));
    if (amt < 0.08) return;
    this._wallAt = now;
    playHit(this.ctx, this._sfxIn, this._hits.noise || this._hits.overrun, {
      gain: 0.07 + amt * 0.2,
      rate: 1.7 + amt * 0.5,
      dur: 0.07 + amt * 0.07,
    });
    playHit(this.ctx, this._sfxIn, this._hits.chirp, {
      gain: 0.03 + amt * 0.08,
      rate: 0.62 + amt * 0.2,
      dur: 0.08,
    });
  }

  /**
   * Heavier body-to-body rub. Distinct from a wall tick.
   * @param {number} mag
   */
  carBump(mag) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    if (now - this._carAt < 0.18) return;
    const amt = Math.max(0, Math.min(1, mag / 9));
    if (amt < 0.04) return;
    this._carAt = now;
    playHit(this.ctx, this._sfxIn, this._hits.overrun, {
      gain: 0.07 + amt * 0.16,
      rate: 0.34 + amt * 0.1,
      dur: 0.1 + amt * 0.08,
    });
    if (this._hits.thump) {
      playHit(this.ctx, this._sfxIn, this._hits.thump, {
        gain: 0.05 + amt * 0.1,
        rate: 0.42 + amt * 0.06,
        dur: 0.12 + amt * 0.06,
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

  /** Timeout sting from a recorded overrun, falling in three hits. */
  gameOverYeah() {
    if (!this.ready) return;
    const t0 = this.ctx.currentTime;
    const rates = [1.02, 0.86, 0.72];
    rates.forEach((rate, i) => {
      playHit(this.ctx, this._sfxIn, this._hits.overrun, {
        gain: 0.34,
        rate,
        when: t0 + i * 0.18,
        dur: 0.32,
      });
    });
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
