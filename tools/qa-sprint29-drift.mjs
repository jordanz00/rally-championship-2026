#!/usr/bin/env node
/**
 * qa-sprint29-drift.mjs — Sprint 29 gate: arcade handbrake power slides.
 *
 * RUN: node tools/qa-sprint29-drift.mjs
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

console.log(`SPRINT 29 HANDBRAKE DRIFT GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const vehicle = read("js/physics/vehicle.js");
const game = read("js/game.js");
const main = read("js/main.js");

check("handbrakeEnter low threshold", /handbrakeEnter:\s*0\.06/.test(config), "handbrakeEnter 0.06");
check("handbrakeBleedMul sustains slide", /handbrakeBleedMul:\s*0\.09/.test(config), "bleed mul 0.09");
check("maxSlideVelHandbrake >= 17", /maxSlideVelHandbrake:\s*17/.test(config), "hb slide cap");
check("handbrakeTorque >= 5000", /handbrakeTorque:\s*5000/.test(config), "rear lock torque");
check("vehicle uses handbrakeEnter", /handbrakeEnter/.test(vehicle) && /hbEnter/.test(vehicle), "hbEnter wired");
check("rear mu dump on hb", /muR \*= lerp\(1, 0\.14/.test(vehicle), "rear breakaway");
check("hb lateral push", /hb > hbEnter && Math\.abs\(vx\) > 4/.test(vehicle), "vy push on hb+steer");
check("hb power slide throttle", /handbrakePowerMul/.test(config) && /hbSlide && this\.throttle/.test(vehicle), "power slide");
check("bleed reduced during hbSlide", /handbrakeBleedMul/.test(vehicle), "bleed mul in integrate");
check("cache bust vehicle.js?v=56", /vehicle\.js\?v=56/.test(game), "game → vehicle v=56");
check("cache bust config.js?v=98", /config\.js\?v=98/.test(game), "game → config v=98");
check("cache bust game.js?v=255", /game\.js\?v=255/.test(main), "main → game v=255");

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 29 handbrake drift armed"}`
);
process.exit(fail ? 1 : 0);
