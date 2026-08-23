/**
 * Animated trackside crowd — HD textured biped GLBs with cheer arm motion.
 *
 * WHO THIS IS FOR: Desert, Lakeside, and sparse Forest gallery sections.
 * WHAT IT DOES: instances character-*.glb bipeds from the prop kit with a
 *   shared skin/clothing atlas; splits arms for raised clap/cheer as the car
 *   passes; drives body bob + lean from race time and proximity.
 * HOW IT CONNECTS: Track._addSpectators() builds a CrowdField; Track.update()
 *   and RallyAudio consume crowd points for Doppler beds.
 */

import * as THREE from "../../vendor/three.module.js";
import { propCharacterParts } from "./prop-kit.js?v=16";

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
    tex.anisotropy = 12;
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
    roughness: 0.72,
    metalness: 0.04,
    envMapIntensity: 0.42,
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
 * One stage crowd: instanced textured bipeds with cheer motion.
 * Requires prop-kit character GLBs — does not build primitive humans.
 */
export class CrowdField {
  /**
   * @param {THREE.Group} group track root
   * @param {Array<{x:number,y:number,z:number,ry:number,s?:number,c?:number,phase?:number,kind?:string}>} poses
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
      body.castShadow = false;
      body.receiveShadow = false;
      body.userData.crowd = true;
      body.userData.crowdPoses = list;
      body.userData.crowdGlb = true;
      body.userData.crowdKind = kind;

      let armL = null;
      let armR = null;
      if (parts.armL) {
        armL = new THREE.InstancedMesh(parts.armL, bodyMat, list.length);
        armL.castShadow = false;
        armL.userData.crowd = true;
        armL.userData.crowdPoses = list;
      }
      if (parts.armR) {
        armR = new THREE.InstancedMesh(parts.armR, bodyMat, list.length);
        armR.castShadow = false;
        armR.userData.crowd = true;
        armR.userData.crowdPoses = list;
      }

      const tint = new THREE.Color(1, 1, 1);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (!p.phase) p.phase = (i * 0.73 + (p.x || 0) * 0.11) % (Math.PI * 2);
        body.setColorAt(i, tint);
        this._writeBody(body, i, p, 0, 0, 0, 0);
        if (armL) this._writeArm(armL, i, p, -1, parts.shoulderL, 0, 0, 0, 0);
        if (armR) this._writeArm(armR, i, p, 1, parts.shoulderR, 0, 0, 0, 0);
      }
      body.instanceMatrix.needsUpdate = true;
      if (body.instanceColor) body.instanceColor.needsUpdate = true;
      if (armL) armL.instanceMatrix.needsUpdate = true;
      if (armR) armR.instanceMatrix.needsUpdate = true;

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
   */
  _writeBody(mesh, i, p, bob, sway, cheer, timeSec) {
    const d = this._dummy;
    const s = p.s || 1;
    const lean = cheer * 0.18;
    const hop = bob * 0.08 + cheer * 0.06;
    d.position.set(p.x, p.y + hop, p.z);
    d.rotation.set(sway * 0.06 - lean, p.ry || 0, sway * 0.04);
    const pulse = 1 + bob * 0.02 + cheer * 0.025;
    d.scale.set(s * pulse, s * (1 + bob * 0.03 + cheer * 0.04), s * pulse);
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
   */
  _writeArm(mesh, i, p, side, shoulder, bob, sway, cheer, timeSec) {
    const d = this._dummy;
    const s = p.s || 1;
    const ry = p.ry || 0;
    const cos = Math.cos(ry);
    const sin = Math.sin(ry);
    const lx = shoulder.x * s;
    const ly = shoulder.y * s;
    const lz = shoulder.z * s;
    const hop = bob * 0.08 + cheer * 0.06;
    const wx = p.x + lx * cos - lz * sin;
    const wz = p.z + lx * sin + lz * cos;
    const wy = p.y + ly * s + hop;

    const phase = p.phase || 0;
    const clap = Math.sin(timeSec * 8.5 + phase * 1.7) * cheer * 0.42;
    const rest = -0.55;
    const raise = rest + cheer * 2.85;

    d.position.set(wx, wy, wz);
    d.rotation.order = "YXZ";
    d.rotation.set(raise + clap, ry, sway * 0.05 * side);
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
    this._animSkip = (this._animSkip || 0) + 1;
    if (this._animSkip % 2 !== 0) return;
    const nearBoost = Math.min(1, Math.max(0, (playerSpeed - 6) / 36));

    for (let b = 0; b < this._bodies.length; b++) {
      const body = this._bodies[b];
      const armL = this._armsL[b];
      const armR = this._armsR[b];
      const rig = this._rig[b];
      const list = body.userData.crowdPoses;
      if (!list || !body.visible) continue;

      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const dx = p.x - playerPos.x;
        const dz = p.z - playerPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > 85) continue;
        const prox = dist < 62 ? 1 - dist / 62 : 0;
        const phase = p.phase || 0;
        const cheerWave = 0.5 + 0.5 * Math.sin(timeSec * 3.6 + phase * 1.3);
        const idleWave = 0.25 + 0.25 * Math.sin(timeSec * 1.4 + phase);
        const cheer = (cheerWave * prox + idleWave * 0.35) * (0.45 + nearBoost * 0.55);
        const bob = Math.sin(timeSec * 6.8 + phase) * (0.2 + cheer * 0.85);
        const sway = Math.sin(timeSec * 2.3 + phase) * (0.12 + prox * 0.4);
        this._writeBody(body, i, p, bob, sway, cheer, timeSec);
        if (armL && rig) this._writeArm(armL, i, p, -1, rig.shoulderL, bob, sway, cheer, timeSec);
        if (armR && rig) this._writeArm(armR, i, p, 1, rig.shoulderR, bob, sway, cheer, timeSec);
      }
      body.instanceMatrix.needsUpdate = true;
      if (armL) armL.instanceMatrix.needsUpdate = true;
      if (armR) armR.instanceMatrix.needsUpdate = true;
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
