#!/usr/bin/env node
/**
 * Environment / texture detail — 2k stream, aniso, tighter tiles, hero LOD.
 *
 * RUN: node tools/qa-env-detail.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`ENV DETAIL  ·  ${new Date().toISOString()}\n`);

const stream = read("js/tracks/pbr-stream.js");
const forest = read("js/tracks/forest-pbr.js");
const desert = read("js/tracks/desert-pbr.js");
const tunnel = read("js/tracks/forest-tunnel.js");
const track = read("js/tracks/track.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const kit = read("js/tracks/prop-kit.js");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("2k albedo queues at boot", /_diff_2k\.jpg/.test(stream) && /enqueueHi/.test(stream));
check("2k apply uses aniso 16", /applyImage\(map, d2\.image, 16\)/.test(stream));
check("phones still skip 2k", /Android\|iPhone\|iPod\|Mobile/.test(stream));
check("forest tiles tighter than 2 m", /TILE_DIRT_M = 1\.45/.test(forest) && /TILE_FLOOR_M = 1\.5/.test(forest));
check("desert tiles tighter", /TILE_SAND_M = 5\.6/.test(desert) && /TILE_DIRT_M = 1\.55/.test(desert));
check("tunnel tile 1.45 m", /TILE_M = 1\.45/.test(tunnel));
check("cinema land segs without ?perf=high", /VISUAL\.tier \|\| 0\) >= 8/.test(track));
check("land paint 384 + aniso 16", /land-albedo-v7/.test(track) && /384 \* scale/.test(track));
check("hero mesh radius 64 m", /Math\.min\(64/.test(game));
check("nature shadows to 68 m", /Math\.max\(STREAM\.natureShadowFar \?\? 48, 68\)/.test(track));
check("prop kit aniso 16", /mat\.map\.anisotropy = 16/.test(kit));
check("pbr-stream v=5", /pbr-stream\.js\?v=5/.test(game) && /pbr-stream\.js\?v=5/.test(forest));
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 959 && Number(mainV) >= 959,
  `main=${mainV} game=${gameV}`
);
check("track.js cache ≥410", Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 410);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "env detail armed"}`);
process.exit(fail ? 1 : 0);
