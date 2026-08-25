#!/usr/bin/env node
/**
 * qa-sprint71-garage.mjs — authentic Group A garage + arcade power-slide overhaul.
 *
 * RUN: node tools/qa-sprint71-garage.mjs
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
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`SPRINT 71 AUTHENTIC GARAGE + ARCADE SLIDE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const vehicle = read("js/physics/vehicle.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const celica = read("js/cars/celica.js");
const effects = read("js/effects.js");
const skid = read("js/audio/skid.js");

const cars = [...config.matchAll(/id:\s*"(celica|delta|stratos|jaguar|focus|accord)"/g)].map((m) => m[1]);
check("CARS is Celica / Delta / Stratos", cars.join(",") === "celica,delta,stratos", cars.join(","));
check("no E-Type / Focus ST / Accord buttons", !/data-car="jaguar"/.test(index) && !/data-car="focus"/.test(index) && !/data-car="accord"/.test(index));
check("three SELECT CAR chassis", (index.match(/data-car="/g) || []).length === 3);
check("GARAGE has no road cars", !/jaguar-etype/.test(celica) && !/focus-st/.test(celica) && !/accord-sport/.test(celica));

check("Stratos is the loose RWD slide car", /driftMul:\s*1\.16/.test(config) && /drivetrain:\s*"2wd"/.test(config));
check("Delta snappier than Celica", /delta:[\s\S]*?driftMul:\s*1\.08/.test(config));
check("sand / dirt / gravel are loose", /driftEase:\s*1\.52/.test(config) && /driftEase:\s*1\.34/.test(config) && /driftEase:\s*1\.42/.test(config));
check("tarmac still planted", /driftEase:\s*0\.82/.test(config) && /brakeHold:\s*1\.0/.test(config));
check("slide ceiling raised", /maxSlideVel:\s*20\.4/.test(config));
check("handbrake snap", /handbrakeYawKick:\s*3\.72/.test(config) && /handbrakePowerMul:\s*2\.48/.test(config));
check("throttle carry", /driftBleedMul:\s*0\.034/.test(config) && /powerSlidePitch:\s*1\.82/.test(config));

check("easier slideIntent", /ease >= 0\.84/.test(vehicle) && /this\.throttle > 0\.045/.test(vehicle));
check("slide yaw follow holds attitude", /lerp\(32, 15, slipAmt\)/.test(vehicle));
check("throttle bleed stays low", /bleedMul \*= 0\.1/.test(vehicle));
check("chase looks into the slide", /CAMERA\.slideLook/.test(game) && /slideCamOut/.test(config));
check("player dust punches in a slide", /vehicle\.ai \? 0\.78 : 2\.15/.test(effects));
check("skid audible earlier", /yaw > 0\.09/.test(skid));

const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);
check("cache bust chain", cacheOk && Number(gameV) >= 385, `main=${mainV} game=${gameV}`);
check("config import bumped", /config\.js\?v=134/.test(game) && /config\.js\?v=134/.test(vehicle));
check("vehicle import bumped", /vehicle\.js\?v=77/.test(game));

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 71 authentic garage + arcade slide armed"}`);
process.exit(fail ? 1 : 0);
