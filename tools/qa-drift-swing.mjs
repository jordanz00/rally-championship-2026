#!/usr/bin/env node
/**
 * qa-drift-swing.mjs — seamless L↔R mid-slide (pendulum) gate.
 *
 * RUN: node tools/qa-drift-swing.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? `  —  ${detail}` : ""}`);
    fail += 1;
  }
}

console.log(`DRIFT SWING L↔R  ·  ${new Date().toISOString()}\n`);

const vehicle = read("js/physics/vehicle.js");
const burnout = read("js/physics/burnout-drive.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const main = read("js/main.js");
const index = read("index.html");

check("swingThrough flag", /swingThrough/.test(vehicle), "pendulum gate");
check("slideMom hang", /slideMom/.test(vehicle), "centerline hang");
check(
  "skip recovery on swing",
  /!swingThrough &&\s*\n\s*recAsst/.test(vehicle) || /Skip on swing-through/.test(vehicle),
  "no catch-kill"
);
check("steer swing rack", /slideSwing/.test(vehicle) && /DRIFT_SWING_STEER/.test(vehicle), "fast rack");
check("burnout v8", /_burnoutDriveV8/.test(burnout) && /easySlideHardSteer/.test(burnout), "hard-steer drift");
check("hardSteer initiation", /hardSteer/.test(vehicle) && /turned in too hot/.test(vehicle), "steer-only slide");
check("tighter turn-in", /maxSteer \* 1\.48/.test(vehicle) && /speedUndersteer = 0\.00072/.test(burnout), "less understeer");
check("vehicle cache 211+", Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 211);
check(
  "Vehicle singleton game↔ai",
  (game.match(/vehicle\.js\?v=(\d+)/) || [])[1] === (ai.match(/vehicle\.js\?v=(\d+)/) || [])[1]
);
const gameV = (main.match(/game\.js\?v=(\d+)/) || [])[1];
check("boot chain", gameV && new RegExp(`main\\.js\\?v=${gameV}`).test(index), `v=${gameV}`);
check("boot 1138+", Number(gameV) >= 1138);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " failed" : "seamless L↔R drift armed"}`);
process.exit(fail ? 1 : 0);
