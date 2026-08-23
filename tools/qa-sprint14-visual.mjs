#!/usr/bin/env node
/**
 * qa-sprint14-visual.mjs — Sprint 14 gate: tier 4 aerial perspective + hero landmarks + water.
 *
 * RUN: node tools/qa-sprint14-visual.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

console.log(`SPRINT 14 VISUAL GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const tierMatch = config.match(/\btier:\s*(\d+)/);
const tier = tierMatch ? Number(tierMatch[1]) : 0;
check("VISUAL.tier >= 4", tier >= 4, tierMatch ? `tier is ${tier}, need >= 4` : "missing VISUAL.tier");
check("VISUAL.aerialPerspective", /aerialPerspective:\s*true/.test(config), "set aerialPerspective: true");
check("VISUAL.heroLandmarks", /heroLandmarks:\s*true/.test(config), "set heroLandmarks: true");
check("VISUAL.waterReflection", /waterReflection:\s*true/.test(config), "set waterReflection: true");

const track = read("js/tracks/track.js");
check(
  "aerial perspective on land tiles",
  /_applyAerialPerspective/.test(track) && /VISUAL\.aerialPerspective/.test(track),
  "wire _applyAerialPerspective in _addLandTile"
);
check(
  "hero landmarks per stage",
  /_addHeroLandmarks/.test(track) &&
    /_addDesertHeroLandmark/.test(track) &&
    /_addForestHeroLandmark/.test(track) &&
    /_addLakesideHeroLandmark/.test(track),
  "add _addHeroLandmarks and desert/forest/lakeside heroes"
);

const pbr = read("js/gfx/pbr.js");
check(
  "tier-4 water ripple + env",
  /water-ripple-t4/.test(pbr) && /tier4/.test(pbr) && /envMapIntensity:\s*tier4/.test(pbr),
  "enhance water() for tier >= 4"
);

console.log("\nrunning qa-sprint13-visual (carry-forward)…");
const s13 = spawnSync(process.execPath, [path.join(ROOT, "tools", "qa-sprint13-visual.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const s13Out = ((s13.stdout || "") + (s13.stderr || "")).trim();
check("qa-sprint13-visual still passes", s13.status === 0, s13Out.split("\n").slice(-1)[0] || "exit non-zero");

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 14 visual tier armed"}`);
process.exit(fail ? 1 : 0);
