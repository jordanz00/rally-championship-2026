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
  med && Number(med[1]) >= 3.9 && Number(med[1]) <= 6.4 && Number(med[2]) >= 1.75 && Number(med[2]) <= 2.2,
  med ? `back=${med[1]} height=${med[2]}` : "medium back/height missing"
);

check(
  "C-key pose blend is a short ease, not a cut",
  /viewBlendTime:\s*0\.22/.test(config) && /_startCamBlend/.test(game) && /_carryBlendPoint/.test(game),
  "viewBlendTime ~0.22s and from-pose must ride with the car"
);

check(
  "entering POV seats the cabin mid-blend (C frame is blend-only)",
  /_cycleCamera\(/.test(game) &&
    !/if \(mode && mode\.id === "pov"\) this\._applyCockpitCam\(\)/.test(game) &&
    /seatIn/.test(game) &&
    /_warmPov\(\)/.test(game),
  "C must not hitch-compile; cabin attaches after the ease starts"
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
    (/mirrorEveryPov:\s*[12]/.test(config) || /mirrorEvery:\s*1/.test(config)),
  "mirror mesh + setCockpitMirrorMap + live POV capture"
);

check(
  "gauges sized like a real cluster, MPH like chase HUD",
  /POV_GAUGE_R = 0\.055/.test(car) && /POV_SPEED_MAX_MPH = 140/.test(car) && /gaugeVmax/.test(car),
  "dial radius ~55 mm and vmax 140 MPH"
);

check(
  "GLB cabin shell stays hidden so POV can look out over the hood",
  /_povKeepHidden/.test(car) &&
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
  /celica\.js\?v=1[3-9][0-9]/.test(game) && /game\.js\?v=46[3-9]|game\.js\?v=[5-9][0-9]{2}/.test(read("js/main.js")) &&
    /cockpit-anim\.js\?v=[4-9]/.test(game) && /config\.js\?v=14[7-9]|config\.js\?v=1[5-9][0-9]/.test(game),
  "game.js must import bumped celica/config; main must import bumped game"
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
    /userData\.glbSteer/.test(car) && /steerSpin/.test(read("js/cars/cockpit-anim.js")),
  "bind the GLB rim, skip the procedural torus, animate the same node"
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Sprint 37 camera armed"}`);
process.exit(fail ? 1 : 0);
