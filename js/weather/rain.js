/**
 * Mountain rain — camera streaks, wet road, intermittent POV wipers.
 *
 * WHO THIS IS FOR: the race loop on Mountain (or ?rain=1).
 * WHAT IT DOES: world streaks, wet asphalt, and windshield beads that slide
 *   with live car dynamics (speed, brake, yaw, slide) and die under the blades.
 * HOW IT CONNECTS: game.js constructs StageWeather once, enables it on
 *   Mountain, and steps after the chase camera. Does not touch Track.query.
 *
 * BUDGET: 360 line segments + ≤260 2D droplets on a 512 canvas. POV only.
 */

import * as THREE from "../../vendor/three.module.js";
import { setWorldRoadWetness } from "../gfx/pbr.js?v=53";

const STREAK_COUNT = 360;
const DROP_MAX = 260;
const FALL = new THREE.Vector3(-0.12, -1, 0.04).normalize();
const WIPER_FAR = 1.12;
const WIPER_PARK = 0.08;
/** Angular half-width of the rubber (rad) — thick enough to clear a visible path. */
const BLADE_HALF_W = 0.085;
/** Keep the top of the glass clear for the rearview / header. */
const MIRROR_BAND_V = 0.14;

/**
 * URL override: ?rain=1 forces weather; ?rain=0 disables it.
 * @returns {boolean|null}
 */
export function rainQueryFlag() {
  try {
    const q = new URLSearchParams(globalThis.location?.search || "");
    const raw = (q.get("rain") || "").toLowerCase();
    if (raw === "1" || raw === "true" || raw === "on") return true;
    if (raw === "0" || raw === "false" || raw === "off") return false;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Championship rain stage — third cup race (Desert → Forest → Mountain).
 * @param {string} courseId
 * @returns {boolean}
 */
export function courseWantsRain(courseId) {
  const flag = rainQueryFlag();
  if (flag === false) return false;
  if (flag === true) return true;
  return courseId === "mountain";
}

export class StageWeather {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.active = false;
    this.intensity = 0;
    this._cycle = 0;
    this._wiperT = 0;
    this._wiperAng = 0.08;
    this._wipeOn = false;
    this._drops = [];
    this._spawnAcc = 0;
    this._prevSpeed = 0;
    this._cam = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._a = new THREE.Vector3();

    this.pos = new Float32Array(STREAK_COUNT * 6);
    this.life = new Float32Array(STREAK_COUNT);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({
      color: 0xb8c8d6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });
    this.lines = new THREE.LineSegments(this.geo, this.mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 4;
    this.lines.visible = false;
    scene.add(this.lines);

    for (let i = 0; i < STREAK_COUNT; i++) this._respawn(i, true);
  }

  /**
   * @param {boolean} on
   * @param {THREE.Object3D|null} [trackGroup]
   */
  setActive(on, trackGroup = null) {
    this.active = !!on;
    if (!this.active) {
      this.intensity = 0;
      this.lines.visible = false;
      this.mat.opacity = 0;
      this._drops.length = 0;
      if (trackGroup) setWorldRoadWetness(trackGroup, 0);
    }
  }

  /**
   * @param {number} dt
   * @param {{
   *   camera: THREE.Camera,
   *   car?: THREE.Object3D|null,
   *   pov?: boolean,
   *   audio?: {setRain?: Function}|null,
   *   trackGroup?: THREE.Object3D|null,
   *   speed?: number,
   *   slide?: number,
   *   yawRate?: number,
   *   brake?: number,
   *   throttle?: number,
   *   pitch?: number,
   *   ax?: number,
   * }} opts
   */
  step(dt, opts) {
    const t = Math.max(0.001, Math.min(0.05, dt || 1 / 60));
    if (!this.active) {
      if (opts.audio && opts.audio.setRain) opts.audio.setRain(0);
      return;
    }

    this._cycle += t;
    // Intermittent showers: build, peak, fade, lull — not a constant grey wall.
    const per = 26;
    const u = (this._cycle % per) / per;
    let target = 0.18;
    if (u < 0.18) target = 0.2 + (u / 0.18) * 0.45;
    else if (u < 0.42) target = 0.65 + Math.sin((u - 0.18) * 12) * 0.12;
    else if (u < 0.62) target = 0.72 - ((u - 0.42) / 0.2) * 0.4;
    else if (u < 0.78) target = 0.22;
    else target = 0.08;
    this.intensity += (target - this.intensity) * Math.min(1, t * 1.8);

    const wet = 0.28 + this.intensity * 0.72;
    if (opts.trackGroup) setWorldRoadWetness(opts.trackGroup, wet);
    if (opts.audio && opts.audio.setRain) opts.audio.setRain(this.intensity);

    this._stepStreaks(t, opts.camera, opts.speed || 0);
    this._stepWipers(t, opts.car, opts.pov, this.intensity, opts);
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {number} speedMs
   */
  _stepStreaks(dt, camera, speedMs) {
    if (!camera) return;
    camera.getWorldPosition(this._cam);
    camera.getWorldDirection(this._fwd);
    this._up.set(0, 1, 0);
    this._right.crossVectors(this._fwd, this._up).normalize();
    this._up.crossVectors(this._right, this._fwd).normalize();

    const kmh = Math.max(0, speedMs) * 3.6;
    const speed = 14 + this.intensity * 18 + kmh * 0.06;
    const len = 0.28 + this.intensity * 0.38 + Math.min(0.45, kmh * 0.004);
    let live = 0;
    for (let i = 0; i < STREAK_COUNT; i++) {
      const i6 = i * 6;
      this.pos[i6 + 1] += FALL.y * speed * dt;
      this.pos[i6] += FALL.x * speed * dt;
      this.pos[i6 + 2] += FALL.z * speed * dt;
      this.pos[i6 + 3] = this.pos[i6] + FALL.x * len;
      this.pos[i6 + 4] = this.pos[i6 + 1] + FALL.y * len;
      this.pos[i6 + 5] = this.pos[i6 + 2] + FALL.z * len;
      const dx = this.pos[i6] - this._cam.x;
      const dy = this.pos[i6 + 1] - this._cam.y;
      const dz = this.pos[i6 + 2] - this._cam.z;
      if (dy < -5 || dx * dx + dz * dz > 520) {
        this._respawn(i, false);
      } else {
        live++;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    const show = this.intensity > 0.06 && live > 0;
    this.lines.visible = show;
    this.mat.opacity = show ? 0.1 + this.intensity * 0.22 : 0;
  }

  /**
   * @param {number} i
   * @param {boolean} scatter
   */
  _respawn(i, scatter) {
    const along = 2 + Math.random() * 22;
    const side = (Math.random() - 0.5) * 16;
    const lift = scatter ? (Math.random() - 0.2) * 10 : 6 + Math.random() * 7;
    this._a.copy(this._cam).addScaledVector(this._fwd, along).addScaledVector(this._right, side);
    this._a.y = this._cam.y + lift;
    const i6 = i * 6;
    this.pos[i6] = this._a.x;
    this.pos[i6 + 1] = this._a.y;
    this.pos[i6 + 2] = this._a.z;
    this.pos[i6 + 3] = this._a.x + FALL.x * 0.45;
    this.pos[i6 + 4] = this._a.y + FALL.y * 0.45;
    this.pos[i6 + 5] = this._a.z + FALL.z * 0.45;
  }

  /**
   * @param {number} dt
   * @param {THREE.Object3D|null|undefined} car
   * @param {boolean|undefined} pov
   * @param {number} rain
   * @param {object} opts
   */
  _stepWipers(dt, car, pov, rain, opts) {
    if (!car || !car.userData) return;
    const speedMs = opts.speed || 0;
    const raining = rain > 0.1;
    if (!raining && !this._wipeOn) {
      this._parkWipers(car);
      this._setWeatherVisible(car, !!pov);
      if (pov) this._paintDrops(car, true);
      return;
    }

    this._wiperT += dt;
    // Heavier rain → shorter rest so the blades stay in the story.
    const rest = rain > 0.55 ? 1.05 : 2.05;
    const out = 0.42;
    const dwell = 0.08;
    const back = 0.4;
    const cycle = rest + out + dwell + back;
    if (this._wiperT > cycle) this._wiperT -= cycle;
    const t = this._wiperT;
    const park = WIPER_PARK;
    const far = car.userData.wiperFar != null ? car.userData.wiperFar : WIPER_FAR;
    let ang = park;
    this._wipeOn = false;
    if (t > rest && t <= rest + out) {
      const k = (t - rest) / out;
      ang = park + (far - park) * (0.5 - 0.5 * Math.cos(Math.min(1, k) * Math.PI));
      this._wipeOn = true;
    } else if (t > rest + out && t <= rest + out + dwell) {
      ang = far;
      this._wipeOn = true;
    } else if (t > rest + out + dwell) {
      const k = (t - rest - out - dwell) / back;
      ang = far + (park - far) * (0.5 - 0.5 * Math.cos(Math.min(1, k) * Math.PI));
      this._wipeOn = true;
    }
    this._wiperAng = ang;
    const left = car.userData.wiperL;
    const right = car.userData.wiperR;
    const parkL = left && left.userData.parkZ != null ? left.userData.parkZ : 0.08;
    const parkR = right && right.userData.parkZ != null ? right.userData.parkZ : Math.PI - 0.08;
    if (left) left.rotation.z = parkL + ang;
    if (right) right.rotation.z = parkR - ang;

    this._setWeatherVisible(car, !!pov);
    if (!pov) return;

    const dyn = {
      speed: speedMs,
      slide: opts.slide || 0,
      yawRate: opts.yawRate || 0,
      brake: opts.brake || 0,
      throttle: opts.throttle || 0,
      pitch: opts.pitch || 0,
      ax: opts.ax != null ? opts.ax : (speedMs - this._prevSpeed) / Math.max(dt, 0.001),
    };
    this._prevSpeed = speedMs;

    if (raining) this._spawnDrops(dt, rain, dyn);
    this._slideDrops(dt, dyn);
    if (this._wipeOn) this._wipeDrops(car);
    this._paintDrops(car, false);
  }

  /**
   * @param {THREE.Object3D} car
   * @param {boolean} on
   */
  _setWeatherVisible(car, on) {
    const glass = car.userData.povRainGlass;
    const weather = car.userData.povWeather;
    if (weather) weather.visible = on;
    if (glass) glass.visible = on;
    if (car.userData.wiperL) car.userData.wiperL.visible = on;
    if (car.userData.wiperR) car.userData.wiperR.visible = on;
  }

  /**
   * @param {number} dt
   * @param {number} rain
   * @param {{speed:number}} dyn
   */
  _spawnDrops(dt, rain, dyn) {
    const kmh = Math.max(0, dyn.speed) * 3.6;
    const hit = 28 + rain * 62 + kmh * 0.22;
    this._spawnAcc += dt * hit;
    while (this._spawnAcc > 1 && this._drops.length < DROP_MAX) {
      this._spawnAcc -= 1;
      const big = Math.random() > 0.8;
      // Prefer the lower / mid glass — leave the mirror band empty.
      const v0 = MIRROR_BAND_V + 0.02 + Math.random() * (0.96 - MIRROR_BAND_V);
      this._drops.push({
        u: 0.04 + Math.random() * 0.92,
        v: v0,
        r: big ? 0.0048 + Math.random() * 0.006 : 0.0018 + Math.random() * 0.0034,
        vx: 0,
        vy: 0,
        life: 0.85 + Math.random() * 0.55,
        trail: 0,
      });
    }
  }

  /**
   * Beads respond to gravity, ram-air, brake dive, yaw, and slide in real time.
   * @param {number} dt
   * @param {{
   *   speed:number, slide:number, yawRate:number,
   *   brake:number, throttle:number, pitch:number, ax:number
   * }} dyn
   */
  _slideDrops(dt, dyn) {
    const kmh = Math.max(0, dyn.speed) * 3.6;
    const aero = clamp01((kmh - 14) / 120);
    const brake = clamp01(dyn.brake || 0);
    const throttle = clamp01(dyn.throttle || 0);
    const ax = dyn.ax || 0;
    // +vy increases canvas v = down the glass. Brake / forward inertia throws
    // beads toward the top of the screen (decreasing v).
    const g = 0.52 + Math.max(-0.12, Math.min(0.18, (dyn.pitch || 0) * 0.35));
    const climb = aero * aero * 1.15 + throttle * 0.12;
    const brakeClimb = brake * 0.85 + Math.max(0, -ax) * 0.035;
    const out = 0.06 + aero * 0.32;
    const yaw = (dyn.slide || 0) * 0.55 + (dyn.yawRate || 0) * 0.09;
    for (let i = this._drops.length - 1; i >= 0; i--) {
      const d = this._drops[i];
      const mass = 0.48 + d.r * 40;
      const down = g * (1 - aero * 1.25);
      const up = climb + brakeClimb;
      d.vy += ((down - up) / mass) * dt;
      d.vx += (((d.u - 0.5) * out + yaw) / mass) * dt;
      d.vx *= Math.exp(-2.4 * dt);
      d.vy *= Math.exp(-1.35 * dt);
      const vmax = 0.2 + aero * 0.9 + brake * 0.35;
      if (d.vy > vmax) d.vy = vmax;
      if (d.vy < -vmax * 0.85) d.vy = -vmax * 0.85;
      if (d.vx > 0.7) d.vx = 0.7;
      if (d.vx < -0.7) d.vx = -0.7;
      d.u += d.vx * dt;
      d.v += d.vy * dt;
      d.trail = Math.min(1, (d.trail || 0) * Math.exp(-1.8 * dt) + Math.hypot(d.vx, d.vy) * 2.2 * dt);
      d.life -= dt * (0.04 + aero * 0.035);
      if (
        d.u < -0.02 ||
        d.u > 1.02 ||
        d.v < MIRROR_BAND_V - 0.02 ||
        d.v > 1.06 ||
        d.life <= 0
      ) {
        this._drops.splice(i, 1);
      }
    }
  }

  /**
   * Clear beads the live blade rubber covers — angular wedge along the arm.
   * @param {THREE.Object3D} car
   */
  _wipeDrops(car) {
    const gw = car.userData.povGlassW;
    const gh = car.userData.povGlassH;
    if (!(gw > 0) || !(gh > 0)) return;
    const left = car.userData.wiperL;
    const right = car.userData.wiperR;
    for (let i = this._drops.length - 1; i >= 0; i--) {
      const d = this._drops[i];
      const wx = (d.u - 0.5) * gw;
      const wy = (0.5 - d.v) * gh;
      if (bladeHits(left, wx, wy) || bladeHits(right, wx, wy)) {
        this._drops.splice(i, 1);
      }
    }
  }

  /**
   * @param {THREE.Object3D} car
   */
  _parkWipers(car) {
    const left = car.userData.wiperL;
    const right = car.userData.wiperR;
    if (left) left.rotation.z = left.userData.parkZ != null ? left.userData.parkZ : 0.08;
    if (right) right.rotation.z = right.userData.parkZ != null ? right.userData.parkZ : Math.PI - 0.08;
    this._wiperAng = WIPER_PARK;
    this._wipeOn = false;
  }

  /**
   * @param {THREE.Object3D} car
   * @param {boolean} clear
   */
  _paintDrops(car, clear) {
    const ctx = car.userData.povRainCtx;
    const tex = car.userData.povRainTex;
    if (!ctx || !tex) return;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (clear) {
      this._drops.length = 0;
      tex.needsUpdate = true;
      return;
    }

    // Soft wet sheen only below the mirror band — never a full-pane haze.
    const sheenTop = Math.floor(h * MIRROR_BAND_V);
    const wet = 0.03 + this.intensity * 0.05;
    ctx.fillStyle = `rgba(140,160,178,${wet.toFixed(3)})`;
    ctx.fillRect(0, sheenTop, w, h - sheenTop);

    // Cleared wedge under live blades (darker dry path).
    this._paintWipePaths(car, ctx, w, h);

    for (let i = 0; i < this._drops.length; i++) {
      const d = this._drops[i];
      if (d.v < MIRROR_BAND_V) continue;
      const x = d.u * w;
      const y = d.v * h;
      const rx = Math.max(1.05, d.r * w);
      const spd = Math.hypot(d.vx || 0, d.vy || 0);
      const elong = 1 + spd * 10 + (d.trail || 0) * 4;
      const ang = Math.atan2((d.vy || 0) * h, (d.vx || 0) * w);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      // Body
      ctx.fillStyle = "rgba(186,206,222,0.52)";
      ctx.strokeStyle = "rgba(230,240,248,0.45)";
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * (0.45 + elong * 0.55), rx * (0.92 / Math.sqrt(elong)), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Spec highlight
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.ellipse(-rx * 0.2, -rx * 0.28, rx * 0.18, rx * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      // Thin motion streak behind big beads
      if (spd > 0.08) {
        ctx.strokeStyle = "rgba(170,190,210,0.28)";
        ctx.lineWidth = Math.max(0.5, rx * 0.35);
        ctx.beginPath();
        ctx.moveTo(-rx * elong * 0.9, 0);
        ctx.lineTo(-rx * 0.2, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
    tex.needsUpdate = true;
  }

  /**
   * Draw the dry arc the rubber just swept so the wipe reads on the glass.
   * @param {THREE.Object3D} car
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   */
  _paintWipePaths(car, ctx, w, h) {
    if (!this._wipeOn) return;
    const gw = car.userData.povGlassW;
    const gh = car.userData.povGlassH;
    if (!(gw > 0) || !(gh > 0)) return;
    const arms = [car.userData.wiperL, car.userData.wiperR];
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    for (let a = 0; a < arms.length; a++) {
      const pivot = arms[a];
      if (!pivot) continue;
      const len = pivot.userData.bladeLen != null ? pivot.userData.bladeLen : 0.4;
      const half = pivot.userData.bladeHalfW != null ? pivot.userData.bladeHalfW : BLADE_HALF_W;
      const px = (pivot.position.x / gw + 0.5) * w;
      const py = (0.5 - pivot.position.y / gh) * h;
      const ang = pivot.rotation.z;
      const scaleX = w / gw;
      const scaleY = h / gh;
      ctx.translate(px, py);
      ctx.rotate(-ang);
      ctx.beginPath();
      // Rubber strip in canvas pixels along +X after rotate.
      const rw = len * scaleX;
      const rh = Math.max(4, half * 2.4 * scaleY);
      ctx.rect(len * 0.08 * scaleX, -rh * 0.5, rw * 0.92, rh);
      ctx.fill();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.restore();
  }
}

/**
 * Blade rubber vs a drop in pane metres.
 * @param {THREE.Object3D|null|undefined} pivot
 * @param {number} wx
 * @param {number} wy
 */
function bladeHits(pivot, wx, wy) {
  if (!pivot) return false;
  const dx = wx - pivot.position.x;
  const dy = wy - pivot.position.y;
  const dist = Math.hypot(dx, dy);
  const len = pivot.userData.bladeLen != null ? pivot.userData.bladeLen : 0.42;
  if (dist > len + 0.02 || dist < 0.03) return false;
  const dropA = Math.atan2(dy, dx);
  let da = dropA - pivot.rotation.z;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  const half =
    pivot.userData.bladeHalfW != null
      ? Math.atan2(pivot.userData.bladeHalfW, Math.max(0.05, dist))
      : BLADE_HALF_W;
  return Math.abs(da) < Math.max(half, BLADE_HALF_W * 0.65);
}

/** @param {number} v */
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
