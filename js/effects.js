/**
 * Wheel surface spray — dirt / sand / mud / gravel kicked from contact patches.
 * Soft-road tire trails + hard skid marks live in TireMarks (dual-layer decals
 * + 3D rut stamps via surface-deform).
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
import { getSurface } from "./physics/surfaces.js?v=58";
import { VISUAL } from "./config.js?v=241";
import { RENDER_CAPS } from "./gfx/render-caps.js?v=1";
import { isPhonePlay } from "./ui/touch-controls.js?v=3";

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
    [32, 32, 9, 0.42],
    [28, 30, 4, 0.22],
    [36, 34, 3.5, 0.18],
    [31, 36, 2.4, 0.28],
    [35, 28, 2, 0.2],
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
 * Phone must never fall back to large opaque PointsMaterial — that path ignored
 * uMaxPx/uAlpha and painted a brown wall over the chase.
 * @param {object} spec ShaderMaterial parameters
 * @param {boolean} [phone=false]
 * @returns {THREE.Material}
 */
function particleMaterial(spec, phone = false) {
  if (RENDER_CAPS.glslCustom && !phone) return new THREE.ShaderMaterial(spec);
  if (RENDER_CAPS.glslCustom && phone) {
    // Still use the shader so uAlpha=0 discards every fragment.
    return new THREE.ShaderMaterial(spec);
  }
  return new THREE.PointsMaterial({
    color: 0xc4a882,
    size: phone ? 0.02 : 0.12,
    map: makeDustSprite(),
    transparent: true,
    opacity: phone ? 0 : 0.28,
    depthWrite: false,
    depthTest: true,
    sizeAttenuation: true,
  });
}

/**
 * Loose ribbon spray. `rate` = particles/sec per driven wheel at ~80 km/h mid throttle.
 * Physics: gravity (m/s²), damp (air drag 1/s), lift / kick (m/s), bounce, stick.
 * Sized for medium chase — prior 0.14–0.42 m × uScale 520 read as dust mites.
 */
const PROFILE = {
  sand: {
    rate: 58, size: [0.07, 0.18], life: [0.28, 0.62], gravity: 12.5, damp: 1.85,
    spread: 0.38, lift: 0.42, kick: 2.4, chunks: 0.42, plume: 0.06, bounce: 0.08, stick: 0,
  },
  dirt: {
    rate: 46, size: [0.06, 0.16], life: [0.24, 0.52], gravity: 14.2, damp: 2.1,
    spread: 0.32, lift: 0.34, kick: 2.1, chunks: 0.48, plume: 0.05, bounce: 0.1, stick: 0,
  },
  gravel: {
    rate: 38, size: [0.05, 0.14], life: [0.2, 0.42], gravity: 16.5, damp: 2.4,
    spread: 0.28, lift: 0.28, kick: 2.2, chunks: 0.62, plume: 0.03, bounce: 0.16, stick: 0,
  },
  mud: {
    rate: 34, size: [0.07, 0.17], life: [0.22, 0.48], gravity: 17.5, damp: 2.8,
    spread: 0.22, lift: 0.22, kick: 1.6, chunks: 0.7, plume: 0.02, bounce: 0.02, stick: 1,
  },
  grass: {
    rate: 22, size: [0.05, 0.13], life: [0.18, 0.4], gravity: 14.5, damp: 2.2,
    spread: 0.26, lift: 0.26, kick: 1.5, chunks: 0.45, plume: 0.04, bounce: 0.08, stick: 0,
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
uniform float uAlpha;
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
  // Life falls off fast so sprites stay a haze, not a solid disc on the body.
  float fade = smoothstep(0.0, 0.14, vLife) * vLife * vLife;
  float alpha = mask * fade * uAlpha;
  if (alpha < 0.012) discard;
  float fog = clamp((vDepth - uFogNear) / max(1.0, uFogFar - uFogNear), 0.0, 1.0);
  // Soft haze only — prior fog*0.72 wiped the wake in Desert/Forest fog.
  gl_FragColor = vec4(mix(vColor, uFogColor, fog * 0.42), alpha * (1.0 - fog * 0.38));
}
`;

export class Dust {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    // Phones: dust OFF. Cinema wake was painting a solid brown wall over the
    // chase on Adreno/Mali (player screenshot). Desktop keeps the full spray.
    let phone = false;
    try {
      phone = isPhonePlay();
    } catch {
      phone = false;
    }
    this._phone = phone;
    this.count = phone ? 8 : VISUAL.rearDirtWake === false ? 480 : 900;
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

    this.mat = particleMaterial(
      {
        uniforms: {
          uMap: { value: makeDustSprite() },
          uScale: { value: phone ? 60 : 420 },
          uMaxPx: { value: phone ? 4 : 22 },
          uAlpha: { value: phone ? 0.0 : 0.32 },
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
      },
      phone
    );
    this.points = new THREE.Points(this.geo, this.mat);
    // One draw call — never cull a trailing plume that left the car sphere.
    this.points.frustumCulled = false;
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 220);
    // With the world, not over the body. Depth test hides grit behind sheet metal.
    this.points.renderOrder = 2;
    // Phone: hide the Points draw entirely. Even a "tiny" budget still filled
    // the mobile chase with opaque sand sprites.
    this.points.visible = !phone;
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
    /** Chassis shells particles must not enter (player + two near rivals). */
    this._bodies = [
      { x: 0, y: 0, z: 0, fx: 0, fz: 1, rx: 1, rz: 0 },
      { x: 0, y: 0, z: 0, fx: 0, fz: 1, rx: 1, rz: 0 },
      { x: 0, y: 0, z: 0, fx: 0, fz: 1, rx: 1, rz: 0 },
    ];
    this._bodyN = 0;
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
    // Re-check every emit — constructor can race before phone class arms.
    if (!this._phone) {
      try {
        if (isPhonePlay()) this._phone = true;
      } catch {
        /* ignore */
      }
    }
    if (this._phone) {
      if (this.points) this.points.visible = false;
      if (this.mat && this.mat.uniforms && this.mat.uniforms.uAlpha) {
        this.mat.uniforms.uAlpha.value = 0;
      }
      return;
    }
    if (!vehicle || !vehicle.position) return;
    this._pushBody(vehicle);
    if (vehicle.onGround === false) return;
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

    const focus = vehicle.ai ? 0.28 : this.cockpit ? 0.55 : 0.72;
    const envBoost = this._phone
      ? 0.45 + this._dustStrength * 0.28
      : 0.62 + this._dustStrength * 0.22;
    const wakeOn = !this._phone && VISUAL.rearDirtWake !== false;

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
    const liftCap = this.cockpit ? 0.35 : 0.72;
    // Suspension unload kicks grit up — compress rebound on soft roads.
    const unload =
      vehicle._wheelVel && Array.isArray(vehicle._wheelVel)
        ? Math.max(0, -Math.min(...vehicle._wheelVel) * 0.55)
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
      const axleMul = rear ? 1.0 : 0.48;
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
      const outside = slideSign !== 0 && sideSign === slideSign ? 1.35 : 0.95;
      const perSec =
        profile.rate *
        work *
        axleMul *
        Math.max(0.85, surf.dust || 1) *
        focus *
        envBoost *
        outside *
        (this.cockpit ? 0.7 : 1);
      bag[wi] += perSec * dt;
      const cap = vehicle.ai ? 1 : this.cockpit ? 2 : 3;
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

    // Outboard of the sidewall and just aft of the contact — not up into the trunk.
    const out = sideSign * (0.2 + Math.random() * 0.14);
    const jitter = (Math.random() - 0.5) * 0.05;
    const aft = rear ? 0.06 + Math.random() * 0.12 : 0.02 + Math.random() * 0.06;
    this.pos[i * 3] = px + rx * (jitter + out) - fx * aft;
    this.pos[i * 3 + 1] = groundY + 0.04 + Math.random() * 0.06;
    this.pos[i * 3 + 2] = pz + rz * (jitter + out) - fz * aft;
    this.gnd[i] = groundY;

    const kick =
      profile.kick *
      (0.4 + speedK * 0.45 + throtK * 0.5 + slipK * 0.95 + spinK * 0.65) *
      (plume ? 0.9 : 1) *
      (rear ? 1 : 0.82);
    const spread = profile.spread * (0.55 + Math.random() * 0.6);
    const liftBase =
      profile.lift * (0.65 + Math.random() * 0.6) + unload * (0.75 + Math.random() * 0.55);
    let lift = grit ? liftBase * 0.62 : plume ? liftBase * 1.05 : liftBase;
    if (lift > liftCap) lift = liftCap;

    // Inherit chassis velocity so spray trails the car, then falls under gravity.
    const inherit = plume ? 0.68 : grit ? 0.32 : 0.5;
    const fanLat = (Math.random() - 0.5) * spread;
    const fanRear = kick * (0.55 + Math.random() * 0.55);
    const tangent = tread * (0.14 + throtK * 0.14 + spinK * 0.22);
    const slideLat = sideSign * (0.35 + slipK * 1.55);
    this.vel[i * 3] =
      vx * inherit +
      oppX * fanRear +
      -fx * tangent +
      rx * fanLat +
      rx * slideLat +
      this._wind.x * (0.2 + Math.random() * 0.28);
    this.vel[i * 3 + 1] = lift + vy * 0.12 + (Math.random() - 0.5) * 0.06;
    this.vel[i * 3 + 2] =
      vz * inherit +
      oppZ * fanRear +
      -fz * tangent +
      rz * fanLat +
      rz * slideLat +
      this._wind.z * (0.2 + Math.random() * 0.28);

    const life =
      lerp(profile.life[0], profile.life[1], Math.random()) *
      (grit ? 0.7 : plume ? 1.12 : speck ? 0.75 : 0.92) *
      (this._phone ? 0.38 : 1);
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
    if (this._phone) sz *= 0.28;
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
    if (!this.alive && !this._emitDirty) {
      this._bodyN = 0;
      return;
    }
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
      // Light vertical drag — prior 0.75/s crushed arcs into the deck.
      this.vel[i * 3 + 1] *= Math.exp(-0.42 * dt);
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this._deflectBodies(i);
      this.angle[i] += this.spin[i] * dt;

      let floor = this.gnd[i];
      const py = this.pos[i * 3 + 1];
      if (
        qTrack &&
        typeof qTrack.query === "function" &&
        this.vel[i * 3 + 1] < 0 &&
        py < floor + 1.6 &&
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

      if (py <= floor + 0.03) {
        if (this.stick[i] || this.bouncesLeft[i] <= 0 || Math.abs(this.vel[i * 3 + 1]) < 0.55) {
          // Soft skitter: grit slides a beat then dies instead of vanishing on contact.
          if (!this.stick[i] && this.life[i] > 0.12 && Math.hypot(this.vel[i * 3], this.vel[i * 3 + 2]) > 1.2) {
            this.pos[i * 3 + 1] = floor + 0.04;
            this.vel[i * 3 + 1] = 0;
            this.vel[i * 3] *= 0.72;
            this.vel[i * 3 + 2] *= 0.72;
            this.life[i] *= 0.82;
            this.bouncesLeft[i] = 0;
          } else {
            this.life[i] = 0;
            this.fade[i] = 0;
            this.pos[i * 3 + 1] = -40;
            continue;
          }
        } else {
          this.pos[i * 3 + 1] = floor + 0.04;
          this.vel[i * 3 + 1] *= -this.bounce[i];
          this.vel[i * 3] *= 0.58;
          this.vel[i * 3 + 2] *= 0.58;
          this.bouncesLeft[i] -= 1;
          this.life[i] *= 0.78;
        }
      }
      if (t <= 0 || py < -8) {
        this.life[i] = 0;
        this.fade[i] = 0;
        this.pos[i * 3 + 1] = -40;
        continue;
      }
      if (this.cockpit && py > floor + 1.15) {
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
    this._bodyN = 0;
  }

  /**
   * Remember a chassis so grit cannot rise through the trunk or cabin.
   * Origin is the contact patch. The box is the body, not the tires.
   * @param {{position:{x:number,y:number,z:number}, yaw:number}} vehicle
   */
  _pushBody(vehicle) {
    if (this._bodyN >= this._bodies.length) return;
    const yaw = vehicle.yaw || 0;
    const b = this._bodies[this._bodyN];
    this._bodyN += 1;
    b.x = vehicle.position.x;
    b.y = vehicle.position.y;
    b.z = vehicle.position.z;
    b.fx = Math.sin(yaw);
    b.fz = Math.cos(yaw);
    b.rx = b.fz;
    b.rz = -b.fx;
  }

  /**
   * Body shell is solid. Dust that enters it is dropped to the contact
   * plane and shoved outboard and aft so it stays in the tire wake.
   * @param {number} i particle index
   */
  _deflectBodies(i) {
    const n = this._bodyN;
    if (n < 1) return;
    const o = i * 3;
    let x = this.pos[o];
    let y = this.pos[o + 1];
    let z = this.pos[o + 2];
    for (let b = 0; b < n; b++) {
      const body = this._bodies[b];
      const dx = x - body.x;
      const dz = z - body.z;
      const along = dx * body.fx + dz * body.fz;
      const lat = dx * body.rx + dz * body.rz;
      const ly = y - body.y;
      if (ly < 0.16 || ly > 1.38) continue;
      if (along > 1.72 || along < -2.05) continue;
      if (Math.abs(lat) > 0.86) continue;
      const side = lat >= 0 ? 1 : -1;
      x += -body.fx * 0.16 + body.rx * side * 0.2;
      z += -body.fz * 0.16 + body.rz * side * 0.2;
      y = body.y + 0.08;
      if (this.vel[o + 1] > 0) this.vel[o + 1] = 0;
      const into = this.vel[o] * body.fx + this.vel[o + 2] * body.fz;
      if (into > 0) {
        this.vel[o] -= body.fx * into;
        this.vel[o + 2] -= body.fz * into;
      }
    }
    this.pos[o] = x;
    this.pos[o + 1] = y;
    this.pos[o + 2] = z;
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
varying vec2 vWorldXZ;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const MARK_FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
varying vec2 vWorldXZ;
void main() {
  if (vAlpha < 0.016) discard;
  // Cheap grit so trails read as compressed earth / rubber, not flat paint.
  float grit = fract(sin(dot(vWorldXZ * 0.85, vec2(12.9898, 78.233))) * 43758.5453);
  float a = vAlpha * (0.9 + grit * 0.18);
  if (a < 0.016) discard;
  vec3 c = vColor * (0.9 + grit * 0.18);
  gl_FragColor = vec4(c, a);
}
`;

/**
 * Soft-road trail life / width / tone. Dual-layer write uses center + lip colors.
 * Hard surfaces only scrub when the tire works (lock / slide / scrub).
 */
const MARK_PROFILE = {
  tarmac: {
    type: "hard",
    life: 14.0,
    width: 0.2,
    alpha: 0.52,
    dark: 0.1,
    slip: 0.18,
    steer: 0.16,
    speed: 9,
    center: 0x0a0a0a,
    lip: 0x1a1816,
  },
  cobble: {
    type: "hard",
    life: 11.0,
    width: 0.19,
    alpha: 0.4,
    dark: 0.16,
    slip: 0.2,
    steer: 0.18,
    speed: 8.5,
    center: 0x12100e,
    lip: 0x221e1a,
  },
  gravel: {
    type: "soft",
    life: 36.0,
    width: 0.36,
    alpha: 0.48,
    dark: 0.42,
    slip: 0.04,
    steer: 0.04,
    speed: 1.6,
    center: 0x1c1a16,
    lip: 0x3a3630,
  },
  dirt: {
    type: "soft",
    life: 42.0,
    width: 0.4,
    alpha: 0.5,
    dark: 0.4,
    slip: 0.025,
    steer: 0.035,
    speed: 0.55,
    center: 0x18140f,
    lip: 0x3a2c20,
  },
  grass: {
    type: "soft",
    life: 16.0,
    width: 0.3,
    alpha: 0.36,
    dark: 0.55,
    slip: 0.035,
    steer: 0.05,
    speed: 1.1,
    center: 0x1a2014,
    lip: 0x2e3824,
  },
  sand: {
    type: "soft",
    life: 56.0,
    width: 0.5,
    alpha: 0.54,
    dark: 0.4,
    slip: 0.01,
    steer: 0.022,
    speed: 0.35,
    center: 0x322418,
    lip: 0x7a6048,
  },
  mud: {
    type: "soft",
    life: 55.0,
    width: 0.5,
    alpha: 0.58,
    dark: 0.28,
    slip: 0.008,
    steer: 0.02,
    speed: 0.35,
    center: 0x100e0a,
    lip: 0x2a2218,
  },
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
    this.count = 20000;
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
        (slip > profile.slip ||
          drift > 0.12 ||
          (steer > profile.steer && slip > profile.slip * 0.55) ||
          brake > 0.55 ||
          vehicle.drifting);
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

    // Denser player soft stamps so twin trenches read as continuous tracks.
    const stride = soft ? (vehicle.ai ? 0.22 : 0.09) : 0.22;
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
      (profile.type === "soft" ? 0.92 : 0.55) *
      (rear ? 1.14 : 1.0);

    if (profile.type === "soft" && track && track.wheelDeform) {
      const surface = a.surface || b.surface || "dirt";
      const pressure = rollOnly ? 0.95 : 1.35;
      const digLoad = {
        throttle: (load && load.throttle) || 0,
        brake: (load && load.brake) || 0,
        dig: ((load && load.dig) || 0) * (rear ? 1.2 : 0.88) * (rollOnly ? 0.72 : 1),
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
      // Sit the decal in the live trench so it does not float above the dig.
      let ay = a.y;
      let by = b.y;
      if (track.wheelDeform) {
        ay += Math.min(0, track.wheelDeform.sample(a.x, a.z) * 0.55);
        by += Math.min(0, track.wheelDeform.sample(b.x, b.z) * 0.55);
      }
      const digAmt = digLoad.dig;
      const width =
        profile.width *
        (1 + Math.min(0.55, slip * 0.32 + drift * 0.26 + digAmt * 0.2)) *
        (rear ? 1.12 : 1.0);
      const alpha =
        profile.alpha *
        Math.min(1, 0.62 + speed / 26 + slip * 1.35 + drift * 0.95 + digAmt * 0.4) *
        (rollOnly ? 0.82 : 1);
      const life = profile.life * (1 + Math.min(0.35, digAmt * 0.25 + slip * 0.15));
      const centerHex = profile.center != null ? profile.center : 0x1e1812;
      const lipHex = profile.lip != null ? profile.lip : 0x4a3c2e;
      // Outer dusty lip, then compressed center — reads as a real tire trench.
      this._writeQuad(
        a.x,
        ay,
        a.z,
        b.x,
        by,
        b.z,
        nx,
        nz,
        width * 1.12,
        lipHex,
        profile.dark * 1.05,
        alpha * 0.38,
        life
      );
      this._writeQuad(
        a.x,
        ay - 0.002,
        a.z,
        b.x,
        by - 0.002,
        b.z,
        nx,
        nz,
        width * 0.68,
        centerHex,
        profile.dark * 0.82,
        alpha,
        life
      );
      return;
    }

    // Hard scrub: rubber smear widens with lock / yaw.
    const scrub = Math.min(1, slip * 1.8 + drift * 1.2 + (load && load.brake ? load.brake * 0.55 : 0));
    const width =
      profile.width * (1 + Math.min(0.55, scrub * 0.45 + slip * 0.22)) * (rear ? 1.08 : 0.98);
    const alpha =
      profile.alpha *
      Math.min(1, 0.4 + speed / 24 + slip * 1.65 + drift * 1.05) *
      (rollOnly ? 0.55 : 1);
    const life = profile.life * (1 + scrub * 0.35);
    const centerHex = profile.center != null ? profile.center : 0x111111;
    const lipHex = profile.lip != null ? profile.lip : 0x1a1816;
    this._writeQuad(a.x, a.y, a.z, b.x, b.y, b.z, nx, nz, width * 1.08, lipHex, profile.dark * 1.1, alpha * 0.32, life);
    this._writeQuad(a.x, a.y - 0.001, a.z, b.x, b.y - 0.001, b.z, nx, nz, width * 0.62, centerHex, profile.dark, alpha, life);
  }

  _writeQuad(ax0, ay0, az0, bx0, by0, bz0, nx, nz, halfWidth, hex, shade, alpha, lifeOverride) {
    const i = this.i % this.count;
    this.i += 1;
    const base = i * 18;
    this._color.setHex(hex);
    // Along-track irregularity so continuous trails do not look printed.
    const jitter = 0.92 + ((Math.abs(ax0 * 12.9898 + az0 * 78.233) % 1) * 0.16);
    const r = this._color.r * shade * jitter;
    const g = this._color.g * shade * jitter;
    const bl = this._color.b * shade * jitter;
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
   * Ease-out: tracks stay readable, then dissolve — not a linear wipe.
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
      const t = Math.max(0, this.life[i] / (this.maxLife[i] || 1));
      // Hold opacity longer, then fall off (t^0.55).
      const hold = Math.pow(t, 0.55);
      const a = hold * this.baseAlpha[i];
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
