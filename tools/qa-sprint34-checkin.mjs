#!/usr/bin/env node
/**
 * qa-sprint34-checkin.mjs — Iteration 34 full studio check-in.
 *
 * Runs Sprint 33 drift + recent gates and verifies cache/doc sync.
 *
 * RUN: node tools/qa-sprint34-checkin.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function run(file) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", file)], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return { pass: r.status === 0, tail: (r.stdout || "").trim().split("\n").slice(-2).join(" · ") };
}

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`SPRINT 34 STUDIO CHECK-IN  ·  ${new Date().toISOString()}\n`);

const main = read("js/main.js");
const index = read("index.html");
const game = read("js/game.js");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("cache bust chain", cacheOk, `main v=${mainV} game v=${gameV}`);
check("title emblem 2026", /sr-year">2026/.test(index), "arcade title year");
check("no Sega on title", !/SEGA|SATURN/.test(index.replace(/ATTRIBUTION/gi, "")), "brand stripped");
check("six-car garage UI", (index.match(/data-car="/g) || []).length >= 6, "select car buttons");
check("codriver boundary", /boundaryHit/.test(read("js/audio/codriver.js")), "Whoa callouts");
check("Sprint 33 SLIDE HUD", /cluster-slide/.test(index) && /slideBadge/.test(read("js/ui/hud.js")), "drift readout");

const gates = [
  "qa-sprint33-drift.mjs",
  "qa-sprint34-preload.mjs",
  "qa-sprint32-pbr.mjs",
  "qa-garage-cars.mjs",
  "qa-sprint31-drift.mjs",
  "qa-sprint30-realism.mjs",
  "qa-static-audit.mjs",
];

console.log("\n── Automated gates ──");
for (const g of gates) {
  process.stdout.write(`  ${g}… `);
  const res = run(g);
  if (res.pass) console.log("PASS");
  else {
    console.log("FAIL");
    console.log(`    ${res.tail}`);
    fail += 1;
  }
}

console.log(
  `\n${fail ? "NO-GO" : "SHIP-CANDIDATE"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 34 check-in PASS"}  ·  play ?v=${mainV || gameV}`
);
process.exit(fail ? 1 : 0);
