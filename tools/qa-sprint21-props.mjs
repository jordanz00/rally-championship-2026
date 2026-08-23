#!/usr/bin/env node
/**
 * qa-sprint21-props.mjs — Sprint 21 gate: authored GLB props/characters.
 *
 * RUN: node tools/qa-sprint21-props.mjs
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

console.log(`SPRINT 21 PROPS GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const track = read("js/tracks/track.js");
const game = read("js/game.js");
const kit = read("js/tracks/prop-kit.js");

const tier = Number((config.match(/\btier:\s*(\d+)/) || [])[1] || 0);
check("VISUAL.tier >= 8", tier >= 8, `tier is ${tier}`);
check("glbProps armed", /glbProps:\s*true/.test(config), "set glbProps: true");
check("prop-kit module exists", exists("js/tracks/prop-kit.js"), "missing prop-kit.js");
check("preparePropKit exported", /export function preparePropKit/.test(kit), "export preparePropKit");
check("track imports prop-kit", /prop-kit\.js\?v=/.test(track), "import prop-kit in track.js");
check("track awaits preparePropKit", /await preparePropKit\(\)/.test(track), "await in buildAsync");
check("game boots prop kit", /preparePropKit/.test(game), "call from game.js");
check("spectators use character GLBs", /character-male-a/.test(track), "wire character kinds");
check("safari uses animal GLBs", /animal-zebra/.test(track), "wire animal kinds");
check("village uses house GLB", /house-alpine/.test(track), "wire house-alpine");

const required = [
  "assets/props/character-male-a.glb",
  "assets/props/character-female-a.glb",
  "assets/props/cactus_tall.glb",
  "assets/props/rock_largeA.glb",
  "assets/props/tree_pineDefaultA.glb",
  "assets/props/tree_oak.glb",
  "assets/props/animal-zebra.glb",
  "assets/props/animal-elephant.glb",
  "assets/props/animal-gazelle.glb",
  "assets/props/house-alpine.glb",
  "assets/props/ATTRIBUTION.txt",
  "assets/props/Textures/colormap.png",
];
for (const rel of required) {
  check(`asset ${rel}`, exists(rel), "file missing");
}

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 21 GLB props armed"}`);
process.exit(fail ? 1 : 0);
