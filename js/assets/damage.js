/**
 * Vehicle damage — disabled.
 *
 * WHO THIS IS FOR: leftover DCC hooks. Body dents / paint wear are off.
 * WHAT IT DOES: impact APIs no-op. Sparks and bump audio live in game.js.
 * HOW IT CONNECTS: not imported by the race loop.
 */

/** Visual tiers — maps damage 0..1 to shader state. */
export const DAMAGE_TIERS = [
  { roughness: 0.38, metalness: 0.12, colorMul: 1.0, scratch: 0 },
  { roughness: 0.5, metalness: 0.09, colorMul: 0.92, scratch: 0.18 },
  { roughness: 0.62, metalness: 0.07, colorMul: 0.82, scratch: 0.38 },
  { roughness: 0.78, metalness: 0.05, colorMul: 0.7, scratch: 0.62 },
];

const MAX_DENTS = 6;
const BODY_SKIP = /wheel|tire|tyre|rim|glass|windscreen|window|brake|disc|caliper|interior|seat|steer/;
const LAMP = /light|lamp|head|tail|indicator|emissive/;

/**
 * Minimum gap between geometry rebuilds, in ms.
 *
 * WHY THIS EXISTS: collide.js re-stamps hitWall on every physics substep, so a
 * wall scrape called applyImpactDamage several times per rendered frame. Each
 * call re-uploaded every body position buffer and recomputed vertex normals —
 * measured at 44 ms frames and climbing during a sustained rub. One dent per
 * contact beat is all the player can see anyway.
 */
const DENT_COOLDOWN_MS = 220;

/** @returns {number} monotonic ms, falling back where performance is absent. */
function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

/**
 * @param {number} damage 0..1
 * @returns {number} tier index 0..3
 */
export function damageTier(damage) {
  return Math.min(3, Math.floor(Math.max(0, damage) * 4));
}

/**
 * Accumulate damage from a wall glance or rival bump.
 * @param {number} current 0..1
 * @param {number} hitMag from collide.js hitWall / hitCar
 * @returns {number}
 */
export function accumulateDamage(current, hitMag) {
  if (!(hitMag > 0.25)) return current;
  const add = Math.min(0.14, hitMag * 0.04);
  return Math.min(1, (current || 0) + add);
}

/**
 * Apply a single impact: paint tier + a dent on the hit face.
 *
 * Safe to call every physics substep — the geometry rebuild is rate-limited to
 * one pass per DENT_COOLDOWN_MS. Paint tier still updates immediately, because
 * that path is a no-op unless the tier index actually moved.
 *
 * @param {import("../../vendor/three.module.js").Object3D} root
 * @param {{damage:number, hitMag:number, yaw:number, nx:number, nz:number}} hit
 * @returns {boolean} true when the shell geometry was rebuilt this call
 */
export function applyImpactDamage(root, hit) {
  void root;
  void hit;
  return false;
}

/**
 * Apply tier visuals to body meshes on a car root.
 * @param {import("../../vendor/three.module.js").Object3D} root
 * @param {number} damage 0..1
 */
export function applyDamageVisuals(root, damage) {
  void root;
  void damage;
}

/**
 * Reset damage visuals to pristine (new race / garage).
 * @param {import("../../vendor/three.module.js").Object3D} root
 */
export function resetDamageVisuals(root) {
  if (!root) return;
  root.userData.dents = [];
  root.userData.damagePaintTier = -1;
  root.userData.dentAt = 0;
  root.userData.dentPending = 0;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      const base = m.userData?.damageBase;
      if (!base) continue;
      m.roughness = base.roughness;
      m.metalness = base.metalness;
      if (base.color && m.color) m.color.copy(base.color);
      if (base.emissive && m.emissive) m.emissive.copy(base.emissive);
      if (base.emissiveIntensity != null) m.emissiveIntensity = base.emissiveIntensity;
    }
    const orig = obj.geometry && obj.geometry.userData && obj.geometry.userData.damageOrig;
    if (orig && obj.geometry.attributes.position) {
      obj.geometry.attributes.position.array.set(orig);
      obj.geometry.attributes.position.needsUpdate = true;
      obj.geometry.computeVertexNormals();
    }
    if (obj.userData.damageHiddenLamp) {
      obj.visible = true;
      obj.userData.damageHiddenLamp = false;
    }
  });
}

/**
 * Clone shared materials so wear does not tint the whole garage pack.
 * @param {import("../../vendor/three.module.js").Mesh} mesh
 * @returns {import("../../vendor/three.module.js").Material[]}
 */
function ownMaterials(mesh) {
  const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  let changed = false;
  const out = src.map((m) => {
    if (!m) return m;
    if (m.userData.damageOwned) return m;
    const c = m.clone();
    c.userData.damageOwned = true;
    c.userData.damageBase = {
      roughness: c.roughness ?? 0.4,
      metalness: c.metalness ?? 0.1,
      color: c.color ? c.color.clone() : null,
      emissive: c.emissive ? c.emissive.clone() : null,
      emissiveIntensity: c.emissiveIntensity,
    };
    changed = true;
    return c;
  });
  if (changed) mesh.material = Array.isArray(mesh.material) ? out : out[0];
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/**
 * @param {import("../../vendor/three.module.js").Object3D} root
 */
function rebuildDents(root) {
  const dents = root.userData.dents || [];
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry || !obj.geometry.attributes.position) return;
    const name = (obj.name || "").toLowerCase();
    if (BODY_SKIP.test(name) || LAMP.test(name)) return;
    if (obj.geometry.attributes.position.count > 28000) return;
    const geo = ensureOrigGeo(obj);
    const pos = geo.attributes.position;
    const orig = geo.userData.damageOrig;
    const arr = pos.array;
    arr.set(orig);
    for (let d = 0; d < dents.length; d++) {
      const dent = dents[d];
      const sideX = -dent.lx;
      const sideY = -dent.ly;
      const sideZ = -dent.lz;
      const strength = Math.min(0.16, dent.mag * 0.05);
      for (let i = 0; i < pos.count; i++) {
        const ox = orig[i * 3];
        const oy = orig[i * 3 + 1];
        const oz = orig[i * 3 + 2];
        const dot = ox * sideX + oy * sideY + oz * sideZ;
        if (dot < 0.18) continue;
        const w = Math.min(1, (dot - 0.18) * 2.4);
        const k = w * w * strength;
        arr[i * 3] -= dent.lx * k * 1.15;
        arr[i * 3 + 1] -= dent.ly * k * 0.45 + k * 0.03;
        arr[i * 3 + 2] -= dent.lz * k * 1.15;
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  });
}

/**
 * @param {import("../../vendor/three.module.js").Mesh} mesh
 */
function ensureOrigGeo(mesh) {
  let geo = mesh.geometry;
  if (!geo.userData.damageOrig) {
    geo = geo.clone();
    mesh.geometry = geo;
    geo.userData.damageOrig = geo.attributes.position.array.slice();
  }
  return geo;
}

/**
 * Kill the impact-side lamp at battered tier so the nose reads as crashed.
 * @param {import("../../vendor/three.module.js").Object3D} root
 * @param {number} damage
 * @param {{lx:number}} dent
 */
function smashLamps(root, damage, dent) {
  if (damageTier(damage) < 3 || !dent) return;
  const preferLeft = dent.lx < 0;
  let smashed = false;
  root.traverse((obj) => {
    if (smashed || !obj.isMesh) return;
    const name = (obj.name || "").toLowerCase();
    if (!LAMP.test(name)) return;
    const x = obj.position ? obj.position.x : 0;
    const left = x < 0 || /left|l_|_l\b/.test(name);
    if (left !== preferLeft && x !== 0) return;
    obj.visible = false;
    obj.userData.damageHiddenLamp = true;
    smashed = true;
  });
}
