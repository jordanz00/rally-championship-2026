#!/usr/bin/env node
/**
 * qa-jump-banks.mjs — jump sides rise with the ramp; the flight hole stays empty.
 *
 * Player moment: Safari takeoff. Dirt banks climb with the lip instead of
 * sitting as a flat shelf under a floating plank. The gap stays a hole.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-jump-banks.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { Track } from "../js/tracks/track.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`JUMP BANKS  ·  ${new Date().toISOString()}\n`);
console.log("static");

check(
  "game imports track.js?v=414+",
  Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 414,
  "stale cache would keep the flat jump shelf"
);
check("jump bank helper", /_jumpBankTargetY/.test(trackSrc) && /_raiseJumpBank/.test(trackSrc));
check(
  "gap skirt stays a lip",
  /p\.jumpKind === "gap"\) base = 1\.4/.test(trackSrc),
  "flight hole must not grow a dirt floor"
);
check(
  "ramp/land skirts plant on ground",
  /p\.jump \|\| p\.jumpWash/.test(trackSrc) && /Math\.max\(sl, 8\.5\)/.test(trackSrc)
);
check(
  "flight hole rejected",
  /inFlightHole/.test(trackSrc) && /k === "gap"/.test(trackSrc)
);

console.log("\nlive desert spline");

const def = COURSES.desert;
const track = new Track(def, { deferBuild: true });
track._buildSpline(def.pieces, def);
const pts = track.points;
const drop = 0.95;

const crests = pts.filter((p) => p.jumpKind === "crest");
const gaps = pts.filter((p) => p.jumpKind === "gap");
const ramps = pts.filter((p) => p.jumpKind === "ramp");
const lands = pts.filter((p) => p.jumpKind === "land");
check("desert has jump posts", crests.length > 0 && gaps.length > 0 && ramps.length > 0 && lands.length > 0);

const crest = crests.reduce((a, b) => (a.y >= b.y ? a : b), crests[0]);
const verge = (crest.width || 16.8) * 0.5;
const side = (lat) => ({
  x: crest.x + crest.nx * lat,
  z: crest.z + crest.nz * lat,
});

const nearBank = side(verge + 6);
const midBank = side(verge + 12);
const farBank = side(verge + 20);
const nearY = track._landSurfaceY(nearBank.x, nearBank.z, "desert");
const midY = track._landSurfaceY(midBank.x, midBank.z, "desert");
const farY = track._landSurfaceY(farBank.x, farBank.z, "desert");
const rawNear = track._groundHeightRaw(nearBank.x, nearBank.z, "desert");
const bankedNear = track._groundHeight(nearBank.x, nearBank.z, "desert");
const target = track._jumpBankTargetY(nearBank.x, nearBank.z, drop);

check(
  "bank helper aims near the lip",
  target != null && target > crest.y - drop - 1.6 && target < crest.y - 0.2,
  `target=${target != null ? target.toFixed(2) : "null"} crest=${crest.y.toFixed(2)}`
);
check(
  "land beside crest rises with the jump",
  target != null &&
    nearY >= target - 0.08 &&
    nearY >= Math.min(rawNear, crest.y - drop) - 0.08 &&
    nearY > crest.y - drop - 1.8,
  `land=${nearY.toFixed(2)} raw=${rawNear.toFixed(2)} crest=${crest.y.toFixed(2)}`
);
check(
  "physics shoulder matches the bank",
  bankedNear >= (target ?? 0) - 0.05,
  `gy=${bankedNear.toFixed(2)}`
);
check(
  "smooth lateral falloff",
  nearY > midY - 0.05 && midY > farY - 0.05 && nearY - farY > 0.7,
  `near=${nearY.toFixed(2)} mid=${midY.toFixed(2)} far=${farY.toFixed(2)}`
);

const gap = gaps[Math.floor(gaps.length / 2)];
const hole = track._jumpBankTargetY(gap.x, gap.z, drop);
const holeLand = track._landSurfaceY(gap.x, gap.z, "desert");
check("gap centre is not banked", hole == null, "flight path must stay a hole");
check(
  "gap land stays a floor under the crest",
  holeLand < crest.y - 0.8,
  `hole=${holeLand.toFixed(2)} crest=${crest.y.toFixed(2)}`
);

const land = lands[lands.length - 1];
const landSide = {
  x: land.x + land.nx * (land.width * 0.5 + 6),
  z: land.z + land.nz * (land.width * 0.5 + 6),
};
const landBank = track._jumpBankTargetY(landSide.x, landSide.z, drop);
const landY = track._landSurfaceY(landSide.x, landSide.z, "desert");
check(
  "land-pad sides rise with the pad",
  landBank != null && landY > land.y - drop - 1.8,
  `land=${landY.toFixed(2)} pad=${land.y.toFixed(2)}`
);

const paint = track._jumpBankTargetY(crest.x, crest.z, drop);
check("ribbon paint is not filled by the bank", paint == null);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "jump sides follow the ramp"}`);
process.exit(fail ? 1 : 0);
