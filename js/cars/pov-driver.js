/**
 * POV driver — rigged human hands on the steering wheel.
 *
 * WHO THIS IS FOR: cockpit / POV camera only (layer 1 overlay).
 * WHAT IT DOES: loads a CC0 skinned hand (MakeHuman mesh, 26-bone rig),
 *   seats large grips at 9 and 3 with fingers curled onto the leather.
 *   Knuckles face the driver. Hands ride steer-spin with the wheel.
 *   Two-bone sleeves hang from the wrist empties.
 * HOW IT CONNECTS: celica.js attachPovDriverArms → cockpit-anim IK each frame.
 *   Models: assets/driver/hand-grip-l.glb, hand-grip-r.glb (see ATTRIBUTION.txt).
 */

import * as THREE from "../../vendor/three.module.js";
import { GLTFLoader } from "../../vendor/GLTFLoader.js";

/** @type {Map<string, THREE.BufferGeometry>} */
const GEO = new Map();
/** @type {THREE.MeshStandardMaterial|null} */
let SKIN_MAT = null;
/** @type {THREE.MeshStandardMaterial|null} */
let SUIT_MAT = null;
/** @type {THREE.MeshStandardMaterial|null} */
let CUFF_MAT = null;
/** @type {THREE.CanvasTexture|null} */
let SKIN_MAP = null;
/** @type {THREE.CanvasTexture|null} */
let SKIN_BUMP = null;

const _v = new THREE.Vector3();
const _corner = new THREE.Vector3();

/** 9/3 plus a few degrees toward 10/2 — planted, thumbs on the crown. */
const CLOCK_9_3 = 0.14;
/**
 * Final display scale after tube fit. The export is a small MakeHuman hand —
 * POV needs a readable adult grip without floating off the leather.
 */
const HAND_DISPLAY = 1.52;
/** Extra squeeze into the tube after scale (fraction of tubeR). */
const HAND_PRESS = 0.72;

const HAND_L_URL = new URL("../../assets/driver/hand-grip-l.glb", import.meta.url).href;
const HAND_R_URL = new URL("../../assets/driver/hand-grip-r.glb", import.meta.url).href;

/** @type {Promise<{scene: THREE.Group}[]>|null} */
let HAND_LOAD = null;

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
  SKIN_MAP.repeat.set(2.2, 2.2);
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
  SKIN_BUMP.repeat.set(4, 4);
  SKIN_BUMP.userData.shared = true;
}

function ensureMats() {
  if (SKIN_MAT) return;
  ensureSkinMaps();
  // Warm living skin — readable under the cabin fill without looking plastic.
  SKIN_MAT = new THREE.MeshStandardMaterial({
    map: SKIN_MAP,
    bumpMap: SKIN_BUMP,
    bumpScale: 0.42,
    color: 0xd4a088,
    roughness: 0.78,
    metalness: 0.0,
    envMapIntensity: 0.22,
    emissive: 0xb88870,
    emissiveMap: SKIN_MAP,
    emissiveIntensity: 0.48,
    toneMapped: false,
  });
  SKIN_MAT.userData.shared = true;
  SUIT_MAT = new THREE.MeshStandardMaterial({
    color: 0x12161e,
    roughness: 0.92,
    metalness: 0.02,
    envMapIntensity: 0.3,
    bumpMap: SKIN_BUMP,
    bumpScale: 0.22,
    emissive: 0x0a0e14,
    emissiveIntensity: 0.5,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  SUIT_MAT.userData.shared = true;
  CUFF_MAT = new THREE.MeshStandardMaterial({
    color: 0x080a0e,
    roughness: 0.68,
    metalness: 0.14,
    envMapIntensity: 0.35,
    emissive: 0x06080c,
    emissiveIntensity: 0.45,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  CUFF_MAT.userData.shared = true;
}

/**
 * Start the GLB fetch as soon as the module loads so the grip is ready
 * by the time the cockpit is built.
 * @returns {Promise<{scene: THREE.Group}[]>}
 */
function loadHandGltfs() {
  if (HAND_LOAD) return HAND_LOAD;
  const loader = new GLTFLoader();
  HAND_LOAD = Promise.all([loader.loadAsync(HAND_L_URL), loader.loadAsync(HAND_R_URL)]);
  return HAND_LOAD;
}

loadHandGltfs();

/**
 * Clone a skinned GLB scene and retarget the skeleton onto the clone's bones.
 * Object3D.clone leaves SkinnedMesh pointing at the source armature.
 * @param {THREE.Object3D} source
 * @returns {THREE.Object3D}
 */
function cloneRig(source) {
  const sourceLookup = new Map();
  const cloneLookup = new Map();
  const clone = source.clone(true);
  const pairs = [[source, clone]];
  while (pairs.length) {
    const [a, b] = pairs.pop();
    sourceLookup.set(b, a);
    cloneLookup.set(a, b);
    const n = Math.min(a.children.length, b.children.length);
    for (let i = 0; i < n; i++) pairs.push([a.children[i], b.children[i]]);
  }
  clone.traverse((node) => {
    if (!node.isSkinnedMesh || !node.skeleton) return;
    const sourceMesh = sourceLookup.get(node);
    if (!sourceMesh || !sourceMesh.skeleton) return;
    const skel = sourceMesh.skeleton.clone();
    skel.bones = sourceMesh.skeleton.bones.map((bone) => cloneLookup.get(bone) || bone);
    node.bind(skel, sourceMesh.bindMatrix);
    node.frustumCulled = false;
  });
  return clone;
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
  const _m = new THREE.Matrix4();
  const _inv = new THREE.Matrix4();
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
 * @param {THREE.Object3D} root
 * @returns {number}
 */
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
 * Empty mount at 9 or 3. The skinned grip is parented here once the GLB arrives.
 * Local +Y runs up the rim. Local −Z faces the driver. The GLB's tube axis is +Y.
 * @param {number} side +1 left / −1 right
 * @param {number} rimR
 * @param {number} tubeR
 * @returns {THREE.Group}
 */
function makeMount(side, rimR, tubeR) {
  const mount = new THREE.Group();
  mount.name = side > 0 ? "hand-L" : "hand-R";
  const clock = side > 0 ? CLOCK_9_3 : Math.PI - CLOCK_9_3;
  mount.userData.clock = clock;
  mount.position.set(Math.cos(clock) * rimR, Math.sin(clock) * rimR, 0);
  mount.rotation.z = clock;
  // Fit comes from seatGrip once the GLB tip radius is known.
  mount.scale.setScalar(1);
  const wrist = new THREE.Object3D();
  wrist.name = "wrist-placeholder";
  wrist.position.set(0.01, -0.02, -tubeR - 0.05);
  mount.add(wrist);
  mount.userData.wrist = wrist;
  mount.userData.tris = 0;
  mount.userData.povDriver = true;
  return mount;
}

/**
 * Paint the skinned mesh and remember the wrist the sleeves track.
 * Finger bones stay in the baked grip. Names like Index_Proximal_L are the rig.
 * @param {THREE.Object3D} mount
 * @param {THREE.Object3D} rig
 * @param {number} tubeR
 */
function seatRig(mount, rig, tubeR) {
  rig.name = mount.name === "hand-L" ? "rig-L" : "rig-R";
  const side = mount.name === "hand-L" ? 1 : -1;
  seatGrip(rig, side, tubeR, mount.scale.x);
  rig.traverse((o) => {
    if (!o.isMesh) return;
    o.material = SKIN_MAT;
    o.castShadow = false;
    o.receiveShadow = false;
    o.frustumCulled = false;
    o.userData.povDriver = true;
  });
  mount.add(rig);
  const wrist = rig.getObjectByName("wrist");
  if (wrist) mount.userData.wrist = wrist;
  mount.userData.tris = countTris(mount);
  const proximal = rig.getObjectByName(side > 0 ? "Index_Proximal_L" : "Index_Proximal_R");
  mount.userData.gripBone = proximal ? proximal.name : "";
}

/**
 * Park the baked grip on the rim tube.
 *
 * Tip bones stick out past the flesh — seating on them floats the mesh off the
 * leather. Sample skinned verts in the curl plane (XZ, tube along +Y), scale
 * up to a readable adult hand, then curl fingers onto the leather.
 *
 * @param {THREE.Object3D} rig
 * @param {number} side +1 left / −1 right
 * @param {number} tubeR tube radius in steer-spin space
 * @param {number} _handScale unused (mount stays at 1; fit is on the rig)
 */
function seatGrip(rig, side, tubeR, _handScale) {
  // Knuckles / palm toward the driver (−Z). Fingers curl over the tube.
  rig.quaternion.identity();
  rig.position.set(0, 0, 0);
  rig.scale.setScalar(1);
  rig.updateMatrixWorld(true);

  let skin = null;
  rig.traverse((o) => {
    if (o.isSkinnedMesh && !skin) skin = o;
  });
  if (!skin || !skin.geometry) return;

  const pos = skin.geometry.attributes.position;
  if (!pos) return;
  // Sample real verts — AABB corners sit inside the C and fake contact.
  const step = Math.max(1, (pos.count / 800) | 0);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let n = 0;
  let rMin = Infinity;
  let nearX = 0;
  let nearZ = 0;
  for (let i = 0; i < pos.count; i += step) {
    _corner.fromBufferAttribute(pos, i);
    skin.localToWorld(_corner);
    rig.worldToLocal(_corner);
    cx += _corner.x;
    cy += _corner.y;
    cz += _corner.z;
    n += 1;
    const r = Math.hypot(_corner.x, _corner.z);
    if (r < rMin) {
      rMin = r;
      nearX = _corner.x;
      nearZ = _corner.z;
    }
  }
  if (n < 8 || !(rMin < Infinity) || rMin < 1e-4) return;
  cx /= n;
  cy /= n;
  cz /= n;

  // Fit the crook to the tube, then boost to an adult POV hand.
  const target = tubeR * 0.9;
  const baseFit = THREE.MathUtils.clamp(target / rMin, 0.4, 1.05);
  const fit = baseFit * HAND_DISPLAY;
  const radial = Math.hypot(nearX, nearZ) || Math.hypot(cx, cz) || 1;
  const dirX = nearX / radial;
  const dirZ = nearZ / radial;
  rig.scale.setScalar(fit);
  // Closest flesh on the leather; Y centered on the palm mass.
  const contact = target - fit * rMin;
  rig.position.set(dirX * contact, -cy * fit, dirZ * contact);
  // Squeeze so the rim sits in the finger crook — pads wrap, not hover.
  rig.position.x -= dirX * tubeR * HAND_PRESS;
  rig.position.z -= dirZ * tubeR * HAND_PRESS;
  curlFingers(rig, side);
  tuckThumb(rig, side);
  rig.updateMatrixWorld(true);
}

/**
 * Close the four fingers onto the far side of the rim.
 * Small local bends only — big curls tear MakeHuman weights.
 * @param {THREE.Object3D} rig
 * @param {number} side
 */
function curlFingers(rig, side) {
  const tag = side > 0 ? "L" : "R";
  const digits = ["Index", "Middle", "Ring", "Pinky"];
  // Stronger curl on pinky/ring; index stays a touch more open (natural wheel grip).
  const curl = [0.42, 0.5, 0.58, 0.64];
  const s = side > 0 ? 1 : -1;
  for (let i = 0; i < digits.length; i++) {
    const name = digits[i];
    const prox = rig.getObjectByName(`${name}_Proximal_${tag}`);
    const mid = rig.getObjectByName(`${name}_Intermediate_${tag}`);
    const dist = rig.getObjectByName(`${name}_Distal_${tag}`);
    const k = curl[i];
    if (prox) {
      prox.rotateX(k * 0.55);
      prox.rotateZ(s * k * 0.08);
    }
    if (mid) mid.rotateX(k * 0.72);
    if (dist) dist.rotateX(k * 0.55);
  }
}

/**
 * Oppose the thumb across the near rim face — closed 9/3 power grip.
 * Tiny local bends only; big curls tear the baked weights.
 * @param {THREE.Object3D} rig
 * @param {number} side
 */
function tuckThumb(rig, side) {
  const tag = side > 0 ? "L" : "R";
  const meta = rig.getObjectByName(`Thumb_Metacarpal_${tag}`);
  const prox = rig.getObjectByName(`Thumb_Proximal_${tag}`);
  const dist = rig.getObjectByName(`Thumb_Distal_${tag}`);
  if (!meta) return;
  if (side > 0) {
    meta.rotateY(-0.48);
    meta.rotateZ(0.38);
    meta.rotateX(0.22);
    if (prox) {
      prox.rotateZ(-0.28);
      prox.rotateX(0.2);
    }
    if (dist) dist.rotateZ(-0.22);
  } else {
    meta.rotateY(0.48);
    meta.rotateZ(-0.38);
    meta.rotateX(0.22);
    if (prox) {
      prox.rotateZ(0.28);
      prox.rotateX(0.2);
    }
    if (dist) dist.rotateZ(0.22);
  }
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
  const handL = makeMount(1, rimR, tubeR);
  const handR = makeMount(-1, rimR, tubeR);
  grips.add(handL, handR);

  const layer = hooks.POV_HUD_LAYER;
  const lamp = new THREE.PointLight(0xffe2c4, 1.15, 1.45, 1.45);
  lamp.name = "pov-hand-light";
  lamp.layers.set(layer);
  lamp.position.set(0, 0, 0.06);
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
      geo("deltoid-v2", () => new THREE.SphereGeometry(0.052, 12, 10))
    );
    deltoid.layers.set(layer);
    deltoid.renderOrder = 7;
    deltoid.scale.set(1.2, 0.88, 1.0);
    const upper = makeSleeveMesh(0.048, 0.036, "upper-v2");
    upper.layers.set(layer);
    upper.renderOrder = 7;
    const elbow = new THREE.Object3D();
    elbow.name = side > 0 ? "elbow-L" : "elbow-R";
    const lower = makeSleeveMesh(0.034, 0.026, "lower-v2");
    lower.layers.set(layer);
    lower.renderOrder = 7;
    const cuffRing = mesh(
      CUFF_MAT,
      geo("sleeve-cuff-v2", () => new THREE.TorusGeometry(0.028, 0.007, 8, 14))
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

  const driver = {
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
    trisL: 0,
    trisR: 0,
    upperLen: 0.32,
    foreLen: 0.27,
    _tmpA: new THREE.Vector3(),
    _tmpB: new THREE.Vector3(),
    _tmpC: new THREE.Vector3(),
    _tmpD: new THREE.Vector3(),
    _tmpE: new THREE.Vector3(),
    _tmpF: new THREE.Vector3(),
    _yAxis: new THREE.Vector3(0, 1, 0),
  };
  root.userData.povDriver = driver;

  grips.visible = !!root.userData._cockpitOn;
  shoulders.visible = !!root.userData._cockpitOn;

  loadHandGltfs()
    .then(([left, right]) => {
      if (root.userData.povDriver !== driver) return;
      seatRig(handL, cloneRig(left.scene), tubeR);
      seatRig(handR, cloneRig(right.scene), tubeR);
      driver.wristL = handL.userData.wrist;
      driver.wristR = handR.userData.wrist;
      driver.trisL = handL.userData.tris;
      driver.trisR = handR.userData.tris;
      hooks.markSteerPovLayer(grips);
    })
    .catch((err) => {
      console.warn("POV hand rig failed to load", err);
    });
}
