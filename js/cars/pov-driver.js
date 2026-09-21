/**
 * POV driver arms — UE5-cue racing gloves gripping the rim (Sprint realism).
 *
 * WHO THIS IS FOR: cockpit / POV camera only (layer 1 overlay).
 * WHAT IT DOES: articulated gloved hands (palm + fingers wrapping the rim) and
 *   two-bone suit sleeves from fixed shoulders. Shared geos/materials; POV-only
 *   cost so lock-30 stays honest.
 * HOW IT CONNECTS: celica.js attachPovDriverArms → cockpit-anim poses elbows.
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
      // Knuckle pad patches
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
  });
  GLOVE_MAT.userData.shared = true;
  GLOVE_ACCENT = new THREE.MeshStandardMaterial({
    color: 0x9a1c1c,
    roughness: 0.62,
    metalness: 0.08,
    envMapIntensity: 0.5,
    bumpMap: GLOVE_BUMP,
    bumpScale: 0.28,
  });
  GLOVE_ACCENT.userData.shared = true;
  SUIT_MAT = new THREE.MeshStandardMaterial({
    color: 0x141820,
    roughness: 0.9,
    metalness: 0.02,
    envMapIntensity: 0.35,
    bumpMap: GLOVE_BUMP,
    bumpScale: 0.18,
    side: THREE.DoubleSide,
  });
  SUIT_MAT.userData.shared = true;
  CUFF_MAT = new THREE.MeshStandardMaterial({
    color: 0x0a0c10,
    roughness: 0.7,
    metalness: 0.12,
    envMapIntensity: 0.4,
  });
  CUFF_MAT.userData.shared = true;
}

/**
 * Capsule along +Y, origin at base.
 * @param {number} r
 * @param {number} len
 * @param {string} key
 */
function capsuleAlongY(r, len, key) {
  return geo(key, () => {
    const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len - r * 2), 5, 10);
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
 * One finger: three phalanges curling around the rim tube.
 * @param {number} side +1 left / -1 right
 * @param {number} spread lateral offset on palm
 * @param {number} lenScale
 * @param {number} rimTube
 */
function makeFinger(side, spread, lenScale, rimTube) {
  const root = new THREE.Group();
  root.position.set(spread, 0.012, -0.01);
  const curl = 0.55 + rimTube * 8;
  const lens = [0.028 * lenScale, 0.024 * lenScale, 0.02 * lenScale];
  const radii = [0.0075, 0.007, 0.0062];
  let parent = root;
  for (let i = 0; i < 3; i++) {
    const joint = new THREE.Group();
    joint.rotation.x = (i === 0 ? 0.38 : 0.18) + curl * (0.5 + i * 0.32);
    joint.rotation.z = side * (0.05 - i * 0.015);
    joint.add(
      mesh(GLOVE_MAT, capsuleAlongY(radii[i], lens[i], `fin-${i}-${lenScale.toFixed(2)}`))
    );
    parent.add(joint);
    const tip = new THREE.Object3D();
    tip.position.y = lens[i] * 0.92;
    joint.add(tip);
    parent = tip;
  }
  return root;
}

/**
 * Opposable thumb wrapping the inner rim.
 * @param {number} side
 * @param {number} rimTube
 */
function makeThumb(side, rimTube) {
  const root = new THREE.Group();
  root.position.set(side * -0.022, 0.006, 0.018);
  root.rotation.z = side * 1.05;
  root.rotation.x = 0.55 + rimTube * 4;
  root.rotation.y = side * -0.35;
  const p1 = new THREE.Group();
  p1.add(mesh(GLOVE_MAT, capsuleAlongY(0.008, 0.03, "thumb1")));
  const p2 = new THREE.Group();
  p2.position.y = 0.028;
  p2.rotation.x = 0.7;
  p2.add(mesh(GLOVE_MAT, capsuleAlongY(0.007, 0.024, "thumb2")));
  p1.add(p2);
  root.add(p1);
  return root;
}

/**
 * Gloved hand gripping at 9/3 on the rim.
 * @param {number} side +1 = car +X (screen left / driver's left)
 * @param {number} rimR
 * @returns {THREE.Group}
 */
function makeHand(side, rimR) {
  ensureMats();
  const g = new THREE.Group();
  g.name = side > 0 ? "hand-L" : "hand-R";
  const rimTube = THREE.MathUtils.clamp(rimR * 0.11, 0.014, 0.022);
  // Sit on the outer rim; slight aft so fingers clear the dash side of the tube.
  g.position.set(side * rimR * 0.9, -rimR * 0.04, 0.008);
  g.rotation.z = side > 0 ? 0.22 : -0.22;
  g.rotation.x = 0.55;
  g.rotation.y = side * -0.12;

  const palmGeo = geo("palm", () => {
    const box = new THREE.BoxGeometry(0.058, 0.026, 0.078, 3, 2, 3);
    const pos = box.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      // Soften corners toward a mitten/palm read.
      const soft = 1 - Math.min(1, (Math.abs(x) / 0.029) * (Math.abs(z) / 0.039) * 0.22);
      pos.setXYZ(i, x * soft, y * (0.85 + soft * 0.15), z * soft);
    }
    box.computeVertexNormals();
    return box;
  });
  const palm = mesh(GLOVE_MAT, palmGeo);
  palm.position.set(0, 0, 0.01);
  g.add(palm);

  // Knuckle pad strip across the back of the hand.
  const pads = mesh(
    GLOVE_ACCENT,
    geo("pads", () => new THREE.BoxGeometry(0.05, 0.01, 0.028, 2, 1, 2))
  );
  pads.position.set(0, 0.014, -0.012);
  g.add(pads);

  const spreads = [-0.02, -0.007, 0.007, 0.02];
  const lens = [0.92, 1.02, 0.98, 0.88];
  for (let i = 0; i < 4; i++) {
    g.add(makeFinger(side, spreads[i] * side, lens[i], rimTube));
  }
  g.add(makeThumb(side, rimTube));

  // Glove cuff / wrist — sleeve meets here.
  const cuff = mesh(
    CUFF_MAT,
    geo("cuff", () => {
      const c = new THREE.CylinderGeometry(0.022, 0.026, 0.038, 12, 1, true);
      c.translate(0, -0.01, 0);
      return c;
    })
  );
  cuff.position.set(0, -0.002, -0.048);
  cuff.rotation.x = Math.PI * 0.5;
  g.add(cuff);

  const wrist = new THREE.Object3D();
  wrist.name = "wrist";
  wrist.position.set(0, 0, -0.055);
  g.add(wrist);
  g.userData.wrist = wrist;
  return g;
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
      const c = new THREE.CylinderGeometry(r0, r1, 1, 12, 1, true);
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

  let rimR = 0.155;
  try {
    const box = new THREE.Box3().setFromObject(spin);
    if (!box.isEmpty()) {
      const s = box.getSize(new THREE.Vector3());
      rimR = THREE.MathUtils.clamp(Math.max(s.x, s.y) * 0.42, 0.12, 0.2);
    }
  } catch {
    /* default */
  }

  const grips = new THREE.Group();
  grips.name = "pov-driver-grips";
  grips.userData.povDriver = true;
  const handL = makeHand(1, rimR);
  const handR = makeHand(-1, rimR);
  grips.add(handL, handR);
  spin.add(grips);
  hooks.markSteerPovLayer(grips);

  const shoulders = new THREE.Group();
  shoulders.name = "pov-driver-shoulders";
  shoulders.userData.povDriver = true;
  const shY = rig.eyeY - 0.3;
  const shZ = Math.min(rig.eyeZ + 0.02, (root.userData.povWheelZ || rig.eyeZ + 0.35) - 0.2);
  const shL = new THREE.Object3D();
  shL.name = "shoulder-L";
  shL.position.set(rig.eyeX + 0.22, shY, shZ - 0.02);
  const shR = new THREE.Object3D();
  shR.name = "shoulder-R";
  shR.position.set(rig.eyeX - 0.14, shY, shZ - 0.02);
  shoulders.add(shL, shR);

  const layer = hooks.POV_HUD_LAYER;
  function armChain(side) {
    const upper = makeSleeveMesh(0.038, 0.032, "upper");
    upper.layers.set(layer);
    upper.renderOrder = 7;
    const elbow = new THREE.Object3D();
    elbow.name = side > 0 ? "elbow-L" : "elbow-R";
    const lower = makeSleeveMesh(0.03, 0.024, "lower");
    lower.layers.set(layer);
    lower.renderOrder = 7;
    const cuffRing = mesh(
      CUFF_MAT,
      geo("sleeve-cuff", () => {
        const c = new THREE.TorusGeometry(0.025, 0.006, 8, 14);
        return c;
      })
    );
    cuffRing.rotation.x = Math.PI * 0.5;
    cuffRing.position.y = 0.98;
    lower.add(cuffRing);
    return { upper, elbow, lower };
  }

  const armL = armChain(1);
  const armR = armChain(-1);
  shL.add(armL.upper);
  shR.add(armR.upper);
  // Elbow + forearm live in cabin space (reposed each frame).
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
    _tmpA: new THREE.Vector3(),
    _tmpB: new THREE.Vector3(),
    _tmpC: new THREE.Vector3(),
    _tmpD: new THREE.Vector3(),
    _yAxis: new THREE.Vector3(0, 1, 0),
  };

  grips.visible = !!root.userData._cockpitOn;
  shoulders.visible = !!root.userData._cockpitOn;
}
