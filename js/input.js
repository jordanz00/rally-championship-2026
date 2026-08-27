/**
 * Input — keyboard + gamepad + phone overlay.
 *
 * WHO THIS IS FOR: anyone wiring controls.
 * WHAT IT DOES: samples WASD/arrows, analog stick, triggers, and handbrake each
 *   frame and publishes a bounded InputState.
 * HOW IT CONNECTS: GameLoop reads InputState; vehicle consumes steer/throttle/brake.
 *   On phones TouchControls.sample() fills the same axes when no key/pad is live.
 *
 * TRUST NOTHING RULE: every value that reaches the physics step is forced to a
 * finite number and clamped to its documented range before it leaves poll().
 * A pad with a broken axis, a driver reporting NaN, a key event with no `key`,
 * or a tab that lost focus mid-corner must not be able to inject a bad number
 * into the vehicle sim — a single NaN there would poison position and yaw
 * permanently, and no later clamp could recover it.
 */

/** Keys we swallow so the page does not scroll while you are driving. */
const CAPTURED = new Set([
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
  " ",
  "w",
  "a",
  "s",
  "d",
  "q",
  "e",
]);

/** Analog stick dead zone. Below this the stick reads as centred. */
const STICK_DEAD = 0.08;
/** Trigger threshold. Below this a trigger reads as released. */
const TRIGGER_DEAD = 0.12;

/**
 * Force any incoming value to a finite number in [lo, hi].
 * @param {unknown} v
 * @param {number} lo
 * @param {number} hi
 * @param {number} [fallback]
 */
function bounded(v, lo, hi, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n < lo ? lo : n > hi ? hi : n;
}

export class Input {
  constructor() {
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.handbrake = 0;
    this.shiftUp = false;
    this.shiftDown = false;
    this.camera = false;
    this.pause = false;
    this.confirm = false;
    this.back = false;
    this.reset = false;
    this.transToggle = false;
    /** Set by poll() the moment a human overrides a QA hold; game.js clears it. */
    this.qaReleased = false;
    this._qaHold = null;
    this._steerAnalog = 0;
    this._lastPoll = performance.now();
    this._padCamWas = false;
    this._padUpWas = false;
    this._padDownWas = false;

    this._keys = new Set();
    this._edge = new Set();
    this._padSteer = 0;
    this._padThrottle = 0;
    this._padBrake = 0;
    this._padHandbrake = 0;
    this._padCamEdge = false;
    this._padUpEdge = false;
    this._padDownEdge = false;
    this._touch = null;

    window.addEventListener("keydown", (e) => this._onKey(e, true));
    window.addEventListener("keyup", (e) => this._onKey(e, false));
    window.addEventListener("blur", () => this._release());
    // A hidden tab stops delivering keyup, which used to leave the throttle
    // pinned when you came back.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this._release();
    });
  }

  /**
   * Phone overlay (TouchControls). Optional — desktop never binds one.
   * @param {{sample: () => object} | null} overlay
   */
  bindTouch(overlay) {
    this._touch = overlay || null;
  }

  /** Drop every held key and pending edge. */
  _release() {
    this._keys.clear();
    this._edge.clear();
    this._steerAnalog = 0;
  }

  _onKey(e, down) {
    if (!e) return;
    const k = typeof e.key === "string" ? e.key.toLowerCase() : "";
    const code = typeof e.code === "string" ? e.code.toLowerCase() : "";
    if (!k && !code) return;
    const tag = e.target && e.target.tagName;
    const onField = tag === "INPUT" || tag === "TEXTAREA";
    if (!onField && (CAPTURED.has(k) || code === "space")) e.preventDefault();
    if (down) {
      if (k && !this._keys.has(k)) this._edge.add(k);
      if (code && !this._keys.has(code)) this._edge.add(code);
      if (k) this._keys.add(k);
      if (code) this._keys.add(code);
    } else {
      if (k) this._keys.delete(k);
      if (code) this._keys.delete(code);
    }
  }

  _held(name) {
    return this._keys.has(name);
  }

  _gasHeld() {
    return this._held("w") || this._held("keyw") || this._held("arrowup");
  }

  _brakeHeld() {
    return this._held("s") || this._held("keys") || this._held("arrowdown");
  }

  _pressed(name) {
    return this._edge.has(name);
  }

  poll() {
    this._readGamepad();
    const now = performance.now();
    // Bound the sample interval: a background tab or a debugger pause must not
    // hand the steering filter a multi-second step.
    const raw = Number.isFinite(now) ? (now - this._lastPoll) / 1000 : 0.016;
    const dt = bounded(raw, 0.008, 0.05, 0.016);
    this._lastPoll = Number.isFinite(now) ? now : this._lastPoll + dt * 1000;

    const left = this._held("a") || this._held("keya") || this._held("arrowleft");
    const right = this._held("d") || this._held("keyd") || this._held("arrowright");
    // +steer yaws the chassis right. A / left stick must therefore be +1.
    let keyTarget = 0;
    if (left && !right) keyTarget = 1;
    else if (right && !left) keyTarget = -1;

    /**
     * Digital keys are binary — snap on and off. Any release filter here stacked
     * with vehicle steer lag and read as multi-frame dead controls.
     */
    this._steerAnalog = keyTarget;
    if (!Number.isFinite(this._steerAnalog)) this._steerAnalog = 0;

    // Pad overrides the keyboard only once it is clearly off centre.
    const steer = Math.abs(this._padSteer) > 0.06 ? this._padSteer : this._steerAnalog;
    this.steer = bounded(steer, -1, 1);

    const keyGas = this._gasHeld();
    const keyBrake = this._brakeHeld();
    this.throttle = bounded(keyGas ? 1 : this._padThrottle, 0, 1);
    this.brake = bounded(keyBrake ? 1 : this._padBrake, 0, 1);
    const keyHand = this._held(" ") || this._held("space") || this._held("spacebar");
    this.handbrake = bounded(keyHand ? 1 : this._padHandbrake, 0, 1);

    // Q / E are the documented gear keys; Shift / Ctrl stay as legacy aliases.
    this.shiftUp = this._pressed("e") || this._pressed("keye") || this._pressed("shift") || this._padUpEdge;
    this.shiftDown =
      this._pressed("q") || this._pressed("keyq") || this._pressed("control") || this._padDownEdge;
    this.camera = this._pressed("c") || this._pressed("v") || this._padCamEdge;
    this.pause = this._pressed("p") || this._pressed("escape");
    this.transToggle = this._pressed("t");
    this.confirm = this._pressed("enter") || this._pressed(" ") || this._pressed("space");
    this.back = this._pressed("escape") || this._pressed("backspace");
    this.reset = this._pressed("r");

    const usingKeys = keyTarget !== 0 || keyGas || keyBrake || keyHand;
    const usingPad =
      Math.abs(this._padSteer) > 0.06 || this._padThrottle > 0.04 || this._padBrake > 0.04;
    const touch = this._touch && typeof this._touch.sample === "function" ? this._touch.sample() : null;
    if (touch && touch.active && !usingKeys && !usingPad) {
      this.steer = bounded(touch.steer, -1, 1);
      this.throttle = bounded(touch.throttle, 0, 1);
      this.brake = bounded(touch.brake, 0, 1);
      this.handbrake = bounded(Math.max(this.handbrake, touch.handbrake), 0, 1);
    }
    if (touch) {
      if (touch.pause) this.pause = true;
      if (touch.camera) this.camera = true;
    }

    // Headless QA hold. This used to claim a real key still won — it never did.
    // Being applied last, it overwrote every human input unconditionally, and a
    // QA run that was killed mid-drive left it latched on a live page: steering
    // was completely dead with nothing on screen to explain why. A hand on the
    // controls now always wins and retires the override for good, so no QA
    // state can outlive its run and silently take the car off the player.
    const qa = this._qaHold;
    if (qa && typeof qa === "object") {
      if (usingKeys || usingPad || (touch && touch.active)) {
        this._qaHold = null;
        this.qaReleased = true;
      } else {
        if (qa.throttle != null) this.throttle = bounded(qa.throttle, 0, 1);
        if (qa.steer != null) this.steer = bounded(qa.steer, -1, 1);
        if (qa.brake != null) this.brake = bounded(qa.brake, 0, 1);
        if (qa.handbrake != null) this.handbrake = bounded(qa.handbrake, 0, 1);
      }
    }

    this._edge.clear();
  }

  _readGamepad() {
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : null;
    const gp = pads && pads.length ? pads[0] : null;
    if (!gp || !gp.connected || !gp.axes || !gp.buttons) {
      this._padSteer = 0;
      this._padThrottle = 0;
      this._padBrake = 0;
      this._padHandbrake = 0;
      this._padCamEdge = false;
      this._padCamWas = false;
      this._padUpEdge = false;
      this._padUpWas = false;
      this._padDownEdge = false;
      this._padDownWas = false;
      return;
    }

    let sx = bounded(gp.axes[0], -1, 1);
    if (Math.abs(sx) < STICK_DEAD) {
      sx = 0;
    } else {
      // Mild curve — keep mid-stick linear enough for accurate corrections.
      const mag = Math.min(1, (Math.abs(sx) - STICK_DEAD) / (1 - STICK_DEAD));
      sx = Math.sign(sx) * Math.pow(mag, 1.05);
    }
    this._padSteer = bounded(-sx, -1, 1);

    const rt = this._button(gp, 7);
    const lt = this._button(gp, 6);
    this._padThrottle = rt > TRIGGER_DEAD ? rt : 0;
    this._padBrake = lt > TRIGGER_DEAD ? lt : 0;
    if (this._down(gp, 0)) this._padThrottle = 1;
    if (this._down(gp, 1)) this._padBrake = 1;
    this._padHandbrake = this._down(gp, 2) ? 1 : 0;

    const padCam = this._down(gp, 3) || this._down(gp, 8);
    this._padCamEdge = padCam && !this._padCamWas;
    this._padCamWas = padCam;
    // Shoulder buttons are the manual gearbox: RB up, LB down (into neutral).
    const padUp = this._down(gp, 5);
    const padDown = this._down(gp, 4);
    this._padUpEdge = padUp && !this._padUpWas;
    this._padUpWas = padUp;
    this._padDownEdge = padDown && !this._padDownWas;
    this._padDownWas = padDown;
  }

  /**
   * Analog value of a pad button, 0..1, safe against missing entries.
   * @param {Gamepad} gp
   * @param {number} i
   */
  _button(gp, i) {
    const b = gp.buttons[i];
    if (!b) return 0;
    if (typeof b === "number") return bounded(b, 0, 1);
    return bounded(b.value, 0, 1, b.pressed ? 1 : 0);
  }

  /**
   * Digital state of a pad button, safe against missing entries.
   * @param {Gamepad} gp
   * @param {number} i
   */
  _down(gp, i) {
    const b = gp.buttons[i];
    if (!b) return false;
    if (typeof b === "number") return b > 0.5;
    return !!b.pressed || bounded(b.value, 0, 1) > 0.5;
  }

  /**
   * Dual-shock / DualSense rumble when a pad is connected.
   * @param {number} mag 0..1
   * @param {number} [ms]
   */
  rumble(mag, ms) {
    const g = bounded(mag, 0, 1);
    if (g < 0.04) return;
    const duration = bounded(ms, 8, 400, 36);
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : null;
    if (!pads) return;
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      const act = pad && pad.vibrationActuator;
      if (!act || typeof act.playEffect !== "function") continue;
      try {
        act.playEffect("dual-rumble", {
          duration,
          strongMagnitude: g,
          weakMagnitude: g * 0.55,
        });
      } catch {
        /* some browsers expose the actuator but reject the effect */
      }
    }
  }
}
