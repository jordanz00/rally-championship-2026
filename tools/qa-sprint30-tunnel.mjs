#!/usr/bin/env node
/**
 * qa-sprint30-tunnel.mjs — Desert tunnel portal baseline.
 *
 * Realistic horseshoe rock-cut mouths at entrance + exit: punched drive hole,
 * hillside cheeks, mouth land prisms, no floating bore sheet.
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
const portalSlice = track.slice(track.indexOf("_addTunnelPortal"));

check(
  "unified terrain-welded hillside shells",
  /tunnelMouthHillsideGeometry/.test(track) && /portalHillside/.test(portalSlice),
  "single welded hillside per side"
);
check(
  "lintel crown + recessed horseshoe ring + bore",
  /tunnelMouthLintelGeometry/.test(track) &&
    /portalLintel/.test(portalSlice) &&
    /portalMouthRing/.test(portalSlice) &&
    /portalBoreLiner/.test(portalSlice),
  "mountain mouth read"
);
check(
  "no free-standing doorway frame tag",
  !/portalFrame/.test(portalSlice),
  "legacy doorway frame removed"
);
check(
  "vertex weld to terrain",
  /_weldPortalVerticesToTerrain/.test(track),
  "portal verts snap to land"
);
check("portal openH 8.2", /openH: 8\.2/.test(track), "8.2 m clearance");
check(
  "mouth collider scrub at entrance + exit",
  /tunStart - 72/.test(track) && /tunEnd \+ 72/.test(track),
  "both mouths ribbon-scrubbed"
);
check(
  "no floating cap box",
  !/BoxGeometry\(p\.width \+ 48/.test(portalSlice),
  "cap box removed"
);
check(
  "mouth prisms + bore scrub",
  /_tunnelMouthPrisms/.test(track) && /_scrubPortalBoreWorld/.test(track),
  "land refuse + mesh scrub"
);
check(
  "clearHalfW includes verge",
  /clearHalfW:\s*half \+ ROAD_VERGE/.test(track),
  "drive prism must clear verge rock"
);
check("no sprint30 undercarriage-only portal", !/Undercarriage — readable when driving under the bridge/.test(track), "sprint30 portal removed");
check("tunnel shoulder offset 15.5+", /half \+ 15\.5/.test(track), "ridge offset");
check("interior wallH 8.2", /wallH = 8\.2/.test(track), "tube height");
check(
  "portal plants onto tunnel terrain",
  /groundLocalY\(/.test(portalSlice) && /_tunnelTerrainY/.test(portalSlice),
  "cheek toes bury into dunes"
);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Tunnel portal baseline OK"}`
);
process.exit(fail ? 1 : 0);
