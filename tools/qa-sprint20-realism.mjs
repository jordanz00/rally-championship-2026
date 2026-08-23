#!/usr/bin/env node
/**
 * qa-sprint20-realism.mjs — Sprint 20 gate: highly realistic level design (tier 7).
 *
 * RUN: node tools/qa-sprint20-realism.mjs
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

console.log(`SPRINT 20 REALISM GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const track = read("js/tracks/track.js");
const pbr = read("js/gfx/pbr.js");

const tier = Number((config.match(/\btier:\s*(\d+)/) || [])[1] || 0);
check("VISUAL.tier >= 7", tier >= 7, `tier is ${tier}`);
check("terrainRealism armed", /terrainRealism:\s*true/.test(config), "set terrainRealism: true");
check(
  "STREAM.terrainTileSegs denser",
  /terrainTileSegs:\s*2[4-9]/.test(config) || /terrainTileSegs:\s*[3-9]\d/.test(config),
  "segs should be >= 24 for tier-7 mesh density"
);
check(
  "verge detail pass present",
  /_addRealisticVergeDetail/.test(track) && /_addDesertVergeDetail/.test(track),
  "add tier-7 verge helpers and call from scenery"
);
check(
  "biome realism helpers",
  /_terrainRealismOn/.test(track) && (/_biomeHeight/.test(track) || /biome/.test(track)),
  "gate richer biome height/tint behind terrain realism"
);
check(
  "worldEnvIntensity lifted",
  /worldEnvIntensity:\s*0\.(4[8-9]|5\d*|5)\b/.test(config) || /worldEnvIntensity:\s*0\.5\b/.test(config),
  "worldEnvIntensity ~0.48–0.55 for photographic IBL"
);
check(
  "WORLD_ENV tier 7 bump",
  /tier\s*>=\s*7[\s\S]{0,80}1\.28|1\.28[\s\S]{0,80}tier/.test(pbr) || /1\.28/.test(pbr),
  "pbr WORLD_ENV should bump at tier >= 7"
);
check(
  "no mountain mass reintroduced",
  !/_addMountainMass\s*\(/.test(track),
  "do not re-add opaque mountain mass boxes"
);

console.log("\nrunning qa-sprint17-visual (carry-forward)…");
const s17 = spawnSync(process.execPath, [path.join(ROOT, "tools", "qa-sprint17-visual.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
check("qa-sprint17-visual still passes", s17.status === 0, (s17.stdout || s17.stderr || "").split("\n").slice(-2).join(" "));

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 20 level realism armed"}`);
process.exit(fail ? 1 : 0);
