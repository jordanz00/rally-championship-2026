#!/usr/bin/env node
/**
 * qa-forest-tunnel-mouth.mjs — entrance/exit keep hero rocks on a 28 m bore.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-forest-tunnel-mouth.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FOREST_BORE_INSET, forestMouthBoulderPoses } from "../js/tracks/forest-tunnel.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`FOREST TUNNEL MOUTH  ·  ${new Date().toISOString()}\n`);

const tun = read("js/tracks/forest-tunnel.js");
const track = read("js/tracks/track.js");
const game = read("js/game.js");
const main = read("js/main.js");
const html = read("index.html");

const half = 14;
const clearHalf = half + FOREST_BORE_INSET;
const driveHalf = half + 3.8 + 1.8;
const p = { x: 0, y: 4, z: 0, heading: 0, nx: 1, nz: 0, width: 28, dist: 1200 };
const bags = forestMouthBoulderPoses({
  p,
  outward: -1,
  clearHalf,
  openH: 8,
  groundY: () => 3.2,
  inDrive: (x, z) => Math.abs(x) <= driveHalf && Math.abs(z) < 40,
  chunkOfDist: () => 0,
});
const all = (bags.a || []).concat(bags.b || []);
check("wide mouth still plants a rock field", all.length >= 12, `n=${all.length}`);
check(
  "every rock sits outside the drive hole",
  all.every((r) => Math.abs(r.x) > clearHalf + 2.2),
  all.length ? `minLat=${Math.min(...all.map((r) => Math.abs(r.x))).toFixed(2)}` : "none"
);
check(
  "rocks are not in the painted lane",
  all.every((r) => Math.abs(r.x) > driveHalf),
  all.length ? `minLat=${Math.min(...all.map((r) => Math.abs(r.x))).toFixed(2)} drive=${driveHalf}` : "none"
);
check("laterals are past the hole, not a 10 m fixed list", /clearHalf \+ beyond/.test(tun));
check("track plants hero boulder A/B", /forest_hero_boulder_a/.test(track) && /plantForestMouthBoulders/.test(track));

const tunV = Number((track.match(/forest-tunnel\.js\?v=(\d+)/) || [])[1]);
const trackV = Number((game.match(/track\.js\?v=(\d+)/) || [])[1]);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1]);
const mainV = Number((html.match(/main\.js\?v=(\d+)/) || [])[1]);
check(
  "cache bust tunnel + track + game",
  tunV >= 21 && trackV >= 428 && gameV >= 1021 && mainV === gameV,
  `tun=${tunV} track=${trackV} game=${gameV} main=${mainV}`
);

if (fail) {
  console.log(`\nFAIL  ${fail}`);
  process.exit(1);
}
console.log("\nPASS  ·  Forest mouths keep the hero rocks");
process.exit(0);
