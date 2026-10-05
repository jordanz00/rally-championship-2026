/**
 * Rival liveries — original Group-A / WRC-era paint for the AI pack.
 *
 * WHO THIS IS FOR: celica.js rival / attract / replay clones.
 * WHAT IT DOES: fourteen unique lacquer looks (then hue+dirt recycles) so a
 *   14-car field is not one cheap hue. Physical clearcoat, env-aware
 *   roughness, object-space panel blocks, and readable door numbers.
 *   Sponsor copy is invented — no licensed works marks.
 * HOW IT CONNECTS: createRivalCar → getRivalPaintMaterial + attach marks.
 *   Player hero (createPlayerCar / dressPlayerCarRace) never imports this.
 */

import * as THREE from "../../vendor/three.module.js";

/** Door / roof numbers — skip 1 so the hero stays the lead car. */
const RIVAL_NUMBERS = ["4", "7", "11", "14", "18", "21", "23", "28", "33", "36", "41", "44", "5", "2"];

/**
 * Fourteen authored looks — one per grid slot. Extra slots shift hue and add dirt.
 * Colours are period privateer / works-adjacent, not licensed lockups.
 */
export const RIVAL_LIVERIES = [
  {
    id: "pace-note",
    name: "Pace Note",
    body: 0xeee8dc,
    secondary: 0xa31820,
    accent: 0x1c1c20,
    plate: 0x16161a,
    ink: 0xf4f0e8,
    team: "PACE NOTE",
    sponsor: "SPLIT TIME",
    wear: 0.2,
    style: 0,
    roughness: 0.2,
    metalness: 0.12,
  },
  {
    id: "night-stage",
    name: "Night Stage",
    body: 0x1a2744,
    secondary: 0xc4a035,
    accent: 0xf2ead8,
    plate: 0xf2ead8,
    ink: 0x141820,
    team: "NIGHT STAGE",
    sponsor: "RIDGE RADIO",
    wear: 0.18,
    style: 1,
    roughness: 0.22,
    metalness: 0.14,
  },
  {
    id: "pine-ridge",
    name: "Pine Ridge",
    body: 0x1e4a32,
    secondary: 0xe8e0cc,
    accent: 0x2a2418,
    plate: 0xe8e0cc,
    ink: 0x142018,
    team: "PINE RIDGE",
    sponsor: "GRAVEL PARK",
    wear: 0.24,
    style: 2,
    roughness: 0.24,
    metalness: 0.1,
  },
  {
    id: "crest",
    name: "Crest",
    body: 0xe3b51a,
    secondary: 0x161616,
    accent: 0xf7f1de,
    plate: 0x161616,
    ink: 0xf7f1de,
    team: "CREST",
    sponsor: "BRAKE POINT",
    wear: 0.26,
    style: 3,
    roughness: 0.23,
    metalness: 0.11,
  },
  {
    id: "ember",
    name: "Ember",
    body: 0x3a3c40,
    secondary: 0xd45a12,
    accent: 0xe8e4dc,
    plate: 0xf0ebe3,
    ink: 0x1a1612,
    team: "EMBER",
    sponsor: "APEX CARD",
    wear: 0.22,
    style: 4,
    roughness: 0.21,
    metalness: 0.13,
  },
  {
    id: "nordic",
    name: "Nordic",
    body: 0xf4f6f8,
    secondary: 0x1e4d8c,
    accent: 0xc5a04a,
    plate: 0x1e4d8c,
    ink: 0xf7f4ec,
    team: "NORDIC OIL",
    sponsor: "TIMING POST",
    wear: 0.16,
    style: 5,
    roughness: 0.19,
    metalness: 0.12,
  },
  {
    id: "dune",
    name: "Dune",
    body: 0xc4a66a,
    secondary: 0x8a3a1c,
    accent: 0x2c2418,
    plate: 0x2c2418,
    ink: 0xf0e6d2,
    team: "DUNE PRESS",
    sponsor: "SERVICE VAN",
    wear: 0.34,
    style: 6,
    roughness: 0.3,
    metalness: 0.09,
  },
  {
    id: "cellar",
    name: "Cellar",
    body: 0x6b1d2a,
    secondary: 0xe6dcc8,
    accent: 0x1a1410,
    plate: 0xe6dcc8,
    ink: 0x1a1410,
    team: "CELLAR STAGE",
    sponsor: "CO-DRIVER",
    wear: 0.21,
    style: 7,
    roughness: 0.22,
    metalness: 0.12,
  },
  {
    id: "glacier",
    name: "Glacier",
    body: 0x7eb0c8,
    secondary: 0xf4f7f8,
    accent: 0x9a1c24,
    plate: 0xf4f7f8,
    ink: 0x142028,
    team: "GLACIER",
    sponsor: "ICE NOTE",
    wear: 0.14,
    style: 8,
    roughness: 0.18,
    metalness: 0.13,
  },
  {
    id: "quarry",
    name: "Quarry",
    body: 0x4a5340,
    secondary: 0x121410,
    accent: 0xd4a24a,
    plate: 0x121410,
    ink: 0xf0e6c8,
    team: "QUARRY",
    sponsor: "HAUL ROAD",
    wear: 0.32,
    style: 9,
    roughness: 0.28,
    metalness: 0.1,
  },
  {
    id: "harbor",
    name: "Harbor",
    body: 0x0e4a52,
    secondary: 0xf2efe6,
    accent: 0xe07a28,
    plate: 0xf2efe6,
    ink: 0x102428,
    team: "HARBOR",
    sponsor: "DOCK LINE",
    wear: 0.19,
    style: 10,
    roughness: 0.21,
    metalness: 0.12,
  },
  {
    id: "kiln",
    name: "Kiln",
    body: 0xc45a22,
    secondary: 0x141210,
    accent: 0xf3ead8,
    plate: 0x141210,
    ink: 0xf3ead8,
    team: "KILN",
    sponsor: "HEAT CHECK",
    wear: 0.27,
    style: 11,
    roughness: 0.24,
    metalness: 0.11,
  },
  {
    id: "paper",
    name: "Paper",
    body: 0xf7f4ee,
    secondary: 0x1a1a1c,
    accent: 0xb4232c,
    plate: 0x1a1a1c,
    ink: 0xf7f4ee,
    team: "PAPER STAGE",
    sponsor: "BLANK PAGE",
    wear: 0.12,
    style: 12,
    roughness: 0.17,
    metalness: 0.12,
  },
  {
    id: "basalt",
    name: "Basalt",
    body: 0x2a2c30,
    secondary: 0xc8ccd2,
    accent: 0xa31820,
    plate: 0xc8ccd2,
    ink: 0x16181c,
    team: "BASALT",
    sponsor: "ROCK NOTE",
    wear: 0.23,
    style: 13,
    roughness: 0.22,
    metalness: 0.16,
  },
];

const paintCache = new Map();
const markCache = new Map();
/** @type {THREE.PlaneGeometry|null} */
let decalGeo = null;
/** @type {THREE.Texture|null} */
let flakeMap = null;
/** @type {THREE.Texture|null} */
let gritMap = null;
/** @type {THREE.Texture|null} */
let lacquerNormal = null;

const FIT = {
  celica: { halfW: 0.88, doorY: 0.7, doorZ: 0.1, hoodY: 0.78, hoodZ: 1.1, roofY: 1.2, roofZ: 0.2 },
  delta: { halfW: 0.86, doorY: 0.68, doorZ: 0.02, hoodY: 0.76, hoodZ: 1.02, roofY: 1.18, roofZ: 0.12 },
  stratos: { halfW: 0.93, doorY: 0.58, doorZ: 0.14, hoodY: 0.66, hoodZ: 1.04, roofY: 1.02, roofZ: 0.04 },
};

/**
 * Deterministic 0–1 noise.
 * @param {number} i
 */
function hash01(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Shift a hex in HSL. Recycled pack slots stay related, not clones.
 * @param {number} hex
 * @param {number} deg
 * @param {number} [sat]
 * @param {number} [lit]
 */
function shiftHex(hex, deg, sat = 0, lit = 0) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.h = (hsl.h + deg / 360 + 1) % 1;
  hsl.s = Math.min(0.78, Math.max(0.1, hsl.s + sat));
  hsl.l = Math.min(0.78, Math.max(0.08, hsl.l + lit));
  return c.setHSL(hsl.h, hsl.s, hsl.l).getHex();
}

/**
 * Livery for a rival / attract / replay slot.
 * @param {number} index
 */
export function aiLiveryForIndex(index) {
  const slot = ((index | 0) % 14 + 14) % 14;
  const base = RIVAL_LIVERIES[slot % RIVAL_LIVERIES.length];
  const recycle = Math.floor(slot / RIVAL_LIVERIES.length);
  const number = RIVAL_NUMBERS[slot] || String(slot + 2);
  if (!recycle) {
    return { ...base, slot, number };
  }
  return {
    ...base,
    id: `${base.id}-dirt${recycle}`,
    slot,
    number,
    body: shiftHex(base.body, 16 * recycle, recycle * -0.04, recycle * -0.03),
    secondary: shiftHex(base.secondary, 10 * recycle, 0.02, -0.02),
    wear: Math.min(0.55, base.wear + 0.16 * recycle),
    roughness: Math.min(0.42, base.roughness + 0.06 * recycle),
  };
}

/**
 * Shared flake albedo — near-white so the livery colour stays, with metallic fleck.
 */
function getFlakeMap() {
  if (flakeMap) return flakeMap;
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#f2f2f2";
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 9000; i++) {
    const x = (hash01(i) * size) | 0;
    const y = (hash01(i + 17) * size) | 0;
    const v = 210 + ((hash01(i + 41) * 45) | 0);
    g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 8)})`;
    g.fillRect(x, y, hash01(i + 5) > 0.82 ? 2 : 1, 1);
  }
  for (let p = 0; p < 28; p++) {
    const y = 8 + p * 18;
    g.strokeStyle = "rgba(40,40,40,0.045)";
    g.beginPath();
    g.moveTo(0, y + hash01(p + 3) * 6);
    g.lineTo(size, y + hash01(p + 9) * 6);
    g.stroke();
  }
  flakeMap = new THREE.CanvasTexture(c);
  flakeMap.wrapS = THREE.RepeatWrapping;
  flakeMap.wrapT = THREE.RepeatWrapping;
  flakeMap.repeat.set(2.4, 1.8);
  flakeMap.colorSpace = THREE.SRGBColorSpace;
  flakeMap.anisotropy = 8;
  return flakeMap;
}

/**
 * Orange-peel clearcoat normal. Flat is (128, 128, 255). Shared by rivals and the hero.
 * @returns {THREE.CanvasTexture}
 */
export function getLacquerNormal() {
  if (lacquerNormal) return lacquerNormal;
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const peel =
        Math.sin(x * 0.37) * Math.cos(y * 0.41) * 10 +
        Math.sin(x * 1.7 + y * 0.6) * 4;
      const seam = Math.abs((y % 96) - 2) < 1.5 ? -18 : 0;
      d[i] = 128 + peel + seam;
      d[i + 1] = 128 + peel * 0.65;
      d[i + 2] = 255;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  lacquerNormal = new THREE.CanvasTexture(c);
  lacquerNormal.wrapS = THREE.RepeatWrapping;
  lacquerNormal.wrapT = THREE.RepeatWrapping;
  lacquerNormal.repeat.set(3, 2);
  lacquerNormal.colorSpace = THREE.NoColorSpace;
  lacquerNormal.anisotropy = 8;
  return lacquerNormal;
}

/**
 * Put lacquer peel on a body material that has no authored normal.
 * @param {THREE.Material} mat
 */
export function applyLacquerDetail(mat) {
  if (!mat || mat.normalMap) return;
  mat.normalMap = getLacquerNormal();
  mat.normalScale = new THREE.Vector2(0.28, 0.28);
  mat.needsUpdate = true;
}

/**
 * Skirt grit / chip roughness. Wear scales how hard the shader reads it.
 */
function getGritMap() {
  if (gritMap) return gritMap;
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  const img = g.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) {
    const n = hash01(i * 0.37 + 2);
    const v = (90 + n * 140) | 0;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  gritMap = new THREE.CanvasTexture(c);
  gritMap.wrapS = THREE.RepeatWrapping;
  gritMap.wrapT = THREE.RepeatWrapping;
  gritMap.repeat.set(3.1, 2.4);
  gritMap.colorSpace = THREE.NoColorSpace;
  return gritMap;
}

/**
 * Shared Physical lacquer for every rival wearing this livery.
 * @param {{id:string, body:number, secondary:number, accent:number, wear:number, style:number, roughness:number, metalness:number}} livery
 */
export function getRivalPaintMaterial(livery) {
  const key = `${livery.id}|${livery.body}|${livery.wear}|${livery.style}`;
  let mat = paintCache.get(key);
  if (mat) return mat;
  mat = new THREE.MeshPhysicalMaterial({
    color: livery.body,
    map: getFlakeMap(),
    normalMap: getLacquerNormal(),
    normalScale: new THREE.Vector2(0.32, 0.32),
    roughness: livery.roughness,
    roughnessMap: getGritMap(),
    metalness: livery.metalness,
    clearcoat: 1,
    clearcoatRoughness: 0.028 + livery.wear * 0.08,
    clearcoatEnvMapIntensity: 2.35,
    envMapIntensity: 1.45,
    sheen: 0.1,
    sheenRoughness: 0.4,
    sheenColor: new THREE.Color(livery.body).multiplyScalar(0.35),
  });
  mat.name = `rival-paint-${livery.id}`;
  mat.userData.kind = "paint";
  mat.userData.rivalLivery = livery.id;
  mat.userData.shared = true;
  injectRivalPanels(mat, livery);
  paintCache.set(key, mat);
  return mat;
}

/**
 * Object-space sash / hood / roof so identity does not depend on GLB sticker UVs.
 * @param {THREE.MeshPhysicalMaterial} mat
 * @param {{secondary:number, accent:number, wear:number, style:number}} livery
 */
function injectRivalPanels(mat, livery) {
  const secondary = new THREE.Color(livery.secondary);
  const accent = new THREE.Color(livery.accent);
  const wear = livery.wear;
  const style = livery.style | 0;
  mat.userData.rivalPanel = { secondary, accent, wear, style };
  mat.customProgramCacheKey = () => `rival-livery-style-${style}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRivalSec = { value: secondary };
    shader.uniforms.uRivalAcc = { value: accent };
    shader.uniforms.uRivalWear = { value: wear };
    shader.uniforms.uRivalStyle = { value: style };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vRivalLocal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRivalLocal = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vRivalLocal;
uniform vec3 uRivalSec;
uniform vec3 uRivalAcc;
uniform float uRivalWear;
uniform float uRivalStyle;`
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  vec3 p = vRivalLocal;
  float panel = fract(p.z * 0.31 + abs(p.x) * 0.17);
  diffuseColor.rgb *= 0.93 + 0.08 * panel;
  float mask = 0.0;
  float accMask = 0.0;
  if (uRivalStyle < 0.5) {
    mask = 1.0 - smoothstep(0.16, 0.28, abs(p.y - 0.62 - p.z * 0.08));
  } else if (uRivalStyle < 1.5) {
    mask = smoothstep(0.35, 0.62, p.z) * smoothstep(0.42, 0.62, p.y);
  } else if (uRivalStyle < 2.5) {
    mask = smoothstep(0.9, 1.08, p.y);
  } else if (uRivalStyle < 3.5) {
    accMask = 1.0 - smoothstep(0.34, 0.5, p.y);
  } else if (uRivalStyle < 4.5) {
    mask = smoothstep(0.42, 0.55, abs(p.x)) * (1.0 - smoothstep(0.88, 1.02, p.y)) * smoothstep(0.4, 0.52, p.y);
  } else if (uRivalStyle < 5.5) {
    mask = smoothstep(0.38, 0.52, p.y) * (1.0 - smoothstep(0.82, 0.96, p.y));
    accMask = 1.0 - smoothstep(0.32, 0.46, p.y);
  } else if (uRivalStyle < 6.5) {
    mask = smoothstep(0.85, 1.15, abs(p.z));
  } else if (uRivalStyle < 7.5) {
    accMask = 1.0 - smoothstep(0.08, 0.16, abs(p.y - 0.96));
    mask = smoothstep(0.92, 1.06, p.y);
  } else if (uRivalStyle < 8.5) {
    mask = 1.0 - smoothstep(0.14, 0.26, abs(p.y - 0.55 - p.z * 0.42));
    accMask = 1.0 - smoothstep(0.05, 0.1, abs(p.x));
  } else if (uRivalStyle < 9.5) {
    mask = 1.0 - smoothstep(0.08, 0.16, abs(abs(p.x) - 0.48));
    accMask = smoothstep(0.7, 0.95, p.y);
  } else if (uRivalStyle < 10.5) {
    mask = smoothstep(0.48, 0.62, p.y) * (1.0 - smoothstep(0.78, 0.9, p.y));
    accMask = smoothstep(0.2, 0.55, p.z) * smoothstep(0.5, 0.7, p.y);
  } else if (uRivalStyle < 11.5) {
    mask = 1.0 - smoothstep(0.4, 0.55, p.y);
    accMask = smoothstep(1.0, 1.16, p.y);
  } else if (uRivalStyle < 12.5) {
    mask = 1.0 - smoothstep(0.1, 0.2, abs(p.x));
    accMask = smoothstep(0.9, 1.2, abs(p.z)) * smoothstep(0.45, 0.6, p.y);
  } else {
    mask = 1.0 - smoothstep(0.07, 0.14, abs(p.y - 1.02));
    accMask = 1.0 - smoothstep(0.22, 0.36, p.y);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, uRivalSec, clamp(mask, 0.0, 0.94));
  diffuseColor.rgb = mix(diffuseColor.rgb, uRivalAcc, clamp(accMask, 0.0, 0.9));
  float skirt = smoothstep(0.58, 0.2, p.y);
  float grit = skirt * uRivalWear;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.16, 0.12), grit * 0.5);
}`
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + smoothstep(0.55, 0.18, vRivalLocal.y) * uRivalWear * 0.38, 0.08, 0.94);`
      );
  };
}

/**
 * @param {string} key
 * @param {number} w
 * @param {number} h
 * @param {(g:CanvasRenderingContext2D,w:number,h:number)=>void} draw
 */
function canvasMark(key, w, h, draw) {
  let tex = markCache.get(key);
  if (tex) return tex;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  draw(g, w, h);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  markCache.set(key, tex);
  return tex;
}

function hexCss(hex) {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

function drawDirt(g, w, h, amount) {
  g.globalAlpha = Math.min(0.35, amount);
  for (let i = 0; i < 80 * amount * 8; i++) {
    g.fillStyle = i % 2 ? "#3a2a18" : "#1a140e";
    g.fillRect(hash01(i + 3) * w, hash01(i + 11) * h, 1 + hash01(i) * 2, 1);
  }
  g.globalAlpha = 1;
}

function doorTexture(livery) {
  return canvasMark(`door|${livery.id}|${livery.number}`, 512, 384, (g, w, h) => {
    g.fillStyle = hexCss(livery.plate);
    g.fillRect(0, 0, w, h);
    g.fillStyle = hexCss(livery.secondary);
    g.fillRect(0, 0, w, 28);
    g.fillRect(0, h - 28, w, 28);
    g.fillStyle = hexCss(livery.ink);
    g.font = "bold 216px Impact, Arial Black, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(livery.number, w * 0.5, h * 0.46);
    g.font = "bold 44px Arial, sans-serif";
    g.fillText(livery.team, w * 0.5, h * 0.84);
    drawDirt(g, w, h, livery.wear);
  });
}

function hoodTexture(livery) {
  return canvasMark(`hood|${livery.id}`, 1024, 320, (g, w, h) => {
    g.fillStyle = hexCss(livery.plate);
    g.fillRect(0, 0, w, h);
    g.fillStyle = hexCss(livery.secondary);
    g.fillRect(0, 0, 56, h);
    g.fillRect(w - 56, 0, 56, h);
    g.fillStyle = hexCss(livery.accent);
    g.fillRect(72, 24, w - 144, 20);
    g.fillStyle = hexCss(livery.ink);
    g.font = "bold 84px Arial Black, Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(livery.team, w * 0.5, h * 0.42);
    g.font = "bold 52px Arial, sans-serif";
    g.fillText(livery.sponsor, w * 0.5, h * 0.74);
    drawDirt(g, w, h, livery.wear * 1.1);
  });
}

function roofTexture(livery) {
  return canvasMark(`roof|${livery.id}|${livery.number}`, 512, 192, (g, w, h) => {
    g.fillStyle = hexCss(livery.plate);
    g.fillRect(0, 0, w, h);
    g.fillStyle = hexCss(livery.ink);
    g.font = "bold 140px Impact, Arial Black, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(livery.number, w * 0.5, h * 0.55);
    drawDirt(g, w, h, livery.wear);
  });
}

function vinylMaterial(map) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    roughness: 0.42,
    metalness: 0.06,
    envMapIntensity: 0.55,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    depthWrite: false,
  });
  mat.userData.kind = "decal";
  mat.userData.rivalDecal = true;
  mat.userData.shared = true;
  return mat;
}

function getDecalGeo() {
  if (!decalGeo) decalGeo = new THREE.PlaneGeometry(1, 1);
  return decalGeo;
}

/**
 * Door numbers + hood / roof plates. Vinyl, not lacquer — readable at chase cam.
 * @param {THREE.Object3D} root
 * @param {{id:string, number:string, plate:number, ink:number, team:string, sponsor:string, wear:number, secondary:number, accent:number}} livery
 */
/**
 * Paint a cloned rival / attract mesh. Player cars never call this.
 * @param {THREE.Object3D} root
 * @param {{body?:number, id?:string}|null} tint
 * @param {number} variant
 * @param {(mat:THREE.Material, mesh:THREE.Mesh)=>boolean} isBody
 */
export function dressRivalCar(root, tint, variant, isBody) {
  const livery = tint && tint.id && tint.body != null ? tint : aiLiveryForIndex(variant);
  const painted = getRivalPaintMaterial(livery);
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = [].concat(obj.material);
    let hit = false;
    const next = mats.map((m) => {
      if (!m || (m.userData && (m.userData.rivalDecal || m.userData.kind === "decal"))) return m;
      if (!isBody(m, obj)) return m;
      hit = true;
      return painted;
    });
    if (hit) obj.material = next.length === 1 ? next[0] : next;
  });
  attachRivalLiveryMarks(root, livery);
  root.userData.aiTint = livery.body;
  root.userData.rivalLivery = livery.id;
  return livery;
}

export function attachRivalLiveryMarks(root, livery) {
  if (!root || root.userData.rivalMarks) return;
  const chassis = root.userData.carId || "celica";
  const fit = FIT[chassis] || FIT.celica;
  const geo = getDecalGeo();
  const doorMat = vinylMaterial(doorTexture(livery));
  const hoodMat = vinylMaterial(hoodTexture(livery));
  const roofMat = vinylMaterial(roofTexture(livery));

  const right = new THREE.Mesh(geo, doorMat);
  right.position.set(fit.halfW + 0.012, fit.doorY, fit.doorZ);
  right.rotation.y = Math.PI / 2;
  right.scale.set(0.4, 0.28, 1);

  const left = new THREE.Mesh(geo, doorMat);
  left.position.set(-(fit.halfW + 0.012), fit.doorY, fit.doorZ);
  left.rotation.y = -Math.PI / 2;
  left.scale.set(0.4, 0.28, 1);

  const hood = new THREE.Mesh(geo, hoodMat);
  hood.position.set(0, fit.hoodY + 0.01, fit.hoodZ);
  hood.rotation.x = -Math.PI / 2;
  hood.scale.set(0.78, 0.26, 1);

  const roof = new THREE.Mesh(geo, roofMat);
  roof.position.set(0, fit.roofY + 0.01, fit.roofZ);
  roof.rotation.x = -Math.PI / 2;
  roof.scale.set(0.36, 0.14, 1);

  const marks = [right, left, hood, roof];
  for (let i = 0; i < marks.length; i++) {
    const m = marks[i];
    m.name = `rival-mark-${i}`;
    m.castShadow = false;
    m.receiveShadow = false;
    m.frustumCulled = true;
    m.renderOrder = 2;
    m.userData.rivalDecal = true;
    root.add(m);
  }
  root.userData.rivalMarks = true;
  root.userData.rivalLivery = livery.id;
}
