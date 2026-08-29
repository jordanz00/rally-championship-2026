#!/usr/bin/env node
/**
 * qa-am3-handling.mjs — Sega Rally 1995 (AM3) handling contracts.
 *
 * Sources: docs/AM3-RESEARCH.md, Sega-16 Behind the Design, Saturn manual.
 * Slide is a tool; surfaces differ; gear-drift works on auto; catch is a switch.
 *
 * RUN: node tools/qa-am3-handling.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`AM3 / SEGA RALLY HANDLING GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const vehicle = read("js/physics/vehicle.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const research = read("docs/AM3-RESEARCH.md");

check("AM3 research brief present", /surface friction changes handling/.test(research));
check("HANDLING cites AM3 / Sakamoto", /AM3 \/ Sakamoto|Sakamoto/.test(config));
check("mud brakeYaw is full slide tool", /id: "mud"[\s\S]{0,280}?brakeYaw:\s*1\.0/.test(config));
check("mud slideHold carries", /id: "mud"[\s\S]{0,320}?slideHold:\s*1\.9/.test(config));
check("tarmac still stops (brakeHold 1)", /id: "tarmac"[\s\S]{0,500}?brakeHold:\s*1\.0/.test(config));
check("gravel brakeYaw > tarmac", /id: "gravel"[\s\S]{0,220}?brakeYaw:\s*0\.[7-9]/.test(config));
check("snappy countersteer", /counterAuthority:\s*[3-9]\.\d+/.test(config));
check("holdable drift bleed", /driftBleedMul:\s*0\.0[12]\d/.test(config));
check("easy power-slide pitch", /powerSlidePitch:\s*2\.\d+/.test(config));
check("trail-brake yaw armed", /trailBrakeYaw:\s*0\.[7-9]/.test(config));
check("low speed understeer (easy control)", /speedUndersteer:\s*0\.001/.test(config));
check("arcade tireYawBlend (not drunk IV)", /tireYawBlend:\s*0\.[234]/.test(config));
check("gear-drift kick knobs", /gearDriftKick:/.test(config) && /gearDriftYaw:/.test(config));
check("brakeSteerYaw scale", /brakeSteerYaw:/.test(config));
check("quick novice steer rack", /steerSpeed:\s*11[89]|steerSpeed:\s*1[2-9]\d/.test(config));
check("_applyGearDriftKick shared", /_applyGearDriftKick\(/.test(vehicle));
check("manual uses gear-drift kick", /_shiftGearbox[\s\S]{0,800}?_applyGearDriftKick/.test(vehicle));
check("auto brake-downshift kicks drift", /_autoShift\(dt\)[\s\S]{0,3200}?_applyGearDriftKick\(this\.steer/.test(vehicle));
check("brake+steer uses brakeSteerYaw", /brakeSteerYaw/.test(vehicle));

const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);
const vehV = Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1] || 0);
const cfgV = Number((game.match(/config\.js\?v=(\d+)/) || [])[1] || 0);
check("cache-bust ≥527", cacheOk && Number(gameV) >= 527, `game=${gameV} main=${mainV}`);
check("vehicle.js cache ≥113", vehV >= 113, `v=${vehV}`);
check("config.js cache ≥162", cfgV >= 162, `v=${cfgV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "AM3 handling armed"}`);
process.exit(fail ? 1 : 0);
