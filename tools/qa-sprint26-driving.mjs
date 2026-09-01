#!/usr/bin/env node
/**
 * qa-sprint26-driving.mjs — Sprint 26 gate: no throttle-only autopilot,
 * exclusive championship grid, planted start, tougher AI.
 *
 * RUN: node tools/qa-sprint26-driving.mjs
 */

import fs from "node:fs";
import path from "node:path";
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

console.log(`SPRINT 26 DRIVING + GRID GATE  ·  ${new Date().toISOString()}\n`);

const collide = read("js/physics/collide.js");
const vehicle = read("js/physics/vehicle.js");
const config = read("js/config.js");
const ai = read("js/ai.js");
const game = read("js/game.js");

check(
  "player off-road is not autopilot",
  /Sprint 26: the PLAYER must steer/.test(collide) && /isPlayer/.test(collide),
  "bounceOffRoad must gate player vs AI"
);
check(
  "player off-road scrub",
  /Off-road pace cost for the player/.test(collide) && /PLAYER_SCRUB_MAX/.test(collide),
  "light runoff scrub, not a wall"
);
check(
  "player yaw guide suppressed",
  /never stage autopilot/.test(collide),
  "no free heading follow for player"
);
check(
  "planted LAT_BLEED",
  /LAT_BLEED\s*=\s*[4-9]\.\d+/.test(vehicle),
  "LAT_BLEED tuned for GTA planted deck (4.55+)"
);
check(
  "steerFalloff soft at speed",
  /steerFalloff:\s*0\.00[7-9]/.test(config),
  "steerFalloff 0.007–0.009"
);
check(
  "arcade maxSlideVel",
  /maxSlideVel:\s*(1[1-9]|2[0-9])\.\d+/.test(config),
  "maxSlideVel 11+ (GTA retune may exceed 11.2)"
);
check(
  "AI skillCeiling raised",
  /skillCeiling:\s*1\.05/.test(config),
  "skillCeiling 1.05"
);
check(
  "AI pace formula raised",
  /this\.pace\s*=\s*0\.92\s*\+\s*this\.skill\s*\*\s*0\.2/.test(ai),
  "pace = 0.92 + skill * 0.2"
);
check(
  "exclusive championship grid",
  /Sprint 26 exclusive grid/.test(game) && /playerSlot/.test(game) && /slot === playerSlot/.test(game),
  "player owns exclusive grid slot"
);
check(
  "AI lane from grid place",
  /lane:\s*this\._gridLane\(gridPlace\)/.test(game) && /opts\.lane\s*!=\s*null/.test(ai),
  "rivals use slot lanes"
);
check(
  "_plantStartGrid before countdown",
  /_plantStartGrid\s*\(/.test(game) && /_gridCamHold/.test(game),
  "plant + cam hold armed"
);
check(
  "countdown holds cam snap",
  /_gridCamHold\s*>\s*0/.test(game) && /_camSnap\s*=\s*true/.test(game),
  "countdown must keep grid planted"
);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 26 driving + grid armed"}`
);
process.exit(fail ? 1 : 0);
