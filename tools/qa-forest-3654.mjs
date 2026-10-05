#!/usr/bin/env node
/**
 * qa-forest-3654.mjs — Stage 2 hairpin exit stays on the paint.
 *
 * Player moment: Drive Forest through ~3654 m (end of the right hairpin).
 * The car stays on the roadway. It does not float off the deck, and it does
 * not get sent back to an earlier point on the course.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-forest-3654.mjs
 */
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";
import { Vehicle } from "../js/physics/vehicle.js";

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`FOREST 3654 HAIRPIN EXIT  ·  ${new Date().toISOString()}\n`);

const track = new Track(COURSES.forest, { deferBuild: true });
track._buildSpline(COURSES.forest.pieces, COURSES.forest);
track.colliders = [];

const EXIT = 3654;
const line = track.sample(EXIT);
check("3654 is on the Forest spline", line && line.dist > 3600 && line.dist < 3720, `sample ${line.dist.toFixed(1)}`);

const v = new Vehicle();
v.spawn(track, EXIT, 0);
const deck = line.y + 0.06;
check(
  "spawn sits on the deck",
  Math.abs(v.position.y - (deck - 0.014)) < 0.2,
  `y ${v.position.y.toFixed(2)} deck ${deck.toFixed(2)}`
);

const poisoned = {
  dist: 3520,
  height: -0.15,
  onRoad: false,
  lateral: 40,
  width: line.width,
  heading: line.heading,
  nx: line.nx,
  nz: line.nz,
  jumpKind: null,
};
const held = v._holdPaintedRibbon(track, poisoned, EXIT);
check(
  "on-paint query cannot jump backward",
  held && held.dist > EXIT - 2,
  `dist ${held && held.dist}`
);
check(
  "on-paint query stays at deck height",
  held && held.height > deck - 0.2 && held.height < deck + 0.35,
  `h ${held && Number(held.height).toFixed(2)}`
);

const x0 = v.position.x;
const z0 = v.position.z;
const back = track.sample(3480);
v._hasGoodPose = true;
v._goodX = back.x;
v._goodY = back.y;
v._goodZ = back.z;
v._goodYaw = back.heading;
v._goodPitch = 0;
v._goodRoll = 0;
v._goodProgress = 3480;
v._goodOnGround = true;
v.speed = 20;
v.velocity.set(Math.sin(v.yaw) * 20, 0, Math.cos(v.yaw) * 20);
track.colliders = [{ x: v.position.x, z: v.position.z, r: 2.4 }];
v.step(1 / 60, { throttle: 0.2, brake: 0, steer: 0, handbrake: 0 }, track);
const moved = Math.hypot(v.position.x - x0, v.position.z - z0);
check("solid on the paint does not restore an older XZ", moved < 8, `moved ${moved.toFixed(2)} m`);
check("progress stays near the exit", Math.abs(v.progress - EXIT) < 30, `p ${v.progress.toFixed(1)}`);
track.colliders = [];

// Drive the exit on the centerline. No backward snap, no float.
v.spawn(track, 3580, 0);
let prev = v.progress;
let worstBack = 0;
let worstUp = 0;
for (let n = 0; n < 2400 && v.progress < 3720; n++) {
  const ahead = track.sample(Math.min(track.length - 1, v.progress + 16));
  let dh = ahead.heading - v.yaw;
  while (dh > Math.PI) dh -= Math.PI * 2;
  while (dh < -Math.PI) dh += Math.PI * 2;
  const here = track.sample(v.progress);
  const lat = (v.position.x - here.x) * here.nx + (v.position.z - here.z) * here.nz;
  v.step(
    1 / 60,
    { throttle: 1, brake: 0, steer: Math.max(-1, Math.min(1, dh * 2.2 - lat * 0.08)), handbrake: 0 },
    track
  );
  const back = prev - v.progress;
  if (back > worstBack) worstBack = back;
  const up = v.position.y - (here.y + 0.06);
  if (up > worstUp) worstUp = up;
  prev = v.progress;
}
check("drive crosses 3654", v.progress > 3700, `end ${v.progress.toFixed(1)}`);
check("drive does not rewind", worstBack < 4, `back ${worstBack.toFixed(2)} m`);
check("drive stays on the deck", worstUp < 0.4, `up ${worstUp.toFixed(2)} m`);

console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
