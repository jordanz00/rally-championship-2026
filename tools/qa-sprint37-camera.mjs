#!/usr/bin/env node
/**
 * qa-sprint37-camera.mjs — tight Sega Rally chase + in-car POV + live mirror.
 *
 * RUN: node tools/qa-sprint37-camera.mjs
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

console.log(`SPRINT 37 CAMERA  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const car = read("js/cars/celica.js");

const med = config.match(/id:\s*["']medium["'][\s\S]{0,280}back:\s*([0-9.]+)[\s\S]{0,120}height:\s*([0-9.]+)/);
check(
  "medium chase is pulled back 25% and up 45%",
  med && Number(med[1]) >= 3.9 && Number(med[1]) <= 4.05 && Number(med[2]) >= 1.75 && Number(med[2]) <= 1.85,
  med ? `back=${med[1]} height=${med[2]}` : "medium back/height missing"
);

check(
  "C-key pose blend is short (no hang)",
  /viewBlendTime:\s*0\.1/.test(config) && /_carryBlendPoint/.test(game) && /_camBlendFrom\.copy/.test(game),
  "viewBlendTime ~0.12s and from-pose must ride with the car"
);

check(
  "POV hard-locks to the seat after blend",
  /else if \(wantPov\)[\s\S]{0,180}_camPos\.copy\(this\._camTarget\)/.test(game),
  "settled POV must copy the eye, not lerp"
);

check(
  "cockpit stays on the car (not camera.add)",
  /function attachCockpit/.test(car) && /root\.add\(cab\)/.test(car) && !/camera\.add\(cab\)/.test(car),
  "cabin must be parented to the chassis"
);

check(
  "driver eye is seated height (~1.12 m), not chest",
  /ground \+ 1\.12/.test(car) || /eyeY[\s\S]{0,80}1\.12/.test(car),
  "buildPovRig should sit the lens at seated eye height"
);

check(
  "rearview mirror is a physical glass + RT hook",
  /function makeRearviewMirror/.test(car) && /setCockpitMirrorMap/.test(car) &&
    /mirrorEvery:\s*1/.test(config),
  "mirror mesh + setCockpitMirrorMap + every-frame capture"
);

check(
  "gauges sized like a real cluster, keyed to the car",
  /POV_GAUGE_R = 0\.04/.test(car) && /gaugeVmax/.test(car) && /maxSpeedKmh/.test(car),
  "dial radius ~48 mm and vmax from CARS spec"
);

check(
  "GLB cabin shell stays hidden so POV can look out over the hood",
  /interiorKeepHidden\) obj\.visible = false/.test(car) &&
    /userData\.windshield \|\| obj\.userData\.povShell/.test(car),
  "hide cache is glass/roof only; heavy interior must not unhide into the lens"
);

check(
  "POV looks out over the hood; cabin glass is hidden",
  /hull\.maxZ \+ 2\.4/.test(car) && /window/.test(car) &&
    /userData\.windshield \|\| obj\.userData\.povShell/.test(car),
  "eye must look past the nose; windshield/window meshes tagged for POV hide"
);

check(
  "cache bust on the camera module graph",
  /config\.js\?v=125/.test(game) && /celica\.js\?v=109/.test(game) && /game\.js\?v=335/.test(read("js/main.js")) &&
    /cockpit-anim\.js\?v=3/.test(game),
  "game.js must import bumped config + celica + cockpit-anim; main must import bumped game"
);

check(
  "POV is left-hand drive",
  /Always LHD/.test(car) && /clamp\(eyeX,\s*-0\.5,\s*-0\.22\)/.test(car),
  "driver eye must sit on negative X"
);

check(
  "modeled steering wheel is used; no extra torus when the GLB has one",
  /function findGlbSteerNode/.test(car) && /function bindGlbSteeringWheel/.test(car) &&
    /if \(!hasGlbWheel\)/.test(car) && /TorusGeometry/.test(car) &&
    /userData\.glbSteer/.test(car) && /steerAxis/.test(read("js/cars/cockpit-anim.js")),
  "bind the GLB rim, skip the procedural torus, animate the same node"
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 37 camera armed"}`);
process.exit(fail ? 1 : 0);
