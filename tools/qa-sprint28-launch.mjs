#!/usr/bin/env node
/**
 * qa-sprint28-launch.mjs — Sprint 28 gate: dead-stop launch + top-end punch.
 *
 * RUN: node tools/qa-sprint28-launch.mjs
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

console.log(`SPRINT 28 LAUNCH + REALISM GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const vehicle = read("js/physics/vehicle.js");
const index = read("index.html");
const main = read("js/main.js");
const game = read("js/game.js");

const peak = config.match(/peakPowerKw:\s*(\d+)/);
check(
  "peakPowerKw >= 260",
  peak && Number(peak[1]) >= 260,
  peak ? `got ${peak[1]}` : "missing peakPowerKw"
);

const vmax = config.match(/maxSpeedKmh:\s*(\d+)/);
check(
  "Celica maxSpeedKmh >= 245",
  vmax && Number(vmax[1]) >= 245,
  vmax ? `got ${vmax[1]}` : "missing maxSpeedKmh"
);

const launch = config.match(/launchBoost:\s*([\d.]+)/);
check(
  "launchBoost >= 1.3",
  launch && Number(launch[1]) >= 1.3,
  launch ? `got ${launch[1]}` : "missing launchBoost"
);

check(
  "launchFadeKmh armed",
  /launchFadeKmh:\s*[6-9]\d/.test(config),
  "launchFadeKmh ~70–90"
);

check(
  "shorter 1st gear",
  /gears:\s*\[\s*0,\s*3\.[45]/.test(config),
  "1st ratio >= 3.4"
);

check(
  "finalDrive raised",
  /finalDrive:\s*4\.[3-9]/.test(config),
  "finalDrive >= 4.3"
);

check(
  "VISUAL.tier >= 12",
  /tier:\s*1[2-9]/.test(config),
  "tier: 12+"
);

check(
  "vehicle applies launchBoost",
  /HANDLING\.launchBoost/.test(vehicle) && /launchFadeKmh/.test(vehicle),
  "wire launchBoost into driveline"
);

check(
  "low-RPM torque meat",
  /205 \+ \(r - 800\) \* 0\.068/.test(vehicle) || /Sprint 28: fatter low-RPM/.test(vehicle),
  "engineTorque low-end bump"
);

check(
  "low-speed drive asymptote",
  /lerp\(1\.34,\s*0\.68/.test(vehicle),
  "tqDrive low-speed lerp 1.34"
);

check(
  "accel squat not driven by _ax",
  /Accel\/brake used to add a sprung squat/.test(vehicle) &&
    !/squatTarget = clamp\(-this\._ax/.test(vehicle),
  "visual pitch must not chase longitudinal accel"
);

check(
  "visual pitch is deadzoned axle follow, not raw slope",
  /_updateVisPitch/.test(vehicle) &&
    /VIS_PITCH_DEADZONE/.test(vehicle) &&
    /want = this\._visPitch/.test(vehicle),
  "mesh pitch must follow _visPitch, not raw _roadPitch"
);

check(
  "chassis long-accel is filtered before vx integrate",
  /AX_DRIVE_RATE/.test(vehicle) && /this\._axDrive \+= /.test(vehicle),
  "player vx must not integrate raw Pacejka Fx"
);

check(
  "heavier wheel inertia vs launch hop",
  /const WHEEL_I = 6\.[2-9]/.test(vehicle),
  "WHEEL_I >= 6.2"
);

check(
  "kappa relaxation kills wheel hop",
  /RELAX_KAPPA/.test(vehicle) && /this\._kappaF/.test(vehicle),
  "longitudinal slip must lag like slip angle"
);

check(
  "smooth traction cut (no bang-bang TC)",
  /over \* over \* 48/.test(vehicle) && !/\(kappaR - kSoft\) \* 8/.test(vehicle),
  "TC must not use linear gain 8"
);

check(
  "_ax blended once per frame",
  /axSum \+= next\.axTire/.test(vehicle) && /Blending once/.test(vehicle),
  "load transfer must not update inside each tire substep"
);

check(
  "chase cam locks XZ on medium so hull cannot bounce in frame",
  /mode\.id !== "far"/.test(game) && /this\._camPos\.x = this\._camTarget\.x/.test(game),
  "medium chase must snap XZ to the live car"
);

// Live graph after Sprint 27/28 stack — assert floor versions, not pin exact.
const mainV = index.match(/main\.js\?v=(\d+)/);
const gameV = main.match(/game\.js\?v=(\d+)/);
const vehV = game.match(/vehicle\.js\?v=(\d+)/);
const cfgV = game.match(/config\.js\?v=(\d+)/);
check(
  "cache bust main.js?v>=343",
  mainV && Number(mainV[1]) >= 343,
  mainV ? `got main.js?v=${mainV[1]}` : "missing"
);
check(
  "cache bust game.js?v>=343",
  gameV && Number(gameV[1]) >= 343,
  gameV ? `got game.js?v=${gameV[1]}` : "missing"
);
check(
  "cache bust vehicle.js?v>=71",
  vehV && Number(vehV[1]) >= 71,
  vehV ? `got vehicle.js?v=${vehV[1]}` : "missing"
);
check(
  "cache bust config.js?v>=96",
  cfgV && Number(cfgV[1]) >= 96,
  cfgV ? `got config.js?v=${cfgV[1]}` : "missing"
);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 28 launch + realism armed"}`
);
process.exit(fail ? 1 : 0);
