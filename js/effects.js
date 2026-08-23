/**
 * Wheel dirt spray — particles kicked from the contact patch.
 *
 * WHO THIS IS FOR: the race loop.
 * WHAT IT DOES (Sprint 27): a layered rear wake — fine hanging dust + heavier
 *   grit — thrown from the rear tires so the chase camera reads a real plume
 *   behind the car. Rate, size, hang, and colour follow speed, slip, surface,
 *   and stage wind. Tarmac / cobble stay clean.
 * HOW IT CONNECTS: game.js emit()s every vehicle after physics, then step(dt);
 *   setAtmosphere() syncs fog + wind from LIGHTING.
 *
 * FRAME BUDGET: dust is the only large transparent surface in the frame.
 *   Point size is clamped; the pool is shared by the pack; sprites fog out.
 */

import * as THREE from "../vendor/three.module.js";
import { getSurface } from "./physics/surfaces.js?v=43";
import { VISUAL } from "./config.js?v=122";

/**
 * How each loose surface throws dirt. `rate` is particles/sec at ~80 km/h.
 * `chunks` = heavy grit; `plume` = fine hanging dust in the slipstream.
 * Lift stays low — rally spray kicks backward and sideways, not skyward.
 */
const PROFILE = {
  sand: { rate: 155, size: [0.14, 0.58], life: [0.35, 0.95], gravity: 5.8, drag: 0.84, spread: 2.6, lift: 0.75, kick: 12.5, chunks: 0.28, plume: 0.38 },
  dirt: { rate: 105, size: [0.12, 0.48], life: [0.28, 0.78], gravity: 8.5, drag: 0.87, spread: 2.0, lift: 0.55, kick: 10.5, chunks: 0.38, plume: 0.3 },
  gravel: { rate: 72, size: [0.08, 0.32], life: [0.18, 0.55], gravity: 14, drag: 0.91, spread: 1.6, lift: 0.35, kick: 9.2, chunks: 0.62, plume: 0.14 },
  mud: { rate: 58, size: [0.1, 0.38], life: [0.22, 0.62], gravity: 15, drag: 0.93, spread: 1.2, lift: 0.28, kick: 8.0, chunks: 0.72, plume: 0.1 },
  grass: { rate: 36, size: [0.1, 0.34], life: [0.2, 0.55], gravity: 9.5, drag: 0.89, spread: 1.4, lift: 0.32, kick: 7.5, chunks: 0.24, plume: 0.16 },
};

const VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;
attribute float aAngle;
attribute vec3 aColor;
uniform float uScale;
uniform float uMaxPx;
varying vec3 vColor;
varying float vLife;
varying float vAngle;
varying float vDepth;
void main() {
  vColor = aColor;
  vLife = aLife;
  vAngle = aAngle;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(1.15, -mv.z);
  vDepth = dist;
  gl_PointSize = min(aSize * uScale / dist, uMaxPx);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying vec3 vColor;
varying float vLife;
varying float vAngle;
varying float vDepth;
void main() {
  float s = sin(vAngle);
  float c = cos(vAngle);
  vec2 uv = gl_PointCoord - 0.5;
  uv = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y) + 0.5;
  float mask = texture2D(uMap, uv).a;
  // Soft birth + linger — plumes must read as volume, not spark pops.
  float fade = smoothstep(0.0, 0.12, vLife) * smoothstep(0.0, 0.32, vLife);
  float alpha = mask * fade * 0.72;
  if (alpha < 0.025) discard;
  float fog = clamp((vDepth - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(vColor, uFogColor, fog * 0.92), alpha * (1.0 - fog * 0.88));
}
`;

export class Dust {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    // Player wake is the hero read; full pack shares the pool (Sprint 28).
    this.count = VISUAL.rearDirtWake === false ? 960 : 2200;
    this.pos = new Float32Array(this.count * 3);
    this.col = new Float32Array(this.count * 3);
    this.vel = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    this.maxLife = new Float32Array(this.count);
    this.fade = new Float32Array(this.count);
    this.size = new Float32Array(this.count);
    this.angle = new Float32Array(this.count);
    this.spin = new Float32Array(this.count);
    this.seed = new Float32Array(this.count);
    this.grav = new Float32Array(this.count);
    this.drag = new Float32Array(this.count);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute("aLife", new THREE.BufferAttribute(this.fade, 1));
    this.geo.setAttribute("aAngle", new THREE.BufferAttribute(this.angle, 1));

    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: makeDustSprite() },
        uScale: { value: 195 },
        uMaxPx: { value: 46 },
        uFogColor: { value: new THREE.Color(0xc9b48a) },
        uFogNear: { value: 100 },
        uFogFar: { value: 480 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);

    this.i = 0;
    this._color = new THREE.Color();
    this._wind = new THREE.Vector3(0, 0, 0);
    this._dustStrength = 0.2;
    /** @type {WeakMap<object, number>} */
    this._carry = new WeakMap();
    for (let i = 0; i < this.count; i++) this.pos[i * 3 + 1] = -40;
  }

  /**
   * Stage fog + wind from LIGHTING (called when a course loads / tunnels blend).
   * @param {{fog?:number, fogNear?:number, fogFar?:number, wind?:number[], dustStrength?:number}|null} L
   */
  setAtmosphere(L) {
    if (!L) return;
    if (L.fog != null) this.mat.uniforms.uFogColor.value.setHex(L.fog);
    if (L.fogNear != null) this.mat.uniforms.uFogNear.value = L.fogNear * 0.28;
    if (L.fogFar != null) this.mat.uniforms.uFogFar.value = L.fogFar * 0.55;
    if (Array.isArray(L.wind) && L.wind.length >= 3) {
      this._wind.set(L.wind[0], L.wind[1], L.wind[2]);
    } else {
      this._wind.set(0, 0, 0);
    }
    this._dustStrength = L.dustStrength != null ? L.dustStrength : 0.15;
  }

  /**
   * Kick dirt from the REAR wheels (fronts only when the car is sliding hard).
   * @param {{position:{x:number,y:number,z:number}, yaw:number, speed:number, surfaceId:string, slip?:number, drifting?:boolean, driftAngle?:number, onGround?:boolean, ai?:boolean, velocity?:{x:number,z:number}, spec?:{wheelbase?:number, trackRear?:number, trackFront?:number}}} vehicle
   * @param {number} dt
   */
  emit(vehicle, dt) {
    if (vehicle.onGround === false) return;
    const id = vehicle.surfaceId;
    const profile = PROFILE[id];
    if (!profile) return;
    const surf = getSurface(id);
    const speed = vehicle.speed || 0;
    const slip = Math.min(1.4, vehicle.slip || 0);
    const drift = Math.abs(vehicle.driftAngle || 0);
    if (speed < 1.8 && slip < 0.14) return;

    const speedK = clamp01((speed - 2.0) / 32);
    const slipK = clamp01(slip * 0.95 + (vehicle.drifting ? 0.55 : 0) + drift * 1.05);
    const focus = vehicle.ai ? 0.78 : 1.55;
    const envBoost = 0.85 + this._dustStrength * 0.9;
    const perSec =
      profile.rate * (0.22 + speedK * 0.9 + slipK * 1.95) * (surf.dust || 1) * focus * envBoost;

    const budget = (this._carry.get(vehicle) || 0) + perSec * dt;
    const cap = vehicle.ai ? 22 : 48;
    let n = Math.min(cap, budget | 0);
    this._carry.set(vehicle, budget - n);
    if (n < 1) return;

    this._color.setHex(surf.color);
    const br = this._color.r;
    const bg = this._color.g;
    const bb = this._color.b;

    const fx = Math.sin(vehicle.yaw);
    const fz = Math.cos(vehicle.yaw);
    const rx = Math.cos(vehicle.yaw);
    const rz = -Math.sin(vehicle.yaw);
    const wb = (vehicle.spec && vehicle.spec.wheelbase) || 2.5;
    const trackR = ((vehicle.spec && vehicle.spec.trackRear) || 1.5) * 0.5;
    const vx = vehicle.velocity ? vehicle.velocity.x : fx * speed;
    const vz = vehicle.velocity ? vehicle.velocity.z : fz * speed;
    const slideOut = Math.sign(vehicle.driftAngle || 0) * Math.min(1.1, drift * 1.8);
    const wakeOn = VISUAL.rearDirtWake !== false;

    while (n-- > 0) {
      const roll = Math.random();
      const grit = roll < profile.chunks;
      const plume = !grit && wakeOn && roll < profile.chunks + (profile.plume || 0.2);
      const speck = !grit && !plume && roll > 0.72;
      // Almost all spray from the rear contact patch — dirt exits the back of the car.
      const front = slipK > 0.78 && Math.random() < 0.08;
      const sideSign = Math.random() < 0.5 ? -1 : 1;
      const along = front ? wb * 0.32 : -wb * (0.58 + Math.random() * 0.26);
      const lat =
        (front ? trackR * 0.88 : trackR) * sideSign +
        (Math.random() - 0.5) * 0.22 +
        slideOut * 0.14;

      const px = vehicle.position.x + fx * along + rx * lat;
      const pz = vehicle.position.z + fz * along + rz * lat;
      const py = vehicle.position.y - 0.02 + Math.random() * 0.04;

      const kick = profile.kick * (0.42 + speedK * 0.48 + slipK * 0.95) * (plume ? 0.88 : 1);
      const spread = profile.spread * (0.65 + Math.random() * 0.55);
      const liftBase = profile.lift * (0.12 + Math.random() * 0.38);
      const lift = grit ? liftBase * 0.35 : plume ? liftBase * 0.55 : liftBase * 0.65;

      const i = this.i % this.count;
      this.i += 1;
      const back = 0.35 + Math.random() * (plume ? 0.75 : 0.45);
      this.pos[i * 3] = px - fx * back;
      this.pos[i * 3 + 1] = py;
      this.pos[i * 3 + 2] = pz - fz * back;

      // Slipstream: inherit car velocity, then blast rearward in a low fan — not vertical.
      const inherit = plume ? 0.62 : grit ? 0.34 : 0.48;
      const rearX = -fx;
      const rearZ = -fz;
      const fanLat = (Math.random() - 0.5) * spread * 2.2;
      const fanRear = kick * (0.55 + Math.random() * 0.45);
      const wakeJitter = (Math.random() - 0.5) * spread * 0.85;

      this.vel[i * 3] =
        vx * inherit +
        rearX * fanRear +
        rx * fanLat +
        rx * sideSign * slipK * 1.6 +
        rx * wakeJitter +
        this._wind.x * (0.28 + Math.random() * 0.32);
      this.vel[i * 3 + 1] = lift + (Math.random() - 0.5) * 0.18;
      this.vel[i * 3 + 2] =
        vz * inherit +
        rearZ * fanRear +
        rz * fanLat +
        rz * sideSign * slipK * 1.6 +
        rz * wakeJitter +
        this._wind.z * (0.28 + Math.random() * 0.32);

      const life =
        lerp(profile.life[0], profile.life[1], Math.random()) *
        (grit ? 0.48 : plume ? 1.15 : speck ? 0.72 : 0.92);
      this.life[i] = life;
      this.maxLife[i] = life;
      this.fade[i] = 1;

      let sz = lerp(profile.size[0], profile.size[1], Math.random());
      if (grit) sz *= 0.55 + Math.random() * 0.35;
      else if (plume) sz *= 0.75 + Math.random() * 0.35 + slipK * 0.12;
      else if (speck) sz *= 0.35 + Math.random() * 0.25;
      else sz *= 0.65 + Math.random() * 0.4 + slipK * 0.08;
      sz *= 0.82 + speedK * 0.28;
      this.size[i] = sz;

      this.angle[i] = Math.random() * 6.283;
      this.spin[i] = (Math.random() - 0.5) * (grit ? 14 : plume ? 3 : 8);
      this.seed[i] = Math.random() * 6.283;
      this.grav[i] = grit
        ? profile.gravity * (1.05 + Math.random() * 0.45)
        : profile.gravity * (plume ? 0.72 : 0.95) * (0.75 + Math.random() * 0.35);
      this.drag[i] = grit ? 0.965 : plume ? profile.drag * 0.94 : profile.drag * 0.98;

      let shade;
      if (grit) shade = 0.28 + Math.random() * 0.22;
      else if (speck) shade = 0.52 + Math.random() * 0.18;
      else if (plume) shade = 0.62 + Math.random() * 0.22;
      else shade = 0.44 + Math.random() * 0.28;
      const warm = id === "sand" || id === "dirt" ? 1.04 + Math.random() * 0.08 : 1;
      const cool = id === "mud" ? 0.88 + Math.random() * 0.06 : 1;
      this.col[i * 3] = br * shade * warm;
      this.col[i * 3 + 1] = bg * shade * warm * cool;
      this.col[i * 3 + 2] = bb * shade * cool;
    }
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
  }

  /**
   * @param {number} dt
   */
  step(dt) {
    this._syncFog();
    const wx = this._wind.x;
    const wz = this._wind.z;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const t = this.life[i];
      const dragK = 1 - this.drag[i];
      const swirl = Math.sin(this.seed[i] + t * 9) * dragK * 6;
      const cross = Math.cos(this.seed[i] * 1.9 + t * 7) * dragK * 6;
      this.vel[i * 3] += (swirl + wx * 0.42) * dt;
      this.vel[i * 3 + 2] += (cross + wz * 0.42) * dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.vel[i * 3] *= this.drag[i];
      this.vel[i * 3 + 2] *= this.drag[i];
      this.vel[i * 3 + 1] *= 0.91;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.angle[i] += this.spin[i] * dt;
      if (this.pos[i * 3 + 1] < -0.25 || t <= 0) {
        this.life[i] = 0;
        this.fade[i] = 0;
        this.pos[i * 3 + 1] = -40;
        continue;
      }
      this.fade[i] = t / (this.maxLife[i] || 1);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
    this.geo.attributes.aAngle.needsUpdate = true;
  }

  /**
   * Dust is a raw shader, so it does not get three.js' automatic fog. Copy the
   * stage fog across each frame; a plume that stays crisp at 300 m breaks the
   * horizon harder than anything else in the frame.
   */
  _syncFog() {
    const fog = this.scene && this.scene.fog;
    if (!fog) return;
    const u = this.mat.uniforms;
    if (fog.color) u.uFogColor.value.copy(fog.color);
    if (fog.near != null) u.uFogNear.value = fog.near * 0.32;
    if (fog.far != null) u.uFogFar.value = fog.far * 0.58;
  }
}

const MARK_VERT = /* glsl */ `
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const MARK_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  if (vAlpha < 0.02) discard;
  gl_FragColor = vec4(vColor, vAlpha);
}
`;

const MARK_PROFILE = {
  tarmac: { type: "hard", life: 10.5, width: 0.18, alpha: 0.44, dark: 0.12, slip: 0.24, steer: 0.2, speed: 12 },
  cobble: { type: "hard", life: 8.5, width: 0.17, alpha: 0.32, dark: 0.18, slip: 0.26, steer: 0.24, speed: 11 },
  gravel: { type: "soft", life: 7.2, width: 0.21, alpha: 0.28, dark: 0.72, slip: 0.08, steer: 0.08, speed: 4 },
  dirt: { type: "soft", life: 8.8, width: 0.23, alpha: 0.3, dark: 0.74, slip: 0.06, steer: 0.08, speed: 3.5 },
  grass: { type: "soft", life: 5.8, width: 0.2, alpha: 0.18, dark: 0.7, slip: 0.05, steer: 0.08, speed: 4.5 },
  sand: { type: "soft", life: 11.5, width: 0.26, alpha: 0.24, dark: 0.82, slip: 0.04, steer: 0.06, speed: 3 },
  mud: { type: "soft", life: 12.5, width: 0.27, alpha: 0.38, dark: 0.68, slip: 0.03, steer: 0.05, speed: 2.5 },
};

export class TireMarks {
  /**
   * Persistent tire trails and skid marks written into the stage.
   * Soft surfaces get dusty ruts; hard surfaces only mark when the tire is
   * working hard enough to scrub.
   *
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.count = 12800;
    this.pos = new Float32Array(this.count * 6 * 3);
    this.col = new Float32Array(this.count * 6 * 3);
    this.alpha = new Float32Array(this.count * 6);
    this.baseAlpha = new Float32Array(this.count);
    this.life = new Float32Array(this.count);
    this.maxLife = new Float32Array(this.count);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: MARK_VERT,
      fragmentShader: MARK_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.i = 0;
    this._query = {};
    this._carry = new WeakMap();
    this._last = new WeakMap();
    this._color = new THREE.Color();
    this._up = 0.018;
    for (let i = 0; i < this.pos.length; i += 3) this.pos[i + 1] = -40;
  }

  /**
   * @param {{position:{x:number,y:number,z:number}, yaw:number, speed:number, surfaceId:string, slip?:number, drifting?:boolean, driftAngle?:number, onGround?:boolean, ai?:boolean, velocity?:{x:number,z:number}, steer?:number, spec?:{wheelbase?:number, trackRear?:number, trackFront?:number}}} vehicle
   * @param {{query:(x:number,z:number,out?:object,hintDist?:number)=>object}} track
   * @param {number} dt
   */
  emit(vehicle, track, dt) {
    if (!track || vehicle.onGround === false) return;
    const id = vehicle.surfaceId;
    const profile = MARK_PROFILE[id];
    if (!profile) return;
    const speed = vehicle.speed || 0;
    const slip = Math.abs(vehicle.slip || 0);
    const steer = Math.abs(vehicle.steer || 0);
    const drift = Math.abs(vehicle.driftAngle || 0);
    const soft = profile.type === "soft";
    const working = slip > profile.slip || drift > 0.05 || steer > profile.steer;
    const active = soft
      ? vehicle.ai
        ? speed > Math.max(2.4, profile.speed * 0.5)
        : speed > profile.speed && working
      : speed > profile.speed &&
        (slip > profile.slip || drift > 0.16 || (steer > profile.steer && slip > profile.slip * 0.75) || vehicle.drifting);
    const rollOnly = soft && vehicle.ai && !working;

    if (!active) {
      this._last.delete(vehicle);
      this._carry.delete(vehicle);
      return;
    }

    const stride = soft ? (vehicle.ai ? 0.18 : 0.22) : 0.28;
    const budget = (this._carry.get(vehicle) || 0) + speed * dt;
    if (budget < stride) {
      this._carry.set(vehicle, budget);
      return;
    }
    this._carry.set(vehicle, budget % stride);

    const yaw = vehicle.yaw || 0;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const wb = (vehicle.spec && vehicle.spec.wheelbase) || 2.5;
    const tf = ((vehicle.spec && vehicle.spec.trackFront) || 1.5) * 0.5;
    const tr = ((vehicle.spec && vehicle.spec.trackRear) || 1.5) * 0.5;
    const frontSteer = (vehicle.steer || 0) * 0.9;
    const wheels = [
      { along: wb * 0.5, lat: tf, heading: yaw + frontSteer },
      { along: wb * 0.5, lat: -tf, heading: yaw + frontSteer },
      { along: -wb * 0.5, lat: tr, heading: yaw },
      { along: -wb * 0.5, lat: -tr, heading: yaw },
    ];
    const prev = this._last.get(vehicle) || [null, null, null, null];

    for (let i = 0; i < wheels.length; i++) {
      const w = wheels[i];
      const x = vehicle.position.x + fx * w.along + rx * w.lat;
      const z = vehicle.position.z + fz * w.along + rz * w.lat;
      const q = track.query(x, z, this._query, vehicle.progress || 0);
      if (!q || q.jump || q.tunnel) {
        prev[i] = null;
        continue;
      }
      const here = { x, y: q.height + this._up, z, heading: w.heading, surface: q.surface };
      const last = prev[i];
      prev[i] = here;
      if (!last || last.surface !== here.surface) continue;
      const dx = here.x - last.x;
      const dz = here.z - last.z;
      const len = Math.hypot(dx, dz);
      if (len < stride * 0.65 || len > 2.4) continue;
      this._writeSegment(last, here, profile, slip, drift, speed, i >= 2, rollOnly);
    }
    this._last.set(vehicle, prev);
  }

  /**
   * @param {{x:number,y:number,z:number,heading:number}} a
   * @param {{x:number,y:number,z:number,heading:number}} b
   * @param {{life:number,width:number,alpha:number,dark:number,type:string}} profile
   * @param {number} slip
   * @param {number} drift
   * @param {number} speed
   * @param {boolean} rear
   * @param {boolean} [rollOnly]
   */
  _writeSegment(a, b, profile, slip, drift, speed, rear, rollOnly = false) {
    const dirX = b.x - a.x;
    const dirZ = b.z - a.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = dirZ / len;
    const nz = -dirX / len;
    const width =
      profile.width *
      (profile.type === "soft" ? 1.1 + Math.min(0.55, slip * 0.45 + drift * 0.35) : 1 + Math.min(0.25, slip * 0.18)) *
      (rear ? 1.03 : 0.97);
    const alpha =
      profile.alpha *
      Math.min(1, 0.35 + speed / 26 + slip * (profile.type === "hard" ? 1.45 : 0.7) + drift * 0.9) *
      (rollOnly ? 0.58 : 1);
    if (profile.type === "soft") {
      const sink = Math.min(0.034, 0.008 + slip * 0.012 + drift * 0.018 + speed * 0.00022);
      const ridgeLift = sink * 0.7;
      const centerHalf = width * 0.62;
      const ridgeHalf = width * 0.18;
      const ridgeOffset = width * 0.82;
      this._writeQuad(
        a.x,
        a.y - sink,
        a.z,
        b.x,
        b.y - sink,
        b.z,
        nx,
        nz,
        centerHalf,
        0x6e5434,
        profile.dark * 0.9,
        alpha * 1.05,
        profile.life
      );
      this._writeQuad(
        a.x + nx * ridgeOffset,
        a.y + ridgeLift,
        a.z + nz * ridgeOffset,
        b.x + nx * ridgeOffset,
        b.y + ridgeLift,
        b.z + nz * ridgeOffset,
        nx,
        nz,
        ridgeHalf,
        profile.type === "soft" && profile.width > 0.25 ? 0xc4aa72 : 0xb09062,
        0.88,
        alpha * 0.62,
        profile.life * 0.85
      );
      this._writeQuad(
        a.x - nx * ridgeOffset,
        a.y + ridgeLift,
        a.z - nz * ridgeOffset,
        b.x - nx * ridgeOffset,
        b.y + ridgeLift,
        b.z - nz * ridgeOffset,
        nx,
        nz,
        ridgeHalf,
        profile.type === "soft" && profile.width > 0.25 ? 0xc4aa72 : 0xb09062,
        0.88,
        alpha * 0.62,
        profile.life * 0.85
      );
      return;
    }
    this._writeQuad(a.x, a.y, a.z, b.x, b.y, b.z, nx, nz, width, 0x111111, profile.dark, alpha, profile.life);
  }

  _writeQuad(ax0, ay0, az0, bx0, by0, bz0, nx, nz, halfWidth, hex, shade, alpha, lifeOverride) {
    const i = this.i % this.count;
    this.i += 1;
    const base = i * 18;
    this._color.setHex(hex);
    const r = this._color.r * shade;
    const g = this._color.g * shade;
    const bl = this._color.b * shade;
    const ax = ax0 + nx * halfWidth;
    const az = az0 + nz * halfWidth;
    const bx = ax0 - nx * halfWidth;
    const bz = az0 - nz * halfWidth;
    const cx = bx0 + nx * halfWidth;
    const cz = bz0 + nz * halfWidth;
    const dx = bx0 - nx * halfWidth;
    const dz = bz0 - nz * halfWidth;
    const verts = [
      ax, ay0, az,
      bx, ay0, bz,
      cx, by0, cz,
      cx, by0, cz,
      bx, ay0, bz,
      dx, by0, dz,
    ];
    for (let v = 0; v < 18; v++) this.pos[base + v] = verts[v];
    const cBase = i * 18;
    for (let v = 0; v < 6; v++) {
      const ci = cBase + v * 3;
      this.col[ci] = r;
      this.col[ci + 1] = g;
      this.col[ci + 2] = bl;
      this.alpha[i * 6 + v] = alpha;
    }
    this.baseAlpha[i] = alpha;
    this.life[i] = lifeOverride || this.life[i] || 8;
    this.maxLife[i] = lifeOverride || this.maxLife[i] || 8;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }

  /**
   * Fade marks over time so the whole stage does not blacken.
   * @param {number} dt
   */
  step(dt) {
    let alphaDirty = false;
    let posDirty = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const t = this.life[i] / (this.maxLife[i] || 1);
      const a = Math.max(0, t) * this.baseAlpha[i];
      const base = i * 6;
      for (let v = 0; v < 6; v++) this.alpha[base + v] = a;
      alphaDirty = true;
      if (this.life[i] <= 0) {
        const p = i * 18;
        for (let v = 0; v < 6; v++) this.pos[p + v * 3 + 1] = -40;
        this.baseAlpha[i] = 0;
        posDirty = true;
      }
    }
    if (alphaDirty) this.geo.attributes.aAlpha.needsUpdate = true;
    if (posDirty) this.geo.attributes.position.needsUpdate = true;
  }

  reset() {
    this._last = new WeakMap();
    this._carry = new WeakMap();
    for (let i = 0; i < this.life.length; i++) this.life[i] = 0;
    for (let i = 0; i < this.baseAlpha.length; i++) this.baseAlpha[i] = 0;
    for (let i = 0; i < this.alpha.length; i++) this.alpha[i] = 0;
    for (let i = 1; i < this.pos.length; i += 3) this.pos[i] = -40;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

/**
 * Soft irregular puff so points read as dust volume, not hard discs.
 * @returns {THREE.CanvasTexture}
 */
function makeDustSprite() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 64, 64);
  // Fine dust puffs + sharp grit specks — reads as sand/dirt, not soft blobs.
  const blobs = [
    [32, 32, 18, 0.82],
    [24, 28, 10, 0.55],
    [40, 34, 9, 0.48],
    [30, 38, 7, 0.42],
    [36, 26, 6, 0.38],
    [28, 30, 4, 0.65],
    [38, 36, 3, 0.58],
    [22, 34, 3, 0.52],
    [42, 28, 2.5, 0.48],
    [34, 40, 2, 0.44],
  ];
  for (let i = 0; i < blobs.length; i++) {
    const [x, y, r, a] = blobs[i];
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.45, `rgba(255,255,255,${a * 0.35})`);
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // Grain noise for sandy texture.
  for (let n = 0; n < 48; n++) {
    const x = Math.random() * 64;
    const y = Math.random() * 64;
    const r = 0.4 + Math.random() * 1.2;
    g.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.35})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
