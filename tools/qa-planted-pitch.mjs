#!/usr/bin/env node
/**
 * qa-planted-pitch.mjs — cars stay road-planted; no nose-up tilt on flat ground.
 *
 * RUN: node tools/qa-planted-pitch.mjs
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

console.log(`PLANTED PITCH  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const vehicle = read("js/physics/vehicle.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const handling = (config.match(/export const HANDLING = \{([\s\S]*?)\n\};/) || [])[1] || "";
const dive = Number((handling.match(/brakeDive:\s*([\d.]+)/) || [])[1]);
const squat = Number((handling.match(/accelSquat:\s*([\d.]+)/) || [])[1]);

check("visual brakeDive is 0", dive === 0, `brakeDive=${dive}`);
check("visual accelSquat is 0", squat === 0, `accelSquat=${squat}`);
check(
  "attitude does not apply drive squat from _ax",
  /squatTarget = 0/.test(vehicle) && !/squatTarget = clamp\(ax </.test(vehicle),
  "throttle must not pitch the mesh nose-up"
);
check(
  "land squash does not subtract from mesh pitch",
  /wantPitch = roadPitch \+ this\._landPitchOff;/.test(vehicle) &&
    !/wantPitch = roadPitch \+ this\._landPitchOff - this\._landSquash/.test(vehicle) &&
    !/landPitchOff - this\._landSquash/.test(vehicle),
  "−landSquash tipped the nose UP and floated the fronts"
);
check(
  "flat ribbon hard-levels pitch to 0",
  /VIS_PITCH_DEADZONE = 0\.028/.test(vehicle) &&
    /Flat ribbon: hard-level/.test(vehicle) &&
    /this\.pitch = 0;/.test(vehicle)
);
check(
  "player + rivals share drawPose pitch",
  /rotation\.set\(d\.pitch, d\.yaw, d\.roll/.test(game) &&
    /rotation\.set\(d\.pitch, d\.yaw, d\.roll/.test(read("js/ai.js"))
);
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 544 && Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 118,
  `main=${mainV} game=${gameV}`
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "cars plant flat on the road"}`);
process.exit(fail ? 1 : 0);
