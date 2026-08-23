#!/usr/bin/env node
/**
 * qa-sprint30-realism.mjs — Sprint 30 cinema realism gate.
 *
 * RUN: node tools/qa-sprint30-realism.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`SPRINT 30 CINEMA REALISM GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const pbr = read("js/gfx/pbr.js");
const track = read("js/tracks/track.js");
const sky = read("js/sky.js");
const post = read("js/gfx/postfx.js");
const main = read("js/main.js");
const index = read("index.html");

const tier = Number((config.match(/\btier:\s*(\d+)/) || [])[1] || 0);
check("VISUAL.tier >= 13", tier >= 13, `tier is ${tier}`);
check("cinemaRealism armed", /cinemaRealism:\s*true/.test(config), "cinemaRealism: true");
check("ACES tone mapping", /ACESFilmicToneMapping/.test(read("js/gfx/lighting-rig.js")), "renderer uses ACES");
check("normalStrength lifted", /normalStrength:\s*1\.[12]\d*/.test(config), "normals ≥ 1.1");
check("worldEnv lifted", /worldEnvIntensity:\s*0\.[89]/.test(config), "worldEnv ≥ 0.8");
check("photographic grade sat", /gradeSaturation:\s*1\.0[0-9]/.test(config), "restrained saturation");
check("film grain on", /filmGrain:\s*0\.0[2-9]/.test(config), "subtle grain");
check("tier-13 WORLD_ENV", />= 13[\s\S]{0,80}1\.72/.test(pbr), "pbr WORLD_ENV cinema");
check("land cinema paint", /cinema/.test(track) && /silica|talus|Leaf litter|Bitumen/.test(track), "terrain/road micro-detail");
check("sky cinema clouds", /cinemaRealism/.test(sky), "sky cloud dark path");
check("postFx armed", /postFx:\s*true/.test(config) && /PhotoRealPost/.test(game), "post stack");
check("desert cinema lighting", /Sprint 30 cinema Desert/.test(config), "desert LIGHTING");
check("forest cinema lighting", /Sprint 30 cinema Forest/.test(config), "forest LIGHTING");
check("mountain cinema lighting", /Sprint 30 cinema Mountain/.test(config), "mountain LIGHTING");
const { gameV, ok: cacheOk } = readCacheVersions(main, index);
check("cache bust chain", cacheOk, `v=${gameV}`);
check("postFx module", /export class PhotoRealPost/.test(post), "postfx.js");

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 30 cinema realism armed"}`
);
process.exit(fail ? 1 : 0);
