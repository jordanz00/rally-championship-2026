/**
 * Ground PBR stream — 1k albedo first, 2k + normals while you drive.
 *
 * WHO THIS IS FOR: desert-pbr, forest-pbr, forest-tunnel.
 * WHAT IT DOES: stage build waits only on the 1k color map. Normals,
 *   roughness, and 2k upgrades share the same Three Source so live
 *   materials sharpen without a rebuild.
 * HOW IT CONNECTS: Track.buildAsync awaits prepare*Pbr(); clones go
 *   through cloneTracked().
 */

import * as THREE from "../../vendor/three.module.js";
import { VISUAL } from "../config.js?v=241";

const ASSET_V = "2";
const BOOT_MS = 1600;
const DETAIL_MS = 5000;
const HI_MS = 12000;

/** @type {WeakMap<THREE.Texture, Set<THREE.Texture>>} */
const FAMILY = new WeakMap();
/** Keep decoded Images alive after we steal source.data. */
const KEEP = [];
/** One 2k decode at a time so GO does not hitch on a 24-map dump. */
const HI_QUEUE = [];
let hiBusy = false;
/** Countdown / lights-out: queue GPU uploads instead of swapping live maps. */
let gpuHold = false;
/** @type {Array<() => void>} */
const PENDING_APPLY = [];

/**
 * Freeze 2k / detail map swaps. Call when HUD shows "3" so lights-out
 * does not pay a 2048 mipmap upload on the first throttle.
 */
export function holdGpuUploads() {
  gpuHold = true;
}

/** Apply any deferred swaps and resume the 2k queue. */
export function releaseGpuUploads() {
  gpuHold = false;
  const jobs = PENDING_APPLY.splice(0, PENDING_APPLY.length);
  for (let i = 0; i < jobs.length; i++) {
    try {
      jobs[i]();
    } catch {
      /* ignore */
    }
  }
  void pumpHi();
}

/**
 * @param {() => Promise<void>} task
 */
function enqueueHi(task) {
  HI_QUEUE.push(task);
  void pumpHi();
}

async function pumpHi() {
  if (hiBusy || gpuHold) return;
  hiBusy = true;
  while (HI_QUEUE.length) {
    const task = HI_QUEUE.shift();
    try {
      await task();
    } catch {
      /* ignore missing 2k */
    }
    await new Promise((r) => setTimeout(r, 48));
  }
  hiBusy = false;
}

/**
 * Cinema / high tiers take 2k. Phones, low-power GPUs, and min/low keep 1k —
 * a mid-race 2048 mipmap upload whites out or hitchs Adreno/Mali.
 */
export function wantHiMaps() {
  if ((VISUAL.tier || 0) < 8) return false;
  try {
    if (typeof window !== "undefined" && window.__rallyRenderCaps?.lowPower) return false;
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    if (/Android|iPhone|iPod|Mobile|webOS|BlackBerry|IEMobile/i.test(ua)) return false;
    const mem = typeof navigator !== "undefined" ? navigator.deviceMemory : 0;
    if (mem && mem <= 4) return false;
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * @param {THREE.Texture} master
 * @param {THREE.Texture} copy
 */
function remember(master, copy) {
  let set = FAMILY.get(master);
  if (!set) {
    set = new Set([master]);
    FAMILY.set(master, set);
  }
  set.add(copy);
  FAMILY.set(copy, set);
}

/**
 * Shared-source clone with its own UV repeat.
 * @param {THREE.Texture|null} tex
 * @param {number} [rx]
 * @param {number} [ry]
 * @returns {THREE.Texture|null}
 */
export function cloneTracked(tex, rx, ry) {
  if (!tex) return null;
  const copy = tex.clone();
  copy.wrapS = THREE.RepeatWrapping;
  copy.wrapT = THREE.RepeatWrapping;
  if (rx != null) copy.repeat.set(rx, ry != null ? ry : rx);
  remember(tex, copy);
  copy.needsUpdate = true;
  return copy;
}

/**
 * Swap the shared image; bump every clone so WebGL re-uploads.
 * @param {THREE.Texture} master
 * @param {HTMLImageElement|HTMLCanvasElement} image
 * @param {number} [anisotropy]
 */
export function applyImage(master, image, anisotropy = 8) {
  if (!master || !image) return;
  if (gpuHold) {
    PENDING_APPLY.push(() => applyImageNow(master, image, anisotropy));
    return;
  }
  applyImageNow(master, image, anisotropy);
}

/**
 * @param {THREE.Texture} master
 * @param {HTMLImageElement|HTMLCanvasElement} image
 * @param {number} [anisotropy]
 */
function applyImageNow(master, image, anisotropy = 8) {
  master.image = image;
  const set = FAMILY.get(master) || new Set([master]);
  for (const t of set) {
    t.anisotropy = anisotropy;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
  }
}

/**
 * Tiny canvas so the material has a map before the photo lands.
 * @param {boolean} srgb
 * @param {string} css
 * @returns {THREE.Texture}
 */
export function stubTex(srgb, css) {
  const c = document.createElement("canvas");
  c.width = 2;
  c.height = 2;
  const g = c.getContext("2d");
  g.fillStyle = css;
  g.fillRect(0, 0, 2, 2);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  remember(tex, tex);
  return tex;
}

/**
 * @param {THREE.TextureLoader} loader
 * @param {string} url
 * @param {boolean} srgb
 * @param {number} timeoutMs
 * @returns {Promise<THREE.Texture|null>}
 */
export function loadTex(loader, url, srgb, timeoutMs) {
  const href = `${url}?v=${ASSET_V}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (tex) => {
      if (settled) return;
      settled = true;
      if (tex) KEEP.push(tex);
      resolve(tex);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    loader.load(
      href,
      (tex) => {
        clearTimeout(timer);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.needsUpdate = true;
        finish(tex);
      },
      undefined,
      () => {
        clearTimeout(timer);
        finish(null);
      }
    );
  });
}

/**
 * Wait on 1k albedo only. Stream 1k nor/rough then 2k in the background.
 * @param {THREE.TextureLoader} loader
 * @param {{base:string, stem:string, tileMeters:number, tint?:string}} spec
 */
export async function bootPbrSet(loader, spec) {
  const { base, stem, tileMeters } = spec;
  const map = stubTex(true, spec.tint || "#c4b090");
  const normalMap = stubTex(false, "#8080ff");
  const roughnessMap = stubTex(false, "#b8b8b8");

  const boot = await loadTex(loader, `${base}/${stem}_diff_1k.jpg`, true, BOOT_MS);
  if (boot) applyImage(map, boot.image, 4);

  void streamDetail(loader, base, stem, map, normalMap, roughnessMap);
  return { map, normalMap, roughnessMap, aoMap: null, tileMeters };
}

/**
 * @param {THREE.TextureLoader} loader
 * @param {string} base
 * @param {string} stem
 * @param {THREE.Texture} map
 * @param {THREE.Texture} normalMap
 * @param {THREE.Texture} roughnessMap
 */
async function streamDetail(loader, base, stem, map, normalMap, roughnessMap) {
  const [nor, rough] = await Promise.all([
    loadTex(loader, `${base}/${stem}_nor_gl_1k.jpg`, false, DETAIL_MS),
    loadTex(loader, `${base}/${stem}_rough_1k.jpg`, false, DETAIL_MS),
  ]);
  if (nor) applyImage(normalMap, nor.image, 8);
  if (rough) applyImage(roughnessMap, rough.image, 8);
  if (!wantHiMaps()) return;
  enqueueHi(async () => {
    const d2 = await loadTex(loader, `${base}/${stem}_diff_2k.jpg`, true, HI_MS);
    if (d2) applyImage(map, d2.image, 8);
  });
  enqueueHi(async () => {
    const n2 = await loadTex(loader, `${base}/${stem}_nor_gl_2k.jpg`, false, HI_MS);
    if (n2) applyImage(normalMap, n2.image, 8);
  });
  enqueueHi(async () => {
    const r2 = await loadTex(loader, `${base}/${stem}_rough_2k.jpg`, false, HI_MS);
    if (r2) applyImage(roughnessMap, r2.image, 8);
  });
}

/**
 * Forest tunnel rock — albedo boot, ARM packed map in the background.
 * @param {THREE.TextureLoader} loader
 * @param {string} base
 */
export async function bootTunnelSet(loader, base) {
  const map = stubTex(true, "#6a655c");
  const normalMap = stubTex(false, "#8080ff");
  const armMap = stubTex(false, "#a8a090");
  const boot = await loadTex(loader, `${base}/tunnel_rock_diff_1k.jpg`, true, BOOT_MS);
  if (boot) applyImage(map, boot.image, 4);
  void streamTunnel(loader, base, map, normalMap, armMap);
  return { map, normalMap, armMap };
}

/**
 * @param {THREE.TextureLoader} loader
 * @param {string} base
 * @param {THREE.Texture} map
 * @param {THREE.Texture} normalMap
 * @param {THREE.Texture} armMap
 */
async function streamTunnel(loader, base, map, normalMap, armMap) {
  const [nor, arm] = await Promise.all([
    loadTex(loader, `${base}/tunnel_rock_nor_gl_1k.jpg`, false, DETAIL_MS),
    loadTex(loader, `${base}/tunnel_rock_arm_1k.jpg`, false, DETAIL_MS),
  ]);
  if (nor) applyImage(normalMap, nor.image, 8);
  if (arm) applyImage(armMap, arm.image, 8);
  if (!wantHiMaps()) return;
  enqueueHi(async () => {
    const d2 = await loadTex(loader, `${base}/tunnel_rock_diff_2k.jpg`, true, HI_MS);
    if (d2) applyImage(map, d2.image, 8);
  });
  enqueueHi(async () => {
    const n2 = await loadTex(loader, `${base}/tunnel_rock_nor_gl_2k.jpg`, false, HI_MS);
    if (n2) applyImage(normalMap, n2.image, 8);
  });
  enqueueHi(async () => {
    const a2 = await loadTex(loader, `${base}/tunnel_rock_arm_2k.jpg`, false, HI_MS);
    if (a2) applyImage(armMap, a2.image, 8);
  });
}
