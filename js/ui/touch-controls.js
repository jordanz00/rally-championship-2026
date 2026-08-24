/**
 * On-phone driving overlay — analog steer pad, pedals, optional tilt steer.
 *
 * WHO THIS IS FOR: iPhone Safari (and other coarse-pointer phones).
 * WHAT IT DOES: while a stage is live, paints hold-to-drive pedals and either
 *   a left-hand steer pad or DeviceOrientation roll-to-steer. Choice is a
 *   tap, not a settings hunt. iOS tilt permission is requested from that tap.
 * HOW IT CONNECTS: Input.poll() reads sample() after keyboard/gamepad.
 */

const STORE_MODE = "rally-steer-mode";
const STORE_SIGN = "rally-tilt-sign";

/**
 * True when this session should show phone controls.
 * iPad + keyboard still reports touches, so we also accept an explicit ?touch=1.
 */
export function isPhonePlay() {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get("touch") === "1") return true;
    if (q.get("touch") === "0") return false;
  } catch {
    /* ignore */
  }
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const phone = /iPhone|iPod|Android.+Mobile|webOS|BlackBerry/i.test(ua);
  const tablet = /iPad|Android(?!.*Mobile)/i.test(ua);
  const points = typeof navigator !== "undefined" ? navigator.maxTouchPoints || 0 : 0;
  return !!(coarse || phone || (tablet && points > 0) || (points > 1 && window.innerWidth < 980));
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
    this.hintEl = document.getElementById("orient-hint");
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
    if (this.root) this.root.hidden = !this.live;
    if (!this.live) {
      this.throttle = 0;
      this.brake = 0;
      this.handbrake = 0;
      this._padSteer = 0;
      this._steerPtr = null;
      this._updateKnob(0);
    } else {
      this._paintMode();
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

  _bind() {
    const hold = (el, key) => {
      if (!el) return;
      const down = (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* some browsers reject capture on non-primary */
        }
        this[key] = 1;
        el.classList.add("lit");
      };
      const up = (e) => {
        e.preventDefault();
        this[key] = 0;
        el.classList.remove("lit");
      };
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
      el.addEventListener("lostpointercapture", () => {
        this[key] = 0;
        el.classList.remove("lit");
      });
    };
    hold(this.gasEl, "throttle");
    hold(this.brakeEl, "brake");
    hold(this.hbEl, "handbrake");

    if (this.steerEl) {
      this.steerEl.addEventListener("pointerdown", (e) => this._steerDown(e));
      this.steerEl.addEventListener("pointermove", (e) => this._steerMove(e));
      this.steerEl.addEventListener("pointerup", (e) => this._steerUp(e));
      this.steerEl.addEventListener("pointercancel", (e) => this._steerUp(e));
    }

    if (this.pauseEl) {
      this.pauseEl.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this._pauseEdge = true;
      });
    }
    if (this.camEl) {
      this.camEl.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this._camEdge = true;
      });
    }
    if (this.modePadEl) {
      this.modePadEl.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this._setMode("touch");
      });
    }
    if (this.modeTiltEl) {
      this.modeTiltEl.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this._enableTilt();
      });
    }

    document.addEventListener(
      "touchmove",
      (e) => {
        if (!this.live) return;
        if (e.target && e.target.closest && e.target.closest("#touch-hud")) e.preventDefault();
      },
      { passive: false }
    );

    window.addEventListener("orientationchange", () => this._paintMode());
    window.addEventListener("resize", () => this._paintMode());
  }

  _steerDown(e) {
    if (this.mode === "tilt") return;
    e.preventDefault();
    e.stopPropagation();
    this._steerPtr = e.pointerId;
    try {
      this.steerEl.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    this._steerMove(e);
  }

  _steerMove(e) {
    if (this.mode === "tilt") return;
    if (this._steerPtr != null && e.pointerId !== this._steerPtr) return;
    if (!this.steerEl) return;
    const box = this.steerEl.getBoundingClientRect();
    const x = e.clientX - box.left;
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
   * Sign is calibrated to the same left = +steer convention as the A key.
   */
  _rollDegrees(ev) {
    const ang =
      (typeof screen !== "undefined" && screen.orientation && Number(screen.orientation.angle)) ||
      (typeof window !== "undefined" && Number(window.orientation)) ||
      0;
    if (ang === 90) return finite(ev.beta);
    if (ang === -90 || ang === 270) return -finite(ev.beta);
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
      this.root.classList.toggle("portrait", window.innerHeight > window.innerWidth + 40);
    }
    if (this.modePadEl) this.modePadEl.classList.toggle("on", this.mode === "touch");
    if (this.modeTiltEl) this.modeTiltEl.classList.toggle("on", this.mode === "tilt");
    if (this.hintEl) {
      const portrait = window.innerHeight > window.innerWidth + 80;
      this.hintEl.hidden = !this.live || !portrait;
    }
    if (this.mode === "touch") this._setTiltNote("");
  }
}
