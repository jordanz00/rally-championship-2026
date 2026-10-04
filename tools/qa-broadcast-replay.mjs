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
  snapReplayBody,
  lerpReplayBody,
} from "../js/cinema/broadcast-replay.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const fxSrc = fs.readFileSync(path.join(ROOT, "js/effects.js"), "utf8");
const aiSrc = fs.readFileSync(path.join(ROOT, "js/ai.js"), "utf8");

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

function fakeCar(x, z, yaw, extras) {
  return {
    position: { x, y: 1.2, z },
    yaw,
    pitch: 0.01,
    roll: -0.02,
    speed: 28,
    progress: x,
    gear: 3,
    steer: 0.12,
    brake: 0,
    handbrake: 0,
    ...(extras || {}),
  };
}

const RIVAL_N = 3;
const tape = new ReplayTape();
tape.start("forest", "celica");
for (let i = 0; i < 80; i++) {
  const t = i / 20;
  const rivals = [];
  for (let r = 0; r < RIVAL_N; r++) {
    rivals.push({
      vehicle: fakeCar(i * 2 - 8 - r * 4, 10 + r * 1.6, i * 0.02 + r * 0.01, {
        brake: i > 40 && i < 55 ? 0.7 : 0,
      }),
    });
  }
  tape.tick(1 / 20, fakeCar(i * 2, 10, i * 0.02, {
    brake: i > 40 && i < 55 ? 0.8 : 0,
  }), rivals);
  tape.t = t + 1 / 20;
}
check("tape recorded", tape.samples.length >= 70);
check("tape has N rivals", tape.samples[0].rivals && tape.samples[0].rivals.length === RIVAL_N);
check("pack count is player + rivals", tape.packCount() === 1 + RIVAL_N);
const mid = tape.poseAt(1.0);
check("pose interpolates x", mid && Math.abs(mid.x - 40) < 2.5);
check("pose has yaw", mid && Number.isFinite(mid.yaw));
check("pose keeps steer", mid && Math.abs(mid.steer - 0.12) < 0.01);
check("pose keeps speed", mid && Math.abs(mid.speed - 28) < 0.01);
check("pose interpolates rival pack", mid && mid.rivals && mid.rivals.length === RIVAL_N);
check("rival 0 is behind the hero", mid && mid.rivals[0] && mid.rivals[0].x < mid.x - 6);
check("rival 2 is furthest back", mid && mid.rivals[2] && mid.rivals[2].x < mid.rivals[0].x);
const braking = tape.poseAt(2.3);
check("pose tapes brake", braking && braking.brake > 0.5);
check("rival tapes brake", braking && braking.rivals[0] && braking.rivals[0].brake > 0.5);
check("pose dry brake off", mid && (mid.brake || 0) < 0.05);

const snap = snapReplayBody(fakeCar(4, 2, 0.3));
check("snapReplayBody writes x/z/yaw", snap && snap.x === 4 && snap.z === 2 && Math.abs(snap.yaw - 0.3) < 1e-9);
const lerped = lerpReplayBody(snapReplayBody(fakeCar(0, 0, 0)), snapReplayBody(fakeCar(10, 0, 0.2)), 0.5);
check("lerpReplayBody mid x", lerped && Math.abs(lerped.x - 5) < 1e-9);

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

const startFn = (gameSrc.match(/_startBroadcastReplay\(\) \{[\s\S]*?\n  \}/) || [])[0] || "";
check("replay spawn keeps pack visible", /_setPackVisible\(true\)/.test(startFn));
check("replay spawn does not hide pack", !/_setPackVisible\(false\)/.test(startFn));
check("replay spawn poses the taped pack", /_poseReplayPack\(/.test(startFn));
check("replay spawn count follows tape rivals", /_poseReplayPack/.test(gameSrc) && /applyReplayPose/.test(aiSrc));
check("replay clears dust / marks / ruts / TSR", /_clearReplayTrails/.test(gameSrc));
check("replay forces opaque hero car", /_solidReplayCar/.test(gameSrc));
check("start replay wipes trails then solids the car", /_clearReplayTrails\(\);\s*\n\s*this\._solidReplayCar\(\)/.test(gameSrc));
check("wipe-then-emit: tick writes fresh trails", /_clearReplayTrails\(\);\s*\n\s*this\._solidReplayCar\(\)/.test(gameSrc) && /_emitReplayTrails\(dt\)/.test(gameSrc));
check("tick emits trails after posing pack", /_poseReplayPack\(pose, dt\);\s*\n\s*this\._emitReplayTrails\(dt\)/.test(gameSrc));
check("emit uses live TireMarks path", /this\.tireMarks\.emit\(this\.player/.test(gameSrc) && /this\.tireMarks\.emit\(o\.vehicle/.test(gameSrc));
check("loop wrap wipes trails again", /_broadcastClock >= dur[\s\S]*?_clearReplayTrails\(\)/.test(gameSrc));
check("ghost clones materials instead of sharing", /c\.opacity = 0\.42/.test(gameSrc) && /m\.clone\(\)/.test(gameSrc));
check("replay opacity 1 on pack", /m\.opacity = 1/.test(gameSrc) && /_solidReplayMesh/.test(gameSrc) && /pack\[i\]\.mesh/.test(gameSrc));
check("broadcast skips pack ghost fade", /!this\.broadcast && fadeEvery/.test(gameSrc) && /!onPad && !this\.broadcast/.test(gameSrc));
check("dust has a particle reset", /Kill every live particle/.test(fxSrc) && /this\.fade\[i\] = 0/.test(fxSrc));
check("marks can forget stamps without wipe", /forgetStamps\(\)/.test(fxSrc));
check("rival LOD mesh gets replay pose", /applyReplayPose\(pose, dt, spin\)/.test(aiSrc));
check("rival replay keeps mesh visible", /this\.mesh\.visible = true/.test(aiSrc));
check("attract reel import stays v9", /attract-reel\.js\?v=9/.test(gameSrc));

if (failed) {
  console.error(`Broadcast replay QA failed (${failed})`);
  process.exit(1);
}
console.log("Broadcast replay QA passed.");
