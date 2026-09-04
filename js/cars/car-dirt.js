/**
 * Player-car dirt — cheap surface × slip × speed accumulation (Visual Pass V2).
 *
 * WHO THIS IS FOR: hero car double-take (chase / start-line close-up).
 * WHAT IT DOES: accumulates a 0..1 dirt amount from mud/sand/dirt/gravel and
 *   lateral runoff, then modulates paint/rubber roughness, clearcoat, tint.
 * HOW IT CONNECTS: createPlayerCar → bindCarDirt; game.js _syncPlayerMesh →
 *   updateCarDirt each frame. AI pack never calls this.
 *
 * No extra textures — modulates existing PBR fields only.
 */

import * as THREE from "../../vendor/three.module.js";

/** @type {THREE.Color} */
const _dirtTint = new THREE.Color(0x6a5340);
/** @type {THREE.Color} */
const _mudTint = new THREE.Color(0x3d2e22);
/** @type {THREE.Color} */
const _scratch = new THREE.Color();

/** Soil rate multipliers by surface id (negative = wash). */
const SURFACE_SOIL = {
  mud: 0.55,
  sand: 0.32,
  dirt: 0.28,
  gravel: 0.18,
  grass: 0.14,
  cobble: -0.04,
  tarmac: -0.12,
  asphalt: -0.12,
  wet: -0.06,
};

/**
 * Snapshot paint/rubber bases and mark materials for live dirt modulation.
 * Call once after race clearcoat dress — materials are already instance clones.
 * @param {THREE.Object3D} root
 */
export function bindCarDirt(root) {
  if (!root || root.userData.dirtBound) return;
  const paints = [];
  const rubbers = [];
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    if (obj.userData && (obj.userData.brake || obj.userData.head || obj.userData.hud)) return;
    const list = [].concat(obj.material);
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      if (!m || !m.color) continue;
      if (m.userData && (m.userData.hud || m.userData.povHud || m.userData.shared)) continue;
      const kind = m.userData && m.userData.kind;
      const n = `${m.name || ""} ${obj.name || ""}`.toLowerCase();
      const isGlass =
        kind === "glass" || !!(m.transparent && (m.opacity == null || m.opacity < 0.9));
      const isChrome =
        kind === "chrome" ||
        (/chrome|steel|alum|rim|metal|mirror|grille|exhaust/.test(n) && (m.metalness || 0) > 0.55);
      const isRubber =
        kind === "rubber" || (/tire|tyre|rubber/.test(n) && !/rim/.test(n));
      if (isGlass || isChrome) continue;
      if (!m.userData._dirtBase) {
        m.userData._dirtBase = {
          color: m.color.clone(),
          roughness: m.roughness != null ? m.roughness : 0.45,
          metalness: m.metalness != null ? m.metalness : 0.1,
          envMapIntensity: m.envMapIntensity != null ? m.envMapIntensity : 0.55,
          clearcoat: m.clearcoat != null ? m.clearcoat : 0,
          clearcoatRoughness: m.clearcoatRoughness != null ? m.clearcoatRoughness : 0.1,
          clearcoatEnv: m.clearcoatEnvMapIntensity != null ? m.clearcoatEnvMapIntensity : 1,
        };
      }
      if (isRubber) rubbers.push(m);
      else paints.push(m);
    }
  });
  root.userData.dirtBound = true;
  root.userData.dirt = {
    amount: 0.04,
    paints,
    rubbers,
    mudBias: 0,
  };
}

/**
 * Advance dirt and push material response. Cheap — no alloc in steady state.
 * @param {THREE.Object3D} root
 * @param {{
 *   surfaceId?: string,
 *   slip?: number,
 *   slidePct?: number,
 *   speedKmh?: number,
 *   offRoad?: boolean,
 *   dt?: number,
 * }} state
 */
export function updateCarDirt(root, state) {
  const bag = root && root.userData && root.userData.dirt;
  if (!bag || !bag.paints) return;
  const dt = Math.max(0.001, Math.min(0.05, state.dt != null ? state.dt : 1 / 60));
  const sid = state.surfaceId || "dirt";
  const soil = SURFACE_SOIL[sid] != null ? SURFACE_SOIL[sid] : 0.08;
  const slip = Math.max(0, Math.min(1, state.slip != null ? state.slip : 0));
  const slide = Math.max(0, Math.min(1, state.slidePct != null ? state.slidePct : 0));
  const speed = Math.max(0, state.speedKmh != null ? state.speedKmh : 0);
  const speedFac = 0.35 + Math.min(1, speed / 95) * 0.65;
  const agit = 0.28 + slip * 0.55 + slide * 0.35;
  let delta = soil * agit * speedFac * dt;
  if (state.offRoad) delta += 0.22 * agit * speedFac * dt;
  if (soil < 0) {
    // Wash on hard surfaces — faster when wet/clean and moving.
    delta = soil * (0.55 + Math.min(1, speed / 120) * 0.45) * dt;
  }
  bag.amount = Math.max(0, Math.min(1, bag.amount + delta));
  if (sid === "mud") bag.mudBias = Math.min(1, bag.mudBias + 0.35 * dt);
  else bag.mudBias = Math.max(0, bag.mudBias - 0.12 * dt);

  const d = bag.amount;
  const mud = bag.mudBias;
  _scratch.copy(_dirtTint).lerp(_mudTint, mud * 0.85);

  const paints = bag.paints;
  for (let i = 0; i < paints.length; i++) {
    applyDirtToPaint(paints[i], d, mud, _scratch);
  }
  const rubbers = bag.rubbers;
  for (let i = 0; i < rubbers.length; i++) {
    applyDirtToRubber(rubbers[i], d);
  }
}

/**
 * @param {THREE.Material} m
 * @param {number} d 0..1
 * @param {number} mud 0..1
 * @param {THREE.Color} tint
 */
function applyDirtToPaint(m, d, mud, tint) {
  const b = m.userData._dirtBase;
  if (!b) return;
  const mix = d * (0.62 + mud * 0.28);
  m.color.copy(b.color).lerp(tint, mix);
  m.roughness = Math.min(0.94, b.roughness + d * 0.55 + mud * 0.14);
  m.metalness = Math.max(0.02, b.metalness * (1 - d * 0.65));
  m.envMapIntensity = Math.max(0.08, b.envMapIntensity * (1 - d * 0.72));
  if (m.isMeshPhysicalMaterial) {
    m.clearcoat = Math.max(0.08, b.clearcoat * (1 - d * 0.82));
    m.clearcoatRoughness = Math.min(0.62, b.clearcoatRoughness + d * 0.5 + mud * 0.1);
    m.clearcoatEnvMapIntensity = Math.max(0.18, b.clearcoatEnv * (1 - d * 0.65));
  }
}

/**
 * @param {THREE.Material} m
 * @param {number} d
 */
function applyDirtToRubber(m, d) {
  const b = m.userData._dirtBase;
  if (!b) return;
  m.color.copy(b.color).lerp(_dirtTint, d * 0.28);
  m.roughness = Math.min(0.98, b.roughness + d * 0.18);
  m.envMapIntensity = Math.max(0.05, b.envMapIntensity * (1 - d * 0.4));
}

/**
 * Reset accumulation (new stage / restart).
 * @param {THREE.Object3D} root
 * @param {number} [amount]
 */
export function resetCarDirt(root, amount = 0.04) {
  const bag = root && root.userData && root.userData.dirt;
  if (!bag) return;
  bag.amount = amount;
  bag.mudBias = 0;
  updateCarDirt(root, { surfaceId: "tarmac", slip: 0, slidePct: 0, speedKmh: 0, dt: 0.016 });
}
