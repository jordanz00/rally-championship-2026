/**
 * Surface library — PBR world + UE5-inspired vehicle materials (Sprint 25).
 *
 * WHO THIS IS FOR: renderer, cars, and track meshes.
 * WHAT IT DOES: MeshStandard / MeshPhysical surfaces with env response,
 *   roughness maps, and clearcoat lacquer on the player paint path. AI pack
 *   stays on cheaper shared Standard materials (no clearcoat ×14).
 *   Roads / terrain / skirts world-XZ project albedo+normal+ARM/AO and
 *   use AO as bump; Forest tunnel rock is triplanar.
 * HOW IT CONNECTS: Track and cars/celica.js build meshes with these; game.js
 *   bakes a sky env map and calls applyEnvMap on the player car.
 *
 * PERFORMANCE: transmission is still forbidden (extra scene render). Clearcoat
 *   is player-only. Roughness maps are half-res procedural canvases.
 */

import * as THREE from "../../vendor/three.module.js";
import { VISUAL } from "../config.js?v=223";
import { flatParams, paintedTexture, sharedMaterial } from "./saturn.js?v=1";

/** Tier 13 cinema IBL; prior tiers keep arcade pack budget. */
const WORLD_ENV =
  (VISUAL.tier != null ? VISUAL.tier : 0) >= 13 || VISUAL.cinemaRealism
    ? 1.72
    : (VISUAL.tier != null ? VISUAL.tier : 0) >= 10
      ? 1.55
      : (VISUAL.tier != null ? VISUAL.tier : 0) >= 9
        ? 1.42
        : (VISUAL.tier != null ? VISUAL.tier : 0) >= 7
          ? 1.28
          : (VISUAL.tier != null ? VISUAL.tier : 0) >= 5
            ? 1.24
            : (VISUAL.tier != null ? VISUAL.tier : 0) >= 4
              ? 1.2
              : (VISUAL.tier != null ? VISUAL.tier : 0) >= 3
                ? 1.16
                : 1.0;

function ue5() {
  return (VISUAL.tier || 0) >= 10 && VISUAL.ue5Look !== false;
}

/** Per-surface road roughness. Dry tarmac is matte — wet look is a runtime flag. */
const ROAD_ROUGH = {
  tarmac: 0.84,
  gravel: 0.76,
  dirt: 0.86,
  sand: 0.9,
  mud: 0.97,
  cobble: 0.62,
  grass: 0.9,
};

/** 0..1 Mountain rain wetness applied to live road materials. */
let WORLD_ROAD_WET = 0;

/** @type {WeakMap<THREE.Material, THREE.Material>} */
const WORLD_MAT_CACHE = new WeakMap();

/**
 * Legacy helper: promote a material to MeshStandardMaterial.
 *
 * Kept for callers that genuinely want PBR (imported GLB car bodies keep their
 * authored maps). New code should prefer paint() / flat surfaces.
 *
 * @param {THREE.Material|null} mat
 * @param {object} [extra]
 * @returns {THREE.Material}
 */
export function toStandard(mat, extra = {}) {
  if (!mat) {
    return new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.85, metalness: 0.03 });
  }
  if (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial) {
    if (extra.roughness != null) mat.roughness = extra.roughness;
    if (extra.metalness != null) mat.metalness = extra.metalness;
    if (extra.envMapIntensity != null) mat.envMapIntensity = extra.envMapIntensity;
    mat.needsUpdate = true;
    return mat;
  }
  return new THREE.MeshStandardMaterial({
    color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
    map: mat.map || null,
    vertexColors: !!mat.vertexColors,
    transparent: !!mat.transparent,
    opacity: mat.opacity != null ? mat.opacity : 1,
    side: mat.side != null ? mat.side : THREE.FrontSide,
    alphaTest: mat.alphaTest || 0,
    roughness: extra.roughness != null ? extra.roughness : 0.85,
    metalness: extra.metalness != null ? extra.metalness : 0.04,
    fog: mat.fog !== false,
  });
}

/**
 * Rally paint — MeshPhysical clearcoat lacquer at tier 10 (player path).
 * @param {number|THREE.Color} color
 * @param {object} [extra]
 * @returns {THREE.Material}
 */
export function paint(color, extra = {}) {
  if (ue5()) {
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      map: extra.map || null,
      roughness: extra.roughness != null ? extra.roughness : 0.34,
      metalness: extra.metalness != null ? extra.metalness : 0.12,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      envMapIntensity: VISUAL.carEnvIntensity ?? 0.72,
      flatShading: !!extra.flatShading,
      vertexColors: !!extra.vertexColors,
      transparent: !!extra.transparent,
      opacity: extra.opacity != null ? extra.opacity : 1,
      side: extra.side != null ? extra.side : THREE.FrontSide,
    });
    mat.userData.kind = "paint";
    return mat;
  }
  const mat = new THREE.MeshLambertMaterial({ color, ...flatParams(extra) });
  mat.userData.kind = "paint";
  return mat;
}

/**
 * Shared paint for the AI pack — Standard, no clearcoat (GPU budget).
 * @param {number} color
 * @param {object} [extra]
 * @returns {THREE.Material}
 */
export function sharedPaint(color, extra = {}) {
  return sharedMaterial(
    `paint|t${VISUAL.tier || 1}|${color}|${extra.flatShading ? 1 : 0}|${extra.vertexColors ? 1 : 0}`,
    () => {
      if (ue5()) {
        const mat = new THREE.MeshStandardMaterial({
          color,
          roughness: 0.4,
          metalness: 0.1,
          envMapIntensity: (VISUAL.carEnvIntensity ?? 0.72) * 0.85,
          flatShading: !!extra.flatShading,
          vertexColors: !!extra.vertexColors,
        });
        mat.userData.kind = "paint";
        return mat;
      }
      return paint(color, extra);
    }
  );
}

/**
 * Tinted glass — Physical without transmission (transmission = second scene pass).
 * @param {number} [color]
 * @param {object} [extra]
 * @returns {THREE.Material}
 */
export function glass(color = 0x1a2832, extra = {}) {
  if (ue5()) {
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      transparent: true,
      opacity: extra.opacity != null ? extra.opacity : 0.34,
      roughness: extra.roughness != null ? extra.roughness : 0.035,
      metalness: 0,
      ior: 1.45,
      envMapIntensity: extra.envMapIntensity != null ? extra.envMapIntensity : 1.35,
      depthWrite: false,
      // FrontSide only — DoubleSide transparent draws the back face first and
      // reads as flipped / inside-out panes on the title orbit cam.
      side: extra.side != null ? extra.side : THREE.FrontSide,
    });
    mat.userData.kind = "glass";
    // Allow title showcase / IBL to boost glass env (was lockEnv:true → dull panes).
    mat.userData.lockEnv = extra.lockEnv === true;
    if ("forceSinglePass" in mat) mat.forceSinglePass = true;
    return mat;
  }
  const params = flatParams(extra);
  const mat = new THREE.MeshLambertMaterial({
    color,
    transparent: true,
    opacity: params.opacity != null ? params.opacity : 0.4,
    depthWrite: false,
    side: extra.side != null ? extra.side : THREE.FrontSide,
    ...params,
  });
  mat.userData.kind = "glass";
  mat.userData.lockEnv = extra.lockEnv === true;
  return mat;
}

/**
 * Bright trim — high-metal Standard at tier 10.
 * @param {number} [color]
 * @returns {THREE.Material}
 */
export function chrome(color = 0xc8c8d0) {
  if (ue5()) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.16,
      metalness: 1,
      envMapIntensity: 1.35,
    });
    mat.userData.kind = "chrome";
    mat.userData.lockEnv = true;
    return mat;
  }
  const mat = new THREE.MeshPhongMaterial({
    color,
    specular: 0xf4f0e4,
    shininess: 42,
    reflectivity: 0.28,
  });
  mat.userData.kind = "chrome";
  mat.userData.lockEnv = true;
  return mat;
}

/**
 * @param {number} [color]
 * @returns {THREE.Material}
 */
export function rubber(color = 0x111111) {
  if (ue5()) {
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.94,
      metalness: 0,
      envMapIntensity: 0.15,
    });
    mat.userData.kind = "rubber";
    mat.userData.lockEnv = true;
    return mat;
  }
  const mat = new THREE.MeshLambertMaterial({ color });
  mat.userData.kind = "rubber";
  mat.userData.lockEnv = true;
  return mat;
}

/**
 * Open water — a painted ripple sheet with a cheap sun glint, not a mirror.
 * Lakeside needs to read as a body of water in one glance, not a reflection probe.
 * @returns {THREE.MeshPhongMaterial}
 */
export function water() {
  const tier = VISUAL.tier || 1;
  const tier4 = tier >= 4 && VISUAL.waterReflection !== false;
  const texKey = tier4 ? "water-ripple-t4" : "water-ripple";
  if (VISUAL.realisticArcade) {
    const map = paintedTexture(
      texKey,
      (g, w, h) => {
        g.fillStyle = tier4 ? "#1e4a5c" : "#28596e";
        g.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y++) {
          const band = Math.sin(y * 0.13) * 0.5 + Math.sin(y * 0.041 + 1.7) * 0.5;
          const shade = 0.86 + band * (tier4 ? 0.22 : 0.16);
          g.fillStyle = `rgba(${Math.round((tier4 ? 44 : 52) * shade)},${Math.round(
            (tier4 ? 118 : 110) * shade
          )},${Math.round((tier4 ? 148 : 134) * shade)},1)`;
          g.fillRect(0, y, w, 1);
        }
        if (tier4) {
          g.strokeStyle = "rgba(210,236,248,0.55)";
          g.lineWidth = 1.2;
          for (let i = 0; i < 18; i++) {
            const y = (i * 41) % h;
            g.beginPath();
            g.moveTo((i * 47) % w, y);
            g.lineTo(((i * 47) % w) + 26, y + 3);
            g.stroke();
          }
          g.fillStyle = "rgba(180,220,235,0.12)";
          for (let i = 0; i < 12; i++) {
            const cx = ((i * 73) % w) + 8;
            const cy = ((i * 59) % h) + 8;
            g.beginPath();
            g.ellipse(cx, cy, 6 + (i % 3), 3 + (i % 2), i * 0.4, 0, Math.PI * 2);
            g.fill();
          }
        }
      },
      { w: tier4 ? 160 : 128, h: tier4 ? 160 : 128, repeat: [3, 3] }
    );
    const mat = new THREE.MeshStandardMaterial({
      color: tier4 ? 0x9ad4e8 : 0x8ec8d8,
      map: map || null,
      vertexColors: true,
      transparent: true,
      opacity: tier4 ? 0.92 : 0.9,
      roughness: tier4 ? ((VISUAL.tier || 0) >= 10 ? 0.015 : (VISUAL.tier || 0) >= 9 ? 0.02 : 0.04) : 0.08,
      metalness: tier4 ? ((VISUAL.tier || 0) >= 10 ? 0.7 : (VISUAL.tier || 0) >= 9 ? 0.62 : 0.52) : 0.42,
      envMapIntensity: tier4 ? ((VISUAL.tier || 0) >= 10 ? 1.2 : (VISUAL.tier || 0) >= 9 ? 1.05 : 0.78) : 0.55,
      side: THREE.DoubleSide,
      flatShading: false,
    });
    mat.userData.kind = "water";
    mat.userData.lockEnv = true;
    return mat;
  }
  const map = paintedTexture(
    texKey,
    (g, w, h) => {
      g.fillStyle = "#28596e";
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y++) {
        const band = Math.sin(y * 0.13) * 0.5 + Math.sin(y * 0.041 + 1.7) * 0.5;
        const shade = 0.86 + band * 0.16;
        g.fillStyle = `rgba(${Math.round(52 * shade)},${Math.round(110 * shade)},${Math.round(
          134 * shade
        )},1)`;
        g.fillRect(0, y, w, 1);
      }
      g.strokeStyle = "rgba(196,224,232,0.5)";
      g.lineWidth = 1.5;
      for (let i = 0; i < 26; i++) {
        const y = (i * 37) % h;
        g.beginPath();
        g.moveTo((i * 53) % w, y);
        g.lineTo(((i * 53) % w) + 22, y + 2);
        g.stroke();
      }
    },
    { w: 128, h: 128, repeat: [3, 3] }
  );
  const mat = new THREE.MeshPhongMaterial({
    color: 0x8ec8d8,
    map: map || null,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    shininess: 58,
    specular: 0xc4e4ee,
    side: THREE.DoubleSide,
    flatShading: false,
  });
  mat.userData.kind = "water";
  mat.userData.lockEnv = true;
  return mat;
}

/**
 * Cascading waterfall sheet — vertical foam streaks that scroll downward.
 * Cheap MeshStandard + painted map; no realtime refraction.
 * @returns {THREE.MeshStandardMaterial}
 */
export function waterfall() {
  const map = paintedTexture(
    "waterfall-cascade",
    (g, w, h) => {
      g.fillStyle = "#3a6a7c";
      g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x++) {
        const band = 0.55 + 0.45 * Math.sin(x * 0.38) * Math.sin(x * 0.11 + 1.3);
        const r = Math.round(70 + band * 90);
        const grn = Math.round(130 + band * 90);
        const b = Math.round(150 + band * 80);
        g.fillStyle = `rgba(${r},${grn},${b},${0.55 + band * 0.35})`;
        g.fillRect(x, 0, 1, h);
      }
      g.fillStyle = "rgba(230,245,255,0.55)";
      for (let i = 0; i < 22; i++) {
        const x = ((i * 37) % (w - 6)) + 2;
        const tw = 1 + (i % 3);
        g.fillRect(x, 0, tw, h);
      }
      g.fillStyle = "rgba(255,255,255,0.28)";
      for (let i = 0; i < 40; i++) {
        const x = (i * 53) % w;
        const y = (i * 29) % h;
        g.fillRect(x, y, 2, 8 + (i % 5));
      }
      // Soft foam at the “top” of the UV (source lip).
      const grad = g.createLinearGradient(0, 0, 0, h * 0.22);
      grad.addColorStop(0, "rgba(255,255,255,0.75)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h * 0.22);
    },
    { w: 128, h: 256, repeat: [2.4, 1.6] }
  );
  if (map) {
    map.wrapS = THREE.RepeatWrapping;
    map.wrapT = THREE.RepeatWrapping;
  }
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd8f0fa,
    map: map || null,
    transparent: true,
    opacity: 0.82,
    roughness: 0.12,
    metalness: 0.35,
    envMapIntensity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
    flatShading: false,
  });
  mat.userData.kind = "waterfall";
  mat.userData.lockEnv = true;
  return mat;
}

/**
 * Driving ribbon — vertex-coloured surface with repeating grain map.
 * @param {string} id surface id (tarmac, gravel, …)
 * @param {THREE.Texture|null} map
 * @returns {THREE.Material}
 */
export function worldRoadMaterial(id, map, normalMap = null, aoMap = null, roughnessMap = null) {
  if (!VISUAL.realisticArcade) {
    return new THREE.MeshLambertMaterial({
      map,
      vertexColors: true,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -2,
    });
  }
  const nsBase = VISUAL.normalStrength ?? 0.85;
  const nsMul =
    id === "tarmac"
      ? 0.58
      : id === "cobble"
        ? 1.18
        : id === "gravel"
          ? 1.22
          : id === "sand"
            ? 1.12
            : id === "dirt"
              ? 1.16
              : id === "mud"
                ? 1.08
                : 0.9;
  const ns = nsBase * nsMul;
  const tier = VISUAL.tier || 1;
  const dryTarmac = id === "tarmac";
  const rough = ROAD_ROUGH[id] ?? 0.88;
  const metal = dryTarmac
    ? 0.035
    : id === "cobble"
      ? tier >= 10
        ? 0.08
        : 0.05
      : 0.02;
  const env = dryTarmac
    ? (tier >= 10 ? 0.2 : 0.14) * WORLD_ENV
    : (tier >= 10 ? 0.42 : tier >= 9 ? 0.34 : 0.28) * WORLD_ENV;
  const heightMap = aoMap || roughnessMap;
  const dirty = id === "dirt" || id === "mud" || id === "gravel" || id === "sand";
  const mat = new THREE.MeshStandardMaterial({
    map,
    normalMap,
    aoMap: aoMap || null,
    aoMapIntensity: aoMap ? (tier >= 10 ? 0.72 : 0.55) : 1,
    roughnessMap: roughnessMap || null,
    bumpMap: heightMap || null,
    bumpScale: dirty ? 0.58 : id === "cobble" ? 0.42 : id === "tarmac" ? 0.16 : 0.28,
    normalScale: new THREE.Vector2(ns, ns),
    vertexColors: true,
    side: THREE.FrontSide,
    roughness: rough,
    metalness: metal,
    envMapIntensity: env,
    flatShading: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  mat.userData.kind = "road";
  mat.userData.surfaceId = id;
  mat.userData.dryRough = rough;
  mat.userData.dryEnv = env;
  mat.userData.dryMetal = metal;
  armRoadOrganic(mat, id);
  applyRoadWetToMat(mat);
  return mat;
}

/**
 * World-XZ / triplanar sampling for albedo + normal + roughness/AO/ARM + AO bump.
 * Same look family as the organic road — maps follow metres, not ribbon UV bars.
 * GLSL only (WebGPU skips onBeforeCompile).
 *
 * @param {THREE.Material} mat
 * @param {{
 *   mode?: "xz"|"triplanar",
 *   amount?: number,
 *   ribbon?: number,
 *   bump?: number,
 *   blotch?: boolean,
 *   key?: string,
 * }} [opts]
 */
export function armProjectedMaps(mat, opts = {}) {
  if (!mat || mat.userData.projArmed) return;
  mat.userData.projArmed = true;
  mat.userData.organicArmed = true;
  const mode = opts.mode === "triplanar" ? "triplanar" : "xz";
  const amount = opts.amount != null ? opts.amount : 0.85;
  const ribbon = opts.ribbon != null ? opts.ribbon : 0.12;
  const bump = opts.bump != null ? opts.bump : 0.45;
  const blotch = !!opts.blotch;
  const key = opts.key || `proj-${mode}-v1`;
  mat.onBeforeCompile = (shader) => {
    injectProjectedMaps(shader, { mode, amount, ribbon, bump, blotch });
  };
  mat.customProgramCacheKey = () => key;
}

/**
 * Break wallpaper tiling: dual-scale albedo + world-XZ normals / ARM / bump.
 * @param {THREE.Material} mat
 * @param {string} id
 */
function armRoadOrganic(mat, id) {
  const dirty = id === "dirt" || id === "mud" || id === "gravel" || id === "sand";
  armProjectedMaps(mat, {
    mode: "xz",
    amount: dirty ? 1 : id === "tarmac" ? 0.42 : 0.28,
    ribbon: dirty ? 0.08 : id === "tarmac" ? 0.52 : id === "cobble" ? 0.22 : 0.32,
    bump: dirty ? 0.58 : id === "tarmac" ? 0.16 : id === "cobble" ? 0.42 : 0.28,
    blotch: true,
    key: `road-organic-v4-${id}`,
  });
}

/**
 * Inject world-projected map / normal / roughness / AO / metalness + AO-as-bump.
 * @param {object} shader
 * @param {{mode:string, amount:number, ribbon:number, bump:number, blotch:boolean}} opts
 */
function injectProjectedMaps(shader, opts) {
  shader.uniforms.uProjAmt = { value: opts.amount };
  shader.uniforms.uProjRibbon = { value: opts.ribbon };
  shader.uniforms.uBumpAmt = { value: opts.bump };
  shader.uniforms.uRoadVar = { value: opts.amount };
  const triDef = opts.mode === "triplanar" ? "#define USE_PROJ_TRIPLANAR\n" : "";
  const blotchSrc = opts.blotch
    ? `	float n1 = roadNoise( vProjWorld.xz * 0.11 );
	float n2 = roadNoise( vProjWorld.xz * 0.37 + 17.0 );
	float n3 = roadNoise( vProjWorld.xz * 0.019 );
	float blotch = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
	sampledDiffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.78 + blotch * 0.4 ), uProjAmt );
	sampledDiffuseColor = mix( sampledDiffuseColor, texture2D( map, vMapUv * 0.41 + vec2( 0.19, 0.11 ) ), 0.12 );`
    : "";
  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      "#include <common>\nvarying vec3 vProjWorld;\nvarying vec3 vProjNrm;\nvarying vec3 vRoadWorld;"
    )
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>
vProjWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
vRoadWorld = vProjWorld;
vProjNrm = inverseTransformDirection( transformedNormal, viewMatrix );`
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>
${triDef}uniform float uProjAmt;
uniform float uProjRibbon;
uniform float uBumpAmt;
uniform float uRoadVar;
varying vec3 vProjWorld;
varying vec3 vProjNrm;
varying vec3 vRoadWorld;
float roadHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float roadNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = roadHash(i);
  float b = roadHash(i + vec2(1.0, 0.0));
  float c = roadHash(i + vec2(0.0, 1.0));
  float d = roadHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
vec2 projUvA(vec3 w) { return w.xz * 0.078; }
vec2 projUvB(vec3 w) {
  return vec2(w.x * 0.049 + w.z * 0.064, w.z * 0.049 - w.x * 0.064);
}
vec2 projUvDetail(vec3 w) { return w.xz * 0.42; }
vec4 projTex(sampler2D tex, vec2 meshUv) {
  vec4 mixW;
#ifdef USE_PROJ_TRIPLANAR
  vec3 n = abs(normalize(vProjNrm));
  n = pow(n, vec3(4.0));
  n /= max(n.x + n.y + n.z, 1e-4);
  float sc = 0.48;
  mixW = texture2D(tex, vProjWorld.zy * sc) * n.x
    + texture2D(tex, vProjWorld.xz * sc) * n.y
    + texture2D(tex, vProjWorld.xy * sc) * n.z;
#else
  mixW = mix(texture2D(tex, projUvA(vProjWorld)), texture2D(tex, projUvB(vProjWorld)), 0.46 * uProjAmt);
#endif
  return mix(mixW, texture2D(tex, meshUv), uProjRibbon);
}
vec3 projNormal(sampler2D tex, vec2 meshUv) {
  vec3 n = projTex(tex, meshUv).xyz * 2.0 - 1.0;
#ifndef USE_PROJ_TRIPLANAR
  vec3 nd = texture2D(tex, projUvDetail(vProjWorld)).xyz * 2.0 - 1.0;
  n = normalize(vec3(n.xy + nd.xy * uProjAmt, n.z));
#endif
  return n;
}`
    )
    .replace(
      "#include <map_fragment>",
      `#ifdef USE_MAP
	vec4 sampledDiffuseColor = projTex( map, vMapUv );
${blotchSrc}
	diffuseColor *= sampledDiffuseColor;
#endif`
    )
    .replace(
      "#include <normal_fragment_maps>",
      `#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = projNormal( normalMap, vNormalMapUv );
	#ifdef USE_BUMPMAP
	float h0 = projTex( bumpMap, vNormalMapUv ).r;
	vec2 hUv = projUvA( vProjWorld );
	float hx = texture2D( bumpMap, hUv + vec2( 0.003, 0.0 ) ).r;
	float hz = texture2D( bumpMap, hUv + vec2( 0.0, 0.003 ) ).r;
	mapN.x += ( h0 - hx ) * uBumpAmt * 2.6;
	mapN.y += ( h0 - hz ) * uBumpAmt * 2.6;
	#endif
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`
    )
    .replace(
      "#include <roughnessmap_fragment>",
      `float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = projTex( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`
    )
    .replace(
      "#include <metalnessmap_fragment>",
      `float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = projTex( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`
    )
    .replace(
      "#include <aomap_fragment>",
      `#ifdef USE_AOMAP
	float ambientOcclusion = ( projTex( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT )
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN )
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`
    );
}

/**
 * Wet asphalt only when Mountain rain (or an explicit wet amount) is active.
 * @param {THREE.Object3D|null} root
 * @param {number} wet 0..1
 */
export function setWorldRoadWetness(root, wet) {
  WORLD_ROAD_WET = Math.max(0, Math.min(1, wet || 0));
  if (!root) return;
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const list = [].concat(obj.material || []);
    for (let i = 0; i < list.length; i++) applyRoadWetToMat(list[i]);
  });
}

/**
 * @param {THREE.Material|null} m
 */
function applyRoadWetToMat(m) {
  if (!m || m.userData.kind !== "road") return;
  const k = WORLD_ROAD_WET;
  const id = m.userData.surfaceId;
  const dryR = m.userData.dryRough != null ? m.userData.dryRough : m.roughness;
  const dryE = m.userData.dryEnv != null ? m.userData.dryEnv : m.envMapIntensity;
  if (id === "tarmac" || id === "cobble") {
    m.roughness = dryR * (1 - k * 0.44);
    if (m.envMapIntensity != null) m.envMapIntensity = dryE * (1 + k * 1.05);
  } else {
    m.roughness = dryR;
    if (m.envMapIntensity != null) m.envMapIntensity = dryE;
  }
  if (m.color) {
    if (!m.userData.dryColor) m.userData.dryColor = m.color.clone();
    const dark = id === "tarmac" || id === "cobble" ? 0.14 : 0.07;
    m.color.copy(m.userData.dryColor).multiplyScalar(1 - k * dark);
  }
}

/**
 * Heightmap land, floor fill, and large terrain sheets.
 * @param {object} opts
 * @returns {THREE.Material}
 */
export function worldTerrainMaterial(opts = {}) {
  if (!VISUAL.realisticArcade) {
    return new THREE.MeshLambertMaterial({
      map: opts.map ?? null,
      color: opts.color ?? 0xffffff,
      vertexColors: !!opts.vertexColors,
      flatShading: opts.flatShading ?? true,
      side: opts.side ?? THREE.FrontSide,
    });
  }
  const baseEnv = opts.envMapIntensity ?? VISUAL.worldEnvIntensity ?? 0.38;
  const cinema = (VISUAL.tier || 0) >= 13 || VISUAL.cinemaRealism;
  const mat = new THREE.MeshStandardMaterial({
    map: opts.map ?? null,
    normalMap: opts.normalMap ?? null,
    aoMap: opts.aoMap ?? null,
    aoMapIntensity: opts.aoMapIntensity ?? (ue5() ? 1.05 : 0.9),
    roughnessMap: opts.roughnessMap ?? null,
    normalScale: new THREE.Vector2(
      opts.normalScale ?? VISUAL.normalStrength ?? 0.85,
      opts.normalScale ?? VISUAL.normalStrength ?? 0.85
    ),
    color: opts.color ?? 0xffffff,
    vertexColors: !!opts.vertexColors,
    roughness: opts.roughness ?? (ue5() ? (cinema ? 0.8 : 0.86) : 0.9),
    metalness: ue5() ? 0.035 : 0.018,
    bumpMap: opts.aoMap || opts.roughnessMap || null,
    bumpScale: opts.bumpScale ?? 0.48,
    envMapIntensity: baseEnv * WORLD_ENV * (ue5() ? 1.12 : 1) * (cinema ? 1.12 : 1),
    flatShading: false,
    side: opts.side ?? THREE.FrontSide,
  });
  mat.userData.kind = "terrain";
  armProjectedMaps(mat, {
    mode: "xz",
    amount: 0.88,
    ribbon: 0.14,
    bump: opts.bumpScale ?? 0.48,
    blotch: false,
    key: "terrain-proj-v1",
  });
  return mat;
}

/**
 * Road shoulder / apron ribbon beside the deck (Visual Pass V3 — grain map).
 * @param {THREE.Texture|null} [map]
 * @param {THREE.Texture|null} [normalMap]
 * @param {THREE.Texture|null} [roughnessMap]
 * @param {THREE.Texture|null} [aoMap]
 * @returns {THREE.Material}
 */
export function worldSkirtMaterial(map = null, normalMap = null, roughnessMap = null, aoMap = null) {
  if (!VISUAL.realisticArcade) {
    return new THREE.MeshLambertMaterial({
      map: map || null,
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
    });
  }
  const ns = (VISUAL.normalStrength ?? 0.85) * 0.86;
  const heightMap = aoMap || roughnessMap;
  const mat = new THREE.MeshStandardMaterial({
    map: map || null,
    normalMap: normalMap || null,
    roughnessMap: roughnessMap || null,
    aoMap: aoMap || null,
    aoMapIntensity: aoMap ? 0.72 : 1,
    bumpMap: heightMap || null,
    bumpScale: 0.42,
    normalScale: new THREE.Vector2(ns, ns),
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.01,
    envMapIntensity: 0.22,
    flatShading: false,
    side: THREE.DoubleSide,
  });
  armProjectedMaps(mat, {
    mode: "xz",
    amount: 0.9,
    ribbon: 0.1,
    bump: 0.42,
    blotch: false,
    key: "skirt-proj-v1",
  });
  return mat;
}

/**
 * Painted kerb stones along the ribbon edge.
 * @returns {THREE.Material}
 */
export function worldKerbMaterial() {
  if (!VISUAL.realisticArcade) {
    return new THREE.MeshLambertMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
    });
  }
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.02,
    envMapIntensity: 0.2,
    flatShading: false,
    side: THREE.DoubleSide,
  });
}

/**
 * Trackside props — rocks, walls, village blocks, spectator barriers.
 * @param {number} color
 * @param {number} [roughness]
 * @returns {THREE.Material}
 */
export function worldPropMaterial(color, roughness = 0.88) {
  if (!VISUAL.realisticArcade) {
    return new THREE.MeshLambertMaterial({ color, flatShading: true });
  }
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.02,
    envMapIntensity: 0.2,
    flatShading: false,
  });
  mat.userData.kind = "prop";
  return mat;
}

/**
 * Promote every Lambert/Basic mesh under the track to MeshStandardMaterial.
 * Shared materials are deduped via WeakMap so shader count stays flat.
 * @param {THREE.Object3D} root
 */
export function upgradeWorldMaterials(root) {
  if (!root || !VISUAL.realisticArcade) return;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const list = [].concat(obj.material);
    let changed = false;
    const next = list.map((m) => {
      if (!m || m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) return m;
      if (m.userData.kind === "water" && m.isMeshPhongMaterial) return m;
      if (WORLD_MAT_CACHE.has(m)) {
        changed = true;
        return WORLD_MAT_CACHE.get(m);
      }
      if (!m.isMeshBasicMaterial && !m.isMeshLambertMaterial) return m;
      const rough =
        m.userData.roughness != null
          ? m.userData.roughness
          : m.isMeshBasicMaterial
            ? 0.96
            : m.userData.kind === "road"
              ? 0.5
              : 0.9;
      const std = new THREE.MeshStandardMaterial({
        color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
        map: m.map || null,
        vertexColors: !!m.vertexColors,
        transparent: !!m.transparent,
        opacity: m.opacity != null ? m.opacity : 1,
        side: m.side != null ? m.side : THREE.FrontSide,
        alphaTest: m.alphaTest || 0,
        roughness: rough,
        metalness: m.userData.metalness != null ? m.userData.metalness : 0.02,
        envMapIntensity: m.userData.envIntensity != null ? m.userData.envIntensity : 0.22,
        flatShading: false,
        fog: m.fog !== false,
        depthWrite: m.depthWrite !== false,
        polygonOffset: m.polygonOffset,
        polygonOffsetFactor: m.polygonOffsetFactor,
        polygonOffsetUnits: m.polygonOffsetUnits,
      });
      if (m.userData.kind) std.userData.kind = m.userData.kind;
      WORLD_MAT_CACHE.set(m, std);
      changed = true;
      return std;
    });
    if (changed) obj.material = next.length === 1 ? next[0] : next;
  });
}

/**
 * Swap any mesh named "water"/"lake" onto the painted water sheet.
 * @param {THREE.Object3D} root
 */
export function upgradeWorld(root) {
  if (!root) return;
  let shared = null;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const n = `${obj.name || ""}`.toLowerCase();
    if (n !== "water" && !n.includes("lake")) return;
    if (!shared) shared = water();
    obj.material = shared;
  });
  upgradeWorldMaterials(root);
}

/**
 * Bind a cube / PMREM env map onto every material that can take one.
 *
 * Lambert and Phong are included: they support envMap through the classic
 * reflection combine path, so the player's car still picks up the sky without
 * anything in the scene paying for a Standard/Physical shader.
 *
 * @param {THREE.Object3D} root
 * @param {THREE.Texture} envMap
 * @param {number} [intensity]
 */
export function applyEnvMap(root, envMap, intensity) {
  if (!root || !envMap) return;
  const cinema = (VISUAL.tier || 0) >= 13 || VISUAL.cinemaRealism;
  try {
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const list = [].concat(obj.material || []);
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (!m) continue;
        if (m.userData.hud || m.userData.povHud) continue;
        if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
          m.envMap = envMap;
          if (intensity != null && !m.userData.lockEnv && !m.userData.showroomOpaqueGlass) {
            const kind = m.userData.kind;
            let tint = intensity;
            if (kind === "road") {
              if (m.userData.dryEnv != null) tint = m.userData.dryEnv;
              else tint *= m.userData.surfaceId === "tarmac" ? 0.28 : 0.78;
            } else if (kind === "chrome") tint *= cinema ? 1.38 : 1.22;
            else if (kind === "glass") tint *= cinema ? 1.08 : 0.95;
            else if (kind === "prop") tint *= cinema ? 0.92 : 0.88;
            else if (kind === "terrain") tint *= cinema ? 1.05 : 0.98;
            m.envMapIntensity = tint;
            if (kind === "road") applyRoadWetToMat(m);
          }
          if (m.isMeshPhysicalMaterial && m.clearcoat > 0) {
            m.clearcoatMap = m.clearcoatMap || null;
            if (m.clearcoatEnvMapIntensity == null || m.clearcoatEnvMapIntensity < 0.5) {
              m.clearcoatEnvMapIntensity = ue5() ? 1.15 : 0.9;
            }
          }
          continue;
        }
        // Lambert/Phong take a cube map only; a PMREM (equirect-packed) map
        // would sample as garbage, so skip anything that is not a cube.
        if ((m.isMeshLambertMaterial || m.isMeshPhongMaterial) && envMap.isCubeTexture) {
          if (m.userData.shared) continue;
          m.envMap = envMap;
          m.combine = THREE.MixOperation;
          if (m.reflectivity == null || !m.userData.lockEnv) {
            m.reflectivity = m.userData.kind === "chrome" ? 0.42 : 0.14;
          }
          m.needsUpdate = true;
        }
      }
    });
  } catch (err) {
    console.warn("applyEnvMap failed", err);
  }
}

/**
 * Boost or restore lacquer/chrome reflectivity for the title splash hero car.
 * Snapshots originals so race materials return unchanged after PRESS START.
 *
 * @param {THREE.Object3D} root
 * @param {boolean} active
 * @param {THREE.Texture|null} envMap
 * @param {{ bodyEnv?: number, chromeEnv?: number, glassEnv?: number }} [profile]
 */
export function setShowcaseReflectivity(root, active, envMap, profile = {}) {
  if (!root) return;
  const bodyEnv = profile.bodyEnv != null ? profile.bodyEnv : 1.08;
  const chromeEnv = profile.chromeEnv != null ? profile.chromeEnv : 1.45;
  const glassEnv = profile.glassEnv != null ? profile.glassEnv : 0.95;
  try {
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const list = [].concat(obj.material || []);
      for (let i = 0; i < list.length; i++) {
        const m = list[i];
        if (!m) continue;
        if (m.userData.hud || m.userData.povHud) continue;
        if (active) {
          if (!m.userData._showcaseSnap) {
            m.userData._showcaseSnap = {
              envMapIntensity: m.envMapIntensity,
              roughness: m.roughness,
              metalness: m.metalness,
              reflectivity: m.reflectivity,
              shininess: m.shininess,
              combine: m.combine,
              clearcoat: m.clearcoat,
              clearcoatRoughness: m.clearcoatRoughness,
              clearcoatEnvMapIntensity: m.clearcoatEnvMapIntensity,
              transparent: m.transparent,
              opacity: m.opacity,
              depthWrite: m.depthWrite,
              side: m.side,
              color: m.color ? m.color.getHex() : null,
              transmission: m.transmission,
            };
          }
          const kind = m.userData.kind;
          const matLabel = `${m.name || ""} ${obj.name || ""}`.toLowerCase();
          const isLamp = /light|lamp|lens|head|tail|brake|signal/.test(matLabel) && !/window/.test(matLabel);
          const isGlass =
            !isLamp &&
            (kind === "glass" ||
              !!(m.userData.showroomOpaqueGlass) ||
              m.userData.titleWindowPane ||
              !!(m.transparent && (m.opacity == null || m.opacity < 0.92) && /window|glass|glazing|windshield/.test(matLabel)));
          const isChrome =
            kind === "chrome" || (m.metalness != null && m.metalness > 0.58 && !isGlass);
          const isRubber = kind === "rubber";
          if (envMap) m.envMap = envMap;
          if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
            if (isGlass) {
              // Title panes: reflective Physical glass, not opaque-black FrontSide.
              m.envMapIntensity = Math.max(glassEnv, 2.45);
              m.roughness = 0.03;
              m.metalness = 0;
              m.side = THREE.DoubleSide;
              m.depthWrite = true;
              m.transparent = true;
              m.opacity = 0.82;
              if (m.color) m.color.setHex(0x6a8294);
              if (m.isMeshPhysicalMaterial) {
                m.transmission = 0;
                m.clearcoat = 1;
                m.clearcoatRoughness = 0.018;
                m.clearcoatEnvMapIntensity = 3.0;
              }
              m.userData.kind = "glass";
              m.userData.lockEnv = false;
              m.userData.showroomOpaqueGlass = true;
              m.userData.titleWindowPane = true;
            } else if (isChrome) {
              if (!m.userData.lockEnv) m.envMapIntensity = chromeEnv;
              m.roughness = Math.min(m.roughness != null ? m.roughness : 0.22, 0.05);
              m.metalness = Math.max(m.metalness != null ? m.metalness : 0.82, 0.96);
            } else if (isRubber) {
              if (!m.userData.lockEnv) m.envMapIntensity = 0.22;
            } else {
              if (!m.userData.lockEnv) m.envMapIntensity = bodyEnv;
              m.roughness = Math.min(m.roughness != null ? m.roughness : 0.52, 0.16);
              m.metalness = Math.max(m.metalness != null ? m.metalness : 0.08, 0.22);
              // Wet showroom lacquer — clearcoat catches sky / rim.
              if (m.isMeshPhysicalMaterial) {
                m.clearcoat = Math.max(m.clearcoat != null ? m.clearcoat : 0, 1);
                m.clearcoatRoughness = Math.min(
                  m.clearcoatRoughness != null ? m.clearcoatRoughness : 0.12,
                  0.045
                );
                m.clearcoatEnvMapIntensity = Math.max(
                  m.clearcoatEnvMapIntensity != null ? m.clearcoatEnvMapIntensity : 1,
                  1.55
                );
              }
            }
          } else if (m.isMeshPhongMaterial) {
            m.reflectivity = isChrome ? 0.85 : 0.5;
            m.shininess = isChrome ? 96 : 64;
            if (envMap && envMap.isCubeTexture && !m.userData.lockEnv) {
              m.combine = THREE.MixOperation;
            }
          } else if (m.isMeshLambertMaterial && envMap && envMap.isCubeTexture && !m.userData.lockEnv) {
            m.reflectivity = isChrome ? 0.68 : 0.4;
            m.combine = THREE.MixOperation;
          }
          m.needsUpdate = true;
        } else if (m.userData._showcaseSnap) {
          const s = m.userData._showcaseSnap;
          if (s.envMapIntensity != null) m.envMapIntensity = s.envMapIntensity;
          if (s.roughness != null) m.roughness = s.roughness;
          if (s.metalness != null) m.metalness = s.metalness;
          if (s.reflectivity != null) m.reflectivity = s.reflectivity;
          if (s.shininess != null) m.shininess = s.shininess;
          if (s.combine != null) m.combine = s.combine;
          if (s.clearcoat != null) m.clearcoat = s.clearcoat;
          if (s.clearcoatRoughness != null) m.clearcoatRoughness = s.clearcoatRoughness;
          if (s.clearcoatEnvMapIntensity != null) {
            m.clearcoatEnvMapIntensity = s.clearcoatEnvMapIntensity;
          }
          if (s.transparent != null) m.transparent = s.transparent;
          if (s.opacity != null) m.opacity = s.opacity;
          if (s.depthWrite != null) m.depthWrite = s.depthWrite;
          if (s.side != null) m.side = s.side;
          if (s.color != null && m.color) m.color.setHex(s.color);
          if (s.transmission != null && m.transmission != null) m.transmission = s.transmission;
          delete m.userData._showcaseSnap;
          m.needsUpdate = true;
        }
      }
    });
  } catch (err) {
    console.warn("setShowcaseReflectivity failed", err);
  }
}
