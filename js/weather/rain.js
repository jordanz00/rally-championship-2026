/**
 * Mountain rain — camera streaks, wet road, intermittent POV wipers.
 *
 * WHO THIS IS FOR: the race loop on Mountain (or ?rain=1).
 * WHAT IT DOES: world streaks, wet asphalt, and windshield beads that climb
 *   under accel / ram-air (and creep down when parked), dying under the blades.
 * HOW IT CONNECTS: game.js constructs StageWeather once, enables it on
 *   Mountain, and steps after the chase camera. Does not touch Track.query.
 *
 * BUDGET: ~700 line segments (near sheet + mid volume) + ≤280 2D droplets.
 */

import * as THREE from "../../vendor/three.module.js";
import { setWorldRoadWetness } from "../gfx/pbr.js?v=55";

/** Same layer as cockpit gauges — composited after the world pass. */
const POV_HUD_LAYER = 1;

const NEAR_COUNT = 300;
const FAR_COUNT = 400;
const DROP_MAX = 280;
const FALL = new THREE.Vector3(-0.1, -1, 0.03).normalize();
const WIPER_FAR = 1.26;
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
    this._screenPane = null;
    this._screenCam = null;

    this.near = this._makeStreakLayer(NEAR_COUNT, {
      color: 0xeef6fc,
      depthTest: false,
      renderOrder: 6,
    });
    this.far = this._makeStreakLayer(FAR_COUNT, {
      color: 0xc8d8e6,
      depthTest: true,
      renderOrder: 4,
    });
    this.lines = this.near.lines;
    this.mat = this.near.mat;
    this.pos = this.near.pos;
    this.geo = this.near.geo;

    for (let i = 0; i < NEAR_COUNT; i++) this._respawnLayer(this.near, i, true, true);
    for (let i = 0; i < FAR_COUNT; i++) this._respawnLayer(this.far, i, true, false);
  }

  /**
   * @param {number} count
   * @param {{color:number, depthTest:boolean, renderOrder:number}} spec
   */
  _makeStreakLayer(count, spec) {
    const pos = new Float32Array(count * 6);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: spec.depthTest,
      fog: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = spec.renderOrder;
    lines.visible = false;
    this.scene.add(lines);
    return { count, pos, geo, mat, lines };
  }

  /**
   * @param {boolean} on
   * @param {THREE.Object3D|null} [trackGroup]
   */
  setActive(on, trackGroup = null) {
    this.active = !!on;
    if (!this.active) {
      this.intensity = 0;
      this.near.lines.visible = false;
      this.far.lines.visible = false;
      this.near.mat.opacity = 0;
      this.far.mat.opacity = 0;
      this._drops.length = 0;
      if (this._screenPane) this._screenPane.visible = false;
      if (trackGroup) setWorldRoadWetness(trackGroup, 0);
    } else {
      this.intensity = Math.max(this.intensity, 0.62);
      this.near.lines.visible = true;
      this.far.lines.visible = true;
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
    // Shower that stays readable — never a dry lull on Mountain.
    const per = 22;
    const u = (this._cycle % per) / per;
    let target = 0.55;
    if (u < 0.22) target = 0.48 + (u / 0.22) * 0.42;
    else if (u < 0.55) target = 0.82 + Math.sin((u - 0.22) * 14) * 0.1;
    else if (u < 0.78) target = 0.7 - ((u - 0.55) / 0.23) * 0.18;
    else target = 0.48;
    this.intensity += (target - this.intensity) * Math.min(1, t * 2.2);

    const wet = 0.28 + this.intensity * 0.72;
    if (opts.trackGroup) setWorldRoadWetness(opts.trackGroup, wet);
    if (opts.audio && opts.audio.setRain) opts.audio.setRain(this.intensity);

    this._stepStreaks(t, opts.camera, opts.speed || 0, !!opts.pov);
    this._stepWipers(t, opts.car, opts.pov, this.intensity, opts);
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {number} speedMs
   */
  _stepStreaks(dt, camera, speedMs, pov) {
    if (!camera) return;
    camera.getWorldPosition(this._cam);
    camera.getWorldDirection(this._fwd);
    this._up.set(0, 1, 0);
    this._right.crossVectors(this._fwd, this._up).normalize();
    this._up.crossVectors(this._right, this._fwd).normalize();

    const kmh = Math.max(0, speedMs) * 3.6;
    // Relative wind: gravity plus the camera punching through the shower.
    const sx = FALL.x - this._fwd.x * (0.08 + kmh * 0.011);
    const sy = FALL.y - this._fwd.y * (0.04 + kmh * 0.004) - 0.12;
    const sz = FALL.z - this._fwd.z * (0.08 + kmh * 0.011);
    const sl = Math.hypot(sx, sy, sz) || 1;
    const dir = { x: sx / sl, y: sy / sl, z: sz / sl };
    const show = this.intensity > 0.04;
    this._advectLayer(this.near, dt, kmh, dir, true, 12 + this.intensity * 16 + kmh * 0.14, 0.85 + Math.min(2.4, kmh * 0.018));
    this._advectLayer(this.far, dt, kmh, dir, false, 16 + this.intensity * 22 + kmh * 0.1, 0.7 + Math.min(1.6, kmh * 0.01));
    // Near sheet has no depth test — chase only. In POV it would rain through the roof.
    this.near.lines.visible = show && !pov;
    this.far.lines.visible = show;
    this.near.mat.opacity = show && !pov ? 0.42 + this.intensity * 0.48 : 0;
    this.far.mat.opacity = show ? 0.22 + this.intensity * 0.38 : 0;
  }

  /**
   * @param {{count:number, pos:Float32Array, geo:THREE.BufferGeometry}} layer
   * @param {number} dt
   * @param {number} kmh
   * @param {{x:number,y:number,z:number}} dir
   * @param {boolean} near
   * @param {number} speed
   * @param {number} len
   */
  _advectLayer(layer, dt, kmh, dir, near, speed, len) {
    const maxR2 = near ? 90 : 420;
    const minY = near ? -3.2 : -5;
    let live = 0;
    for (let i = 0; i < layer.count; i++) {
      const i6 = i * 6;
      layer.pos[i6] += dir.x * speed * dt;
      layer.pos[i6 + 1] += dir.y * speed * dt;
      layer.pos[i6 + 2] += dir.z * speed * dt;
      layer.pos[i6 + 3] = layer.pos[i6] + dir.x * len;
      layer.pos[i6 + 4] = layer.pos[i6 + 1] + dir.y * len;
      layer.pos[i6 + 5] = layer.pos[i6 + 2] + dir.z * len;
      const dx = layer.pos[i6] - this._cam.x;
      const dy = layer.pos[i6 + 1] - this._cam.y;
      const dz = layer.pos[i6 + 2] - this._cam.z;
      if (dy < minY || dx * dx + dz * dz > maxR2) {
        this._respawnLayer(layer, i, false, near);
      } else {
        live++;
      }
    }
    layer.geo.attributes.position.needsUpdate = true;
    return live;
  }

  /**
   * @param {{pos:Float32Array}} layer
   * @param {number} i
   * @param {boolean} scatter
   * @param {boolean} near
   */
  _respawnLayer(layer, i, scatter, near) {
    const along = near
      ? 0.9 + Math.random() * (scatter ? 8 : 6.5)
      : 5 + Math.random() * (scatter ? 18 : 14);
    const side = (Math.random() - 0.5) * (near ? 7.2 : 13);
    // Keep streaks in the chase look-at cone (around the car), not only in the sky.
    const lift = near
      ? -1.6 + Math.random() * 4.6
      : scatter
        ? -2.2 + Math.random() * 8
        : -1.4 + Math.random() * 7;
    this._a.copy(this._cam).addScaledVector(this._fwd, along).addScaledVector(this._right, side);
    this._a.y = this._cam.y + lift;
    const i6 = i * 6;
    layer.pos[i6] = this._a.x;
    layer.pos[i6 + 1] = this._a.y;
    layer.pos[i6 + 2] = this._a.z;
    const sl = near ? 0.72 : 0.5;
    layer.pos[i6 + 3] = this._a.x + FALL.x * sl;
    layer.pos[i6 + 4] = this._a.y + FALL.y * sl;
    layer.pos[i6 + 5] = this._a.z + FALL.z * sl;
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
    this._syncScreenGlass(opts.camera, car, !!pov);
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
   * Camera-locked pane so beads read on the glass the player actually looks through
   * (authored windshield fits can sit off-axis on swapped GLBs).
   * @param {THREE.Camera|null|undefined} camera
   * @param {THREE.Object3D} car
   * @param {boolean} pov
   */
  _syncScreenGlass(camera, car, pov) {
    const tex = car && car.userData && car.userData.povRainTex;
    if (!pov || !camera || !tex) {
      if (this._screenPane) this._screenPane.visible = false;
      return;
    }
    if (!this._screenPane) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
        fog: false,
        toneMapped: false,
      });
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.72), mat);
      pane.name = "pov-rain-screen";
      pane.frustumCulled = false;
      pane.renderOrder = 8;
      pane.layers.set(POV_HUD_LAYER);
      this._screenPane = pane;
    } else if (this._screenPane.material && this._screenPane.material.map !== tex) {
      this._screenPane.material.map = tex;
      this._screenPane.material.needsUpdate = true;
    }
    if (this._screenCam !== camera) {
      if (this._screenPane.parent) this._screenPane.parent.remove(this._screenPane);
      camera.add(this._screenPane);
      this._screenCam = camera;
    }
    // Sit in the windshield opening: above the dash, below the mirror.
    this._screenPane.position.set(0, 0.1, -0.46);
    this._screenPane.rotation.set(-0.12, 0, 0);
    this._screenPane.visible = true;
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
      // Impact mostly on the lower / mid pane — ram-air then drives them up.
      const v0 = 0.42 + Math.random() * 0.52;
      const climb0 = kmh > 16 ? -(0.18 + Math.random() * 0.42 + (kmh / 140) * 0.55) : 0.02;
      this._drops.push({
        u: 0.05 + Math.random() * 0.9,
        v: Math.min(0.97, v0),
        r: big ? 0.0044 + Math.random() * 0.0042 : 0.0022 + Math.random() * 0.0028,
        vx: (Math.random() - 0.5) * 0.04,
        vy: climb0,
        life: 0.85 + Math.random() * 0.55,
        trail: 0,
      });
    }
  }

  /**
   * Beads respond to gravity, ram-air, accel, brake, yaw, and slide in real time.
   * Canvas: +v = down the glass (toward the cowl). Accel / ram-air → climb (−v).
   * @param {number} dt
   * @param {{
   *   speed:number, slide:number, yawRate:number,
   *   brake:number, throttle:number, pitch:number, ax:number
   * }} dyn
   */
  _slideDrops(dt, dyn) {
    const kmh = Math.max(0, dyn.speed) * 3.6;
    // Ram-air on a raked screen: above ~22 km/h beads streak toward the roof
    // (−v). Parked / crawling, gravity wins (+v toward the cowl).
    const aero = clamp01((kmh - 8) / 70);
    const brake = clamp01(dyn.brake || 0);
    const throttle = clamp01(dyn.throttle || 0);
    const ax = dyn.ax || 0;
    const accel = Math.max(0, ax);
    const decel = Math.max(0, -ax);
    const g = 0.22 + Math.max(-0.06, Math.min(0.1, (dyn.pitch || 0) * 0.22));
    const climb =
      aero * 2.15 +
      aero * aero * 1.4 +
      throttle * (0.35 + aero * 0.55) +
      accel * 0.06 +
      brake * 0.08;
    const down = kmh < 18 ? g * (1 - aero) : g * 0.08;
    const out = 0.04 + aero * 0.38 + throttle * 0.03;
    const yaw = (dyn.slide || 0) * 0.55 + (dyn.yawRate || 0) * 0.09;
    for (let i = this._drops.length - 1; i >= 0; i--) {
      const d = this._drops[i];
      const mass = 0.48 + d.r * 40;
      d.vy += ((down - climb) / mass) * dt;
      d.vx += (((d.u - 0.5) * out + yaw) / mass) * dt;
      d.vx *= Math.exp(-2.4 * dt);
      d.vy *= Math.exp(-1.25 * dt);
      const vmax = 0.22 + aero * 0.95 + throttle * 0.35 + accel * 0.04;
      if (d.vy > vmax * 0.75) d.vy = vmax * 0.75;
      if (d.vy < -vmax) d.vy = -vmax;
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
    const wet = 0.018 + this.intensity * 0.028;
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
      const elong = 1 + Math.min(2.6, spd * 7 + (d.trail || 0) * 2.4);
      const ang = Math.atan2((d.vy || 0) * h, (d.vx || 0) * w);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      // Slender bead along velocity — ram-air reads as a climb, not a soap blob.
      ctx.fillStyle = "rgba(198,216,230,0.48)";
      ctx.strokeStyle = "rgba(236,244,250,0.55)";
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.ellipse(0, 0, rx * (0.55 + elong * 0.85), Math.max(0.65, rx * 0.36), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.ellipse(rx * 0.12, -rx * 0.08, rx * 0.16, rx * 0.08, 0, 0, Math.PI * 2);
      ctx.fill();
      if (spd > 0.06) {
        ctx.strokeStyle = "rgba(176,196,214,0.26)";
        ctx.lineWidth = Math.max(0.45, rx * 0.22);
        ctx.beginPath();
        ctx.moveTo(-rx * elong * 1.05, 0);
        ctx.lineTo(-rx * 0.15, 0);
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
