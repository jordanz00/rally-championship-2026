/**
 * POV driver — 3D racing gloves that actually grip the rim.
 *
 * WHO THIS IS FOR: cockpit / POV camera only (layer 1 overlay).
 * WHAT IT DOES: measures the live rim in spin-local space, plants a palm on
 *   the tube, wraps fingers and thumb around it, and hangs two-bone suit
 *   sleeves from the shoulders to those wrists. Hands ride the steer-spin
 *   so a turn rotates the grip with the wheel.
 * HOW IT CONNECTS: celica.js attachPovDriverArms → cockpit-anim IK each frame.
 */

import * as THREE from "../../vendor/three.module.js";

/** @type {Map<string, THREE.BufferGeometry>} */
const GEO = new Map();
/** @type {THREE.MeshStandardMaterial|null} */
let GLOVE_MAT = null;
/** @type {THREE.MeshStandardMaterial|null} */
let GLOVE_ACCENT = null;
/** @type {THREE.MeshStandardMaterial|null} */
let SUIT_MAT = null;
/** @type {THREE.MeshStandardMaterial|null} */
let CUFF_MAT = null;
/** @type {THREE.CanvasTexture|null} */
let GLOVE_MAP = null;
/** @type {THREE.CanvasTexture|null} */
let GLOVE_BUMP = null;

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _inv = new THREE.Matrix4();
const _yAxis = new THREE.Vector3(0, 1, 0);

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
 * Racing-glove albedo + bump (leather grain, stitch, knuckle pads, accent stripe).
 */
function ensureGloveMaps() {
  if (GLOVE_MAP && GLOVE_BUMP) return;
  const w = 256;
  const h = 256;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n =
        ((Math.sin(x * 0.37) * Math.cos(y * 0.29) + 1) * 0.5) * 0.35 +
        ((Math.sin(x * 1.7 + y * 0.9) + 1) * 0.5) * 0.25 +
        ((Math.sin((x + y) * 0.11) + 1) * 0.5) * 0.2;
      const stripe = x > w * 0.42 && x < w * 0.58 ? 1 : 0;
      const stitchU = Math.abs((x % 18) - 9) < 0.9 || Math.abs((y % 22) - 11) < 0.9;
      let r = 28 + n * 22;
      let gr = 24 + n * 18;
      let b = 22 + n * 14;
      if (stripe) {
        r = 120 + n * 40;
        gr = 18 + n * 10;
        b = 22 + n * 8;
      }
      if (stitchU) {
        r = Math.min(255, r + 55);
        gr = Math.min(255, gr + 48);
        b = Math.min(255, b + 40);
      }
      const kx = ((x / w) * 4) | 0;
      const ky = ((y / h) * 3) | 0;
      if ((kx + ky) % 2 === 0 && x % 64 > 12 && x % 64 < 52 && y % 85 > 18 && y % 85 < 58) {
        r *= 0.72;
        gr *= 0.7;
        b *= 0.68;
      }
      d[i] = r;
      d[i + 1] = gr;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  GLOVE_MAP = new THREE.CanvasTexture(c);
  GLOVE_MAP.colorSpace = THREE.SRGBColorSpace;
  GLOVE_MAP.wrapS = GLOVE_MAP.wrapT = THREE.RepeatWrapping;
  GLOVE_MAP.repeat.set(1.4, 1.4);
  GLOVE_MAP.userData.shared = true;

  const bc = document.createElement("canvas");
  bc.width = w;
  bc.height = h;
  const bg = bc.getContext("2d");
  const bimg = bg.createImageData(w, h);
  const bd = bimg.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const grain =
        ((Math.sin(x * 2.4) * Math.cos(y * 2.1) + 1) * 0.5) * 140 +
        ((Math.sin(x * 0.55 + y * 0.4) + 1) * 0.5) * 80;
      const v = Math.max(40, Math.min(220, grain));
      bd[i] = bd[i + 1] = bd[i + 2] = v;
      bd[i + 3] = 255;
    }
  }
  bg.putImageData(bimg, 0, 0);
  GLOVE_BUMP = new THREE.CanvasTexture(bc);
  GLOVE_BUMP.wrapS = GLOVE_BUMP.wrapT = THREE.RepeatWrapping;
  GLOVE_BUMP.repeat.set(2.2, 2.2);
  GLOVE_BUMP.userData.shared = true;
}

function ensureMats() {
  if (GLOVE_MAT) return;
  ensureGloveMaps();
  GLOVE_MAT = new THREE.MeshStandardMaterial({
    map: GLOVE_MAP,
    bumpMap: GLOVE_BUMP,
    bumpScale: 0.55,
    color: 0xffffff,
    roughness: 0.78,
    metalness: 0.04,
    envMapIntensity: 0.55,
    emissive: 0xffffff,
    emissiveMap: GLOVE_MAP,
    emissiveIntensity: 0.7,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  GLOVE_MAT.userData.shared = true;
  GLOVE_ACCENT = new THREE.MeshStandardMaterial({
    color: 0x9a1c1c,
    roughness: 0.62,
    metalness: 0.08,
    envMapIntensity: 0.5,
    bumpMap: GLOVE_BUMP,
    bumpScale: 0.28,
    emissive: 0x4a0c0c,
    emissiveIntensity: 0.65,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  GLOVE_ACCENT.userData.shared = true;
  SUIT_MAT = new THREE.MeshStandardMaterial({
    color: 0x141820,
    roughness: 0.9,
    metalness: 0.02,
    envMapIntensity: 0.35,
    bumpMap: GLOVE_BUMP,
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
 * World AABBs lie about a tilted GLB and float the gloves off the leather.
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
 * Capsule along +Y, origin at base.
 * @param {number} r
 * @param {number} len
 * @param {string} key
 */
function capsuleAlongY(r, len, key) {
  return geo(key, () => {
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2), 6, 12);
    g.translate(0, len * 0.5, 0);
    return g;
  });
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

/**
 * Three phalanges sitting on the tube, wrapping driver → outside → dash.
 * @param {THREE.Group} hand
 * @param {number} along
 * @param {number} lenScale
 * @param {number} tubeR
 * @param {number} startA
 * @param {number} sweep
 */
function addWrappedFinger(hand, along, lenScale, tubeR, startA, sweep) {
  const lens = [0.028 * lenScale, 0.023 * lenScale, 0.018 * lenScale];
  const radii = [0.008, 0.0072, 0.0064];
  const n = 3;
  const da = sweep / n;
  for (let i = 0; i < n; i++) {
    const a0 = startA + da * i;
    const a1 = a0 + da;
    const p0 = tubePoint(a0, along, tubeR, 0.0018);
    const p1 = tubePoint(a1, along, tubeR, 0.0018);
    const joint = new THREE.Group();
    joint.position.set(p0.x, p0.y, p0.z);
    _v.set(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    const len = _v.length();
    if (len > 1e-5) {
      _v.multiplyScalar(1 / len);
      joint.quaternion.setFromUnitVectors(_yAxis, _v);
    }
    joint.add(mesh(GLOVE_MAT, capsuleAlongY(radii[i], lens[i], `grip-f${i}-${lenScale.toFixed(2)}`)));
    hand.add(joint);
  }
}

/**
 * Thumb wraps the inner / underside of the tube toward the hub.
 * @param {THREE.Group} hand
 * @param {number} tubeR
 */
function addWrappedThumb(hand, tubeR) {
  const along = -0.016;
  const startA = -0.15;
  const sweep = -1.55;
  const lens = [0.03, 0.024];
  const radii = [0.0086, 0.0074];
  const n = 2;
  const da = sweep / n;
  for (let i = 0; i < n; i++) {
    const a0 = startA + da * i;
    const a1 = a0 + da;
    const p0 = tubePoint(a0, along, tubeR, 0.002);
    const p1 = tubePoint(a1, along, tubeR, 0.002);
    const joint = new THREE.Group();
    joint.position.set(p0.x, p0.y, p0.z);
    _v.set(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z);
    const len = _v.length();
    if (len > 1e-5) {
      _v.multiplyScalar(1 / len);
      joint.quaternion.setFromUnitVectors(_yAxis, _v);
    }
    joint.add(mesh(GLOVE_MAT, capsuleAlongY(radii[i], lens[i], `grip-th${i}`)));
    hand.add(joint);
  }
}

/**
 * Gloved hand gripping 9 o'clock (then mirrored to 3).
 * Local +X = outward, +Y = toward 12, +Z = into the dash.
 * @param {number} side +1 left / −1 right
 * @param {number} rimR
 * @param {number} tubeR
 * @returns {THREE.Group}
 */
function makeHand(side, rimR, tubeR) {
  ensureMats();
  const mount = new THREE.Group();
  mount.name = side > 0 ? "hand-L" : "hand-R";
  // 10 and 2 — 9/3 sits on the rim's bottom corners and reads as empty.
  const clock = side > 0 ? 0.62 : Math.PI - 0.62;
  mount.position.set(Math.cos(clock) * rimR, Math.sin(clock) * rimR, 0);
  mount.rotation.z = clock;
  if (side < 0) mount.scale.x = -1;
  mount.scale.multiplyScalar(1.18);

  const hand = new THREE.Group();
  hand.name = "grip";
  mount.add(hand);

  const palm = mesh(
    GLOVE_MAT,
    geo("palm-cup", () => {
      const box = new THREE.BoxGeometry(0.034, 0.062, 0.028, 4, 4, 3);
      const pos = box.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const cup = 1 - Math.min(1, (Math.abs(y) / 0.031) * 0.18);
        pos.setXYZ(i, x * cup + 0.004, y, z - Math.abs(y) * 0.08);
      }
      box.computeVertexNormals();
      return box;
    })
  );
  const driver = tubePoint(0.22, 0.006, tubeR, 0.01);
  palm.position.set(driver.x + 0.004, driver.y, driver.z);
  palm.rotation.y = 0.35;
  hand.add(palm);

  const pads = mesh(
    GLOVE_ACCENT,
    geo("pads", () => new THREE.BoxGeometry(0.016, 0.048, 0.012, 2, 2, 1))
  );
  pads.position.set(driver.x + 0.014, 0.01, driver.z - 0.002);
  pads.rotation.y = 0.28;
  hand.add(pads);

  const alongs = [0.026, 0.01, -0.006, -0.022];
  const lens = [0.96, 1.04, 1.0, 0.86];
  const startA = 0.18;
  const sweep = 2.15;
  for (let i = 0; i < 4; i++) {
    addWrappedFinger(hand, alongs[i], lens[i], tubeR, startA + i * 0.04, sweep);
  }
  addWrappedThumb(hand, tubeR);

  const cuff = mesh(
    CUFF_MAT,
    geo("cuff", () => {
      const c = new THREE.CylinderGeometry(0.02, 0.024, 0.042, 14, 1, true);
      c.rotateZ(Math.PI * 0.5);
      return c;
    })
  );
  cuff.position.set(0.006, -0.006, -tubeR - 0.034);
  cuff.rotation.y = 0.45;
  hand.add(cuff);

  const wrist = new THREE.Object3D();
  wrist.name = "wrist";
  wrist.position.set(0.004, -0.01, -tubeR - 0.05);
  hand.add(wrist);
  mount.userData.wrist = wrist;
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

  const layer = hooks.POV_HUD_LAYER;
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
