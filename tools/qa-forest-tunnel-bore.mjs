#!/usr/bin/env node
/**
 * qa-forest-tunnel-bore.mjs — Stage 2 bore is wide; lamps bolt to the rock.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-forest-tunnel-bore.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { FOREST_BORE_INSET, forestTunnelSconcePose } from "../js/tracks/forest-tunnel.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const seatSrc = fs.readFileSync(path.join(ROOT, "js/tracks/seat-scenery.js"), "utf8");
const tunSrc = fs.readFileSync(path.join(ROOT, "js/tracks/forest-tunnel.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`FOREST TUNNEL BORE  ·  ${new Date().toISOString()}\n`);

check("bore inset ≥ 3.2 m", FOREST_BORE_INSET >= 3.2, String(FOREST_BORE_INSET));
check("sconce pose helper", /forestTunnelSconcePose/.test(tunSrc) && /createForestTunnelSconceGeometry/.test(tunSrc));
check("sconces skip land plant", /skipSeat/.test(trackSrc) && /tunnelBoreRib/.test(seatSrc));
check("no floating lookAt bars", !/BoxGeometry\(0\.16, 0\.28, 0\.82\)/.test(trackSrc));
check("game imports track.js?v=415+", Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 415);

const tun = (COURSES.forest.pieces || []).filter((p) => p.tunnel);
check("forest has a tunnel run", tun.length >= 4);
const minW = Math.min(...tun.map((p) => p.width || 0));
check("tunnel road ≥ 28 m", minW >= 28, `min=${minW}`);

const p = { x: 0, y: 4, z: 0, nx: 1, nz: 0, heading: 0 };
const pose = forestTunnelSconcePose(p, 12, 1, 8);
check(
  "sconce sits on the wall face",
  Math.abs(pose.x - 12.045) < 0.02 && Math.abs(pose.y - (4 + 2.48)) < 0.05 && pose.z === 0,
  `x=${pose.x.toFixed(3)} y=${pose.y.toFixed(3)}`
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "wide Forest bore, wall lamps"}`);
process.exit(fail ? 1 : 0);
