#!/usr/bin/env node
/**
 * qa-sprint13-visual.mjs — Sprint 13 gate: visual tier 3 + horizon haze + terrain grain.
 *
 * RUN: node tools/qa-sprint13-visual.mjs
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

/** Extract a top-level LIGHTING stage block from config source. */
function lightingBlock(config, key) {
  const re = new RegExp(`${key}:\\s*\\{([\\s\\S]*?)\\n  \\},`, "m");
  const m = config.match(re);
  return m ? m[1] : "";
}

console.log(`SPRINT 13 VISUAL GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const tierMatch = config.match(/\btier:\s*(\d+)/);
const tier = tierMatch ? Number(tierMatch[1]) : 0;
check("VISUAL.tier >= 3", tier >= 3, tierMatch ? `tier is ${tier}, need >= 3` : "missing VISUAL.tier");

const stages = ["desert", "forest", "mountain", "lakeside", "title"];
for (const stage of stages) {
  const block = lightingBlock(config, stage);
  const hasHorizon = /horizonGlow|horizonStrength/.test(block);
  check(`LIGHTING.${stage} horizon haze`, hasHorizon, "add horizonGlow or horizonStrength");
}

const sky = read("js/sky.js");
check(
  "sky.js horizon glow shader",
  /uHorizonGlow|horizon\s+glow/i.test(sky),
  "add uHorizonGlow uniform or horizon glow in FRAG shader"
);

const track = read("js/tracks/track.js");
const albedoFn = track.match(/function paintLandAlbedo[\s\S]*?\n\}/);
const albedoBody = albedoFn ? albedoFn[0] : "";
check(
  "paintLandAlbedo grain (pebble/ripple/scree)",
  /pebble|ripple|scree/i.test(albedoBody),
  "add pebble, ripple, or scree patterns in paintLandAlbedo"
);
check(
  "roadAoFor wired",
  /function roadAoFor/.test(track) && /roadAoFor\(b\.id\)/.test(track),
  "wire roadAoFor into worldRoadMaterial"
);

console.log("\nrunning qa-realistic-visual (Sprint 12 carry-forward)…");
const prev = spawnSync(process.execPath, [path.join(ROOT, "tools", "qa-realistic-visual.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const prevOut = ((prev.stdout || "") + (prev.stderr || "")).trim();
check("qa-realistic-visual still passes", prev.status === 0, prevOut.split("\n").slice(-1)[0] || "exit non-zero");

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 13 visual tier armed"}`);
process.exit(fail ? 1 : 0);
