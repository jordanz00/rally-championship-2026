/**
 * Attract reel — music-video title coverage, not a spinning pad car.
 *
 * WHO THIS IS FOR: title + SELECT MODE.
 * WHAT IT DOES: builds a lightweight closed rally ribbon (no Track.create),
 *   drives a pack along it, and cuts a director between bumper / whip /
 *   head-on / jump / dutch shots with flash frames. Cars are rival LODs.
 * HOW IT CONNECTS: RallyGame starts this after title IBL; CSS overlays live
 *   in index.html (#attract-fx). Does not own physics or Track.query.
 */

import * as THREE from "../../vendor/three.module.js";
import { armSurfaceNoise } from "../gfx/surface-noise.js?v=2";

const ROAD_HALF = 7.4;
const SAMPLE_STEP = 2.2;
const SHOT_HOLD = {
  bumper: 2.05,
  moto: 1.85,
  whip: 1.55,
  heli: 2.35,
  headon: 1.7,
  lowside: 1.9,
  jump: 2.15,
  dutch: 1.45,
  crane: 2.25,
  smash: 1.25,
};

const SHOT_LABEL = {
  bumper: "BUMPER CAM",
  moto: "CHASE CAM",
  whip: "WHIP PAN",
  heli: "HELICOPTER",
  headon: "HEAD-ON",
  lowside: "WHEEL CAM",
  jump: "CREST",
  dutch: "DUTCH",
  crane: "CRANE",
  smash: "SMASH CUT",
};

const CYCLE = ["heli", "whip", "bumper", "headon", "lowside", "jump", "dutch", "crane", "smash", "moto"];

/** Closed desert-rally knots — long flyby, crest, sweeper, hairpin. */
const KNOTS = [
  [0, 0.04, 0],
  [48, 0.06, 92],
  [110, 0.1, 188],
  [96, 0.35, 286],
  [42, 2.4, 348],
  [8, 5.6, 392],
  [-36, 1.15, 438],
  [-108, 0.12, 456],
  [-168, 0.06, 390],
  [-186, 0.04, 278],
  [-142, 0.08, 168],
  [-58, 0.05, 72],
];

/**
 * @param {boolean} phone
 * @returns {THREE.CatmullRomCurve3}
 */
function makeCurve(phone) {
  const pts = KNOTS.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(pts, true, "catmullrom", phone ? 0.2 : 0.3);
  return curve;
}

/**
 * @param {THREE.CatmullRomCurve3} curve
 * @returns {Array<{x:number,y:number,z:number,yaw:number,nx:number,nz:number,dist:number,jump:boolean}>}
 */
function sampleLine(curve) {
  const len = curve.getLength();
  const n = Math.max(80, Math.round(len / SAMPLE_STEP));
  const out = [];
  const p = new THREE.Vector3();
  const tng = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const u = i / n;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, tng);
    const yaw = Math.atan2(tng.x, tng.z);
    const nx = -tng.z;
    const nz = tng.x;
    const nl = Math.hypot(nx, nz) || 1;
    out.push({
      x: p.x,
      y: p.y,
      z: p.z,
      yaw,
      nx: nx / nl,
      nz: nz / nl,
      dist: u * len,
      jump: p.y > 2.2,
    });
  }
  return out;
}

/**
 * @param {Array<{x:number,y:number,z:number,nx:number,nz:number}>} line
 * @param {THREE.Texture|null} map
 * @returns {THREE.Mesh}
 */
function buildRibbon(line, map) {
  const n = line.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n; i++) {
    const s = line[i];
    const a = i * 2;
    pos[a * 3] = s.x - s.nx * ROAD_HALF;
    pos[a * 3 + 1] = s.y;
    pos[a * 3 + 2] = s.z - s.nz * ROAD_HALF;
    pos[(a + 1) * 3] = s.x + s.nx * ROAD_HALF;
    pos[(a + 1) * 3 + 1] = s.y;
    pos[(a + 1) * 3 + 2] = s.z + s.nz * ROAD_HALF;
    const v = s.dist * 0.16;
    uv[a * 2] = 0;
    uv[a * 2 + 1] = v;
    uv[(a + 1) * 2] = 1;
    uv[(a + 1) * 2 + 1] = v;
    if (i < n - 1) {
      const o = i * 6;
      idx[o] = a;
      idx[o + 1] = a + 1;
      idx[o + 2] = a + 2;
      idx[o + 3] = a + 1;
      idx[o + 4] = a + 3;
      idx[o + 5] = a + 2;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: map ? 0x8a6a40 : 0x6e5330,
    map: map || null,
    roughness: 0.88,
    metalness: 0.04,
    envMapIntensity: 0.42,
  });
  armSurfaceNoise(mat, 0.26);
  if (map) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(1.6, 18);
    map.anisotropy = 16;
    map.colorSpace = THREE.SRGBColorSpace;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "attract-ribbon";
  return mesh;
}

/**
 * @param {boolean} phone
 * @param {THREE.Texture|null} map
 * @returns {THREE.Mesh}
 */
function buildLand(phone, map) {
  const segs = phone ? 18 : 28;
  const geo = new THREE.PlaneGeometry(720, 720, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const dune =
      Math.sin(x * 0.018) * 0.22 +
      Math.cos(z * 0.014) * 0.16 +
      Math.sin(x * 0.041 + z * 0.03) * 0.08;
    pos.setY(i, -1.85 + dune);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: map ? 0xc8b089 : 0xb08958,
    map: map || null,
    roughness: 0.94,
    metalness: 0.02,
    envMapIntensity: 0.28,
  });
  armSurfaceNoise(mat, 0.32);
  if (map) {
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(22, 22);
    map.anisotropy = 12;
    map.colorSpace = THREE.SRGBColorSpace;
  }
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "attract-land";
  return mesh;
}

/**
 * Irregular dirt grit — not a white disc.
 * @returns {THREE.CanvasTexture}
 */
function makeGritSprite() {
  const s = 64;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const g = c.getContext("2d");
  const img = g.createImageData(s, s);
  const d = img.data;
  const cx = 32;
  const cy = 32;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x - cx) / 22;
      const dy = (y - cy) / 22;
      const r2 = dx * dx * 1.15 + dy * dy;
      let a = Math.max(0, 1 - r2);
      a *= 0.55 + ((x * 13 + y * 29) % 17) * 0.02;
      if (((x * 11 + y * 7) % 23) > 20 && r2 > 0.12) a *= 0.12;
      const i = (y * s + x) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = Math.min(255, a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const DUST_VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vLife;
void main() {
  vColor = aColor;
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dist = max(1.0, -mv.z);
  gl_PointSize = min(aSize * uScale / dist, 5.5);
  gl_Position = projectionMatrix * mv;
}
`;

const DUST_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vLife;
void main() {
  float mask = texture2D(uMap, gl_PointCoord).a;
  float fade = smoothstep(0.0, 0.12, vLife) * smoothstep(0.0, 0.22, 1.0 - vLife);
  float a = mask * fade;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

const MARK_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
varying vec2 vXZ;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  gl_Position.z -= 0.0012 * gl_Position.w;
}
`;

const MARK_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying vec2 vXZ;
void main() {
  if (vAlpha < 0.02) discard;
  float grit = fract(sin(dot(vXZ * 3.4, vec2(12.9898, 78.233))) * 43758.5453);
  gl_FragColor = vec4(vColor * (0.78 + grit * 0.28), vAlpha * (0.7 + grit * 0.3));
}
`;

/**
 * Small dirt roost behind the pack.
 * @returns {THREE.Points}
 */
function buildDust() {
  const n = 280;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const life = new Float32Array(n);
  for (let i = 0; i < n; i++) pos[i * 3 + 1] = -40;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aLife", new THREE.BufferAttribute(life, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: makeGritSprite() },
      uScale: { value: 960 },
    },
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 3;
  pts.name = "attract-dust";
  pts.userData.n = n;
  pts.userData.life = life;
  pts.userData.vel = new Float32Array(n * 3);
  return pts;
}

/**
 * Compressed-earth tire tracks on the ribbon.
 * @returns {THREE.Mesh}
 */
function buildTracks() {
  const count = 720;
  const pos = new Float32Array(count * 6 * 3);
  const col = new Float32Array(count * 6 * 3);
  const alpha = new Float32Array(count * 6);
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = -40;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    vertexShader: MARK_VERT,
    fragmentShader: MARK_FRAG,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -10,
    polygonOffsetUnits: -10,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = "attract-tracks";
  mesh.userData.count = count;
  return mesh;
}

/**
 * @param {THREE.TextureLoader} loader
 * @param {string} url
 * @returns {Promise<THREE.Texture|null>}
 */
function loadMap(loader, url) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.anisotropy = 16;
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

/**
 * Music-video director for the attract pack.
 */
export class AttractDirector {
  constructor(opts) {
    this.reduced = !!(opts && opts.reducedMotion);
    this.kind = "heli";
    this.shotT = 0;
    this.hold = SHOT_HOLD.heli;
    this.fade = 0;
    this.flash = 0;
    this.phase = "in";
    this.phaseT = 0;
    this.dutch = 0;
    this.fov = 46;
    this.eye = new THREE.Vector3(0, 8, 12);
    this.look = new THREE.Vector3(0, 1, 0);
    this._te = new THREE.Vector3();
    this._tl = new THREE.Vector3();
    this._tfov = 46;
    this._tdutch = 0;
  }

  /** @returns {string} */
  label() {
    return SHOT_LABEL[this.kind] || "WORLD FEED";
  }

  /**
   * @param {object} pose
   */
  snap(pose) {
    this._compose(this.kind, pose);
    this.eye.copy(this._te);
    this.look.copy(this._tl);
    this.fov = this._tfov;
    this.dutch = this._tdutch;
    this.fade = this.phase === "in" ? 1 : 0;
  }

  /**
   * @param {number} dt
   * @param {object} pose
   * @param {object} [pack]
   */
  update(dt, pose, pack) {
    if (!pose) return this._out();
    this.shotT += dt;
    this.flash = Math.max(0, this.flash - dt * 3.4);
    this._compose(this.kind, pose, pack);
    if (this.phase === "hold" && (this.shotT >= this.hold || this._mustCut(pose))) {
      this._cut(pose);
    }
    this._phase(dt, pose);
    this._follow(dt);
    return this._out();
  }

  _out() {
    return {
      fade: this.fade,
      flash: this.flash,
      kind: this.kind,
      label: this.label(),
      dutch: this.dutch,
      fov: this.fov,
    };
  }

  _mustCut(pose) {
    if (this.kind === "headon" && pose.speed > 28 && this.shotT > 0.85) return true;
    if (this.kind === "smash" && this.shotT > 1.05) return true;
    return false;
  }

  _cut() {
    const i = CYCLE.indexOf(this.kind);
    this.kind = CYCLE[(i + 1) % CYCLE.length];
    this.shotT = 0;
    this.hold = (SHOT_HOLD[this.kind] || 1.8) * (this.reduced ? 1.55 : 0.86 + Math.random() * 0.28);
    this.phase = this.reduced ? "blend" : "out";
    this.phaseT = 0;
    if (!this.reduced) this.flash = this.kind === "smash" || this.kind === "whip" ? 1 : 0.55;
  }

  _phase(dt, pose) {
    this.phaseT += dt;
    if (this.phase === "out") {
      const u = Math.min(1, this.phaseT / 0.12);
      this.fade = u * u * (3 - 2 * u);
      if (u >= 1) {
        this.snap(pose);
        this.phase = "in";
        this.phaseT = 0;
      }
    } else if (this.phase === "in") {
      const u = Math.min(1, this.phaseT / 0.2);
      this.fade = 1 - u * u * (3 - 2 * u);
      if (u >= 1) {
        this.phase = "hold";
        this.fade = 0;
      }
    } else {
      this.fade = 0;
      if (this.phase === "blend" && this.phaseT > 0.35) this.phase = "hold";
    }
  }

  _follow(dt) {
    const k = 1 - Math.exp(-dt * (this.kind === "whip" || this.kind === "smash" ? 14 : 7.5));
    this.eye.lerp(this._te, k);
    this.look.lerp(this._tl, k);
    this.fov += (this._tfov - this.fov) * k;
    this.dutch += (this._tdutch - this.dutch) * k;
  }

  /**
   * @param {string} kind
   * @param {object} pose
   * @param {object} [pack]
   */
  _compose(kind, pose, pack) {
    const fx = Math.sin(pose.yaw);
    const fz = Math.cos(pose.yaw);
    const nx = pose.nx;
    const nz = pose.nz;
    const deck = pose.y;
    const lookY = deck + 0.82;
    this._tdutch = 0;
    if (kind === "bumper") {
      this._te.set(pose.x - fx * 5.4 + nx * 0.35, deck + 1.12, pose.z - fz * 5.4 + nz * 0.35);
      this._tl.set(pose.x + fx * 10, lookY + 0.15, pose.z + fz * 10);
      this._tfov = 58;
    } else if (kind === "moto") {
      this._te.set(pose.x - fx * 8.4 + nx * 1.1, deck + 1.7, pose.z - fz * 8.4 + nz * 1.1);
      this._tl.set(pose.x + fx * 9, lookY, pose.z + fz * 9);
      this._tfov = 50;
    } else if (kind === "whip") {
      const side = pose.t % 8 < 4 ? 1 : -1;
      this._te.set(pose.x + nx * 7.2 * side - fx * 2.2, deck + 0.95, pose.z + nz * 7.2 * side - fz * 2.2);
      this._tl.set(pose.x + fx * 4, lookY, pose.z + fz * 4);
      this._tfov = 42;
    } else if (kind === "heli") {
      this._te.set(pose.x - fx * 13 + nx * 6.4, deck + 8.4, pose.z - fz * 13 + nz * 6.4);
      this._tl.set(pose.x + fx * 6, lookY, pose.z + fz * 6);
      this._tfov = 40;
    } else if (kind === "headon") {
      this._te.set(pose.x + fx * 18, deck + 1.35, pose.z + fz * 18);
      this._tl.set(pose.x, lookY, pose.z);
      this._tfov = 36;
    } else if (kind === "lowside") {
      this._te.set(pose.x + nx * 4.6 - fx * 3.2, deck + 0.38, pose.z + nz * 4.6 - fz * 3.2);
      this._tl.set(pose.x + fx * 3, lookY - 0.15, pose.z + fz * 3);
      this._tfov = 46;
    } else if (kind === "jump") {
      this._te.set(pose.x - fx * 9 + nx * 3.4, deck + 3.8, pose.z - fz * 9 + nz * 3.4);
      this._tl.set(pose.x + fx * 5, lookY + 1.2, pose.z + fz * 5);
      this._tfov = 44;
    } else if (kind === "dutch") {
      const mate = pack && pack.second ? pack.second : pose;
      this._te.set(mate.x - fx * 7 + nx * 4.8, deck + 1.55, mate.z - fz * 7 + nz * 4.8);
      this._tl.set(pose.x + fx * 2, lookY, pose.z + fz * 2);
      this._tfov = 48;
      this._tdutch = 0.18;
    } else if (kind === "crane") {
      this._te.set(pose.x - fx * 6 + nx * 2, deck + 2.2 + Math.min(9, this.shotT * 4.2), pose.z - fz * 6 + nz * 2);
      this._tl.set(pose.x + fx * 8, lookY, pose.z + fz * 8);
      this._tfov = 38;
    } else {
      this._te.set(pose.x + nx * 3.1 - fx * 1.4, deck + 0.72, pose.z + nz * 3.1 - fz * 1.4);
      this._tl.set(pose.x, lookY + 0.2, pose.z);
      this._tfov = 62;
    }
  }
}

/**
 * Lightweight attract stage + pack + director.
 */
export class AttractReel {
  /**
   * @param {{phone?:boolean, reducedMotion?:boolean}} [opts]
   */
  constructor(opts) {
    this.phone = !!(opts && opts.phone);
    this.reduced = !!(opts && opts.reducedMotion);
    this.group = new THREE.Group();
    this.group.name = "attract-reel";
    this.line = [];
    this.length = 1;
    this.cars = [];
    this.director = new AttractDirector({ reducedMotion: this.reduced });
    this.t = 0;
    this.ready = false;
    this.lead = {
      x: 0,
      y: 0.2,
      z: 0,
      yaw: 0,
      nx: 1,
      nz: 0,
      speed: 42,
      t: 0,
      jump: false,
    };
    this.second = null;
    this._dust = null;
    this._tracks = null;
    this._dustI = 0;
    this._trackI = 0;
    this._lastMark = [];
    this._spin = [];
  }

  /**
   * Build ribbon + land. Cheap enough for the title thread.
   * @param {THREE.Scene} scene
   * @returns {Promise<void>}
   */
  async mount(scene) {
    if (this.ready) return;
    const curve = makeCurve(this.phone);
    this.line = sampleLine(curve);
    this.length = Math.max(1, this.line[this.line.length - 1].dist);
    const loader = new THREE.TextureLoader();
    const [dirt, sand] = await Promise.all([
      loadMap(loader, "assets/env/desert/dirt_diff_1k.jpg?v=2"),
      loadMap(loader, "assets/env/desert/sand_diff_1k.jpg?v=2"),
    ]);
    this.group.add(buildRibbon(this.line, dirt));
    this.group.add(buildLand(this.phone, sand));
    if (!this.phone) {
      this._dust = buildDust();
      this._tracks = buildTracks();
      this.group.add(this._dust);
      this.group.add(this._tracks);
    }
    scene.add(this.group);
    this.ready = true;
    this.director.snap(this.lead);
  }

  /**
   * @param {THREE.Object3D[]} meshes
   */
  bindCars(meshes) {
    this.cars = [];
    this._spin = [];
    const list = (meshes || []).filter(Boolean);
    for (let i = 0; i < list.length; i++) {
      const mesh = list[i];
      mesh.visible = true;
      mesh.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = !this.phone;
          o.receiveShadow = false;
        }
      });
      this.group.add(mesh);
      this.cars.push(mesh);
      this._spin.push([0, 0, 0, 0]);
    }
  }

  /**
   * @param {number} dist
   * @param {object} [out]
   */
  sample(dist, out) {
    const dest = out || {};
    const line = this.line;
    if (!line.length) return dest;
    const d = ((dist % this.length) + this.length) % this.length;
    let i = 0;
    while (i < line.length - 1 && line[i + 1].dist < d) i++;
    const a = line[i];
    const b = line[Math.min(i + 1, line.length - 1)];
    const span = Math.max(0.001, b.dist - a.dist);
    const u = (d - a.dist) / span;
    dest.x = a.x + (b.x - a.x) * u;
    dest.y = a.y + (b.y - a.y) * u;
    dest.z = a.z + (b.z - a.z) * u;
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    dest.yaw = a.yaw + dy * u;
    dest.nx = a.nx + (b.nx - a.nx) * u;
    dest.nz = a.nz + (b.nz - a.nz) * u;
    dest.jump = !!(a.jump || b.jump);
    dest.dist = d;
    return dest;
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {{applyWheelPose?:Function, setBrakeLights?:Function, setHeadlights?:Function, chassisDeckEmbed?:Function}} hooks
   */
  update(dt, camera, hooks) {
    if (!this.ready) return this.director._out();
    this.t += dt;
    const n = Math.max(1, this.cars.length);
    const pace = this.phone ? 34 : 44;
    let second = null;
    for (let i = 0; i < n; i++) {
      const gap = i * (this.phone ? 10 : 8);
      const dist = this.t * (pace - i * 1.6) - gap;
      const pose = this.sample(dist, i === 0 ? this.lead : {});
      pose.speed = pace - i * 1.6;
      pose.t = this.t;
      if (i === 1) second = pose;
      const mesh = this.cars[i];
      const embed = hooks && hooks.chassisDeckEmbed ? hooks.chassisDeckEmbed(mesh) : 0.08;
      mesh.position.set(pose.x, pose.y + embed + 0.16, pose.z);
      mesh.rotation.set(pose.jump ? -0.14 : 0.02, pose.yaw, pose.jump ? 0 : Math.sin(this.t * 8 + i) * 0.03);
      const yawRate = 0.35 + Math.sin(this.t * 0.7 + i) * 0.2;
      const steer = Math.max(-0.55, Math.min(0.55, yawRate * (i % 2 ? -1 : 1) * 0.35));
      const spin = this._spin[i];
      const inc = (pose.speed / 0.33) * dt;
      if (spin) {
        for (let w = 0; w < 4; w++) spin[w] += inc;
      }
      if (hooks && hooks.applyWheelPose && mesh.userData && mesh.userData.wheels) {
        hooks.applyWheelPose(mesh.userData.wheels, spin, steer);
      }
      if (hooks && hooks.setBrakeLights) hooks.setBrakeLights(mesh, pose.jump ? 0 : Math.abs(steer) > 0.28 ? 0.7 : 0);
      if (hooks && hooks.setHeadlights) hooks.setHeadlights(mesh, false);
    }
    this.second = second;
    this._tickWake(dt);
    const shot = this.director.update(dt, this.lead, { second });
    if (camera) {
      camera.position.copy(this.director.eye);
      camera.up.set(Math.sin(shot.dutch), Math.cos(shot.dutch), 0);
      camera.lookAt(this.director.look);
      if (Math.abs(camera.fov - shot.fov) > 0.08) {
        camera.fov = shot.fov;
        camera.near = 0.18;
        camera.far = 620;
        camera.updateProjectionMatrix();
      }
    }
    return shot;
  }

  _tickWake(dt) {
    this._stepDust(dt);
    this._stampTracks();
  }

  _stepDust(dt) {
    if (!this._dust) return;
    const geo = this._dust.geometry;
    const pos = geo.attributes.position;
    const col = geo.attributes.aColor;
    const size = geo.attributes.aSize;
    const lifeA = geo.attributes.aLife;
    const life = this._dust.userData.life;
    const vel = this._dust.userData.vel;
    const n = this._dust.userData.n;
    const cars = this.cars;
    for (let c = 0; c < cars.length; c++) {
      const car = cars[c];
      if (!car) continue;
      const yaw = car.rotation.y;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const jump = Math.abs(car.rotation.x) > 0.08;
      if (jump) continue;
      const emit = 2;
      for (let k = 0; k < emit; k++) {
        const i = this._dustI % n;
        this._dustI += 1;
        const side = k === 0 ? -0.68 : k === 1 ? 0.68 : (Math.random() - 0.5) * 0.5;
        const aft = 1.15 + Math.random() * 0.35;
        pos.setXYZ(
          i,
          car.position.x - fx * aft + rx * side,
          car.position.y - 0.08 + Math.random() * 0.05,
          car.position.z - fz * aft + rz * side
        );
        const shade = 0.7 + Math.random() * 0.28;
        col.setXYZ(i, 0.4 * shade, 0.26 * shade, 0.12 * shade);
        size.setX(i, 0.014 + Math.random() * 0.014);
        life[i] = 0.55 + Math.random() * 0.35;
        lifeA.setX(i, 1);
        vel[i * 3] = -fx * (1.8 + Math.random() * 2.2) + rx * (Math.random() - 0.5) * 0.7;
        vel[i * 3 + 1] = 0.35 + Math.random() * 0.55;
        vel[i * 3 + 2] = -fz * (1.8 + Math.random() * 2.2) + rz * (Math.random() - 0.5) * 0.7;
      }
    }
    for (let i = 0; i < n; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        pos.setY(i, -40);
        lifeA.setX(i, 0);
        continue;
      }
      pos.setX(i, pos.getX(i) + vel[i * 3] * dt);
      pos.setY(i, pos.getY(i) + vel[i * 3 + 1] * dt);
      pos.setZ(i, pos.getZ(i) + vel[i * 3 + 2] * dt);
      vel[i * 3 + 1] -= 9.2 * dt;
      vel[i * 3] *= 0.96;
      vel[i * 3 + 2] *= 0.96;
      const floor = 0.04;
      if (pos.getY(i) < floor) {
        pos.setY(i, floor);
        vel[i * 3 + 1] *= -0.12;
        vel[i * 3] *= 0.7;
        vel[i * 3 + 2] *= 0.7;
      }
      lifeA.setX(i, Math.max(0, life[i] / 0.75));
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    size.needsUpdate = true;
    lifeA.needsUpdate = true;
  }

  _stampTracks() {
    if (!this._tracks) return;
    const cars = this.cars;
    if (!this._lastMark.length) {
      for (let i = 0; i < cars.length; i++) this._lastMark.push({ x: 0, z: 0, valid: false });
    }
    for (let c = 0; c < cars.length; c++) {
      const car = cars[c];
      if (!car) continue;
      const yaw = car.rotation.y;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const jump = Math.abs(car.rotation.x) > 0.08;
      const ax = car.position.x - fx * 1.15;
      const az = car.position.z - fz * 1.15;
      const ay = car.position.y - 0.22;
      const prev = this._lastMark[c] || (this._lastMark[c] = { x: 0, z: 0, valid: false });
      if (jump) {
        prev.valid = false;
        continue;
      }
      if (!prev.valid) {
        prev.x = ax;
        prev.z = az;
        prev.valid = true;
        continue;
      }
      const dx = ax - prev.x;
      const dz = az - prev.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.14 || len > 2.4) {
        if (len > 2.4) prev.valid = false;
        continue;
      }
      const nx = dz / len;
      const nz = -dx / len;
      for (const side of [-0.7, 0.7]) {
        this._writeTrack(
          prev.x + rx * side,
          ay,
          prev.z + rz * side,
          ax + rx * side,
          ay,
          az + rz * side,
          nx,
          nz,
          0.09
        );
      }
      prev.x = ax;
      prev.z = az;
    }
  }

  /**
   * @param {number} ax
   * @param {number} ay
   * @param {number} az
   * @param {number} bx
   * @param {number} by
   * @param {number} bz
   * @param {number} nx
   * @param {number} nz
   * @param {number} halfW
   */
  _writeTrack(ax, ay, az, bx, by, bz, nx, nz, halfW) {
    const mesh = this._tracks;
    const count = mesh.userData.count;
    const i = this._trackI % count;
    this._trackI += 1;
    const pos = mesh.geometry.attributes.position.array;
    const col = mesh.geometry.attributes.aColor.array;
    const alpha = mesh.geometry.attributes.aAlpha.array;
    const base = i * 18;
    const px0 = ax + nx * halfW;
    const pz0 = az + nz * halfW;
    const px1 = ax - nx * halfW;
    const pz1 = az - nz * halfW;
    const px2 = bx + nx * halfW;
    const pz2 = bz + nz * halfW;
    const px3 = bx - nx * halfW;
    const pz3 = bz - nz * halfW;
    const verts = [px0, ay, pz0, px1, ay, pz1, px2, by, pz2, px2, by, pz2, px1, ay, pz1, px3, by, pz3];
    for (let v = 0; v < 18; v++) pos[base + v] = verts[v];
    const shade = 0.72 + (i % 7) * 0.03;
    for (let v = 0; v < 6; v++) {
      col[base + v * 3] = 0.16 * shade;
      col[base + v * 3 + 1] = 0.1 * shade;
      col[base + v * 3 + 2] = 0.055 * shade;
      alpha[i * 6 + v] = 0.55;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.aColor.needsUpdate = true;
    mesh.geometry.attributes.aAlpha.needsUpdate = true;
  }

  /**
   * @param {THREE.Scene} scene
   */
  dispose(scene) {
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
    else if (scene && this.group) scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = [].concat(o.material);
        for (let i = 0; i < mats.length; i++) {
          if (mats[i] && mats[i].map && mats[i].map.userData && mats[i].map.userData.attractOwn) {
            mats[i].map.dispose();
          }
        }
      }
    });
    this.cars = [];
    this.ready = false;
  }
}

/**
 * Drive the HTML overlays from a director tick.
 * @param {HTMLElement|null} root
 * @param {{fade:number,flash:number,label:string,kind:string}|null} shot
 * @param {boolean} on
 */
export function paintAttractFx(root, shot, on) {
  if (!root) return;
  root.hidden = !on;
  root.setAttribute("aria-hidden", on ? "false" : "true");
  if (!on || !shot) return;
  const fade = root.querySelector(".attract-fade");
  const flash = root.querySelector(".attract-flash");
  const slug = root.querySelector(".attract-shot");
  if (fade) fade.style.opacity = String(Math.max(0, Math.min(1, shot.fade)));
  if (flash) flash.style.opacity = String(Math.max(0, Math.min(1, shot.flash)));
  if (slug && slug.textContent !== shot.label) slug.textContent = shot.label;
  root.dataset.kind = shot.kind || "";
}
