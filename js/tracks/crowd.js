/**
 * Animated trackside crowd — HD textured biped GLBs with cheer arm motion.
 *
 * WHO THIS IS FOR: Desert, Lakeside, and sparse Forest gallery sections.
 * WHAT IT DOES: instances character-*.glb bipeds from the prop kit with a
 *   shared skin/clothing atlas; per-instance warm tints; splits arms for
 *   wave/clap/overhead cheer as the car passes; body bob, lean, and knee
 *   squash sell a low-poly but human read.
 * HOW IT CONNECTS: Track._addSpectators() builds a CrowdField; Track.update()
 *   and RallyAudio consume crowd points for Doppler beds.
 *
 * Sprint 38 realism: richer cheer cycles, skin/clothing variety, shadows on
 * near gallery rows, and torso lean toward the racing line.
 */

import * as THREE from "../../vendor/three.module.js";
import { propCharacterParts } from "./prop-kit.js?v=24";

/** Authored biped spectators — assets/props/character-*.glb */
export const CROWD_CHARACTER_KINDS = Object.freeze([
  "character-male-a",
  "character-male-b",
  "character-male-c",
  "character-male-d",
  "character-male-e",
  "character-male-f",
  "character-female-a",
  "character-female-b",
  "character-female-c",
  "character-female-d",
  "character-female-e",
  "character-female-f",
]);

/** Per-instance spectator tints — warm skin + rally shirt reads on the atlas. */
const CROWD_TINTS = Object.freeze([
  0xf2c8a8, 0xe8b898, 0xd8a880, 0xc89870, 0xb88860,
  0xffd8b8, 0xf0c0a0, 0xe0b090,
  0xf0e8e0, 0xe8dcc8, 0xd8ccb8,
  0xe85040, 0x3068c8, 0x208848, 0xf0c030, 0x802040,
]);

/** Shared crowd atlas (skin + clothes). Loaded once. */
let CROWD_MAP = null;

/**
 * Prefer HD crowd atlas; fall back to colormap.png for older caches.
 * @returns {THREE.Texture|null}
 */
function crowdColormap() {
  if (CROWD_MAP) return CROWD_MAP;
  try {
    const loader = new THREE.TextureLoader();
    const tex = loader.load("assets/props/Textures/hd/crowd_atlas.png", undefined, undefined, () => {
      const fallback = loader.load("assets/props/Textures/colormap.png");
      fallback.colorSpace = THREE.SRGBColorSpace;
      fallback.flipY = false;
      fallback.anisotropy = 12;
      CROWD_MAP = fallback;
    });
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = false;
    tex.anisotropy = 16;
    tex.generateMipmaps = true;
    CROWD_MAP = tex;
  } catch {
    CROWD_MAP = null;
  }
  return CROWD_MAP;
}

/**
 * @returns {THREE.MeshStandardMaterial}
 */
function crowdMaterial() {
  const map = crowdColormap();
  return new THREE.MeshStandardMaterial({
    map: map || null,
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.02,
    envMapIntensity: 0.48,
    flatShading: false,
    vertexColors: false,
    fog: true,
  });
}

/**
 * Character GLBs currently cached by the prop kit (may be empty before load).
 * @returns {string[]}
 */
export function availableCrowdKinds() {
  return CROWD_CHARACTER_KINDS.filter((k) => !!propCharacterParts(k));
}

/**
 * Cheer style from pose phase — clap, wave, or overhead pump.
 * @param {number} phase
 * @returns {0|1|2}
 */
function cheerStyle(phase) {
  const bucket = ((phase * 0.37) % 1 + 1) % 1;
  if (bucket < 0.34) return 0;
  if (bucket < 0.68) return 1;
  return 2;
}

/**
 * One stage crowd: instanced textured bipeds with cheer motion.
 * Requires prop-kit character GLBs — does not build primitive humans.
 */
export class CrowdField {
  /**
   * @param {THREE.Group} group track root
   * @param {Array<{x:number,y:number,z:number,ry:number,s?:number,c?:number,phase?:number,kind?:string,tint?:number}>} poses
   * @param {(mesh:THREE.Object3D, chunk:number)=>void} registerChunk
   */
  constructor(group, poses, registerChunk) {
    this.poses = poses.slice();
    this._dummy = new THREE.Object3D();
    /** @type {THREE.InstancedMesh[]} */
    this._bodies = [];
    /** @type {THREE.InstancedMesh[]} */
    this._armsL = [];
    /** @type {THREE.InstancedMesh[]} */
    this._armsR = [];
    /** @type {Array<{shoulderL:{x:number,y:number,z:number}, shoulderR:{x:number,y:number,z:number}}>} */
    this._rig = [];
    this.points = poses.map((p) => ({ x: p.x, y: p.y + 1.25, z: p.z }));

    if (!poses.length) return;

    const kinds = availableCrowdKinds();
    if (!kinds.length) {
      console.warn("[crowd] no character GLBs — crowd skipped (no primitive fallback)");
      return;
    }

    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      if (!p.kind || !propCharacterParts(p.kind)) {
        p.kind = kinds[i % kinds.length];
      }
      if (p.tint == null) p.tint = CROWD_TINTS[i % CROWD_TINTS.length];
    }

    const bodyMat = crowdMaterial();

    /** @type {Map<string, typeof poses>} */
    const byKey = new Map();
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const c = p.c != null ? p.c : 0;
      const kind = p.kind || kinds[0];
      const key = `${c}|${kind}`;
      let list = byKey.get(key);
      if (!list) {
        list = [];
        byKey.set(key, list);
      }
      list.push(p);
    }

    for (const [key, list] of byKey) {
      const bar = key.indexOf("|");
      const chunk = Number(key.slice(0, bar));
      const kind = key.slice(bar + 1);
      const parts = propCharacterParts(kind);
      if (!parts || !parts.body) continue;

      const body = new THREE.InstancedMesh(parts.body, bodyMat, list.length);
      body.castShadow = true;
      body.receiveShadow = true;
      body.userData.crowd = true;
      body.userData.crowdPoses = list;
      body.userData.crowdGlb = true;
      body.userData.crowdKind = kind;

      let armL = null;
      let armR = null;
      if (parts.armL) {
        armL = new THREE.InstancedMesh(parts.armL, bodyMat, list.length);
        armL.castShadow = true;
        armL.receiveShadow = true;
        armL.userData.crowd = true;
        armL.userData.crowdPoses = list;
      }
      if (parts.armR) {
        armR = new THREE.InstancedMesh(parts.armR, bodyMat, list.length);
        armR.castShadow = true;
        armR.receiveShadow = true;
        armR.userData.crowd = true;
        armR.userData.crowdPoses = list;
      }

      const tintCol = new THREE.Color();
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p.phase) p.phase = (i * 0.73 + (p.x || 0) * 0.11) % (Math.PI * 2);
        tintCol.setHex(p.tint != null ? p.tint : 0xffffff);
        body.setColorAt(i, tintCol);
        if (armL) armL.setColorAt(i, tintCol);
        if (armR) armR.setColorAt(i, tintCol);
        this._writeBody(body, i, p, 0, 0, 0, 0, 0);
        if (armL) this._writeArm(armL, i, p, -1, parts.shoulderL, 0, 0, 0, 0, 0);
        if (armR) this._writeArm(armR, i, p, 1, parts.shoulderR, 0, 0, 0, 0, 0);
      }
      body.instanceMatrix.needsUpdate = true;
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
      if (armL) {
        armL.instanceMatrix.needsUpdate = true;
        if (armL.instanceColor) armL.instanceColor.needsUpdate = true;
      }
      if (armR) {
        armR.instanceMatrix.needsUpdate = true;
        if (armR.instanceColor) armR.instanceColor.needsUpdate = true;
      }

      registerChunk(body, chunk);
      group.add(body);
      this._bodies.push(body);
      if (armL) {
        registerChunk(armL, chunk);
        group.add(armL);
      }
      if (armR) {
        registerChunk(armR, chunk);
        group.add(armR);
      }
      this._armsL.push(armL);
      this._armsR.push(armR);
      this._rig.push({ shoulderL: parts.shoulderL, shoulderR: parts.shoulderR });
    }
  }

  /**
   * @param {THREE.InstancedMesh} mesh
   * @param {number} i
   * @param {object} p
   * @param {number} bob
   * @param {number} sway
   * @param {number} cheer
   * @param {number} timeSec
   * @param {number} leanToward
   */
  _writeBody(mesh, i, p, bob, sway, cheer, timeSec, leanToward) {
    const d = this._dummy;
    const s = p.s || 1;
    const style = cheerStyle(p.phase || 0);
    const jump = cheer > 0.55 ? Math.max(0, Math.sin(timeSec * 7.2 + (p.phase || 0)) * (cheer - 0.45)) * 0.14 : 0;
    const lean = cheer * 0.22 + leanToward * 0.12;
    const hop = bob * 0.1 + cheer * 0.08 + jump;
    const knee = cheer > 0.35 ? 0.97 - cheer * 0.06 : 1;
    d.position.set(p.x, p.y + hop, p.z);
    d.rotation.order = "YXZ";
    d.rotation.set(
      sway * 0.07 - lean + leanToward * 0.08,
      p.ry || 0,
      sway * 0.05 + leanToward * 0.04
    );
    const pulse = 1 + bob * 0.025 + cheer * 0.03;
    d.scale.set(s * pulse, s * (knee + bob * 0.04 + cheer * 0.05), s * pulse);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }

  /**
   * @param {THREE.InstancedMesh} mesh
   * @param {number} i
   * @param {object} p
   * @param {-1|1} side
   * @param {{x:number,y:number,z:number}} shoulder
   * @param {number} bob
   * @param {number} sway
   * @param {number} cheer
   * @param {number} timeSec
   * @param {number} style
   */
  _writeArm(mesh, i, p, side, shoulder, bob, sway, cheer, timeSec, style) {
    const d = this._dummy;
    const s = p.s || 1;
    const ry = p.ry || 0;
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    const lx = shoulder.x * s;
    const ly = shoulder.y * s;
    const lz = shoulder.z * s;
    const hop = bob * 0.1 + cheer * 0.08;
    const wx = p.x + lx * cos - lz * sin;
    const wz = p.z + lx * sin + lz * cos;
    const wy = p.y + ly * s + hop;

    const phase = p.phase || 0;
    const clap = Math.sin(timeSec * 9.2 + phase * 1.9) * cheer * 0.48;
    const wave = Math.sin(timeSec * 4.6 + phase * 0.8) * 0.35;
    const rest = -0.52;
    let raise = rest;
    let roll = sway * 0.06 * side;
    let yawOff = 0;

    if (style === 0) {
      raise = rest + cheer * 2.95 + clap;
      roll += side * cheer * 0.18;
    } else if (style === 1) {
      const waveSide = side > 0 ? 1 : 0.35;
      raise = rest + cheer * (side > 0 ? 3.35 : 1.4) * waveSide + wave * cheer;
      yawOff = side * cheer * 0.22;
    } else {
      raise = rest + cheer * 3.25 + Math.abs(clap) * 0.35;
      roll += side * 0.12;
    }

    d.position.set(wx, wy, wz);
    d.rotation.order = "YXZ";
    d.rotation.set(raise + clap * 0.35, ry + yawOff, roll);
    d.scale.set(s, s, s);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
  }

  /**
   * Drive clap / cheer from race time and how close the car is.
   * @param {number} timeSec
   * @param {THREE.Vector3} playerPos
   * @param {number} playerSpeed
   */
  update(timeSec, playerPos, playerSpeed) {
    if (!this._bodies.length || !playerPos) return;

    for (let b = 0; b < this._bodies.length; b++) {
      const body = this._bodies[b];
      const armL = this._armsL[b];
      const armR = this._armsR[b];
      const rig = this._rig[b];
      const list = body.userData.crowdPoses;
      if (!list || !body.visible) continue;

      let anyNear = false;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const dx = p.x - playerPos.x;
        const dz = p.z - playerPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 95) continue;
        anyNear = true;
        const prox = dist < 68 ? 1 - dist / 68 : 0;
        const nearBoost = Math.min(1, Math.max(0, (playerSpeed - 4) / 32));
        const phase = p.phase || 0;
        const cheerWave = 0.55 + 0.45 * Math.sin(timeSec * 4.2 + phase * 1.4);
        const idleWave = 0.28 + 0.22 * Math.sin(timeSec * 1.6 + phase);
        const cheer = (cheerWave * prox + idleWave * 0.42) * (0.5 + nearBoost * 0.5);
        const bob = Math.sin(timeSec * 7.4 + phase) * (0.25 + cheer * 0.95);
        const sway = Math.sin(timeSec * 2.6 + phase) * (0.14 + prox * 0.45);
        const leanToward = prox * nearBoost * 0.65;
        const style = cheerStyle(phase);
        this._writeBody(body, i, p, bob, sway, cheer, timeSec, leanToward);
        if (armL && rig) this._writeArm(armL, i, p, -1, rig.shoulderL, bob, sway, cheer, timeSec, style);
        if (armR && rig) this._writeArm(armR, i, p, 1, rig.shoulderR, bob, sway, cheer, timeSec, style);
      }
      if (anyNear) {
        body.instanceMatrix.needsUpdate = true;
        if (armL) armL.instanceMatrix.needsUpdate = true;
        if (armR) armR.instanceMatrix.needsUpdate = true;
      }
    }
  }

  dispose() {
    const all = [...this._bodies, ...this._armsL.filter(Boolean), ...this._armsR.filter(Boolean)];
    for (const m of all) {
      if (m.parent) m.parent.remove(m);
      m.dispose?.();
    }
    this._bodies.length = 0;
    this._armsL.length = 0;
    this._armsR.length = 0;
    this._rig.length = 0;
    this.poses.length = 0;
    this.points.length = 0;
  }
}
