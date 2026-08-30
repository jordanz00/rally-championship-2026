#!/usr/bin/env node
/**
 * qa-sprint73-gta-phys.mjs — GTA IV weight + Sega Rally recoverability.
 *
 * Player moment: the car has mass. Brake unloads the rear; throttle pushes;
 * lift-off brings the tail; high speed understeers; hairpins stay easy.
 *
 * RUN: node tools/qa-sprint73-gta-phys.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function num(src, key) {
  const m = src.match(new RegExp(key + ":\\s*([0-9.]+)"));
  return m ? Number(m[1]) : NaN;
}

function importV(src, file) {
  const m = src.match(new RegExp(file.replace(/\./g, "\\.") + "\\?v=(\\d+)"));
  return m ? Number(m[1]) : 0;
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`SPRINT 73 GTA IV WEIGHT  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const vehicle = read("js/physics/vehicle.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("weightTransferMul", num(config, "weightTransferMul") >= 1.9, `= ${num(config, "weightTransferMul")}`);
check("speedUndersteer", /speedUndersteer:\s*0\.00\d+/.test(config));
check("liftOffYaw", /liftOffYaw:\s*0\.\d+/.test(config));
check("limitMush", /limitMush:\s*0\.\d+/.test(config));
check("bodyRollMax", num(config, "bodyRollMax") >= 0.1 && num(config, "bodyRollMax") <= 0.13, `= ${num(config, "bodyRollMax")}`);
check("brakeDive + accelSquat are 0 (no visual drive pitch)", /brakeDive:\s*0\b/.test(config) && /accelSquat:\s*0\b/.test(config));
check("attitude does not pitch from filtered _ax", /squatTarget = 0/.test(vehicle));
check("weighted rack (no digital snap)", /Weighted rack/.test(vehicle) && !/steerIn\) >= 0\.92/.test(vehicle));
check("softLimit helper", /function softLimit/.test(vehicle));
check("load-scaled axle µ", /loadFRatio/.test(vehicle) && /rearLight/.test(vehicle));
check("lift-off oversteer", /liftOffYaw/.test(vehicle) && /liftAmt/.test(vehicle));
check("mushy yaw cap", /softLimit\(rWant/.test(vehicle));
check("speed-mass yawFollow", /speedMass/.test(vehicle));
check("body roll from HANDLING", /bodyRollMax/.test(vehicle) && /bodyRollMul/.test(vehicle));
check("camera roll follow (hint, not swing)", num(config, "rollFollow") >= 0.18 && num(config, "rollFollow") <= 0.28, `= ${num(config, "rollFollow")}`);
check(
  "camera speed FOV punch",
  num(config, "speedFov") >= 0.26 && num(config, "maxFovPunch") >= 16,
  `fov=${num(config, "speedFov")} punch=${num(config, "maxFovPunch")}`
);
check("Celica rack has weight", num(config, "steerSpeed") >= 80 && num(config, "steerSpeed") <= 96, `= ${num(config, "steerSpeed")}`);
check("Stratos still snappier", /steerSpeed:\s*122/.test(config));
check("arcade slide still a tool", /counterAuthority:\s*2\.\d+/.test(config) && /handbrakeYawKick:\s*[3-9]\./.test(config));
check("TIRE_PLANT unchanged", /const TIRE_PLANT\s*=\s*0\.014/.test(vehicle));
check("config import v>=135", importV(vehicle, "config.js") >= 135 && importV(game, "config.js") >= 135);
check("vehicle.js?v>=80", importV(game, "vehicle.js") >= 80 && importV(ai, "vehicle.js") >= 80);
check("cache-bust chain", cacheOk && Number(gameV) >= 390, `main=${mainV} game=${gameV}`);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "GTA IV weight + arcade recoverability armed"}`
);
process.exit(fail ? 1 : 0);
