#!/usr/bin/env node
/**
 * Sprint 65 — ghost non-player cars that sit between chase camera and player.
 *
 * RUN: node tools/qa-sprint65-rival-fade.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

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

console.log(`SPRINT 65 RIVAL SEE-THROUGH  ·  ${new Date().toISOString()}\n`);

const fade = read("js/gfx/occlusion-fade.js");
const game = read("js/game.js");
const track = read("js/tracks/track.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const updateBlock = (() => {
  const start = fade.indexOf("export function updatePackSeeThrough");
  const next = fade.indexOf("export function paintPackSeeThrough");
  return start >= 0 && next > start ? fade.slice(start, next) : "";
})();

check(
  "updatePackSeeThrough export",
  /export function updatePackSeeThrough\(/.test(fade)
);
check(
  "paintPackSeeThrough export",
  /export function paintPackSeeThrough\(/.test(fade)
);
check(
  "clones materials instead of mutating shared pack paints",
  /shared:\s*false,\s*packFadeClone:\s*true/.test(fade)
);
check(
  "leftover opacity is see-through, not invisible",
  /PACK_GHOST_OP\s*=\s*0\.18/.test(fade)
);
check(
  "amounts update without painting (mirror stays solid)",
  /packFadeAmt = amt/.test(updateBlock) && !/applyPackSeeThrough/.test(updateBlock)
);
check(
  "game wires pack fade + paint",
  /updatePackSeeThrough/.test(game) &&
    /paintPackSeeThrough/.test(game) &&
    /_fadeBlockingPack/.test(game) &&
    /_paintBlockingPack/.test(game)
);
check(
  "player car is never in the fade pack",
  /mesh !== this\.playerMesh/.test(game)
);
check(
  "POV / title / menu skip the ghost",
  /CAMERA\.views\[this\.camMode\]\.id !== "pov"/.test(game)
);
check(
  "solid pack for mirror, then ghost for chase",
  /_paintBlockingPack\(0\)[\s\S]{0,80}_renderMirror\(\)[\s\S]{0,220}_paintBlockingPack\(1\)/.test(game)
);
check(
  "game + track share occlusion-fade.js?v=8",
  /occlusion-fade\.js\?v=7/.test(game) && /occlusion-fade\.js\?v=7/.test(track)
);
check(
  "game imports track.js?v=177+",
  Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 177
);
check("cache-bust chain", cacheOk && Number(gameV) >= 376, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "blocking rivals go transparent"}`);
process.exit(fail ? 1 : 0);
