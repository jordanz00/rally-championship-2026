/**
 * Mountain rain — camera streaks, wet road, intermittent POV wipers.
 *
 * WHO THIS IS FOR: the race loop on Mountain (or ?rain=1).
 * WHAT IT DOES: a few hundred line streaks around the lens, a shower cycle,
 *   wet-asphalt hook, and cockpit droplets that slide with speed and die
 *   under the wiper blades.
 * HOW IT CONNECTS: game.js constructs StageWeather once, enables it on
 *   Mountain, and steps after the chase camera. Does not touch Track.query.
 *
 * BUDGET: 360 line segments + ≤220 2D droplets on a 512 canvas. POV only.
 */

import * as THREE from "../../vendor/three.module.js";
import { setWorldRoadWetness } from "../gfx/pbr.js?v=49";

const STREAK_COUNT = 360;
const DROP_MAX = 280;
const FALL = new THREE.Vector3(-0.12, -1, 0.04).normalize();
const WIPER_FAR = 1.72;
const WIPER_PARK = 0.1;
const BLADE_HALF_W = 0.11;

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
    this._cam = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();

    this.pos = new Float32Array(STREAK_COUNT * 6);
    this.life = new Float32Array(STREAK_COUNT);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({
      color: 0xc4d2de,
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
    if (u < 0.18) target = 0.2 + u / 0.18 * 0.45;
    else if (u < 0.42) target = 0.65 + Math.sin((u - 0.18) * 12) * 0.12;
    else if (u < 0.62) target = 0.72 - (u - 0.42) / 0.2 * 0.4;
    else if (u < 0.78) target = 0.22;
    else target = 0.08;
    this.intensity += (target - this.intensity) * Math.min(1, t * 1.8);

    const wet = 0.28 + this.intensity * 0.72;
    if (opts.trackGroup) setWorldRoadWetness(opts.trackGroup, wet);
    if (opts.audio && opts.audio.setRain) opts.audio.setRain(this.intensity);

    this._stepStreaks(t, opts.camera);
    this._stepWipers(t, opts.car, opts.pov, this.intensity, opts.speed || 0, opts.slide || 0);
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   */
  _stepStreaks(dt, camera) {
    if (!camera) return;
    camera.getWorldPosition(this._cam);
    camera.getWorldDirection(this._fwd);
    this._up.set(0, 1, 0);
    this._right.crossVectors(this._fwd, this._up).normalize();
    this._up.crossVectors(this._right, this._fwd).normalize();

    const speed = 18 + this.intensity * 22;
    const len = 0.38 + this.intensity * 0.42;
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
    this.mat.opacity = show ? 0.14 + this.intensity * 0.28 : 0;
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
   * Intermittent wipe: pause, sweep, pause. POV droplets slide with speed
   * and die when a blade actually passes over them.
   * @param {number} dt
   * @param {THREE.Object3D|null|undefined} car
   * @param {boolean|undefined} pov
   * @param {number} rain
   * @param {number} speedMs
   * @param {number} slide
   */
  _stepWipers(dt, car, pov, rain, speedMs, slide) {
    if (!car || !car.userData) return;
    const raining = rain > 0.1;
    if (!raining && !this._wipeOn) {
      this._parkWipers(car);
      const glass = car.userData.povRainGlass;
      const weather = car.userData.povWeather;
      if (weather) weather.visible = !!pov;
      if (glass) glass.visible = !!pov;
      if (car.userData.wiperL) car.userData.wiperL.visible = !!pov;
      if (car.userData.wiperR) car.userData.wiperR.visible = !!pov;
      if (pov) this._paintDrops(car, true);
      return;
    }

    this._wiperT += dt;
    // Heavier rain → shorter rest so the blades stay in the story.
    const rest = rain > 0.55 ? 1.35 : 2.4;
    const out = 0.48;
    const dwell = 0.1;
    const back = 0.42;
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
    const parkL = left && left.userData.parkZ != null ? left.userData.parkZ : 0.1;
    const parkR = right && right.userData.parkZ != null ? right.userData.parkZ : Math.PI - 0.1;
    if (left) left.rotation.z = parkL + ang;
    if (right) right.rotation.z = parkR - ang;

    // Rain glass + blades are POV-only — hide hard so chase never sees them.
    const glass = car.userData.povRainGlass;
    const weather = car.userData.povWeather;
    if (weather) weather.visible = !!pov;
    if (glass) glass.visible = !!pov;
    if (left) left.visible = !!pov;
    if (right) right.visible = !!pov;

    if (!pov) return;
    if (raining) this._spawnDrops(dt, rain, speedMs);
    this._slideDrops(dt, speedMs, slide);
    if (this._wipeOn) this._wipeDrops(car);
    this._paintDrops(car, false);
  }

  /**
   * @param {number} dt
   * @param {number} rain
   * @param {number} speedMs
   */
  _spawnDrops(dt, rain, speedMs) {
    const kmh = Math.max(0, speedMs) * 3.6;
    const hit = 36 + rain * 70 + kmh * 0.28;
    this._spawnAcc += dt * hit;
    while (this._spawnAcc > 1 && this._drops.length < DROP_MAX) {
      this._spawnAcc -= 1;
      const big = Math.random() > 0.78;
      this._drops.push({
        u: 0.015 + Math.random() * 0.97,
        v: 0.02 + Math.random() * 0.96,
        r: big ? 0.0055 + Math.random() * 0.007 : 0.0022 + Math.random() * 0.004,
        vx: 0,
        vy: 0,
        life: 0.75 + Math.random() * 0.5,
      });
    }
  }

  /**
   * Gravity vs ram-air on a raked screen. Crawl = beads run down.
   * Pace = streaks climb and peel outboard.
   * @param {number} dt
   * @param {number} speedMs
   * @param {number} slide
   */
  _slideDrops(dt, speedMs, slide) {
    const kmh = Math.max(0, speedMs) * 3.6;
    const aero = clamp01((kmh - 16) / 128);
    const g = 0.48;
    const climb = aero * aero * 1.22;
    const out = 0.08 + aero * 0.34;
    const yaw = (slide || 0) * 0.42;
    for (let i = this._drops.length - 1; i >= 0; i--) {
      const d = this._drops[i];
      const mass = 0.5 + d.r * 36;
      d.vy += ((g * (1 - aero * 1.4) - climb) / mass) * dt;
      d.vx += (((d.u - 0.5) * out + yaw) / mass) * dt;
      d.vx *= Math.exp(-2.6 * dt);
      d.vy *= Math.exp(-1.5 * dt);
      const vmax = 0.18 + aero * 0.95;
      if (d.vy > vmax * 0.65) d.vy = vmax * 0.65;
      if (d.vy < -vmax) d.vy = -vmax;
      if (d.vx > 0.62) d.vx = 0.62;
      if (d.vx < -0.62) d.vx = -0.62;
      d.u += d.vx * dt;
      d.v += d.vy * dt;
      d.life -= dt * (0.05 + aero * 0.04);
      if (d.u < -0.04 || d.u > 1.04 || d.v < -0.08 || d.v > 1.08 || d.life <= 0) {
        this._drops.splice(i, 1);
      }
    }
  }

  /**
   * Clear beads the live blade rubber actually covers (not a guessed pie).
   * @param {THREE.Object3D} car
   */
  _wipeDrops(car) {
    const pane = car.userData.povRainGlass;
    const gw = car.userData.povGlassW;
    const gh = car.userData.povGlassH;
    if (!pane || !(gw > 0) || !(gh > 0)) return;
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
    if (left) left.rotation.z = left.userData.parkZ != null ? left.userData.parkZ : 0.1;
    if (right) right.rotation.z = right.userData.parkZ != null ? right.userData.parkZ : Math.PI - 0.1;
    this._wiperAng = 0.1;
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
    ctx.fillStyle = "rgba(150,172,192,0.05)";
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 0.7;
    for (let i = 0; i < this._drops.length; i++) {
      const d = this._drops[i];
      const x = d.u * w;
      const y = d.v * h;
      const rx = Math.max(1.15, d.r * w);
      const spd = Math.hypot(d.vx || 0, d.vy || 0);
      const elong = 1 + spd * 9;
      const ang = Math.atan2((d.vy || 0) * h, (d.vx || 0) * w);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillStyle = "rgba(198,214,228,0.46)";
      ctx.strokeStyle = "rgba(236,244,250,0.5)";
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * (0.5 + elong * 0.5), rx * (0.95 / Math.sqrt(elong)), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.ellipse(-rx * 0.18, -rx * 0.22, rx * 0.16, rx * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    tex.needsUpdate = true;
  }
}

/**
 * Blade rubber vs a drop in cockpit XY (metres). Matches the visible arm.
 * @param {THREE.Object3D|null|undefined} pivot
 * @param {number} wx
 * @param {number} wy
 */
function bladeHits(pivot, wx, wy) {
  if (!pivot) return false;
  const dx = wx - pivot.position.x;
  const dy = wy - pivot.position.y;
  const dist = Math.hypot(dx, dy);
  const len = pivot.userData.bladeLen != null ? pivot.userData.bladeLen : 0.84;
  if (dist > len + 0.03 || dist < 0.04) return false;
  const dropA = Math.atan2(dy, dx);
  let da = dropA - pivot.rotation.z;
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  return Math.abs(da) < BLADE_HALF_W;
}

/** @param {number} v */
function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
