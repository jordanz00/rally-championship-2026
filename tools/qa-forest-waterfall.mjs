#!/usr/bin/env node
/**
 * qa-forest-waterfall.mjs — Stage 2 Forest must plant an epic cascading waterfall.
 *
 * RUN: node tools/qa-forest-waterfall.mjs
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

console.log(`FOREST WATERFALL  ·  ${new Date().toISOString()}\n`);

const track = read("js/tracks/track.js");
const pbr = read("js/gfx/pbr.js");
const forest = read("js/tracks/stages/forest-definition.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");

check(
  "waterfall material exported",
  /export function waterfall\(/.test(pbr) && /waterfall-cascade/.test(pbr),
  "pbr.js waterfall() with vertical foam map"
);
check(
  "forest builds a waterfall landmark",
  /_addForestWaterfall\(/.test(track) &&
    /def\.scenery === "forest"[\s\S]{0,280}?_addForestWaterfall\(/.test(track),
  "called from forest scenery path"
);
check(
  "epic gorge scale",
  /forestEpicFalls/.test(track) && /cliffH = 64/.test(track) && /fallW = 38/.test(track),
  "background attraction must be gigantic"
);
check(
  "cascade sheets + plunge pool registered for scroll",
  /userData\.waterScroll/.test(track) &&
    /waterfall-pool/.test(track) &&
    /_waterMeshes\.push/.test(track),
  "sheets rush down; pool ripples"
);
check(
  "waterfall sits far past the drive verge",
  /ROAD_VERGE \+ 58/.test(track) && /_ribbonClear\(x, z, 22\)/.test(track),
  "must not occupy the painted lane"
);
check(
  "forest subtitle mentions waterfall",
  /WATERFALL CLEARING/.test(forest),
  "course card should sell the landmark"
);
check(
  "scroll tick honors per-mesh rates",
  /waterScroll \|\| \{ u: 0\.038/.test(track),
  "cascade v offset must be faster than lake drift"
);

const trackV = Number((game.match(/track\.js\?v=(\d+)/) || [])[1] || 0);
const pbrFromTrack = Number((track.match(/pbr\.js\?v=(\d+)/) || [])[1] || 0);
const gameV = (main.match(/game\.js\?v=(\d+)/) || [])[1];
const mainV = (index.match(/main\.js\?v=(\d+)/) || [])[1];
check("track cache bust", trackV >= 491, `got ${trackV}`);
check(
  "pbr waterfall import",
  /waterfall as waterfallPbr/.test(track) && pbrFromTrack >= 68,
  `track pbr v=${pbrFromTrack}`
);
check("boot cache aligned", gameV && mainV && gameV === mainV, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "epic Forest waterfall planted"}`);
process.exit(fail ? 1 : 0);
