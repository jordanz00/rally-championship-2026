/**
 * Attract reel — music-video + WRC-TV title coverage, not a spinning pad car.
 *
 * WHO THIS IS FOR: title + SELECT MODE.
 * WHAT IT DOES: builds a lightweight closed rally ribbon (no Track.create),
 *   dresses a desert/forest hero stretch from existing kits, drives a pack,
 *   and cuts a director with hard cuts, pack fly-bys, speed ramps, and flash.
 * HOW IT CONNECTS: RallyGame starts this after title IBL; CSS overlays live
 *   in index.html (#attract-fx). Does not own physics or Track.query.
 */

import * as THREE from "../../vendor/three.module.js";
import { GLTFLoader } from "../../vendor/GLTFLoader.js";
import { armSurfaceNoise } from "../gfx/surface-noise.js?v=2";
import { loadTitleRocks, styleTitleRock } from "../tracks/prop-kit.js?v=55";
import {
  ATTRACT_TIRE_PLANT,
  attractChassisY,
  attractChassisYCleared,
  attractDeckLift,
  attractBackdropY,
  attractPlayLaneLandY,
} from "./attract-plant.js?v=2";

const ROAD_HALF = 7.4;
const SAMPLE_STEP = 2.2;
const KIT_V = "23";
const SHOT_HOLD = {
  bumper: 2.35,
  moto: 2.25,
  whip: 2.15,
  heli: 2.7,
  headon: 2.2,
  lowside: 2.25,
  jump: 2.45,
  dutch: 2.2,
  crane: 2.5,
  smash: 2.15,
  nose: 2.2,
  packfly: 2.4,
  rear: 2.3,
  bank: 2.25,
};

const SHOT_LABEL = {
  bumper: "BUMPER · SEND IT",
  moto: "CHASE CAM",
  whip: "WHIP · DO NOT BLINK",
  heli: "HELICOPTER",
  headon: "HEAD-ON · FLINCH",
  lowside: "WHEEL CAM",
  jump: "CREST · AIRTIME",
  dutch: "DUTCH · MUSIC VID",
  crane: "CRANE",
  smash: "HARD CUT",
  nose: "NOSE CAM",
  packfly: "PACK FLY-BY",
  rear: "REAR 3/4",
  bank: "BANKED",
};

const CYCLE = [
  "packfly",
  "whip",
  "bumper",
  "headon",
  "lowside",
  "jump",
  "dutch",
  "nose",
  "crane",
  "smash",
  "heli",
  "rear",
  "bank",
  "moto",
];

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

const FOREST_XZ = { x: 8, z: 392 };

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
 * @param {Array<{x:number,z:number,y:number}>} line
 * @param {number} x
 * @param {number} z
 * @returns {{s:{x:number,y:number,z:number,nx:number,nz:number}, d:number}}
 */
function nearestRibbon(line, x, z) {
  let best = line[0];
  let bestD = Infinity;
  for (let i = 0; i < line.length; i++) {
    const s = line[i];
    const dx = s.x - x;
    const dz = s.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return { s: best, d: Math.sqrt(bestD) };
}

/**
 * @param {THREE.TextureLoader} loader
 * @param {string} url
 * @param {boolean} [linear]
 * @returns {Promise<THREE.Texture|null>}
 */
function loadMap(loader, url, linear) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.anisotropy = 16;
        tex.userData.attractOwn = true;
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

/**
 * @param {THREE.Texture|null} map
 * @param {number} rx
 * @param {number} ry
 */
function tileMap(map, rx, ry) {
  if (!map) return;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(rx, ry);
  map.anisotropy = 16;
}

/**
 * @param {Array<{x:number,y:number,z:number,nx:number,nz:number,dist:number}>} line
 * @param {THREE.Texture|null} map
 * @param {THREE.Texture|null} nrm
 * @returns {THREE.Mesh}
 */
function buildRibbon(line, map, nrm) {
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
    normalMap: nrm || null,
    normalScale: nrm ? new THREE.Vector2(0.9, 0.9) : undefined,
    roughness: 0.86,
    metalness: 0.04,
    envMapIntensity: 0.48,
  });
  armSurfaceNoise(mat, 0.26);
  tileMap(map, 1.6, 18);
  tileMap(nrm, 1.6, 18);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "attract-ribbon";
  mesh.renderOrder = 1;
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -4;
  mat.polygonOffsetUnits = -4;
  mat.depthWrite = true;
  return mesh;
}

/**
 * Gravel verge so the ribbon is not a floating strip.
 * @param {Array<{x:number,y:number,z:number,nx:number,nz:number,dist:number}>} line
 * @param {THREE.Texture|null} map
 * @returns {THREE.Mesh}
 */
function buildShoulder(line, map) {
  const half = ROAD_HALF + 2.8;
  const n = line.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n; i++) {
    const s = line[i];
    const a = i * 2;
    pos[a * 3] = s.x - s.nx * half;
    pos[a * 3 + 1] = s.y - 0.03;
    pos[a * 3 + 2] = s.z - s.nz * half;
    pos[(a + 1) * 3] = s.x + s.nx * half;
    pos[(a + 1) * 3 + 1] = s.y - 0.03;
    pos[(a + 1) * 3 + 2] = s.z + s.nz * half;
    const v = s.dist * 0.12;
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
    color: map ? 0xb89a6e : 0x8a7048,
    map: map || null,
    roughness: 0.92,
    metalness: 0.02,
    envMapIntensity: 0.3,
  });
  armSurfaceNoise(mat, 0.3);
  tileMap(map, 2.2, 14);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "attract-shoulder";
  return mesh;
}

/**
 * Raised dirt banks the camera can skim on whip / bank shots.
 * @param {Array<{x:number,y:number,z:number,nx:number,nz:number,dist:number}>} line
 * @param {THREE.Texture|null} map
 * @returns {THREE.Mesh}
 */
function buildBerms(line, map) {
  const n = line.length;
  const cols = 3;
  const pos = new Float32Array(n * cols * 2 * 3);
  const uv = new Float32Array(n * cols * 2 * 2);
  const idx = [];
  const offs = [ROAD_HALF + 2.6, ROAD_HALF + 4.8, ROAD_HALF + 8.4];
  const lifts = [0.08, 1.05, -0.22];
  for (let side = 0; side < 2; side++) {
    const sgn = side === 0 ? 1 : -1;
    const base = side * n * cols;
    for (let i = 0; i < n; i++) {
      const s = line[i];
      for (let c = 0; c < cols; c++) {
        const a = base + i * cols + c;
        pos[a * 3] = s.x + s.nx * sgn * offs[c];
        pos[a * 3 + 1] = s.y + lifts[c];
        pos[a * 3 + 2] = s.z + s.nz * sgn * offs[c];
        uv[a * 2] = c / (cols - 1);
        uv[a * 2 + 1] = s.dist * 0.1;
      }
      if (i < n - 1) {
        for (let c = 0; c < cols - 1; c++) {
          const a = base + i * cols + c;
          const b = a + cols;
          idx.push(a, a + 1, b, a + 1, b + 1, b);
        }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: map ? 0xc4a06a : 0x9a7848,
    map: map || null,
    roughness: 0.93,
    metalness: 0.02,
    envMapIntensity: 0.28,
  });
  armSurfaceNoise(mat, 0.34);
  tileMap(map, 3.2, 16);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = "attract-berm";
  return mesh;
}

/**
 * @param {boolean} phone
 * @param {THREE.Texture|null} map
 * @param {THREE.Texture|null} nrm
 * @param {Array<{x:number,y:number,z:number,nx:number,nz:number}>} line
 * @returns {THREE.Mesh}
 */
function buildLand(phone, map, nrm, line) {
  const segs = phone ? 18 : 28;
  const geo = new THREE.PlaneGeometry(720, 720, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const dune =
      Math.sin(x * 0.018) * 1.35 +
      Math.cos(z * 0.014) * 1.05 +
      Math.sin(x * 0.041 + z * 0.03) * 0.48;
    const near = nearestRibbon(line, x, z);
    const y = attractBackdropY(near.s.y, near.d, dune);
    pos.setY(i, y);
    const forest = Math.max(0, 1 - Math.hypot(x - FOREST_XZ.x, z - FOREST_XZ.z) / 52);
    col[i * 3] = 0.92 - forest * 0.22;
    col[i * 3 + 1] = 0.82 - forest * 0.04;
    col[i * 3 + 2] = 0.62 + forest * 0.08;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: map ? 0xffffff : 0xb08958,
    map: map || null,
    normalMap: nrm || null,
    normalScale: nrm ? new THREE.Vector2(0.7, 0.7) : undefined,
    roughness: 0.94,
    metalness: 0.02,
    envMapIntensity: 0.3,
    vertexColors: true,
  });
  armSurfaceNoise(mat, 0.32);
  tileMap(map, 22, 22);
  tileMap(nrm, 22, 22);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "attract-land";
  return mesh;
}

/**
 * Forest hero floor on the crest — existing forest_floor, not a grey pad.
 * @param {boolean} phone
 * @param {THREE.Texture|null} map
 * @returns {THREE.Mesh}
 */
function buildForestIsland(phone, map, line) {
  const r = phone ? 26 : 40;
  const geo = new THREE.CircleGeometry(r, phone ? 22 : 36);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = Math.hypot(x, z);
    const wx = FOREST_XZ.x + x;
    const wz = FOREST_XZ.z + z;
    const near = nearestRibbon(line, wx, wz);
    let y = 5.05 - d * 0.042 + Math.sin(x * 0.14) * 0.1;
    if (near.d <= ROAD_HALF + 2.6) {
      y = attractPlayLaneLandY(near.s.y);
    } else {
      y = Math.min(y, near.s.y - 0.18);
    }
    pos.setY(i, y);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: map ? 0x8c9a68 : 0x6a7a48,
    map: map || null,
    roughness: 0.93,
    metalness: 0.02,
    envMapIntensity: 0.32,
  });
  armSurfaceNoise(mat, 0.28);
  tileMap(map, 8, 8);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(FOREST_XZ.x, 0, FOREST_XZ.z);
  mesh.receiveShadow = true;
  mesh.name = "attract-forest-floor";
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
      if ((x * 11 + y * 7) % 23 > 20 && r2 > 0.12) a *= 0.12;
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
 * Seat a kit mesh on land without floating the hull.
 * @param {THREE.Object3D} node
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} yaw
 * @param {number} sx
 * @param {number} sy
 * @param {number} sz
 * @param {number} bury
 */
function seatProp(node, x, y, z, yaw, sx, sy, sz, bury) {
  node.scale.set(sx, sy, sz);
  node.rotation.set(0, yaw, 0, "YXZ");
  node.position.set(x, y, z);
  node.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(node);
  if (Number.isFinite(box.min.y)) {
    const h = Math.max(0.2, box.max.y - box.min.y);
    node.position.y += y - box.min.y - h * (bury == null ? 0.16 : bury);
  }
}

/**
 * Music-video director for the attract pack.
 */
export class AttractDirector {
  constructor(opts) {
    this.reduced = !!(opts && opts.reducedMotion);
    this.kind = "packfly";
    this.shotT = 0;
    this.hold = SHOT_HOLD.packfly;
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
    this.justCut = false;
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
    this.justCut = false;
    this.shotT += dt;
    this.flash = 0;
    this._compose(this.kind, pose, pack);
    if (this.phase === "hold" && (this.shotT >= this.hold || this._mustCut(pose))) {
      this._cut(pose);
    }
    this._phase(dt, pose);
    if (this.justCut || this.phase === "in") this.snap(pose);
    else this._follow(dt);
    return this._out();
  }

  _out() {
    const hot = this.kind === "smash" || this.kind === "whip" || this.kind === "headon" || this.kind === "packfly";
    return {
      fade: Math.min(0.22, this.fade),
      flash: 0,
      kind: this.kind,
      label: this.label(),
      dutch: this.dutch,
      fov: this.fov,
      chroma: this.reduced ? 0.18 : hot ? 0.98 : 0.64,
      smear: this.reduced ? 0 : this.kind === "whip" || this.kind === "smash" ? 0.58 : this.kind === "bumper" || this.kind === "nose" ? 0.3 : 0.07,
      speedFx: this.reduced ? 0 : this.kind === "bumper" || this.kind === "whip" || this.kind === "nose" ? 0.72 : 0.32,
      ramp: this.kind === "jump" ? "slow" : this.kind === "smash" || this.kind === "whip" ? "fast" : "live",
      energy: hot ? "hot" : "live",
      calm: this.reduced,
      justCut: this.justCut,
    };
  }

  _mustCut(pose) {
    if (this.shotT < 2) return false;
    if (this.kind === "headon" && pose.speed > 28 && this.shotT > 2.2) return true;
    if (this.kind === "smash" && this.shotT > 2.15) return true;
    if (!this.reduced && this.kind === "whip" && this.shotT > 2.2) return true;
    if (!this.reduced && pose.jump && this.kind !== "jump" && this.shotT > 2) return true;
    return false;
  }

  _cut(pose) {
    let next;
    if (pose && pose.jump && this.kind !== "jump") next = "jump";
    else {
      const i = CYCLE.indexOf(this.kind);
      next = CYCLE[(i + 1) % CYCLE.length];
    }
    this.kind = next;
    this.shotT = 0;
    this.hold = (SHOT_HOLD[this.kind] || 2.2) * (this.reduced ? 1.35 : 1.85 + Math.random() * 0.35);
    this.phase = this.reduced ? "blend" : "out";
    this.phaseT = 0;
    this.justCut = true;
    this.flash = 0;
  }

  _phase(dt, pose) {
    this.phaseT += dt;
    if (this.phase === "out") {
      const u = Math.min(1, this.phaseT / 0.075);
      this.fade = u * u * (3 - 2 * u);
      if (u >= 1) {
        this.snap(pose);
        this.phase = "in";
        this.phaseT = 0;
      }
    } else if (this.phase === "in") {
      const u = Math.min(1, this.phaseT / 0.14);
      this.fade = 1 - u * u * (3 - 2 * u);
      if (u >= 1) {
        this.phase = "hold";
        this.fade = 0;
      }
    } else {
      this.fade = 0;
      if (this.phase === "blend" && this.phaseT > 0.4) this.phase = "hold";
    }
  }

  _follow(dt) {
    const k = 1 - Math.exp(-dt * (this.kind === "whip" || this.kind === "smash" ? 16 : 8.2));
    this.eye.lerp(this._te, k);
    this.look.lerp(this._tl, k);
    this.fov += (this._tfov - this.fov) * k;
    this.dutch += (this._tdutch - this.dutch) * k;
  }

  /**
   * Keep the pack in frame on fly-bys — look between lead and P2.
   * @param {object} pose
   * @param {object} [pack]
   * @param {number} [bias]
   */
  _aim(pose, pack, bias) {
    const second = pack && pack.second;
    if (!second) return pose;
    const b = bias == null ? 0.38 : bias;
    return {
      x: pose.x * (1 - b) + second.x * b,
      y: pose.y * (1 - b) + second.y * b,
      z: pose.z * (1 - b) + second.z * b,
      yaw: pose.yaw,
      nx: pose.nx,
      nz: pose.nz,
    };
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
      this._te.set(pose.x - fx * 5.1 + nx * 0.35, deck + 1.08, pose.z - fz * 5.1 + nz * 0.35);
      this._tl.set(pose.x + fx * 10, lookY + 0.15, pose.z + fz * 10);
      this._tfov = 62;
    } else if (kind === "moto") {
      this._te.set(pose.x - fx * 8.4 + nx * 1.1, deck + 1.7, pose.z - fz * 8.4 + nz * 1.1);
      this._tl.set(pose.x + fx * 9, lookY, pose.z + fz * 9);
      this._tfov = 50;
    } else if (kind === "whip") {
      const side = pose.t % 8 < 4 ? 1 : -1;
      this._te.set(pose.x + nx * 7.6 * side - fx * 1.6, deck + 0.88, pose.z + nz * 7.6 * side - fz * 1.6);
      this._tl.set(pose.x + fx * 4, lookY, pose.z + fz * 4);
      this._tfov = 40;
    } else if (kind === "heli") {
      const aim = this._aim(pose, pack, 0.42);
      this._te.set(aim.x - fx * 15 + nx * 7.4, deck + 9.4, aim.z - fz * 15 + nz * 7.4);
      this._tl.set(aim.x + fx * 5, lookY, aim.z + fz * 5);
      this._tfov = 38;
    } else if (kind === "headon") {
      this._te.set(pose.x + fx * 16.5, deck + 1.28, pose.z + fz * 16.5);
      this._tl.set(pose.x, lookY, pose.z);
      this._tfov = 34;
    } else if (kind === "lowside") {
      this._te.set(pose.x + nx * 4.4 - fx * 2.8, deck + 0.34, pose.z + nz * 4.4 - fz * 2.8);
      this._tl.set(pose.x + fx * 3, lookY - 0.12, pose.z + fz * 3);
      this._tfov = 48;
    } else if (kind === "jump") {
      this._te.set(pose.x - fx * 8.4 + nx * 3.8, deck + 4.1, pose.z - fz * 8.4 + nz * 3.8);
      this._tl.set(pose.x + fx * 5, lookY + 1.35, pose.z + fz * 5);
      this._tfov = 42;
    } else if (kind === "dutch") {
      const mate = pack && pack.second ? pack.second : pose;
      this._te.set(mate.x - fx * 7 + nx * 5.1, deck + 1.45, mate.z - fz * 7 + nz * 5.1);
      this._tl.set(pose.x + fx * 2, lookY, pose.z + fz * 2);
      this._tfov = 48;
      this._tdutch = this.reduced ? 0.08 : 0.26;
    } else if (kind === "crane") {
      this._te.set(pose.x - fx * 6 + nx * 2, deck + 2.05 + Math.min(9, this.shotT * 5.2), pose.z - fz * 6 + nz * 2);
      this._tl.set(pose.x + fx * 8, lookY, pose.z + fz * 8);
      this._tfov = 36;
    } else if (kind === "nose") {
      this._te.set(pose.x + fx * 1.2 + nx * 0.18, deck + 0.9, pose.z + fz * 1.2 + nz * 0.18);
      this._tl.set(pose.x + fx * 14, lookY + 0.04, pose.z + fz * 14);
      this._tfov = 68;
    } else if (kind === "packfly") {
      const aim = this._aim(pose, pack, 0.45);
      const side = pose.t % 10 < 5 ? 1 : -1;
      this._te.set(aim.x + nx * 13.2 * side - fx * 0.8, deck + 1.48, aim.z + nz * 13.2 * side - fz * 0.8);
      this._tl.set(aim.x + fx * 2.4, lookY + 0.08, aim.z + fz * 2.4);
      this._tfov = 36;
    } else if (kind === "rear") {
      const aim = this._aim(pose, pack, 0.3);
      this._te.set(aim.x - fx * 11.4 + nx * 3.4, deck + 2.35, aim.z - fz * 11.4 + nz * 3.4);
      this._tl.set(aim.x + fx * 6, lookY, aim.z + fz * 6);
      this._tfov = 44;
    } else if (kind === "bank") {
      this._te.set(pose.x + nx * 7.1 - fx * 1.4, deck + 0.5, pose.z + nz * 7.1 - fz * 1.4);
      this._tl.set(pose.x + fx * 5, lookY - 0.04, pose.z + fz * 5);
      this._tfov = 40;
      this._tdutch = this.reduced ? 0.06 : 0.2;
    } else {
      this._te.set(pose.x + nx * 3.1 - fx * 1.4, deck + 0.72, pose.z + nz * 3.1 - fz * 1.4);
      this._tl.set(pose.x, lookY + 0.2, pose.z);
      this._tfov = 66;
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
    this._timeScale = 1;
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
    this._dressed = false;
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
    const [dirt, sand, gravel, forest, dirtN, sandN] = await Promise.all([
      loadMap(loader, "assets/env/desert/dirt_diff_1k.jpg?v=2"),
      loadMap(loader, "assets/env/desert/sand_diff_1k.jpg?v=2"),
      loadMap(loader, "assets/env/desert/gravel_diff_1k.jpg?v=2"),
      loadMap(loader, "assets/env/forest/forest_floor_diff_1k.jpg?v=2"),
      this.phone ? Promise.resolve(null) : loadMap(loader, "assets/env/desert/dirt_nor_gl_1k.jpg?v=2", true),
      this.phone ? Promise.resolve(null) : loadMap(loader, "assets/env/desert/sand_nor_gl_1k.jpg?v=2", true),
    ]);
    this.group.add(buildLand(this.phone, sand, sandN, this.line));
    this.group.add(buildShoulder(this.line, gravel));
    this.group.add(buildBerms(this.line, dirt));
    this.group.add(buildRibbon(this.line, dirt, dirtN));
    this.group.add(buildForestIsland(this.phone, forest, this.line));
    if (!this.phone) {
      this._dust = buildDust();
      this._tracks = buildTracks();
      this.group.add(this._dust);
      this.group.add(this._tracks);
    }
    scene.add(this.group);
    this.ready = true;
    this.director.snap(this.lead);
    void this._dressWorld();
  }

  /**
   * Desert rocks / cactus + a few Forest LOD1 heroes on the crest.
   * Async — first frames already have sculpted land.
   */
  async _dressWorld() {
    if (this._dressed || !this.ready) return;
    this._dressed = true;
    try {
      const rocks = await loadTitleRocks();
      this._plantRocks(rocks);
      if (!this.phone) {
        await this._plantCactus();
        await this._plantForest();
      }
    } catch (err) {
      console.warn("[attract] dress", err);
    }
  }

  /**
   * @param {Record<string, THREE.Object3D>} templates
   */
  _plantRocks(templates) {
    if (!templates) return;
    const kinds = ["rock_largeA", "rock_largeB", "rock_tallA", "rock_smallA"];
    const count = this.phone ? 10 : 22;
    const poses = this._scatterOffRoad(count, null, 5.2, 16);
    const box = new THREE.Box3();
    for (let i = 0; i < poses.length; i++) {
      const kind = kinds[i % kinds.length];
      const src = templates[kind];
      if (!src) continue;
      const node = src.clone(true);
      styleTitleRock(node, i + 11);
      const p = poses[i];
      const fat = kind === "rock_smallA" ? 0.85 : 1.15 + (i % 5) * 0.12;
      seatProp(node, p.x, p.y, p.z, p.yaw, fat * (0.9 + (i % 3) * 0.12), fat * (0.75 + (i % 4) * 0.08), fat, 0.2);
      node.name = `attract-${kind}-${i}`;
      this.group.add(node);
      node.updateMatrixWorld(true);
      box.setFromObject(node);
      if (Number.isFinite(box.min.y) && box.min.y > p.y + 0.04) {
        node.position.y -= box.min.y - p.y + 0.06;
      }
    }
    if (!this.phone) {
      const mesas = [
        { kind: "rock_largeA", x: 86, z: 210, s: 3.4, y: -0.4 },
        { kind: "rock_largeB", x: -154, z: 320, s: 3.8, y: -0.5 },
        { kind: "rock_tallA", x: -40, z: 40, s: 2.8, y: -0.35 },
      ];
      for (let i = 0; i < mesas.length; i++) {
        const m = mesas[i];
        const src = templates[m.kind];
        if (!src) continue;
        const node = src.clone(true);
        styleTitleRock(node, i + 20);
        seatProp(node, m.x, m.y, m.z, i * 0.9, m.s, m.s * 0.72, m.s * 0.9, 0.12);
        node.name = `attract-mesa-${i}`;
        this.group.add(node);
      }
    }
  }

  async _plantCactus() {
    const loader = new GLTFLoader();
    const kinds = ["cactus_tall", "cactus_short"];
    /** @type {Record<string, THREE.Object3D>} */
    const templates = {};
    await Promise.all(
      kinds.map(async (kind) => {
        try {
          const gltf = await loader.loadAsync(`assets/props/${kind}.glb?v=${KIT_V}`);
          const root = (gltf.scene || gltf.scenes[0]).clone(true);
          root.traverse((o) => {
            if (!o.isMesh || !o.material) return;
            const mats = [].concat(o.material);
            for (let i = 0; i < mats.length; i++) {
              const mat = mats[i];
              if (!mat) continue;
              mat.roughness = 0.9;
              mat.metalness = 0.02;
              mat.envMapIntensity = 0.3;
              mat.transparent = false;
              mat.opacity = 1;
              if (mat.color) mat.color.offsetHSL(0.02, 0.08, -0.04);
            }
            o.castShadow = true;
            o.receiveShadow = true;
          });
          templates[kind] = root;
        } catch {
          /* kit optional */
        }
      })
    );
    const poses = this._scatterOffRoad(12, (s) => s.y < 1.15, 6.5, 14);
    for (let i = 0; i < poses.length; i++) {
      const kind = i % 3 === 0 ? "cactus_short" : "cactus_tall";
      const src = templates[kind];
      if (!src) continue;
      const node = src.clone(true);
      const p = poses[i];
      const h = kind === "cactus_tall" ? 1.15 + (i % 4) * 0.08 : 0.95;
      seatProp(node, p.x, p.y, p.z, p.yaw, h * 0.92, h, h * 0.92, 0.08);
      node.name = `attract-${kind}-${i}`;
      this.group.add(node);
    }
  }

  async _plantForest() {
    const loader = new GLTFLoader();
    const files = ["forest_hero_tree_a_lod1.glb", "forest_hero_tree_d_lod1.glb", "forest_hero_tree_e_lod1.glb"];
    /** @type {THREE.Object3D[]} */
    const templates = [];
    await Promise.all(
      files.map(async (file) => {
        try {
          const gltf = await loader.loadAsync(`assets/props/${file}?v=${KIT_V}`);
          const root = (gltf.scene || gltf.scenes[0]).clone(true);
          root.traverse((o) => {
            if (!o.isMesh || !o.material) return;
            const mats = [].concat(o.material);
            for (let i = 0; i < mats.length; i++) {
              if (!mats[i]) continue;
              mats[i].transparent = false;
              mats[i].opacity = 1;
              mats[i].envMapIntensity = Math.min(0.55, mats[i].envMapIntensity || 0.4);
            }
            o.castShadow = true;
            o.receiveShadow = true;
          });
          templates.push(root);
        } catch {
          /* hero LOD optional */
        }
      })
    );
    if (!templates.length) return;
    const stand = [
      { x: 18, z: 404, s: 1.02, yaw: 0.4 },
      { x: -6, z: 378, s: 0.92, yaw: 1.7 },
      { x: 22, z: 378, s: 1.1, yaw: 2.4 },
      { x: -14, z: 408, s: 0.88, yaw: 0.2 },
      { x: 4, z: 418, s: 1.05, yaw: 1.1 },
    ];
    for (let i = 0; i < stand.length; i++) {
      const src = templates[i % templates.length];
      const p = stand[i];
      const node = src.clone(true);
      seatProp(node, p.x, 4.6, p.z, p.yaw, p.s, p.s, p.s, 0.14);
      node.name = `attract-forest-hero-${i}`;
      this.group.add(node);
    }
  }

  /**
   * Off-road scatter that never sits on the play ribbon.
   * @param {number} count
   * @param {((s:object)=>boolean)|null} pred
   * @param {number} dMin
   * @param {number} dMax
   */
  _scatterOffRoad(count, pred, dMin, dMax) {
    const out = [];
    const line = this.line;
    if (!line.length) return out;
    const stride = Math.max(2, Math.floor(line.length / (count * 1.5)));
    let i = 4;
    while (out.length < count && i < line.length - 4) {
      const s = line[i];
      if (!pred || pred(s)) {
        const side = (out.length + i) % 2 ? 1 : -1;
        const dist = dMin + ((i * 13) % 17) * ((dMax - dMin) / 17);
        out.push({
          x: s.x + s.nx * side * dist,
          y: s.y - 0.14,
          z: s.z + s.nz * side * dist,
          yaw: s.yaw + ((i * 7) % 10) * 0.31,
        });
      }
      i += stride;
    }
    return out;
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
          const mats = o.material ? [].concat(o.material) : [];
          for (let m = 0; m < mats.length; m++) {
            if (!mats[m]) continue;
            mats[m].transparent = false;
            mats[m].opacity = 1;
          }
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
   * Plant one pack car on the ribbon. Grounded cars sit flat.
   * Jump pitch lifts the chassis by the contact-patch clearance so
   * bumpers and wheels never go under deck Y.
   * @param {THREE.Object3D} mesh
   * @param {object} pose
   * @param {number} i
   * @param {number} dt
   * @param {number} scale
   * @param {{applyWheelPose?:Function, setBrakeLights?:Function, setHeadlights?:Function, chassisDeckEmbed?:Function}} hooks
   */
  _plantCar(mesh, pose, i, dt, scale, hooks) {
    if (!mesh || !pose) return;
    const pitch = pose.jump ? -0.12 : 0;
    const roll = 0;
    const chassisY = attractChassisYCleared(pose.y, pitch, roll);
    mesh.position.set(pose.x, chassisY, pose.z);
    mesh.rotation.set(pitch, pose.yaw, roll);
    const yawRate = 0.35 + Math.sin(this.t * 0.7 + i) * 0.2;
    const steer = pose.jump ? 0 : Math.max(-0.55, Math.min(0.55, yawRate * (i % 2 ? -1 : 1) * 0.35));
    const spin = this._spin[i];
    const inc = (pose.speed / 0.33) * dt * scale;
    if (spin && dt > 0) {
      for (let w = 0; w < 4; w++) spin[w] += inc;
    }
    const sink =
      mesh.userData && Number.isFinite(mesh.userData.tirePlantSink)
        ? mesh.userData.tirePlantSink
        : 0.012;
    const deckLift =
      hooks && hooks.chassisDeckEmbed
        ? hooks.chassisDeckEmbed(null, attractChassisY(pose.y), mesh)
        : attractDeckLift(sink);
    if (hooks && hooks.applyWheelPose && mesh.userData && mesh.userData.wheels) {
      hooks.applyWheelPose(mesh.userData.wheels, spin, steer, roll, null, deckLift);
    }
    if (hooks && hooks.setBrakeLights) hooks.setBrakeLights(mesh, pose.jump ? 0 : Math.abs(steer) > 0.28 ? 0.7 : 0);
    if (hooks && hooks.setHeadlights) hooks.setHeadlights(mesh, false);
    mesh.updateMatrixWorld(true);
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {{applyWheelPose?:Function, setBrakeLights?:Function, setHeadlights?:Function, chassisDeckEmbed?:Function}} hooks
   */
  update(dt, camera, hooks) {
    if (!this.ready) return this.director._out();
    const kind = this.director.kind;
    let scale = 1;
    if (!this.reduced) {
      if (kind === "jump") scale = 0.56;
      else if (kind === "crane") scale = 0.8;
      else if (kind === "smash" || kind === "whip") scale = 1.24;
    }
    this._timeScale = scale;
    this.t += dt * scale;
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
      this._plantCar(this.cars[i], pose, i, dt, scale, hooks);
    }
    this.second = second;
    this._tickWake(dt);
    const shot = this.director.update(dt, this.lead, { second });
    if (shot.justCut) {
      for (let i = 0; i < n; i++) {
        const gap = i * (this.phone ? 10 : 8);
        const dist = this.t * (pace - i * 1.6) - gap;
        const pose = this.sample(dist, i === 0 ? this.lead : {});
        pose.speed = pace - i * 1.6;
        pose.t = this.t;
        this._plantCar(this.cars[i], pose, i, 0, scale, hooks);
      }
    }
    shot.timeScale = this._timeScale;
    shot.clock = this._clock();
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

  _clock() {
    const t = this.t;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const f = Math.floor((t % 1) * 24);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
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
          car.position.y + ATTRACT_TIRE_PLANT + 0.04 + Math.random() * 0.05,
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
      const ay = car.position.y + ATTRACT_TIRE_PLANT + 0.004;
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
 * @param {{fade:number,flash:number,label:string,kind:string,chroma?:number,smear?:number,speedFx?:number,clock?:string,calm?:boolean,ramp?:string,energy?:string}|null} shot
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
  const chroma = root.querySelector(".attract-chroma");
  const smear = root.querySelector(".attract-smear");
  const speed = root.querySelector(".attract-speed");
  const clock = root.querySelector(".attract-clock");
  if (fade) fade.style.opacity = String(Math.max(0, Math.min(1, shot.fade)));
  if (flash) flash.style.opacity = "0";
  if (chroma) chroma.style.opacity = String(Math.max(0, Math.min(1, shot.chroma == null ? 0.64 : shot.chroma)));
  if (smear) smear.style.opacity = String(Math.max(0, Math.min(1, shot.smear || 0)));
  if (speed) speed.style.opacity = String(Math.max(0, Math.min(1, shot.speedFx == null ? 0.35 : shot.speedFx)));
  if (slug && slug.textContent !== shot.label) slug.textContent = shot.label;
  if (clock && shot.clock && clock.textContent !== shot.clock) clock.textContent = shot.clock;
  root.dataset.kind = shot.kind || "";
  root.dataset.ramp = shot.ramp || "live";
  root.dataset.energy = shot.energy || "live";
  if (shot.calm) root.classList.add("is-calm");
  else root.classList.remove("is-calm");
}
