/**
 * Mountain rain — camera streaks, wet road, intermittent POV wipers.
 *
 * WHO THIS IS FOR: the race loop on Mountain (or ?rain=1).
 * WHAT IT DOES: a few hundred line streaks around the lens, a shower cycle,
 *   wet-asphalt hook, and cockpit droplets cleared in the wiper sweep.
 * HOW IT CONNECTS: game.js constructs StageWeather once, enables it on
 *   Mountain, and steps after the chase camera. Does not touch Track.query.
 *
 * BUDGET: 360 line segments, not a GPU particle storm. No extra fog soup.
 */

import * as THREE from "../../vendor/three.module.js";
import { setWorldRoadWetness } from "../gfx/pbr.js?v=40";

const STREAK_COUNT = 360;
const DROP_MAX = 88;
const FALL = new THREE.Vector3(-0.12, -1, 0.04).normalize();

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
    this._stepWipers(t, opts.car, opts.pov, this.intensity);
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
   * Intermittent wipe: pause, sweep, pause. POV droplets die in the swept arc.
   * @param {number} dt
   * @param {THREE.Object3D|null|undefined} car
   * @param {boolean|undefined} pov
   * @param {number} rain
   */
  _stepWipers(dt, car, pov, rain) {
    if (!car || !car.userData) return;
    const raining = rain > 0.1;
    if (!raining && !this._wipeOn) {
      this._parkWipers(car);
      if (pov) this._paintDrops(car, true);
      return;
    }

    this._wiperT += dt;
    // Intermittent: 2.7s rest, 0.55s out, 0.14s dwell, 0.48s return.
    const rest = 2.7;
    const out = 0.55;
    const dwell = 0.14;
    const back = 0.48;
    const cycle = rest + out + dwell + back;
    if (this._wiperT > cycle) this._wiperT -= cycle;
    const t = this._wiperT;
    const park = 0.1;
    const far = 1.38;
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
    const parkL = left && left.userData.parkZ != null ? left.userData.parkZ : 0.12;
    const parkR = right && right.userData.parkZ != null ? right.userData.parkZ : -0.12;
    if (left) left.rotation.z = parkL + ang;
    if (right) right.rotation.z = parkR - ang;

    if (!pov) return;
    if (raining) {
      this._spawnAcc += dt * (10 + rain * 22);
      while (this._spawnAcc > 1 && this._drops.length < DROP_MAX) {
        this._spawnAcc -= 1;
        this._drops.push({
          u: Math.random(),
          v: Math.random() * 0.92,
          r: 0.006 + Math.random() * 0.016,
          life: 1,
        });
      }
    }
    if (this._wipeOn) {
      const sweep = ang / far;
      for (let i = this._drops.length - 1; i >= 0; i--) {
        const d = this._drops[i];
        if (dropInSweep(d.u, d.v, sweep)) this._drops.splice(i, 1);
      }
    }
    this._paintDrops(car, false);
  }

  /**
   * @param {THREE.Object3D} car
   */
  _parkWipers(car) {
    const left = car.userData.wiperL;
    const right = car.userData.wiperR;
    if (left) left.rotation.z = left.userData.parkZ != null ? left.userData.parkZ : 0.12;
    if (right) right.rotation.z = right.userData.parkZ != null ? right.userData.parkZ : -0.12;
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
    ctx.fillStyle = "rgba(170,190,210,0.42)";
    ctx.strokeStyle = "rgba(210,224,236,0.55)";
    for (let i = 0; i < this._drops.length; i++) {
      const d = this._drops[i];
      const x = d.u * w;
      const y = d.v * h;
      const rx = d.r * w;
      const ry = d.r * h * 1.35;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    tex.needsUpdate = true;
  }
}

/**
 * Blade parks at the bottom corners and sweeps toward the top centre.
 * @param {number} u
 * @param {number} v
 * @param {number} sweep 0..1
 */
function dropInSweep(u, v, sweep) {
  if (sweep < 0.04) return false;
  const left = Math.hypot(u - 0.18, 1 - v);
  const right = Math.hypot(u - 0.82, 1 - v);
  const angL = Math.atan2(1 - v, u - 0.18);
  const angR = Math.atan2(1 - v, 0.82 - u);
  const reach = 0.08 + sweep * 1.25;
  const inL = left < 0.92 && angL > 0.15 && angL < reach;
  const inR = right < 0.92 && angR > 0.15 && angR < reach;
  return inL || inR;
}
