#!/usr/bin/env node
/**
 * Sprint 59 — distance LOD for trees (GLB near / cards far) and rival shadows.
 *
 * RUN: node tools/qa-sprint59-lod.mjs
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

console.log(`SPRINT 59 MESH LOD  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const track = read("js/tracks/track.js");
const trees = read("js/tracks/trees.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("STREAM.lodNear / lodHysteresis", /lodNear:\s*110/.test(config) && /lodHysteresis:\s*24/.test(config));
check("treeCardKind + crownGeometry exported", /export function treeCardKind/.test(trees) && /export function crownGeometry/.test(trees));
check(
  "roadside trees plant hi GLB + lo cards",
  /_addLodTrees/.test(track) &&
    /lod: "hi"/.test(track) &&
    /lod: "lo"/.test(track) &&
    /userData\.lod = opts\.lod/.test(track)
);
check(
  "stream swaps hi/lo by camera distance",
  /lod === "hi"/.test(track) && /STREAM\.lodNear/.test(track) && /lodBand/.test(track)
);
check(
  "horizon trees stay on card LOD",
  /_addHdBackdrop[\s\S]{0,400}_isLodTreeKind[\s\S]{0,200}crownGeometry/.test(track)
);
check("far rivals drop shadow casters", /_applyRivalLod/.test(game) && /lodShadowCasters/.test(game));
const trackImportV = (game.match(/track\.js\?v=(\d+)/) || [])[1];
const configFromGame = (game.match(/config\.js\?v=(\d+)/) || [])[1];
const configFromTrack = (track.match(/config\.js\?v=(\d+)/) || [])[1];
check("track.js cache-bust", Number(trackImportV) >= 176, `v=${trackImportV}`);
check("config.js cache-bust", Number(configFromGame) >= 131 && Number(configFromTrack) >= 131, `game=${configFromGame} track=${configFromTrack}`);
check("cache-bust chain", cacheOk && Number(gameV) >= 376, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "distance LOD armed"}`);
process.exit(fail ? 1 : 0);
