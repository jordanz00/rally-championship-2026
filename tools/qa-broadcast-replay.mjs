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
  rollShotHold,
  BROADCAST_SHOTS,
  SHOT_HOLD,
  HOLD_MIN,
  HOLD_MAX,
  composeBroadcastShot,
  playerInBroadcastFrame,
  lookTargetsPlayer,
  playerNdc,
  FRAME_NDC_X,
  FRAME_NDC_Y,
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

check("shot vocab has 8 cinematic setups", BROADCAST_SHOTS.length >= 8);
check("old 1.2 s floor is gone", HOLD_MIN > 1.2 && HOLD_MIN >= 2);
check("hold range is 2.0–3.0 s", HOLD_MIN === 2 && HOLD_MAX === 3);
const holdsOk = BROADCAST_SHOTS.every((k) => SHOT_HOLD[k] >= HOLD_MIN && SHOT_HOLD[k] <= HOLD_MAX);
check("every kind hold is 2.0–3.0 s", holdsOk);
const rolled = BROADCAST_SHOTS.map((k) => rollShotHold(k));
check("rollShotHold never drops below 2 s", rolled.every((h) => h >= 2));
check("rollShotHold never exceeds 3 s", rolled.every((h) => h <= 3));
check("1.2 s is no longer a legal hold", !rolled.some((h) => h < 2) && HOLD_MIN !== 1.2);

function poseAtProgress(progress, extras) {
  return {
    t: 1,
    x: progress,
    y: 1.2,
    z: 0,
    yaw: 0,
    pitch: 0,
    roll: 0,
    speed: 28,
    progress,
    gear: 3,
    steer: 0.1,
    brake: 0,
    handbrake: 0,
    yawRate: 0,
    ...(extras || {}),
  };
}

const samplePoses = [
  mid,
  poseAtProgress(80),
  poseAtProgress(250),
  poseAtProgress(510, { yawRate: 0.8 }),
];
let framed = 0;
let emptyLook = 0;
for (const kind of BROADCAST_SHOTS) {
  for (const pose of samplePoses) {
    const layout = composeBroadcastShot(kind, pose, track);
    if (!lookTargetsPlayer(layout, pose)) emptyLook += 1;
    if (playerInBroadcastFrame(layout, pose, { kind })) framed += 1;
    else {
      check(`${kind} frames player at ${pose.progress | 0}`, false);
    }
  }
}
check("every shot looks at the player hull", emptyLook === 0);
check("every sampled pose keeps the player in frustum", framed === BROADCAST_SHOTS.length * samplePoses.length);

const emptyRoad = {
  eyeX: 0,
  eyeY: 42,
  eyeZ: 0,
  lookX: 380,
  lookY: 28,
  lookZ: 40,
  fov: 40,
};
check("empty-road look-at fails the player test", !lookTargetsPlayer(emptyRoad, mid));
check("sky-only pose fails the frustum test", !playerInBroadcastFrame(emptyRoad, mid, { kind: "heli" }));
check("NDC margins are the hard rule", FRAME_NDC_X <= 0.72 && FRAME_NDC_Y <= 0.78);

const dir2 = new BroadcastDirector(track, tape, { reducedMotion: false, aspect: 16 / 9 });
dir2.snapTo(mid);
let lost = 0;
const seen = new Set();
for (let i = 0; i < 360; i++) {
  const pose = tape.poseAt((i * 0.05) % tape.duration());
  dir2.update(0.05, pose);
  seen.add(dir2.kind);
  if (dir2.fade < 0.55) {
    const lay = dir2.layout();
    if (!lookTargetsPlayer(lay, pose) || !playerInBroadcastFrame(lay, pose, { kind: dir2.kind, aspect: dir2.aspect })) {
      lost += 1;
    }
  }
}
check("director visits several cinematic kinds", seen.size >= 4);
check("live director never empties the frame", lost === 0);
check("snapTo keeps a finite player NDC", Number.isFinite(playerNdc(dir2.layout(), mid).x));

const holdDir = new BroadcastDirector(track, tape, { reducedMotion: false, aspect: 16 / 9 });
holdDir.snapTo(mid);
const cutTimes = [];
let cuts = 0;
let lastCutT = 0;
let simT = 0;
for (let i = 0; i < 400; i++) {
  const pose = tape.poseAt((i * 0.05) % tape.duration());
  const shot = holdDir.update(0.05, pose);
  simT += 0.05;
  if (shot.didCut) {
    cuts += 1;
    if (lastCutT > 0) cutTimes.push(simT - lastCutT);
    lastCutT = simT;
  }
}
check("director actually cuts", cuts >= 2);
check("no shot shorter than 2 s", cutTimes.length >= 1 && cutTimes.every((d) => d >= 1.99));
check("holds stay at or under 3 s", cutTimes.every((d) => d <= 3.05));

const recutDir = new BroadcastDirector(track, tape, { reducedMotion: false, aspect: 16 / 9 });
recutDir.snapTo(mid);
recutDir.phase = "hold";
recutDir.shotT = 0.1;
recutDir._cutLock = 0;
recutDir._rescued = false;
recutDir._mustCut = () => true;
let recuts = 0;
let recutGaps = [];
let recutT = 0;
let lastRecut = -1;
for (let i = 0; i < 80; i++) {
  const pose = tape.poseAt((i * 0.016) % tape.duration());
  const shot = recutDir.update(0.016, pose);
  recutT += 0.016;
  if (shot.didCut) {
    recuts += 1;
    if (lastRecut >= 0) recutGaps.push(recutT - lastRecut);
    lastRecut = recutT;
  }
}
check("mustCut does not recut every frame", recuts <= 2);
check("mustCut lockout is at least 2 s", recutGaps.every((g) => g >= 1.99));
check("hardCut snaps eye without leftover lerp", recutDir.eyeX === recutDir._tx && recutDir.eyeZ === recutDir._tz);

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
check("attract reel import stays put", /attract-reel\.js\?v=\d+/.test(gameSrc));
check("broadcast module cache-bust is v8+", Number((gameSrc.match(/broadcast-replay\.js\?v=(\d+)/) || [])[1] || 0) >= 8);
check("replay cut resets TSR history", /_onBroadcastCut\(/.test(gameSrc) && /shot\.didCut/.test(gameSrc) && /this\.tsr\.reset/.test(gameSrc));
check("replay cut re-poses pack at dt 0", /_onBroadcastCut\([\s\S]*?_poseReplayPack\(pose, 0\)/.test(gameSrc));
check("hard cut has no camera blend leftover", !/BLEND_SEC/.test(fs.readFileSync(path.join(ROOT, "js/cinema/broadcast-replay.js"), "utf8")));

if (failed) {
  console.error(`Broadcast replay QA failed (${failed})`);
  process.exit(1);
}
console.log("Broadcast replay QA passed.");
