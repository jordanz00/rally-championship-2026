/**
 * Wheel surface spray — dirt / sand / mud / gravel kicked from contact patches.
 *
 * WHO THIS IS FOR: the race loop (chase + POV).
 * WHAT IT DOES: all four tires emit surface-aware grit and plume. Particles
 *   inherit chassis velocity, wheel spin, slip, and suspension unload; fall
 *   under gravity with air drag; bounce or stick on Track.query ground.
 *   Sand = warm fine plume; dirt = brown grit; mud = heavy wet clumps;
 *   gravel = sharp chips. Tarmac / cobble stay clean.
 * HOW IT CONNECTS: game.js emit()s the player (+ up to two near rivals) after
 *   physics, then step(dt, track); setAtmosphere() syncs fog + wind.
 *
 * FRAME BUDGET: one pooled Points system. No per-particle heap alloc.
 */

import * as THREE from "../vendor/three.module.js";
import { getSurface } from "./physics/surfaces.js?v=57";
import { VISUAL } from "./config.js?v=233";
import { RENDER_CAPS } from "./gfx/render-caps.js?v=1";

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
    [32, 32, 11, 0.9],
    [28, 30, 5, 0.55],
    [36, 34, 4.5, 0.48],
    [31, 36, 3, 0.7],
    [35, 28, 2.5, 0.62],
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

/**
 * Custom GLSL particle materials are WebGL-only (Phase R native WebGPU skips them).
 * @param {object} spec ShaderMaterial parameters
 * @returns {THREE.Material}
 */
function particleMaterial(spec) {
  if (RENDER_CAPS.glslCustom) return new THREE.ShaderMaterial(spec);
  return new THREE.PointsMaterial({
    color: 0xc4a882,
    size: 0.22,
    map: makeDustSprite(),
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    sizeAttenuation: true,
  });
}

/**
 * Loose ribbon only. `rate` = particles/sec per driven wheel at ~80 km/h mid throttle.
 * Physics knobs: gravity (m/s²), damp (air drag 1/s), lift / kick (m/s impulse),
 * bounce (restitution on ground), stick (mud dies on contact).
 */
const PROFILE = {
  sand: {
    rate: 260, size: [0.14, 0.42], life: [0.55, 1.45], gravity: 7.2, damp: 1.15,
    spread: 1.85, lift: 4.2, kick: 8.2, chunks: 0.14, plume: 0.52, bounce: 0.12, stick: 0,
  },
  dirt: {
    rate: 210, size: [0.13, 0.36], life: [0.42, 1.05], gravity: 10.2, damp: 1.85,
    spread: 1.35, lift: 3.4, kick: 7.0, chunks: 0.36, plume: 0.28, bounce: 0.18, stick: 0,
  },
  gravel: {
    rate: 180, size: [0.11, 0.3], life: [0.32, 0.78], gravity: 14.5, damp: 2.4,
    spread: 1.15, lift: 2.8, kick: 7.6, chunks: 0.62, plume: 0.12, bounce: 0.28, stick: 0,
  },
  mud: {
    rate: 170, size: [0.16, 0.44], life: [0.38, 0.95], gravity: 16.8, damp: 3.4,
    spread: 0.72, lift: 2.4, kick: 4.8, chunks: 0.78, plume: 0.08, bounce: 0.02, stick: 1,
  },
  grass: {
    rate: 90, size: [0.1, 0.26], life: [0.28, 0.65], gravity: 11.5, damp: 2.2,
    spread: 1.0, lift: 2.2, kick: 4.5, chunks: 0.4, plume: 0.18, bounce: 0.1, stick: 0,
  },
};

/** Alias off-ribbon / stage ids onto a spray profile. */
const SURFACE_ALIAS = {
  sand: "sand",
  dirt: "dirt",
  gravel: "gravel",
  mud: "mud",
  grass: "grass",
  soft: "dirt",
  offroad: "sand",
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
  float dist = max(1.0, -mv.z);
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
  float fade = smoothstep(0.0, 0.06, vLife) * smoothstep(0.0, 0.18, 1.0 - (1.0 - vLife) * 0.35);
  float alpha = mask * fade * 0.92;
  if (alpha < 0.018) discard;
  float fog = clamp((vDepth - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  gl_FragColor = vec4(mix(vColor, uFogColor, fog * 0.78), alpha * (1.0 - fog * 0.72));
}
`;

export class Dust {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.count = VISUAL.rearDirtWake === false ? 1400 : 3600;
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
    this.bounce = new Float32Array(this.count);
    this.stick = new Uint8Array(this.count);
    this.bouncesLeft = new Uint8Array(this.count);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute("aLife", new THREE.BufferAttribute(this.fade, 1));
    this.geo.setAttribute("aAngle", new THREE.BufferAttribute(this.angle, 1));

    this.mat = particleMaterial({
      uniforms: {
        uMap: { value: makeDustSprite() },
        uScale: { value: 520 },
        uMaxPx: { value: 48 },
        uFogColor: { value: new THREE.Color(0xc9b48a) },
        uFogNear: { value: 100 },
        uFogFar: { value: 480 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = true;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 64);
    this.points.renderOrder = 4;
    // Always draw when we have a usable material — WebGPU fallback uses PointsMaterial.
    this.points.visible = true;
    scene.add(this.points);

    this.i = 0;
    this._color = new THREE.Color();
    this._wind = new THREE.Vector3(0, 0, 0);
    this._dustStrength = 0.35;
    /** @type {WeakMap<object, number[]>} per-wheel fractional emit carry (4) */
    this._carry = new WeakMap();
    this.alive = 0;
    this._emitDirty = false;
    this._hadLive = false;
    this.gnd = new Float32Array(this.count);
    this._query = {};
    this._qPhase = 0;
    /** @type {{query?: Function}|null} */
    this._track = null;
    this.cockpit = false;
    this.locked30 = false;
    for (let i = 0; i < this.count; i++) {
      this.pos[i * 3 + 1] = -40;
      this.gnd[i] = -20;
    }
  }

  /**
   * Stage fog + wind from LIGHTING (called when a course loads / tunnels blend).
   * @param {{fog?:number, fogNear?:number, fogFar?:number, wind?:number[], dustStrength?:number}|null} L
   */
  setAtmosphere(L) {
    if (!L) return;
    if (this.mat.uniforms) {
      if (L.fog != null) this.mat.uniforms.uFogColor.value.setHex(L.fog);
      if (L.fogNear != null) this.mat.uniforms.uFogNear.value = L.fogNear * 0.42;
      if (L.fogFar != null) this.mat.uniforms.uFogFar.value = L.fogFar * 0.7;
    }
    if (Array.isArray(L.wind) && L.wind.length >= 3) {
      this._wind.set(L.wind[0], L.wind[1], L.wind[2]);
    } else {
      this._wind.set(0, 0, 0);
    }
    this._dustStrength = L.dustStrength != null ? L.dustStrength : 0.28;
  }

  /**
   * Kick surface material from all four contact patches.
   * Rear axle carries most of the wake; fronts add turn-in spray on soft roads.
   *
   * @param {object} vehicle
   * @param {number} dt
   * @param {{query:(x:number,z:number,out?:object,hintDist?:number)=>object}|null} [track]
   */
  emit(vehicle, dt, track) {
    if (!vehicle || vehicle.onGround === false) return;
    if (track && typeof track.query === "function") this._track = track;
    const sphere = this.geo.boundingSphere;
    if (sphere && vehicle.position) {
      sphere.center.set(vehicle.position.x, vehicle.position.y + 0.45, vehicle.position.z);
    }

    const speed = vehicle.speed || 0;
    const throttle = vehicle.throttle || 0;
    const brake = vehicle.brake || 0;
    const slip = Math.min(1.8, Math.abs(vehicle.slip || 0));
    const drift = Math.abs(vehicle.driftAngle || 0);
    const kappaR = Math.abs(vehicle._kappaR || 0);
    const kappaF = Math.abs(vehicle._kappaF || 0);
    const omegaR = Math.abs(vehicle.omegaR || 0);
    const omegaF = Math.abs(vehicle.omegaF || 0);
    const radius = (vehicle.spec && vehicle.spec.wheelRadius) || 0.325;
    const spinExcessR = Math.max(0, omegaR * radius - speed);
    const spinExcessF = Math.max(0, omegaF * radius - speed);
    if (
      speed < 0.85 &&
      throttle < 0.08 &&
      brake < 0.08 &&
      kappaR < 0.05 &&
      kappaF < 0.05 &&
      slip < 0.08 &&
      spinExcessR < 0.8 &&
      spinExcessF < 0.8
    ) {
      return;
    }

    const yaw = vehicle.yaw || 0;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const vx = vehicle.velocity ? vehicle.velocity.x : fx * speed;
    const vz = vehicle.velocity ? vehicle.velocity.z : fz * speed;
    const vy = vehicle.velY || 0;
    const travel = Math.hypot(vx, vz);
    const oppX = travel > 0.12 ? -vx / travel : -fx;
    const oppZ = travel > 0.12 ? -vz / travel : -fz;

    const slidePct =
      typeof vehicle.slidePct === "function" ? vehicle.slidePct() : vehicle._slidePct || 0;
    const speedK = clamp01((speed - 0.6) / 26);
    const slipK = clamp01(slip * 1.05 + (vehicle.drifting ? 0.55 : 0) + drift * 1.05 + slidePct * 0.95);
    const spinK = clamp01(kappaR * 1.5 + kappaF * 0.9 + (spinExcessR + spinExcessF) / 14);
    const throtK = clamp01(throttle);
    const brakeK = clamp01(brake);
    // Cruise trickle + throttle roost + brake dig + slides / wheelspin.
    const work =
      speedK * 0.72 + throtK * 0.55 + brakeK * 0.35 + slipK * 2.15 + spinK * 1.35;
    if (work < 0.035) return;

    const focus = vehicle.ai ? 0.38 : this.cockpit ? 1.05 : 1.35;
    const envBoost = 0.95 + this._dustStrength * 1.15;
    const wakeOn = VISUAL.rearDirtWake !== false;

    let bag = this._carry.get(vehicle);
    if (!bag || bag.length !== 4) {
      bag = [0, 0, 0, 0];
      this._carry.set(vehicle, bag);
    }

    const spec = vehicle.spec || {};
    const wb = spec.wheelbase || 2.5;
    const tf = (spec.trackFront || 1.5) * 0.5;
    const tr = (spec.trackRear || 1.5) * 0.5;
    const wheels = vehicle.wheels;
    const hint = vehicle.progress || 0;
    const slideSign = Math.sign(vehicle.driftAngle || 0);
    const liftCap = this.cockpit ? 1.15 : 4.8;
    // Suspension unload kicks grit up — compress rebound on soft roads.
    const unload =
      vehicle._wheelVel && Array.isArray(vehicle._wheelVel)
        ? Math.max(0, -Math.min(...vehicle._wheelVel) * 0.45)
        : 0;
    let spawned = false;

    for (let wi = 0; wi < 4; wi++) {
      const rear = wi >= 2;
      const w = wheels && wheels[wi];
      const along = w ? w.z : rear ? -wb * 0.5 : wb * 0.5;
      const lat = w
        ? w.x
        : rear
          ? wi === 2
            ? tr
            : -tr
          : wi === 0
            ? tf
            : -tf;
      const sideSign = w && w.side != null ? w.side : lat >= 0 ? 1 : -1;
      const axleMul = rear ? 1.0 : 0.42;
      const omega = rear ? omegaR : omegaF;
      const kappa = rear ? kappaR : kappaF;
      const tread = omega * radius;
      const px = vehicle.position.x + fx * along + rx * lat;
      const pz = vehicle.position.z + fz * along + rz * lat;

      let sid = vehicle.surfaceId;
      let groundY = vehicle.position.y;
      const qTrack = this._track;
      if (qTrack && typeof qTrack.query === "function") {
        const q = qTrack.query(px, pz, this._query, hint);
        if (q) {
          if (q.surface) sid = q.surface;
          if (Number.isFinite(q.height)) groundY = q.height;
        }
      } else if (rear && vehicle._axRear && vehicle._axRear.surface) {
        sid = vehicle._axRear.surface;
      } else if (!rear && vehicle._axFront && vehicle._axFront.surface) {
        sid = vehicle._axFront.surface;
      }

      const key = SURFACE_ALIAS[sid] || null;
      const profile = key ? PROFILE[key] : null;
      if (!profile) continue;
      const surf = getSurface(sid);
      const outside = slideSign !== 0 && sideSign === slideSign ? 1.28 : 0.92;
      const perSec =
        profile.rate *
        work *
        axleMul *
        (surf.dust || 1) *
        focus *
        envBoost *
        outside *
        (this.cockpit ? 0.62 : 1);
      bag[wi] += perSec * dt;
      const cap = vehicle.ai ? 3 : this.cockpit ? 14 : 22;
      let n = Math.min(cap, bag[wi] | 0);
      bag[wi] -= n;
      if (n < 1) continue;
      spawned = true;

      this._color.setHex(surf.dustColor != null ? surf.dustColor : surf.color);
      const br = this._color.r;
      const bg = this._color.g;
      const bb = this._color.b;
      const wheelSpinK = clamp01(kappa * 1.4 + Math.max(0, tread - speed) / 12);

      while (n-- > 0) {
        this._spawnRoost(
          profile,
          key,
          px,
          groundY,
          pz,
          vx,
          vy,
          vz,
          fx,
          fz,
          rx,
          rz,
          sideSign,
          slipK,
          speedK,
          throtK,
          wheelSpinK,
          oppX,
          oppZ,
          tread,
          wakeOn,
          br,
          bg,
          bb,
          liftCap,
          unload,
          rear
        );
      }
    }

    if (!spawned) return;
    this._emitDirty = true;
    this.alive = Math.max(this.alive, 1);
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
  }

  /**
   * Write one pooled particle at a contact patch. No heap alloc.
   */
  _spawnRoost(
    profile,
    sid,
    px,
    groundY,
    pz,
    vx,
    vy,
    vz,
    fx,
    fz,
    rx,
    rz,
    sideSign,
    slipK,
    speedK,
    throtK,
    spinK,
    oppX,
    oppZ,
    tread,
    wakeOn,
    br,
    bg,
    bb,
    liftCap,
    unload,
    rear
  ) {
    const roll = Math.random();
    const grit = roll < profile.chunks;
    const plume = !grit && wakeOn && roll < profile.chunks + (profile.plume || 0.2);
    const speck = !grit && !plume && roll > 0.7;
    const i = this.i % this.count;
    this.i += 1;

    const out = sideSign * (0.1 + Math.random() * (rear ? 0.22 : 0.14));
    const jitter = (Math.random() - 0.5) * 0.08;
    const aft = rear ? 0.08 + Math.random() * 0.22 : -0.04 + Math.random() * 0.1;
    this.pos[i * 3] = px + rx * (jitter + out) - fx * aft;
    this.pos[i * 3 + 1] = groundY + 0.06 + Math.random() * 0.1;
    this.pos[i * 3 + 2] = pz + rz * (jitter + out) - fz * aft;
    this.gnd[i] = groundY;

    const kick =
      profile.kick *
      (0.32 + speedK * 0.38 + throtK * 0.42 + slipK * 0.85 + spinK * 0.55) *
      (plume ? 0.82 : 1) *
      (rear ? 1 : 0.78);
    const spread = profile.spread * (0.5 + Math.random() * 0.55);
    const liftBase =
      profile.lift * (0.55 + Math.random() * 0.55) + unload * (0.6 + Math.random() * 0.5);
    let lift = grit ? liftBase * 0.58 : plume ? liftBase * 0.92 : liftBase;
    if (lift > liftCap) lift = liftCap;

    const inherit = plume ? 0.52 : grit ? 0.22 : 0.38;
    const fanLat = (Math.random() - 0.5) * spread;
    const fanRear = kick * (0.5 + Math.random() * 0.5);
    const tangent = tread * (0.1 + throtK * 0.1 + spinK * 0.16);
    const slideLat = sideSign * (0.28 + slipK * 1.35);
    this.vel[i * 3] =
      vx * inherit +
      oppX * fanRear +
      -fx * tangent +
      rx * fanLat +
      rx * slideLat +
      this._wind.x * (0.15 + Math.random() * 0.22);
    this.vel[i * 3 + 1] = lift + vy * 0.35 + (Math.random() - 0.5) * 0.25;
    this.vel[i * 3 + 2] =
      vz * inherit +
      oppZ * fanRear +
      -fz * tangent +
      rz * fanLat +
      rz * slideLat +
      this._wind.z * (0.15 + Math.random() * 0.22);

    const life =
      lerp(profile.life[0], profile.life[1], Math.random()) *
      (grit ? 0.7 : plume ? 1.12 : speck ? 0.75 : 0.92);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.fade[i] = 1;

    let sz = lerp(profile.size[0], profile.size[1], Math.random());
    if (grit) sz *= 0.85 + Math.random() * 0.35;
    else if (plume) sz *= 1.05 + Math.random() * 0.35 + slipK * 0.12;
    else if (speck) sz *= 0.55 + Math.random() * 0.25;
    else sz *= 0.85 + Math.random() * 0.35 + slipK * 0.08;
    sz *= 1.05 + speedK * 0.18;
    if (this.cockpit) sz *= 0.78;
    if (sz < 0.08) sz = 0.08;
    this.size[i] = sz;

    this.angle[i] = Math.random() * 6.283;
    this.spin[i] = (Math.random() - 0.5) * (grit ? 18 : plume ? 2.8 : 9);
    this.seed[i] = Math.random() * 6.283;
    this.grav[i] = grit
      ? profile.gravity * (1.05 + Math.random() * 0.35)
      : profile.gravity * (plume ? 0.62 : 0.92) * (0.85 + Math.random() * 0.25);
    const damp = profile.damp != null ? profile.damp : 2.0;
    this.drag[i] = grit ? damp * 1.25 : plume ? damp * 0.65 : damp;
    this.bounce[i] = grit ? profile.bounce * (0.7 + Math.random() * 0.5) : profile.bounce * 0.25;
    this.stick[i] = profile.stick ? 1 : 0;
    this.bouncesLeft[i] = grit ? 2 : plume ? 0 : 1;

    let shade;
    if (grit) shade = 0.38 + Math.random() * 0.28;
    else if (speck) shade = 0.62 + Math.random() * 0.2;
    else if (plume) shade = 0.72 + Math.random() * 0.2;
    else shade = 0.55 + Math.random() * 0.28;
    let cr = br * shade;
    let cg = bg * shade;
    let cb = bb * shade;
    if (sid === "sand") {
      cr *= 1.38 + Math.random() * 0.12;
      cg *= 1.18 + Math.random() * 0.08;
      cb *= 0.72;
    } else if (sid === "dirt") {
      cr *= 1.22 + Math.random() * 0.08;
      cg *= 1.05;
      cb *= 0.78;
    } else if (sid === "mud") {
      cr *= 0.55;
      cg *= 0.48;
      cb *= 0.36;
    } else if (sid === "gravel") {
      cr *= 1.12 + Math.random() * 0.08;
      cg *= 1.08;
      cb *= 1.0;
    } else if (sid === "grass") {
      cr *= 0.85;
      cg *= 1.05;
      cb *= 0.7;
    }
    this.col[i * 3] = cr;
    this.col[i * 3 + 1] = cg;
    this.col[i * 3 + 2] = cb;
  }

  /**
   * Integrate pooled particles with gravity, drag, wind, and ground response.
   * @param {number} dt
   * @param {{query:(x:number,z:number,out?:object,hintDist?:number)=>object}|null} [track]
   */
  step(dt, track) {
    if (track && typeof track.query === "function") this._track = track;
    this._syncFog();
    if (!this.alive && !this._emitDirty) return;
    this._emitDirty = false;
    const qTrack = this._track;
    const wx = this._wind.x;
    const wz = this._wind.z;
    this._qPhase = (this._qPhase + 1) & 3;
    let live = 0;
    let queries = 0;
    const QCAP = this.locked30 ? 48 : 96;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const t = this.life[i];
      const maxL = this.maxLife[i] || 1;
      const age = 1 - clamp01(t / maxL);
      const turb = 0.55 * (1 - age);
      const swirl = Math.sin(this.seed[i] + t * 7.5) * turb;
      const cross = Math.cos(this.seed[i] * 1.9 + t * 5.8) * turb;
      this.vel[i * 3] += (swirl + wx * 0.28) * dt;
      this.vel[i * 3 + 2] += (cross + wz * 0.28) * dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const keep = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= keep;
      this.vel[i * 3 + 2] *= keep;
      this.vel[i * 3 + 1] *= Math.exp(-0.75 * dt);
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.angle[i] += this.spin[i] * dt;

      let floor = this.gnd[i];
      const py = this.pos[i * 3 + 1];
      if (
        qTrack &&
        typeof qTrack.query === "function" &&
        this.vel[i * 3 + 1] < 0 &&
        py < floor + 1.2 &&
        queries < QCAP &&
        (i & 3) === this._qPhase
      ) {
        const q = qTrack.query(this.pos[i * 3], this.pos[i * 3 + 2], this._query);
        queries += 1;
        if (q && Number.isFinite(q.height)) {
          floor = q.height;
          this.gnd[i] = floor;
        }
      }

      if (py <= floor + 0.02) {
        if (this.stick[i] || this.bouncesLeft[i] <= 0 || Math.abs(this.vel[i * 3 + 1]) < 0.8) {
          this.life[i] = 0;
          this.fade[i] = 0;
          this.pos[i * 3 + 1] = -40;
          continue;
        }
        this.pos[i * 3 + 1] = floor + 0.03;
        this.vel[i * 3 + 1] *= -this.bounce[i];
        this.vel[i * 3] *= 0.55;
        this.vel[i * 3 + 2] *= 0.55;
        this.bouncesLeft[i] -= 1;
        this.life[i] *= 0.72;
      }
      if (t <= 0 || py < -8) {
        this.life[i] = 0;
        this.fade[i] = 0;
        this.pos[i * 3 + 1] = -40;
        continue;
      }
      if (this.cockpit && py > floor + 0.85) {
        this.life[i] = 0;
        this.fade[i] = 0;
        this.pos[i * 3 + 1] = -40;
        continue;
      }
      this.fade[i] = t / (this.maxLife[i] || 1);
      live += 1;
    }
    this.alive = live;
    if (live > 0 || this._hadLive) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aLife.needsUpdate = true;
      this.geo.attributes.aAngle.needsUpdate = true;
    }
    this._hadLive = live > 0;
  }

  /**
   * Dust is a raw shader, so it does not get three.js' automatic fog.
   */
  _syncFog() {
    const fog = this.scene && this.scene.fog;
    if (!fog || !this.mat.uniforms) return;
    const u = this.mat.uniforms;
    if (fog.color) u.uFogColor.value.copy(fog.color);
    if (fog.near != null) u.uFogNear.value = fog.near * 0.45;
    if (fog.far != null) u.uFogFar.value = fog.far * 0.72;
  }
}

const SPARK_VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(1.2, aSize / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const SPARK_FRAG = /* glsl */ `
varying float vLife;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0) discard;
  float core = exp(-d * 3.2) * vLife;
  gl_FragColor = vec4(1.0, 0.82 + (1.0 - d) * 0.15, 0.35, core);
}
`;

/**
 * Short additive sparks on a wall or rival hit — the chase-cam read that paint
 * darkening never gave.
 */
export class ImpactSparks {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.count = 96;
    this.pos = new Float32Array(this.count * 3);
    this.vel = new Float32Array(this.count * 3);
    this.life = new Float32Array(this.count);
    this.maxLife = new Float32Array(this.count);
    this.size = new Float32Array(this.count);
    this.fade = new Float32Array(this.count);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute("aLife", new THREE.BufferAttribute(this.fade, 1));
    this.mat = particleMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = RENDER_CAPS.glslCustom;
    scene.add(this.points);
    this.i = 0;
    this.alive = 0;
    for (let i = 0; i < this.count; i++) this.pos[i * 3 + 1] = -80;
  }

  /**
   * @param {{x:number,y:number,z:number}} pos
   * @param {number} nx
   * @param {number} nz
   * @param {number} mag
   */
  burst(pos, nx, nz, mag) {
    if (!pos) return;
    const n = Math.min(32, 10 + ((mag || 0.5) * 16) | 0);
    const len = Math.hypot(nx, nz) || 1;
    const hx = nx / len;
    const hz = nz / len;
    const px = pos.x + hx * 0.85;
    const py = (pos.y || 0.6) + 0.35;
    const pz = pos.z + hz * 0.85;
    for (let k = 0; k < n; k++) {
      const i = this.i % this.count;
      this.i += 1;
      this.pos[i * 3] = px + (Math.random() - 0.5) * 0.4;
      this.pos[i * 3 + 1] = py + Math.random() * 0.35;
      this.pos[i * 3 + 2] = pz + (Math.random() - 0.5) * 0.4;
      const spray = 4 + Math.random() * 10 * (0.5 + mag);
      this.vel[i * 3] = hx * spray + (Math.random() - 0.5) * 6;
      this.vel[i * 3 + 1] = 2.2 + Math.random() * 7;
      this.vel[i * 3 + 2] = hz * spray + (Math.random() - 0.5) * 6;
      this.maxLife[i] = 0.12 + Math.random() * 0.22;
      this.life[i] = this.maxLife[i];
      this.size[i] = 7 + Math.random() * 10;
    }
    this.alive = 1;
    this.geo.attributes.aSize.needsUpdate = true;
  }

  /**
   * @param {number} dt
   */
  step(dt) {
    if (!this.alive) return;
    let live = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -80;
        this.fade[i] = 0;
        continue;
      }
      live += 1;
      this.vel[i * 3 + 1] -= 28 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.fade[i] = this.life[i] / (this.maxLife[i] || 1);
    }
    this.alive = live;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
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
  gravel: { type: "soft", life: 22.0, width: 0.32, alpha: 0.38, dark: 0.48, slip: 0.05, steer: 0.05, speed: 2.2 },
  dirt: { type: "soft", life: 28.0, width: 0.38, alpha: 0.42, dark: 0.45, slip: 0.03, steer: 0.04, speed: 0.7 },
  grass: { type: "soft", life: 12.0, width: 0.28, alpha: 0.28, dark: 0.62, slip: 0.04, steer: 0.06, speed: 1.4 },
  sand: { type: "soft", life: 34.0, width: 0.44, alpha: 0.4, dark: 0.5, slip: 0.015, steer: 0.03, speed: 0.55 },
  mud: { type: "soft", life: 40.0, width: 0.48, alpha: 0.52, dark: 0.32, slip: 0.01, steer: 0.025, speed: 0.45 },
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
    this.mat = RENDER_CAPS.glslCustom
      ? new THREE.ShaderMaterial({
          vertexShader: MARK_VERT,
          fragmentShader: MARK_FRAG,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
          toneMapped: false,
        })
      : new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = true;
    scene.add(this.mesh);
    this.i = 0;
    this._query = {};
    this._carry = new WeakMap();
    this._last = new WeakMap();
    this._color = new THREE.Color();
    this._up = 0.012;
    /** Reused wheel layout — no per-emit object alloc. */
    this._wheels = [
      { along: 0, lat: 0, heading: 0 },
      { along: 0, lat: 0, heading: 0 },
      { along: 0, lat: 0, heading: 0 },
      { along: 0, lat: 0, heading: 0 },
    ];
    this._gpuDirty = false;
    this._aliveMarks = 0;
    this._aiSoftGate = 0;
    this._segA = { x: 0, y: 0, z: 0, heading: 0, surface: "" };
    for (let i = 0; i < this.pos.length; i += 3) this.pos[i + 1] = -40;
  }

  /**
   * @param {{position:{x:number,y:number,z:number}, yaw:number, speed:number, surfaceId:string, slip?:number, drifting?:boolean, driftAngle?:number, onGround?:boolean, ai?:boolean, velocity?:{x:number,z:number}, steer?:number, spec?:{wheelbase?:number, trackRear?:number, trackFront?:number}}} vehicle
   * @param {{query:(x:number,z:number,out?:object,hintDist?:number)=>object, wheelDeform?:object, wheelRuts?:object}} track
   * @param {number} dt
   */
  emit(vehicle, track, dt) {
    if (!track || !vehicle || vehicle.onGround === false) return;
    const id = vehicle.surfaceId;
    const profile = MARK_PROFILE[id];
    if (!profile) return;
    const speed = vehicle.speed || 0;
    const slip = Math.abs(vehicle.slip || 0);
    const steer = Math.abs(vehicle.steer || 0);
    const drift = Math.abs(vehicle.driftAngle || 0);
    const throttle = vehicle.throttle || 0;
    const brake = vehicle.brake || 0;
    const soft = profile.type === "soft";
    const working = slip > profile.slip || drift > 0.05 || steer > profile.steer || throttle > 0.55 || brake > 0.35;
    // Soft roads leave tracks from a crawl — hard surfaces still need scrub.
    const active = soft
      ? vehicle.ai
        ? speed > Math.max(1.1, profile.speed * 0.4)
        : speed > Math.max(0.45, profile.speed * 0.5)
      : speed > profile.speed &&
        (slip > profile.slip || drift > 0.16 || (steer > profile.steer && slip > profile.slip * 0.75) || vehicle.drifting);
    const rollOnly = soft && !working && speed > (vehicle.ai ? 1.4 : 0.7);

    if (!active) {
      this._last.delete(vehicle);
      this._carry.delete(vehicle);
      return;
    }

    // AI soft: half-rate stamps when only rolling — same trench look, half CPU.
    if (vehicle.ai && soft && rollOnly) {
      this._aiSoftGate += 1;
      if (this._aiSoftGate & 1) return;
    }

    const stride = soft ? (vehicle.ai ? 0.24 : 0.12) : 0.28;
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
    const wheels = this._wheels;
    wheels[0].along = wb * 0.5;
    wheels[0].lat = tf;
    wheels[0].heading = yaw + frontSteer;
    wheels[1].along = wb * 0.5;
    wheels[1].lat = -tf;
    wheels[1].heading = yaw + frontSteer;
    wheels[2].along = -wb * 0.5;
    wheels[2].lat = tr;
    wheels[2].heading = yaw;
    wheels[3].along = -wb * 0.5;
    wheels[3].lat = -tr;
    wheels[3].heading = yaw;

    let prev = this._last.get(vehicle);
    if (!prev) {
      prev = [
        { x: 0, y: 0, z: 0, heading: 0, surface: "", valid: false },
        { x: 0, y: 0, z: 0, heading: 0, surface: "", valid: false },
        { x: 0, y: 0, z: 0, heading: 0, surface: "", valid: false },
        { x: 0, y: 0, z: 0, heading: 0, surface: "", valid: false },
      ];
      this._last.set(vehicle, prev);
    }

    // Wheelspin / lock digs harder into soft roads.
    const omegaR = Math.abs(vehicle.omegaR || 0);
    const radius = (vehicle.spec && vehicle.spec.wheelRadius) || 0.325;
    const spinDig = Math.min(1, Math.max(0, omegaR * radius - speed) / 10);
    const load = {
      throttle,
      brake,
      dig: spinDig + (vehicle.drifting ? 0.35 : 0) + drift * 0.5,
      speed,
    };

    // AI soft: rear tires only — fronts add little visual, cut 2× queries/stamps.
    const w0 = soft && vehicle.ai ? 2 : 0;
    for (let i = w0; i < 4; i++) {
      const w = wheels[i];
      const x = vehicle.position.x + fx * w.along + rx * w.lat;
      const z = vehicle.position.z + fz * w.along + rz * w.lat;
      const q = track.query(x, z, this._query, vehicle.progress || 0);
      const slot = prev[i];
      if (!q || q.jump || q.tunnel) {
        slot.valid = false;
        continue;
      }
      const baseH = q.baseHeight != null ? q.baseHeight : q.height - (q.wheelDeform || 0);
      const lastValid = slot.valid;
      const lastX = slot.x;
      const lastY = slot.y;
      const lastZ = slot.z;
      const lastSurf = slot.surface;
      slot.x = x;
      slot.y = baseH + this._up;
      slot.z = z;
      slot.heading = w.heading;
      slot.surface = q.surface;
      slot.valid = true;
      if (!lastValid || lastSurf !== slot.surface) continue;
      const dx = slot.x - lastX;
      const dz = slot.z - lastZ;
      const len = Math.hypot(dx, dz);
      if (len < stride * 0.55 || len > 2.8) continue;
      this._segA.x = lastX;
      this._segA.y = lastY;
      this._segA.z = lastZ;
      this._segA.surface = lastSurf;
      this._writeSegment(this._segA, slot, profile, slip, drift, speed, i >= 2, rollOnly, track, load);
    }
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
   * @param {{wheelDeform?:object,wheelRuts?:object}} [track]
   * @param {{throttle?:number, brake?:number, dig?:number, speed?:number}|null} [load]
   */
  _writeSegment(a, b, profile, slip, drift, speed, rear, rollOnly = false, track = null, load = null) {
    const dirX = b.x - a.x;
    const dirZ = b.z - a.z;
    const len = Math.hypot(dirX, dirZ) || 1;
    const nx = dirZ / len;
    const nz = -dirX / len;
    const halfW =
      profile.width *
      (profile.type === "soft" ? 0.88 : 0.5) *
      (rear ? 1.12 : 1.0);

    if (profile.type === "soft" && track && track.wheelDeform) {
      const surface = a.surface || b.surface || "dirt";
      const pressure = rollOnly ? 0.9 : 1.28;
      const digLoad = {
        throttle: (load && load.throttle) || 0,
        brake: (load && load.brake) || 0,
        dig: ((load && load.dig) || 0) * (rear ? 1.15 : 0.85) * (rollOnly ? 0.7 : 1),
        speed,
      };
      track.wheelDeform.stampSegment(
        a,
        b,
        halfW,
        surface,
        slip * pressure,
        drift * pressure,
        speed,
        digLoad
      );
      if (track.wheelRuts) {
        track.wheelRuts.writeSegment(a, b, halfW, surface, slip * pressure, drift * pressure, digLoad);
      }
      // Dusty/dark trail so the trench reads at chase distance.
      const softHex =
        surface === "mud" ? 0x18140e : surface === "sand" ? 0x52402e : surface === "gravel" ? 0x2a2824 : 0x1e1812;
      const width =
        profile.width * (1 + Math.min(0.45, slip * 0.28 + drift * 0.22 + digLoad.dig * 0.15)) * (rear ? 1.1 : 1.0);
      const alpha =
        profile.alpha *
        Math.min(1, 0.55 + speed / 28 + slip * 1.2 + drift * 0.85 + digLoad.dig * 0.35) *
        (rollOnly ? 0.78 : 1);
      this._writeQuad(
        a.x,
        a.y,
        a.z,
        b.x,
        b.y,
        b.z,
        nx,
        nz,
        width,
        softHex,
        profile.dark,
        alpha,
        profile.life
      );
      return;
    }

    const width =
      profile.width * (1 + Math.min(0.25, slip * 0.18)) * (rear ? 1.03 : 0.97);
    const alpha =
      profile.alpha *
      Math.min(1, 0.35 + speed / 26 + slip * 1.45 + drift * 0.9) *
      (rollOnly ? 0.58 : 1);
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
    const verts = [ax, ay0, az, bx, ay0, bz, cx, by0, cz, cx, by0, cz, bx, ay0, bz, dx, by0, dz];
    for (let v = 0; v < 18; v++) this.pos[base + v] = verts[v];
    for (let v = 0; v < 6; v++) {
      const ci = base + v * 3;
      this.col[ci] = r;
      this.col[ci + 1] = g;
      this.col[ci + 2] = bl;
      this.alpha[i * 6 + v] = alpha;
    }
    this.baseAlpha[i] = alpha;
    this.life[i] = lifeOverride || 8;
    this.maxLife[i] = lifeOverride || 8;
    this._gpuDirty = true;
    this._aliveMarks += 1;
  }

  /**
   * Fade marks over time so the whole stage does not blacken.
   * @param {number} dt
   */
  step(dt) {
    if (this._aliveMarks <= 0 && !this._gpuDirty) return;
    let alphaDirty = false;
    let posDirty = false;
    let live = 0;
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
      } else {
        live += 1;
      }
    }
    this._aliveMarks = live;
    if (this._gpuDirty || posDirty) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aColor.needsUpdate = true;
      this.geo.attributes.aAlpha.needsUpdate = true;
      this._gpuDirty = false;
    } else if (alphaDirty) {
      this.geo.attributes.aAlpha.needsUpdate = true;
    }
  }

  reset() {
    this._last = new WeakMap();
    this._carry = new WeakMap();
    this._gpuDirty = false;
    this._aliveMarks = 0;
    for (let i = 0; i < this.life.length; i++) this.life[i] = 0;
    for (let i = 0; i < this.baseAlpha.length; i++) this.baseAlpha[i] = 0;
    for (let i = 0; i < this.alpha.length; i++) this.alpha[i] = 0;
    for (let i = 1; i < this.pos.length; i += 3) this.pos[i] = -40;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
