/**
 * Co-driver — recorded rally navigator, not browser TTS.
 *
 * WHO THIS IS FOR: the race loop + pause NAVIGATOR slider.
 * WHAT IT DOES: plays human VO clips (easy/medium/hard/hairpin L/R + jump)
 *   for the soonest turn or jump. One jump call per crest pair. Own gain bus.
 * HOW IT CONNECTS: game.js feeds Track.noteAt(); RallyAudio.paceCall plays clips.
 */

import { PACE } from "../config.js?v=137";

const VOL_NAV_KEY = "rally-vol-navigator";
/** Ignore a second jump until the car has covered this many metres. */
const JUMP_LOCK_M = 110;

/**
 * @param {string} key
 * @param {number} fallback
 */
function loadVol(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
  } catch {
    return fallback;
  }
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

export class CoDriver {
  constructor() {
    this.lastId = "";
    this.cool = 0;
    this._spokeAt = -999;
    /** Seconds between calls. game.js overrides this from PACE.speakGap. */
    this.gap = 2.4;
    this.volume = loadVol(VOL_NAV_KEY, 1);
    this._previewAt = 0;
    this._boundaryAt = 0;
    this._jumpLockUntil = -999;
  }

  /**
   * Call from a user gesture so the navigator bus can unlock with SFX.
   * @param {{setNavVolume?: Function}} [audio]
   */
  warm(audio) {
    if (audio && audio.setNavVolume) audio.setNavVolume(this.volume);
  }

  /**
   * @param {{id:string, speech:string, text:string, severity:number, kind?:string, clip?:string}|null} note
   * @param {number} dt
   * @param {{paceCall?: Function}} audio
   * @param {number} [progress] metres along the stage
   * @param {number} [speed] m/s — wider re-call gap at speed so corners are not spammed
   * @returns {{display:string, spoken:boolean}} HUD line + whether voice fired
   */
  update(note, dt, audio, progress = 0, speed = 0) {
    this.cool -= dt;
    if (!note) return { display: "", spoken: false };
    if (note.kind === "jump" && progress < this._jumpLockUntil) {
      return { display: "", spoken: false };
    }
    const display = note.text || "";
    if (note.id === this.lastId) return { display: "", spoken: false };
    if (this.cool > 0) return { display: "", spoken: false };
    const recallGap = Math.max(
      PACE.recallMetres || 14,
      speed * (PACE.recallSpeedScale || 0.32)
    );
    if (progress - this._spokeAt < recallGap) return { display: "", spoken: false };
    const key = note.clip || clipKey(note);
    if (!key) return { display: "", spoken: false };
    if (this.volume > 0.001 && audio && audio.paceCall && !audio.paceCall(key)) {
      return { display: "", spoken: false };
    }
    this.lastId = note.id;
    this._spokeAt = progress;
    this.cool = Math.max(PACE.speakGap || this.gap, 2.2);
    if (note.kind === "jump") this._jumpLockUntil = progress + JUMP_LOCK_M;
    return { display, spoken: true };
  }

  /** Timeout sting lives on RallyAudio — no spoken "game over". */
  gameOverYeah() {}

  /**
   * Hard scenery rub — kept as a no-op so the call site stays valid.
   * @param {number} [_mag]
   */
  boundaryHit(_mag) {}

  /**
   * Pause-menu NAVIGATOR slider. 0–1, forwarded to the nav gain bus.
   * @param {number} v
   * @param {{setNavVolume?: Function}} [audio]
   */
  setVolume(v, audio) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    saveVol(VOL_NAV_KEY, this.volume);
    if (audio && audio.setNavVolume) audio.setNavVolume(this.volume);
  }

  /**
   * Short recorded call while dragging the NAVIGATOR slider.
   * @param {{paceCall?: Function}} [audio]
   */
  preview(audio) {
    if (this.volume <= 0.001) return;
    const now = performance.now();
    if (now - this._previewAt < 520) return;
    this._previewAt = now;
    if (audio && audio.paceCall) audio.paceCall("easy-left");
  }

  reset() {
    this.lastId = "";
    this.cool = 0;
    this._spokeAt = -999;
    this._jumpLockUntil = -999;
  }
}

/**
 * @param {{kind?:string, dir?:string, severity?:number, clip?:string}} note
 */
function clipKey(note) {
  if (note.clip) return note.clip;
  if (note.kind === "jump") return "jump";
  const side = note.dir === "LEFT" ? "left" : note.dir === "RIGHT" ? "right" : "";
  if (!side) return "";
  const sev = note.severity || 1;
  if (sev >= 3) return `hard-${side}`;
  if (sev === 2) return `medium-${side}`;
  return `easy-${side}`;
}
