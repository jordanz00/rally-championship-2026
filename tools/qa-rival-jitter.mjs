#!/usr/bin/env node
/**
 * Rival mesh must not thrash left/right from repeated pass shoves.
 *
 * RUN: node tools/qa-rival-jitter.mjs
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
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`RIVAL JITTER GATE  ·  ${new Date().toISOString()}\n`);

const collide = read("js/physics/collide.js");
const game = read("js/game.js");
const vehicle = read("js/physics/vehicle.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check(
  "AI-AI lateral pass is gated on _aiPassT",
  /if \(\(rear\._aiPassT \|\| 0\) <= 0\.04\)/.test(collide) &&
    /AI_PASS_LATERAL/.test(collide)
);
check(
  "player-rival sidestep is gated on _aiPassT",
  /if \(\(rival\._aiPassT \|\| 0\) <= 0\.04\)/.test(collide) &&
    /PLAYER_RIVAL_SIDESTEP/.test(collide)
);
check(
  "pack meshes plant at alpha 1 (no leftover interp stutter)",
  /o\.syncMesh\(1\)/.test(game) && /_syncPlayerMesh\(1\)/.test(game) &&
    !/o\.syncMesh\(alpha\)/.test(game)
);
check(
  "AI skips road micro chatter",
  /!this\.lowDetail/.test(vehicle) && /roadChatter/.test(vehicle)
);
check(
  "cheap axle filter is soft (≤0.18)",
  /const k = 0\.1[0-8]/.test(vehicle) || /const k = 0\.0\d/.test(vehicle)
);
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 529 && Number(mainV) >= 529,
  `main=${mainV} game=${gameV}`
);
check(
  "collide + vehicle imports bumped",
  Number((game.match(/collide\.js\?v=(\d+)/) || [])[1]) >= 46 &&
    Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 114
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "rival thrash guards armed"}`);
process.exit(fail ? 1 : 0);
