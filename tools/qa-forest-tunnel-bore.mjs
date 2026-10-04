#!/usr/bin/env node
/**
 * qa-forest-tunnel-bore.mjs — Stage 2 bore is wide; lamps hang from the crown.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-forest-tunnel-bore.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import {
  FOREST_BORE_INSET,
  FOREST_TUNNEL_HANG_H,
  forestTunnelCeilingPose,
} from "../js/tracks/forest-tunnel.js";

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
check(
  "ceiling pendant helper",
  /forestTunnelCeilingPose/.test(tunSrc) && /createForestTunnelPendantHousingGeometry/.test(tunSrc)
);
check("pendants skip land plant", /skipSeat/.test(trackSrc) && /tunnelBoreRib/.test(seatSrc));
check("Forest plants ceiling pose, not wall sconces", /forestTunnelCeilingPose/.test(trackSrc) && !/forestTunnelSconcePose/.test(trackSrc));
check("no floating lookAt bars", !/BoxGeometry\(0\.16, 0\.28, 0\.82\)/.test(trackSrc));
check("game imports track.js?v=429+", Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 429);

const scrubFn = (trackSrc.match(/_scrubCollidersOnRibbonSamples\(\) \{[\s\S]*?\n  \}/) || [])[0] || "";
check(
  "tunEnd is function-scope before mud-face use",
  /let tunEnd = NaN/.test(scrubFn) &&
    /Number\.isFinite\(tunEnd\)/.test(scrubFn) &&
    !/if \(runs && runs\.length\) \{\s*const tunStart/.test(scrubFn)
);
check(
  "mud-face loop does not read unbound tunEnd",
  /if \(Number\.isFinite\(tunEnd\)\) \{[\s\S]*road\.along < tunEnd - 30/.test(scrubFn)
);

const tun = (COURSES.forest.pieces || []).filter((p) => p.tunnel);
check("forest has a tunnel run", tun.length >= 4);
const minW = Math.min(...tun.map((p) => p.width || 0));
check("tunnel road ≥ 28 m", minW >= 28, `min=${minW}`);

const p = { x: 0, y: 4, z: 0, nx: 1, nz: 0, heading: 0 };
const pose = forestTunnelCeilingPose(p, 4 + 28, FOREST_TUNNEL_HANG_H);
check(
  "pendant hangs on the centerline",
  Math.abs(pose.x) < 0.01 && Math.abs(pose.z) < 0.01 && Math.abs(pose.y - (4 + FOREST_TUNNEL_HANG_H)) < 0.05,
  `x=${pose.x.toFixed(3)} y=${pose.y.toFixed(3)}`
);
check("conduit reaches the crown", pose.rod > 20, `rod=${pose.rod.toFixed(2)}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "wide Forest bore, ceiling lamps"}`);
process.exit(fail ? 1 : 0);
