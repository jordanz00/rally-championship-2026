#!/usr/bin/env node
/**
 * qa-sprint22-runoff.mjs — Sprint 22 gate: soft off-road + living crowds.
 *
 * RUN: node tools/qa-sprint22-runoff.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

console.log(`SPRINT 22 RUNOFF + CROWD GATE  ·  ${new Date().toISOString()}\n`);

const collide = read("js/physics/collide.js");
const vehicle = read("js/physics/vehicle.js");
const track = read("js/tracks/track.js");
const crowdVis = read("js/tracks/crowd.js");
const crowdAud = read("js/audio/crowd.js");
const engine = read("js/audio/engine.js");
const game = read("js/game.js");

check("OFF_RESET defined", /OFF_RESET\s*=\s*24/.test(collide), "set OFF_RESET = 24");
check("bounceOffRoad takes track", /export function bounceOffRoad\(v, q, track/.test(collide), "signature bounceOffRoad(v,q,track)");
check(
  "mid-track reset without teleport",
  /Never snap XZ onto the centre/.test(collide) && /OFF_RESET/.test(collide),
  "extreme runoff nudges inward — no sample() teleport"
);
check("soft creep not snap wall", /Creep back/.test(collide), "recover zone creep");
check(
  "glance keeps forward momentum",
  /const keep = Math\.max\(along/.test(collide) || /never zero the along-track/.test(collide),
  "re-aim speed down the nose"
);
check("Vehicle.step calls bounceOffRoad", /bounceOffRoad\(this,\s*q2,\s*track\)/.test(vehicle), "wire in vehicle.js");
check("barriers visual-only comment", /Barriers: visual posts only/.test(track), "no verge collider wall");
check("CrowdField module", exists("js/tracks/crowd.js") && /export class CrowdField/.test(crowdVis), "crowd.js");
check("CrowdField uses character kinds", /character-male-a/.test(crowdVis), "Kenney kinds listed");
check("CrowdVoice Doppler", /SOUND_SPEED/.test(crowdAud) && /playbackRate/.test(crowdAud), "manual Doppler");
check("RallyAudio.updateCrowd", /updateCrowd\(/.test(engine), "engine wires crowd beds");
check("game drives updateCrowd", /updateCrowd\(/.test(game), "race loop calls audio");
check("track drives CrowdField.update", /_crowd\.update\(/.test(track), "animation tick");
check("crowdPoints exported", /crowdPoints\(\)/.test(track), "audio clustering");

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 22 runoff + living crowds armed"}`);
process.exit(fail ? 1 : 0);
