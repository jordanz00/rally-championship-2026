#!/usr/bin/env node
/**
 * qa-sprint33-drift.mjs — Sprint 33 gate: fun arcade power-slide entry + carry.
 *
 * Arcade drift model (AM3 + rally e-brake technique):
 *   1) Initiate — e-brake locks rears / throttle dumps rear µ / brakeYaw on loose
 *   2) Transition — yaw + lateral velocity build attitude
 *   3) Sustain — throttle holds the slide (low bleed); countersteer aims it
 *   4) Exit — release e-brake, countersteer, drive out
 *
 * RUN: node tools/qa-sprint33-drift.mjs
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

console.log(`SPRINT 33 ARCADE POWER-SLIDE GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const vehicle = read("js/physics/vehicle.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const hud = read("js/ui/hud.js");

check("LAT_BLEED present", /LAT_BLEED\s*=\s*4\.55/.test(vehicle), "baseline bleed");
check("slideIntent pitch-in", /slideIntent/.test(vehicle) && /FyNet/.test(vehicle), "throttle entry");
check("powerSlide without prior vy", /slideIntent \|\|/.test(vehicle), "no chicken-egg");
check("e-brake rear µ dump", /handbrakeRearMu/.test(config) && /hbRearMu/.test(vehicle), "lock rears");
check("powerSlidePitch", /powerSlidePitch:\s*1\.\d+/.test(config), "throttle pitch-in");
check("maxSlideVel raised", /maxSlideVel:\s*(1[7-9]|2\d)\.\d/.test(config), "slide ceiling");
check("hb yaw kick strong", /handbrakeYawKick:\s*[3-9]\.\d+/.test(config), "initiation snap");
check("hb power mul strong", /handbrakePowerMul:\s*[2-9]\.\d+/.test(config), "power oversteer");
check("hb bleed low", /handbrakeBleedMul:\s*0\.0[0-3]\d/.test(config), "long e-brake carry");
check("driftBleedMul low", /driftBleedMul:\s*0\.0[0-4]\d/.test(config), "throttle carry");
check("slideGripMul slippery", /slideGripMul:\s*0\.[12]\d/.test(config), "angle grip");
check("sand loose", /driftEase:\s*1\.[4-9]\d/.test(config), "sand pitch-in");
check("gravel brakeYaw", /brakeYaw:\s*0\.[6-9]\d/.test(config), "gravel brake-to-slide");
check("tc dumps in drift", /tcMul = slideIntent \|\| hb > hbEnter \? 0\.12/.test(vehicle), "wheelspin hold");
check("player ground spring", /groundPlantRate:\s*46/.test(config), "direct deck plant");
check("player chatter scale", /roadChatterScale:\s*0\.04/.test(config), "minimal vertical chatter");
check("Sprint 33 SLIDE HUD", /cluster-slide/.test(index) && /slideBadge/.test(hud), "drift badge");
const gameV = (main.match(/game\.js\?v=(\d+)/) || [])[1];
check("cache bust chain", gameV && new RegExp(`main\\.js\\?v=${gameV}`).test(index), `v=${gameV}`);
check("config import", /config\.js\?v=\d+/.test(game), "config cache bust");
check("cam blend timer", /_camBlendT/.test(game), "seamless C-key blend");
check("title track cache", /_trackCache/.test(game) && /_pumpPreloadQueue/.test(game), "background stage cache");
check("instant race when hot", /_isTrackReady\(courseId\)/.test(game), "skip loading when preloaded");

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 33 arcade power-slide armed"}`
);
process.exit(fail ? 1 : 0);
