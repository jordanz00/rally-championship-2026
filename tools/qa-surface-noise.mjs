#!/usr/bin/env node
/**
 * Surface grit + trail / particle realism.
 *
 * RUN: node tools/qa-surface-noise.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`SURFACE NOISE  ·  ${new Date().toISOString()}\n`);

const noise = read("js/gfx/surface-noise.js");
const pbr = read("js/gfx/pbr.js");
const effects = read("js/effects.js");
const deform = read("js/tracks/surface-deform.js");
const attract = read("js/cinema/attract-reel.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("surface grit GLSL exported", /export const SURFACE_NOISE_GLSL/.test(noise) && /float snFbm/.test(noise));
check("applySurfaceNoisePass walks the stage", /export function applySurfaceNoisePass/.test(noise));
check("skips paint / water / film overlay", /SKIP_KIND/.test(noise) && /water\|paint\|glass/.test(noise));
check("pbr projected maps multiply surfaceGrit", /sampledDiffuseColor\.rgb \*= surfaceGrit/.test(pbr));
check("pbr roughness chatters with grit", /surfaceGritRough/.test(pbr));
check("upgradeWorld runs the noise pass", /applySurfaceNoisePass\(root\)/.test(pbr));
check("dust sprite is 128 grit, not a hexagon", /const s = 128/.test(effects) && /Speck holes/.test(effects));
check("dust fragment mottles color", /mott \* 0\.08/.test(effects));
check("tire marks have tread UV + edge fade", /attribute vec2 aUv/.test(effects) && /float groove/.test(effects));
check("rut mesh gets surface grit", /armSurfaceNoise\(this\.mat/.test(deform));
check("attract ribbon and land get grit", (attract.match(/armSurfaceNoise\(mat/g) || []).length >= 2);
check("effects v=96", /effects\.js\?v=96/.test(game));
check("pbr v=58", /pbr\.js\?v=58/.test(game));
check("surface-noise v=2 cache key is bound-safe", /function surfaceNoiseCacheKey/.test(noise));
check(
  "cache-bust chain",
  cacheOk && gameV >= 965 && mainV >= 965,
  `main=${mainV} game=${gameV}`
);

if (fail) {
  console.error(`\nSURFACE NOISE failed: ${fail}`);
  process.exit(1);
}
console.log("\nSURFACE NOISE passed.");
