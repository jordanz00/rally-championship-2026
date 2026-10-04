/**
 * Seat trackside scenery on the visible land mesh.
 *
 * WHO THIS IS FOR: Track build — after tiles and props exist.
 * WHAT IT DOES: reads the actual terrain vertices (not the height function)
 *   and drops floating env props so their toes sit in the dirt.
 * HOW IT CONNECTS: Track.buildAsync calls seatTrackScenery after the roadway
 *   visual scrub. Does not change Track.query or Vehicle.
 */

import * as THREE from "../../vendor/three.module.js";

const EMBED = 0.06;
const BURY_SKIP = -4.8;
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _corner = new THREE.Vector3();
const RAISED =
  /shadow|decal|banner|board|tape|roof|rail|deck|seat|lamp|flag|puddle|cloth|stripe|gantry|beam|wiper|bleacher/;

/**
 * Bilinear Y on a rotated PlaneGeometry land tile. Matches what the player sees.
 * @param {THREE.Mesh} mesh
 * @param {number} x
 * @param {number} z
 * @returns {number|null}
 */
export function sampleTileY(mesh, x, z) {
  if (!mesh || !mesh.geometry) return null;
  const geo = mesh.geometry;
  const pos = geo.attributes && geo.attributes.position;
  const p = geo.parameters;
  if (!pos || !p || !(p.width > 0) || p.widthSegments == null) return null;
  const w = p.width;
  const h = p.height;
  const ww = p.widthSegments;
  const hh = p.heightSegments;
  const lx = x - mesh.position.x;
  const lz = z - mesh.position.z;
  if (Math.abs(lx) > w * 0.5 + 0.02 || Math.abs(lz) > h * 0.5 + 0.02) return null;
  const u = (lx + w * 0.5) / w;
  const v = (lz + h * 0.5) / h;
  const gx = Math.min(ww, Math.max(0, u * ww));
  const gz = Math.min(hh, Math.max(0, v * hh));
  const ix = Math.min(ww - 1, Math.floor(gx));
  const iz = Math.min(hh - 1, Math.floor(gz));
  const fx = gx - ix;
  const fz = gz - iz;
  const cols = ww + 1;
  const i00 = iz * cols + ix;
  const i10 = iz * cols + ix + 1;
  const i01 = (iz + 1) * cols + ix;
  const i11 = (iz + 1) * cols + ix + 1;
  if (i11 >= pos.count) return null;
  const y00 = pos.getY(i00);
  const y10 = pos.getY(i10);
  const y01 = pos.getY(i01);
  const y11 = pos.getY(i11);
  const y0 = y00 + (y10 - y00) * fx;
  const y1 = y01 + (y11 - y01) * fx;
  return y0 + (y1 - y0) * fz;
}

/**
 * @param {THREE.Object3D[]} lands
 * @param {number} x
 * @param {number} z
 * @param {number} [fallback]
 * @returns {number}
 */
export function sampleLandMeshY(lands, x, z, fallback) {
  let best = null;
  let bestD = Infinity;
  if (lands && lands.length) {
    for (let i = 0; i < lands.length; i++) {
      const mesh = lands[i];
      const y = sampleTileY(mesh, x, z);
      if (y == null || !Number.isFinite(y)) continue;
      const dx = x - mesh.position.x;
      const dz = z - mesh.position.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = y;
      }
    }
  }
  if (best != null) return best;
  return Number.isFinite(fallback) ? fallback : 0;
}

/**
 * Prop label used to skip raised furniture.
 * @param {THREE.Object3D} obj
 */
function propLabel(obj) {
  const geoKind =
    obj.geometry && obj.geometry.userData && obj.geometry.userData.propKind
      ? obj.geometry.userData.propKind
      : "";
  const mat = obj.material && !Array.isArray(obj.material) ? obj.material : null;
  const matKind = mat && mat.userData && mat.userData.propKind ? mat.userData.propKind : "";
  return `${geoKind} ${matKind} ${obj.name || ""} ${mat && mat.name ? mat.name : ""}`.toLowerCase();
}

/**
 * True when this object should sit in the dirt.
 * Env props default to ground. Raised decks / banners / flags stay put.
 * @param {THREE.Object3D} obj
 */
export function isGroundProp(obj) {
  if (!obj || !obj.userData) return false;
  if (obj.userData.skipSeat) return false;
  if (obj.userData.farDetail || obj.userData.midDetail) return false;
  if (
    obj.userData.tunnelPortal ||
    obj.userData.tunnelBoreRib ||
    obj.userData.tunnelBoreLining ||
    obj.userData.blobShadow ||
    obj.userData.envLand
  ) {
    return false;
  }
  const n = propLabel(obj);
  if (RAISED.test(n)) return false;
  if (obj.userData.envProp) return true;
  return /tree|pine|oak|fir|cedar|acacia|palm|bush|rock|cactus|log|fern|boulder|moss|house|wall|post|berm|bank|shard|animal|character|cliff|spire|tent|bench|barrier|tumble/.test(
    n
  );
}

/**
 * World-space lowest Y of a transformed local AABB.
 * @param {THREE.Box3} box
 * @param {THREE.Matrix4} mat
 */
export function worldFootY(box, mat) {
  let minY = Infinity;
  for (let i = 0; i < 8; i++) {
    _corner.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    );
    _corner.applyMatrix4(mat);
    if (_corner.y < minY) minY = _corner.y;
  }
  return minY;
}

/**
 * @param {THREE.Box3} box
 * @param {THREE.Matrix4} mat
 * @param {number} land
 * @returns {number|null} dy to apply, or null to skip
 */
function snapDy(box, mat, land) {
  const spanY = box.max.y - box.min.y;
  if (spanY < 0.08) return null;
  const foot = worldFootY(box, mat);
  if (!Number.isFinite(foot) || !Number.isFinite(land)) return null;
  const gap = foot - land;
  if (gap < BURY_SKIP) return null;
  const dy = land - foot - EMBED;
  if (Math.abs(dy) < 0.018) return null;
  return dy;
}

/**
 * Pull every grounded env object down onto the visible land.
 * @param {{group:THREE.Object3D, scenery?:string, _landSurfaceY?:Function, _def?:object}} track
 * @returns {{seated:number, scanned:number}}
 */
export function seatTrackScenery(track) {
  const group = track && track.group;
  if (!group) return { seated: 0, scanned: 0 };
  const scenery = track.scenery || (track._def && track._def.scenery) || "forest";
  /** @type {THREE.Mesh[]} */
  const lands = [];
  group.traverse((o) => {
    if (o.userData && o.userData.envLand) lands.push(o);
  });
  const fallbackY = (x, z) => {
    if (typeof track._landSurfaceY === "function") {
      const y = track._landSurfaceY(x, z, scenery);
      if (Number.isFinite(y)) return y;
    }
    return 0;
  };

  let seated = 0;
  let scanned = 0;

  group.traverse((obj) => {
    if (obj.isInstancedMesh) {
      if (!isGroundProp(obj)) return;
      const geo = obj.geometry;
      if (!geo) return;
      if (!geo.boundingBox) geo.computeBoundingBox();
      const box = geo.boundingBox;
      if (!box) return;
      const arr = obj.instanceMatrix.array;
      const n = obj.count;
      let dirty = false;
      for (let i = 0; i < n; i++) {
        scanned += 1;
        const o = i * 16;
        _mat.fromArray(arr, o);
        _mat.decompose(_pos, _quat, _scl);
        const land = sampleLandMeshY(lands, _pos.x, _pos.z, fallbackY(_pos.x, _pos.z));
        const dy = snapDy(box, _mat, land);
        if (dy == null) continue;
        _pos.y += dy;
        _mat.compose(_pos, _quat, _scl);
        _mat.toArray(arr, o);
        dirty = true;
        seated += 1;
      }
      if (dirty) {
        obj.instanceMatrix.needsUpdate = true;
        const mid = obj.userData.midMesh;
        const far = obj.userData.farMesh;
        if (mid && mid.instanceMatrix) {
          mid.instanceMatrix.array.set(arr);
          mid.instanceMatrix.needsUpdate = true;
        }
        if (far && far.instanceMatrix) {
          far.instanceMatrix.array.set(arr);
          far.instanceMatrix.needsUpdate = true;
        }
      }
      return;
    }

    if (!obj.isMesh) return;
    if (obj.userData && obj.userData.envLand) return;
    if (!isGroundProp(obj)) return;
    const geo = obj.geometry;
    if (!geo) return;
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) return;
    scanned += 1;
    obj.updateWorldMatrix(true, false);
    const wx = obj.matrixWorld.elements[12];
    const wz = obj.matrixWorld.elements[14];
    const land = sampleLandMeshY(lands, wx, wz, fallbackY(wx, wz));
    const dy = snapDy(box, obj.matrixWorld, land);
    if (dy == null) return;
    obj.position.y += dy;
    obj.updateMatrix();
    obj.updateMatrixWorld(true);
    seated += 1;
  });
  return { seated, scanned };
}
