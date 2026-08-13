/**
 * Input — keyboard + gamepad.
 *
 * WHO THIS IS FOR: anyone wiring controls.
 * WHAT IT DOES: samples WASD/arrows, analog stick, triggers, and handbrake each frame.
 * HOW IT CONNECTS: GameLoop reads InputState; vehicle consumes steer/throttle/brake.
 */

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

    this._keys = new Set();
    this._edge = new Set();
    this._padSteer = 0;
    this._padThrottle = 0;
    this._padBrake = 0;

    window.addEventListener("keydown", (e) => this._onKey(e, true));
    window.addEventListener("keyup", (e) => this._onKey(e, false));
    window.addEventListener("blur", () => this._keys.clear());
  }

  _onKey(e, down) {
    const k = e.key.toLowerCase();
    const code = e.code;
    if (
      [
        "arrowup",
        "arrowdown",
        "arrowleft",
        "arrowright",
        " ",
        "w",
        "a",
        "s",
        "d",
      ].includes(k) ||
      code === "Space"
    ) {
      e.preventDefault();
    }
    if (down) {
      if (!this._keys.has(k)) this._edge.add(k);
      this._keys.add(k);
      this._keys.add(code.toLowerCase());
    } else {
      this._keys.delete(k);
      this._keys.delete(code.toLowerCase());
    }
  }

  _held(name) {
    return this._keys.has(name);
  }

  _pressed(name) {
    return this._edge.has(name);
  }

  poll() {
    this._readGamepad();

    const left = this._held("a") || this._held("arrowleft");
    const right = this._held("d") || this._held("arrowright");
    let steer = 0;
    if (left) steer -= 1;
    if (right) steer += 1;
    if (Math.abs(this._padSteer) > 0.08) steer = this._padSteer;
    this.steer = Math.max(-1, Math.min(1, steer));

    const gas =
      this._held("w") || this._held("arrowup") ? 1 : this._padThrottle;
    const brk =
      this._held("s") || this._held("arrowdown") ? 1 : this._padBrake;
    this.throttle = Math.max(0, Math.min(1, gas));
    this.brake = Math.max(0, Math.min(1, brk));
    this.handbrake =
      this._held(" ") || this._held("space") || this._held("spacebar") ? 1 : 0;

    this.shiftUp = this._pressed("e") || this._pressed("shift");
    this.shiftDown = this._pressed("q") || this._pressed("control");
    this.camera = this._pressed("c");
    this.pause = this._pressed("p") || this._pressed("escape");
    this.confirm =
      this._pressed("enter") || this._pressed(" ") || this._pressed("space");
    this.back = this._pressed("escape") || this._pressed("backspace");
    this.reset = this._pressed("r");

    this._edge.clear();
  }

  _readGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads[0];
    if (!gp) {
      this._padSteer = 0;
      this._padThrottle = 0;
      this._padBrake = 0;
      return;
    }
    const dead = 0.12;
    let sx = gp.axes[0] || 0;
    if (Math.abs(sx) < dead) sx = 0;
    this._padSteer = sx;
    const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
    const lt = gp.buttons[6] ? gp.buttons[6].value : 0;
    this._padThrottle = rt;
    this._padBrake = lt;
    if (gp.buttons[0] && gp.buttons[0].pressed) this._padThrottle = 1;
    if (gp.buttons[1] && gp.buttons[1].pressed) this._padBrake = 1;
    if (gp.buttons[2] && gp.buttons[2].pressed) this.handbrake = 1;
  }
}
