#!/usr/bin/env node
/**
 * qa-sprint31-drift.mjs — Sprint 31 gate: AAA expert driving + cinema realism.
 *
 * RUN: node tools/qa-sprint31-drift.mjs
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

console.log(`SPRINT 31 AAA EXPERT DRIVING + REALISM GATE  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const vehicle = read("js/physics/vehicle.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const hud = read("js/ui/hud.js");
const post = read("js/gfx/postfx.js");

const tier = Number((config.match(/\btier:\s*(\d+)/) || [])[1] || 0);

check("VISUAL.tier >= 13 (cinema realism)", tier >= 13, `tier is ${tier}`);
check("cinemaRealism armed", /cinemaRealism:\s*true/.test(config));
check("ACES tone mapping", /ACESFilmicToneMapping/.test(read("js/gfx/lighting-rig.js")));
check("postFx armed", /postFx:\s*true/.test(config) && /PhotoRealPost/.test(game));

check("expert trail-brake yaw", /trailBrakeYaw:\s*0\.\d+/.test(config));
check("expert countersteer mul", /expertCounterMul:\s*1\.\d+/.test(config));
check("trail-brake in vehicle", /trailBrakeYaw/.test(vehicle) && /Sprint 31 trail-brake/.test(vehicle));
check("expert counter boost", /expertCounterMul/.test(vehicle));
check("slideIntent pitch-in", /slideIntent/.test(vehicle) && /FyNet/.test(vehicle));
check("counterAuthority", /counterAuthority:\s*[23]\.\d+/.test(config));
check("power slide sustain", /driftBleedMul:\s*0\.0\d+/.test(config));
check("e-brake carry", /handbrakeBleedMul:\s*0\.0\d+/.test(config));
check("arcade slide ceiling", /maxSlideVel:\s*2\d\.\d/.test(config) || /maxSlideVel:\s*1[7-9]\.\d/.test(config));
check("ground spring damped", /groundSpringHz:\s*28/.test(config));
check("grip telemetry", /gripUsed\(\)/.test(vehicle) && /slidePct\(\)/.test(vehicle));
check("HUD grip meter", /cluster-grip-fill/.test(index) && /gripUsed/.test(hud));
check("game passes grip to HUD", /gripUsed/.test(game) && /slidePct/.test(game));
check("drift camera kick", /slidePct\(\)/.test(game) && /_camKickLat/.test(game));

const gameV = (main.match(/game\.js\?v=(\d+)/) || [])[1];
check("cache bust chain", gameV && new RegExp(`main\\.js\\?v=${gameV}`).test(index), `v=${gameV}`);
check("Sprint 33 SLIDE HUD", /cluster-slide/.test(index) && /slideBadge/.test(hud));

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 31 AAA expert driving + realism armed"}`
);
process.exit(fail ? 1 : 0);
