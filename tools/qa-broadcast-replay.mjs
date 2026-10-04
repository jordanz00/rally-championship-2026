#!/usr/bin/env node
/**
 * QA — broadcast replay tape + director (no browser).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ReplayTape,
  BroadcastDirector,
  buildBroadcastTowers,
  unwrapAngle,
} from "../js/cinema/broadcast-replay.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const fxSrc = fs.readFileSync(path.join(ROOT, "js/effects.js"), "utf8");

let failed = 0;
function check(name, cond) {
  if (cond) console.log(`PASS  ${name}`);
  else {
    console.error(`FAIL  ${name}`);
    failed += 1;
  }
}

check("unwrap keeps small delta", Math.abs(unwrapAngle(0.2, 0.4) - 0.4) < 1e-9);
check("unwrap takes the short turn", Math.abs(unwrapAngle(3, -3) - 3) < 1.2);

const tape = new ReplayTape();
tape.start("forest", "celica");
for (let i = 0; i < 80; i++) {
  const t = i / 20;
  tape.tick(1 / 20, {
    position: { x: i * 2, y: 1.2, z: 10 },
    yaw: i * 0.02,
    pitch: 0.01,
    roll: -0.02,
    speed: 28,
    progress: i * 2,
    gear: 3,
    steer: 0.12,
    brake: i > 40 && i < 55 ? 0.8 : 0,
    handbrake: 0,
  });
  tape.t = t + 1 / 20;
}
check("tape recorded", tape.samples.length >= 70);
const mid = tape.poseAt(1.0);
check("pose interpolates x", mid && Math.abs(mid.x - 40) < 2.5);
check("pose has yaw", mid && Number.isFinite(mid.yaw));
check("pose keeps steer", mid && Math.abs(mid.steer - 0.12) < 0.01);
check("pose keeps speed", mid && Math.abs(mid.speed - 28) < 0.01);
const braking = tape.poseAt(2.3);
check("pose tapes brake", braking && braking.brake > 0.5);
check("pose dry brake off", mid && (mid.brake || 0) < 0.05);

const track = {
  length: 800,
  sample(dist, out) {
    const o = out || {};
    o.x = dist;
    o.y = 1;
    o.z = 0;
    o.nx = 0;
    o.nz = 1;
    o.heading = 0;
    o.width = 16;
    o.tunnel = dist > 200 && dist < 320;
    o.jump = dist > 500 && dist < 520;
    return o;
  },
};
const towers = buildBroadcastTowers(track);
check("towers along route", towers.length >= 4);

const dir = new BroadcastDirector(track, tape, { reducedMotion: false });
check("director ready", dir.ready);
dir.snapTo(mid);
check("camera finite", Number.isFinite(dir.eyeX) && Number.isFinite(dir.lookY));
let faded = false;
let kinds = new Set([dir.kind]);
for (let i = 0; i < 240; i++) {
  const pose = tape.poseAt((i * 0.05) % tape.duration());
  const shot = dir.update(0.05, pose);
  kinds.add(shot.kind);
  if (shot.fade > 0.4) faded = true;
  if (!Number.isFinite(dir.eyeX) || !Number.isFinite(dir.fov)) {
    check("eye finite", false);
    break;
  }
}
check("director cuts more than one shot", kinds.size >= 2);
check("fade used", faded || dir.reduced);
check("replay clears dust / marks / ruts / TSR", /_clearReplayTrails/.test(gameSrc));
check("replay forces opaque hero car", /_solidReplayCar/.test(gameSrc));
check("start replay wipes trails then solids the car", /_clearReplayTrails\(\);\s*\n\s*this\._solidReplayCar\(\)/.test(gameSrc));
check("ghost clones materials instead of sharing", /c\.opacity = 0\.42/.test(gameSrc) && /m\.clone\(\)/.test(gameSrc));
check("dust has a particle reset", /Kill every live particle/.test(fxSrc) && /this\.fade\[i\] = 0/.test(fxSrc));

if (failed) {
  console.error(`Broadcast replay QA failed (${failed})`);
  process.exit(1);
}
console.log("Broadcast replay QA passed.");
