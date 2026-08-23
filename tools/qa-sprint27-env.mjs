#!/usr/bin/env node
/**
 * qa-sprint27-env.mjs — Sprint 27 gate: environmental realism + rear dirt wake
 * + HD nature props (no primitive forest trees).
 *
 * RUN: node tools/qa-sprint27-env.mjs
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

console.log(`SPRINT 27 ENV + DIRT WAKE + HD NATURE GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const effects = read("js/effects.js");
const sky = read("js/sky.js");
const game = read("js/game.js");
const track = read("js/tracks/track.js");

check("VISUAL.tier >= 11", /tier:\s*1[1-9]/.test(config), "tier: 11+");
check("rearDirtWake flag", /rearDirtWake:\s*true/.test(config), "rearDirtWake");
check("envAtmosphere flag", /envAtmosphere:\s*true/.test(config), "envAtmosphere");
check("glbProps armed", /glbProps:\s*true/.test(config), "glbProps");
check(
  "desert wind + stronger dust",
  /dustStrength:\s*0\.72/.test(config) && /wind:\s*\[/.test(config),
  "desert dustStrength 0.72 + wind"
);
check("Dust.setAtmosphere", /setAtmosphere\(L\)/.test(effects), "setAtmosphere API");
check("rear wake bias", /almost all spray from the rear|Sprint 27/.test(effects), "rear emission");
check("plume particles", /plume/.test(effects) && /profile\.plume/.test(effects), "plume layer");
check("wind on particles", /_wind/.test(effects) && /this\._wind\.x/.test(effects), "stage wind");
check("sky ground bounce", /uGroundBounce/.test(sky), "uGroundBounce uniform");
check("sky dual cloud octave", /n2/.test(sky) && /mix\(n, n2/.test(sky), "cloud octave");
check("game wires dust atmosphere", /dust\.setAtmosphere/.test(game), "game → dust.setAtmosphere");
check("effects cache bump", /effects\.js\?v=4[89]/.test(game), "effects.js?v=48|49");
check("sky cache bump", /sky\.js\?v=9/.test(game), "sky.js?v=9");

// HD nature — no card/cone forest trees on the live path
check("HD treeline helper", /_addHdBackdrop\(/.test(track) && /_addForestTreeline/.test(track), "HD backdrop API");
check("forest treeline uses pine GLB", /tree_pineDefaultA/.test(track), "pine GLB");
check("forest treeline uses fir GLB", /tree_fir/.test(track), "fir GLB");
check(
  "no crownGeometry plant in track",
  !/crownGeometry\(\)/.test(track),
  "remove card foliage instances"
);
check(
  "no foliageGeometry plant in track",
  !/foliageGeometry\(/.test(track),
  "remove procedural crowns"
);
check("HD nature skip primitives", /no primitive fallback|_addHdNature/.test(track), "GLB-only plant");
check("asset tree_pineDefaultA", exists("assets/props/tree_pineDefaultA.glb"), "missing pine");
check("asset tree_fir", exists("assets/props/tree_fir.glb"), "missing fir");
check("asset plant_bushDense", exists("assets/props/plant_bushDense.glb"), "missing bush");
check("asset rock_largeA", exists("assets/props/rock_largeA.glb"), "missing rock");

console.log("");
if (fail) {
  console.log(`FAIL  ·  ${fail} check(s)`);
  process.exit(1);
}
console.log("PASS  ·  Sprint 27 environmental realism + HD nature + rear dirt wake");
process.exit(0);
