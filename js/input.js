/**
 * Input — keyboard + gamepad + phone overlay.
 *
 * WHO THIS IS FOR: anyone wiring controls.
 * WHAT IT DOES: samples WASD/arrows, analog stick, triggers, and handbrake each
 *   frame and publishes a bounded InputState. DualShock / DualSense over
 *   Bluetooth is scanned in every gamepad slot (not only index 0) with both
 *   Standard Gamepad and Sony HID layouts.
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
    this._padConfirmWas = false;
    this._padBackWas = false;
    this._padPauseWas = false;
    /** Last Gamepad.index from `gamepadconnected` — DualShock BT is often not slot 0. */
    this._padIndex = -1;
    /** Detected analog trigger axes (Sony HID rests at -1). */
    this._padTrigAxes = null;

    this._keys = new Set();
    this._edge = new Set();
    this._padSteer = 0;
    this._padThrottle = 0;
    this._padBrake = 0;
    this._padHandbrake = 0;
    this._padCamEdge = false;
    this._padUpEdge = false;
    this._padDownEdge = false;
    this._padConfirmEdge = false;
    this._padBackEdge = false;
    this._padPauseEdge = false;
    this._touch = null;

    window.addEventListener("keydown", (e) => this._onKey(e, true));
    window.addEventListener("keyup", (e) => this._onKey(e, false));
    window.addEventListener("blur", () => this._release());
    window.addEventListener("gamepadconnected", (e) => {
      if (!e || !e.gamepad) return;
      this._padIndex = e.gamepad.index;
      this._padTrigAxes = null;
    });
    window.addEventListener("gamepaddisconnected", (e) => {
      if (!e || !e.gamepad) return;
      if (e.gamepad.index === this._padIndex) {
        this._padIndex = -1;
        this._padTrigAxes = null;
      }
    });
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
    this.pause = this._pressed("p") || this._pressed("escape") || this._padPauseEdge;
    this.transToggle = this._pressed("t");
    this.confirm =
      this._pressed("enter") || this._pressed(" ") || this._pressed("space") || this._padConfirmEdge;
    this.back = this._pressed("escape") || this._pressed("backspace") || this._padBackEdge;
    this.reset = this._pressed("r");

    const usingKeys = keyTarget !== 0 || keyGas || keyBrake || keyHand;
    const usingPad =
      Math.abs(this._padSteer) > 0.06 ||
      this._padThrottle > 0.04 ||
      this._padBrake > 0.04 ||
      this._padHandbrake > 0.04;
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

  /**
   * Live pad. DualShock over Bluetooth is often not `pads[0]` — rumble already
   * walked every slot; driving used to ignore those extra indices, so the
   * controller vibrated and did nothing else.
   * @returns {Gamepad | null}
   */
  _pickGamepad() {
    const pads = typeof navigator.getGamepads === "function" ? navigator.getGamepads() : null;
    if (!pads || !pads.length) return null;
    const preferred = this._padIndex >= 0 ? pads[this._padIndex] : null;
    if (this._padLooksDriveable(preferred)) return preferred;
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!this._padLooksDriveable(p)) continue;
      let score = p.buttons.length + p.axes.length;
      if (p.mapping === "standard") score += 24;
      if (p.vibrationActuator) score += 8;
      if (this._isSonyPad(p)) score += 12;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  /**
   * @param {Gamepad | null | undefined} gp
   * @returns {boolean}
   */
  _padLooksDriveable(gp) {
    return !!(
      gp &&
      gp.connected &&
      gp.axes &&
      gp.axes.length >= 2 &&
      gp.buttons &&
      gp.buttons.length >= 6
    );
  }

  /**
   * DualShock / DualSense / generic Sony HID, including empty `mapping`.
   * @param {Gamepad} gp
   */
  _isSonyPad(gp) {
    const id = typeof gp.id === "string" ? gp.id.toLowerCase() : "";
    return /054c|09cc|0ce6|dualshock|dualsense|playstation|wireless controller|sony/.test(id);
  }

  /**
   * Unmapped Sony HID: Square/Cross/Circle/Triangle, not the W3C A/B/X/Y order.
   * @param {Gamepad} gp
   */
  _sonyRawLayout(gp) {
    return this._isSonyPad(gp) && gp.mapping !== "standard";
  }

  /**
   * Sony analog triggers rest at -1 and travel to +1. Sticks rest at 0 — never
   * convert those or a centred stick becomes half throttle.
   * @param {Gamepad} gp
   * @returns {{ l: number | null, r: number | null }}
   */
  _triggerAxes(gp) {
    const prev = this._padTrigAxes;
    if (
      prev &&
      prev.index === gp.index &&
      prev.id === gp.id &&
      (prev.l != null || prev.r != null)
    ) {
      return prev;
    }
    const found = [];
    const n = Math.min(gp.axes.length, 6);
    for (let i = 2; i < n; i++) {
      const a = gp.axes[i];
      if (typeof a === "number" && Number.isFinite(a) && a < -0.82) found.push(i);
    }
    const rec = {
      id: gp.id,
      index: gp.index,
      l: found.length >= 2 ? found[0] : null,
      r: found.length >= 2 ? found[1] : found.length === 1 ? found[0] : null,
    };
    this._padTrigAxes = rec;
    return rec;
  }

  /**
   * @param {number} a axis in [-1, 1], Sony trigger rest = -1
   */
  _axisAsTrigger(a) {
    return bounded((a + 1) * 0.5, 0, 1);
  }

  _clearPad() {
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
    this._padConfirmEdge = false;
    this._padConfirmWas = false;
    this._padBackEdge = false;
    this._padBackWas = false;
    this._padPauseEdge = false;
    this._padPauseWas = false;
  }

  _readGamepad() {
    const gp = this._pickGamepad();
    if (!gp) {
      this._clearPad();
      return;
    }

    let sx = bounded(gp.axes[0], -1, 1);
    if (Math.abs(sx) < STICK_DEAD) {
      // D-pad when the stick is centred (Bluetooth DS4 often prefers the hat).
      const dLeft = this._down(gp, 14) || this._down(gp, 16);
      const dRight = this._down(gp, 15) || this._down(gp, 17);
      if (dLeft && !dRight) sx = -1;
      else if (dRight && !dLeft) sx = 1;
      else sx = 0;
    } else {
      // Mild curve — keep mid-stick linear enough for accurate corrections / flicks.
      const mag = Math.min(1, (Math.abs(sx) - STICK_DEAD) / (1 - STICK_DEAD));
      sx = Math.sign(sx) * Math.pow(mag, 1.08);
    }
    this._padSteer = bounded(-sx, -1, 1);

    const trig = this._triggerAxes(gp);
    let rt = this._button(gp, 7);
    let lt = this._button(gp, 6);
    if (trig.r != null && trig.r < gp.axes.length) {
      rt = Math.max(rt, this._axisAsTrigger(bounded(gp.axes[trig.r], -1, 1)));
    }
    if (trig.l != null && trig.l < gp.axes.length) {
      lt = Math.max(lt, this._axisAsTrigger(bounded(gp.axes[trig.l], -1, 1)));
    }
    this._padThrottle = rt > TRIGGER_DEAD ? rt : 0;
    this._padBrake = lt > TRIGGER_DEAD ? lt : 0;

    const sonyRaw = this._sonyRawLayout(gp);
    // Standard Gamepad: 0=A/Cross gas, 1=B/Circle brake, 2=X/Square handbrake.
    // Sony HID: 0=Square, 1=Cross, 2=Circle, 3=Triangle — Cross is gas.
    const faceGas = sonyRaw ? 1 : 0;
    const faceBrake = sonyRaw ? 2 : 1;
    const faceHand = sonyRaw ? 0 : 2;
    if (this._down(gp, faceGas)) this._padThrottle = 1;
    if (this._down(gp, faceBrake)) this._padBrake = 1;
    this._padHandbrake = this._down(gp, faceHand) || this._down(gp, 10) ? 1 : 0;

    const padCam = this._down(gp, 3) || this._down(gp, 8);
    this._padCamEdge = padCam && !this._padCamWas;
    this._padCamWas = padCam;
    const padConfirm = this._down(gp, faceGas);
    this._padConfirmEdge = padConfirm && !this._padConfirmWas;
    this._padConfirmWas = padConfirm;
    const padBack = this._down(gp, faceBrake);
    this._padBackEdge = padBack && !this._padBackWas;
    this._padBackWas = padBack;
    const padPause = this._down(gp, 9);
    this._padPauseEdge = padPause && !this._padPauseWas;
    this._padPauseWas = padPause;
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
