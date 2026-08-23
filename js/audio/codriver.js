/**
 * Co-driver — Kenneth Ibrahim / Sega Rally Championship style.
 *
 * WHO THIS IS FOR: the race loop + pause NAVIGATOR slider.
 * WHAT IT DOES: picks a natural US-English male system voice, then speaks
 *   short Saturn-style calls (Easy / Medium / Hard + Left / Right) at a
 *   conversational rate — not a chipmunk GPS. Own volume bus, separate from SFX.
 * HOW IT CONNECTS: game.js feeds Track.noteAt(); RallyAudio plays the beep.
 */

import { PACE } from "../config.js?v=122";

const VOL_NAV_KEY = "rally-vol-navigator";

/** Voices that are novelty / robotic on macOS and Windows. */
const NOVELTY =
  /compact|espeak|whisper|zarvox|trinoids|bad news|good news|boing|bubbles|cellos|fred|junior|kathy|princess|ralph|albert|bahh|bells|pipe organ|organ|superstar|wobble|jester|sara\b|robot|dummy|echo|novelty/;

const FEMALE =
  /samantha|karen|moira|tessa|fiona|serena|zira|hazel|martha|victoria|kate|nicky|allison|susan|vicki|siri|female|woman|girl|veena|lekha/;

/**
 * Score a system voice toward a natural American male co-driver.
 * Prefer neural / enhanced / premium packs when the OS ships them.
 * @param {SpeechSynthesisVoice} v
 */
function scoreVoice(v) {
  const n = `${v.name} ${v.lang}`.toLowerCase();
  let s = 0;
  if (!/^en/.test((v.lang || "").toLowerCase())) s -= 50;
  if (NOVELTY.test(n)) s -= 50;
  if (FEMALE.test(n)) s -= 28;
  if (/en-gb|en_gb|en-uk|uk english|daniel|george|oliver|rishi|thomas|arthur|brian/.test(n)) s -= 14;
  if (/en-au|en_au|en-in|en_in|en-ie|en_ie/.test(n)) s -= 6;
  if (/en-us|en_us|english \(us\)|english \(united states\)/.test(n)) s += 24;
  // Natural TTS packs — biggest quality leap over classic Mac/Windows voices.
  if (/neural|natural|enhanced|premium|online \(natural\)|multilingual/.test(n)) s += 28;
  if (/\balex\b/.test(n) && !/alexa/.test(n)) s += 18;
  if (/\baaron\b|\beddy\b|\bnathan\b|\bnolan\b|\breed\b|\bguy\b|\bsteve\b/.test(n)) s += 18;
  if (/microsoft (david|mark|guy|eric|andrew)/.test(n)) s += 16;
  if (/google us english/.test(n)) s += 16;
  if (/\btom\b|\bjames\b|\bjohn\b/.test(n) && /en-us|en_us/.test(n)) s += 10;
  if (/\bmale\b/.test(n)) s += 6;
  if (v.localService) s += 2;
  // Prefer default US voice when scores tie.
  if (v.default && /en-us|en_us/.test(n)) s += 4;
  return s;
}

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
    this.enabled = typeof window !== "undefined" && "speechSynthesis" in window;
    /** @type {SpeechSynthesisVoice|null} */
    this.voice = null;
    this.volume = loadVol(VOL_NAV_KEY, 1);
    this._timer = 0;
    this._warmed = false;
    this._previewAt = 0;
    /** Alternates hard-boundary reactions. */
    this._boundaryPhrase = 0;
    this._boundaryAt = 0;
    if (this.enabled) {
      this._refreshVoice();
      window.speechSynthesis.addEventListener("voiceschanged", () => this._refreshVoice());
    }
  }

  /**
   * Call from a user gesture so the browser allows speech and voices load.
   */
  warm() {
    if (!this.enabled || this._warmed || this.volume <= 0.001) return;
    this._warmed = true;
    this._refreshVoice();
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(".");
      u.volume = 0.01;
      u.rate = 1;
      u.pitch = 1;
      u.lang = "en-US";
      if (this.voice) u.voice = this.voice;
      window.speechSynthesis.speak(u);
    } catch {
      /* unlock is best-effort */
    }
  }

  /**
   * @param {{id:string, speech:string, text:string, severity:number}|null} note
   * @param {number} dt
   * @param {{paceBeep?: Function}} audio
   * @param {number} [progress] metres along the stage
   * @param {number} [speed] m/s — wider re-call gap at speed so corners are not spammed
   * @returns {{display:string, spoken:boolean}} HUD line + whether voice fired
   */
  update(note, dt, audio, progress = 0, speed = 0) {
    this.cool -= dt;
    if (!note) return { display: "", spoken: false };
    const display = note.text || "";
    if (note.id === this.lastId) return { display: "", spoken: false };
    if (this.cool > 0) return { display: "", spoken: false };
    const recallGap = Math.max(
      PACE.recallMetres || 14,
      speed * (PACE.recallSpeedScale || 0.32)
    );
    if (progress - this._spokeAt < recallGap) return { display: "", spoken: false };
    this.lastId = note.id;
    this._spokeAt = progress;
    this.cool = PACE.speakGap || this.gap;
    const sev = note.severity || 1;
    this._speak(note.speech, sev);
    if (audio && audio.paceBeep) audio.paceBeep(sev);
    return { display, spoken: true };
  }

  gameOverYeah() {
    this._speak("Game over, yeah.", 1);
  }

  /**
   * Hard scenery / track-edge rub — alternates Ibrahim-style reactions.
   * @param {number} mag accumulated hitWall magnitude for this frame
   */
  boundaryHit(mag) {
    if (!this.enabled || this.volume <= 0.001) return;
    if (mag < 0.65) return;
    const now = performance.now();
    if (now - this._boundaryAt < 2400) return;
    this._boundaryAt = now;
    const lines = ["Whoa!", "Try to take it easy on the car!"];
    const text = lines[this._boundaryPhrase % lines.length];
    this._boundaryPhrase += 1;
    this._speak(text, mag > 1.05 ? 3 : 2);
  }

  /**
   * Pause-menu NAVIGATOR slider. Speech Synthesis uses 0–1.
   * @param {number} v
   */
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    saveVol(VOL_NAV_KEY, this.volume);
  }

  /**
   * Short call while dragging the NAVIGATOR slider so the level is audible.
   */
  preview() {
    if (!this.enabled || this.volume <= 0.001) return;
    const now = performance.now();
    if (now - this._previewAt < 420) return;
    this._previewAt = now;
    this._speak("Easy left", 1, true);
  }

  reset() {
    this.lastId = "";
    this.cool = 0;
    this._spokeAt = -999;
    this._boundaryPhrase = 0;
    this._boundaryAt = 0;
    if (this.enabled) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  _refreshVoice() {
    if (!this.enabled) return;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    const ranked = voices.slice().sort((a, b) => scoreVoice(b) - scoreVoice(a));
    this.voice = ranked[0] || null;
  }

  /**
   * Conversational co-driver shout — natural rate/pitch, slight urgency on hard.
   * @param {string} text
   * @param {number} [severity]
   * @param {boolean} [preview] skip cancel delay when auditioning the slider
   */
  _speak(text, severity = 1, preview = false) {
    if (!this.enabled || !text || this.volume <= 0.001) return;
    this._refreshVoice();
    const line = spokenLine(text);
    // Natural human pace — hard calls push a little, never chipmunk GPS.
    const rate = severity >= 3 ? 1.08 : severity === 2 ? 1.02 : 0.98;
    const pitch = severity >= 3 ? 1.02 : 0.98;
    const delay = preview
      ? 0
      : severity >= 3
        ? PACE.hardSpeakDelayMs || 0
        : PACE.speakDelayMs || 28;
    try {
      window.speechSynthesis.cancel();
      if (this._timer) window.clearTimeout(this._timer);
      this._timer = window.setTimeout(() => {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        const u = new SpeechSynthesisUtterance(line);
        u.rate = rate;
        u.pitch = pitch;
        u.volume = this.volume;
        u.lang = (this.voice && this.voice.lang) || "en-US";
        if (this.voice) u.voice = this.voice;
        window.speechSynthesis.speak(u);
      }, delay);
    } catch {
      /* speech optional */
    }
  }
}

/**
 * Saturn vocabulary with natural spoken cadence (light pause between severity
 * and direction — reads like a real co-driver, not a clipped GPS token).
 * @param {string} raw
 */
function spokenLine(raw) {
  let t = String(raw || "").trim();
  t = t.replace(/[!]+/g, "");
  t = t.replace(/\s+/g, " ");
  const key = t.toLowerCase().replace(/[.,]+$/g, "");
  const said = {
    "easy left": "Easy, left.",
    "easy right": "Easy, right.",
    "medium left": "Medium left.",
    "medium right": "Medium right.",
    left: "Medium left.",
    right: "Medium right.",
    "hard left": "Hard left!",
    "hard right": "Hard right!",
    "caution, hard left": "Hard left!",
    "caution, hard right": "Hard right!",
    "hairpin left": "Hard left!",
    "hairpin right": "Hard right!",
    jump: "Jump!",
    "over jump": "Jump!",
    "careful, jump": "Jump!",
    "careful jump": "Jump!",
    "into tunnel": "Into the tunnel.",
    "into the tunnel": "Into the tunnel.",
    "flat out": "Flat out.",
    "into gravel": "Into gravel.",
    "into mud": "Into mud, easy.",
    "cobbles": "Cobbles, caution.",
    "cobbles, caution": "Cobbles, caution.",
    narrow: "Narrow.",
    "into the trees": "Into the trees.",
    crest: "Crest.",
    "to the finish": "To the finish.",
    "to finish": "To the finish.",
    "game over, yeah": "Game over, yeah!",
    "game over yeah": "Game over, yeah!",
    whoa: "Whoa!",
    "try to take it easy on the car": "Try to take it easy on the car!",
  };
  if (said[key]) return said[key];
  return t.replace(/,/g, "").replace(/\s+/g, " ").trim() + (/\.|!$/.test(t) ? "" : ".");
}
