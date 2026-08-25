/**
 * Trackside prop kit — shared GLB geometries for spectators, animals, and nature.
 *
 * WHO THIS IS FOR: Track scenery that used to be box/cone stand-ins (crowds,
 *   Safari animals, Desert cactus/rocks, Forest trees, Alpine tents/houses).
 * WHAT IT DOES: loads HD Blender nature props + densified Kenney spectators from
 *   assets/props/ once, merges each into a grounded BufferGeometry, preserves
 *   UVs, paints bark/canopy vertex colours, and exposes textured materials for
 *   InstancedMesh placement.
 * HOW IT CONNECTS: Track calls preparePropKit() during boot, then
 *   propGeometry(kind) / propNatureMaterial(kind) when planting.
 *
 * CACHE BUST: bump `?v=` on imports when the kit or asset set changes.
 */

import * as THREE from "../../vendor/three.module.js";
import { GLTFLoader } from "../../vendor/GLTFLoader.js";
import { mergeGeometries } from "../../vendor/BufferGeometryUtils.js";
import { VISUAL } from "../config.js?v=138";

/**
 * Every prop kind the kit knows about. Missing GLBs are skipped at load time
 * (console.warn) and propGeometry() returns null for those kinds.
 * @type {readonly string[]}
 */
export const PROP_KINDS = Object.freeze([
  // Spectators — Kenney Mini Characters (CC0), same family as Poly Pizza People
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
  // Animals (Blender drop-ins — may be absent)
  "animal-zebra",
  "animal-elephant",
  "animal-gazelle",
  // Nature kit + Alpine extras
  "cactus_tall",
  "cactus_short",
  "rock_largeA",
  "rock_largeB",
  "rock_tallA",
  "rock_smallA",
  "plant_bushDetailed",
  "plant_bushLarge",
  "plant_bushDense",
  "plant_bushRound",
  "plant_bushFern",
  "log_large",
  "tent_detailedClosed",
  "tree_pineDefaultA",
  "tree_pineDefaultB",
  "tree_oak",
  "tree_detailed",
  "tree_palmDetailedTall",
  "tree_default",
  "tree_cone",
  "tree_fir",
  "house-alpine",
]);

/** @type {Record<string, THREE.BufferGeometry|null>} */
const CACHE = Object.create(null);

/**
 * Split biped parts for cheer animation — body without lateral arms + pivoted arms.
 * @type {Record<string, {body:THREE.BufferGeometry, armL:THREE.BufferGeometry|null, armR:THREE.BufferGeometry|null, shoulderL:{x:number,y:number,z:number}, shoulderR:{x:number,y:number,z:number}}|null>}
 */
const CHAR_PARTS = Object.create(null);

/**
 * Forest pack trees — trunk + canopy with authored textures from
 * assets/props/low_poly_forest_tree_pack.glb
 * @type {Record<string, {trunk:THREE.BufferGeometry, canopy:THREE.BufferGeometry, trunkMat:THREE.Material, canopyMat:THREE.Material}|null>}
 */
const FOREST_PARTS = Object.create(null);

/** Authored 3D tree variants from the Sketchfab forest pack (geometry + cross-mixes). */
export const FOREST_TREE_KINDS = Object.freeze([
  "forest_tree_a",
  "forest_tree_b",
  "forest_tree_c",
  "forest_tree_d",
  "forest_tree_e",
  "forest_tree_f",
]);

/**
 * Stage 2 Forest — mixed pack: three trunk01/branch01 shapes, one fir, two cross-mixes.
 * Weighted so the verge reads as a real mixed stand, not one clone.
 */
export const FOREST_STAGE_PALETTE = Object.freeze([
  "forest_tree_a",
  "forest_tree_a",
  "forest_tree_b",
  "forest_tree_b",
  "forest_tree_c",
  "forest_tree_d",
  "forest_tree_e",
  "forest_tree_f",
  "forest_tree_c",
]);

/**
 * Stage 3 Mountain — same GLB pack, different mix: more fir / narrow cross-mixes,
 * fewer broadleaf clones so the hills read alpine instead of woodland.
 */
export const FOREST_MOUNTAIN_PALETTE = Object.freeze([
  "forest_tree_d",
  "forest_tree_d",
  "forest_tree_f",
  "forest_tree_f",
  "forest_tree_e",
  "forest_tree_b",
  "forest_tree_a",
  "forest_tree_d",
]);

/** Tall atlas backdrop cards from the same pack (alpha cutout). */
export const FOREST_CARD_KINDS = Object.freeze([
  "forest_card_a",
  "forest_card_b",
  "forest_card_c",
  "forest_card_d",
  "forest_card_e",
  "forest_card_f",
  "forest_card_g",
  "forest_card_h",
]);

/** Pack rocks for forest verge scatter. */
export const FOREST_ROCK_KINDS = Object.freeze([
  "forest_rock_a",
  "forest_rock_b",
  "forest_rock_c",
  "forest_rock_d",
]);

/** @type {Record<string, THREE.Material>} */
const MAT_CACHE = Object.create(null);

/** @type {THREE.Texture|null} */
let LEAF_TEX = null;
/** @type {THREE.Texture|null} */
let BARK_TEX = null;
/** @type {THREE.Texture|null} */
let ROCK_TEX = null;

/** @type {boolean} */
let ready = false;

/** @type {Promise<void>|null} */
let loadPromise = null;

/**
 * Target / clamp heights in metres (bounding-box Y extent after footing).
 * Trees keep authoring size when already in a sensible rally band.
 */
const SCALE = {
  character: 1.7,
  cactusTall: 3.0,
  cactusShort: 1.8,
  rock: 1.2,
  bush: 1.15,
  log: 0.7,
  tent: 2.4,
  house: 5.5,
  zebra: 1.4,
  elephant: 3.2,
  gazelle: 1.2,
  treeMin: 3.0,
  treeMax: 22.0,
  treeDefault: 9.0,
};

/** Bark / canopy tints for vertex-colour baking (linear-ish 0–1). */
const COL = {
  bark: [0.42, 0.26, 0.14],
  canopyPine: [0.18, 0.38, 0.14],
  canopyCedar: [0.22, 0.42, 0.18],
  canopyOak: [0.28, 0.46, 0.16],
  canopyAutumn: [0.62, 0.34, 0.1],
  canopyGold: [0.72, 0.52, 0.14],
  canopyPalm: [0.2, 0.48, 0.18],
  bush: [0.26, 0.44, 0.16],
  bushFern: [0.3, 0.48, 0.2],
  rock: [0.55, 0.48, 0.38],
  cactus: [0.22, 0.42, 0.2],
  default: [0.45, 0.45, 0.42],
};

/**
 * True after preparePropKit() has finished (success or partial failure).
 * @returns {boolean}
 */
export function propReady() {
  return ready;
}

/**
 * Shared geometry for one prop kind, or null if missing / not prepared.
 * Origin is at feet/ground (min.y = 0), xz centred — ready for InstancedMesh.
 *
 * @param {string} kind
 * @returns {THREE.BufferGeometry|null}
 */
export function propGeometry(kind) {
  if (!Object.prototype.hasOwnProperty.call(CACHE, kind)) return null;
  return CACHE[kind];
}

/**
 * Body + cheer arms for a spectator kind. Null when the GLB is missing.
 *
 * @param {string} kind
 * @returns {{body:THREE.BufferGeometry, armL:THREE.BufferGeometry|null, armR:THREE.BufferGeometry|null, shoulderL:{x:number,y:number,z:number}, shoulderR:{x:number,y:number,z:number}}|null}
 */
export function propCharacterParts(kind) {
  if (!Object.prototype.hasOwnProperty.call(CHAR_PARTS, kind)) return null;
  return CHAR_PARTS[kind];
}

/**
 * Trunk + canopy parts for a forest-pack tree, or null if unavailable.
 * @param {string} kind forest_tree_a …
 * @returns {{trunk:THREE.BufferGeometry, canopy:THREE.BufferGeometry, trunkMat:THREE.Material, canopyMat:THREE.Material}|null}
 */
export function propForestTreeParts(kind) {
  if (!Object.prototype.hasOwnProperty.call(FOREST_PARTS, kind)) return null;
  return FOREST_PARTS[kind];
}

/**
 * Textured / vertex-coloured material for nature GLBs (trees, bushes, rocks).
 * Characters keep Kenney flat colours via Track materials.
 *
 * @param {string} kind
 * @returns {THREE.Material}
 */
export function propNatureMaterial(kind) {
  if (MAT_CACHE[kind]) return MAT_CACHE[kind];
  const nature =
    kind.startsWith("tree_") ||
    kind.startsWith("forest_") ||
    kind.startsWith("plant_bush") ||
    kind.startsWith("rock_") ||
    kind.startsWith("cactus_") ||
    kind === "log_large";
  if (!nature) {
    const fallback = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.9,
      metalness: 0.02,
      fog: true,
    });
    MAT_CACHE[kind] = fallback;
    return fallback;
  }

  const map = mapForKind(kind);
  const mat = new THREE.MeshStandardMaterial({
    map: map || null,
    color: map ? 0xffffff : tintHex(kind),
    vertexColors: !kind.startsWith("forest_"),
    roughness: kind.startsWith("rock_") || kind.startsWith("forest_rock") ? 0.94 : 0.88,
    metalness: 0.02,
    envMapIntensity: (VISUAL.tier || 0) >= 3 ? 0.22 : 0.14,
    flatShading: false,
    fog: true,
    alphaTest: kind.startsWith("forest_card") ? 0.4 : 0,
  });
  mat.userData.shared = true;
  mat.userData.propKind = kind;
  MAT_CACHE[kind] = mat;
  return mat;
}

/**
 * Load every PROP_KINDS GLB once. Safe to call repeatedly — subsequent calls
 * await the same promise. Missing files warn and cache null.
 *
 * @returns {Promise<void>}
 */
export function preparePropKit() {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    await loadNatureTextures();
    // Kenney character GLBs reference Textures/colormap.png beside the pack.
    // Geometry extraction ignores materials, but GLTFLoader still fetches the
    // map — pin the path so a relative miss cannot 404-spam the console.
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      const u = String(url || "");
      if (/colormap\.png$/i.test(u)) return "assets/props/Textures/hd/crowd_atlas.png";
      if (/crowd_atlas\.png$/i.test(u)) return "assets/props/Textures/hd/crowd_atlas.png";
      return url;
    });
    const loader = new GLTFLoader(manager);
    /** Bust browser GLB cache when the kit module version bumps. */
    const assetV = "15";
    await Promise.all(
      PROP_KINDS.map(async (kind) => {
        const url = `assets/props/${kind}.glb?v=${assetV}`;
        try {
          const gltf = await loader.loadAsync(url);
          const root = gltf.scene || gltf.scenes[0];
          if (!root) {
            console.warn(`[prop-kit] empty scene: ${url}`);
            CACHE[kind] = null;
            return;
          }
          const geo = extractPropGeometry(root, kind);
          CACHE[kind] = geo;
          if (kind.startsWith("character-") && geo) {
            CHAR_PARTS[kind] = splitCrowdCharacter(geo);
          } else if (kind.startsWith("character-")) {
            CHAR_PARTS[kind] = null;
          }
        } catch (err) {
          console.warn(`[prop-kit] missing or failed: ${url}`, err);
          CACHE[kind] = null;
        }
      })
    );
    await loadForestTreePack(loader, assetV);
    ready = true;
  })();
  return loadPromise;
}

/**
 * Load Sketchfab low_poly_forest_tree_pack.glb — realistic trunk/canopy trees,
 * atlas backdrop cards, and pack rocks for Forest + Mountain stages.
 *
 * HOW VARIETY WORKS: the pack ships a few trunk/branch instances (01 / 01.001 /
 * 01.002 / 02). We pair each trunk to its nearest canopy, then build two
 * cross-material mixes so Stage 2 and Stage 3 can draw from six distinct looks
 * out of the same GLB.
 *
 * @param {GLTFLoader} loader
 * @param {string} assetV
 * @returns {Promise<void>}
 */
async function loadForestTreePack(loader, assetV) {
  const url = `assets/props/low_poly_forest_tree_pack.glb?v=${assetV}`;
  try {
    const gltf = await loader.loadAsync(url);
    const root = gltf.scene || gltf.scenes[0];
    if (!root) {
      console.warn(`[prop-kit] empty forest pack: ${url}`);
      return;
    }
    root.updateMatrixWorld(true);

    /** @type {Map<string, THREE.Mesh[]>} */
    const groups = new Map();
    root.traverse((o) => {
      if (!o.isMesh) return;
      let p = o.parent;
      while (p && p.parent && !/^(Tree_|Background_|Rocks)/.test(p.name || "")) {
        p = p.parent;
      }
      const key = normalizePackName(p?.name || o.name || "mesh");
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(o);
    });

    // Pair trunks ↔ branches by world-space proximity (exporter suffixes in this
    // pack are unreliable — Trunk_01001 sits next to a different canopy).
    const trunkGroups = [...groups.entries()]
      .filter(([k]) => k.startsWith("Tree_Trunk"))
      .sort((a, b) => a[0].localeCompare(b[0]));
    const branchGroups = [...groups.entries()]
      .filter(([k]) => k.startsWith("Tree_Branches"))
      .sort((a, b) => a[0].localeCompare(b[0]));
    /** @type {{key:string, meshes:THREE.Mesh[], c:THREE.Vector3, matKey:string}[]} */
    const trunkMeta = trunkGroups.map(([key, meshes]) => {
      const box = new THREE.Box3();
      for (const m of meshes) box.expandByObject(m);
      const c = new THREE.Vector3();
      box.getCenter(c);
      return { key, meshes, c, matKey: trunkMatKey(key) };
    });
    /** @type {{key:string, meshes:THREE.Mesh[], c:THREE.Vector3, matKey:string, used:boolean}[]} */
    const branchMeta = branchGroups.map(([key, meshes]) => {
      const box = new THREE.Box3();
      for (const m of meshes) box.expandByObject(m);
      const c = new THREE.Vector3();
      box.getCenter(c);
      return { key, meshes, c, matKey: branchMatKey(key), used: false };
    });

    /** @type {{trunk:typeof trunkMeta[0], branch:typeof branchMeta[0]}[]} */
    const pairs = [];
    for (const trunk of trunkMeta) {
      let best = null;
      let bestD = 1e9;
      for (const b of branchMeta) {
        if (b.used) continue;
        const d = trunk.c.distanceTo(b.c);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      if (!best || bestD > 12) {
        console.warn(`[prop-kit] no canopy near ${trunk.key} (best ${bestD.toFixed(1)}m)`);
        continue;
      }
      best.used = true;
      pairs.push({ trunk, branch: best });
    }

    // Cross-mixes from leftover material families — same GLB, new silhouettes.
    const trunk01 = trunkMeta.find((t) => t.matKey === "01") || trunkMeta[0];
    const trunk02 = trunkMeta.find((t) => t.matKey === "02") || trunkMeta[trunkMeta.length - 1];
    const branch01 = branchMeta.find((b) => b.matKey === "01") || branchMeta[0];
    const branch02 = branchMeta.find((b) => b.matKey === "02") || branchMeta[branchMeta.length - 1];
    if (trunk01 && branch02) pairs.push({ trunk: trunk01, branch: branch02 });
    if (trunk02 && branch01) pairs.push({ trunk: trunk02, branch: branch01 });

    for (let i = 0; i < FOREST_TREE_KINDS.length; i++) {
      const kind = FOREST_TREE_KINDS[i];
      const pair = pairs[i];
      if (!pair) {
        FOREST_PARTS[kind] = null;
        CACHE[kind] = null;
        continue;
      }
      const parts = buildForestTreeParts(kind, pair.trunk.meshes, pair.branch.meshes, 11.5);
      FOREST_PARTS[kind] = parts;
      CACHE[kind] = parts ? parts.canopy : null;
      if (parts) {
        MAT_CACHE[kind] = parts.canopyMat;
        MAT_CACHE[`${kind}_trunk`] = parts.trunkMat;
      }
    }

    const cardKeys = [...groups.keys()]
      .filter((k) => k.startsWith("Background_Tree_Atlas"))
      .sort();
    let cardIdx = 0;
    for (const key of cardKeys) {
      if (cardIdx >= FOREST_CARD_KINDS.length) break;
      const meshes = groups.get(key) || [];
      if (!meshes.length) continue;
      const box = new THREE.Box3();
      for (const m of meshes) box.expandByObject(m);
      const h = box.max.y - box.min.y;
      if (h < 8) continue; // skip understory cards — use 3D trees + bushes instead
      const kind = FOREST_CARD_KINDS[cardIdx++];
      const geo = mergeMeshList(meshes, kind, "canopy");
      if (!geo) {
        CACHE[kind] = null;
        continue;
      }
      scaleGeometryToHeight(geo, 14);
      groundAndCenter(geo);
      CACHE[kind] = geo;
      const srcMat = meshes[0].material;
      MAT_CACHE[kind] = adoptPackMaterial(srcMat, kind, { alphaTest: 0.42, doubleSide: true });
    }

    const rockKeys = [...groups.keys()].filter((k) => k.startsWith("Rocks")).sort();
    for (let i = 0; i < FOREST_ROCK_KINDS.length && i < rockKeys.length; i++) {
      const kind = FOREST_ROCK_KINDS[i];
      const meshes = groups.get(rockKeys[i]) || [];
      const geo = mergeMeshList(meshes, kind, "rock");
      if (!geo) {
        CACHE[kind] = null;
        continue;
      }
      scaleGeometryToHeight(geo, 1.15);
      groundAndCenter(geo);
      CACHE[kind] = geo;
      MAT_CACHE[kind] = adoptPackMaterial(meshes[0]?.material, kind, { alphaTest: 0 });
    }

    console.info(
      `[prop-kit] forest pack ready — trees ${FOREST_TREE_KINDS.filter((k) => FOREST_PARTS[k]).length}/${FOREST_TREE_KINDS.length}, cards ${FOREST_CARD_KINDS.filter((k) => CACHE[k]).length}`
    );
  } catch (err) {
    console.warn(`[prop-kit] forest pack failed: ${url}`, err);
  }
}

/**
 * Sketchfab exporter drops dots in names (Tree_Trunk_01.001 → Tree_Trunk_01001).
 * @param {string} name
 * @returns {string}
 */
function normalizePackName(name) {
  return String(name || "").replace(/\./g, "");
}

/** @param {string} key */
function trunkMatKey(key) {
  if (/Trunk_02/.test(key)) return "02";
  return "01";
}

/** @param {string} key */
function branchMatKey(key) {
  if (/Branches_02/.test(key)) return "02";
  return "01";
}

/**
 * @param {string} kind
 * @param {THREE.Mesh[]} trunkMeshes
 * @param {THREE.Mesh[]} canopyMeshes
 * @param {number} targetH
 */
function buildForestTreeParts(kind, trunkMeshes, canopyMeshes, targetH) {
  const trunk = mergeMeshList(trunkMeshes, kind, "bark");
  const canopy = mergeMeshList(canopyMeshes, kind, "canopy");
  if (!trunk || !canopy) return null;

  // Shared scale from combined height so trunk and canopy stay aligned.
  const tBox = trunk.boundingBox || (trunk.computeBoundingBox(), trunk.boundingBox);
  const cBox = canopy.boundingBox || (canopy.computeBoundingBox(), canopy.boundingBox);
  const minY = Math.min(tBox.min.y, cBox.min.y);
  const maxY = Math.max(tBox.max.y, cBox.max.y);
  const h = Math.max(1e-3, maxY - minY);
  const s = targetH / h;
  trunk.scale(s, s, s);
  canopy.scale(s, s, s);
  // Re-ground both to the same floor after uniform scale.
  trunk.computeBoundingBox();
  canopy.computeBoundingBox();
  const floor = Math.min(trunk.boundingBox.min.y, canopy.boundingBox.min.y);
  const cx =
    (Math.min(trunk.boundingBox.min.x, canopy.boundingBox.min.x) +
      Math.max(trunk.boundingBox.max.x, canopy.boundingBox.max.x)) *
    0.5;
  const cz =
    (Math.min(trunk.boundingBox.min.z, canopy.boundingBox.min.z) +
      Math.max(trunk.boundingBox.max.z, canopy.boundingBox.max.z)) *
    0.5;
  trunk.translate(-cx, -floor, -cz);
  canopy.translate(-cx, -floor, -cz);
  trunk.computeBoundingSphere();
  canopy.computeBoundingSphere();

  const trunkMat = adoptPackMaterial(trunkMeshes[0].material, `${kind}_trunk`, {
    alphaTest: 0,
    doubleSide: false,
  });
  const canopyMat = adoptPackMaterial(canopyMeshes[0].material, kind, {
    alphaTest: 0.38,
    doubleSide: true,
  });
  return { trunk, canopy, trunkMat, canopyMat };
}

/**
 * @param {THREE.Mesh[]} meshes
 * @param {string} kind
 * @param {"bark"|"canopy"|"rock"|"default"} role
 * @returns {THREE.BufferGeometry|null}
 */
function mergeMeshList(meshes, kind, role) {
  if (!meshes.length) return null;
  /** @type {THREE.BufferGeometry[]} */
  const parts = [];
  for (const mesh of meshes) {
    const cloned = mesh.geometry.clone();
    cloned.applyMatrix4(mesh.matrixWorld);
    parts.push(normalizeForMerge(cloned, role, kind));
  }
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) return null;
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.userData.shared = true;
  merged.userData.propKind = kind;
  return merged;
}

/**
 * @param {THREE.BufferGeometry} geo
 * @param {number} targetH
 */
function scaleGeometryToHeight(geo, targetH) {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) return;
  const h = box.max.y - box.min.y;
  if (!(h > 1e-6)) return;
  const s = targetH / h;
  if (Math.abs(s - 1) < 1e-4) return;
  geo.scale(s, s, s);
}

/**
 * Clone a pack material and pin texture colour space for the race renderer.
 * @param {THREE.Material|THREE.Material[]|undefined} src
 * @param {string} kind
 * @param {{alphaTest?:number, doubleSide?:boolean}} opts
 * @returns {THREE.Material}
 */
function adoptPackMaterial(src, kind, opts) {
  const base = Array.isArray(src) ? src[0] : src;
  /** @type {THREE.MeshStandardMaterial} */
  let mat;
  if (base && base.isMaterial) {
    mat = base.clone();
  } else {
    mat = new THREE.MeshStandardMaterial({ color: 0x6a8a48, roughness: 0.9, metalness: 0.02 });
  }
  if (mat.map) {
    mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.map.anisotropy = 8;
    mat.map.needsUpdate = true;
  }
  if (mat.normalMap) mat.normalMap.needsUpdate = true;
  mat.vertexColors = false;
  mat.fog = true;
  mat.flatShading = false;
  mat.envMapIntensity = (VISUAL.tier || 0) >= 3 ? 0.28 : 0.16;
  mat.alphaTest = opts.alphaTest != null ? opts.alphaTest : 0;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.side = opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide;
  mat.userData.shared = true;
  mat.userData.propKind = kind;
  return mat;
}

/**
 * @returns {Promise<void>}
 */
function loadNatureTextures() {
  const loader = new THREE.TextureLoader();
  const load = (url) =>
    new Promise((resolve) => {
      loader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.anisotropy = 8;
          resolve(tex);
        },
        undefined,
        () => resolve(null)
      );
    });
  return Promise.all([
    load("assets/props/Textures/hd/leaf_diff.jpg"),
    load("assets/props/Textures/hd/bark_diff.jpg"),
    load("assets/props/Textures/hd/rock_diff.jpg"),
  ]).then(([leaf, bark, rock]) => {
    LEAF_TEX = leaf;
    BARK_TEX = bark;
    ROCK_TEX = rock;
  });
}

/**
 * Merge all meshes in a GLB into one grounded, scaled BufferGeometry.
 *
 * @param {THREE.Object3D} root
 * @param {string} kind
 * @returns {THREE.BufferGeometry|null}
 */
function extractPropGeometry(root, kind) {
  root.updateMatrixWorld(true);
  /** @type {THREE.BufferGeometry[]} */
  const parts = [];

  root.traverse((obj) => {
    if ((!obj.isMesh && !obj.isSkinnedMesh) || !obj.geometry) return;
    const cloned = obj.geometry.clone();
    cloned.applyMatrix4(obj.matrixWorld);
    const role = meshRole(obj.name || "", kind);
    parts.push(normalizeForMerge(cloned, role, kind));
  });

  if (!parts.length) {
    console.warn(`[prop-kit] no meshes in ${kind}`);
    return null;
  }

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) {
    console.warn(`[prop-kit] merge failed for ${kind}`);
    return null;
  }

  groundAndCenter(merged);
  applyKindScale(merged, kind);

  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  merged.userData.shared = true;
  merged.userData.propKind = kind;
  return merged;
}

/**
 * Split a merged biped GLB into a torso/legs body plus pivoted arms for cheer.
 * Triangles are bucketed by centroid — arms sit on the sides above the waist.
 *
 * @param {THREE.BufferGeometry} geo grounded full-body mesh
 * @returns {{body:THREE.BufferGeometry, armL:THREE.BufferGeometry|null, armR:THREE.BufferGeometry|null, shoulderL:{x:number,y:number,z:number}, shoulderR:{x:number,y:number,z:number}}}
 */
function splitCrowdCharacter(geo) {
  const pos = geo.getAttribute("position");
  const idx = geo.getIndex();
  if (!pos || !idx) {
    return {
      body: geo,
      armL: null,
      armR: null,
      shoulderL: { x: -0.34, y: 1.38, z: 0 },
      shoulderR: { x: 0.34, y: 1.38, z: 0 },
    };
  }

  /** @type {number[]} */
  const bodyTri = [];
  /** @type {number[]} */
  const armLTri = [];
  /** @type {number[]} */
  const armRTri = [];
  const c = { x: 0, y: 0, z: 0 };

  for (let t = 0; t < idx.count; t += 3) {
    const ia = idx.getX(t);
    const ib = idx.getX(t + 1);
    const ic = idx.getX(t + 2);
    c.x = (pos.getX(ia) + pos.getX(ib) + pos.getX(ic)) / 3;
    c.y = (pos.getY(ia) + pos.getY(ib) + pos.getY(ic)) / 3;
    c.z = (pos.getZ(ia) + pos.getZ(ib) + pos.getZ(ic)) / 3;
    let bucket = bodyTri;
    if (c.y > 0.88 && c.y < 1.68) {
      if (c.x < -0.09) bucket = armLTri;
      else if (c.x > 0.09) bucket = armRTri;
    }
    bucket.push(ia, ib, ic);
  }

  const body = subsetGeometry(geo, bodyTri) || geo;
  const armL = armLTri.length >= 90 ? subsetGeometry(geo, armLTri) : null;
  const armR = armRTri.length >= 90 ? subsetGeometry(geo, armRTri) : null;
  const shoulderL = armL ? shoulderPivot(armL, -1) : { x: -0.34, y: 1.38, z: 0 };
  const shoulderR = armR ? shoulderPivot(armR, 1) : { x: 0.34, y: 1.38, z: 0 };
  if (armL) repivotToShoulder(armL, shoulderL);
  if (armR) repivotToShoulder(armR, shoulderR);

  return { body, armL, armR, shoulderL, shoulderR };
}

/**
 * @param {THREE.BufferGeometry} src
 * @param {number[]} triangles flat index triplets
 * @returns {THREE.BufferGeometry|null}
 */
function subsetGeometry(src, triangles) {
  if (!triangles.length) return null;
  const pos = src.getAttribute("position");
  const uv = src.getAttribute("uv");
  const nrm = src.getAttribute("normal");
  const col = src.getAttribute("color");
  /** @type {Map<number, number>} */
  const remap = new Map();
  /** @type {number[]} */
  const outPos = [];
  /** @type {number[]} */
  const outUv = [];
  /** @type {number[]} */
  const outNrm = [];
  /** @type {number[]} */
  const outCol = [];
  /** @type {number[]} */
  const outIdx = [];

  const mapVert = (vi) => {
    let ni = remap.get(vi);
    if (ni == null) {
      ni = outPos.length / 3;
      remap.set(vi, ni);
      outPos.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi));
      if (uv) outUv.push(uv.getX(vi), uv.getY(vi));
      if (nrm) outNrm.push(nrm.getX(vi), nrm.getY(vi), nrm.getZ(vi));
      if (col) outCol.push(col.getX(vi), col.getY(vi), col.getZ(vi));
    }
    return ni;
  };

  for (let i = 0; i < triangles.length; i += 3) {
    outIdx.push(mapVert(triangles[i]), mapVert(triangles[i + 1]), mapVert(triangles[i + 2]));
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
  if (outUv.length) out.setAttribute("uv", new THREE.Float32BufferAttribute(outUv, 2));
  if (outNrm.length) out.setAttribute("normal", new THREE.Float32BufferAttribute(outNrm, 3));
  else out.computeVertexNormals();
  if (outCol.length) out.setAttribute("color", new THREE.Float32BufferAttribute(outCol, 3));
  out.setIndex(outIdx);
  out.computeBoundingSphere();
  out.userData.shared = true;
  return out;
}

/**
 * @param {THREE.BufferGeometry} geo
 * @param {-1|1} side
 */
function shoulderPivot(geo, side) {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) return { x: side * 0.34, y: 1.38, z: 0 };
  return {
    x: side < 0 ? box.max.x : box.min.x,
    y: box.max.y * 0.92 + box.min.y * 0.08,
    z: (box.min.z + box.max.z) * 0.5,
  };
}

/**
 * @param {THREE.BufferGeometry} geo
 * @param {{x:number,y:number,z:number}} pivot
 */
function repivotToShoulder(geo, pivot) {
  geo.translate(-pivot.x, -pivot.y, -pivot.z);
  geo.computeBoundingSphere();
}

/**
 * @param {string} name
 * @param {string} kind
 * @returns {"bark"|"canopy"|"rock"|"default"}
 */
function meshRole(name, kind) {
  const n = String(name || "");
  if (kind.startsWith("character-")) return "character";
  if (kind.startsWith("forest_tree") || kind.startsWith("forest_card")) return "canopy";
  if (kind.startsWith("forest_rock")) return "rock";
  if (/trunk|bark|stem|log|wood/i.test(n)) return "bark";
  if (/canopy|leaf|foliage|frond|bush|needle|branch/i.test(n)) return "canopy";
  if (kind.startsWith("rock_")) return "rock";
  if (kind.startsWith("plant_bush")) return "canopy";
  if (kind.startsWith("cactus_")) return "canopy";
  if (kind.startsWith("tree_")) return "canopy";
  return "default";
}

/**
 * Reduce a geometry to position/normal/uv/color so mergeGeometries accepts
 * mixed GLBs. Preserves author UVs when present; paints bark/canopy colours.
 * @param {THREE.BufferGeometry} geo
 * @param {"bark"|"canopy"|"rock"|"default"} role
 * @param {string} kind
 * @returns {THREE.BufferGeometry}
 */
function normalizeForMerge(geo, role, kind) {
  const flat = typeof geo.toNonIndexed === "function" ? geo.toNonIndexed() : geo.clone();
  const posAttr = flat.getAttribute("position");
  if (!posAttr) {
    if (flat !== geo) flat.dispose();
    return new THREE.BufferGeometry();
  }
  const out = new THREE.BufferGeometry();
  const count = posAttr.count;
  if (posAttr.isInterleavedBufferAttribute) {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = posAttr.getX(i);
      arr[i * 3 + 1] = posAttr.getY(i);
      arr[i * 3 + 2] = posAttr.getZ(i);
    }
    out.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  } else {
    out.setAttribute("position", posAttr.clone());
  }

  const nrm = flat.getAttribute("normal");
  if (nrm && !nrm.isInterleavedBufferAttribute) {
    out.setAttribute("normal", nrm.clone());
  } else {
    out.computeVertexNormals();
  }

  const uvSrc = flat.getAttribute("uv");
  const uv = new Float32Array(count * 2);
  if (uvSrc && !uvSrc.isInterleavedBufferAttribute) {
    for (let i = 0; i < count; i++) {
      uv[i * 2] = uvSrc.getX(i);
      uv[i * 2 + 1] = uvSrc.getY(i);
    }
  } else {
    const p = out.getAttribute("position");
    for (let i = 0; i < count; i++) {
      uv[i * 2] = p.getX(i) * 0.35 + 0.5;
      uv[i * 2 + 1] = p.getY(i) * 0.35 + 0.15;
    }
  }
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));

  const rgb = colorForRole(role, kind);
  const colors = new Float32Array(count * 3);
  const isCharacter = kind.startsWith("character-") || role === "character";
  for (let i = 0; i < count; i++) {
    if (isCharacter) {
      colors[i * 3] = 1;
      colors[i * 3 + 1] = 1;
      colors[i * 3 + 2] = 1;
    } else {
      const j = ((i * 17) % 7) * 0.008 - 0.024;
      colors[i * 3] = Math.max(0, Math.min(1, rgb[0] + j));
      colors[i * 3 + 1] = Math.max(0, Math.min(1, rgb[1] + j * 0.6));
      colors[i * 3 + 2] = Math.max(0, Math.min(1, rgb[2] + j * 0.4));
    }
  }
  out.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

  if (flat !== geo) flat.dispose();
  return out;
}

/**
 * @param {"bark"|"canopy"|"rock"|"character"|"default"} role
 * @param {string} kind
 * @returns {[number, number, number]}
 */
function colorForRole(role, kind) {
  // Characters are fully textured — keep vertex colour white so the atlas shows.
  if (role === "character" || kind.startsWith("character-")) return [1, 1, 1];
  if (role === "bark") return COL.bark;
  if (role === "rock") return COL.rock;
  if (kind.startsWith("cactus_")) return COL.cactus;
  if (kind === "plant_bushFern") return COL.bushFern;
  if (kind.startsWith("plant_bush")) return COL.bush;
  if (kind === "tree_pineDefaultA" || kind === "tree_fir" || kind === "tree_cone") {
    return COL.canopyPine;
  }
  if (kind === "tree_pineDefaultB") return COL.canopyCedar;
  if (kind === "tree_detailed") return COL.canopyAutumn;
  if (kind === "tree_default") return COL.canopyGold;
  if (kind === "tree_palmDetailedTall") return COL.canopyPalm;
  if (kind.startsWith("tree_")) return COL.canopyOak;
  return COL.default;
}

/**
 * @param {string} kind
 * @returns {THREE.Texture|null}
 */
function mapForKind(kind) {
  if (kind.startsWith("rock_")) return ROCK_TEX;
  if (kind === "log_large") return BARK_TEX;
  if (kind.startsWith("tree_") || kind.startsWith("plant_bush") || kind.startsWith("cactus_")) {
    return LEAF_TEX;
  }
  return null;
}

/**
 * @param {string} kind
 * @returns {number}
 */
function tintHex(kind) {
  const c = colorForRole(kind.startsWith("rock_") ? "rock" : "canopy", kind);
  return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
}

/**
 * Translate so min.y = 0 and xz centre sits on the origin.
 * @param {THREE.BufferGeometry} geo
 */
function groundAndCenter(geo) {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) return;
  const cx = (box.min.x + box.max.x) * 0.5;
  const cz = (box.min.z + box.max.z) * 0.5;
  geo.translate(-cx, -box.min.y, -cz);
}

/**
 * Scale to rally-readable sizes.
 *
 * @param {THREE.BufferGeometry} geo
 * @param {string} kind
 */
function applyKindScale(geo, kind) {
  geo.computeBoundingBox();
  const box = geo.boundingBox;
  if (!box) return;
  const height = box.max.y - box.min.y;
  if (!(height > 1e-6)) return;

  const target = targetHeightForKind(kind, height);
  if (target == null) return;
  const s = target / height;
  if (Math.abs(s - 1) < 1e-4) return;
  geo.scale(s, s, s);
  groundAndCenter(geo);
}

/**
 * @param {string} kind
 * @param {number} currentHeight
 * @returns {number|null}
 */
function targetHeightForKind(kind, currentHeight) {
  if (kind.startsWith("character-")) return SCALE.character;
  if (kind === "animal-zebra") return SCALE.zebra;
  if (kind === "animal-elephant") return SCALE.elephant;
  if (kind === "animal-gazelle") return SCALE.gazelle;
  if (kind === "cactus_tall") return SCALE.cactusTall;
  if (kind === "cactus_short") return SCALE.cactusShort;
  if (kind.startsWith("rock_")) return SCALE.rock;
  if (kind.startsWith("plant_bush")) return SCALE.bush;
  if (kind === "log_large") return SCALE.log;
  if (kind === "tent_detailedClosed") return SCALE.tent;
  if (kind === "house-alpine") return SCALE.house;
  if (kind.startsWith("tree_")) {
    if (currentHeight < SCALE.treeMin || currentHeight > SCALE.treeMax) {
      return SCALE.treeDefault;
    }
    return null;
  }
  return null;
}
