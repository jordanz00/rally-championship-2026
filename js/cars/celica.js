/**
 * Player cars — Celica GT-Four, Delta HF Integrale, Stratos HF.
 *
 * Celica: Toyota Celica GT4 Rally by ColdLasagna (CC BY 4.0)
 *   https://sketchfab.com/3d-models/toyota-celica-gt4-rally-6e63b42ef7ab4d8d98b9990b0caad704
 * Delta: FREE Lancia Delta HF Integrale evo 2 by TARANTULA / begemot.988888 (CC BY 4.0)
 *   https://sketchfab.com/3d-models/free-lancia-delta-hf-integrale-evo-2-85614131e0dc4613a948472aaa935fc7
 * Stratos: user-supplied 1974 Lancia Stratos HF GLB (CAD export, PBR maps).
 *
 * WHO THIS IS FOR: renderer + AI pack.
 * WHAT IT DOES: loads a GLB per chassis, fits it to the rally car, PBR-shades
 *   it (clearcoat paint, glass, chrome). Falls back to a lofted mesh if the
 *   file is missing. AI rivals use a shared generic coupe so a 15-car pack
 *   stays cheap.
 * HOW IT CONNECTS: game.js calls prepareTitleCar() for the splash spin
 * (rival LOD), then prepareCelica() / createPlayerCar(id) for the race.
 */

import * as THREE from "../../vendor/three.module.js";
import { GLTFLoader } from "../../vendor/GLTFLoader.js";
import { mergeGeometries } from "../../vendor/BufferGeometryUtils.js";
import { COLORS, TUNNEL, CARS } from "../config.js?v=209";
import { paint, glass, chrome, rubber, sharedPaint } from "../gfx/pbr.js?v=36";
import { bindCarDirt, updateCarDirt, resetCarDirt } from "./car-dirt.js?v=2";

export { bindCarDirt, updateCarDirt, resetCarDirt };

const GARAGE = {
  celica: {
    id: "celica",
    urls: [
      "assets/celica/gt4.glb",
      "assets/celica/scene.glb",
      "assets/celica/toyota-celica-gt4-rally.glb",
      "assets/celica/scene.gltf",
    ],
    rivalUrls: ["assets/celica/rival.glb"],
    idbKey: "gt4",
    name: "celica-gt4",
  },
  delta: {
    id: "delta",
    urls: ["assets/delta/integrale.glb", "assets/delta/scene.glb"],
    rivalUrls: ["assets/delta/rival.glb"],
    idbKey: "delta",
    name: "delta-hf",
    // Sketchfab Integrale: "Light Front" sits at −Z and the number plates /
    // "Light Rear" sit at +Z. Game forward is +Z, so this is a half-turn —
    // 360° would leave it backwards. Baked onto the inner scene because
    // gameplay overwrites root.rotation with physics heading every frame.
    yaw: Math.PI,
  },
  stratos: {
    id: "stratos",
    urls: ["assets/stratos/stratos.glb", "assets/stratos/scene.glb"],
    rivalUrls: ["assets/stratos/rival.glb"],
    idbKey: "stratos",
    name: "stratos-hf",
    /**
     * 1974 CAD GLB (user drop). Four meshes; two are fused L+R axles.
     * `prepStratosCadModel` splits them into WHEEL_* hubs at load.
     */
    placeholderGlb: false,
  },
};

/** Real-world length (m) from config — single source of truth for hero + rival fit. */
for (const id of Object.keys(GARAGE)) {
  const len = CARS[id]?.lengthM;
  if (len != null) GARAGE[id].length = len;
}

/** All selectable chassis ids (stable order for UI + rivals). */
export const GARAGE_CAR_IDS = Object.keys(GARAGE);

/**
 * Chassis the AI pack drives — every loaded GLB can appear on the grid.
 */
const RIVAL_CHASSIS = GARAGE_CAR_IDS;

const IDB_NAME = "sega-rally-cars";
const IDB_STORE = "models";
const IDB_LEGACY = "sega-rally-celica";

/** @type {Record<string, THREE.Group|null>} */
const templates = Object.fromEntries(GARAGE_CAR_IDS.map((id) => [id, null]));
/** @type {Record<string, boolean>} */
const usingGltf = Object.fromEntries(GARAGE_CAR_IDS.map((id) => [id, false]));

/**
 * Decimated versions of the same cars for the AI pack, built by
 * tools/build-car-lods.sh. A rival is the real car, not a different shape —
 * just cheaper. See docs/CAR-ASSET-PIPELINE.md.
 * @type {Record<string, THREE.Group|null>}
 */
const rivalTemplates = Object.fromEntries(GARAGE_CAR_IDS.map((id) => [id, null]));

/**
 * Body paint per livery, shared across every rival wearing it. Cloning a whole
 * material set per car is what stopped the pack batching.
 * @type {Map<string, THREE.Material>}
 */
const rivalPaintCache = new Map();

/** Warn once per missing chassis at race time. */
const warnedMissing = new Set();

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isCarModelReady(id) {
  return !!(GARAGE[id] && usingGltf[id] && templates[id]);
}

/**
 * @param {string} id
 * @param {string} [context]
 * @returns {THREE.Group}
 */
function requireCarModel(id, context = "spawn") {
  if (!isCarModelReady(id)) {
    const urls = (GARAGE[id] || {}).urls || [];
    throw new Error(
      `[garage] ${id}: GLB required for ${context} — procedural stand-ins are disabled.` +
        (urls.length ? ` Expected: ${urls.join(", ")}` : "")
    );
  }
  return templates[id];
}

/**
 * One unique body colour per rival slot (championship packs up to 14).
 * Solid lacquer — GLB sticker maps are stripped on rivals so each car reads
 * as a distinct colour at chase-cam distance, not eight muddy Castrol clones.
 */
export const AI_TINTS = [
  { body: 0xe01820, name: "racing-red" },
  { body: 0x1a4cdb, name: "electric-blue" },
  { body: 0xf2f0e6, name: "pearl-white" },
  { body: 0xf5c400, name: "sun-yellow" },
  { body: 0x1a1a1e, name: "carbon-black" },
  { body: 0x7a28c8, name: "royal-purple" },
  { body: 0x0c9a3c, name: "castrol-green" },
  { body: 0xff6a14, name: "rally-orange" },
  { body: 0x00b8c8, name: "cyan" },
  { body: 0xff2a7a, name: "hot-pink" },
  { body: 0x8fd400, name: "lime" },
  { body: 0x0a2a6a, name: "navy" },
  { body: 0xb87333, name: "copper" },
  { body: 0xc8ccd4, name: "silver" },
  { body: 0x5c3a1e, name: "tobacco" },
  { body: 0x2ec4b6, name: "teal" },
];

/**
 * Tint for rival index — always a unique slot colour (wraps only past palette).
 * @param {number} index
 * @returns {{body:number, name?:string}}
 */
export function aiTintForIndex(index) {
  const i = ((index | 0) % AI_TINTS.length + AI_TINTS.length) % AI_TINTS.length;
  return AI_TINTS[i];
}

/**
 * Boot loader — local GLB, then a cached drop. No procedural stand-ins.
 *
 * `onEach` fires per chassis so SELECT CAR can unlock each button as its model
 * lands, instead of every car waiting on the slowest parse.
 *
 * @param {(id: string) => void} [onEach]
 * @returns {Promise<void>}
 */
export async function prepareCelica(onEach) {
  await Promise.all(
    GARAGE_CAR_IDS.map(async (id) => {
      await prepareCar(id);
      if (onEach) {
        try {
          onEach(id);
        } catch (err) {
          console.warn("[garage] ready callback", err);
        }
      }
    })
  );
}

/**
 * Splash attract mesh — rival LOD only. The 7 MB hero + clearcoat parse was
 * freezing PRESS START / SELECT MODE while the orbit car spun. Race still
 * promotes via prepareHeroCar().
 * @param {string} [id]
 * @returns {Promise<void>}
 */
export async function prepareTitleCar(id = "celica") {
  const chassis = GARAGE[id] ? id : "celica";
  if (rivalTemplates[chassis] || templates[chassis]) return;
  // Let the splash and WebGL pad paint before any GLB parse.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (await tryRivalGltf(chassis)) return;
  // Hero only if the LOD file is missing — never preferred on the pad.
  if (await tryLocalGltf(chassis)) return;
  await tryCachedGltf(chassis);
}

/**
 * @param {string} [id]
 * @returns {boolean}
 */
export function isTitleCarReady(id) {
  const chassis = GARAGE[id] ? id : "celica";
  return !!(rivalTemplates[chassis] || templates[chassis]);
}

/**
 * Load the hero GLB for one chassis (cockpit + race mesh).
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function prepareHeroCar(id) {
  await prepareCar(GARAGE[id] ? id : "celica");
}

/**
 * Decimated pack cars for the AI grid. Skips 7 MB hero parses so a race load
 * does not compete with the selected driver's cockpit mesh.
 * @returns {Promise<void>}
 */
export async function prepareRivalLods(onEach) {
  await Promise.all(
    GARAGE_CAR_IDS.map(async (id) => {
      await tryRivalGltf(id);
      if (onEach) {
        try {
          onEach(id);
        } catch (err) {
          console.warn("[garage] LOD ready callback", err);
        }
      }
    })
  );
}

/**
 * Chassis id for a rival grid slot — cycles every loaded GLB.
 * @param {number} index
 * @returns {string}
 */
export function rivalChassisForIndex(index) {
  const pool = RIVAL_CHASSIS.filter((id) => rivalTemplates[id] || templates[id]);
  const list = pool.length ? pool : ["celica", "delta", "stratos"];
  return list[((index | 0) % list.length + list.length) % list.length];
}

/**
 * @param {string} id
 */
async function prepareCar(id) {
  // The rival LOD is independent of the hero: a missing hero must not cost the
  // pack its real bodyshell, and vice versa.
  await tryRivalGltf(id);
  if (await tryLocalGltf(id)) return;
  if (await tryCachedGltf(id)) return;
  // Keep any title/hero mesh already warm. Nulling here wiped the only
  // template after a failed re-parse and left createRivalCar with an empty garage.
  if (templates[id] || rivalTemplates[id]) {
    console.warn(
      `[garage] ${id}: hero re-load missed; keeping warm template ` +
        `(hero=${!!templates[id]} lod=${!!rivalTemplates[id]})`
    );
    return;
  }
  console.warn(
    `[garage] ${id}: no GLB found, using loaded high-quality cars only. ` +
      `Expected one of: ${(GARAGE[id] || {}).urls?.join(", ")}`
  );
  templates[id] = null;
  usingGltf[id] = false;
}

/**
 * Load the decimated pack car for one chassis.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function tryRivalGltf(id) {
  const spec = GARAGE[id];
  if (!spec || rivalTemplates[id]) return !!rivalTemplates[id];
  for (const url of spec.rivalUrls || []) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 64) continue;
      const blobUrl = URL.createObjectURL(new Blob([buf]));
      try {
        await loadRivalGltf(id, blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      return true;
    } catch (err) {
      console.warn(`[garage] ${id} rival LOD: ${url} downloaded but failed to build`, err);
    }
  }
  return false;
}

/**
 * Poll local assets so a GLB dropped into assets/ appears without a reload.
 *
 * WHY IT GIVES UP: this used to retry every missing car every 1.5 seconds for
 * the life of the page. With two cars unavailable that was ~50 failed HTTP
 * requests a minute, forever, including mid-race — measured at 74 in a 40
 * second session. A car that is genuinely absent stays absent, so after a
 * short grace period we stop asking.
 *
 * @param {(loaded: boolean) => void} [onLoad]
 * @returns {() => void} stop
 */
export function watchForCelicaFile(onLoad) {
  /** Roughly 30s of polling: long enough to catch a file being copied in. */
  const MAX_TICKS = 20;
  let ticks = 0;
  const timer = setInterval(tick, 1500);
  async function tick() {
    let got = false;
    const missing = Object.keys(GARAGE).filter((id) => !usingGltf[id]);
    for (const id of missing) {
      if (await tryLocalGltf(id)) got = true;
    }
    if (got && onLoad) onLoad(true);
    // Nothing left to find, or we have asked long enough.
    if (!missing.length || ++ticks >= MAX_TICKS) {
      clearInterval(timer);
      if (missing.length && !got) {
        console.warn(
          `[garage] stopped polling for ${missing.join(", ")} after ${ticks} attempts. ` +
            `Drop the GLB in and reload to pick it up.`
        );
      }
    }
  }
  tick();
  return () => clearInterval(timer);
}

/**
 * @param {{body?:number, stripe?:number, accent?:number}} [tint]
 * @returns {THREE.Group}
 */
export function createCelica(tint = {}) {
  return cloneCar("celica", tint);
}

/**
 * @param {string} id
 * @param {{body?:number, stripe?:number, accent?:number}} [tint]
 * @returns {THREE.Group}
 */
function cloneCar(id, tint = {}) {
  const requested = GARAGE[id] ? id : "celica";
  requireCarModel(requested, "player car");
  const clone = templates[requested].clone(true);
  clone.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      obj.material = Array.isArray(obj.material)
        ? obj.material.map((m) => m.clone())
        : obj.material.clone();
    }
  });
  if (tint.body) applyTint(clone, tint);
  rebindClonedWheels(clone);
  clone.userData.wheels = findWheels(clone);
  clone.userData.body = clone;
  clone.userData.carId = requested;
  return clone;
}

/**
 * Player car for the selected chassis.
 * @param {string} carId
 */
export function createPlayerCar(carId = "celica") {
  const root = enableCarShadows(cloneCar(carId));
  // Visual Pass V2 — player-only clearcoat. Dirt binds after applyEnvMap so
  // lacquer env intensity matches race IBL (see game.js _bindPlayerCarDirt).
  dressPlayerCarRace(root);
  const glow = new THREE.PointLight(0xff2a14, 0, 6.2, 2);
  // Deliberately left visible with zero intensity. three.js skips invisible
  // lights when it builds the light list, so toggling `visible` changes
  // NUM_POINT_LIGHTS and forces every material in the scene to recompile its
  // program — on every brake application and every release. Intensity 0 is
  // free by comparison and looks identical.
  glow.visible = true;
  attachBrakeGlow(root, glow);
  root.add(glow);
  root.userData.brakeGlow = glow;
  attachHeadBeams(root);
  attachCockpit(root);
  tagWindshield(root);
  tagInterior(root);
  tagPovShell(root);
  buildPovHideCache(root);
  if (!root.userData.povRig) root.userData.povRig = buildPovRig(root);
  setCockpitView(root, false);
  return root;
}

/**
 * Orbit-cam attract car: rival LOD first so the pad stays light. Hero is
 * fallback only when the LOD is missing. Cockpit stays hidden; race promotes.
 * @param {string} [carId]
 * @returns {THREE.Group}
 */
export function createTitleCar(carId = "celica") {
  const chassis = GARAGE[carId] ? carId : "celica";
  const template =
    rivalTemplates[chassis] ||
    rivalTemplates.celica ||
    templates[chassis] ||
    templates.celica;
  if (!template) {
    throw new Error(`[garage] ${chassis}: no hero or LOD GLB for title car`);
  }
  const clone = template.clone(true);
  clone.traverse((obj) => {
    if (obj.isMesh && obj.material) {
      obj.material = Array.isArray(obj.material)
        ? obj.material.map((m) => m.clone())
        : obj.material.clone();
    }
  });
  hideHeavyInterior(clone);
  dressTitleCarShowroom(clone);
  setCockpitView(clone, false);
  rebindClonedWheels(clone);
  clone.userData.wheels = findWheels(clone);
  clone.userData.body = clone;
  clone.userData.carId = chassis;
  clone.userData.titleLod = true;
  clone.userData.titleHero = !rivalTemplates[chassis] && !!templates[chassis];
  // Pad never bakes a sun atlas — casting shadows here still costs draw setup.
  enableCarShadows(clone);
  clone.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
    }
  });
  return clone;
}

/**
 * Race hero dress (Visual Pass V2): upgrade body paint Standard → Physical
 * clearcoat via field assign (never MeshPhysicalMaterial.copy(Standard) —
 * that crash path wiped Delta/Stratos). Glass gets a slight env bump.
 * Materials are already instance clones from cloneCar().
 * @param {THREE.Object3D} root
 */
function dressPlayerCarRace(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const list = [].concat(obj.material || []);
    const next = list.map((src) => upgradeRacePaint(src, obj));
    obj.material = next.length === 1 ? next[0] : next;
  });
}

/**
 * @param {THREE.Material} src
 * @param {THREE.Mesh} obj
 * @returns {THREE.Material}
 */
function upgradeRacePaint(src, obj) {
  if (!src) return src;
  const n = `${src.name || ""} ${obj.name || ""}`.toLowerCase();
  const lamp = /light|lamp|lens|head|tail|brake|signal/.test(n);
  const isGlass =
    !lamp &&
    (src.userData.kind === "glass" ||
      !!(src.transparent && (src.opacity == null || src.opacity < 0.9)) ||
      /glass|window|windshield|windscreen|glazing/.test(n));
  if (isGlass) {
    src.envMapIntensity = Math.max(src.envMapIntensity != null ? src.envMapIntensity : 0, 1.2);
    src.userData.kind = "glass";
    src.needsUpdate = true;
    return src;
  }
  // Sketchfab often author paint as metalness=1. Name wins over the metalness
  // heuristic — otherwise Car_Body_Paint never gets clearcoat. Stratos CAD
  // exports body albedo as wire_######## + metalness 1 (gameShade stamps chrome).
  const matName = (src.name || "").trim();
  const isWheelMesh = /wheel|tyre|tire|rim|hub|disc/.test(n);
  const isCadBody =
    !isWheelMesh &&
    (/^wire[_\d.]*$/i.test(matName) || /_lancia_stratos\d*|stratos.?body/.test(n));
  const isPaintName =
    isCadBody || /paint|lacquer|car_body|body_paint|carbody|shiny_painted/.test(n);
  const isInterior =
    /cabin|leather|cloth|suede|stitch|dial|carpet|seat|dash|interior|cockpit/.test(n);
  const isChrome =
    !isPaintName &&
    (src.userData.kind === "chrome" ||
      (/chrome|steel|alum|rim|metal|mirror|grille|exhaust/.test(n) && (src.metalness || 0) > 0.55) ||
      (!isInterior && (src.metalness || 0) > 0.72 && !/plastic|carbon|matte|matt|rubber|tyre|tire/.test(n)));
  const isRubber = src.userData.kind === "rubber" || (/tire|tyre|rubber/.test(n) && !/rim/.test(n));
  if (isChrome) {
    src.userData.kind = "chrome";
    return src;
  }
  if (isRubber) {
    src.userData.kind = "rubber";
    return src;
  }
  const wantClearcoat =
    !src.transparent &&
    src.isMeshStandardMaterial &&
    !src.isMeshPhysicalMaterial &&
    !isInterior &&
    (isPaintName ||
      src.userData.kind === "paint" ||
      src.metalness == null ||
      src.metalness < 0.55);
  if (wantClearcoat) {
    const phys = new THREE.MeshPhysicalMaterial();
    phys.name = src.name || "paint";
    phys.color.copy(src.color);
    if (src.map) phys.map = src.map;
    if (src.normalMap) {
      phys.normalMap = src.normalMap;
      if (src.normalScale) phys.normalScale.copy(src.normalScale);
    }
    if (src.roughnessMap) phys.roughnessMap = src.roughnessMap;
    if (src.metalnessMap) phys.metalnessMap = src.metalnessMap;
    if (src.aoMap) {
      phys.aoMap = src.aoMap;
      phys.aoMapIntensity = src.aoMapIntensity != null ? src.aoMapIntensity : 1;
    }
    if (src.envMap) phys.envMap = src.envMap;
    if (src.emissive) phys.emissive.copy(src.emissive);
    if (src.emissiveMap) phys.emissiveMap = src.emissiveMap;
    phys.emissiveIntensity = src.emissiveIntensity != null ? src.emissiveIntensity : 1;
    // Author metalness=1 on paint is wrong for lacquer — clamp to automotive range.
    const srcMetal = src.metalness != null ? src.metalness : 0.1;
    phys.roughness = Math.min(Math.max(src.roughness != null ? src.roughness : 0.42, 0.18), 0.42);
    phys.metalness = Math.min(Math.max(isPaintName ? Math.min(srcMetal, 0.22) : srcMetal, 0.08), 0.28);
    phys.clearcoat = 1;
    phys.clearcoatRoughness = 0.07;
    phys.clearcoatEnvMapIntensity = 1.4;
    phys.envMapIntensity = Math.max(src.envMapIntensity != null ? src.envMapIntensity : 0.4, 0.85);
    phys.side = src.side != null ? src.side : THREE.FrontSide;
    phys.userData.kind = "paint";
    phys.userData.lockEnv = false;
    phys.needsUpdate = true;
    return phys;
  }
  if (src.isMeshPhysicalMaterial && !src.transparent && !isInterior) {
    src.clearcoat = Math.max(src.clearcoat != null ? src.clearcoat : 0, 0.92);
    src.clearcoatRoughness = Math.min(src.clearcoatRoughness != null ? src.clearcoatRoughness : 0.12, 0.1);
    src.clearcoatEnvMapIntensity = Math.max(
      src.clearcoatEnvMapIntensity != null ? src.clearcoatEnvMapIntensity : 1,
      1.25
    );
    src.envMapIntensity = Math.max(src.envMapIntensity != null ? src.envMapIntensity : 0.4, 0.72);
    src.userData.kind = src.userData.kind || "paint";
    src.needsUpdate = true;
  } else if (!src.transparent && (isPaintName || src.metalness == null || src.metalness < 0.55)) {
    src.userData.kind = src.userData.kind || "paint";
  }
  return src;
}

/**
 * Title-only dress: FrontSide reflective glass, clearcoat lacquer, hide cabin
 * clutter that reads as flipped polygons through the windows. Materials are
 * already cloned for this instance — safe to mutate.
 * @param {THREE.Object3D} root
 */
function dressTitleCarShowroom(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const name = `${obj.name || ""} ${obj.parent && obj.parent.name ? obj.parent.name : ""}`.toLowerCase();
    // Cabin clutter through translucent glass = "flipped polygon" read.
    if (
      /cage|roll.?cage|roll.?bar|harness|seatbelt|seat.?belt|carpet|pedal|floorpan|cabin.?floor|interior.?trim|dashboard|dash.?board|instrument|gauge|needle|steering.?wheel|steerwheel|cabin|cockpit.?mesh|seat(?!belt)/.test(
        name
      )
    ) {
      obj.visible = false;
      obj.userData.interior = true;
      obj.userData.interiorKeepHidden = true;
      return;
    }
    const list = [].concat(obj.material || []);
    const next = list.map((src) => {
      if (!src) return src;
      const n = `${src.name || ""} ${obj.name || ""}`.toLowerCase();
      const lamp = /light|lamp|lens|head|tail|brake|signal/.test(n);
      const isGlass =
        !lamp &&
        (src.userData.kind === "glass" ||
          !!(src.transparent && (src.opacity == null || src.opacity < 0.9)) ||
          /glass|window|windshield|windscreen|glazing/.test(n));
      if (isGlass) {
        src.transparent = true;
        src.opacity = Math.min(src.opacity != null ? src.opacity : 0.38, 0.34);
        if (src.roughness != null) src.roughness = Math.min(src.roughness, 0.03);
        if (src.metalness != null) src.metalness = Math.min(src.metalness, 0.06);
        src.depthWrite = false;
        src.side = THREE.FrontSide;
        src.envMapIntensity = Math.max(src.envMapIntensity != null ? src.envMapIntensity : 0, 1.4);
        src.userData.kind = "glass";
        src.userData.lockEnv = false;
        if ("forceSinglePass" in src) src.forceSinglePass = true;
        src.needsUpdate = true;
        return src;
      }
      const isChrome =
        src.userData.kind === "chrome" ||
        (/chrome|steel|alum|rim|metal|mirror|grille|exhaust/.test(n) && (src.metalness || 0) > 0.55);
      const isRubber = src.userData.kind === "rubber" || (/tire|tyre|rubber/.test(n) && !/rim/.test(n));
      // Upgrade Standard body paint → Physical clearcoat for wet showroom lacquer.
      if (
        !isChrome &&
        !isRubber &&
        !src.transparent &&
        src.isMeshStandardMaterial &&
        !src.isMeshPhysicalMaterial &&
        (src.metalness == null || src.metalness < 0.55)
      ) {
        const phys = new THREE.MeshPhysicalMaterial();
        phys.color.copy(src.color);
        if (src.map) phys.map = src.map;
        if (src.normalMap) phys.normalMap = src.normalMap;
        if (src.roughnessMap) phys.roughnessMap = src.roughnessMap;
        if (src.metalnessMap) phys.metalnessMap = src.metalnessMap;
        if (src.aoMap) phys.aoMap = src.aoMap;
        if (src.envMap) phys.envMap = src.envMap;
        phys.roughness = Math.min(src.roughness != null ? src.roughness : 0.4, 0.2);
        phys.metalness = Math.max(src.metalness != null ? src.metalness : 0.1, 0.14);
        phys.clearcoat = 1;
        phys.clearcoatRoughness = 0.04;
        phys.clearcoatEnvMapIntensity = 1.6;
        phys.envMapIntensity = Math.max(src.envMapIntensity != null ? src.envMapIntensity : 0.5, 1.55);
        phys.userData.kind = "paint";
        phys.userData.lockEnv = false;
        phys.needsUpdate = true;
        return phys;
      }
      if (src.isMeshPhysicalMaterial && !isChrome && !isRubber && !src.transparent) {
        src.clearcoat = Math.max(src.clearcoat != null ? src.clearcoat : 0, 1);
        src.clearcoatRoughness = Math.min(src.clearcoatRoughness != null ? src.clearcoatRoughness : 0.1, 0.045);
        src.clearcoatEnvMapIntensity = Math.max(
          src.clearcoatEnvMapIntensity != null ? src.clearcoatEnvMapIntensity : 1,
          1.55
        );
        src.roughness = Math.min(src.roughness != null ? src.roughness : 0.35, 0.2);
        src.envMapIntensity = Math.max(src.envMapIntensity != null ? src.envMapIntensity : 0.5, 1.45);
        src.userData.kind = src.userData.kind || "paint";
        src.userData.lockEnv = false;
        src.needsUpdate = true;
      }
      return src;
    });
    obj.material = next.length === 1 ? next[0] : next;
  });
}

/**
 * Generic rally coupe for the AI pack. Shared geometry, unique paint.
 * Not a licensed silhouette — reads as a car rather than Saturn boxes.
 */
export function createRivalCar(tint = {}, variant = 0, chassisId = null) {
  const chassis = chassisId || rivalChassisForIndex(variant);
  const template =
    rivalTemplates[chassis] ||
    templates[chassis] ||
    rivalTemplates.celica ||
    templates.celica ||
    rivalTemplates.delta ||
    templates.delta;
  if (!template) {
    if (!warnedMissing.has("rival")) {
      warnedMissing.add("rival");
      console.error(
        "[garage] no GLB loaded for the AI pack — load celica.glb and/or delta integrale.glb"
      );
    }
    throw new Error("[garage] no GLB loaded for AI rivals");
  }
  const root = enableCarShadows(cloneRival(template, tint));
  root.userData.carId = chassis;
  return root;
}

/**
 * Clone a rival template and force a solid unique body colour.
 *
 * Authored GLB stickers stay on the player car; rivals drop body albedo maps
 * so fourteen cars are fourteen distinct colours, not one muddy livery.
 *
 * @param {THREE.Group} template
 * @param {{body?: number}} tint
 * @returns {THREE.Group}
 */
function cloneRival(template, tint = {}) {
  const clone = template.clone(true);
  const bodyHex = tint.body;
  if (bodyHex != null) {
    const targets = collectBodyMaterials(template);
    for (let ti = 0; ti < targets.length; ti++) {
      const target = targets[ti];
      const key = `${template.name}|${bodyHex}|${ti}`;
      let painted = rivalPaintCache.get(key);
      if (!painted) {
        painted = target.clone();
        // Solid lacquer — map would hide the tint under Castrol / Martini art.
        painted.map = null;
        painted.emissiveMap = null;
        if (painted.color) painted.color.setHex(bodyHex);
        else painted.color = new THREE.Color(bodyHex);
        if (painted.emissive) painted.emissive.setHex(0x000000);
        painted.needsUpdate = true;
        rivalPaintCache.set(key, painted);
      }
      clone.traverse((obj) => {
        if (!obj.isMesh) return;
        if (obj.material === target) {
          obj.material = painted;
          return;
        }
        // Cloned meshes sometimes keep array materials.
        if (Array.isArray(obj.material)) {
          obj.material = obj.material.map((m) => (m === target ? painted : m));
        }
      });
    }
  }
  rebindClonedWheels(clone);
  clone.userData.wheels = findWheels(clone);
  clone.userData.body = clone;
  clone.userData.carId = template.userData.carId;
  clone.userData.aiTint = bodyHex;
  return clone;
}

/**
 * Every opaque bodywork material on a car (not glass / rubber / chrome / wheels).
 * @param {THREE.Object3D} root
 * @returns {THREE.Material[]}
 */
function collectBodyMaterials(root) {
  /** @type {Map<THREE.Material, number>} */
  const area = new Map();
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material || !obj.geometry) return;
    const mats = [].concat(obj.material);
    const count = obj.geometry.attributes.position ? obj.geometry.attributes.position.count : 1;
    for (let i = 0; i < mats.length; i++) {
      const mat = mats[i];
      if (!mat || !isRivalBodyMaterial(mat, obj)) continue;
      area.set(mat, (area.get(mat) || 0) + count);
    }
  });
  const list = [...area.entries()]
    .sort((a, b) => b[1] - a[1])
    .map((e) => e[0]);
  if (!list.length) {
    const fallback = dominantBodyMaterial(root);
    if (fallback) list.push(fallback);
  }
  return list;
}

/**
 * @param {THREE.Material} mat
 * @param {THREE.Mesh} [mesh]
 * @returns {boolean}
 */
function isRivalBodyMaterial(mat, mesh) {
  const kind = mat.userData && mat.userData.kind;
  if (kind === "glass" || kind === "rubber" || kind === "chrome") return false;
  if (mat.transparent && (mat.opacity == null || mat.opacity < 0.95)) return false;
  const name = `${mat.name || ""} ${mesh && mesh.name ? mesh.name : ""}`.toLowerCase();
  if (/glass|window|windshield|tyre|tire|rubber|wheel|rim|brake|disc|caliper|chrome|mirror|light|lamp|bulb|emissive/.test(name)) {
    return false;
  }
  // Heuristic: very dark rubber-ish materials without maps stay off the tint list.
  if (mat.color && !mat.map) {
    const r = mat.color.r;
    const g = mat.color.g;
    const b = mat.color.b;
    const max = Math.max(r, g, b);
    if (max < 0.12 && (mat.roughness == null || mat.roughness > 0.7)) return false;
  }
  return true;
}

/**
 * The material covering the most triangles that is not glass, rubber, or trim —
 * i.e. the panel a livery should recolour.
 * @param {THREE.Group} root
 * @returns {THREE.Material|null}
 */
function dominantBodyMaterial(root) {
  if (root.userData.bodyMaterial !== undefined) return root.userData.bodyMaterial;
  const area = new Map();
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry || Array.isArray(obj.material)) return;
    const mat = obj.material;
    if (!mat) return;
    const kind = mat.userData && mat.userData.kind;
    if (kind === "glass" || kind === "rubber" || kind === "chrome") return;
    if (mat.transparent) return;
    const pos = obj.geometry.attributes.position;
    if (!pos) return;
    area.set(mat, (area.get(mat) || 0) + pos.count);
  });
  let best = null;
  let most = 0;
  for (const [mat, count] of area) {
    if (count > most) {
      most = count;
      best = mat;
    }
  }
  root.userData.bodyMaterial = best;
  return best;
}

/**
 * Dropped GLB — filename picks Celica / Delta / Stratos.
 * @param {File} file
 * @param {string} [carId]
 */
export async function loadCelicaFromFile(file, carId) {
  const id = carId || guessCarId(file.name);
  const buf = await file.arrayBuffer();
  try {
    await saveModelBuffer(id, buf);
  } catch {
    /* IndexedDB optional */
  }
  const url = URL.createObjectURL(new Blob([buf]));
  try {
    await loadCarGltf(id, url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * @param {string} filename
 */
export function guessCarId(filename) {
  const n = (filename || "").toLowerCase();
  if (/stratos/.test(n)) return "stratos";
  if (/delta|integrale/.test(n)) return "delta";
  return "celica";
}

export function isGltfCelica() {
  return !!usingGltf.celica;
}

/**
 * @param {string} [id]
 */
export function isGltfCar(id) {
  if (id) return isCarModelReady(id);
  return Object.keys(GARAGE).filter((k) => isCarModelReady(k));
}

/**
 * Garage panel summary — which chassis loaded real GLBs.
 * @returns {Array<{id:string, name:string, gltf:boolean, placeholder?:boolean}>}
 */
export function garageLoadSummary() {
  return Object.keys(GARAGE).map((id) => {
    const spec = GARAGE[id];
    const gltf = isCarModelReady(id);
    const placeholder = id === "stratos" && gltf && spec.placeholderGlb;
    return { id, name: spec.name, gltf, placeholder: !!placeholder };
  });
}

/**
 * @param {string} id
 */
async function tryLocalGltf(id) {
  const spec = GARAGE[id];
  if (!spec) return false;
  for (const url of spec.urls) {
    try {
      // Deliberately NOT cache:"no-store" — these are ~12 MB of static assets
      // and bypassing the browser cache re-downloaded all of them every load.
      const res = await fetch(url);
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (buf.byteLength < 64) continue;
      const blobUrl = URL.createObjectURL(new Blob([buf]));
      try {
        await loadCarGltf(id, blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      console.info(`[garage] ${id}: loaded ${url} (${buf.byteLength} bytes)`);
      return true;
    } catch (err) {
      // A silent catch here hid a real crash: the file downloads fine and then
      // our own post-load code throws, which is indistinguishable from "no
      // model present" unless we say so.
      console.warn(`[garage] ${id}: ${url} downloaded but failed to build`, err);
    }
  }
  return false;
}

/**
 * @param {string} id
 */
async function tryCachedGltf(id) {
  try {
    let buf = await loadModelBuffer(id);
    if ((!buf || buf.byteLength < 64) && id === "celica") buf = await loadLegacyCelica();
    if (!buf || buf.byteLength < 64) return false;
    const url = URL.createObjectURL(new Blob([buf]));
    try {
      await loadCarGltf(id, url);
      return true;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return false;
  }
}

/**
 * 1974 Stratos CAD: four meshes, one material. Two meshes are L+R wheels
 * fused on a single axle (zero verts at X=0). Split, recenter hubs, name
 * WHEEL_* so findWheels / steer / spin work like the Celica.
 * @param {THREE.Object3D} root
 * @returns {boolean}
 */
function prepStratosCadModel(root) {
  const meshes = [];
  root.traverse((obj) => {
    if (obj.isMesh) meshes.push(obj);
  });
  if (meshes.length < 2 || meshes.length > 8) return false;
  let cad = 0;
  for (let i = 0; i < meshes.length; i++) {
    const n = `${meshes[i].name || ""} ${(meshes[i].parent && meshes[i].parent.name) || ""}`;
    if (/_lancia_stratos/i.test(n)) cad += 1;
  }
  if (!cad) return false;

  for (let i = 0; i < meshes.length; i++) {
    const mesh = meshes[i];
    // CAD exporters often stamp 0.001 on the mesh (mm→m) in addition to the
    // scene scale fitToRallyCar applies. That shrinks the body to a speck
    // while split wheels (new Mesh, scale 1) stay car-sized.
    mesh.scale.set(1, 1, 1);
    if (mesh.material) {
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : mesh.material.clone();
      const mats = [].concat(mesh.material);
      for (let m = 0; m < mats.length; m++) {
        const mat = mats[m];
        if (!mat) continue;
        // CAD export ships alphaMode BLEND on a "wire" material. gameShade
        // treats that as glass at 0.48 opacity and the body disappears.
        mat.userData.cadOpaque = true;
        mat.transparent = false;
        mat.opacity = 1;
        mat.depthWrite = true;
        mat.side = THREE.DoubleSide;
        if (mat.color) mat.color.setHex(0xffffff);
      }
    }
  }

  const axles = meshes.filter(isCadTwinAxleMesh);
  if (axles.length < 2) return false;
  for (let i = 0; i < axles.length; i++) splitCadAxleMesh(axles[i]);
  root.userData.stratosCad = true;
  return true;
}

/**
 * Track-wide mesh (~1.6 m in mm) with wheel-sized height/length (~0.6 m).
 * @param {THREE.Mesh} mesh
 */
function isCadTwinAxleMesh(mesh) {
  if (!mesh.geometry) return false;
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  const sx = bb.max.x - bb.min.x;
  const sy = bb.max.y - bb.min.y;
  const sz = bb.max.z - bb.min.z;
  const dims = [sx, sy, sz].sort((a, b) => a - b);
  return dims[2] > 1200 && dims[2] < 2200 && dims[0] > 350 && dims[0] < 900 && dims[1] < 900;
}

/**
 * @param {THREE.Mesh} mesh
 */
function splitCadAxleMesh(mesh) {
  const parts = splitMeshBySignX(mesh);
  if (!parts || !mesh.parent) return;
  const parent = mesh.parent;
  const left = new THREE.Mesh(parts.left, mesh.material);
  const right = new THREE.Mesh(parts.right, mesh.material.clone());
  bakeMeshAtCenter(left);
  bakeMeshAtCenter(right);
  nameCadWheel(left);
  nameCadWheel(right);
  left.castShadow = true;
  right.castShadow = true;
  parent.add(left, right);
  parent.remove(mesh);
  if (mesh.geometry) mesh.geometry.dispose();
}

/**
 * CAD space: nose is −Y, +X is right.
 * @param {THREE.Mesh} mesh
 */
function nameCadWheel(mesh) {
  const front = mesh.position.y < 0;
  const right = mesh.position.x >= 0;
  mesh.name = `WHEEL_${front ? "F" : "R"}${right ? "R" : "L"}`;
}

/**
 * @param {THREE.Mesh} mesh
 */
function bakeMeshAtCenter(mesh) {
  mesh.geometry.computeBoundingBox();
  const c = mesh.geometry.boundingBox.getCenter(new THREE.Vector3());
  mesh.geometry.translate(-c.x, -c.y, -c.z);
  mesh.position.copy(c);
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
}

/**
 * @param {THREE.Mesh} mesh
 * @returns {{left: THREE.BufferGeometry, right: THREE.BufferGeometry}|null}
 */
function splitMeshBySignX(mesh) {
  if (!mesh.geometry || !mesh.geometry.attributes.position) return null;
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = src.attributes.position;
  const left = [];
  const right = [];
  for (let i = 0; i < pos.count; i += 3) {
    const cx = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3;
    (cx >= 0 ? right : left).push(i);
  }
  if (!left.length || !right.length) {
    if (src !== mesh.geometry) src.dispose();
    return null;
  }
  const out = { left: extractTriangles(src, left), right: extractTriangles(src, right) };
  if (src !== mesh.geometry) src.dispose();
  return out;
}

/**
 * @param {THREE.BufferGeometry} src
 * @param {number[]} starts first vertex index of each triangle
 */
function extractTriangles(src, starts) {
  const pos = src.attributes.position;
  const nrm = src.attributes.normal;
  const uv = src.attributes.uv;
  const vcount = starts.length * 3;
  const p = new Float32Array(vcount * 3);
  const n = nrm ? new Float32Array(vcount * 3) : null;
  const u = uv ? new Float32Array(vcount * 2) : null;
  let w = 0;
  for (let t = 0; t < starts.length; t++) {
    const i0 = starts[t];
    for (let k = 0; k < 3; k++) {
      const i = i0 + k;
      p[w * 3] = pos.getX(i);
      p[w * 3 + 1] = pos.getY(i);
      p[w * 3 + 2] = pos.getZ(i);
      if (n) {
        n[w * 3] = nrm.getX(i);
        n[w * 3 + 1] = nrm.getY(i);
        n[w * 3 + 2] = nrm.getZ(i);
      }
      if (u) {
        u[w * 2] = uv.getX(i);
        u[w * 2 + 1] = uv.getY(i);
      }
      w += 1;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(p, 3));
  if (n) geo.setAttribute("normal", new THREE.BufferAttribute(n, 3));
  else geo.computeVertexNormals();
  if (u) geo.setAttribute("uv", new THREE.BufferAttribute(u, 2));
  return geo;
}

/**
 * @param {string} id
 * @param {string} url
 */
async function loadCarGltf(id, url) {
  const spec = GARAGE[id] || GARAGE.celica;
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const scene = gltf.scene || gltf.scenes[0];
  const root = new THREE.Group();
  root.name = spec.name;
  root.add(scene);
  if (id === "stratos") prepStratosCadModel(root);
  gameShade(root);
  fitToRallyCar(root, spec);
  hideHeavyInterior(root);
  sanitizeGltfWheels(root);
  isolateWheelHubMaterials(root);
  // The hero car is the single biggest draw-call consumer in the frame: a raw
  // Sketchfab export is ~187 separate meshes, measured at three quarters of all
  // draw calls on Desert. Merging by material keeps every pixel identical —
  // wheels, lamps, and the POV cockpit are left addressable.
  mergeBodyPanels(root, { protectPov: true });
  root.userData.wheels = findWheels(root);
  plantOnContactPatch(root);
  root.userData.carId = spec.id;
  templates[spec.id] = root;
  usingGltf[spec.id] = true;
}

/**
 * Build the AI-pack template for one chassis from its decimated GLB.
 *
 * Same pipeline as the hero car, plus a body-panel merge: the Celica LOD is 172
 * primitives, and fourteen of those on a grid is ~2400 draw calls. Merging by
 * material takes that to roughly one draw call per material.
 *
 * @param {string} id
 * @param {string} url
 */
async function loadRivalGltf(id, url) {
  const spec = GARAGE[id] || GARAGE.celica;
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url);
  const scene = gltf.scene || gltf.scenes[0];
  const root = new THREE.Group();
  root.name = `${spec.name}-rival`;
  root.add(scene);
  if (id === "stratos") prepStratosCadModel(root);
  gameShade(root);
  fitToRallyCar(root, spec);
  hideHeavyInterior(root);
  sanitizeGltfWheels(root);
  isolateWheelHubMaterials(root);
  mergeBodyPanels(root);
  root.userData.wheels = findWheels(root);
  root.userData.carId = spec.id;
  // Re-plant after merge: helpers / baked panels can shift the bbox.
  plantOnContactPatch(root);
  rivalTemplates[spec.id] = root;
  console.info(`[garage] rival ${id}: GLB merged (${root.userData.mergedPanels || 0} panels)`);
}

/**
 * True when this object is part of a wheel, a lamp, or is hidden — anything the
 * game moves, toggles, or deliberately does not draw must stay a separate mesh.
 * @param {THREE.Object3D} obj
 * @param {THREE.Object3D} root
 * @param {boolean} protectPov keep cockpit and mirror meshes separate
 */
function isLampMaterial(obj) {
  const n = matName(obj).toLowerCase();
  if (!n || /window|interior|cabin|windshield/.test(n)) return false;
  return /^lights?[_ ]|light glass|lightbump|^light$/.test(n);
}

function isUnmergeable(obj, root, protectPov) {
  if (!obj.visible || obj.userData.interior) return true;
  if (obj.userData.brake || obj.userData.head) return true;
  // Keep lenses addressable. The Celica GLB names them `x0_light_glass_fl`
  // on a parent node (the mesh itself is Object_N), and Lights_Glass is
  // shared with the tail — merging would bake headlights into one blob and
  // the dummy fascia boxes would no longer line up with the model.
  if (isLampMaterial(obj)) return true;
  const mats = [].concat(obj.material || []);
  for (let i = 0; i < mats.length; i++) {
    const m = mats[i];
    if (!m) continue;
    if (m.userData && m.userData.kind === "glass") return true;
    if (m.userData && m.userData.windshield) return true;
  }
  for (let p = obj; p && p !== root.parent; p = p.parent) {
    const n = (p.name || "").toLowerCase();
    if (/wheel|tire|tyre|rim/.test(n)) return true;
    // Delta Integrale: nodes are "Light Rear.001" / "Light Front" on
    // Chrome Detail — material name alone does not mark them as lamps.
    if (
      /brake|tail|stop.?light|rear.?light|light.?rear|head.?light|frontlight|front.?light|light.?front|light.?glass|lightglass|_light_|lamp|number.?plate/.test(
        n
      )
    ) {
      return true;
    }
    // Cabin / exterior glass must stay separate meshes — merging transparent
    // panes into one AABB breaks sort order and draws flipped interior faces
    // in the window aperture (title orbit + rivals).
    if (
      /windshield|windscreen|window|glazing|side.?glass|(^|[^a-z])glass([^a-z]|$)/.test(n) &&
      !/light|lamp|lens|head|tail|brake/.test(n)
    ) {
      return true;
    }
    if (
      protectPov &&
      /mirror|cockpit|cabin|interior|steering.?wheel|steer.?wheel/.test(n)
    ) {
      return true;
    }
    // Celica/Accord name the rim STEER_HR, not "steering wheel".
    if (protectPov && /steer/.test(n) && !/power.?steer|rack/.test(n)) return true;
    if (p.userData && p.userData.spin) return true;
  }
  return false;
}

/**
 * Collapse the static bodyshell into one mesh per material, in place.
 *
 * Geometry is baked into root-local space first, so the merged meshes can hang
 * straight off the root while wheels keep their own transforms. Attributes are
 * normalised to position/normal/uv because mergeGeometries refuses lists whose
 * attribute sets differ, which a Sketchfab export always has.
 *
 * @param {THREE.Group} root
 * @param {{protectPov?: boolean}} [opts] set protectPov for the player's car
 */
function mergeBodyPanels(root, opts = {}) {
  const protectPov = !!opts.protectPov;
  const scratch = new THREE.Matrix4();
  try {
    root.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    /** @type {Map<THREE.Material, {geo: THREE.BufferGeometry[], mesh: THREE.Mesh[]}>} */
    const groups = new Map();

    root.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      if (Array.isArray(obj.material)) return; // multi-material: leave it alone
      if (isUnmergeable(obj, root, protectPov)) return;
      let bucket = groups.get(obj.material);
      if (!bucket) {
        bucket = { geo: [], mesh: [] };
        groups.set(obj.material, bucket);
      }
      const geo = obj.geometry.clone().applyMatrix4(scratch.copy(inverse).multiply(obj.matrixWorld));
      bucket.geo.push(normalizeForMerge(geo));
      bucket.mesh.push(obj);
    });

    let merged = 0;
    let removed = 0;
    for (const [material, bucket] of groups) {
      if (bucket.geo.length < 2) {
        for (const g of bucket.geo) g.dispose();
        continue;
      }
      const combined = mergeGeometries(bucket.geo, false);
      for (const g of bucket.geo) g.dispose();
      if (!combined) continue;
      const mesh = new THREE.Mesh(combined, material);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      root.add(mesh);
      merged++;
      for (const old of bucket.mesh) {
        if (old.parent) old.parent.remove(old);
        old.geometry.dispose();
        removed++;
      }
    }
    root.userData.mergedPanels = merged;
    root.userData.mergedFrom = removed;
  } catch (err) {
    // A failed merge is a performance problem, not a correctness one: the
    // unmerged hierarchy still renders correctly.
    console.warn("Rival body merge skipped", err);
  }
}

/**
 * Reduce a geometry to exactly position/normal/uv, non-indexed, so a list of
 * them can be merged.
 * @param {THREE.BufferGeometry} geo
 * @returns {THREE.BufferGeometry}
 */
function normalizeForMerge(geo) {
  const flat = geo.index ? geo.toNonIndexed() : geo.clone();
  if (flat !== geo) geo.dispose();
  for (const name of Object.keys(flat.attributes)) {
    if (name !== "position" && name !== "normal" && name !== "uv") flat.deleteAttribute(name);
  }
  if (flat.groups?.length) flat.clearGroups();
  if (!flat.attributes.normal) flat.computeVertexNormals();
  if (!flat.attributes.uv) {
    const count = flat.attributes.position.count;
    flat.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
  }
  flat.morphAttributes = {};
  flat.morphTargetsRelative = false;
  return flat;
}

/**
 * Keep the Sketchfab mesh intact — Physical/Standard so paint and glass reflect.
 */
function enableCarShadows(root) {
  scrubDeltaHeadArtifacts(root);
  ensureBrakeLights(root);
  ensureHeadlights(root);
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.castShadow = !obj.userData.brake && !obj.userData.head;
    obj.receiveShadow = false;
  });
  plantOnContactPatch(root);
  return root;
}

/**
 * Physics origin is the contact patch. Plant the lowest *tire rubber* at y=0.
 *
 * WHY NOT setFromObject(root): Sketchfab LODs often keep invisible axle / helper
 * meshes below the rubber. Planting on the full box lifts the visible car so
 * rivals look like they float above the ribbon.
 *
 * WHY tire meshes only: hub groups still include rims/brakes/axle scrap that
 * can sit below the tread — planting on those leaves the rubber floating.
 *
 * @param {THREE.Object3D} root
 */
function plantOnContactPatch(root) {
  root.updateMatrixWorld(true);
  let minY = Infinity;
  const wheels = root.userData && root.userData.wheels;
  const tmp = new THREE.Box3();
  const measureTire = (hub) => {
    if (!hub) return;
    let tireMin = Infinity;
    hub.traverse((obj) => {
      if (!obj.isMesh || !obj.visible || !obj.geometry) return;
      if (obj.userData && obj.userData.axleScrap) return;
      const n = `${obj.name || ""} ${matName(obj)}`.toLowerCase();
      const isTire = /tire|tyre|rubber/.test(n) && !/rim|disc|caliper|brake/.test(n);
      const isWheelBody = /wheel|tire|tyre/.test(n) && !/rim|disc|caliper|brake|hub.?cap/.test(n);
      if (!isTire && !isWheelBody) return;
      tmp.setFromObject(obj);
      if (tmp.min.y < tireMin) tireMin = tmp.min.y;
    });
    if (!Number.isFinite(tireMin)) {
      tmp.setFromObject(hub);
      tireMin = tmp.min.y;
    }
    if (tireMin < minY) minY = tireMin;
  };
  if (Array.isArray(wheels) && wheels.length) {
    for (let i = 0; i < wheels.length; i++) measureTire(wheels[i]);
  }
  if (!Number.isFinite(minY)) {
    const box = new THREE.Box3();
    let has = false;
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.visible || !obj.geometry) return;
      if (obj.userData && (obj.userData.interior || obj.userData.brake || obj.userData.head)) return;
      const b = new THREE.Box3().setFromObject(obj);
      if (!has) {
        box.copy(b);
        has = true;
      } else {
        box.union(b);
      }
    });
    minY = has ? box.min.y : 0;
  }
  // Sink past the contact plane so tread meets asphalt/dirt (not a hover gap).
  const SINK = 0.04;
  root.position.y -= minY + SINK;
  root.userData.tirePlantSink = SINK;
}

function gameShade(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    obj.frustumCulled = true;
    const list = [].concat(obj.material || []);
    const next = list.map((src) => shadeCarMaterial(src, obj));
    obj.material = next.length === 1 ? next[0] : next;
    obj.castShadow = true;
    obj.receiveShadow = false;
  });
}

/**
 * Preserve GLTF PBR maps. Lambert/Phong fallbacks become clearcoat paint.
 * @param {THREE.Material|null} src
 * @param {THREE.Mesh} obj
 */
function shadeCarMaterial(src, obj) {
  if (!src) return paint(0xcccccc);
  const n = `${src.name || ""} ${obj.name || ""}`.toLowerCase();
  const transparent = !!(src.transparent || (src.opacity != null && src.opacity < 0.9));
  const isChrome =
    /chrome|steel|alum|rim|metal|mirror|grille|exhaust/.test(n) ||
    (src.metalness != null && src.metalness > 0.62);
  const isRubber = /tire|tyre|rubber|wheel/.test(n) && !/rim/.test(n);
  const isGlass =
    !(src.userData && src.userData.cadOpaque) &&
    !isChrome &&
    !isRubber &&
    (transparent || /glass|window|windshield|windscreen|screen|lens/.test(n));

  if (src.isMeshPhysicalMaterial || src.isMeshStandardMaterial) {
    if (src.map) src.map.colorSpace = THREE.SRGBColorSpace;
    if (isChrome) {
      src.transparent = false;
      src.opacity = 1;
      src.depthWrite = true;
      src.visible = true;
      src.metalness = Math.max(src.metalness != null ? src.metalness : 0, 0.88);
      src.roughness = Math.min(src.roughness != null ? src.roughness : 1, 0.28);
      src.envMapIntensity = 0.7;
    } else if (isRubber) {
      src.transparent = false;
      src.opacity = 1;
      src.depthWrite = true;
      src.visible = true;
      src.metalness = 0.04;
      src.roughness = Math.max(src.roughness != null ? src.roughness : 0.7, 0.74);
      src.envMapIntensity = 0.15;
    } else if (isGlass) {
      src.transparent = true;
      src.opacity = Math.min(src.opacity != null ? src.opacity : 1, 0.36);
      src.roughness = Math.min(src.roughness != null ? src.roughness : 1, 0.04);
      src.metalness = Math.min(src.metalness != null ? src.metalness : 0, 0.08);
      src.envMapIntensity = Math.max(src.envMapIntensity != null ? src.envMapIntensity : 0, 1.15);
      src.depthWrite = false;
      src.side = THREE.FrontSide;
      src.userData.kind = "glass";
      src.userData.lockEnv = false;
      if ("forceSinglePass" in src) src.forceSinglePass = true;
    } else if (!src.isMeshPhysicalMaterial && (src.metalness || 0) < 0.4 && !transparent) {
      // Bodywork. This used to upgrade the material to MeshPhysicalMaterial for
      // a clearcoat lacquer, via `new MeshPhysicalMaterial().copy(src)` — which
      // throws: Physical.copy() reads clearcoatNormalScale, sheenColor, and
      // friends straight off the source, and a MeshStandardMaterial has none of
      // them. Every car whose paint had metalness below 0.4 (the Delta and the
      // Stratos, and any GLB not relying on the glTF default of 1.0) crashed
      // here and silently fell back to the procedural mesh.
      //
      // Tuning the material we already have fixes the crash, drops a full
      // second specular lobe per fragment, and matches the flat lacquer the
      // Saturn look wants in the first place.
      src.roughness = Math.min(Math.max(src.roughness != null ? src.roughness : 0.52, 0.48), 0.62);
      src.metalness = Math.min(Math.max(src.metalness != null ? src.metalness : 0.08, 0.04), 0.18);
      src.envMapIntensity = 0.4;
    } else {
      src.envMapIntensity = Math.min(src.envMapIntensity || 0.4, 0.45);
    }
    src.needsUpdate = true;
    return src;
  }

  if (isGlass) return glass(src.color ? src.color.getHex() : 0x1a2830);
  if (isChrome) return chrome(src.color ? src.color.getHex() : 0xc8c8d0);
  if (isRubber) return rubber(src.color ? src.color.getHex() : 0x111111);
  const p = paint(src.color ? src.color.getHex() : 0xffffff);
  if (src.map) {
    p.map = src.map;
    p.map.colorSpace = THREE.SRGBColorSpace;
  }
  return p;
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {string} id
 * @param {ArrayBuffer} buf
 */
async function saveModelBuffer(id, buf) {
  const spec = GARAGE[id] || GARAGE.celica;
  const db = await openIdb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(buf, spec.idbKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {string} id
 */
async function loadModelBuffer(id) {
  const spec = GARAGE[id] || GARAGE.celica;
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(spec.idbKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function loadLegacyCelica() {
  return new Promise((resolve) => {
    const req = indexedDB.open(IDB_LEGACY, 1);
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains("models")) {
          resolve(null);
          return;
        }
        const tx = db.transaction("models", "readonly");
        const get = tx.objectStore("models").get("gt4");
        get.onsuccess = () => resolve(get.result || null);
        get.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    };
  });
}

/** Studio helpers that must not drive car length or yaw. */
function isFitHelperMesh(obj) {
  const n = `${obj.name || ""} ${obj.parent && obj.parent.name ? obj.parent.name : ""}`.toLowerCase();
  return /helper|gizmo|camera|backdrop|studio|ground.?plane|shadow.?catch|grid/.test(n);
}

/**
 * Axis-aligned span of visible bodywork along a world axis.
 * @param {THREE.Object3D} root
 * @param {"x"|"y"|"z"} axis
 * @returns {number}
 */
function axisSpan(root, axis) {
  root.updateMatrixWorld(true);
  const box = visibleMeshBounds(root);
  if (axis === "x") return Math.max(box.max.x - box.min.x, 0.001);
  if (axis === "y") return Math.max(box.max.y - box.min.y, 0.001);
  return Math.max(box.max.z - box.min.z, 0.001);
}

/**
 * Visible mesh bounds — skips hidden helpers that skew length / planting.
 * @param {THREE.Object3D} root
 * @returns {THREE.Box3}
 */
function visibleMeshBounds(root) {
  const box = new THREE.Box3();
  let has = false;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.visible || !obj.geometry) return;
    if (obj.userData && (obj.userData.interior || obj.userData.brake || obj.userData.head)) return;
    if (isFitHelperMesh(obj)) return;
    const b = new THREE.Box3().setFromObject(obj);
    if (!has) {
      box.copy(b);
      has = true;
    } else {
      box.union(b);
    }
  });
  if (!has) box.setFromObject(root);
  return box;
}

/**
 * Fit a GLB into rally-car space: +Z forward, tyres on y=0, length in metres.
 *
 * Orient first, measure length along +Z, then uniform-scale the INNER scene
 * (not the wrapper). Player cockpit, lamps, and POV are parented to the
 * wrapper in metres — scaling the root made the Focus ST (authored ~11 m)
 * shrink those to 39%. Hero and rival LODs still land on config `lengthM`.
 *
 * @param {THREE.Object3D} root
 * @param {{length?:number, yaw?:number}} [spec]
 */
function fitToRallyCar(root, spec = {}) {
  const targetLen = spec.length || CARS.celica?.lengthM || 4.37;
  const inner = root.children[0] || root;
  root.rotation.set(0, 0, 0);
  root.position.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  inner.position.set(0, 0, 0);
  root.updateMatrixWorld(true);

  const box0 = visibleMeshBounds(root);
  const size0 = box0.getSize(new THREE.Vector3());
  if (size0.y === Math.max(size0.x, size0.y, size0.z) && size0.y > size0.x * 1.15) {
    inner.rotation.x += -Math.PI / 2;
    root.updateMatrixWorld(true);
  }

  if (axisSpan(root, "x") > axisSpan(root, "z") * 1.12) {
    inner.rotation.y += Math.PI / 2;
    root.updateMatrixWorld(true);
  }
  if (spec.yaw) inner.rotation.y += spec.yaw;

  root.updateMatrixWorld(true);
  const len = axisSpan(root, "z");
  if (inner === root) root.scale.setScalar(targetLen / len);
  else inner.scale.multiplyScalar(targetLen / len);
  root.userData.visualLengthM = targetLen;

  root.updateMatrixWorld(true);
  const box3 = visibleMeshBounds(root);
  const mid = box3.getCenter(new THREE.Vector3());
  const plant = new THREE.Vector3(mid.x, box3.min.y, mid.z);
  root.worldToLocal(plant);
  inner.position.sub(plant);
}

/**
 * Drop axle-wide helper meshes so they do not spin with one hub, and remember
 * the tire's axle so pose uses the same spin axis the GLB was modeled on.
 *
 * Delta Integrale Wheel_1 ships a 1.6 m-wide rim mesh under `rim_F001`. Leaving
 * it in the hub AABB made detectSpinAxis pick Z — the tire tumbled instead of
 * rolling. Hide every oversized descendant, not only direct children.
 */
function sanitizeGltfWheels(root) {
  root.updateMatrixWorld(true);
  const hubs = [];
  root.traverse((obj) => {
    if (/^wheel/i.test(obj.name || "")) hubs.push(obj);
  });
  const size = new THREE.Vector3();
  const box = new THREE.Box3();
  for (let i = 0; i < hubs.length; i++) {
    const hub = hubs[i];
    const doomed = [];
    hub.traverse((child) => {
      if (child === hub || !child.isMesh) return;
      box.setFromObject(child);
      box.getSize(size);
      // Wider than a tire+rim (~0.7 m) — axle scrap, mirrored double-rim, etc.
      if (Math.max(size.x, size.y, size.z) > 1.05) doomed.push(child);
    });
    for (let k = 0; k < doomed.length; k++) {
      const child = doomed[k];
      child.visible = false;
      child.userData.axleScrap = true;
      // Detach so later AABB / merge passes cannot re-inflate the hub.
      if (child.parent) child.parent.remove(child);
      if (child.geometry) child.geometry.dispose();
    }
  }
}

/**
 * Delta Integrale rims often share a material with tail-light glass. Brake prep
 * and gameShade opacity then make rear wheel chrome invisible while tires stay.
 * Clone every material under Wheel_* hubs so lamps cannot dim the rims.
 * @param {THREE.Object3D} root
 */
function isolateWheelHubMaterials(root) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    let underWheel = false;
    for (let p = obj.parent; p; p = p.parent) {
      if (/^wheel_/i.test(p.name || "")) {
        underWheel = true;
        break;
      }
    }
    if (!underWheel) return;
    const mats = [].concat(obj.material);
    const next = mats.map((m) => {
      if (!m) return m;
      const c = m.clone();
      c.visible = true;
      c.transparent = false;
      c.opacity = 1;
      c.depthWrite = true;
      c.needsUpdate = true;
      return c;
    });
    obj.material = next.length === 1 ? next[0] : next;
  });
}

function hideHeavyInterior(root) {
  let found = false;
  root.traverse((obj) => {
    if (obj.userData && obj.userData.povHud) return;
    const n = (obj.name || "").toLowerCase();
    // Keep modeled STEER_HR / SteeringWheel meshes; bindGlbSteeringWheel
    // reparents them for POV. Hiding the parent cockpit still strips seats.
    if (/steer/.test(n) && !/power.?steer|rack|cockpit|interior/.test(n)) return;
    // Interior rearview glass in the GLB is unlit chrome — it covers the live RT.
    // Wing / door mirrors stay; the procedural cabin rearview is the POV image.
    if (/mirror|rearview|rear.?view/.test(n) && !/wing|side|door/.test(n)) {
      obj.visible = false;
      obj.userData.interiorKeepHidden = true;
      obj.userData.interior = true;
      found = true;
      return;
    }
    if (/seat|dashboard|steering.?wheel|interior|cockpit|gauge|cluster|binnacle/.test(n)) {
      obj.visible = false;
      obj.userData.interiorKeepHidden = true;
      obj.userData.interior = true;
      found = true;
    }
  });
  root.userData.hasGlbInterior = found;
}

function findWheels(root) {
  rebindClonedWheels(root);
  root.updateMatrixWorld(true);

  const rigged = [];
  root.traverse((obj) => {
    const spin = obj.userData && obj.userData.spin;
    if (spin && spin.isObject3D && spin.parent === obj) rigged.push(obj);
  });
  if (rigged.length >= 4) {
    const hubs = sortWheelHubs(root, rigged).slice(0, 4);
    tagWheelLayout(root, hubs);
    return hubs;
  }

  const named = [];
  root.traverse((obj) => {
    const n = (obj.name || "").toLowerCase();
    if (!/wheel|tire|tyre|rim/.test(n)) return;
    if (steerAncestor(obj)) return;
    const parentHit = obj.parent && /wheel|tire|tyre|rim/.test((obj.parent.name || "").toLowerCase());
    if (parentHit) return;
    named.push(obj);
  });
  if (named.length >= 4) {
    const hubs = named.filter((obj) => /^wheel/i.test(obj.name || ""));
    const pool = hubs.length >= 4 ? hubs : named;
    const riggedNamed = sortWheelHubs(root, pool)
      .slice(0, 4)
      .map((obj) => canonicalizeWheelKnuckle(rigWheel(obj), root));
    tagWheelLayout(root, riggedNamed);
    return riggedNamed;
  }
  const stored = (root.userData.wheels || []).filter((w) => w && w.isObject3D);
  const riggedStored = stored.map((w) => canonicalizeWheelKnuckle(rigWheel(w), root));
  tagWheelLayout(root, riggedStored);
  return riggedStored;
}

/**
 * Object3D.clone JSON-serializes userData, so `spin` becomes a dead blob and
 * `restQuat` becomes `{}`. Point spin at this hub's cloned child Group and
 * give every clone its own Quaternion.
 * @param {THREE.Object3D} root
 */
function rebindClonedWheels(root) {
  root.traverse((obj) => {
    const data = obj.userData;
    if (!data) return;
    const q = data.restQuat;
    if (q && q.isQuaternion) data.restQuat = q.clone();
    else if (q && typeof q.x === "number") {
      data.restQuat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
    } else if (data.spin) {
      data.restQuat = obj.quaternion.clone();
    }
    if (data.restQuat && !data.restEuler) {
      data.restEuler = new THREE.Euler().setFromQuaternion(data.restQuat.clone(), "YXZ");
    } else if (data.restEuler && typeof data.restEuler.x === "number" && !data.restEuler.isEuler) {
      data.restEuler = new THREE.Euler(data.restEuler.x, data.restEuler.y, data.restEuler.z, data.restEuler.order || "YXZ");
    }
    const spin = data.spin;
    if (!spin) return;
    if (spin.isObject3D && spin.parent === obj) return;
    let child = null;
    for (let i = 0; i < obj.children.length; i++) {
      if (obj.children[i].isGroup) {
        child = obj.children[i];
        break;
      }
    }
    if (!child) child = obj.children[0] || null;
    if (child) data.spin = child;
    else if (!spin.isObject3D) delete data.spin;
  });
}

/**
 * Front-right, front-left, rear-right, rear-left in local car space.
 * @param {THREE.Object3D} root
 * @param {THREE.Object3D[]} hubs
 */
function sortWheelHubs(root, hubs) {
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  hubs.sort((a, b) => {
    a.getWorldPosition(pa);
    b.getWorldPosition(pb);
    root.worldToLocal(pa);
    root.worldToLocal(pb);
    const dz = pb.z - pa.z;
    if (Math.abs(dz) > 0.15) return dz;
    return pb.x - pa.x;
  });
  return hubs;
}

/**
 * Mark front/rear and left/right from chassis-local position, not GLB names.
 * Celica's WHEEL_LF sits at +X; names do not match Three.js axes.
 * @param {THREE.Object3D} root
 * @param {THREE.Object3D[]} hubs
 */
function tagWheelLayout(root, hubs) {
  const p = new THREE.Vector3();
  let zMin = Infinity;
  let zMax = -Infinity;
  for (let i = 0; i < hubs.length; i++) {
    hubs[i].getWorldPosition(p);
    root.worldToLocal(p);
    if (p.z < zMin) zMin = p.z;
    if (p.z > zMax) zMax = p.z;
  }
  const zMid = (zMin + zMax) * 0.5;
  for (let i = 0; i < hubs.length; i++) {
    const hub = hubs[i];
    hub.getWorldPosition(p);
    root.worldToLocal(p);
    hub.userData.front = p.z >= zMid - 0.05;
    hub.userData.side = p.x >= 0 ? 1 : -1;
    // Default: same signed axle spin for both sides (mirrored tire meshes).
    if (hub.userData.spinSign == null) hub.userData.spinSign = 1;
  }
}

function steerAncestor(obj) {
  let p = obj.parent;
  while (p) {
    if (p.userData && p.userData.spin && p.userData.spin.isObject3D) return p;
    p = p.parent;
  }
  return null;
}

/**
 * Steer yaw on the outer hub, spin on the inner hub — never Euler-compose both
 * on the same object (that tumbles the axle).
 * @param {THREE.Object3D} obj
 */
function rigWheel(obj) {
  const already = steerAncestor(obj);
  if (already) return already;
  const liveSpin = obj.userData.spin;
  if (liveSpin && liveSpin.isObject3D && liveSpin.parent === obj) return obj;
  if (obj.parent && obj.parent.userData.spin === obj) return obj.parent;
  const parent = obj.parent;
  if (!parent) {
    obj.userData.spin = obj;
    obj.userData.spinAxis = detectSpinAxis(obj);
    obj.userData.restQuat = obj.quaternion.clone();
    return obj;
  }
  const steer = new THREE.Group();
  steer.position.copy(obj.position);
  steer.rotation.copy(obj.rotation);
  parent.add(steer);
  obj.position.set(0, 0, 0);
  obj.rotation.set(0, 0, 0);
  const spin = new THREE.Group();
  steer.add(spin);
  spin.add(obj);
  steer.userData.spin = spin;
  steer.userData.spinAxis = detectSpinAxis(obj);
  // Rest pose before steer/anti-roll — needed so GLB alignment survives.
  steer.userData.restQuat = steer.quaternion.clone();
  steer.userData.restEuler = new THREE.Euler().setFromQuaternion(steer.userData.restQuat.clone(), "YXZ");
  return steer;
}

const _bindQuat = new THREE.Quaternion();
const _bindFwd = new THREE.Vector3();

/**
 * GLB / CAD wheels often ship with the tire disc in YZ or XY — steering around
 * chassis Y then reads as camber instead of yaw. Bind the tire mesh inside the
 * spin group so the axle is +X and lock stays parent-space yaw.
 * @param {THREE.Object3D} steerHub knuckle from rigWheel
 * @param {THREE.Object3D} root car root for forward check
 * @returns {THREE.Object3D}
 */
function canonicalizeWheelKnuckle(steerHub, root) {
  const data = steerHub.userData || {};
  if (data.canonicalWheel) return steerHub;
  const spin = data.spin;
  if (!spin || !spin.isObject3D) return steerHub;

  let tire = null;
  spin.traverse((c) => {
    if (!c.isMesh || c.userData.axleScrap || !c.visible) return;
    if (!tire || /tire|tyre/i.test(c.name || "")) tire = c;
  });
  if (!tire) return steerHub;

  tire.rotation.set(0, 0, 0);
  tire.quaternion.identity();
  const axis = detectSpinAxis(tire);
  if (axis === "x" && !root.userData.stratosCad) {
    data.canonicalWheel = true;
    return steerHub;
  }
  if (axis === "y") {
    _bindQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
  } else if (axis === "z") {
    _bindQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  } else {
    _bindQuat.identity();
  }
  tire.quaternion.copy(_bindQuat);

  _bindFwd.set(0, 0, 1).applyQuaternion(tire.quaternion);
  if (_bindFwd.z < 0) tire.rotateX(Math.PI);

  data.spinAxis = "x";
  if (data.spinSign == null) data.spinSign = 1;
  data.restQuat = new THREE.Quaternion();
  data.restEuler = new THREE.Euler(0, 0, 0, "YXZ");
  data.canonicalWheel = true;
  steerHub.quaternion.identity();
  steerHub.rotation.set(0, 0, 0);
  return steerHub;
}

/**
 * Tire width is the short axis — that is the axle we spin around.
 * Prefer visible tire meshes; ignore hidden axle scrap that blew out the AABB.
 * @param {THREE.Object3D} obj
 * @returns {"x"|"y"|"z"}
 */
function detectSpinAxis(obj) {
  const size = new THREE.Vector3();
  const box = new THREE.Box3();
  const meshBox = new THREE.Box3();
  let any = false;
  let tire = null;
  obj.traverse((c) => {
    if (!c.isMesh || !c.visible || c.userData.axleScrap) return;
    if (/tire|tyre/i.test(c.name || "")) tire = c;
    meshBox.setFromObject(c);
    meshBox.getSize(size);
    if (Math.max(size.x, size.y, size.z) > 1.05) return;
    if (!any) {
      box.copy(meshBox);
      any = true;
    } else {
      box.union(meshBox);
    }
  });
  if (!any && tire) {
    box.setFromObject(tire);
    any = true;
  }
  if (!any) box.setFromObject(obj);
  box.getSize(size);
  // Rally tire: short lateral axle, roughly circular in the other two.
  if (size.x <= size.y && size.x <= size.z) return "x";
  if (size.y <= size.x && size.y <= size.z) return "y";
  return "z";
}

const _steerAxis = new THREE.Vector3(0, 1, 0);
const _rollAxis = new THREE.Vector3(0, 0, 1);
const _qSteer = new THREE.Quaternion();
const _qRoll = new THREE.Quaternion();
const _wheelPose = new THREE.Quaternion();

/** Outer front lock as a fraction of the inner wheel. Subtle, not cartoon Ackermann. */
const ACKERMANN = 0.12;

/**
 * Drive wheel spin and front steer. Steering yaws the knuckle around chassis
 * UP; spin stays on the inner hub around the axle. Never Euler-compose both
 * on one object.
 *
 * HOW IT WORKS: Celica wheel hubs rest at 90° about local X so the tire
 * mesh's axle matches the car. Steering around that hub's local Y after rest
 * is actually chassis Z — camber — which is why lock leaned the tire onto
 * its sidewall. Pose is parent-space: rollCancel * steerYaw * rest. Rest
 * (camber, caster, mesh bind) is unchanged by lock. Body roll is undone
 * about chassis Z so hull lean is not painted onto the rubber.
 *
 * Chassis roll still lifts the high-side hub in world Y (rotation about the
 * contact origin). Subtract `x·tan(roll)` from local Y so tread stays on the
 * deck while the body leans — otherwise drifts read as floating tires.
 *
 * Front lock uses a small Ackermann split so the inner wheel turns a little
 * more than the outer. Physics steer is not modified.
 *
 * @param {THREE.Object3D[]} wheels
 * @param {number[]} spinArr
 * @param {number} steer
 * @param {number} [chassisRoll=0] vehicle.roll, radians
 * @param {number[]} [wheelY] per-wheel suspension offset (metres, + = hub down)
 */
export function applyWheelPose(wheels, spinArr, steer, chassisRoll = 0, wheelY = null) {
  _qRoll.setFromAxisAngle(_rollAxis, -chassisRoll);
  const roll = Number.isFinite(chassisRoll) ? chassisRoll : 0;
  const rollClamped = Math.max(-0.45, Math.min(0.45, roll));
  const tanRoll = Math.tan(rollClamped);
  for (let i = 0; i < wheels.length; i++) {
    const w = wheels[i];
    if (!w || !w.quaternion) continue;
    const data = w.userData || {};
    if (data.restPosY == null && w.position) data.restPosY = w.position.y;
    if (data.restPosX == null && w.position) data.restPosX = w.position.x;
    if (data.restPosY != null) {
      const travel = wheelY && wheelY[i] != null ? wheelY[i] : 0;
      // Cancel parent-roll world lift so rubber stays on the roadway.
      const xLat = data.restPosX != null ? data.restPosX : 0;
      const rollPlant = Math.max(-0.14, Math.min(0.14, tanRoll * xLat));
      w.position.y = data.restPosY - travel - rollPlant;
    }
    const isFront = data.front === true || (data.front == null && i < 2);
    const side = data.side === -1 ? -1 : data.side === 1 ? 1 : i % 2 === 0 ? 1 : -1;
    let steerY = 0;
    if (isFront) {
      // Left turn (steer > 0): inner is left (side -1). Right turn: inner is right.
      const inner = (steer >= 0 && side < 0) || (steer < 0 && side > 0);
      steerY = inner ? steer : steer * (1 - ACKERMANN);
    }
    _qSteer.setFromAxisAngle(_steerAxis, steerY);
    // Parent axes: cancel hull roll, then yaw, then the modeled rest pose.
    _wheelPose.copy(_qRoll).multiply(_qSteer);
    const rest = data.restQuat;
    if (rest && rest.isQuaternion) w.quaternion.copy(_wheelPose).multiply(rest);
    else w.quaternion.copy(_wheelPose);
    const spin = data.spin;
    const hub = spin && spin.isObject3D && spin.rotation ? spin : null;
    if (!hub || hub === w) continue;
    const axis = data.spinAxis || "x";
    // Mirrored L/R tire meshes share a local +X axle; same signed spin rolls
    // both sides forward. Only invert when the hub was authored flipped on Z.
    const sign = data.spinSign != null ? data.spinSign : 1;
    const ang = (spinArr[i] || 0) * sign;
    hub.rotation.x = axis === "x" ? ang : 0;
    hub.rotation.y = axis === "y" ? ang : 0;
    hub.rotation.z = axis === "z" ? ang : 0;
  }
}

function applyTint(root, tint) {
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = [].concat(obj.material);
    for (const m of mats) {
      // Wheels, glass, and trim are one material shared by the whole grid now.
      // Tinting them here would repaint every car on the track fifteen times.
      if (m.userData && m.userData.shared) continue;
      if (!m.color || m.map) {
        if (m.color && tint.body) m.color.lerp(new THREE.Color(tint.body), 0.35);
        continue;
      }
      if (tint.body) m.color.setHex(tint.body);
    }
  });
}

function box(w, h, d, color, x, y, z, rx = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), paint(color));
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  return mesh;
}

function cyl(rTop, rBot, h, color, x, y, z, rx = 0, rz = 0, segs = 8) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(rTop, rBot, h, segs),
    paint(color)
  );
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  mesh.rotation.z = rz;
  return mesh;
}

function makeWheel(rimHex, hubHex, rubberHex) {
  return makeRallyWheel(rimHex, hubHex, rubberHex, true, 1);
}

/** Shared wheel buffers — player + 14 rivals. */
let wheelShare = null;

/**
 * The wheel, built once for every car on the grid.
 *
 * WHAT THIS REPLACED: a torus tire (12 x 28 = 672 triangles), a 24-sided rim,
 *   a dish, a brake disc, five or six spoke boxes, a UV-sphere hub, and on the
 *   player a caliper plus five more spheres — thirteen to nineteen separate
 *   meshes per corner. Four corners on fifteen cars came to roughly 780 draw
 *   calls and 60,000 triangles of wheel before anything else was on screen.
 *
 * WHAT IT IS NOW: one eight-sided drum, 96 triangles, two draw calls (rubber,
 *   then rim). The tread carries smooth radial normals so the eight facets
 *   light as a curve rather than as a stop sign, and the spokes are painted
 *   into the vertex colours of the rim face. That is exactly the trick AM3
 *   used on the Saturn — octagonal wheels shaded to read as round
 *   (docs/AM3-RESEARCH.md section 5) — and here it is also the cheapest thing
 *   on the car.
 */
function getWheelShare() {
  if (wheelShare) return wheelShare;
  wheelShare = {
    geo: buildOctagonWheelGeometry(),
    tireMap: makeTireMap(),
    /** @type {Map<string, THREE.Material>} rim material, cached per colour pair */
    rims: new Map(),
    /** @type {THREE.Material|null} */
    tread: null,
  };
  return wheelShare;
}

/** Facets around the wheel. Eight is the number the reference used. */
const WHEEL_FACETS = 8;

/**
 * Octagonal wheel drum on the X axis, in two material groups:
 * group 0 = tread and sidewalls (rubber), group 1 = rim face (bright trim).
 *
 * Vertex colours carry the spoke pattern, so fifteen cars in eight liveries
 * still share this one geometry.
 * @returns {THREE.BufferGeometry}
 */
function buildOctagonWheelGeometry() {
  const R = 0.252;
  const RIM = 0.172;
  const HUB = 0.104;
  const HW = 0.098;
  const FACE = HW - 0.01;
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const groupA = []; // rubber triangle count tracked by vertex pushes
  let rubberVerts = 0;

  /** Push one triangle with per-vertex normals, uvs, and colours. */
  const tri = (p0, n0, uv0, c0, p1, n1, uv1, c1, p2, n2, uv2, c2) => {
    pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
    nor.push(n0[0], n0[1], n0[2], n1[0], n1[1], n1[2], n2[0], n2[1], n2[2]);
    uv.push(uv0[0], uv0[1], uv1[0], uv1[1], uv2[0], uv2[1]);
    col.push(c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]);
  };
  const quad = (a, na, ua, ca, b, nb, ub, cb, c, nc, uc, cc, d, nd, ud, cd) => {
    tri(a, na, ua, ca, b, nb, ub, cb, c, nc, uc, cc);
    tri(a, na, ua, ca, c, nc, uc, cc, d, nd, ud, cd);
  };

  const ring = [];
  for (let j = 0; j <= WHEEL_FACETS; j++) {
    const a = (j / WHEEL_FACETS) * Math.PI * 2;
    ring.push({ c: Math.cos(a), s: Math.sin(a), u: j / WHEEL_FACETS });
  }

  // --- Tread: outer band. Radial normals per vertex make the octagon read
  // as a cylinder under the sun without adding a single triangle.
  for (let j = 0; j < WHEEL_FACETS; j++) {
    const a = ring[j];
    const b = ring[j + 1];
    const na = [0, a.c, a.s];
    const nb = [0, b.c, b.s];
    const white = [1, 1, 1];
    quad(
      [-HW, a.c * R, a.s * R], na, [a.u, 0], white,
      [HW, a.c * R, a.s * R], na, [a.u, 1], white,
      [HW, b.c * R, b.s * R], nb, [b.u, 1], white,
      [-HW, b.c * R, b.s * R], nb, [b.u, 0], white
    );
  }
  // --- Sidewalls: tread edge in to the rim lip, on both faces.
  for (const side of [-1, 1]) {
    const nx = [side, 0, 0];
    const shade = [0.62, 0.62, 0.62];
    for (let j = 0; j < WHEEL_FACETS; j++) {
      const a = ring[j];
      const b = ring[j + 1];
      const outerA = [side * HW, a.c * R, a.s * R];
      const outerB = [side * HW, b.c * R, b.s * R];
      const innerA = [side * FACE, a.c * RIM, a.s * RIM];
      const innerB = [side * FACE, b.c * RIM, b.s * RIM];
      if (side > 0) {
        quad(outerA, nx, [0, 0], shade, innerA, nx, [0, 1], shade, innerB, nx, [1, 1], shade, outerB, nx, [1, 0], shade);
      } else {
        quad(outerA, nx, [0, 0], shade, outerB, nx, [1, 0], shade, innerB, nx, [1, 1], shade, innerA, nx, [0, 1], shade);
      }
    }
  }
  rubberVerts = pos.length / 3;

  // --- Rim face: an outer ring of alternating light/dark facets (the painted
  // spokes) and a darker inner disc standing in for the brake hardware.
  for (const side of [-1, 1]) {
    const nx = [side, 0, 0];
    for (let j = 0; j < WHEEL_FACETS; j++) {
      const a = ring[j];
      const b = ring[j + 1];
      const lit = j % 2 === 0 ? 1.0 : 0.52;
      const spoke = [lit, lit, lit];
      const outerA = [side * FACE, a.c * RIM, a.s * RIM];
      const outerB = [side * FACE, b.c * RIM, b.s * RIM];
      const innerA = [side * FACE, a.c * HUB, a.s * HUB];
      const innerB = [side * FACE, b.c * HUB, b.s * HUB];
      if (side > 0) {
        quad(outerA, nx, [0, 0], spoke, innerA, nx, [0, 1], spoke, innerB, nx, [1, 1], spoke, outerB, nx, [1, 0], spoke);
      } else {
        quad(outerA, nx, [0, 0], spoke, outerB, nx, [1, 0], spoke, innerB, nx, [1, 1], spoke, innerA, nx, [0, 1], spoke);
      }
      const hubShade = [0.3, 0.3, 0.32];
      const centre = [side * FACE, 0, 0];
      if (side > 0) tri(innerA, nx, [0, 0], hubShade, centre, nx, [0.5, 0.5], hubShade, innerB, nx, [1, 0], hubShade);
      else tri(innerA, nx, [0, 0], hubShade, innerB, nx, [1, 0], hubShade, centre, nx, [0.5, 0.5], hubShade);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const total = pos.length / 3;
  geo.addGroup(0, rubberVerts, 0);
  geo.addGroup(rubberVerts, total - rubberVerts, 1);
  geo.computeBoundingSphere();
  geo.userData.shared = true;
  void groupA;
  return geo;
}

/**
 * Circumferential tread so tires read as rubber, not plastic tubes.
 */
function makeTireMap() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#141414";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#2a2a2a";
  for (let y = 4; y < 64; y += 8) g.fillRect(0, y, 64, 3);
  g.fillStyle = "#0c0c0c";
  for (let x = 0; x < 64; x += 7) g.fillRect(x, 0, 2, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(6, 2);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  return tex;
}

/**
 * Gold-BBS-style rally wheel: torus tire, dish, 5 spokes, brake disc.
 * Spin group rotates on X; steer group yaws. Same contract as the old cylinder.
 * @param {number} rimHex
 * @param {number} hubHex
 * @param {number} rubberHex
 * @param {boolean} [detail]
 */
function makeRallyWheel(rimHex, hubHex, rubberHex, detail = false, side = 1) {
  const geos = getWheelShare();
  const steer = new THREE.Group();
  const spin = new THREE.Group();

  if (!geos.tread) {
    const tread = rubber(0xf0f0f0);
    tread.map = geos.tireMap;
    tread.vertexColors = true;
    tread.userData.shared = true;
    // vertexColors is a shader define, so flipping it after construction needs
    // an explicit recompile flag.
    tread.needsUpdate = true;
    geos.tread = tread;
  }
  const rimKey = `${rimHex}|${hubHex}`;
  let rimMat = geos.rims.get(rimKey);
  if (!rimMat) {
    rimMat = chrome(rimHex);
    rimMat.vertexColors = true;
    rimMat.userData.shared = true;
    rimMat.needsUpdate = true;
    geos.rims.set(rimKey, rimMat);
  }

  const wheel = new THREE.Mesh(geos.geo, [geos.tread, rimMat]);
  // Rubber colour lives on the shared tread material, so a car that wants a
  // different compound colour gets it from the tint pass, not a new material.
  void rubberHex;
  void detail;
  void side;
  spin.add(wheel);
  steer.add(spin);
  steer.userData.spin = spin;
  steer.userData.spinAxis = "x";
  steer.userData.restQuat = new THREE.Quaternion();
  return steer;
}

/** @type {THREE.BufferGeometry|null} */
let LAMP_GEO = null;

/**
 * One low-poly lens blob shared by every head- and brake-lamp on the grid.
 * Sixty lamps at 384 triangles each was 23k triangles of light bulb; at this
 * size on screen an 8x6 sphere is indistinguishable.
 * @returns {THREE.BufferGeometry}
 */
function lampGeometry() {
  if (!LAMP_GEO) {
    LAMP_GEO = new THREE.SphereGeometry(0.5, 8, 6);
    LAMP_GEO.userData.shared = true;
  }
  return LAMP_GEO;
}

/** @type {THREE.Material|null} */
let RIVAL_GLASS = null;
/** @type {THREE.Material|null} */
let RIVAL_DARK = null;
/** @type {THREE.Material|null} */
let RIVAL_TRIM = null;

/** Tinted rival glass. One material for the whole grid. */
function rivalGlass() {
  if (!RIVAL_GLASS) {
    RIVAL_GLASS = glass(0x1c2a33, { opacity: 0.4 });
    RIVAL_GLASS.userData.shared = true;
  }
  return RIVAL_GLASS;
}

/** Rubber and plastic trim — lips, grilles, mirror housings. */
function rivalDark() {
  if (!RIVAL_DARK) {
    RIVAL_DARK = rubber(0x161618);
    RIVAL_DARK.userData.shared = true;
  }
  return RIVAL_DARK;
}

/** Bright bits — mirror faces, exhaust tip. */
function rivalTrim() {
  if (!RIVAL_TRIM) {
    RIVAL_TRIM = chrome(0xb0b4bc);
    RIVAL_TRIM.userData.shared = true;
  }
  return RIVAL_TRIM;
}

const _partMatrix = new THREE.Matrix4();
const _partQuat = new THREE.Quaternion();
const _partEuler = new THREE.Euler();
const _partPos = new THREE.Vector3();
const _partScale = new THREE.Vector3();

/**
 * Bake a set of rigidly-placed parts into a single mesh.
 *
 * Every part is cloned, transformed into car space, stripped down to position
 * and normal (nothing here is textured), and merged. If the merge fails for
 * any reason the parts are added individually instead, so a car is never
 * missing its bumper because BufferGeometryUtils disagreed about attributes.
 *
 * @param {THREE.Object3D} parent
 * @param {THREE.Material} mat
 * @param {Array<{geo: THREE.BufferGeometry, x?:number, y?:number, z?:number, rx?:number, ry?:number, rz?:number, sx?:number, sy?:number, sz?:number}>} parts
 * @param {{name?: string, userData?: object}} [extra]
 */
function addMergedRole(parent, mat, parts, extra) {
  if (!parts.length) return;
  try {
    const prepared = [];
    for (const part of parts) {
      _partEuler.set(part.rx || 0, part.ry || 0, part.rz || 0);
      _partQuat.setFromEuler(_partEuler);
      _partPos.set(part.x || 0, part.y || 0, part.z || 0);
      _partScale.set(part.sx != null ? part.sx : 1, part.sy != null ? part.sy : 1, part.sz != null ? part.sz : 1);
      _partMatrix.compose(_partPos, _partQuat, _partScale);
      const g = part.geo.clone().toNonIndexed();
      for (const key of Object.keys(g.attributes)) {
        if (key !== "position" && key !== "normal") g.deleteAttribute(key);
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      g.applyMatrix4(_partMatrix);
      // A negative scale flips winding; recomputing normals keeps the mirrored
      // side glass lit the same way as its twin.
      if (_partScale.x * _partScale.y * _partScale.z < 0) g.computeVertexNormals();
      prepared.push(g);
    }
    const merged = mergeGeometries(prepared, false);
    if (!merged) throw new Error("mergeGeometries returned null");
    merged.computeBoundingSphere();
    parent.add(stampCabinGlass(new THREE.Mesh(merged, mat), extra));
    return;
  } catch (err) {
    console.warn("Rival part merge failed; falling back to loose meshes", err);
  }
  for (const part of parts) {
    const mesh = new THREE.Mesh(part.geo, mat);
    mesh.position.set(part.x || 0, part.y || 0, part.z || 0);
    mesh.rotation.set(part.rx || 0, part.ry || 0, part.rz || 0);
    mesh.scale.set(part.sx != null ? part.sx : 1, part.sy != null ? part.sy : 1, part.sz != null ? part.sz : 1);
    parent.add(stampCabinGlass(mesh, extra));
  }
}

/**
 * @param {THREE.Mesh} mesh
 * @param {{name?: string, userData?: object}|null} extra
 */
function stampCabinGlass(mesh, extra) {
  if (!extra) return mesh;
  if (extra.name) mesh.name = extra.name;
  if (extra.userData) Object.assign(mesh.userData, extra.userData);
  return mesh;
}

/** Shared rival buffers — 15 clones, one upload. */
let rivalShare = null;

function getRivalShare() {
  if (rivalShare) return rivalShare;
  rivalShare = {
    hull: makeRivalHullGeo(),
    hatch: makeHatchHullGeo(),
    wedge: makeWedgeHullGeo(),
    roof: makeRivalRoofGeo(),
    roofHatch: makeHatchRoofGeo(),
    roofWedge: makeWedgeRoofGeo(),
    glassF: makeQuadGeo(
      [-0.62, 0.68, 0.48],
      [0.62, 0.68, 0.48],
      [0.52, 1.22, 0.08],
      [-0.52, 1.22, 0.08]
    ),
    glassR: makeQuadGeo(
      [0.58, 0.66, -1.08],
      [-0.58, 0.66, -1.08],
      [-0.5, 1.16, -0.88],
      [0.5, 1.16, -0.88]
    ),
    glassS: makeQuadGeo(
      [0, 0.66, 0.28],
      [0, 0.66, -0.92],
      [0, 1.16, -0.82],
      [0, 1.2, 0.08]
    ),
    lip: new THREE.BoxGeometry(1.62, 0.08, 0.16),
    grille: new THREE.BoxGeometry(0.72, 0.16, 0.06),
    mirror: new THREE.BoxGeometry(0.16, 0.09, 0.07),
    mirrorGlass: new THREE.PlaneGeometry(0.1, 0.07),
    spoiler: new THREE.BoxGeometry(1.32, 0.04, 0.24),
    skirt: new THREE.BoxGeometry(0.07, 0.09, 1.55),
    plate: new THREE.BoxGeometry(0.36, 0.1, 0.03),
    bumper: new THREE.BoxGeometry(1.72, 0.14, 0.2),
    pillar: new THREE.BoxGeometry(0.05, 0.64, 0.08),
    exhaust: new THREE.CylinderGeometry(0.035, 0.04, 0.18, 10),
  };
  return rivalShare;
}

/**
 * Closed loft from right-half cross-sections. +Z is the nose.
 * @param {{z:number, half:number[][]}[]} stations
 */
function makeLoftGeo(stations) {
  const rings = stations.map((s) => ringFromHalf(s.z, s.half));
  const n = rings[0].length;
  const pos = [];
  for (let r = 0; r < rings.length; r++) {
    for (let i = 0; i < n; i++) {
      const p = rings[r][i];
      pos.push(p[0], p[1], p[2]);
    }
  }
  const idx = [];
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = r * n + i;
      const b = r * n + j;
      const c = (r + 1) * n + j;
      const d = (r + 1) * n + i;
      idx.push(a, d, c, a, c, b);
    }
  }
  capRing(idx, 0, n, false);
  capRing(idx, (rings.length - 1) * n, n, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function ringFromHalf(z, half) {
  const ring = [];
  for (let i = 0; i < half.length; i++) ring.push([half[i][0], half[i][1], z]);
  for (let i = half.length - 2; i >= 1; i--) ring.push([-half[i][0], half[i][1], z]);
  return ring;
}

function capRing(idx, start, n, reverse) {
  for (let i = 1; i < n - 1; i++) {
    if (reverse) idx.push(start, start + i + 1, start + i);
    else idx.push(start, start + i, start + i + 1);
  }
}

function makeQuadGeo(a, b, c, d) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3)
  );
  geo.computeVertexNormals();
  return geo;
}

function makeRivalHullGeo() {
  const h = (keelY, sillX, sillY, flankX, flankY, shX, shY, railX, railY, crownY) => [
    [0.05, keelY],
    [sillX, sillY],
    [flankX, flankY],
    [shX, shY],
    [railX, railY],
    [0.05, crownY],
  ];
  return makeLoftGeo([
    { z: 2.1, half: h(0.15, 0.52, 0.15, 0.68, 0.28, 0.66, 0.42, 0.36, 0.48, 0.48) },
    { z: 1.88, half: h(0.14, 0.76, 0.14, 0.86, 0.34, 0.84, 0.52, 0.44, 0.58, 0.58) },
    { z: 1.52, half: h(0.15, 0.58, 0.15, 0.9, 0.38, 0.86, 0.56, 0.5, 0.62, 0.62) },
    { z: 1.28, half: h(0.16, 0.48, 0.16, 0.94, 0.42, 0.88, 0.58, 0.52, 0.64, 0.64) },
    { z: 0.72, half: h(0.16, 0.82, 0.16, 0.9, 0.4, 0.86, 0.62, 0.7, 0.66, 0.66) },
    { z: 0.12, half: h(0.16, 0.84, 0.16, 0.9, 0.4, 0.86, 0.62, 0.8, 0.62, 0.62) },
    { z: -0.72, half: h(0.16, 0.84, 0.16, 0.9, 0.4, 0.86, 0.62, 0.8, 0.62, 0.62) },
    { z: -1.28, half: h(0.16, 0.5, 0.16, 0.94, 0.42, 0.9, 0.58, 0.68, 0.62, 0.62) },
    { z: -1.7, half: h(0.17, 0.78, 0.17, 0.86, 0.36, 0.82, 0.54, 0.58, 0.58, 0.58) },
    { z: -2.06, half: h(0.18, 0.6, 0.18, 0.74, 0.3, 0.72, 0.48, 0.48, 0.52, 0.52) },
  ]);
}

function makeRivalRoofGeo() {
  return makeLoftGeo([
    { z: 0.12, half: [[0.06, 1.18], [0.52, 1.18], [0.54, 1.24], [0.06, 1.26]] },
    { z: -0.4, half: [[0.06, 1.18], [0.56, 1.18], [0.58, 1.24], [0.06, 1.26]] },
    { z: -0.9, half: [[0.06, 1.14], [0.5, 1.14], [0.52, 1.2], [0.06, 1.22]] },
  ]);
}

function makeHatchHullGeo() {
  const h = (keelY, sillX, sillY, flankX, flankY, shX, shY, railX, railY, crownY) => [
    [0.05, keelY],
    [sillX, sillY],
    [flankX, flankY],
    [shX, shY],
    [railX, railY],
    [0.05, crownY],
  ];
  return makeLoftGeo([
    { z: 1.92, half: h(0.18, 0.58, 0.18, 0.72, 0.34, 0.7, 0.52, 0.4, 0.58, 0.58) },
    { z: 1.55, half: h(0.16, 0.78, 0.16, 0.88, 0.4, 0.84, 0.6, 0.5, 0.68, 0.68) },
    { z: 1.18, half: h(0.16, 0.48, 0.16, 0.94, 0.46, 0.9, 0.64, 0.72, 0.74, 0.74) },
    { z: 0.45, half: h(0.16, 0.84, 0.16, 0.92, 0.44, 0.88, 0.7, 0.8, 0.78, 0.78) },
    { z: -0.35, half: h(0.16, 0.84, 0.16, 0.92, 0.44, 0.88, 0.7, 0.8, 0.78, 0.78) },
    { z: -1.12, half: h(0.16, 0.5, 0.16, 0.94, 0.48, 0.9, 0.66, 0.74, 0.76, 0.76) },
    { z: -1.55, half: h(0.18, 0.8, 0.18, 0.88, 0.42, 0.84, 0.7, 0.7, 0.82, 0.82) },
    { z: -1.92, half: h(0.2, 0.7, 0.2, 0.78, 0.38, 0.74, 0.68, 0.58, 0.78, 0.78) },
  ]);
}

function makeHatchRoofGeo() {
  return makeLoftGeo([
    { z: 0.18, half: [[0.06, 1.22], [0.58, 1.22], [0.6, 1.3], [0.06, 1.32]] },
    { z: -0.55, half: [[0.06, 1.24], [0.6, 1.24], [0.62, 1.32], [0.06, 1.34]] },
    { z: -1.15, half: [[0.06, 1.18], [0.56, 1.18], [0.58, 1.28], [0.06, 1.3]] },
  ]);
}

function makeWedgeHullGeo() {
  const h = (keelY, sillX, sillY, flankX, flankY, shX, shY, railX, railY, crownY) => [
    [0.05, keelY],
    [sillX, sillY],
    [flankX, flankY],
    [shX, shY],
    [railX, railY],
    [0.05, crownY],
  ];
  return makeLoftGeo([
    { z: 2.05, half: h(0.14, 0.42, 0.14, 0.58, 0.26, 0.56, 0.38, 0.22, 0.42, 0.42) },
    { z: 1.55, half: h(0.14, 0.72, 0.14, 0.86, 0.32, 0.82, 0.48, 0.36, 0.52, 0.52) },
    { z: 1.05, half: h(0.15, 0.46, 0.15, 0.92, 0.38, 0.86, 0.52, 0.42, 0.56, 0.56) },
    { z: 0.2, half: h(0.16, 0.82, 0.16, 0.9, 0.4, 0.86, 0.58, 0.55, 0.62, 0.62) },
    { z: -0.55, half: h(0.16, 0.84, 0.16, 0.92, 0.42, 0.88, 0.7, 0.7, 0.78, 0.8) },
    { z: -1.2, half: h(0.16, 0.5, 0.16, 0.94, 0.44, 0.9, 0.72, 0.62, 0.82, 0.84) },
    { z: -1.78, half: h(0.18, 0.78, 0.18, 0.88, 0.4, 0.84, 0.62, 0.5, 0.68, 0.7) },
    { z: -2.08, half: h(0.2, 0.55, 0.2, 0.68, 0.32, 0.64, 0.48, 0.36, 0.52, 0.52) },
  ]);
}

function makeWedgeRoofGeo() {
  return makeLoftGeo([
    { z: -0.15, half: [[0.06, 1.05], [0.48, 1.05], [0.5, 1.12], [0.06, 1.14]] },
    { z: -0.7, half: [[0.06, 1.2], [0.58, 1.2], [0.6, 1.28], [0.06, 1.3]] },
    { z: -1.15, half: [[0.06, 1.16], [0.52, 1.16], [0.54, 1.24], [0.06, 1.26]] },
  ]);
}

function lambert(color, extra = {}) {
  return paint(color, extra);
}

function makeRivalWheel(geos, rimHex, hubHex, rubberHex) {
  return makeRallyWheel(rimHex, hubHex, rubberHex, false);
}

/**
 * Pack cars — coupe / hatch / wedge so the grid is not 14 clones.
 * @param {{body?:number, stripe?:number, accent?:number}} tint
 * @param {number} [variant]
 */
function buildGenericRival(tint = {}, variant = 0) {
  const geos = getRivalShare();
  const kind = variant % 3;
  const bodyHex = tint.body ?? 0xb42028;
  const stripeHex = tint.stripe ?? 0xf4f4f0;
  const accentHex = tint.accent ?? 0x222222;
  // sharedPaint keys on the colour, so fourteen rivals across eight liveries
  // upload eight paint materials instead of forty-two.
  const bodyMat = sharedPaint(bodyHex);
  const stripeMat = sharedPaint(stripeHex);
  const accentMat = sharedPaint(accentHex);
  const glassMat = rivalGlass();
  const darkMat = rivalDark();
  const trimMat = rivalTrim();

  const g = new THREE.Group();
  const hullGeo = kind === 1 ? geos.hatch : kind === 2 ? geos.wedge : geos.hull;
  const roofGeo = kind === 1 ? geos.roofHatch : kind === 2 ? geos.roofWedge : geos.roof;

  const bumperFz = kind === 1 ? 1.9 : 2.08;
  const bumperRz = kind === 1 ? -1.9 : -2.04;
  const pillarZ = kind === 2 ? -0.05 : 0.28;
  const pillarRx = kind === 2 ? -0.2 : -0.52;

  // Everything below is bolted rigidly to the shell, so it is baked into one
  // geometry per paint role at build time. Before this a rival was ~29 meshes;
  // fourteen of them meant ~460 draw calls of nothing but trim.
  const roof = new THREE.Mesh(roofGeo, kind === 2 ? bodyMat : stripeMat);
  roof.name = "roof";
  roof.userData.interior = true;
  g.add(roof);

  addMergedRole(g, bodyMat, [
    { geo: hullGeo },
    { geo: geos.bumper, y: 0.26, z: bumperFz },
    { geo: geos.bumper, y: 0.26, z: bumperRz },
    { geo: geos.pillar, x: 0.68, y: 0.92, z: pillarZ, rx: pillarRx },
    { geo: geos.pillar, x: -0.68, y: 0.92, z: pillarZ, rx: pillarRx },
    { geo: geos.spoiler, y: kind === 1 ? 1.22 : 1.08, z: kind === 1 ? -1.88 : -1.98 },
  ]);
  addMergedRole(g, stripeMat, [{ geo: geos.plate, y: 0.36, z: bumperRz - 0.12 }]);
  addMergedRole(g, accentMat, [
    { geo: geos.skirt, x: 0.88, y: 0.22 },
    { geo: geos.skirt, x: -0.88, y: 0.22 },
  ]);
  addMergedRole(g, darkMat, [
    { geo: geos.lip, y: 0.17, z: bumperFz + 0.06 },
    { geo: geos.grille, y: 0.38, z: bumperFz + 0.04 },
    { geo: geos.mirror, x: 0.92, y: 0.78, z: 0.38 },
    { geo: geos.mirror, x: -0.92, y: 0.78, z: 0.38 },
  ]);
  addMergedRole(g, trimMat, [
    { geo: geos.mirrorGlass, x: 0.93, y: 0.78, z: 0.42 },
    { geo: geos.mirrorGlass, x: -0.91, y: 0.78, z: 0.42 },
    { geo: geos.exhaust, x: 0.42, y: 0.2, z: bumperRz - 0.08, rx: Math.PI / 2 },
  ]);

  // Glass stays split: the windscreen is looked up by name elsewhere, and the
  // rest is one transparent mesh so the sort order stays predictable.
  const windscreen = new THREE.Mesh(geos.glassF, glassMat);
  windscreen.name = "windshield";
  windscreen.userData.windshield = true;
  if (kind === 2) windscreen.position.z = -0.35;
  g.add(windscreen);
  addMergedRole(
    g,
    glassMat,
    [
      { geo: geos.glassR, z: kind === 1 ? -0.18 : 0 },
      { geo: geos.glassS, x: 0.835 },
      { geo: geos.glassS, x: -0.835, sx: -1 },
    ],
    { name: "cabin-glass", userData: { windshield: true } }
  );

  const noseZ = bumperFz + 0.04;
  const tailZ0 = bumperRz;
  attachHeadlights(g, [
    { x: 0.5, y: 0.46, z: noseZ, w: 0.24, h: 0.13, d: 0.1 },
    { x: -0.5, y: 0.46, z: noseZ, w: 0.24, h: 0.13, d: 0.1 },
  ]);
  const tailZ = tailZ0 - 0.06;
  attachBrakeLights(g, [
    { x: 0.52, y: 0.6, z: tailZ, w: 0.28, h: 0.1, d: 0.05 },
    { x: -0.52, y: 0.6, z: tailZ, w: 0.28, h: 0.1, d: 0.05 },
  ]);

  const wheels = [];
  const wheelZ = kind === 1 ? 1.18 : 1.28;
  for (const [wx, wy, wz] of [
    [0.8, 0.32, wheelZ],
    [-0.8, 0.32, wheelZ],
    [0.8, 0.32, -wheelZ],
    [-0.8, 0.32, -wheelZ],
  ]) {
    const wh = makeRallyWheel(stripeHex, accentHex, 0x111111, false, wx > 0 ? 1 : -1);
    wh.position.set(wx, wy, wz);
    wh.userData.front = wz > 0;
    wh.userData.side = wx >= 0 ? 1 : -1;
    g.add(wh);
    wheels.push(wh);
  }
  g.userData.wheels = wheels;
  return g;
}

/**
 * Low-poly rally cars in the white Castrol / red Integrale / wedge Stratos liveries.
 */
function buildSaturnCar(kind = "celica") {
  throw new Error(
    `[garage] ${kind}: procedural car stand-ins are disabled — load the GLB under assets/${kind}/`
  );
}

function buildSaturnDelta(tint = {}) {
  const g = assembleLoftCar({
    hull: deltaHullStations(),
    roof: deltaRoofStations(),
    body: tint.body ?? 0xb42028,
    roofPaint: tint.stripe ?? 0xf4f4f0,
    accent: tint.accent ?? 0x1a1a1a,
    glass: 0x1a2830,
    rim: 0xf4f4f0,
    hub: 0xd4121a,
    noseZ: 1.95,
    tailZ: -1.98,
    wheelZ: 1.18,
    spoilerY: 1.28,
    cabin: "hatch",
  });
  g.add(box(1.05, 0.04, 0.22, tint.stripe ?? 0xf4f4f0, 0, 1.34, -0.2));
  return g;
}

function buildSaturnStratos(tint = {}) {
  return assembleLoftCar({
    hull: stratosHullStations(),
    roof: stratosRoofStations(),
    body: tint.body ?? 0xb42028,
    roofPaint: tint.body ?? 0xb42028,
    accent: tint.accent ?? 0x111111,
    glass: 0x223038,
    rim: tint.stripe ?? 0xeee8dc,
    hub: 0xb42028,
    noseZ: 2.02,
    tailZ: -2.05,
    wheelZ: 1.12,
    spoilerY: 1.05,
    cabin: "wedge",
    hoodDark: true,
  });
}

function buildSaturnCelica(tint = {}) {
  const white = tint.stripe ?? 0xf4f1ea;
  const green = tint.body && tint.body !== COLORS.castrolGreen ? tint.body : 0x1f7a3a;
  const red = tint.accent ?? 0xd0121a;
  const g = assembleLoftCar({
    hull: celicaHullStations(),
    roof: celicaRoofStations(),
    body: white,
    roofPaint: green,
    accent: red,
    glass: 0x223040,
    rim: white,
    hub: COLORS.castrolYellow,
    noseZ: 2.14,
    tailZ: -2.12,
    wheelZ: 1.3,
    spoilerY: 1.16,
    cabin: "coupe",
  });
  const hoodMark = makeLiveryTexture(green, red, COLORS.castrolYellow);
  const hood = new THREE.Mesh(
    new THREE.PlaneGeometry(1.05, 1.28),
    paint(0xffffff, { map: hoodMark, transparent: true, roughness: 0.38, metalness: 0.1 })
  );
  hood.rotation.x = -Math.PI / 2;
  hood.position.set(0, 0.695, 1.12);
  g.add(hood);
  g.add(box(0.18, 0.1, 1.7, green, 0.72, 0.52, 0.05));
  g.add(box(0.18, 0.1, 1.7, green, -0.72, 0.52, 0.05));
  g.add(box(0.08, 0.07, 1.7, red, 0.58, 0.51, 0.05));
  g.add(box(0.08, 0.07, 1.7, red, -0.58, 0.51, 0.05));
  return g;
}

/**
 * Shared lofted rally car: hull + greenhouse + lights + detailed wheels.
 * @param {object} spec
 */
function assembleLoftCar(spec) {
  const g = new THREE.Group();
  const bodyMat = paint(spec.body);
  const roofMat = paint(spec.roofPaint);
  const accentMat = paint(spec.accent);
  const darkMat = rubber(0x161618);
  const glassMat = glass(spec.glass);

  g.add(new THREE.Mesh(makeLoftGeo(spec.hull), bodyMat));
  const roof = new THREE.Mesh(makeLoftGeo(spec.roof), roofMat);
  roof.name = "roof";
  roof.userData.interior = true;
  g.add(roof);

  const zShift = spec.cabin === "wedge" ? -0.32 : spec.cabin === "hatch" ? -0.08 : 0;
  const windscreen = new THREE.Mesh(
    makeQuadGeo(
      [-0.64, 0.7, 0.52 + zShift],
      [0.64, 0.7, 0.52 + zShift],
      [0.5, 1.24, 0.06 + zShift],
      [-0.5, 1.24, 0.06 + zShift]
    ),
    glassMat
  );
  windscreen.name = "windshield";
  windscreen.userData.windshield = true;
  g.add(windscreen);
  const rearGlass = new THREE.Mesh(
    makeQuadGeo(
      [0.6, 0.68, -1.02 + zShift],
      [-0.6, 0.68, -1.02 + zShift],
      [-0.48, 1.2, -0.82 + zShift],
      [0.48, 1.2, -0.82 + zShift]
    ),
    glassMat
  );
  rearGlass.userData.windshield = true;
  g.add(rearGlass);
  const side = makeQuadGeo(
    [0, 0.68, 0.32 + zShift],
    [0, 0.68, -0.88 + zShift],
    [0, 1.18, -0.76 + zShift],
    [0, 1.22, 0.1 + zShift]
  );
  const sideR = new THREE.Mesh(side, glassMat);
  sideR.position.x = 0.84;
  sideR.userData.windshield = true;
  // Mirror verts into a new geo — scale.x = -1 flips winding and looks like
  // inverted window panes once glass is FrontSide-only.
  const sideLGeo = side.clone();
  sideLGeo.applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
  sideLGeo.computeVertexNormals();
  const sideL = new THREE.Mesh(sideLGeo, glassMat);
  sideL.position.x = -0.84;
  sideL.userData.windshield = true;
  g.add(sideR, sideL);

  if (spec.hoodDark) {
    const hood = box(1.35, 0.03, 1.15, 0x161618, 0, 0.62, 1.05);
    g.add(hood);
  }

  g.add(box(1.68, 0.13, 0.22, spec.body, 0, 0.24, spec.noseZ));
  g.add(box(1.68, 0.13, 0.22, spec.body, 0, 0.24, spec.tailZ));
  g.add(box(0.78, 0.15, 0.06, 0x1a1a1c, 0, 0.4, spec.noseZ + 0.04));
  g.add(box(0.07, 0.09, 1.5, spec.accent, 0.88, 0.22, 0));
  g.add(box(0.07, 0.09, 1.5, spec.accent, -0.88, 0.22, 0));
  g.add(box(1.3, 0.04, 0.26, spec.body, 0, spec.spoilerY, spec.tailZ + 0.08));
  g.add(box(0.05, 0.22, 0.16, spec.body, 0.58, spec.spoilerY - 0.12, spec.tailZ + 0.1));
  g.add(box(0.05, 0.22, 0.16, spec.body, -0.58, spec.spoilerY - 0.12, spec.tailZ + 0.1));

  const mirR = box(0.16, 0.09, 0.08, 0x1a1a1c, 0.94, 0.8, 0.42);
  const glassM = new THREE.Mesh(new THREE.PlaneGeometry(0.11, 0.07), chrome(0xb0c8d8));
  glassM.position.z = 0.045;
  mirR.add(glassM);
  const mirL = mirR.clone();
  mirL.position.x = -0.94;
  g.add(mirR, mirL);

  const wiper = box(0.55, 0.012, 0.012, 0x222226, 0.12, 0.72, 0.5 + zShift);
  wiper.rotation.z = 0.18;
  g.add(wiper);

  const exhaust = cyl(0.035, 0.04, 0.2, 0xb8b8bc, 0.38, 0.2, spec.tailZ - 0.1, Math.PI / 2, 0, 12);
  exhaust.material = chrome(0xb8b8bc);
  g.add(exhaust);
  g.add(box(0.34, 0.1, 0.03, spec.roofPaint, 0, 0.36, spec.tailZ - 0.12));

  attachHeadlights(g, [
    { x: 0.5, y: 0.48, z: spec.noseZ + 0.05, w: 0.26, h: 0.14, d: 0.12 },
    { x: -0.5, y: 0.48, z: spec.noseZ + 0.05, w: 0.26, h: 0.14, d: 0.12 },
  ]);
  attachBrakeLights(g, [
    { x: 0.58, y: 0.54, z: spec.tailZ - 0.04, w: 0.3, h: 0.12, d: 0.04 },
    { x: -0.58, y: 0.54, z: spec.tailZ - 0.04, w: 0.3, h: 0.12, d: 0.04 },
    { x: 0.78, y: 0.54, z: spec.tailZ + 0.1, w: 0.04, h: 0.12, d: 0.18 },
    { x: -0.78, y: 0.54, z: spec.tailZ + 0.1, w: 0.04, h: 0.12, d: 0.18 },
  ]);

  const wheels = [];
  for (const [wx, wy, wz] of [
    [0.8, 0.33, spec.wheelZ],
    [-0.8, 0.33, spec.wheelZ],
    [0.8, 0.33, -spec.wheelZ],
    [-0.8, 0.33, -spec.wheelZ],
  ]) {
    const wh = makeRallyWheel(spec.rim, spec.hub, 0x111111, true, wx > 0 ? 1 : -1);
    wh.position.set(wx, wy, wz);
    wh.userData.front = wz > 0;
    wh.userData.side = wx >= 0 ? 1 : -1;
    g.add(wh);
    wheels.push(wh);
  }
  g.userData.wheels = wheels;
  void accentMat;
  void darkMat;
  return g;
}

function celicaHullStations() {
  const p = (keelY, sillX, sillY, flankX, flankY, shX, shY, railX, railY, crownY) => [
    [0.04, keelY],
    [sillX, sillY],
    [flankX, flankY],
    [shX, shY],
    [railX, railY],
    [0.04, crownY],
  ];
  return [
    { z: 2.18, half: p(0.18, 0.4, 0.18, 0.52, 0.32, 0.5, 0.48, 0.28, 0.55, 0.55) },
    { z: 1.92, half: p(0.16, 0.68, 0.16, 0.82, 0.36, 0.8, 0.54, 0.42, 0.63, 0.63) },
    { z: 1.52, half: p(0.16, 0.74, 0.16, 0.9, 0.4, 0.86, 0.58, 0.5, 0.67, 0.67) },
    { z: 1.28, half: p(0.18, 0.44, 0.18, 0.96, 0.44, 0.9, 0.6, 0.52, 0.68, 0.68) },
    { z: 0.72, half: p(0.16, 0.8, 0.16, 0.9, 0.42, 0.86, 0.64, 0.74, 0.7, 0.7) },
    { z: 0.12, half: p(0.16, 0.84, 0.16, 0.9, 0.42, 0.86, 0.64, 0.8, 0.7, 0.7) },
    { z: -0.7, half: p(0.16, 0.84, 0.16, 0.9, 0.42, 0.86, 0.62, 0.78, 0.68, 0.68) },
    { z: -1.28, half: p(0.18, 0.46, 0.18, 0.96, 0.44, 0.9, 0.6, 0.64, 0.64, 0.64) },
    { z: -1.72, half: p(0.18, 0.76, 0.18, 0.86, 0.38, 0.82, 0.56, 0.55, 0.6, 0.6) },
    { z: -2.12, half: p(0.2, 0.55, 0.2, 0.7, 0.34, 0.66, 0.5, 0.4, 0.54, 0.54) },
  ];
}

function celicaRoofStations() {
  return [
    { z: 0.18, half: [[0.05, 1.16], [0.52, 1.16], [0.54, 1.24], [0.05, 1.26]] },
    { z: -0.42, half: [[0.05, 1.18], [0.56, 1.18], [0.58, 1.26], [0.05, 1.28]] },
    { z: -0.95, half: [[0.05, 1.12], [0.5, 1.12], [0.52, 1.2], [0.05, 1.22]] },
  ];
}

function deltaHullStations() {
  const p = (keelY, sillX, sillY, flankX, flankY, shX, shY, railX, railY, crownY) => [
    [0.04, keelY],
    [sillX, sillY],
    [flankX, flankY],
    [shX, shY],
    [railX, railY],
    [0.04, crownY],
  ];
  return [
    { z: 1.98, half: p(0.2, 0.55, 0.2, 0.7, 0.36, 0.68, 0.54, 0.42, 0.64, 0.64) },
    { z: 1.55, half: p(0.16, 0.78, 0.16, 0.88, 0.42, 0.84, 0.62, 0.55, 0.72, 0.72) },
    { z: 1.18, half: p(0.16, 0.46, 0.16, 0.94, 0.48, 0.9, 0.66, 0.74, 0.78, 0.78) },
    { z: 0.4, half: p(0.16, 0.84, 0.16, 0.92, 0.46, 0.88, 0.72, 0.8, 0.8, 0.8) },
    { z: -0.4, half: p(0.16, 0.84, 0.16, 0.92, 0.46, 0.88, 0.72, 0.8, 0.8, 0.8) },
    { z: -1.12, half: p(0.16, 0.48, 0.16, 0.94, 0.5, 0.9, 0.68, 0.76, 0.8, 0.8) },
    { z: -1.55, half: p(0.18, 0.8, 0.18, 0.88, 0.44, 0.84, 0.72, 0.7, 0.84, 0.84) },
    { z: -1.95, half: p(0.22, 0.68, 0.22, 0.78, 0.4, 0.74, 0.7, 0.55, 0.8, 0.8) },
  ];
}

function deltaRoofStations() {
  return [
    { z: 0.2, half: [[0.05, 1.22], [0.58, 1.22], [0.6, 1.32], [0.05, 1.34]] },
    { z: -0.5, half: [[0.05, 1.26], [0.6, 1.26], [0.62, 1.36], [0.05, 1.38]] },
    { z: -1.12, half: [[0.05, 1.2], [0.56, 1.2], [0.58, 1.32], [0.05, 1.34]] },
  ];
}

function stratosHullStations() {
  const p = (keelY, sillX, sillY, flankX, flankY, shX, shY, railX, railY, crownY) => [
    [0.04, keelY],
    [sillX, sillY],
    [flankX, flankY],
    [shX, shY],
    [railX, railY],
    [0.04, crownY],
  ];
  return [
    { z: 2.08, half: p(0.16, 0.4, 0.16, 0.56, 0.28, 0.54, 0.4, 0.22, 0.44, 0.44) },
    { z: 1.55, half: p(0.14, 0.7, 0.14, 0.86, 0.34, 0.82, 0.5, 0.34, 0.54, 0.54) },
    { z: 1.08, half: p(0.15, 0.44, 0.15, 0.92, 0.4, 0.86, 0.54, 0.4, 0.58, 0.58) },
    { z: 0.15, half: p(0.16, 0.82, 0.16, 0.9, 0.42, 0.86, 0.6, 0.52, 0.64, 0.64) },
    { z: -0.55, half: p(0.16, 0.84, 0.16, 0.92, 0.44, 0.88, 0.72, 0.68, 0.82, 0.84) },
    { z: -1.18, half: p(0.16, 0.48, 0.16, 0.94, 0.46, 0.9, 0.74, 0.6, 0.84, 0.86) },
    { z: -1.75, half: p(0.18, 0.76, 0.18, 0.86, 0.4, 0.82, 0.62, 0.48, 0.68, 0.7) },
    { z: -2.08, half: p(0.2, 0.52, 0.2, 0.66, 0.32, 0.62, 0.48, 0.34, 0.52, 0.52) },
  ];
}

function stratosRoofStations() {
  return [
    { z: -0.12, half: [[0.05, 1.02], [0.48, 1.02], [0.5, 1.1], [0.05, 1.12]] },
    { z: -0.7, half: [[0.05, 1.2], [0.58, 1.2], [0.6, 1.3], [0.05, 1.32]] },
    { z: -1.18, half: [[0.05, 1.14], [0.5, 1.14], [0.52, 1.24], [0.05, 1.26]] },
  ];
}

function makeBrakeLamp(w, h, d) {
  const mesh = new THREE.Mesh(
    lampGeometry(),
    // Lambert, not Physical: a lamp lens is an emissive blob. Roughness and
    // metalness were buying a specular lobe that the emissive drowns out.
    // The material stays per-lamp because setBrakeLights() mutates it.
    new THREE.MeshLambertMaterial({
      color: 0x2a0606,
      emissive: 0xff1a0a,
      emissiveIntensity: 0.06,
      transparent: true,
      opacity: 0.94,
      toneMapped: false,
    })
  );
  mesh.scale.set(w, h, d);
  mesh.name = "brake-lamp";
  mesh.userData.brake = true;
  mesh.userData.brakeBox = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Stick red lamps on the tail. Positions are local to the car (+Z forward).
 * @param {THREE.Group} root
 * @param {Array<{x:number,y:number,z:number,w?:number,h?:number,d?:number}>} specs
 */
function attachBrakeLights(root, specs) {
  const list = root.userData.brakeLights || [];
  for (const s of specs) {
    const lamp = makeBrakeLamp(s.w || 0.38, s.h || 0.11, s.d || 0.07);
    lamp.position.set(s.x, s.y, s.z);
    root.add(lamp);
    list.push(lamp);
  }
  root.userData.brakeLights = list;
}

/**
 * World AABB of the car, expressed in the car's local frame (+Z forward).
 * @param {THREE.Object3D} root
 */
function localHull(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const a = box.min.clone();
  const b = box.max.clone();
  root.worldToLocal(a);
  root.worldToLocal(b);
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z),
  };
}

/**
 * True when a mesh center sits on the rear quarters or a full-width light bar.
 * Spoiler tips and the license plate are excluded.
 * @param {THREE.Vector3} c local center
 * @param {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}} hull
 * @param {THREE.Vector3} [size]
 */
function isRearCluster(c, hull, size) {
  const sizeZ = hull.maxZ - hull.minZ;
  const sizeY = hull.maxY - hull.minY;
  const rearBand = Math.max(0.9, sizeZ * 0.24);
  if (c.z < hull.minZ - 0.04) return false;
  if (c.z > hull.minZ + rearBand) return false;
  if (c.y < hull.minY + sizeY * 0.22) return false;
  if (c.y > hull.maxY - 0.06) return false;
  const bar = size && size.x > 0.85 && Math.abs(c.x) < 0.4;
  if (bar) return true;
  if (Math.abs(c.x) < 0.32) return false;
  if (Math.abs(c.x) > 1.15) return false;
  return true;
}

/**
 * Outer tail cover the player actually sees — not an inner bulb box.
 * Celica: wraparound `combi_glass_bl/br`. Delta: `Light Rear` bar.
 * Stratos: `TailLight_L/R`.
 * @param {THREE.Object3D} obj
 */
function isVisibleTailCover(obj) {
  const label = ancestryLabel(obj);
  if (isReverseLampLabel(label)) return false;
  if (/combi_glass_b/.test(label)) return true;
  if (/tail.?light/.test(label)) return true;
  if (/light.?rear/.test(label)) return true;
  return false;
}

/**
 * Prefer the modeled tail lenses (one left, one right, or a full-width bar).
 * Housings, reverse lamps, and extra REARLIGHT boxes are skipped so the glow
 * sits in the red clusters the player can see.
 * @param {THREE.Mesh[]} found
 * @param {THREE.Object3D} root
 * @returns {THREE.Mesh[]}
 */
function pickBrakeLampMeshes(found, root) {
  if (!found || !found.length) return [];
  const c = new THREE.Vector3();
  const s = new THREE.Vector3();
  const items = [];
  for (let i = 0; i < found.length; i++) {
    const obj = found[i];
    const label = ancestryLabel(obj);
    if (isReverseLampLabel(label)) continue;
    const box = new THREE.Box3().setFromObject(obj);
    box.getCenter(c);
    box.getSize(s);
    root.worldToLocal(c);
    const bar = s.x > 0.85 && Math.abs(c.x) < 0.4;
    const vol = s.x * s.y * s.z;
    let score = 0;
    if (isVisibleTailCover(obj)) score += 32;
    if (isTailLampLensMesh(obj)) score += 24;
    if (/light.?rear/.test(label)) score += 14;
    if (/rearlight/.test(label)) score += 6;
    if (/pod/.test(label) && !/glass/.test(label)) score -= 10;
    if (bar) score += 10;
    if (vol > 0.45 && !bar) score -= 8;
    items.push({ obj, x: c.x, score, bar });
  }
  if (!items.length) return [];
  // Inner REARLIGHT glass sits behind Celica wraparound covers and never
  // reads as a lamp. Use the covers when they exist.
  const covers = items.filter((it) => isVisibleTailCover(it.obj));
  const pool = covers.length ? covers : items;
  const bars = pool.filter((it) => it.bar).sort((a, b) => b.score - a.score);
  if (bars.length) return [bars[0].obj];
  const left = pool.filter((it) => it.x < -0.08).sort((a, b) => b.score - a.score);
  const right = pool.filter((it) => it.x > 0.08).sort((a, b) => b.score - a.score);
  const out = [];
  if (left[0]) out.push(left[0].obj);
  if (right[0]) out.push(right[0].obj);
  if (out.length) return out;
  pool.sort((a, b) => b.score - a.score);
  return pool.slice(0, 2).map((it) => it.obj);
}

/**
 * GLB: use the model's tail-light meshes (Delta: full-width Light Rear bar).
 * Fallback: corner clusters inset into the rear fascia — never wraparound pods
 * that float outside a narrower tail.
 * @param {THREE.Object3D} root
 */
function ensureBrakeLights(root) {
  scrubDeltaHeadArtifacts(root);
  const existing = liveLampList(root.userData.brakeLights);
  if (existing && !existing.some((o) => o.userData && o.userData.brakeBox)) {
    root.userData.brakeLights = existing;
    return;
  }
  // Drop stale procedural boxes from an earlier pass (Delta needs the GLB bar).
  if (existing) {
    for (let i = 0; i < existing.length; i++) {
      const lamp = existing[i];
      if (lamp.userData && lamp.userData.brakeBox && lamp.parent) lamp.parent.remove(lamp);
    }
  }
  const hull = localHull(root);
  const sizeX = hull.maxX - hull.minX;
  const found = findBrakeLights(root);
  const picked = pickBrakeLampMeshes(found, root);
  const keep = [];
  for (let i = 0; i < picked.length; i++) {
    const mesh = picked[i];
    const label = ancestryLabel(mesh);
    const named = isNamedRearLamp(label) || isTailLampLensMesh(mesh);
    const c = new THREE.Vector3();
    new THREE.Box3().setFromObject(mesh).getCenter(c);
    root.worldToLocal(c);
    const bar = Math.abs(c.x) < 0.35;
    // Named GLB lamps (Light Rear) stay even if the AABB tip sits slightly
    // behind the bumper — hiding them forced floating procedural boxes.
    const hanging =
      !named && (c.z < hull.minZ - 0.02 || (!bar && Math.abs(c.x) > sizeX * 0.52));
    if (hanging) {
      mesh.visible = false;
      continue;
    }
    keep.push(mesh);
  }
  if (keep.length >= 1) {
    for (let i = 0; i < keep.length; i++) prepareBrakeMaterial(keep[i]);
    // Light the model's own lenses. Nested sphere pads sat in geometry-AABB
    // space and floated off the red clusters (pods, reverse, REARLIGHT boxes).
    root.userData.brakeLights = keep;
    return;
  }
  // 1974 CAD has tail lamps painted on the body atlas — extra boxes float.
  if (root.userData.stratosCad) {
    root.userData.brakeLights = [];
    return;
  }
  attachClusterLamps(root, hull);
}

/**
 * Sit emissive pads inside a GLB lamp mesh's local bounds so brake glow reads
 * in the model's lenses instead of as boxes outside the body.
 * @param {THREE.Mesh} lampMesh
 * @returns {THREE.Mesh[]}
 */
function nestBrakeEmittersInLamp(lampMesh) {
  if (!lampMesh || !lampMesh.isMesh || !lampMesh.geometry) return [];
  if (!lampMesh.geometry.boundingBox) lampMesh.geometry.computeBoundingBox();
  const bb = lampMesh.geometry.boundingBox;
  if (!bb) return [];
  const sx = Math.max(0.04, (bb.max.x - bb.min.x) * 0.72);
  const sy = Math.max(0.02, (bb.max.y - bb.min.y) * 0.55);
  const sz = Math.max(0.012, (bb.max.z - bb.min.z) * 0.35);
  const cx = (bb.min.x + bb.max.x) * 0.5;
  const cy = (bb.min.y + bb.max.y) * 0.5;
  const cz = (bb.min.z + bb.max.z) * 0.5;
  // Full-width Integrale bar → two pads on the quarters; narrow lens → one.
  const wide = bb.max.x - bb.min.x > 0.85;
  const pads = wide
    ? [
        { x: cx - sx * 0.28, y: cy, z: cz },
        { x: cx + sx * 0.28, y: cy, z: cz },
      ]
    : [{ x: cx, y: cy, z: cz }];
  const out = [];
  for (let i = 0; i < pads.length; i++) {
    const pad = makeBrakeLamp(wide ? sx * 0.38 : sx, sy, sz);
    pad.position.set(pads[i].x, pads[i].y, pads[i].z);
    pad.name = "brake-emitter";
    lampMesh.add(pad);
    out.push(pad);
  }
  return out;
}

/**
 * @param {unknown} list
 * @returns {THREE.Object3D[]|null}
 */
function liveLampList(list) {
  if (!Array.isArray(list) || !list.length) return null;
  const live = list.filter((o) => o && o.isObject3D && o.material);
  return live.length ? live : null;
}

/**
 * Coupe tail lamps sit on the rear corners at trunk-line height, inset into
 * the fascia — no wraparound side pods (those float outside the Delta body).
 */
function attachClusterLamps(root, hull) {
  const sizeX = hull.maxX - hull.minX;
  const sizeY = hull.maxY - hull.minY;
  const x = Math.max(0.42, Math.min(0.62, sizeX * 0.28));
  const y = hull.minY + sizeY * 0.42;
  const zRear = hull.minZ + 0.11;
  attachBrakeLights(root, [
    { x, y, z: zRear, w: 0.28, h: 0.1, d: 0.035 },
    { x: -x, y, z: zRear, w: 0.28, h: 0.1, d: 0.035 },
  ]);
}

function matName(obj) {
  const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
  return (mat && mat.name) || "";
}

/**
 * Mesh names on the Sketchfab Celica are Object_N. The real lamp id lives on
 * a parent (`FRONTLIGHT1_8`, `x0_light_glass_fl_49`).
 * @param {THREE.Object3D} obj
 * @returns {string}
 */
function ancestryLabel(obj) {
  const parts = [obj.name || "", matName(obj)];
  for (let p = obj.parent, i = 0; p && i < 5; p = p.parent, i++) {
    if (p.name) parts.push(p.name);
  }
  return parts.join(" ").toLowerCase();
}

function isRearLampLabel(label) {
  return /rearlight|rear.?light|tail.?light|stop.?lamp|rev_|reverse|combi_glass_b|light_pod_b[lr]|light_rev|light.?rear|light_rear|feux.?ar/.test(
    label
  );
}

/** Reverse / backup lenses — not the brake cluster. */
function isReverseLampLabel(label) {
  return /(?:^|[^a-z])(?:rev_|reverse|light_rev|rev_glass)/.test(label);
}

/**
 * The modeled red/clear tail lens, not the chrome pod or a reverse lamp.
 * Celica: x0_light_combi_glass_bl/br. Stratos: TailLight_L/R.
 */
function isTailLampLensMesh(obj) {
  const label = ancestryLabel(obj);
  const mat = matName(obj).toLowerCase();
  if (isReverseLampLabel(label)) return false;
  if (/combi_glass_b/.test(label)) return true;
  if (/tail.?light/.test(label)) return true;
  if (/rearlight/.test(label) && /glass/.test(label)) return true;
  if (isRearLampLabel(label) && (/glass/.test(label) || /glass/.test(mat))) return true;
  return false;
}

function isNamedRearLamp(label) {
  if (isNamedFrontLamp(label)) return false;
  if (isReverseLampLabel(label)) return false;
  if (/window|windshield|interior|cabin|mirror|plate|license|number.?plate/.test(label)) return false;
  return isRearLampLabel(label);
}

/** Skip full-length lens sheets and front housings mis-tagged as "light". */
function isRearLightSheet(label, size, hull) {
  const spanZ = hull.maxZ - hull.minZ;
  if (isFullLengthLightSheetLabel(label)) return true;
  if (/light.?front|frontlight|head.?light|headlamp/.test(label)) return true;
  if (/light.?glass|light_glass|glass.?bump|lightbump/.test(label) && size.z > spanZ * 0.42) return true;
  return false;
}

function isNamedFrontLamp(label) {
  if (isRearLampLabel(label)) return false;
  if (/window|windshield|interior|cabin|mirror/.test(label)) return false;
  // Delta "Light glass" / "Light Glass Bump" are full-length sheets — never lamps.
  if (isFullLengthLightSheetLabel(label)) return false;
  return /frontlight|front.?light|light.?front|head.?light|headlamp|lightpod|light.?pod|light_glass_f[lr]|light_2_glass_f[lr]|x0_light_glass/.test(
    label
  );
}

/**
 * Delta Integrale ships continuous "Light glass" / "Light_glass" meshes that
 * run nose-to-tail. Treating them as headlights lights a multi-metre glowing
 * sheet (floating polygons). Sketchfab / three.js often turns spaces into `_`.
 * @param {string} label
 */
function isFullLengthLightSheetLabel(label) {
  const n = String(label || "").toLowerCase();
  return (
    /light[\s_.-]*glass([\s_.-]*bump)?/.test(n) ||
    /lightglass/.test(n) ||
    /light[\s_.-]*bump/.test(n) ||
    /glass[\s_.-]*bump/.test(n) ||
    /\blightbump\b/.test(n)
  );
}

/**
 * True when a mesh is the Delta full-length light sheet by size + material,
 * even if the name is just "Light" / "Object_N".
 * @param {THREE.Mesh} obj
 * @param {THREE.Vector3} size
 * @param {{minZ:number,maxZ:number}} hull
 */
function isDeltaFullLengthLightSheet(obj, size, hull) {
  const spanZ = Math.max(0.01, hull.maxZ - hull.minZ);
  const mat = matName(obj).toLowerCase();
  const label = ancestryLabel(obj);
  if (isFullLengthLightSheetLabel(label) || isFullLengthLightSheetLabel(mat)) return true;
  // Material "Light" / "LightBump" on a sheet spanning most of the car length.
  if (/^lights?$|^lightbump$/.test(mat) && size.z > spanZ * 0.55) return true;
  if (/^lights?$|^lightbump$/.test(mat) && size.z > 2.2) return true;
  return false;
}

/**
 * Drop procedural head dummies and remove full-length light sheets (Delta).
 * Oversized "Light_Front" chrome housings that span half the car are hidden —
 * nested emitters (or root-local pads) remain the readable headlamps.
 * @param {THREE.Object3D} root
 */
function scrubDeltaHeadArtifacts(root) {
  const hull = localHull(root);
  const doomed = [];
  const c = new THREE.Vector3();
  const s = new THREE.Vector3();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData && obj.userData.headEmitter) return;
    if (obj.userData && obj.userData.headDummy) {
      doomed.push(obj);
      return;
    }
    const label = ancestryLabel(obj);
    const box = new THREE.Box3().setFromObject(obj);
    box.getSize(s);
    box.getCenter(c);
    root.worldToLocal(c);

    if (isDeltaFullLengthLightSheet(obj, s, hull)) {
      doomed.push(obj);
      return;
    }

    // "Light_Front" chrome detail that is actually a 2 m+ floating slab.
    // Hide materials only — Object3D.visible=false would also hide nested emitters.
    if (/light[\s_.-]*front|frontlight|front[\s_.-]*light/.test(label) && !isRearLampLabel(label)) {
      const spanZ = Math.max(0.01, hull.maxZ - hull.minZ);
      if (s.z > Math.max(0.85, spanZ * 0.35) || s.x * s.y * s.z > 0.55) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (let mi = 0; mi < mats.length; mi++) {
          if (mats[mi]) mats[mi].visible = false;
        }
        obj.userData.deltaFrontHousingHidden = true;
      }
    }
  });
  for (let i = 0; i < doomed.length; i++) {
    const m = doomed[i];
    if (m.parent) m.parent.remove(m);
    if (m.geometry) m.geometry.dispose();
  }
}

function firstMat(obj) {
  return Array.isArray(obj.material) ? obj.material[0] : obj.material;
}

function isReddish(mat) {
  if (!mat || !mat.color) return false;
  const r = mat.color.r;
  const g = mat.color.g;
  const b = mat.color.b;
  return r > 0.28 && r > g * 1.35 && r > b * 1.2;
}

/**
 * Prefer the GLB's own rear lamps. Named meshes win even when they form a
 * single full-width bar (Delta Integrale `Light Rear.001`) — do not require
 * isRearCluster for explicit rear labels (Chrome Detail bars can sit tight
 * on the bumper lip and fail the height band).
 * @param {THREE.Object3D} root
 * @returns {THREE.Mesh[]}
 */
function findBrakeLights(root) {
  const hull = localHull(root);
  const c = new THREE.Vector3();
  const s = new THREE.Vector3();
  const named = [];
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const label = ancestryLabel(obj);
    if (/plate|license|number.?plate|numplate|regist/.test(label)) {
      obj.userData.licensePlate = true;
      return;
    }
    if (/spoiler|wing|antenna|exhaust/.test(label)) return;
    if (!isNamedRearLamp(label)) return;
    const box = new THREE.Box3().setFromObject(obj);
    box.getCenter(c);
    box.getSize(s);
    root.worldToLocal(c);
    if (isRearLightSheet(label, s, hull)) return;
    // Explicit rear name is enough; only reject if clearly on the nose.
    if (c.z > hull.minZ + (hull.maxZ - hull.minZ) * 0.55) return;
    named.push(obj);
  });
  if (named.length) return named;

  const hits = [];
  root.traverse((obj) => {
    if (!obj.isMesh || obj.userData.licensePlate || obj.userData.head || obj.userData.brake) return;
    const label = ancestryLabel(obj);
    if (/spoiler|wing|antenna|exhaust|frontlight|light.?front|head.?light/.test(label)) return;
    if (isNamedFrontLamp(label)) return;
    const box = new THREE.Box3().setFromObject(obj);
    box.getCenter(c);
    box.getSize(s);
    root.worldToLocal(c);
    if (isRearLightSheet(label, s, hull)) return;
    if (!isRearCluster(c, hull, s)) return;
    if (s.x > 0.7 || s.y > 0.4 || s.z > 0.45) return;
    if (s.x * s.y * s.z > 0.12) return;
    const mat = firstMat(obj);
    const lampish = /light|lamp|glass|lens|optic|emit|red/.test(label);
    if (!isReddish(mat) && !lampish) return;
    hits.push({ obj, x: Math.abs(c.x), red: isReddish(mat) ? 1 : 0, z: c.z });
  });
  hits.sort((a, b) => b.red - a.red || a.z - b.z || b.x - a.x);
  return hits.slice(0, 4).map((h) => h.obj);
}

function prepareBrakeMaterial(mesh) {
  mesh.userData.brake = true;
  const mats = [].concat(mesh.material || []);
  for (let i = 0; i < mats.length; i++) {
    const mat = mats[i];
    if (!mat) continue;
    if (mat.userData._brakeRestOpacity == null) {
      mat.userData._brakeRestOpacity = mat.opacity != null ? mat.opacity : 1;
    }
    if (!mat.emissive) mat.emissive = new THREE.Color(0xff1a0a);
    else mat.emissive.setHex(0xff1a0a);
    mat.emissiveIntensity = 0.1;
    mat.toneMapped = false;
  }
}

/**
 * Glow sits on the clusters, not on the plate (x = 0).
 * @param {THREE.Object3D} root
 * @param {THREE.PointLight} glow
 */
/**
 * Lens center in car space. Sketchfab pivots sit at the origin — matrix
 * position is the chassis, not the cluster.
 * @param {THREE.Object3D} lamp
 * @param {THREE.Object3D} root
 * @param {THREE.Vector3} target
 */
function lampLocalCenter(lamp, root, target) {
  lamp.updateWorldMatrix(true, false);
  const geo = lamp.geometry;
  if (geo) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (bb) {
      target.set(
        (bb.min.x + bb.max.x) * 0.5,
        (bb.min.y + bb.max.y) * 0.5,
        (bb.min.z + bb.max.z) * 0.5
      );
      lamp.localToWorld(target);
      root.worldToLocal(target);
      return target;
    }
  }
  target.setFromMatrixPosition(lamp.matrixWorld);
  root.worldToLocal(target);
  return target;
}

/**
 * Glow sits on the clusters, not on the plate (x = 0).
 * @param {THREE.Object3D} root
 * @param {THREE.PointLight} glow
 */
function attachBrakeGlow(root, glow) {
  const lamps = liveLampList(root.userData.brakeLights) || [];
  const tmp = new THREE.Vector3();
  let y = 0;
  let z = 0;
  let n = 0;
  for (let i = 0; i < lamps.length; i++) {
    lampLocalCenter(lamps[i], root, tmp);
    if (Math.abs(tmp.x) < 0.18 && lamps.length > 1) continue;
    y += tmp.y;
    z += tmp.z;
    n += 1;
  }
  if (!n && lamps.length) {
    lampLocalCenter(lamps[0], root, tmp);
    y = tmp.y;
    z = tmp.z;
    n = 1;
  }
  if (n) glow.position.set(0, y / n, z / n - 0.08);
  else glow.position.set(0, 0.5, -2.05);
}

/**
 * Light the tail when the chassis is on the brakes.
 * @param {THREE.Object3D} root
 * @param {boolean} on
 */
export function setBrakeLights(root, on) {
  if (!root) return;
  let lamps = liveLampList(root.userData.brakeLights);
  if (!lamps) {
    lamps = [];
    root.traverse((obj) => {
      if (obj.isMesh && obj.userData && obj.userData.brake) lamps.push(obj);
    });
    if (lamps.length) root.userData.brakeLights = lamps;
  }
  if (lamps) {
    for (let i = 0; i < lamps.length; i++) {
      const lamp = lamps[i];
      const mats = [].concat(lamp.material || []);
      for (let m = 0; m < mats.length; m++) {
        const mat = mats[m];
        if (!mat) continue;
        mat.toneMapped = false;
        if (lamp.userData.brakeBox) {
          mat.emissiveIntensity = on ? 5.2 : 0.06;
          if (mat.color) mat.color.setHex(on ? 0xff3a1c : 0x2a0606);
          if (mat.emissive) mat.emissive.setHex(on ? 0xff2208 : 0x4a0808);
        } else {
          if (mat.userData._brakeRestOpacity == null) {
            mat.userData._brakeRestOpacity = mat.opacity != null ? mat.opacity : 1;
          }
          if (mat.emissive) mat.emissive.setHex(0xff220e);
          mat.emissiveIntensity = on ? 8.4 : 0.1;
          // gameShade caps Lights_Glass at 0.48 opacity — without this the
          // cover never reads as a lamp even when emissive is high.
          if (mat.transparent || mat.userData._brakeRestOpacity < 0.95) {
            mat.transparent = true;
            mat.opacity = on ? 0.94 : mat.userData._brakeRestOpacity;
            mat.depthWrite = !!on;
          }
        }
      }
    }
  }
  if (root.userData.brakeGlow) {
    // Intensity only — see createPlayerCar() for why `visible` stays true.
    root.userData.brakeGlow.intensity = on ? 2.1 : 0;
  }
}

function makeHeadLamp(w, h, d) {
  const mesh = new THREE.Mesh(
    lampGeometry(),
    // This one mattered more than anything else on the car. `transmission`
    // greater than zero makes three.js render the entire scene a second time
    // into a transmission buffer, every frame — and thirty headlamps across
    // the grid were switching it on. A Saturn headlight was a bright polygon.
    new THREE.MeshLambertMaterial({
      color: 0xe8eef4,
      emissive: 0xfff4d4,
      emissiveIntensity: 0.12,
      transparent: true,
      opacity: 0.92,
      toneMapped: false,
    })
  );
  mesh.scale.set(w, h, d);
  mesh.userData.head = true;
  mesh.userData.headDummy = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * True when a mesh center sits on a front lamp — bumper-to-hood height at the
 * nose, not the grille, windshield, or a whole bumper panel.
 * @param {THREE.Vector3} c local center
 * @param {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}} hull
 * @param {THREE.Vector3} [size]
 */
function isFrontHeadlampCluster(c, hull, size) {
  const sizeZ = hull.maxZ - hull.minZ;
  const sizeY = hull.maxY - hull.minY;
  const frontBand = Math.max(0.65, sizeZ * 0.3);
  if (c.z < hull.maxZ - frontBand) return false;
  if (c.y < hull.minY + sizeY * 0.1) return false;
  if (c.y > hull.minY + sizeY * 0.58) return false;
  if (size && (size.x > 1.35 || size.y > 0.55 || size.z > 0.85)) return false;
  if (size && size.x * size.y * size.z > 0.18) return false;
  const bar = size && size.x > 0.85 && Math.abs(c.x) < 0.35;
  if (bar) return true;
  if (Math.abs(c.x) < 0.2) return false;
  if (Math.abs(c.x) > 1.2) return false;
  return true;
}

/**
 * Prefer the GLB's own front lamps so boxes do not sit on the fascia.
 * Walks parent names: the Celica lenses are `x0_light_glass_fl`, not "headlight".
 * Delta "Light Front" is a wide chrome housing — returned separately as housing.
 * @param {THREE.Object3D} root
 * @returns {THREE.Mesh[]}
 */
function findHeadlights(root) {
  const hull = localHull(root);
  const c = new THREE.Vector3();
  const s = new THREE.Vector3();
  const named = [];
  root.traverse((obj) => {
    if (!obj.isMesh || obj.userData.brake || obj.userData.licensePlate) return;
    const label = ancestryLabel(obj);
    if (isFullLengthLightSheetLabel(label)) return;
    if (!isNamedFrontLamp(label)) return;
    const box = new THREE.Box3().setFromObject(obj);
    box.getCenter(c);
    box.getSize(s);
    root.worldToLocal(c);
    // Compact Celica-style lenses: keep the cluster gate.
    // Oversized Delta "Light Front" housing is handled by nestHeadEmitters.
    if (isFrontHeadlampCluster(c, hull, s)) named.push(obj);
  });
  if (named.length) return named;

  const hits = [];
  root.traverse((obj) => {
    if (!obj.isMesh || obj.userData.brake || obj.userData.licensePlate) return;
    const label = ancestryLabel(obj);
    if (isFullLengthLightSheetLabel(label)) return;
    if (isRearLampLabel(label)) return;
    if (/window|windshield|interior|cabin|mirror|wheel/.test(label)) return;
    const box = new THREE.Box3().setFromObject(obj);
    box.getCenter(c);
    box.getSize(s);
    root.worldToLocal(c);
    if (!isFrontHeadlampCluster(c, hull, s)) return;
    const lampish = /lights_glass|lights_pod|light glass|lightbump|^light$|lens|optic|head/.test(
      matName(obj).toLowerCase() + " " + label
    );
    if (!lampish) return;
    hits.push(obj);
  });
  return hits;
}

/**
 * Delta Integrale chrome housing named "Light Front" (often too large for the
 * compact headlamp cluster test).
 * @param {THREE.Object3D} root
 * @returns {THREE.Mesh|null}
 */
function findFrontLightHousing(root) {
  let best = null;
  let bestScore = -1;
  const c = new THREE.Vector3();
  const hull = localHull(root);
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const label = ancestryLabel(obj);
    if (isFullLengthLightSheetLabel(label)) return;
    if (!/light[\s_.-]*front|frontlight|front[\s_.-]*light/.test(label)) return;
    if (isRearLampLabel(label)) return;
    const box = new THREE.Box3().setFromObject(obj);
    box.getCenter(c);
    root.worldToLocal(c);
    // Must sit on the nose half of the car (game +Z forward).
    if (c.z < (hull.minZ + hull.maxZ) * 0.5) return;
    const score = box.getSize(new THREE.Vector3()).x + c.z;
    if (score > bestScore) {
      bestScore = score;
      best = obj;
    }
  });
  return best;
}

/**
 * Sit two emissive pads on the forward face of a front light housing (Delta).
 * @param {THREE.Mesh} lampMesh
 * @param {THREE.Object3D} root
 * @returns {THREE.Mesh[]}
 */
function nestHeadEmittersInLamp(lampMesh, root) {
  if (!lampMesh || !lampMesh.isMesh || !lampMesh.geometry) return [];
  if (!lampMesh.geometry.boundingBox) lampMesh.geometry.computeBoundingBox();
  const bb = lampMesh.geometry.boundingBox;
  if (!bb) return [];
  const cy = (bb.min.y + bb.max.y) * 0.42;
  const a = new THREE.Vector3(0, cy, bb.min.z);
  const b = new THREE.Vector3(0, cy, bb.max.z);
  lampMesh.localToWorld(a);
  lampMesh.localToWorld(b);
  root.worldToLocal(a);
  root.worldToLocal(b);
  // Sketchfab Delta: nose is −Z in mesh space before yaw; pick the game-forward tip.
  const frontZ = a.z >= b.z ? bb.min.z : bb.max.z;
  const xSpan = Math.max(0.28, (bb.max.x - bb.min.x) * 0.28);
  const sx = Math.max(0.14, Math.min(0.26, (bb.max.x - bb.min.x) * 0.16));
  const sy = Math.max(0.09, Math.min(0.15, (bb.max.y - bb.min.y) * 0.28));
  const sz = 0.055;
  const pads = [
    { x: -xSpan, y: cy, z: frontZ },
    { x: xSpan, y: cy, z: frontZ },
  ];
  const out = [];
  for (let i = 0; i < pads.length; i++) {
    const pad = makeHeadLamp(sx, sy, sz);
    pad.position.set(pads[i].x, pads[i].y, pads[i].z);
    pad.name = "head-emitter";
    // Not a floating fascia dummy — scrubDeltaHeadArtifacts must keep these.
    pad.userData.headDummy = false;
    pad.userData.headEmitter = true;
    lampMesh.add(pad);
    out.push(pad);
  }
  return out;
}

function isHeadlampLensMesh(obj) {
  const label = ancestryLabel(obj);
  const mat = matName(obj).toLowerCase();
  if (/glass/.test(mat) || /glass/.test(label)) return true;
  if (/lights_glass|light glass|^light$/.test(mat)) return true;
  return !!(obj.userData && obj.userData.head);
}

/**
 * Main projectors beat bumper spots and housings. Used to place the two beams.
 * @param {string} label
 * @param {THREE.Vector3} c
 * @param {{minY:number,maxY:number}} hull
 */
function headlampBeamScore(label, c, hull) {
  let score = 0;
  if (/light_glass_f[lr]/.test(label) && !/light_2/.test(label)) score += 12;
  if (/x0_light_glass/.test(label) && !/light_2/.test(label)) score += 10;
  if (/frontlight|light.?front|front.?light|head.?light/.test(label)) score += 5;
  if (/glass/.test(label) && !/opaque/.test(label)) score += 3;
  if (/light_2|fog|aux|spot|pod/.test(label)) score -= 5;
  const spanY = Math.max(0.01, hull.maxY - hull.minY);
  const yNorm = (c.y - hull.minY) / spanY;
  if (yNorm >= 0.22 && yNorm <= 0.48) score += 3;
  score += Math.min(1.5, Math.abs(c.x));
  return score;
}

/**
 * Local beam origins on the actual lens centers (not the mesh pivot, which is
 * often at the car origin on Sketchfab exports).
 * @param {THREE.Object3D} root
 * @param {THREE.Mesh[]} lamps
 * @returns {THREE.Vector3[]}
 */
function pickHeadlightBeamOrigins(root, lamps) {
  if (!lamps || !lamps.length) return [];
  const hull = localHull(root);
  const c = new THREE.Vector3();
  const s = new THREE.Vector3();
  const left = [];
  const right = [];
  const bars = [];
  for (let i = 0; i < lamps.length; i++) {
    const lamp = lamps[i];
    lamp.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(lamp);
    box.getCenter(c);
    box.getSize(s);
    root.worldToLocal(c);
    const label = ancestryLabel(lamp);
    const score = headlampBeamScore(label, c, hull);
    if (s.x > 0.85 && Math.abs(c.x) < 0.35) {
      bars.push({
        y: c.y,
        z: c.z,
        half: Math.min(s.x * 0.36, (hull.maxX - hull.minX) * 0.34),
        score,
      });
      continue;
    }
    const rec = { x: c.x, y: c.y, z: c.z, score };
    if (c.x >= 0) right.push(rec);
    else left.push(rec);
  }
  const best = (arr) => (arr.length ? arr.sort((a, b) => b.score - a.score)[0] : null);
  let L = best(left);
  let R = best(right);
  if ((!L || !R) && bars.length) {
    const bar = best(bars);
    L = L || { x: -bar.half, y: bar.y, z: bar.z };
    R = R || { x: bar.half, y: bar.y, z: bar.z };
  }
  if (!L && R) L = { x: -R.x, y: R.y, z: R.z };
  if (!R && L) R = { x: -L.x, y: L.y, z: L.z };
  if (!L || !R) return [];
  return [new THREE.Vector3(L.x, L.y, L.z + 0.04), new THREE.Vector3(R.x, R.y, R.z + 0.04)];
}

/**
 * @param {THREE.Group} root
 * @param {Array<{x:number,y:number,z:number,w?:number,h?:number,d?:number}>} specs
 */
function attachHeadlights(root, specs) {
  const list = root.userData.headlights || [];
  for (const s of specs) {
    const lamp = makeHeadLamp(s.w || 0.2, s.h || 0.14, s.d || 0.08);
    lamp.position.set(s.x, s.y, s.z);
    root.add(lamp);
    list.push(lamp);
  }
  root.userData.headlights = list;
}

/**
 * @param {THREE.Object3D} root
 */
function ensureHeadlights(root) {
  scrubDeltaHeadArtifacts(root);

  const existing = liveLampList(root.userData.headlights);
  if (existing && !existing.some((o) => o.userData && o.userData.headDummy)) {
    root.userData.headlights = existing;
    if (!root.userData.headBeamOrigins || root.userData.headBeamOrigins.length < 2) {
      root.userData.headBeamOrigins = pickHeadlightBeamOrigins(root, existing);
    }
    return;
  }
  // Drop stale procedural boxes (Delta used these when Light Front failed size checks).
  if (existing) {
    for (let i = 0; i < existing.length; i++) {
      const lamp = existing[i];
      if (lamp.userData && lamp.userData.headDummy && lamp.parent) lamp.parent.remove(lamp);
    }
  }

  const found = findHeadlights(root);
  const lenses = found.filter(isHeadlampLensMesh);
  const lamps = lenses.length >= 2 ? lenses : found;
  if (lamps.length) {
    for (let i = 0; i < lamps.length; i++) {
      const mesh = lamps[i];
      mesh.userData.head = true;
      const mats = [].concat(mesh.material || []);
      for (let m = 0; m < mats.length; m++) {
        const mat = mats[m];
        if (!mat) continue;
        if (!mat.emissive) mat.emissive = new THREE.Color(0xfff4d4);
        else mat.emissive.setHex(0xfff4d4);
        mat.emissiveIntensity = 0;
        mat.toneMapped = false;
      }
    }
    root.userData.headlights = lamps;
    root.userData.headBeamOrigins = pickHeadlightBeamOrigins(root, lamps);
    return;
  }

  // Delta: nest pads in the "Light Front" chrome housing instead of floating boxes.
  const housing = findFrontLightHousing(root);
  if (housing) {
    const emitters = nestHeadEmittersInLamp(housing, root);
    if (emitters.length) {
      root.userData.headlights = emitters;
      root.userData.headBeamOrigins = pickHeadlightBeamOrigins(root, emitters);
      return;
    }
  }

  const hull = localHull(root);
  const sizeX = hull.maxX - hull.minX;
  const sizeY = hull.maxY - hull.minY;
  const z = hull.maxZ - 0.03;
  const y = hull.minY + sizeY * 0.38;
  const x = Math.max(0.5, Math.min(0.72, sizeX * 0.36));
  if (root.userData.stratosCad) {
    root.userData.headlights = [];
    root.userData.headBeamOrigins = [
      new THREE.Vector3(-x, y, z),
      new THREE.Vector3(x, y, z),
    ];
    return;
  }
  attachHeadlights(root, [
    { x, y, z, w: 0.22, h: 0.14, d: 0.09 },
    { x: -x, y, z, w: 0.22, h: 0.14, d: 0.09 },
  ]);
  root.userData.headBeamOrigins = pickHeadlightBeamOrigins(root, root.userData.headlights);
}

/**
 * Player-only beams that light the road. Parent to the car so they follow yaw.
 * Origins come from the lens bounding-box centers, not mesh pivots.
 * @param {THREE.Object3D} root
 */
function attachHeadBeams(root) {
  let origins = root.userData.headBeamOrigins;
  if (!origins || origins.length < 2) {
    origins = pickHeadlightBeamOrigins(root, root.userData.headlights || []);
    root.userData.headBeamOrigins = origins;
  }
  const beams = [];
  for (let i = 0; i < Math.min(2, origins.length); i++) {
    const o = origins[i];
    const spot = new THREE.SpotLight(
      0xfff6e4,
      0,
      TUNNEL.headBeamDistance || 175,
      TUNNEL.headBeamAngle || Math.PI / 7.8,
      TUNNEL.headBeamPenumbra != null ? TUNNEL.headBeamPenumbra : 0.48,
      TUNNEL.headBeamDecay != null ? TUNNEL.headBeamDecay : 0.95
    );
    spot.position.copy(o);
    spot.castShadow = false;
    spot.visible = true;
    const aim = new THREE.Object3D();
    aim.position.set(o.x * 0.18, Math.max(0.02, o.y - 0.42), o.z + 36);
    root.add(spot, aim);
    spot.target = aim;
    beams.push(spot);
  }
  root.userData.headBeams = beams;
}

/**
 * Tunnel lamps. `on` may be 0–1 for a fade.
 * @param {THREE.Object3D} root
 * @param {boolean|number} on
 * @param {{tunnelBoost?:number}} [opts] extra beam gain inside the bore
 */
export function setHeadlights(root, on, opts = {}) {
  if (!root) return;
  const t = typeof on === "number" ? Math.max(0, Math.min(1, on)) : on ? 1 : 0;
  const emit = TUNNEL.headEmissive != null ? TUNNEL.headEmissive : 34;
  const beamInt = TUNNEL.headBeam != null ? TUNNEL.headBeam : 1280;
  const boost =
    opts.tunnelBoost != null
      ? opts.tunnelBoost
      : t > 0.55
        ? TUNNEL.headBeamTunnelBoost != null
          ? TUNNEL.headBeamTunnelBoost
          : 1.35
        : 1;
  const lamps = root.userData.headlights;
  if (lamps) {
    const body = t > 0.05 ? 0xfff9ee : 0x8a9098;
    for (let i = 0; i < lamps.length; i++) {
      const mesh = lamps[i];
      const mats = [].concat(mesh.material || []);
      for (let m = 0; m < mats.length; m++) {
        const mat = mats[m];
        if (!mat) continue;
        if (mesh.userData.headDummy || mesh.userData.headEmitter) {
          mat.emissiveIntensity = 0.18 + t * emit * Math.min(1.15, boost);
          if (mat.color) mat.color.setHex(body);
          if (mat.emissive) mat.emissive.setHex(t > 0.05 ? 0xfff4d4 : 0x445055);
        } else {
          mat.emissiveIntensity = t * emit * Math.min(1.15, boost);
        }
      }
    }
  }
  const beams = root.userData.headBeams;
  if (beams) {
    const intensity = t * beamInt * boost;
    for (let i = 0; i < beams.length; i++) {
      beams[i].intensity = intensity;
      beams[i].visible = true;
      if (TUNNEL.headBeamDistance != null) beams[i].distance = TUNNEL.headBeamDistance;
      if (TUNNEL.headBeamAngle != null) beams[i].angle = TUNNEL.headBeamAngle;
      if (TUNNEL.headBeamPenumbra != null) beams[i].penumbra = TUNNEL.headBeamPenumbra;
      if (TUNNEL.headBeamDecay != null) beams[i].decay = TUNNEL.headBeamDecay;
    }
  }
}

/** 7:30 rest, 270° clockwise to 4:30 — same canvas radians as js/ui/hud.js. */
const GAUGE_START = Math.PI * 0.75;
const GAUGE_SWEEP = Math.PI * 1.5;
/** In-car analog dials (~110 mm) so the needles read at seated FOV. */
const POV_GAUGE_R = 0.055;
const POV_SPEED_MAX_MPH = 140;
const KMH_TO_MPH = 0.621371;
/** Three.js layer for camera-locked POV HUD (rendered after post, ungraded). */
export const POV_HUD_LAYER = 1;

/**
 * Rear/front axle Z in car space from the fitted wheel hubs.
 * @param {THREE.Object3D} root
 * @returns {{rearZ:number, frontZ:number, wb:number}|null}
 */
function axleSpan(root) {
  const wheels = (root.userData.wheels || []).filter((w) => w && w.isObject3D);
  if (wheels.length < 4) return null;
  const scratch = new THREE.Vector3();
  const zs = [];
  for (let i = 0; i < wheels.length; i++) {
    wheels[i].updateWorldMatrix(true, false);
    scratch.setFromMatrixPosition(wheels[i].matrixWorld);
    root.worldToLocal(scratch);
    zs.push(scratch.z);
  }
  zs.sort((a, b) => a - b);
  const rearZ = 0.5 * (zs[0] + zs[1]);
  const frontZ = 0.5 * (zs[zs.length - 1] + zs[zs.length - 2]);
  const wb = frontZ - rearZ;
  if (!(wb > 1.8 && wb < 3.4)) return null;
  return { rearZ, frontZ, wb };
}

/**
 * Named seat / dash / hood in car space so the POV eye sits in the real cabin.
 * @param {THREE.Object3D} root
 */
function cabinLandmarks(root) {
  const c = new THREE.Vector3();
  let seat = null;
  let seatScore = 1e9;
  let dash = null;
  let dashScore = 1e9;
  let hoodY = null;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (inCockpitTree(obj)) return;
    const n = (obj.name || "").toLowerCase();
    const box = new THREE.Box3().setFromObject(obj);
    box.getCenter(c);
    root.worldToLocal(c);
    const min = box.min.clone();
    const max = box.max.clone();
    root.worldToLocal(min);
    root.worldToLocal(max);
    const locMinZ = Math.min(min.z, max.z);
    const locMaxZ = Math.max(min.z, max.z);
    const locMaxY = Math.max(min.y, max.y);
    if (/seat|chair|bucket/.test(n) && !/rear|back.?seat/.test(n) && c.x < 0.05) {
      const score =
        (/driver|lhd|left/.test(n) ? -1.5 : 0) + Math.abs(c.x + 0.36) + Math.abs(c.y - 0.5);
      if (score < seatScore) {
        seatScore = score;
        seat = { x: c.x, y: c.y, z: c.z, maxZ: locMaxZ, minZ: locMinZ, maxY: locMaxY };
      }
    }
    if (/dash|dashboard|cowl|fascia|facia|instrument/.test(n) && Math.abs(c.x) < 0.7) {
      const score = Math.abs(c.y - 0.85) + Math.abs(c.x);
      if (score < dashScore) {
        dashScore = score;
        dash = { z: c.z, minZ: locMinZ, maxY: locMaxY, y: c.y };
      }
    }
    if (/hood|bonnet/.test(n) && Math.abs(c.x) < 0.55) hoodY = c.y;
  });
  const glbWheel = root.userData.glbSteerWheel;
  let wheel = null;
  if (glbWheel) {
    const box = new THREE.Box3().setFromObject(glbWheel);
    const wc = box.getCenter(new THREE.Vector3());
    root.worldToLocal(wc);
    wheel = { x: wc.x, y: wc.y, z: wc.z };
  }
  return { seat, dash, hoodY, wheel };
}

/**
 * Named steering-wheel node in the GLB cabin, if the car was modeled with one.
 * @param {THREE.Object3D} root
 * @returns {THREE.Object3D|null}
 */
function findGlbSteerNode(root) {
  const c = new THREE.Vector3();
  const size = new THREE.Vector3();
  let best = null;
  let bestScore = 1e9;
  root.traverse((obj) => {
    if (inCockpitTree(obj)) return;
    const n = (obj.name || "").toLowerCase();
    // STEER_HR / SteeringWheel / volante — `\bsteer\b` misses STEER_HR because `_` is a word char.
    if (!/steer/.test(n) && !/volante/.test(n)) return;
    if (/tire|tyre|wheel_(fl|fr|rl|rr)|wheel\.(fl|fr)|road.?wheel|power.?steer|rack/.test(n)) return;
    if (/_lr\b|steer_lr/.test(n)) return;
    const box = new THREE.Box3().setFromObject(obj);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim < 0.12 || maxDim > 1.25) return;
    box.getCenter(c);
    root.worldToLocal(c);
    if (c.y < 0.28 || c.y > 1.55) return;
    const score =
      Math.abs(c.x) * 0.35 +
      (c.x > 0 ? 0.2 : 0) +
      Math.abs(c.y - 0.72) +
      (/_hr\b|steer_hr|steering.?wheel/.test(n) ? -0.4 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = obj;
    }
  });
  if (!best) {
    root.traverse((obj) => {
      if (!obj.isMesh || inCockpitTree(obj)) return;
      const n = (obj.name || "").toLowerCase();
      if (/tire|tyre|wheel_(fl|fr|rl|rr)|brake|disc|rotor|caliper/.test(n)) return;
      const box = new THREE.Box3().setFromObject(obj);
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z);
      const minDim = Math.min(size.x, size.y, size.z);
      if (maxDim < 0.22 || maxDim > 0.52 || minDim > maxDim * 0.42) return;
      box.getCenter(c);
      root.worldToLocal(c);
      const absX = Math.abs(c.x);
      if (absX < 0.12 || absX > 0.55 || c.y < 0.5 || c.y > 1.2 || c.z < -0.35 || c.z > 0.85) return;
      const score = Math.abs(absX - 0.36) + Math.abs(c.y - 0.7) + (c.x > 0 ? 0.15 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = obj;
      }
    });
  }
  if (!best) return null;
  let node = best;
  for (let p = best.parent; p && p !== root; p = p.parent) {
    const pn = (p.name || "").toLowerCase();
    if (/cockpit|interior|cabin/.test(pn)) break;
    if (/steer/.test(pn) && !/power.?steer|rack/.test(pn)) node = p;
  }
  return node;
}

/**
 * AABB of `obj` in its own local space (not a world-axis box).
 * World AABB of a tilted rim picks a car-space axis; rotateOnAxis then
 * tumbles the wheel instead of spinning it like a steering wheel.
 * @param {THREE.Object3D} obj
 * @returns {THREE.Box3}
 */
function localSpaceBox(obj) {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3();
  const inv = new THREE.Matrix4().copy(obj.matrixWorld).invert();
  const childLocal = new THREE.Matrix4();
  obj.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const geom = child.geometry;
    if (!geom.boundingBox) geom.computeBoundingBox();
    if (!geom.boundingBox) return;
    const b = geom.boundingBox.clone();
    childLocal.multiplyMatrices(inv, child.matrixWorld);
    b.applyMatrix4(childLocal);
    box.union(b);
  });
  return box;
}

/**
 * Thinnest local AABB axis — the steering-column spin for a disc-shaped wheel.
 * Must be measured in the node's local frame, not world AABB.
 * @param {THREE.Box3} box
 * @returns {THREE.Vector3}
 */
function localDiscAxis(box) {
  const s = box.getSize(new THREE.Vector3());
  if (s.z <= s.x && s.z <= s.y) return new THREE.Vector3(0, 0, 1);
  if (s.x <= s.y) return new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3(0, 1, 0);
}

const _steerFwd = new THREE.Vector3(0, 0, 1);

/**
 * Parent the modeled rim under a spin group whose +Z is the column.
 * Cockpit anim then sets rotation.z — the same motion as the procedural torus.
 * @param {THREE.Object3D} root
 * @param {THREE.Object3D} node
 */
function armSteerSpin(root, node) {
  const box = localSpaceBox(node);
  if (box.isEmpty()) {
    root.userData.steerSpin = node;
    root.userData.steerAxis = "z";
    return;
  }
  const axisLocal = localDiscAxis(box);
  const axisParent = axisLocal.clone().applyQuaternion(node.quaternion).normalize();
  // Match the procedural column: +Z of the spin group points into the dash.
  if (axisParent.z < 0) axisParent.negate();

  const center = box.getCenter(new THREE.Vector3());
  center.applyQuaternion(node.quaternion).add(node.position);

  node.updateWorldMatrix(true, true);
  const world = node.matrixWorld.clone();

  const pivot = new THREE.Group();
  pivot.name = "steer-spin";
  pivot.userData.glbSteer = true;
  root.add(pivot);
  pivot.position.copy(center);
  pivot.quaternion.setFromUnitVectors(_steerFwd, axisParent);
  pivot.updateMatrixWorld(true);

  if (node.parent) node.parent.remove(node);
  pivot.add(node);
  const local = new THREE.Matrix4().copy(pivot.matrixWorld).invert().multiply(world);
  local.decompose(node.position, node.quaternion, node.scale);

  root.userData.steerSpin = pivot;
  root.userData.steerAxis = Math.abs(axisLocal.x) > 0.5 ? "x" : Math.abs(axisLocal.y) > 0.5 ? "y" : "z";
}

/**
 * Lift the modeled wheel onto the car root so POV can show it without
 * unhiding a clipping interior parent, and so chase can hide it alone.
 * @param {THREE.Object3D} root
 */
function bindGlbSteeringWheel(root) {
  if (root.userData.glbSteerSearched) return root.userData.glbSteerWheel || null;
  root.userData.glbSteerSearched = true;
  const node = findGlbSteerNode(root);
  if (!node) {
    root.userData.glbSteerWheel = null;
    return null;
  }
  root.updateMatrixWorld(true);
  node.updateWorldMatrix(true, true);
  const world = node.matrixWorld.clone();
  if (node.parent) node.parent.remove(node);
  root.add(node);
  const local = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(world);
  local.decompose(node.position, node.quaternion, node.scale);
  // POV is LHD (negative X). Rally GLBs are often RHD — move the modeled
  // rim across rather than drawing a second torus.
  if (node.position.x > 0.08) {
    node.position.x = -node.position.x;
  }
  node.visible = false;
  node.userData.glbSteer = true;
  node.userData.interiorKeepHidden = false;
  node.traverse((o) => {
    o.userData.glbSteer = true;
    o.userData.interiorKeepHidden = false;
  });
  root.userData.glbSteerWheel = node;
  root.userData.steerWheel = node;
  armSteerSpin(root, node);
  return node;
}

function isLampish(obj) {
  if (isLampMaterial(obj)) return true;
  if (obj.userData && (obj.userData.head || obj.userData.brake)) return true;
  for (let p = obj; p; p = p.parent) {
    const n = ((p.name || "") + " " + matName(p)).toLowerCase();
    if (/window|windshield|windscreen/.test(n)) continue;
    if (/head.?light|tail|brake.?light|lamp|fog|indicator|light.?glass|lightglass|_light_|lens/.test(n)) {
      return true;
    }
  }
  return false;
}

function isExteriorMirrorGlass(obj, hull, c) {
  const n = ((obj.name || "") + " " + matName(obj)).toLowerCase();
  if (/wing.?mirror|side.?mirror|door.?mirror/.test(n)) return true;
  const halfW = (hull.maxX - hull.minX) * 0.5;
  return Math.abs(c.x) > halfW * 0.72 && c.y > 0.55 && c.y < 1.2 && Math.abs(c.z) < 1.2;
}

/**
 * One-time list of glass / roof shell meshes POV hides. Avoids a full GLB
 * traverse every time the player hits C. Versioned so a live car re-hides
 * roofs that were previously skipped as "interior".
 * @param {THREE.Object3D} root
 */
function buildPovHideCache(root) {
  if (!root) return;
  const POV_HIDE_VER = 4;
  if (root.userData._povHideReady && root.userData._povHideVer === POV_HIDE_VER) return;
  // Re-tag so roofs marked interior still get povShell (Sprint 543).
  tagPovShell(root);
  /** @type {THREE.Object3D[]} */
  const hide = [];
  const keepHidden = [];
  const steer = [];
  const hull = localHull(root);
  const spanY = Math.max(0.2, hull.maxY - hull.minY);
  const spanZ = Math.max(0.2, hull.maxZ - hull.minZ);
  const c = new THREE.Vector3();
  const s = new THREE.Vector3();
  root.traverse((obj) => {
    if (!obj.userData) return;
    if (obj.userData.windshield || obj.userData.povShell) {
      hide.push(obj);
      return;
    }
    if (obj.userData.interiorKeepHidden) keepHidden.push(obj);
    if (obj.userData.glbSteer) steer.push(obj);
    // Interior roofs / headers that tagPovShell missed on older tags.
    if (obj.isMesh && obj.userData.interior && !inCockpitTree(obj)) {
      const n = (obj.name || "").toLowerCase();
      if (/roof|headliner|ceiling|cabin.?top|header|canopy|top.?shell|cabin.?shell/.test(n)) {
        hide.push(obj);
        return;
      }
      const box = new THREE.Box3().setFromObject(obj);
      box.getCenter(c);
      box.getSize(s);
      root.worldToLocal(c);
      const high = c.y > hull.minY + spanY * 0.58;
      const midCabin = c.z > hull.minZ + spanZ * 0.18 && c.z < hull.maxZ - spanZ * 0.05;
      const slab = s.y < 0.42 && s.x > spanY * 0.35;
      if (high && midCabin && slab) hide.push(obj);
    }
  });
  root.userData._povHide = hide;
  root.userData._povKeepHidden = keepHidden;
  root.userData._povSteer = steer;
  root.userData._povHideReady = true;
  root.userData._povHideVer = POV_HIDE_VER;
}

/**
 * Per-car driver eye + look targets from the fitted hull (+Z forward, LHD left).
 * Cached on the mesh so every GLB gets a seat that actually sits in the cabin.
 * @param {THREE.Object3D} root
 */
function buildPovRig(root) {
  const hull = localHull(root);
  const spanX = hull.maxX - hull.minX;
  const spanY = hull.maxY - hull.minY;
  const spanZ = hull.maxZ - hull.minZ;
  const ground = hull.minY;
  const roof = hull.maxY;
  const axles = axleSpan(root);
  const marks = cabinLandmarks(root);

  // Always LHD: negative X. Prefer the modeled wheel, then the left seat.
  let eyeX;
  if (marks.wheel && marks.wheel.x < 0.08) {
    eyeX = marks.wheel.x;
  } else if (marks.seat && marks.seat.x < 0) {
    eyeX = marks.seat.x;
  } else {
    eyeX = hull.minX + spanX * 0.22;
  }
  eyeX = THREE.MathUtils.clamp(eyeX, -0.5, -0.22);

  // In front of the seat back, behind the dash — looking out over the hood.
  let eyeZ = axles ? axles.rearZ + axles.wb * 0.5 : hull.minZ + spanZ * 0.52;
  if (axles) {
    eyeZ = THREE.MathUtils.clamp(
      eyeZ,
      axles.rearZ + axles.wb * 0.42,
      axles.frontZ - axles.wb * 0.36
    );
  }
  if (marks.seat) {
    eyeZ = Math.max(eyeZ, marks.seat.maxZ + 0.1);
    eyeZ = Math.max(eyeZ, marks.seat.z + 0.22);
  }
  if (marks.dash) eyeZ = Math.min(eyeZ, marks.dash.minZ - 0.38);
  if (marks.wheel) eyeZ = Math.min(eyeZ, marks.wheel.z - 0.28);

  // Clear the cowl without sitting inside the roof (FOV 80 + roof−0.12 clipped
  // the underside of the cabin top into the lens — Sprint 543).
  const seated = ground + 1.15;
  let eyeY = THREE.MathUtils.clamp(ground + 1.18, seated, roof - 0.4);
  if (marks.dash) {
    eyeY = Math.max(eyeY, marks.dash.maxY + 0.08);
    eyeY = Math.min(eyeY, roof - 0.4);
  }
  if (marks.wheel) {
    eyeY = THREE.MathUtils.clamp(marks.wheel.y + 0.14, seated, roof - 0.4);
  }

  let hoodY = ground + Math.min(0.92, spanY * 0.48);
  if (marks.hoodY != null) hoodY = marks.hoodY;
  const lookX = eyeX * 0.12;
  // Aim at the road ahead — keep look below the eye so the roof stays out of frame.
  const lookY = THREE.MathUtils.clamp(hoodY + 0.12, ground + 0.8, eyeY - 0.12);
  const lookZ = hull.maxZ + 4.2;
  const mirrorEyeX = eyeX * 0.12;
  const mirrorEyeY = THREE.MathUtils.clamp(eyeY + 0.11, eyeY + 0.08, roof - 0.1);
  const mirrorEyeZ = eyeZ + 0.34;
  // Capture from just behind the bumper looking aft — not from the interior
  // glass, which only sees cabin void / clipped near-plane (black rectangle).
  // Sit a touch under the roof so the framed band is road + horizon, not sky.
  const mirrorCamX = 0;
  const mirrorCamY = THREE.MathUtils.clamp(roof - 0.22, eyeY + 0.02, roof - 0.06);
  const mirrorCamZ = hull.minZ - 0.55;
  const mirrorLookZ = hull.minZ - Math.max(22, spanZ * 3.4);
  return {
    eyeX,
    eyeY,
    eyeZ,
    lookX,
    lookY,
    lookZ,
    mirrorEyeX,
    mirrorEyeY,
    mirrorEyeZ,
    mirrorCamX,
    mirrorCamY,
    mirrorCamZ,
    mirrorLookX: 0,
    mirrorLookY: THREE.MathUtils.clamp(ground + 1.05, ground + 0.65, roof - 0.28),
    mirrorLookZ,
    spanX,
    spanY,
    spanZ,
    hull,
    fov: 80,
    near: 0.05,
  };
}

/**
 * Driver-seat POV rig for the active car mesh.
 * @param {THREE.Object3D} root
 */
export function getPovRig(root) {
  if (!root) return null;
  // Bump when mirrorCam / eye landmarks change so a live mesh re-aims.
  const POV_RIG_VER = 5;
  const prev = root.userData.povRig;
  if (!prev || prev._v !== POV_RIG_VER) {
    const next = buildPovRig(root);
    next._v = POV_RIG_VER;
    if (prev && prev.head) {
      next.head = prev.head;
      next.lookNode = prev.lookNode;
    }
    root.userData.povRig = next;
    ensurePovHead(root, next);
  }
  return root.userData.povRig;
}

/**
 * Hide roof / upper shell in POV so the lens reads as inside the cabin.
 * @param {THREE.Object3D} root
 */
function tagPovShell(root) {
  const hull = localHull(root);
  const spanY = hull.maxY - hull.minY;
  const spanZ = hull.maxZ - hull.minZ;
  const c = new THREE.Vector3();
  const s = new THREE.Vector3();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData.windshield || obj.userData.povHud) return;
    if (inCockpitTree(obj)) return;
    const n = (obj.name || "").toLowerCase();
    // Roofs / headers block the lens — tag even when also marked interior
    // (procedural loft roofs set interior=true and used to stay visible in POV).
    if (
      /roof|headliner|cabin.?top|interior.?roof|ceiling|header.?rail|canopy|coupe.?top|top.?panel|cabin.?shell|body.?top|hardtop|targa|sunroof|skylight/.test(
        n
      )
    ) {
      obj.userData.povShell = true;
      return;
    }
    if (
      /a.?pillar|apillar|b.?pillar|front.?pillar|window.?frame|windscreen.?frame|windshield.?frame|door.?frame|roll.?cage|cage|header/.test(
        n
      ) &&
      !/wheel|tire|tyre|seat|steer/.test(n)
    ) {
      obj.userData.povShell = true;
      return;
    }
    // Dash / seats stay; only geometric roof slabs among interiors are hidden.
    const box = new THREE.Box3().setFromObject(obj);
    box.getCenter(c);
    box.getSize(s);
    root.worldToLocal(c);
    const spanX = hull.maxX - hull.minX;
    const high = c.y > hull.minY + spanY * 0.55;
    const midCabin = c.z > hull.minZ + spanZ * 0.18 && c.z < hull.maxZ - spanZ * 0.06;
    const wide = s.x > spanY * 0.45 && s.z > spanZ * 0.22;
    const thinSlab = s.y < 0.45 && s.x > spanY * 0.4;
    if (high && midCabin && (wide || thinSlab)) {
      obj.userData.povShell = true;
      return;
    }
    if (obj.userData.interior) return;
    // Tall thin posts at the windshield corners — A-pillars that fill the lens.
    const tall = s.y > 0.32;
    const thin = Math.min(s.x, s.z) < 0.16 && Math.max(s.x, s.z) < 0.38;
    const outboard = Math.abs(c.x) > spanX * 0.28;
    const windshieldBand = c.z > hull.minZ + spanZ * 0.38 && c.z < hull.maxZ - spanZ * 0.04;
    const midHigh = c.y > hull.minY + spanY * 0.42 && c.y < hull.maxY - spanY * 0.04;
    if (tall && thin && outboard && windshieldBand && midHigh) obj.userData.povShell = true;
  });
}

function tagWindshield(root) {
  root.updateMatrixWorld(true);
  const hull = localHull(root);
  const c = new THREE.Vector3();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (inCockpitTree(obj)) return;
    if (isLampish(obj)) return;
    const n = ((obj.name || "") + " " + matName(obj)).toLowerCase();
    const mat = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (
      /windshield|windscreen|window|sideglass|door.?glass|quarter.?glass|frontglass|front_glass|glass_f|cabin-glass|glazing/.test(
        n
      ) &&
      !/light|lamp|lens|head|tail/.test(n)
    ) {
      obj.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(obj);
      box.getCenter(c);
      root.worldToLocal(c);
      if (isExteriorMirrorGlass(obj, hull, c)) return;
      obj.userData.windshield = true;
      return;
    }
    if (/banner|windscreen.?logo|windshield.?logo|window.?decal/.test(n)) {
      obj.userData.windshield = true;
      return;
    }
    const glass =
      mat &&
      (mat.transparent ||
        (mat.opacity != null && mat.opacity < 0.85) ||
        /glass|window/.test(n));
    if (!glass) return;
    obj.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(obj);
    box.getCenter(c);
    root.worldToLocal(c);
    if (isExteriorMirrorGlass(obj, hull, c)) return;
    const cabinY = c.y > hull.minY + 0.5;
    const notNose = c.z < hull.maxZ - 0.22;
    const inCabinX = Math.abs(c.x) < (hull.maxX - hull.minX) * 0.55;
    if (cabinY && notNose && inCabinX) obj.userData.windshield = true;
  });
}

/**
 * Mark cabin dash/roof/seats so POV can hide them. Chase view keeps the body.
 * @param {THREE.Object3D} root
 */
function tagInterior(root) {
  root.updateMatrixWorld(true);
  const scratchC = new THREE.Vector3();
  const scratchS = new THREE.Vector3();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (obj.userData.windshield || obj.userData.brake || obj.userData.head) return;
    if (inCockpitTree(obj)) return;
    const n = (obj.name || "").toLowerCase();
    if (/dash|interior|steering.?wheel|gauge|meter|seat|cabin|console|cluster|binnacle|speedo|tach|headliner/.test(n)) {
      obj.userData.interior = true;
      return;
    }
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(scratchC);
    const s = box.getSize(scratchS);
    root.worldToLocal(c);
    const inCabin = Math.abs(c.x) < 0.9 && c.y > 0.5 && c.y < 1.4 && c.z > -1.2 && c.z < 0.88;
    const notWholeBody = s.x < 1.85 && s.z < 2.4 && s.y < 1.05;
    if (inCabin && notWholeBody) obj.userData.interior = true;
  });
}

function inCockpitTree(obj) {
  let p = obj;
  while (p) {
    if (p.userData && p.userData.povHud) return true;
    if (p.name === "cockpit" || p.userData.cockpit === p) return true;
    p = p.parent;
  }
  return false;
}

/**
 * Analog face matching the chase HUD: 0 at 7:30, sweep clockwise to 4:30.
 * @param {"speed"|"rpm"} kind
 * @param {number} maxVal MPH or RPM×1000
 * @param {number} [redFrom] redline start on the same scale
 */
function gaugeFace(kind, maxVal, redFrom) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  const cx = 128;
  const cy = 128;
  const r = 120;
  const bezel = g.createLinearGradient(0, 0, 256, 256);
  bezel.addColorStop(0, "#ece8de");
  bezel.addColorStop(0.22, "#9a968c");
  bezel.addColorStop(0.48, "#3a3936");
  bezel.addColorStop(0.72, "#cfc9bc");
  bezel.addColorStop(1, "#1e1e1c");
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = bezel;
  g.fill();
  g.beginPath();
  g.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
  g.fillStyle = "#0a0a0a";
  g.fill();
  const face = g.createRadialGradient(cx, cy - r * 0.08, r * 0.05, cx, cy, r * 0.86);
  face.addColorStop(0, "#1c1e1b");
  face.addColorStop(0.7, "#101110");
  face.addColorStop(1, "#080908");
  g.beginPath();
  g.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
  g.fillStyle = face;
  g.fill();
  const red = redFrom != null && redFrom < maxVal ? redFrom : maxVal * 0.86;
  if (red < maxVal) {
    const a0 = GAUGE_START + (red / maxVal) * GAUGE_SWEEP;
    const a1 = GAUGE_START + GAUGE_SWEEP;
    g.beginPath();
    g.arc(cx, cy, r * 0.84, a0, a1);
    g.arc(cx, cy, r * 0.72, a1, a0, true);
    g.closePath();
    g.fillStyle = "rgba(196, 28, 28, 0.55)";
    g.fill();
  }
  g.textAlign = "center";
  g.textBaseline = "middle";
  const major = kind === "rpm" ? 1 : 20;
  const minor = kind === "rpm" ? 1 : 10;
  const steps = Math.round(maxVal / minor);
  for (let i = 0; i <= steps; i++) {
    const v = i * minor;
    if (v > maxVal + 0.001) break;
    const t = v / maxVal;
    const a = GAUGE_START + t * GAUGE_SWEEP;
    const isMajor = Math.abs(v / major - Math.round(v / major)) < 0.001;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    g.strokeStyle = v >= red ? "#ff6a62" : "#e8e4d8";
    g.lineWidth = isMajor ? 3.2 : 1.6;
    g.beginPath();
    g.moveTo(cx + cos * r * (isMajor ? 0.74 : 0.79), cy + sin * r * (isMajor ? 0.74 : 0.79));
    g.lineTo(cx + cos * r * 0.84, cy + sin * r * 0.84);
    g.stroke();
    if (isMajor) {
      g.fillStyle = v >= red ? "#ff8a82" : "#f2eee4";
      g.font = "bold 22px sans-serif";
      g.fillText(String(Math.round(v)), cx + cos * r * 0.62, cy + sin * r * 0.62);
    }
  }
  g.fillStyle = "rgba(232,228,216,0.62)";
  g.font = "bold 15px sans-serif";
  g.fillText(kind === "rpm" ? "RPM" : "MPH", cx, cy - r * 0.08);
  if (kind === "rpm") {
    g.font = "12px sans-serif";
    g.fillStyle = "rgba(232,228,216,0.42)";
    g.fillText("×1000", cx, cy + 8);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Cabin HUD mesh: skip ACES, live on the overlay layer.
 * Gauges use depthTest so the steering wheel can sit in front; mirror glass
 * keeps depthTest off so the rim never eats the rearview image.
 * @param {THREE.Mesh} mesh
 * @param {number} [order]
 * @param {{depthTest?: boolean}} [opts]
 */
function markPovHudMesh(mesh, order, opts) {
  if (!mesh) return;
  mesh.layers.set(POV_HUD_LAYER);
  mesh.frustumCulled = false;
  mesh.renderOrder = order != null ? order : 20;
  const wantDepth = !!(opts && opts.depthTest);
  const list = [].concat(mesh.material || []);
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    if (!m) continue;
    m.userData.hud = true;
    m.toneMapped = false;
    m.fog = false;
    m.depthTest = wantDepth;
    m.depthWrite = false;
    m.transparent = true;
    if (m.opacity == null || m.opacity > 0.98) m.opacity = 1;
  }
}

/**
 * Steering rim must live on the POV overlay layer with the gauges. The main
 * present (post/pipeline) does not leave a depth buffer the overlay can use,
 * so a layer-0 wheel cannot occlude layer-1 discs — gauges floated in front.
 * @param {THREE.Object3D} node
 */
function markSteerPovLayer(node) {
  if (!node) return;
  node.traverse((obj) => {
    obj.layers.set(POV_HUD_LAYER);
    if (!obj.isMesh) return;
    obj.frustumCulled = false;
    // Below gauge faces (20) / needles (21) so depthTest can hide discs behind the rim.
    obj.renderOrder = 8;
    const mats = [].concat(obj.material || []);
    for (let i = 0; i < mats.length; i++) {
      const m = mats[i];
      if (!m) continue;
      m.depthTest = true;
      m.depthWrite = true;
      m.userData.povSteer = true;
    }
  });
}

/**
 * Forward-most Z of the steering rim in car space (+Z = nose). Cluster must
 * sit past this so the rim is between the eye and the dials.
 * @param {THREE.Object3D} root
 * @param {THREE.Object3D|null} wheel
 * @param {number} eyeZ
 * @returns {number}
 */
function steeringRimForwardZ(root, wheel, eyeZ) {
  if (!wheel) return eyeZ + 0.4;
  root.updateMatrixWorld(true);
  wheel.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(wheel);
  if (box.isEmpty()) {
    return Number.isFinite(wheel.position.z) ? wheel.position.z : eyeZ + 0.4;
  }
  const a = box.min.clone();
  const b = box.max.clone();
  root.worldToLocal(a);
  root.worldToLocal(b);
  return Math.max(a.z, b.z);
}

function hudMat(opts) {
  const mat = new THREE.MeshBasicMaterial({
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    transparent: true,
    opacity: 1,
    ...opts,
  });
  if (mat.map) mat.color.setHex(0xffffff);
  mat.toneMapped = false;
  mat.userData.hud = true;
  return mat;
}

/**
 * Needle along +X so rotation.z=0 is 3 o'clock — the same convention as the
 * chase HUD canvas (`g.rotate(angle)` then draw toward +X). Three.js Y-up
 * makes clockwise negative, so the live angle is `-canvasAngle`.
 */
function makeNeedle() {
  const r = POV_GAUGE_R;
  const blade = r * 0.78;
  const thick = r * 0.065;
  const pivot = new THREE.Group();
  const needle = new THREE.Mesh(
    new THREE.BoxGeometry(blade, thick, thick * 0.4),
    new THREE.MeshBasicMaterial({
      color: 0xffd200,
      toneMapped: false,
      fog: false,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    })
  );
  needle.position.x = blade * 0.38;
  markPovHudMesh(needle, 21, { depthTest: true });
  const hubR = r * 0.11;
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(hubR, hubR, hubR * 0.7, 10),
    new THREE.MeshBasicMaterial({
      color: 0x161614,
      toneMapped: false,
      fog: false,
      depthTest: true,
      depthWrite: false,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    })
  );
  hub.rotation.x = Math.PI / 2;
  markPovHudMesh(hub, 22, { depthTest: true });
  pivot.add(needle, hub);
  pivot.rotation.z = -GAUGE_START;
  return pivot;
}

/**
 * One analog dial facing the driver.
 * The cluster lookAt's the seat, so group +Z points at the eye. CircleGeometry
 * already faces +Z — no Y=180, no negative scale (those show the blank back).
 * Needles stay in group XY: +X is 3 o'clock, clockwise is `-canvasAngle`.
 * @param {"speed"|"rpm"} kind
 * @param {number} maxVal
 * @param {number} [redFrom]
 */
function makeDial(kind, maxVal, redFrom) {
  const g = new THREE.Group();
  const face = new THREE.Mesh(
    new THREE.CircleGeometry(POV_GAUGE_R, 48),
    clusterMat({ map: gaugeFace(kind, maxVal, redFrom) })
  );
  markPovHudMesh(face, 20, { depthTest: true });
  const needle = makeNeedle();
  needle.position.z = 0.004;
  g.add(face, needle);
  return { group: g, needle };
}

/**
 * In-car cabin parented to the chassis (+Z forward, LHD). Gauges, wheel, seats,
 * and a live rearview sit in the driver seat — no A-pillar bars in the lens.
 * @param {THREE.Object3D} root
 */
function attachCockpit(root) {
  bindGlbSteeringWheel(root);
  root.userData.povRig = buildPovRig(root);
  const rig = root.userData.povRig;
  ensurePovHead(root, rig);
  const spec = CARS[root.userData.carId] || CARS.celica;
  /** Match chase AnalogDial max (9) so C-key does not change the tach scale. */
  const rpmMax = 9;
  const rpmRed = Math.max(6, (spec.redline || 7500) / 1000);
  const hull = rig.hull || localHull(root);

  const cab = new THREE.Group();
  cab.name = "cockpit";
  cab.userData.povHud = true;
  cab.visible = false;

  const plastic = cabinMat(0x1a1c22, 0.82, 0.04, 0x2a2218);
  const vinyl = cabinMat(0x14161c, 0.9, 0.02, 0x14110e);
  const carpet = cabinMat(0x2a241c, 0.95, 0);
  const leather = cabinMat(0x1c1814, 0.88, 0.02, 0x1a120c);
  const dark = cabinMat(0x0c0c10, 0.7, 0.08, 0x181410);

  const cabinW = Math.min(1.38, Math.max(1.12, hull.maxX - hull.minX - 0.22));
  const floorY = hull.minY + 0.28;
  // Depth order toward the nose (+Z): eye → steering wheel → gauges → dash bulk.
  // Gauges used to sit at eyeZ+0.30 with the wheel at +0.36, so the cluster
  // floated in front of the rim (and HUD depthTest:false painted over it).
  const glbWheel = root.userData.steerSpin || root.userData.glbSteerWheel;
  if (glbWheel) markSteerPovLayer(glbWheel);
  // Use the rim's forward face — pivot.position.z alone undershoots thick GLB wheels.
  const wheelZ = steeringRimForwardZ(root, glbWheel, rig.eyeZ);
  const clusterZ = Math.max(wheelZ + 0.14, rig.eyeZ + 0.52);
  // Dash bulk sits past the instruments so depthTest does not bury the discs.
  const dashZ = clusterZ + 0.22;
  // Keep the top of the dash well below the seated eye so the windshield
  // aperture reads road, not plastic (Sprint 535 POV sightline).
  const dashY = rig.eyeY - 0.44;

  const floor = new THREE.Mesh(new THREE.BoxGeometry(cabinW, 0.04, 1.35), carpet);
  floor.position.set(0, floorY, rig.eyeZ + 0.1);
  floor.userData.cabinFill = true;
  cab.add(floor);

  const dash = new THREE.Mesh(new THREE.BoxGeometry(cabinW * 0.98, 0.16, 0.28), plastic);
  dash.position.set(0, dashY, dashZ);
  dash.userData.cabinFill = true;
  cab.add(dash);
  const cowl = new THREE.Mesh(new THREE.BoxGeometry(cabinW * 0.72, 0.04, 0.12), dark);
  cowl.position.set(rig.eyeX * 0.15, dashY + 0.08, dashZ + 0.02);
  cowl.userData.cabinFill = true;
  cab.add(cowl);
  // Instrument hood — a real cowl over the cluster so the seat reads as a cabin.
  const binnacleHood = new THREE.Mesh(new THREE.BoxGeometry(cabinW * 0.44, 0.04, 0.16), dark);
  binnacleHood.position.set(rig.eyeX + 0.02, dashY + 0.14, clusterZ + 0.04);
  binnacleHood.rotation.x = -0.32;
  binnacleHood.userData.cabinFill = true;
  cab.add(binnacleHood);

  const doorL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.54, 1.08), vinyl);
  doorL.position.set(-cabinW * 0.48, floorY + 0.34, rig.eyeZ + 0.12);
  doorL.userData.cabinFill = true;
  const doorR = doorL.clone();
  doorR.position.x = cabinW * 0.48;
  cab.add(doorL, doorR);

  cab.add(makeSeat(rig.eyeX, floorY + 0.22, rig.eyeZ - 0.28, leather));
  const passSeat = makeSeat(-rig.eyeX * 0.85, floorY + 0.22, rig.eyeZ - 0.28, leather);
  passSeat.userData.cabinFill = true;
  cab.add(passSeat);

  const cluster = new THREE.Group();
  cluster.name = "gauge-cluster";
  const speedDial = makeDial("speed", POV_SPEED_MAX_MPH, 120);
  const rpmDial = makeDial("rpm", rpmMax, rpmRed);
  // Tach left, speedo right — ST205 / chase HUD layout.
  rpmDial.group.position.set(-POV_GAUGE_R * 1.28, 0, 0);
  speedDial.group.position.set(POV_GAUGE_R * 1.28, 0, 0);
  cluster.add(rpmDial.group, speedDial.group);
  const binnacle = new THREE.Mesh(
    new THREE.BoxGeometry(POV_GAUGE_R * 5.2, 0.028, 0.08),
    dark
  );
  binnacle.position.set(0, POV_GAUGE_R * 0.95, 0.02);
  binnacle.userData.cabinFill = true;
  cluster.add(binnacle);
  // Behind the rim, lower in the FOV so gauges do not eat the windshield.
  cluster.position.set(rig.eyeX + 0.02, rig.eyeY - 0.24, clusterZ);
  // Face the seated eye so the printed discs are not edge-on or windshield-facing.
  cluster.lookAt(rig.eyeX, rig.eyeY, rig.eyeZ);
  // Draw after the rim (renderOrder 8) but depth-test against it.
  cluster.renderOrder = 20;
  cab.add(cluster);
  root.userData.povWheelZ = wheelZ;
  root.userData.povClusterZ = clusterZ;

  const hasGlbWheel = !!root.userData.glbSteerWheel;
  if (!hasGlbWheel) {
    const column = new THREE.Group();
    // Closest cabin prop to the lens — gauges sit further into the dash.
    column.position.set(rig.eyeX + 0.02, rig.eyeY - 0.40, wheelZ - 0.08);
    column.rotation.x = -0.55;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.04, 12), dark);
    hub.rotation.x = Math.PI / 2;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.016, 10, 24), vinyl);
    const spokeA = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.014, 0.012), plastic);
    const spokeB = spokeA.clone();
    spokeB.rotation.z = 1.15;
    const spokeC = spokeA.clone();
    spokeC.rotation.z = -1.15;
    const wheel = new THREE.Group();
    wheel.add(hub, rim, spokeA, spokeB, spokeC);
    column.add(wheel);
    cab.add(column);
    markSteerPovLayer(column);
    root.userData.steerWheel = wheel;
    root.userData.steerSpin = wheel;
    root.userData.steerAxis = "z";
    // Recompute cluster past the procedural rim so eye → rim → gauges holds.
    const rimZ = steeringRimForwardZ(root, column, rig.eyeZ);
    const cz = Math.max(rimZ + 0.14, rig.eyeZ + 0.52);
    cluster.position.z = cz;
    cluster.lookAt(rig.eyeX, rig.eyeY, rig.eyeZ);
    root.userData.povWheelZ = rimZ;
    root.userData.povClusterZ = cz;
  }

  const mirror = makeRearviewMirror();
  mirror.position.set(rig.mirrorEyeX, rig.mirrorEyeY, rig.mirrorEyeZ);
  mirror.lookAt(rig.eyeX, rig.eyeY, rig.eyeZ);
  cab.add(mirror);

  root.add(cab);
  root.userData.cockpit = cab;
  root.userData.gaugeCluster = cluster;
  root.userData.speedNeedle = speedDial.needle;
  root.userData.rpmNeedle = rpmDial.needle;
  if (!root.userData.steerWheel) root.userData.steerWheel = null;
  root.userData.gaugeVmax = POV_SPEED_MAX_MPH;
  root.userData.gaugeRpmMax = rpmMax;
  root.userData._spdGauge = { x: -GAUGE_START, v: 0 };
  root.userData._rpmGauge = { x: -GAUGE_START, v: 0 };
  root.userData.mirror = mirror;
  root.userData.mirrorGlass = mirror.userData.glass;
}

function ensurePovHead(root, rig) {
  if (!rig) return;
  if (!rig.head || !rig.head.parent) {
    const head = new THREE.Group();
    head.name = "pov-head";
    const lookNode = new THREE.Object3D();
    head.add(lookNode);
    root.add(head);
    rig.head = head;
    rig.lookNode = lookNode;
  }
  rig.head.position.set(rig.eyeX, rig.eyeY, rig.eyeZ);
  rig.lookNode.position.set(rig.lookX - rig.eyeX, rig.lookY - rig.eyeY, rig.lookZ - rig.eyeZ);
}

function cabinMat(color, roughness, metalness, emissive) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: roughness != null ? roughness : 0.8,
    metalness: metalness != null ? metalness : 0.04,
    envMapIntensity: 0.62,
    emissive: emissive != null ? emissive : 0x000000,
    emissiveIntensity: emissive != null ? 0.14 : 0,
  });
}

function clusterMat(opts) {
  const mat = new THREE.MeshBasicMaterial({
    depthTest: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    ...opts,
  });
  if (mat.map) mat.color.setHex(0xffffff);
  mat.toneMapped = false;
  mat.depthTest = true;
  mat.userData.hud = true;
  return mat;
}

function makeSeat(x, y, z, mat) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.42), mat);
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.48, 0.08), mat);
  back.position.set(0, 0.26, -0.2);
  back.rotation.x = -0.12;
  g.add(base, back);
  g.position.set(x, y, z);
  g.userData.cabinFill = true;
  return g;
}

function makeRearviewMirror() {
  const g = new THREE.Group();
  g.name = "rearview";
  const plastic = cabinMat(0x1a1a20, 0.55, 0.2);
  const gw = 0.32;
  const gh = 0.082;
  const rim = 0.01;
  const depth = 0.012;
  const top = new THREE.Mesh(new THREE.BoxGeometry(gw + rim * 2, rim, depth), plastic);
  top.position.set(0, gh * 0.5 + rim * 0.5, 0);
  const bot = new THREE.Mesh(new THREE.BoxGeometry(gw + rim * 2, rim, depth), plastic);
  bot.position.set(0, -gh * 0.5 - rim * 0.5, 0);
  const left = new THREE.Mesh(new THREE.BoxGeometry(rim, gh, depth), plastic);
  left.position.set(-gw * 0.5 - rim * 0.5, 0, 0);
  const right = left.clone();
  right.position.x = gw * 0.5 + rim * 0.5;
  // Group lookAt points +Z at the seat. PlaneGeometry already faces +Z —
  // sit the glass slightly toward the driver so the rim cannot cover it.
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(gw, gh),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      fog: false,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    })
  );
  glass.position.z = 0.01;
  markPovHudMesh(glass, 30);
  const stem = new THREE.Mesh(
    new THREE.BoxGeometry(0.012, 0.028, 0.012),
    cabinMat(0x121216, 0.6, 0.15)
  );
  stem.position.set(0, gh * 0.5 + rim + 0.014, 0);
  g.add(top, bot, left, right, glass, stem);
  g.frustumCulled = false;
  g.userData.glass = glass;
  return g;
}

const _povClipPt = new THREE.Vector3();
const _povClipN = new THREE.Vector3();

/**
 * Clip body geometry above the driver's eye so a unified GLB hull cannot fill
 * the lens even when no separate "roof" mesh exists. Planes are world-space;
 * call updatePovRoofClip each frame while seated.
 *
 * Hitch rule: after the first apply, materials keep their clippingPlanes and
 * `localClippingEnabled` stays on. Chase mode parks the plane far above the
 * car so nothing clips — toggling planes on/off was recompiling shaders on C.
 *
 * @param {THREE.Object3D} root
 * @param {boolean} on
 * @param {THREE.WebGLRenderer} [renderer]
 */
export function setPovRoofClip(root, on, renderer) {
  if (!root) return;
  const want = !!on;
  // WebGLRenderer is not an Object3D — userData is not guaranteed.
  if (renderer) {
    if (!renderer.userData) renderer.userData = {};
    // Once warmed, leave clipping enabled forever so shader variants stay hot.
    if (!renderer.localClippingEnabled) {
      if (renderer.userData._preLocalClip == null) {
        renderer.userData._preLocalClip = false;
      }
      renderer.localClippingEnabled = true;
    }
  }
  const rig = getPovRig(root);
  const cutY = (rig && Number.isFinite(rig.eyeY) ? rig.eyeY : 1.1) + 0.14;
  root.userData._povRoofCutY = cutY;
  if (!root.userData._povClipPlanes) {
    root.userData._povClipPlanes = [new THREE.Plane()];
  }
  const planeList = root.userData._povClipPlanes;

  // First seat: clone body materials onto the shared plane list (compile happens in _warmPov).
  if (!root.userData._povClipPrepared) {
    root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      if (obj.userData.povHud || obj.userData.cabinFill) return;
      if (inCockpitTree(obj)) return;
      const n = (obj.name || "").toLowerCase();
      if (obj.userData.wheel || /wheel|tire|tyre|rim|brake.?disc/.test(n)) return;

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      let owned = mats.slice();
      let changed = false;
      for (let i = 0; i < owned.length; i++) {
        let mat = owned[i];
        if (!mat || mat.userData?.sharedUi) continue;
        if (!mat.userData._povClipOwned) {
          mat = mat.clone();
          mat.userData = Object.assign({}, mat.userData, { _povClipOwned: true });
          owned[i] = mat;
          changed = true;
        }
        if (!mat.userData._povClipApplied) {
          mat.userData._preClipPlanes = mat.clippingPlanes || null;
          mat.userData._povClipApplied = true;
          mat.clippingPlanes = planeList;
          mat.clipShadows = false;
          mat.needsUpdate = true;
        }
      }
      if (changed) {
        obj.material = Array.isArray(obj.material) ? owned : owned[0];
      }
      if (!root.userData._povClipMeshes) root.userData._povClipMeshes = [];
      if (root.userData._povClipMeshes.indexOf(obj) < 0) root.userData._povClipMeshes.push(obj);
    });
    root.userData._povClipPrepared = true;
  }

  root.userData._povRoofClipOn = want;
  if (want) updatePovRoofClip(root);
  else parkPovRoofClip(root);
}

/** Park the clip plane so chase/far see a full body (no material churn). */
function parkPovRoofClip(root) {
  const planes = root && root.userData && root.userData._povClipPlanes;
  if (!planes || !planes[0]) return;
  planes[0].setFromNormalAndCoplanarPoint(
    _povClipN.set(0, -1, 0),
    _povClipPt.set(0, 500, 0)
  );
}

/**
 * Keep the POV roof clip plane glued to the car as it moves.
 * @param {THREE.Object3D} root
 */
export function updatePovRoofClip(root) {
  if (!root || !root.userData._povRoofClipOn) return;
  const planes = root.userData._povClipPlanes;
  if (!planes || !planes[0]) return;
  const cutY = root.userData._povRoofCutY != null ? root.userData._povRoofCutY : 1.2;
  _povClipPt.set(0, cutY, 0).applyMatrix4(root.matrixWorld);
  _povClipN.set(0, 1, 0).transformDirection(root.matrixWorld).normalize().multiplyScalar(-1);
  planes[0].setFromNormalAndCoplanarPoint(_povClipN, _povClipPt);
}

/**
 * POV: hide glass + roof shell, show the in-car cabin and any GLB interior.
 * Chase/far: restore the body and hide the cabin.
 * @param {THREE.Object3D} root
 * @param {boolean} on
 * @param {THREE.Camera} [_camera]
 * @param {THREE.WebGLRenderer} [renderer]
 */
export function setCockpitView(root, on, _camera, renderer) {
  if (!root) return;
  const want = !!on;
  // Force a hide-cache rebuild when the POV shell tag set changes.
  if (root.userData._povHideVer !== 4) root.userData._povHideReady = false;
  if (root.userData._cockpitOn === want && root.userData._povHideReady) {
    setPovRoofClip(root, want, renderer);
    return;
  }
  root.userData._cockpitOn = want;
  buildPovHideCache(root);
  const hide = root.userData._povHide || [];
  for (let i = 0; i < hide.length; i++) {
    const obj = hide[i];
    if (want) obj.visible = false;
    else obj.visible = !obj.userData.interiorKeepHidden;
  }
  const keep = root.userData._povKeepHidden || [];
  for (let i = 0; i < keep.length; i++) keep[i].visible = false;
  const steer = root.userData._povSteer || [];
  for (let i = 0; i < steer.length; i++) steer[i].visible = want;
  const glbWheel = root.userData.glbSteerWheel;
  if (glbWheel) glbWheel.visible = want;
  const cab = root.userData.cockpit;
  if (cab) {
    if (cab.parent !== root) root.add(cab);
    cab.visible = want;
    cab.traverse((obj) => {
      if (obj.userData && obj.userData.cabinFill) {
        obj.visible = want;
      }
    });
  }
  const mir = root.userData.mirror;
  if (mir) {
    if (mir.parent && mir.parent !== cab && mir.parent !== root) root.add(mir);
    mir.visible = want;
    mir.scale.setScalar(1);
  }
  setPovRoofClip(root, want, renderer);
}

/**
 * Hook the rearview glass to the live rear camera texture.
 * @param {THREE.Object3D} root
 * @param {THREE.Texture} texture
 */
export function setCockpitMirrorMap(root, texture) {
  const glass = root && root.userData.mirrorGlass;
  if (!glass || !glass.material || !texture) return;
  const mat = glass.material;
  if (mat.map !== texture) {
    mat.map = texture;
    mat.needsUpdate = true;
  }
  mat.color.setHex(0xffffff);
  mat.toneMapped = false;
  mat.fog = false;
  mat.transparent = false;
  mat.opacity = 1;
  mat.depthTest = false;
  mat.depthWrite = false;
  mat.side = THREE.DoubleSide;
  if (mat.map) {
    mat.map.minFilter = THREE.LinearFilter;
    mat.map.magFilter = THREE.LinearFilter;
    mat.map.anisotropy = Math.min(4, mat.map.anisotropy || 1);
  }
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.needsUpdate = false;
}

function springNeedle(state, target, dt, wn, zeta) {
  const acc = (target - state.x) * wn * wn - 2 * zeta * wn * state.v;
  state.v += acc * dt;
  state.v = Math.max(-18, Math.min(18, state.v));
  state.x += state.v * dt;
  return state.x;
}

/**
 * Analog gauges: needles lag like real instruments, then settle on speed/RPM.
 * @param {THREE.Object3D} root
 * @param {{speedKmh:number, rpm:number, redline:number, steer:number, dt:number}} state
 */
export function updateCockpit(root, state) {
  if (!root || !root.userData.speedNeedle) return;
  const dt = Math.max(0.001, Math.min(0.05, state.dt || 1 / 60));
  const vmax = root.userData.gaugeVmax || POV_SPEED_MAX_MPH;
  const rpmMax = root.userData.gaugeRpmMax || 8;
  const mph = Math.max(0, (state.speedKmh || 0) * KMH_TO_MPH);
  const rpmN = Math.max(0, (state.rpm || 0) / 1000);
  const spdT = -(GAUGE_START + GAUGE_SWEEP * Math.max(0, Math.min(1, mph / vmax)));
  const rpmT = -(GAUGE_START + GAUGE_SWEEP * Math.max(0, Math.min(1.04, rpmN / rpmMax)));
  if (root.userData.speedNeedle) {
    root.userData.speedNeedle.rotation.z = springNeedle(root.userData._spdGauge, spdT, dt, 14, 1.12);
  }
  if (root.userData.rpmNeedle) {
    root.userData.rpmNeedle.rotation.z = springNeedle(root.userData._rpmGauge, rpmT, dt, 22, 1.08);
  }
}

/**
 * Show/hide the in-car cabin as the lens seats. No 0.001 scale pop.
 * @param {THREE.Object3D} root
 * @param {number} t 0..1
 */
export function updatePovHudFade(root, t) {
  if (!root) return;
  const fade = t < 0 ? 0 : t > 1 ? 1 : t;
  const cab = root.userData.cockpit;
  if (cab) cab.visible = fade > 0.04;
  const mir = root.userData.mirror;
  if (mir) {
    mir.visible = fade > 0.12;
    mir.scale.setScalar(1);
  }
}

function makeLiveryTexture(green, red, yellow) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#f4f1ea";
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = "#1f7a3a";
  ctx.beginPath();
  ctx.moveTo(0, 40);
  ctx.lineTo(256, 90);
  ctx.lineTo(256, 150);
  ctx.lineTo(0, 110);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#d0121a";
  ctx.fillRect(0, 108, 256, 18);
  ctx.fillStyle = "#d0121a";
  ctx.font = "bold 28px Arial";
  ctx.textAlign = "center";
  ctx.fillText("CASTROL", 128, 100);
  ctx.fillStyle = "#111";
  ctx.font = "bold 14px Arial";
  ctx.fillText("TOYOTA TEAM EUROPE", 128, 72);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
