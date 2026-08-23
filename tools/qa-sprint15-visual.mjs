#!/usr/bin/env node
/**
 * qa-sprint15-visual.mjs — Sprint 15 gate: tier 5 signage + contact shadows + water scroll.
 *
 * RUN: node tools/qa-sprint15-visual.mjs
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

console.log(`SPRINT 15 VISUAL GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const tierMatch = config.match(/\btier:\s*(\d+)/);
const tier = tierMatch ? Number(tierMatch[1]) : 0;
check("VISUAL.tier >= 5", tier >= 5, tierMatch ? `tier is ${tier}, need >= 5` : "missing VISUAL.tier");
check("VISUAL.tracksideSignage", /tracksideSignage:\s*true/.test(config), "set tracksideSignage: true");
check("VISUAL.contactShadowBoost", /contactShadowBoost:\s*true/.test(config), "set contactShadowBoost: true");
check("VISUAL.waterScroll", /waterScroll:\s*true/.test(config), "set waterScroll: true");

const track = read("js/tracks/track.js");
check(
  "trackside rally boards",
  /_addTracksideSignage/.test(track) && /stageBoardTexture/.test(track),
  "add _addTracksideSignage and stageBoardTexture"
);
check(
  "contact shadow helpers",
  /_pushContactShadow/.test(track) && /_contactShadowScale/.test(track),
  "wire contact shadow boost under props"
);
check(
  "water UV scroll",
  /_tickWaterScroll/.test(track) && /_waterMeshes/.test(track),
  "animate lake ripple map in track.update"
);

const trees = read("js/tracks/trees.js");
check(
  "tier-5 shadow material",
  /SHADOW_MAT_T5/.test(trees) && /contactShadowBoost/.test(trees),
  "darker contact shadows at tier 5"
);

console.log("\nrunning qa-sprint14-visual (carry-forward)…");
const s14 = spawnSync(process.execPath, [path.join(ROOT, "tools", "qa-sprint14-visual.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const s14Out = ((s14.stdout || "") + (s14.stderr || "")).trim();
check("qa-sprint14-visual still passes", s14.status === 0, s14Out.split("\n").slice(-1)[0] || "exit non-zero");

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 15 visual tier armed"}`);
process.exit(fail ? 1 : 0);
