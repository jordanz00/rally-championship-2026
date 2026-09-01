#!/usr/bin/env node
/**
 * qa-sprint23-photoreal.mjs — Sprint 23 gate: photoreal stack still armed.
 *
 * Sprint 24 retuned budgets; this gate checks the photoreal features remain on.
 *
 * RUN: node tools/qa-sprint23-photoreal.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`SPRINT 23 PHOTOREAL GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const post = read("js/gfx/postfx.js");
const pbr = read("js/gfx/pbr.js");
const sky = read("js/sky.js");

const tier = Number((config.match(/\btier:\s*(\d+)/) || [])[1] || 0);
check("VISUAL.tier >= 9", tier >= 9, `tier is ${tier}`);
check("postFx armed", /postFx:\s*true/.test(config), "set postFx: true");
check("textureScale >= 2", /textureScale:\s*([2-9]|[1-9]\d)/.test(config), "textureScale 2+");
check("pmremSize >= 64", /pmremSize:\s*(6[4-9]|[7-9]\d|\d{3,})/.test(config), "GFX.pmremSize");
check("worldEnvIntensity lifted", /worldEnvIntensity:\s*0\.[5-9]/.test(config), "worldEnv ≥ 0.5");
check("PhotoRealPost module", exists("js/gfx/postfx.js") && /export class PhotoRealPost/.test(post), "postfx.js");
check("bloom composite", /bloomStrength/.test(post) && /COMPOSITE_FRAG|tBloom/.test(post), "composite shader");
check("game wires post", /PhotoRealPost/.test(game) && /post\.render/.test(game), "game.js render path");
check("post resize wired", /post\.setSize/.test(game), "_onResize → post.setSize");
check(
  "ACES tone mapping",
  /ACESFilmicToneMapping/.test(game) || /ACESFilmicToneMapping/.test(read("js/gfx/lighting-rig.js")),
  "renderer tone mapping via game or lighting-rig"
);
check("tier-9 WORLD_ENV bump", />= 9[\s\S]{0,40}1\.42/.test(pbr), "pbr WORLD_ENV for tier 9");
check(
  "HDR equirect skybox",
  /RGBELoader|isSkyReady|kloofendal/.test(sky),
  "Sprint 549 skybox replaces volumetric sun disc"
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 23 photoreal stack armed"}`);
process.exit(fail ? 1 : 0);
