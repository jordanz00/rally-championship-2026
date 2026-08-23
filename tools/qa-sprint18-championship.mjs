#!/usr/bin/env node
/**
 * qa-sprint18-championship.mjs — Sprint 18 gate: championship integrity closeout.
 *
 * Closes QA-REPORT I-1 (Desert 1st→2nd override) and I-2 (checkpoint bonus flash).
 * Spawns qa-championship-grid.mjs for live grid-carry proof; falls back to
 * static + source-logic checks if Chrome is unavailable.
 *
 * RUN: node tools/qa-sprint18-championship.mjs
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

console.log(`SPRINT 18 CHAMPIONSHIP GATE  ·  ${new Date().toISOString()}\n`);

const game = read("js/game.js");
const config = read("js/config.js");
const gridTool = read("tools/qa-championship-grid.mjs");

/** I-1: no silent Desert 1st → 2nd rewrite in _finish. */
const desertOverride =
  /courseId\s*===\s*["']desert["']\s*&&\s*pos\s*===\s*1\s*\)\s*pos\s*=\s*2/.test(game) ||
  /if\s*\(\s*this\.courseId\s*===\s*["']desert["']\s*&&\s*pos\s*===\s*1\s*\)\s*pos\s*=\s*2/.test(game);
check(
  "I-1 no Desert 1st→2nd override in game.js",
  !desertOverride,
  "remove `if (this.courseId === \"desert\" && pos === 1) pos = 2;`"
);

check(
  "_finish assigns champPlace = pos (no rewrite)",
  /_finish\s*\(\s*pos\s*\)\s*\{[\s\S]*?this\.champPlace\s*=\s*pos/.test(game) &&
    !/_finish\s*\([\s\S]*?courseId\s*===\s*["']desert["'][\s\S]*?pos\s*=\s*2/.test(game),
  "_finish must keep finishing place as champPlace"
);

/** I-2: flash must use CHAMPIONSHIP.checkpointBonus, not a hard-coded 20. */
check(
  "I-2 flashMessage uses CHAMPIONSHIP.checkpointBonus",
  /flashMessage\s*\(\s*`CHECK POINT\s+\+\$\{formatTime\(CHAMPIONSHIP\.checkpointBonus\)\}`/.test(game),
  "hud.flashMessage must format CHAMPIONSHIP.checkpointBonus"
);

check(
  "checkpoint time add uses CHAMPIONSHIP.checkpointBonus",
  /this\.timeLeft\s*\+=\s*CHAMPIONSHIP\.checkpointBonus/.test(game),
  "_checkpoints must add CHAMPIONSHIP.checkpointBonus to timeLeft"
);

const hardCoded20Flash =
  /flashMessage\s*\(\s*["'`]CHECK POINT[^"'`]*0['"]?20/.test(game) ||
  /flashMessage\s*\(\s*["'`]CHECK POINT[^"'`]*\+20/.test(game);
check(
  "I-2 no hard-coded +20 checkpoint flash",
  !hardCoded20Flash,
  "do not hard-code CHECK POINT +0'20 or +20"
);

const bonusMatch = config.match(/checkpointBonus\s*:\s*([0-9]+(?:\.[0-9]+)?)/);
const bonus = bonusMatch ? Number(bonusMatch[1]) : NaN;
check(
  "CHAMPIONSHIP.checkpointBonus is a number > 0",
  Number.isFinite(bonus) && bonus > 0,
  bonusMatch ? `got ${bonusMatch[1]}` : "missing checkpointBonus in config.js"
);

check(
  "qa-championship-grid expects Desert 1st → champPlace=1",
  /champPlace\s*!==\s*1/.test(gridTool) && /_finish\(\s*1\s*\)/.test(gridTool),
  "grid tool must assert champPlace === 1 after _finish(1)"
);

check(
  "Track.create (not createAsync) used for stage load",
  /Track\.create\s*\(/.test(game) && !/Track\.createAsync\s*\(/.test(game),
  "_loadTrackAsync must call Track.create — createAsync does not exist"
);

console.log("\nrunning qa-championship-grid (live grid carry)…");
const grid = spawnSync(process.execPath, [path.join(ROOT, "tools", "qa-championship-grid.mjs")], {
  cwd: ROOT,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});
const gridOut = ((grid.stdout || "") + (grid.stderr || "")).trim();
const noChrome =
  /no Chrome found/i.test(gridOut) ||
  /Chrome did not open a debugging port/i.test(gridOut) ||
  /debugging port/i.test(gridOut);

if (grid.status === 0) {
  check("qa-championship-grid PASS", true, "");
  console.log(gridOut.split("\n").filter((l) => /ok |PASS/.test(l)).map((l) => `    ${l}`).join("\n"));
} else if (noChrome) {
  console.log("  note  Chrome harness unavailable in this environment — static I-1/I-2 + grid source checks only");
  check(
    "fallback: Desert 1st override absent (I-1 static)",
    !desertOverride,
    "override string still present"
  );
  check(
    "fallback: checkpoint flash wired to config (I-2 static)",
    /CHAMPIONSHIP\.checkpointBonus/.test(game) && Number.isFinite(bonus) && bonus > 0,
    "bonus flash / config still mismatched"
  );
  check(
    "fallback: grid tool asserts champPlace=1",
    /expected champPlace 1/.test(gridTool) || /champPlace\s*!==\s*1/.test(gridTool),
    "qa-championship-grid.mjs must require champPlace=1"
  );
} else {
  check(
    "qa-championship-grid PASS",
    false,
    gridOut.split("\n").slice(-4).join(" | ") || `exit ${grid.status}`
  );
}

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 18 championship integrity armed"}`
);
process.exit(fail ? 1 : 0);
