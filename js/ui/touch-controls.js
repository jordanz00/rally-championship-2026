/**
 * On-phone driving overlay — analog steer pad, pedals, optional tilt steer.
 *
 * WHO THIS IS FOR: iPhone Safari AND Android Chrome (same controls, same budget).
 * WHAT IT DOES: hold-to-drive pedals + left steer pad (or DeviceOrientation tilt).
 *   Multi-touch safe: gas stays lit while the other thumb steers.
 * HOW IT CONNECTS: Input.poll() reads sample() after keyboard/gamepad.
 */

const STORE_MODE = "rally-steer-mode";
const STORE_SIGN = "rally-tilt-sign";

/**
 * True when this session should show phone controls.
 * iPhone / Android phones, coarse pointers, iPads, and Android tablets.
 * Desktop can force with ?touch=1; phones can opt out with ?touch=0.
 */
export function isPhonePlay() {
  if (typeof window === "undefined") return false;
  if (window.__rallyPhoneLite === true) return true;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("touch") === "1") return true;
    if (q.get("touch") === "0") return false;
  } catch {
    /* ignore */
  }
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const phone = /iPhone|iPod|Android.+Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  const tablet = /iPad|Android(?!.*Mobile)|Tablet|Silk/i.test(ua);
  const points = typeof navigator !== "undefined" ? navigator.maxTouchPoints || 0 : 0;
  const iosTouchMac =
    points > 0 &&
    /Macintosh/i.test(ua) &&
    typeof document !== "undefined" &&
    "ontouchend" in document;
  const iPadOs = points > 1 && /Macintosh/i.test(ua);
  const lite = !!(
    coarse ||
    phone ||
    iPadOs ||
    iosTouchMac ||
    (tablet && points > 0) ||
    (points > 1 && window.innerWidth < 980)
  );
  if (lite) {
    try {
      window.__rallyPhoneLite = true;
      if (typeof document !== "undefined") document.documentElement.classList.add("is-phone");
    } catch {
      /* ignore */
    }
  }
  return lite;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function finite(v, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export class TouchControls {
  /**
   * @param {import("../input.js").Input} input
   */
  constructor(input) {
    this.input = input;
    this.enabled = isPhonePlay();
    this.live = false;
    this.mode = "touch";
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.steer = 0;
    this._tiltSteer = 0;
    this._padSteer = 0;
    this._pauseEdge = false;
    this._camEdge = false;
    this._steerPtr = null;
    /** @type {Record<string, number|null>} */
    this._holdPtr = { throttle: null, brake: null, handbrake: null };
    this._tiltZero = 0;
    this._tiltCalib = [];
    this._tiltSign = 1;
    this._orientOn = false;

    if (typeof document !== "undefined") {
      document.body.classList.toggle("is-mobile", this.enabled);
    }

    try {
      const saved = localStorage.getItem(STORE_MODE);
      if (saved === "tilt" || saved === "touch") this.mode = saved;
      const signRaw = localStorage.getItem(STORE_SIGN);
      if (signRaw === "-1") this._tiltSign = -1;
      else if (signRaw === "1") this._tiltSign = 1;
    } catch {
      /* private mode */
    }

    this.root = document.getElementById("touch-hud");
    this.steerEl = document.getElementById("touch-steer");
    this.knobEl = document.getElementById("touch-steer-knob");
    this.gasEl = document.getElementById("touch-gas");
    this.brakeEl = document.getElementById("touch-brake");
    this.hbEl = document.getElementById("touch-hb");
    this.pauseEl = document.getElementById("touch-pause");
    this.camEl = document.getElementById("touch-cam");
    this.modePadEl = document.getElementById("touch-mode-pad");
    this.modeTiltEl = document.getElementById("touch-mode-tilt");
    this.tiltNoteEl = document.getElementById("touch-tilt-note");

    if (this.enabled && this.root) this._bind();
    this._paintMode();
    if (input && typeof input.bindTouch === "function") input.bindTouch(this);
  }

  /**
   * Show only during countdown + race so menus stay tappable.
   * @param {boolean} live
   */
  setLive(live) {
    this.live = !!live && this.enabled;
    if (this.root) {
      this.root.hidden = !this.live;
      this.root.classList.toggle("is-live", this.live);
    }
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("touch-driving", this.live);
    }
    if (!this.live) {
      this.throttle = 0;
      this.brake = 0;
      this.handbrake = 0;
      this._padSteer = 0;
      this._steerPtr = null;
      this._holdPtr.throttle = null;
      this._holdPtr.brake = null;
      this._holdPtr.handbrake = null;
      this._updateKnob(0);
      if (this.gasEl) this.gasEl.classList.remove("lit");
      if (this.brakeEl) this.brakeEl.classList.remove("lit");
      if (this.hbEl) this.hbEl.classList.remove("lit");
    } else {
      this._paintMode();
      this._unlockAudio();
    }
  }

  /**
   * Snapshot consumed by Input.poll(). Edges are one-shot.
   */
  sample() {
    const pause = this._pauseEdge;
    const camera = this._camEdge;
    this._pauseEdge = false;
    this._camEdge = false;
    const steer = this.mode === "tilt" ? this._tiltSteer : this._padSteer;
    return {
      active: this.live,
      mode: this.mode,
      steer: clamp(finite(steer), -1, 1),
      throttle: this.live ? clamp(this.throttle, 0, 1) : 0,
      brake: this.live ? clamp(this.brake, 0, 1) : 0,
      handbrake: this.live ? clamp(this.handbrake, 0, 1) : 0,
      pause,
      camera,
    };
  }

  _unlockAudio() {
    try {
      const g = typeof window !== "undefined" ? window.game : null;
      if (g && g.audio && typeof g.audio.unlock === "function") g.audio.unlock();
      else if (g && g.audio && g.audio.ctx && g.audio.ctx.state === "suspended") g.audio.ctx.resume();
    } catch {
      /* ignore */
    }
  }

  _bind() {
    const hold = (el, key) => {
      if (!el) return;
      const down = (e) => {
        if (!this.live) return;
        e.preventDefault();
        e.stopPropagation();
        const pid = e.pointerId != null ? e.pointerId : 1;
        this._holdPtr[key] = pid;
        this[key] = 1;
        el.classList.add("lit");
        this._unlockAudio();
        // Capture ONLY on this element — do not steal sibling pedal pointers.
        try {
          if (el.setPointerCapture && e.pointerId != null) el.setPointerCapture(e.pointerId);
        } catch {
          /* Android WebView may reject */
        }
      };
      const up = (e) => {
        const pid = e.pointerId != null ? e.pointerId : this._holdPtr[key];
        if (this._holdPtr[key] != null && pid != null && pid !== this._holdPtr[key]) return;
        e.preventDefault();
        this._holdPtr[key] = null;
        this[key] = 0;
        el.classList.remove("lit");
        try {
          if (el.releasePointerCapture && e.pointerId != null) el.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      };
      // Do NOT clear on lostpointercapture — Android fires that when the
      // other thumb starts steering, which used to kill GAS mid-corner.
      el.addEventListener("pointerdown", down, { passive: false });
      el.addEventListener("pointerup", up, { passive: false });
      el.addEventListener("pointercancel", up, { passive: false });
      // Legacy Android WebView fallback (no Pointer Events).
      el.addEventListener(
        "touchstart",
        (e) => {
          if (!this.live || !e.changedTouches || !e.changedTouches[0]) return;
          e.preventDefault();
          this._holdPtr[key] = e.changedTouches[0].identifier;
          this[key] = 1;
          el.classList.add("lit");
          this._unlockAudio();
        },
        { passive: false }
      );
      el.addEventListener(
        "touchend",
        (e) => {
          if (!e.changedTouches) return;
          for (let i = 0; i < e.changedTouches.length; i++) {
            const id = e.changedTouches[i].identifier;
            if (this._holdPtr[key] === id) {
              e.preventDefault();
              this._holdPtr[key] = null;
              this[key] = 0;
              el.classList.remove("lit");
              break;
            }
          }
        },
        { passive: false }
      );
      el.addEventListener(
        "touchcancel",
        () => {
          this._holdPtr[key] = null;
          this[key] = 0;
          el.classList.remove("lit");
        },
        { passive: false }
      );
    };
    hold(this.gasEl, "throttle");
    hold(this.brakeEl, "brake");
    hold(this.hbEl, "handbrake");

    if (this.steerEl) {
      this.steerEl.addEventListener("pointerdown", (e) => this._steerDown(e), { passive: false });
      this.steerEl.addEventListener("pointermove", (e) => this._steerMove(e), { passive: false });
      this.steerEl.addEventListener("pointerup", (e) => this._steerUp(e), { passive: false });
      this.steerEl.addEventListener("pointercancel", (e) => this._steerUp(e), { passive: false });
      this.steerEl.addEventListener(
        "touchstart",
        (e) => {
          if (!this.live || this.mode === "tilt" || !e.changedTouches || !e.changedTouches[0]) return;
          e.preventDefault();
          const t = e.changedTouches[0];
          this._steerPtr = t.identifier;
          this._steerFromClientX(t.clientX);
        },
        { passive: false }
      );
      this.steerEl.addEventListener(
        "touchmove",
        (e) => {
          if (this.mode === "tilt" || this._steerPtr == null || !e.changedTouches) return;
          for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === this._steerPtr) {
              e.preventDefault();
              this._steerFromClientX(e.changedTouches[i].clientX);
              break;
            }
          }
        },
        { passive: false }
      );
      this.steerEl.addEventListener(
        "touchend",
        (e) => {
          if (this._steerPtr == null || !e.changedTouches) return;
          for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === this._steerPtr) {
              e.preventDefault();
              this._steerPtr = null;
              this._padSteer = 0;
              this._updateKnob(0);
              break;
            }
          }
        },
        { passive: false }
      );
    }

    const chip = (el, fn) => {
      if (!el) return;
      el.addEventListener(
        "pointerdown",
        (e) => {
          e.preventDefault();
          fn();
        },
        { passive: false }
      );
    };
    chip(this.pauseEl, () => {
      this._pauseEdge = true;
    });
    chip(this.camEl, () => {
      this._camEdge = true;
    });
    chip(this.modePadEl, () => this._setMode("touch"));
    chip(this.modeTiltEl, () => this._enableTilt());

    document.addEventListener(
      "touchmove",
      (e) => {
        if (!this.live) return;
        if (e.target && e.target.closest && e.target.closest("#touch-hud")) e.preventDefault();
      },
      { passive: false }
    );

    // Stop Android Chrome from scrolling the page under the race HUD.
    document.addEventListener(
      "gesturestart",
      (e) => {
        if (this.live) e.preventDefault();
      },
      { passive: false }
    );

    window.addEventListener("orientationchange", () => {
      setTimeout(() => this._paintMode(), 120);
    });
    window.addEventListener("resize", () => this._paintMode());
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => this._paintMode());
    }
  }

  _steerDown(e) {
    if (this.mode === "tilt") return;
    e.preventDefault();
    e.stopPropagation();
    this._steerPtr = e.pointerId;
    this._unlockAudio();
    try {
      this.steerEl.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this._steerFromClientX(e.clientX);
  }

  _steerMove(e) {
    if (this.mode === "tilt") return;
    if (this._steerPtr != null && e.pointerId !== this._steerPtr) return;
    e.preventDefault();
    this._steerFromClientX(e.clientX);
  }

  _steerFromClientX(clientX) {
    if (!this.steerEl) return;
    const box = this.steerEl.getBoundingClientRect();
    const x = clientX - box.left;
    const mid = box.width * 0.5;
    const span = Math.max(36, mid * 0.92);
    // Match keyboard: A / left = +steer (yaw right in this sim).
    const t = clamp((mid - x) / span, -1, 1);
    this._padSteer = t;
    this._updateKnob(t);
  }

  _steerUp(e) {
    if (this._steerPtr != null && e.pointerId !== this._steerPtr) return;
    this._steerPtr = null;
    this._padSteer = 0;
    this._updateKnob(0);
  }

  _updateKnob(t) {
    if (!this.knobEl || !this.steerEl) return;
    const w = this.steerEl.clientWidth || 160;
    this.knobEl.style.transform = `translate(${(-t * (w * 0.38)).toFixed(1)}px, 0)`;
  }

  async _enableTilt() {
    this._tiltCalib = [];
    this._tiltZero = 0;
    const DOE = typeof window !== "undefined" ? window.DeviceOrientationEvent : null;
    if (DOE && typeof DOE.requestPermission === "function") {
      try {
        const perm = await DOE.requestPermission();
        if (perm !== "granted") {
          this._setTiltNote("Tilt blocked — allow motion, or use STEER");
          this._setMode("touch");
          return;
        }
      } catch {
        this._setTiltNote("Tilt needs a tap to allow motion access");
        this._setMode("touch");
        return;
      }
    }
    this._listenTilt();
    this._setMode("tilt");
    this._setTiltNote("Tilt the phone like a wheel · GAS / BRAKE stay on the right");
  }

  _listenTilt() {
    if (this._orientOn) return;
    this._orientOn = true;
    this._onOrient = (ev) => this._tiltFromEvent(ev);
    window.addEventListener("deviceorientation", this._onOrient, true);
    window.addEventListener("deviceorientationabsolute", this._onOrient, true);
  }

  _tiltFromEvent(ev) {
    if (!ev || this.mode !== "tilt") return;
    const raw = this._rollDegrees(ev);
    if (!Number.isFinite(raw)) return;
    if (this._tiltCalib.length < 14) {
      this._tiltCalib.push(raw);
      this._tiltZero = this._tiltCalib.reduce((s, v) => s + v, 0) / this._tiltCalib.length;
    }
    const deg = (raw - this._tiltZero) * this._tiltSign;
    const dead = 4.5;
    const span = 32;
    const a = Math.abs(deg);
    let t = 0;
    if (a > dead) {
      const u = Math.min(1, (a - dead) / (span - dead));
      t = Math.sign(deg) * u;
    }
    this._tiltSteer = t;
  }

  /**
   * Roll like a steering wheel. Landscape uses beta; portrait uses gamma.
   * Android often reports screen.orientation.angle; iOS uses window.orientation.
   */
  _rollDegrees(ev) {
    let ang = 0;
    try {
      if (typeof screen !== "undefined" && screen.orientation && Number.isFinite(screen.orientation.angle)) {
        ang = Number(screen.orientation.angle);
      } else if (typeof window !== "undefined" && Number.isFinite(window.orientation)) {
        ang = Number(window.orientation);
      }
    } catch {
      ang = 0;
    }
    // Prefer gamma in portrait (including Android 0°).
    if (ang === 90) return finite(ev.beta);
    if (ang === -90 || ang === 270) return -finite(ev.beta);
    // Some Android Chrome landscape reports 0 until rotated — use aspect.
    if (typeof window !== "undefined" && window.innerWidth > window.innerHeight + 40) {
      return finite(ev.beta != null ? ev.beta : ev.gamma);
    }
    return finite(ev.gamma);
  }

  _setMode(mode) {
    this.mode = mode === "tilt" ? "tilt" : "touch";
    if (this.mode === "touch") this._tiltSteer = 0;
    try {
      localStorage.setItem(STORE_MODE, this.mode);
    } catch {
      /* ignore */
    }
    this._paintMode();
  }

  _setTiltNote(msg) {
    if (this.tiltNoteEl) this.tiltNoteEl.textContent = msg || "";
  }

  _paintMode() {
    if (this.root) {
      this.root.classList.toggle("tilt-on", this.mode === "tilt");
      const h =
        (window.visualViewport && window.visualViewport.height) || window.innerHeight || 0;
      const w =
        (window.visualViewport && window.visualViewport.width) || window.innerWidth || 0;
      this.root.classList.toggle("portrait", h > w + 40);
      // Keep pedals above the Android Chrome URL bar using visualViewport.
      if (window.visualViewport && this.live) {
        const inset = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
        this.root.style.setProperty("--touch-chrome-inset", `${inset.toFixed(0)}px`);
      } else {
        this.root.style.setProperty("--touch-chrome-inset", "0px");
      }
    }
    if (this.modePadEl) this.modePadEl.classList.toggle("on", this.mode === "touch");
    if (this.modeTiltEl) this.modeTiltEl.classList.toggle("on", this.mode === "tilt");
    if (this.mode === "touch") this._setTiltNote("");
  }
}
