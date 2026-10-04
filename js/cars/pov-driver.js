/**
 * POV driver — bare adult hands that wrap the rim.
 *
 * WHO THIS IS FOR: cockpit / POV camera only (layer 1 overlay).
 * WHAT IT DOES: measures the live rim in spin-local space, cups a palm on
 *   the tube, wraps four fingers around the far side, parks the thumb on
 *   top of the leather, and hangs two-bone sleeves to those wrists.
 *   Hands ride steer-spin so a turn rotates the grip with the wheel.
 * HOW IT CONNECTS: celica.js attachPovDriverArms → cockpit-anim IK each frame.
 */

import * as THREE from "../../vendor/three.module.js";

/** @type {Map<string, THREE.BufferGeometry>} */
const GEO = new Map();
/** @type {THREE.MeshStandardMaterial|null} */
let SKIN_MAT = null;
/** @type {THREE.MeshStandardMaterial|null} */
let KNUCKLE_MAT = null;
/** @type {THREE.MeshStandardMaterial|null} */
let NAIL_MAT = null;
/** @type {THREE.MeshStandardMaterial|null} */
let SUIT_MAT = null;
/** @type {THREE.MeshStandardMaterial|null} */
let CUFF_MAT = null;
/** @type {THREE.CanvasTexture|null} */
let SKIN_MAP = null;
/** @type {THREE.CanvasTexture|null} */
let SKIN_BUMP = null;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _basis = new THREE.Matrix4();

/** 9/3 plus a few degrees toward 10/2 — planted, thumbs on the crown. */
const CLOCK_9_3 = 0.14;

/**
 * @param {string} key
 * @param {() => THREE.BufferGeometry} build
 * @returns {THREE.BufferGeometry}
 */
function geo(key, build) {
  let g = GEO.get(key);
  if (g) return g;
  g = build();
  g.userData.shared = true;
  GEO.set(key, g);
  return g;
}

/**
 * Warm skin albedo + pore bump. Overlay has no sun, so this is also the emissive.
 */
function ensureSkinMaps() {
  if (SKIN_MAP && SKIN_BUMP) return;
  const w = 256;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n =
        ((Math.sin(x * 0.41) * Math.cos(y * 0.33) + 1) * 0.5) * 0.28 +
        ((Math.sin(x * 1.9 + y * 0.7) + 1) * 0.5) * 0.18;
      const blush = Math.max(0, Math.sin((x / w) * Math.PI) * Math.sin((y / h) * Math.PI * 2) * 0.12);
      d[i] = 214 + n * 28 + blush * 40;
      d[i + 1] = 168 + n * 22 - blush * 8;
      d[i + 2] = 132 + n * 16 - blush * 4;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  SKIN_MAP = new THREE.CanvasTexture(c);
  SKIN_MAP.colorSpace = THREE.SRGBColorSpace;
  SKIN_MAP.wrapS = SKIN_MAP.wrapT = THREE.RepeatWrapping;
  SKIN_MAP.repeat.set(1.6, 1.6);
  SKIN_MAP.userData.shared = true;

  const bc = document.createElement("canvas");
  bc.width = w;
  bc.height = h;
  const bg = bc.getContext("2d");
  const bimg = bg.createImageData(w, h);
  const bd = bimg.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const pore = ((Math.sin(x * 3.1) * Math.cos(y * 2.8) + 1) * 0.5) * 90 + 90;
      const v = Math.max(50, Math.min(210, pore));
      bd[i] = bd[i + 1] = bd[i + 2] = v;
      bd[i + 3] = 255;
    }
  }
  bg.putImageData(bimg, 0, 0);
  SKIN_BUMP = new THREE.CanvasTexture(bc);
  SKIN_BUMP.wrapS = SKIN_BUMP.wrapT = THREE.RepeatWrapping;
  SKIN_BUMP.repeat.set(3.2, 3.2);
  SKIN_BUMP.userData.shared = true;
}

function ensureMats() {
  if (SKIN_MAT) return;
  ensureSkinMaps();
  SKIN_MAT = new THREE.MeshStandardMaterial({
    map: SKIN_MAP,
    bumpMap: SKIN_BUMP,
    bumpScale: 0.35,
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.02,
    envMapIntensity: 0.35,
    emissive: 0xffffff,
    emissiveMap: SKIN_MAP,
    emissiveIntensity: 0.62,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  SKIN_MAT.userData.shared = true;
  KNUCKLE_MAT = new THREE.MeshStandardMaterial({
    map: SKIN_MAP,
    bumpMap: SKIN_BUMP,
    bumpScale: 0.42,
    color: 0xf0c2a8,
    roughness: 0.58,
    metalness: 0.02,
    envMapIntensity: 0.3,
    emissive: 0xf0c2a8,
    emissiveIntensity: 0.55,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  KNUCKLE_MAT.userData.shared = true;
  NAIL_MAT = new THREE.MeshStandardMaterial({
    color: 0xf3d6c8,
    roughness: 0.28,
    metalness: 0.08,
    envMapIntensity: 0.45,
    emissive: 0xc9a090,
    emissiveIntensity: 0.5,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  NAIL_MAT.userData.shared = true;
  SUIT_MAT = new THREE.MeshStandardMaterial({
    color: 0x141820,
    roughness: 0.9,
    metalness: 0.02,
    envMapIntensity: 0.35,
    bumpMap: SKIN_BUMP,
    bumpScale: 0.18,
    emissive: 0x0c1016,
    emissiveIntensity: 0.55,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  SUIT_MAT.userData.shared = true;
  CUFF_MAT = new THREE.MeshStandardMaterial({
    color: 0x0a0c10,
    roughness: 0.7,
    metalness: 0.12,
    envMapIntensity: 0.4,
    emissive: 0x08090c,
    emissiveIntensity: 0.5,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  CUFF_MAT.userData.shared = true;
}

/**
 * Point on the rim tube. θ=0 is the driver face (−Z), then outside (+X), dash (+Z).
 * @param {number} theta
 * @param {number} along
 * @param {number} tubeR
 * @param {number} [pad]
 */
function tubePoint(theta, along, tubeR, pad = 0) {
  const r = tubeR + pad;
  return {
    x: r * Math.sin(theta),
    y: along,
    z: -r * Math.cos(theta),
  };
}

/**
 * Rim radius and tube thickness in the steer-spin's local XY disc.
 * World AABBs lie about a tilted GLB and float the hands off the leather.
 * @param {THREE.Object3D} spin
 * @returns {{ rimR: number, tubeR: number }}
 */
export function measureSpinRim(spin) {
  let rMax = 0.155;
  let zMin = 0;
  let zMax = 0;
  let hits = 0;
  if (!spin) return { rimR: 0.155, tubeR: 0.016 };
  spin.updateMatrixWorld(true);
  _inv.copy(spin.matrixWorld).invert();
  spin.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (o.userData.povDriver) return;
    const pos = o.geometry.attributes && o.geometry.attributes.position;
    if (!pos) return;
    o.updateWorldMatrix(true, false);
    _m.multiplyMatrices(_inv, o.matrixWorld);
    const step = Math.max(1, (pos.count / 360) | 0);
    for (let i = 0; i < pos.count; i += step) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(_m);
      const r = Math.hypot(_v.x, _v.y);
      if (r > rMax) rMax = r;
      if (hits === 0) {
        zMin = _v.z;
        zMax = _v.z;
      } else {
        zMin = Math.min(zMin, _v.z);
        zMax = Math.max(zMax, _v.z);
      }
      hits += 1;
    }
  });
  const rimR = THREE.MathUtils.clamp(rMax * 0.93, 0.12, 0.22);
  const tubeR = THREE.MathUtils.clamp(Math.max(0.014, (zMax - zMin) * 0.28), 0.013, 0.026);
  return { rimR, tubeR };
}

/**
 * Organic phalanx — swept ellipse, knuckle swell, flat belly, tapered tip.
 * Authored rings. Not a box. Not a capsule.
 * @param {number} len
 * @param {number} wide
 * @param {number} thin
 * @param {number} swell
 * @param {string} key
 */
function digitGeo(len, wide, thin, swell, key) {
  return geo(key, () => {
    const rings = 8;
    const segs = 10;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= rings; i++) {
      const t = i / rings;
      const y = t * len;
      const bulge = 1 + swell * Math.sin(Math.min(1, t / 0.72) * Math.PI);
      const taper = 1 - t * 0.24;
      const rw = wide * bulge * taper;
      const rt = thin * bulge * taper * 0.92;
      for (let j = 0; j <= segs; j++) {
        const a = (j / segs) * Math.PI * 2 - Math.PI * 0.5;
        let x = Math.cos(a) * rw;
        let z = Math.sin(a) * rt;
        if (z > 0) z *= 0.7;
        else z *= 1.06;
        pos.push(x, y, z);
        uv.push(j / segs, t);
      }
    }
    pos.push(0, len * 1.035, 0);
    uv.push(0.5, 1);
    const tip = (rings + 1) * (segs + 1);
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j;
        const b = a + 1;
        const c = a + (segs + 1);
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const last = rings * (segs + 1);
    for (let j = 0; j < segs; j++) idx.push(last + j, tip, last + j + 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Knuckle bone landmark on the dorsal side.
 * @param {number} r
 * @param {string} key
 */
function knuckleGeo(r, key) {
  return geo(key, () => {
    const rings = 6;
    const segs = 8;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= rings; i++) {
      const v = (i / rings) * Math.PI;
      const sy = Math.cos(v);
      const sr = Math.sin(v);
      for (let j = 0; j <= segs; j++) {
        const u = (j / segs) * Math.PI * 2;
        pos.push(Math.cos(u) * sr * r * 1.15, sy * r * 0.62, Math.sin(u) * sr * r * 0.82);
        uv.push(j / segs, i / rings);
      }
    }
    for (let i = 0; i < rings; i++) {
      for (let j = 0; j < segs; j++) {
        const a = i * (segs + 1) + j;
        const b = a + 1;
        const c = a + (segs + 1);
        idx.push(a, c, b, b, c, c + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Fingernail plate on the dorsal distal.
 * @param {number} w
 * @param {number} h
 * @param {string} key
 */
function nailGeo(w, h, key) {
  return geo(key, () => {
    const pos = [];
    const uv = [];
    const idx = [];
    const nu = 4;
    const nv = 3;
    for (let i = 0; i <= nv; i++) {
      const t = i / nv;
      const y = (t - 0.15) * h;
      const ww = w * (0.72 + t * 0.28);
      for (let j = 0; j <= nu; j++) {
        const s = j / nu;
        const x = (s - 0.5) * ww;
        const z = -0.0004 - Math.sin(s * Math.PI) * 0.0006;
        pos.push(x, y, z);
        uv.push(s, t);
      }
    }
    for (let i = 0; i < nv; i++) {
      for (let j = 0; j < nu; j++) {
        const a = i * (nu + 1) + j;
        idx.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Cupped palm — parametric skin sheet, not a box.
 * Local +Y = pinky→index along the rim, +X = out from hub, +Z = dash.
 */
function palmGeo() {
  return geo("palm-skin", () => {
    const nu = 10;
    const nv = 12;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= nv; i++) {
      const ty = i / nv;
      const y = (ty - 0.5) * 0.078;
      const wrist = ty < 0.22 ? 0.78 + ty * 1.0 : 1;
      for (let j = 0; j <= nu; j++) {
        const tx = j / nu;
        let x = (tx - 0.18) * 0.042 * wrist;
        let z = -0.004;
        const cup = Math.sin(ty * Math.PI) * 0.01;
        z -= cup + Math.abs(y) * 0.07;
        if (tx > 0.62) z -= (tx - 0.62) * 0.012;
        if (ty < 0.2 && tx < 0.45) {
          x -= 0.006;
          z += 0.004;
        }
        pos.push(x, y, z);
        uv.push(tx, ty);
      }
    }
    for (let i = 0; i < nv; i++) {
      for (let j = 0; j < nu; j++) {
        const a = i * (nu + 1) + j;
        idx.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

/**
 * Seat a digit so +Y follows the wrap and +Z hugs the tube.
 * @param {THREE.Object3D} joint
 * @param {{x:number,y:number,z:number}} p0
 * @param {{x:number,y:number,z:number}} p1
 */
function orientOnTube(joint, p0, p1) {
  _v.set(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
  const len = _v.length();
  if (len < 1e-5) return 0;
  _v.multiplyScalar(1 / len);
  _v2.set(-p0.x, 0, -p0.z);
  if (_v2.lengthSq() < 1e-8) _v2.set(0, 0, 1);
  _v2.normalize();
  _v3.crossVectors(_v, _v2);
  if (_v3.lengthSq() < 1e-8) _v3.set(0, 1, 0);
  _v3.normalize();
  _v2.crossVectors(_v3, _v).normalize();
  _basis.makeBasis(_v3, _v, _v2);
  joint.quaternion.setFromRotationMatrix(_basis);
  return len;
}

/**
 * @param {THREE.Material} mat
 * @param {THREE.BufferGeometry} geometry
 * @returns {THREE.Mesh}
 */
function mesh(mat, geometry) {
  const m = new THREE.Mesh(geometry, mat);
  m.castShadow = false;
  m.receiveShadow = false;
  m.userData.povDriver = true;
  return m;
}

function countTris(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry;
    if (g.index) n += g.index.count / 3;
    else if (g.attributes.position) n += g.attributes.position.count / 3;
  });
  return n | 0;
}

/**
 * Three phalanges wrapping driver face → outside → far side of the tube.
 * @param {THREE.Group} hand
 * @param {number} along
 * @param {number} wideScale
 * @param {number} tubeR
 * @param {number} startA
 * @param {number} sweep
 * @param {string} name
 */
function addWrappedFinger(hand, along, wideScale, tubeR, startA, sweep, name) {
  const finger = new THREE.Group();
  finger.name = name;
  finger.userData.digit = "finger";
  finger.userData.phalanges = 3;
  const wides = [0.0084 * wideScale, 0.0075 * wideScale, 0.0064 * wideScale];
  const thins = [0.0068 * wideScale, 0.006 * wideScale, 0.0052 * wideScale];
  const swells = [0.16, 0.2, 0.1];
  const n = 3;
  const pad = 0.0032;
  const da = sweep / n;
  for (let i = 0; i < n; i++) {
    const a0 = startA + da * i;
    const a1 = a0 + da;
    const p0 = tubePoint(a0, along, tubeR, pad);
    const p1 = tubePoint(a1, along, tubeR, pad);
    const joint = new THREE.Group();
    joint.name = `phalange-${i}`;
    joint.userData.phalange = i;
    joint.position.set(p0.x, p0.y, p0.z);
    const arc = orientOnTube(joint, p0, p1);
    const len = Math.max(0.012, arc * 1.02);
    const body = mesh(SKIN_MAT, digitGeo(len, wides[i], thins[i], swells[i], `dig-${i}-${wideScale.toFixed(2)}`));
    body.userData.digitPart = "phalange";
    joint.add(body);
    if (i < n - 1) {
      const kn = mesh(KNUCKLE_MAT, knuckleGeo(wides[i] * 1.05, `kn-${i}`));
      kn.name = `knuckle-${i}`;
      kn.position.set(0, len * 0.92, -thins[i] * 0.7);
      kn.userData.digitPart = "knuckle";
      joint.add(kn);
    } else {
      const nail = mesh(NAIL_MAT, nailGeo(wides[i] * 1.35, len * 0.42, `nail-${wideScale.toFixed(2)}`));
      nail.name = "fingernail";
      nail.position.set(0, len * 0.72, -thins[i] * 0.78);
      nail.userData.digitPart = "nail";
      joint.add(nail);
    }
    finger.add(joint);
  }
  hand.add(finger);
}

/**
 * Thumb rests on the crown of the rim (driver face), pointing toward 12.
 * @param {THREE.Group} hand
 * @param {number} tubeR
 */
function addWrappedThumb(hand, tubeR) {
  const thumb = new THREE.Group();
  thumb.name = "thumb";
  thumb.userData.digit = "thumb";
  thumb.userData.phalanges = 2;
  const pad = 0.0034;
  const segs = [
    { a0: -0.08, a1: -0.22, y0: -0.004, y1: 0.016, w: 0.0092, t: 0.0074, swell: 0.18 },
    { a0: -0.22, a1: -0.32, y0: 0.016, y1: 0.034, w: 0.008, t: 0.0064, swell: 0.1 },
  ];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const p0 = tubePoint(s.a0, s.y0, tubeR, pad);
    const p1 = tubePoint(s.a1, s.y1, tubeR, pad);
    const joint = new THREE.Group();
    joint.name = `phalange-${i}`;
    joint.userData.phalange = i;
    joint.position.set(p0.x, p0.y, p0.z);
    const arc = orientOnTube(joint, p0, p1);
    const len = Math.max(0.014, arc * 1.04);
    const body = mesh(SKIN_MAT, digitGeo(len, s.w, s.t, s.swell, `th-dig-${i}`));
    body.userData.digitPart = "phalange";
    joint.add(body);
    if (i === 0) {
      const kn = mesh(KNUCKLE_MAT, knuckleGeo(s.w * 1.08, "th-kn"));
      kn.name = "knuckle-0";
      kn.position.set(0, len * 0.88, -s.t * 0.62);
      kn.userData.digitPart = "knuckle";
      joint.add(kn);
    } else {
      const nail = mesh(NAIL_MAT, nailGeo(s.w * 1.3, len * 0.38, "th-nail"));
      nail.name = "fingernail";
      nail.position.set(0, len * 0.7, -s.t * 0.74);
      nail.userData.digitPart = "nail";
      joint.add(nail);
    }
    thumb.add(joint);
  }
  hand.add(thumb);
}

/**
 * Bare left hand at 9 o'clock (mirrored to 3). Adult male, fit to this rim.
 * @param {number} side +1 left / −1 right
 * @param {number} rimR
 * @param {number} tubeR
 * @returns {THREE.Group}
 */
function makeHand(side, rimR, tubeR) {
  ensureMats();
  const mount = new THREE.Group();
  mount.name = side > 0 ? "hand-L" : "hand-R";
  const clock = side > 0 ? CLOCK_9_3 : Math.PI - CLOCK_9_3;
  mount.userData.clock = clock;
  mount.position.set(Math.cos(clock) * rimR, Math.sin(clock) * rimR, 0);
  mount.rotation.z = clock;
  if (side < 0) mount.scale.x = -1;
  const fit = THREE.MathUtils.clamp(rimR / 0.155, 0.9, 1.12);
  mount.scale.multiplyScalar(fit);

  const hand = new THREE.Group();
  hand.name = "grip";
  mount.add(hand);

  const palm = mesh(SKIN_MAT, palmGeo());
  const driver = tubePoint(0.12, 0.002, tubeR, 0.012);
  palm.position.set(driver.x + 0.006, driver.y, driver.z);
  palm.rotation.y = 0.22;
  hand.add(palm);

  const thenar = mesh(SKIN_MAT, digitGeo(0.028, 0.012, 0.009, 0.22, "thenar"));
  thenar.position.set(driver.x - 0.002, -0.018, driver.z + 0.001);
  thenar.rotation.z = 0.85;
  thenar.rotation.y = 0.4;
  hand.add(thenar);

  const knY = [0.026, 0.008, -0.01, -0.026];
  for (let k = 0; k < 4; k++) {
    const mk = mesh(KNUCKLE_MAT, knuckleGeo(0.0074, "palm-kn"));
    mk.name = `metacarpal-${k}`;
    mk.position.set(driver.x + 0.014, knY[k], driver.z - 0.012);
    hand.add(mk);
  }

  const alongs = [0.028, 0.01, -0.008, -0.024];
  const wides = [0.98, 1.06, 1.0, 0.86];
  const names = ["finger-index", "finger-middle", "finger-ring", "finger-pinky"];
  const startA = 0.1;
  const sweep = 2.55;
  for (let i = 0; i < 4; i++) {
    addWrappedFinger(hand, alongs[i], wides[i], tubeR, startA + i * 0.03, sweep, names[i]);
  }
  addWrappedThumb(hand, tubeR);

  const cuff = mesh(
    CUFF_MAT,
    geo("wrist-cuff", () => {
      const c = new THREE.CylinderGeometry(0.018, 0.022, 0.04, 14, 1, true);
      c.rotateZ(Math.PI * 0.5);
      return c;
    })
  );
  cuff.position.set(0.004, -0.008, -tubeR - 0.032);
  cuff.rotation.y = 0.4;
  hand.add(cuff);

  const wrist = new THREE.Object3D();
  wrist.name = "wrist";
  wrist.position.set(0.002, -0.012, -tubeR - 0.048);
  hand.add(wrist);
  mount.userData.wrist = wrist;
  mount.userData.tris = countTris(mount);
  return mount;
}

/**
 * Suit sleeve bone along +Y (base at shoulder).
 * @param {number} r0
 * @param {number} r1
 * @param {string} key
 */
function makeSleeveMesh(r0, r1, key) {
  ensureMats();
  const m = mesh(
    SUIT_MAT,
    geo(key, () => {
      const c = new THREE.CylinderGeometry(r0, r1, 1, 14, 1, true);
      c.translate(0, 0.5, 0);
      return c;
    })
  );
  m.frustumCulled = false;
  return m;
}

/**
 * @param {THREE.Object3D} root car root
 * @param {{
 *   markSteerPovLayer: (n: THREE.Object3D) => void,
 *   POV_HUD_LAYER: number,
 * }} hooks
 */
export function attachPovDriverArms(root, hooks) {
  if (!root || !hooks) return;
  const prev = root.userData.povDriver;
  if (prev && prev.root && prev.root.parent) prev.root.parent.remove(prev.root);
  if (prev && prev.shoulders && prev.shoulders.parent) prev.shoulders.parent.remove(prev.shoulders);

  const spin = root.userData.steerSpin || root.userData.steerWheel;
  const cab = root.userData.cockpit;
  const rig = root.userData.povRig;
  if (!spin || !cab || !rig) {
    root.userData.povDriver = null;
    return;
  }

  ensureMats();
  const { rimR, tubeR } = measureSpinRim(spin);

  const grips = new THREE.Group();
  grips.name = "pov-driver-grips";
  grips.userData.povDriver = true;
  const handL = makeHand(1, rimR, tubeR);
  const handR = makeHand(-1, rimR, tubeR);
  grips.add(handL, handR);

  const layer = hooks.POV_HUD_LAYER;
  const lamp = new THREE.PointLight(0xffe6cc, 0.62, 1.05, 1.7);
  lamp.name = "pov-hand-light";
  lamp.layers.set(layer);
  lamp.position.set(0, 0, 0.04);
  grips.add(lamp);

  spin.add(grips);
  hooks.markSteerPovLayer(grips);

  const shoulders = new THREE.Group();
  shoulders.name = "pov-driver-shoulders";
  shoulders.userData.povDriver = true;
  const shY = rig.eyeY - 0.22;
  const shZ = rig.eyeZ - 0.06;
  const shL = new THREE.Object3D();
  shL.name = "shoulder-L";
  shL.position.set(rig.eyeX + 0.168, shY, shZ);
  const shR = new THREE.Object3D();
  shR.name = "shoulder-R";
  shR.position.set(rig.eyeX - 0.168, shY, shZ);
  shoulders.add(shL, shR);

  function armChain(side) {
    const deltoid = mesh(
      SUIT_MAT,
      geo("deltoid", () => new THREE.SphereGeometry(0.042, 12, 10))
    );
    deltoid.layers.set(layer);
    deltoid.renderOrder = 7;
    deltoid.scale.set(1.15, 0.85, 0.95);
    const upper = makeSleeveMesh(0.04, 0.03, "upper");
    upper.layers.set(layer);
    upper.renderOrder = 7;
    const elbow = new THREE.Object3D();
    elbow.name = side > 0 ? "elbow-L" : "elbow-R";
    const lower = makeSleeveMesh(0.029, 0.022, "lower");
    lower.layers.set(layer);
    lower.renderOrder = 7;
    const cuffRing = mesh(
      CUFF_MAT,
      geo("sleeve-cuff", () => new THREE.TorusGeometry(0.023, 0.006, 8, 14))
    );
    cuffRing.rotation.x = Math.PI * 0.5;
    cuffRing.position.y = 0.98;
    lower.add(cuffRing);
    return { upper, elbow, lower, deltoid };
  }

  const armL = armChain(1);
  const armR = armChain(-1);
  shL.add(armL.deltoid, armL.upper);
  shR.add(armR.deltoid, armR.upper);
  shoulders.add(armL.elbow, armR.elbow);
  armL.elbow.add(armL.lower);
  armR.elbow.add(armR.lower);
  cab.add(shoulders);
  hooks.markSteerPovLayer(shoulders);

  root.userData.povDriver = {
    root: grips,
    shoulders,
    handL,
    handR,
    sleeveL: armL.upper,
    sleeveR: armR.upper,
    forearmL: armL.lower,
    forearmR: armR.lower,
    elbowL: armL.elbow,
    elbowR: armR.elbow,
    shoulderL: shL,
    shoulderR: shR,
    wristL: handL.userData.wrist,
    wristR: handR.userData.wrist,
    rimR,
    tubeR,
    trisL: handL.userData.tris,
    trisR: handR.userData.tris,
    upperLen: 0.3,
    foreLen: 0.26,
    _tmpA: new THREE.Vector3(),
    _tmpB: new THREE.Vector3(),
    _tmpC: new THREE.Vector3(),
    _tmpD: new THREE.Vector3(),
    _tmpE: new THREE.Vector3(),
    _tmpF: new THREE.Vector3(),
    _yAxis: new THREE.Vector3(0, 1, 0),
  };

  grips.visible = !!root.userData._cockpitOn;
  shoulders.visible = !!root.userData._cockpitOn;
}
