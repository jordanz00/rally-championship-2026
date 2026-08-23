#!/usr/bin/env node
/**
 * qa-sprint19-speed.mjs — Sprint 19 gate: arcade sense of speed.
 *
 * RUN: node tools/qa-sprint19-speed.mjs
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

console.log(`SPRINT 19 SPEED GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const vehicle = read("js/physics/vehicle.js");
const game = read("js/game.js");
const audio = read("js/audio/engine.js");

const peak = config.match(/peakPowerKw:\s*(\d+)/);
check(
  "peakPowerKw >= 220",
  peak && Number(peak[1]) >= 220,
  peak ? `got ${peak[1]}` : "missing peakPowerKw"
);

const vmax = config.match(/maxSpeedKmh:\s*(\d+)/);
check(
  "Celica maxSpeedKmh >= 220",
  vmax && Number(vmax[1]) >= 220,
  vmax ? `got ${vmax[1]}` : "missing maxSpeedKmh"
);

check(
  "engineTorque scales by peakPowerKw",
  /function engineTorque\s*\([^)]*peakPowerKw/.test(vehicle) &&
    /peakPowerKw/.test(vehicle) &&
    /BASE_PEAK_KW/.test(vehicle),
  "wire peakPowerKw into engineTorque"
);

check(
  "CAMERA speedFov punch armed",
  /speedFov:\s*0\.(1|2)/.test(config) && /maxFovPunch:\s*1[2-9]/.test(config),
  "raise speedFov and maxFovPunch for Model-2 rush"
);

check(
  "medium chase closer / wider FOV",
  /id:\s*["']medium["'][\s\S]{0,220}fov:\s*6[2-9]/.test(config),
  "medium view fov should be ~62–69"
);

check(
  "cabin wind opens earlier",
  /\(spd\s*-\s*6\)\s*\/\s*28/.test(audio) || /spd\s*-\s*6/.test(audio),
  "wind gain curve should open by ~120 km/h"
);

check(
  "chase heightDrop scales with speed",
  /heightDrop[\s\S]{0,80}0\.015/.test(game) || /p\.speed\s*\*\s*0\.015/.test(game),
  "heightDrop should drop the chase cam as speed builds"
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 19 speed feel armed"}`);
process.exit(fail ? 1 : 0);
