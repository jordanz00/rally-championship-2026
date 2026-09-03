/**
 * Co-driver — recorded rally navigator, not browser TTS.
 *
 * WHO THIS IS FOR: the race loop + pause NAVIGATOR slider.
 * WHAT IT DOES: plays spoken grade clips (easy/medium/hard/hairpin L/R + jump)
 *   once per turn or jump. Own gain bus.
 * HOW IT CONNECTS: game.js feeds Track.noteAt(); RallyAudio.paceCall plays clips.
 */

import { PACE } from "../config.js?v=180";

const VOL_NAV_KEY = "rally-vol-navigator";

const ALLOWED = new Set([
  "easy-left",
  "easy-right",
  "medium-left",
  "medium-right",
  "hard-left",
  "hard-right",
  "hairpin-left",
  "hairpin-right",
  "jump",
]);

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
    /** @type {Set<string>} spoken note ids + corner signatures */
    this._said = new Set();
    this.cool = 0;
    this.gap = PACE.speakGap || 2.4;
    this.volume = loadVol(VOL_NAV_KEY, 1);
    this._previewAt = 0;
    this._boundaryAt = 0;
    this._damageSaid = 0;
    this._lastClip = "";
    this._lastClipAt = -1e9;
    this._lastClipUntil = -1e9;
    this._retryKey = "";
    this._retryCool = 0;
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
   * @param {number} [_progress]
   * @param {number} [_speed]
   * @returns {{display:string, spoken:boolean}} HUD line + whether voice fired
   */
  update(note, dt, audio, progress = 0, speed = 0) {
    this.cool -= dt;
    this._retryCool -= dt;
    if (!note) return { display: "", spoken: false };
    const display = note.text || "";
    const key = clipKey(note);
    if (!key) return { display: "", spoken: false };

    const sig = noteSignature(note, key);
    if (this._said.has(sig) || this._said.has(note.id)) {
      return { display, spoken: false };
    }

    const lead = (note.at || 0) - progress;
    if (lead < -14) {
      this._markSaid(note, sig);
      return { display, spoken: false };
    }

    const recall =
      (PACE.recallMetres || 14) + (PACE.recallSpeedScale || 0.32) * Math.max(0, speed || 0);
    if (key === this._lastClip && progress < this._lastClipUntil) {
      return { display, spoken: false };
    }
    if (key === this._lastClip && progress - this._lastClipAt < recall) {
      return { display, spoken: false };
    }
    if (this.cool > 0) return { display, spoken: false };

    if (this.volume <= 0.001) {
      this._commitSpeak(note, sig, key, progress, recall);
      return { display, spoken: true };
    }
    if (!audio || !audio.paceCall) return { display, spoken: false };

    if (this._retryKey === key && this._retryCool > 0) {
      return { display, spoken: false };
    }

    if (!audio.paceCall(key)) {
      this._retryKey = key;
      this._retryCool = 0.1;
      return { display, spoken: false };
    }

    this._retryKey = "";
    this._retryCool = 0;
    this._commitSpeak(note, sig, key, progress, recall);
    return { display, spoken: true };
  }

  /**
   * Remember a corner/jump call so it cannot fire again on the same geometry.
   * @param {{id:string, at?:number}} note
   * @param {string} key
   * @param {string} sig
   * @param {number} progress
   * @param {number} recall
   */
  _commitSpeak(note, sig, key, progress, recall) {
    this._markSaid(note, sig);
    this._lastClip = key;
    this._lastClipAt = progress;
    this._lastClipUntil = (note.at != null ? note.at : progress) + recall;
    this.cool = this.gap;
  }

  /**
   * @param {{id:string}} note
   * @param {string} sig
   */
  _markSaid(note, sig) {
    this._said.add(sig);
    if (note.id) this._said.add(note.id);
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
    this._said = new Set();
    this.cool = 0;
    this._damageSaid = 0;
    this._lastClip = "";
    this._lastClipAt = -1e9;
    this._lastClipUntil = -1e9;
    this._retryKey = "";
    this._retryCool = 0;
  }

  /**
   * HUD sting when bodywork crosses a wear tier. Recorded VO has no "Bodywork"
   * clip — the flash is the navigator call the driver can read.
   * @param {number} tier 0..3
   * @param {{flashMessage?: Function}} [hud]
   */
  damageCall(tier, hud) {
    if (tier < 2) return;
    if ((this._damageSaid || 0) >= tier) return;
    this._damageSaid = tier;
    if (hud && hud.flashMessage) hud.flashMessage(tier >= 3 ? "BODYWORK" : "CONTACT");
  }
}

/**
 * @param {{kind?:string, dir?:string, severity?:number, clip?:string}} note
 */
function clipKey(note) {
  let key = note.clip || "";
  if (!key) {
    if (note.kind === "jump") key = "jump";
    else {
      const side = note.dir === "LEFT" ? "left" : note.dir === "RIGHT" ? "right" : "";
      if (!side) return "";
      const sev = note.severity || 1;
      if (sev >= 4) key = `hairpin-${side}`;
      else if (sev >= 3) key = `hard-${side}`;
      else if (sev === 2) key = `medium-${side}`;
      else key = `easy-${side}`;
    }
  }
  return ALLOWED.has(key) ? key : "";
}

/**
 * Stable signature for one corner/jump — same clip + ~20 m bucket = one call.
 * @param {{at?:number, kind?:string}} note
 * @param {string} key
 */
function noteSignature(note, key) {
  const at = Math.round((note.at || 0) / 20) * 20;
  return `${key}@${at}`;
}
