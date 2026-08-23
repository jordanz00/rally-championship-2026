/**
 * Vehicle damage — progressive visual wear from wall rubs and rival contact.
 *
 * WHO THIS IS FOR: Sprint 35 DCC pipeline output + runtime damage tiers.
 * WHAT IT DOES: accumulates 0..1 damage, maps to four visual tiers (pristine →
 *   battered), darkens body paint, raises roughness, tints chrome — no gameplay
 *   penalty so arcade fun stays intact.
 * HOW IT CONNECTS: vehicle.js accumulates; game.js calls applyDamageVisuals on
 *   the player mesh each race frame.
 *
 * DCC PIPELINE: author `damaged.glb` LODs per car in assets/<car>/ — this module
 *   is the runtime hook; run `node tools/dcc-pipeline.mjs` to validate assets.
 */

/** Visual tiers — maps damage 0..1 to shader state. */
export const DAMAGE_TIERS = [
  { roughness: 0.38, metalness: 0.12, colorMul: 1.0, scratch: 0 },
  { roughness: 0.48, metalness: 0.1, colorMul: 0.94, scratch: 0.15 },
  { roughness: 0.58, metalness: 0.08, colorMul: 0.86, scratch: 0.35 },
  { roughness: 0.72, metalness: 0.06, colorMul: 0.78, scratch: 0.55 },
];

/**
 * @param {number} damage 0..1
 * @returns {number} tier index 0..3
 */
export function damageTier(damage) {
  return Math.min(3, Math.floor(Math.max(0, damage) * 4));
}

/**
 * Accumulate damage from a wall glance magnitude.
 * @param {number} current 0..1
 * @param {number} hitMag from collide.js hitWall
 * @returns {number}
 */
export function accumulateDamage(current, hitMag) {
  if (!(hitMag > 0.25)) return current;
  const add = Math.min(0.12, hitMag * 0.035);
  return Math.min(1, (current || 0) + add);
}

/**
 * Apply tier visuals to body meshes on a car root.
 * @param {import("../../vendor/three.module.js").Object3D} root
 * @param {number} damage 0..1
 */
export function applyDamageVisuals(root, damage) {
  if (!root) return;
  const tier = DAMAGE_TIERS[damageTier(damage)];
  if (!tier) return;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const name = (obj.name || "").toLowerCase();
    if (/wheel|tire|tyre|rim|glass|light|brake/.test(name)) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m || m.userData?.damageLocked) continue;
      if (!m.userData.damageBase) {
        m.userData.damageBase = {
          roughness: m.roughness ?? 0.4,
          metalness: m.metalness ?? 0.1,
          color: m.color ? m.color.clone() : null,
        };
      }
      const base = m.userData.damageBase;
      m.roughness = base.roughness + (tier.roughness - 0.38) * 0.85;
      m.metalness = base.metalness * (tier.metalness / 0.12);
      if (base.color && m.color) {
        m.color.r = base.color.r * tier.colorMul;
        m.color.g = base.color.g * tier.colorMul * (1 - tier.scratch * 0.08);
        m.color.b = base.color.b * tier.colorMul;
      }
    }
  });
}

/**
 * Reset damage visuals to pristine (new race / garage).
 * @param {import("../../vendor/three.module.js").Object3D} root
 */
export function resetDamageVisuals(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      const base = m.userData?.damageBase;
      if (!base) continue;
      m.roughness = base.roughness;
      m.metalness = base.metalness;
      if (base.color && m.color) m.color.copy(base.color);
    }
  });
}
