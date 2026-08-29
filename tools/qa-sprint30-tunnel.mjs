#!/usr/bin/env node
/**
 * qa-sprint30-tunnel.mjs — Desert tunnel portal baseline (reverted Sprint 30 underpass).
 *
 * RUN: node tools/qa-sprint30-tunnel.mjs
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

console.log(`TUNNEL PORTAL BASELINE GATE  ·  ${new Date().toISOString()}\n`);

const track = read("js/tracks/track.js");

check("portal wings present", /BoxGeometry\(18, wingH, 24\)/.test(track) || /BoxGeometry\(18, 26, 24\)/.test(track), "wing slabs");
check("portal openH 8.0", /openH = 8\.0/.test(track), "8 m clearance");
check("portal buttresses", /BoxGeometry\(22, buttH, 26\)/.test(track) || /BoxGeometry\(22, 30, 26\)/.test(track), "buttress mass");
check("no sprint30 undercarriage-only portal", !/Undercarriage — readable when driving under the bridge/.test(track), "sprint30 portal removed");
check("tunnel shoulder offset 15.5+", /half \+ 15\.5/.test(track), "ridge offset");
check("interior wallH 8.2", /wallH = 8\.2/.test(track), "tube height");
check("portal plants onto tunnel terrain", /plantY\(/.test(track) && /_tunnelTerrainY/.test(track), "toes bury into dunes");

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Tunnel portal baseline OK"}`
);
process.exit(fail ? 1 : 0);
