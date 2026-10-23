#!/usr/bin/env node
/**
 * qa-forest-tunnel-lights.mjs — Stage 2 cabin lights sit on the crown.
 *
 * Player moment: Forest tunnel. Sodium lamps are bolted to the ceiling
 * over the lane. Nothing hangs down. Nothing floats on the side walls.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-forest-tunnel-lights.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FOREST_TUNNEL_CEILING_GAP,
  forestTunnelCeilingPose,
} from "../js/tracks/forest-tunnel.js";

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

console.log(`FOREST TUNNEL LIGHTS  ·  ${new Date().toISOString()}\n`);

const tun = read("js/tracks/forest-tunnel.js");
const track = read("js/tracks/track.js");
const game = read("js/game.js");
const main = read("js/main.js");
const html = read("index.html");

check("globe sits on the crown", FOREST_TUNNEL_CEILING_GAP > 0.05 && FOREST_TUNNEL_CEILING_GAP < 0.45, String(FOREST_TUNNEL_CEILING_GAP));
check(
  "housing + globe + conduit + plate geos exist",
  /createForestTunnelPendantHousingGeometry/.test(tun) &&
    /createForestTunnelPendantGlobeGeometry/.test(tun) &&
    /createForestTunnelPendantConduitGeometry/.test(tun) &&
    /createForestTunnelPendantPlateGeometry/.test(tun)
);
check("Forest plants ceiling pendants", /forestTunnelCeilingPose/.test(track) && /forestTunnelPendant/.test(track));
check("no wall-sconce plant on Forest run", !/forestTunnelSconcePose/.test(track));
check("pendants skip land plant", /skipSeat/.test(track) && /forestTunnelPendant/.test(track));
check("Forest cabin uses warmer sodium fill", /wallColor: 0xffc878/.test(game) && /wallInt: 92/.test(game));
check("Forest headBeam is 40% under 1295", /headBeam: 777/.test(game));
check("game imports track.js?v=429+", Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 429);
check("boot cache is 1022+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 1022);
check("index boots main.js?v=1022+", Number((html.match(/main\.js\?v=(\d+)/) || [])[1]) >= 1022);

const pose = forestTunnelCeilingPose({ x: 10, y: 2, z: -4, heading: 0.4, nx: 1, nz: 0 }, 30);
check("globe stays on the racing line", Math.abs(pose.x - 10) < 1e-6 && Math.abs(pose.z + 4) < 1e-6);
check("lamp is flush, no drop rod", pose.ceilY - pose.y < 0.45 && pose.rod < 0.25, `y=${pose.y.toFixed(2)} rod=${pose.rod.toFixed(2)}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Forest tunnel lights sit on the crown"}`);
process.exit(fail ? 1 : 0);
