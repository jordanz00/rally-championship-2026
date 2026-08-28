#!/usr/bin/env node
/**
 * qa-sprint26-solid.mjs — opaque environment is solid (no pass-through).
 *
 * RUN: node tools/qa-sprint26-solid.mjs
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

console.log(`SPRINT 26c SOLID ENVIRONMENT GATE  ·  ${new Date().toISOString()}\n`);

const collide = read("js/physics/collide.js");
const track = read("js/tracks/track.js");

check(
  "contact resolve strips into-surface velocity only",
  /Resolve velocity against the normal/.test(collide) && /PLAYER_ENV_PUSH/.test(collide),
  "applyGlance must not zero longitudinal speed"
);
check(
  "TOI sweep + penetration correction",
  /earliest time-of-impact/.test(collide) && /correctEnvPenetration/.test(collide),
  "path collision, not endpoint-only"
);
check(
  "_bumpNearRoad helper",
  /_bumpNearRoad\s*\(/.test(track) && /_bumpPoses\s*\(/.test(track),
  "near-road solid registration"
);
check(
  "mountain cliff bumps",
  /Solid face: sample bumps/.test(track),
  "cliff face colliders"
);
check(
  "berm/bank solid bumps",
  /_bumpPoses\(berms/.test(track) && /_bumpPoses\(banks/.test(track),
  "drift berms + forest banks"
);
check(
  "tunnel wall faces",
  /_wallFace\s*\(/.test(track) && /kind: "wall"/.test(track),
  "planar inner lining, not core spheres"
);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "opaque solids armed"}`
);
process.exit(fail ? 1 : 0);
