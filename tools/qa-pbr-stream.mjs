#!/usr/bin/env node
/**
 * Ground PBR stream — 1k boot, 2k in the background.
 *
 * RUN: node tools/qa-pbr-stream.mjs
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

console.log(`PBR STREAM  ·  ${new Date().toISOString()}\n`);

const stream = read("js/tracks/pbr-stream.js");
const desert = read("js/tracks/desert-pbr.js");
const forest = read("js/tracks/forest-pbr.js");
const tunnel = read("js/tracks/forest-tunnel.js");
const track = read("js/tracks/track.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("bootPbrSet exists", /export async function bootPbrSet/.test(stream));
check("2k upgrade path", /_diff_2k\.jpg/.test(stream) && /wantHiMaps/.test(stream) && /enqueueHi/.test(stream));
check("shared-source cloneTracked", /export function cloneTracked/.test(stream));
check("desert uses bootPbrSet", /bootPbrSet/.test(desert));
check("forest uses bootPbrSet", /bootPbrSet/.test(forest));
check("tunnel uses bootTunnelSet", /bootTunnelSet/.test(tunnel));
check("track imports pbr v56+", Number((track.match(/desert-pbr\.js\?v=(\d+)/) || [])[1]) >= 56);
check("hold 2k uploads across GO", /export function holdGpuUploads/.test(stream) && /holdGpuUploads\(/.test(game));
check("release 2k after launch present hold", /export function releaseGpuUploads/.test(stream) && /releaseGpuUploads\(/.test(game));
check("phones skip 2k ground maps", /Android\|iPhone\|iPod\|Mobile/.test(stream));
check("title prefetches desert 1k albedo", /sand_diff_1k\.jpg/.test(game) && /tarmac_diff_1k\.jpg/.test(game));

for (const stem of ["sand", "dirt", "gravel", "tarmac"]) {
  check(
    `${stem} 1k albedo on disk`,
    fs.existsSync(path.join(ROOT, `assets/env/desert/${stem}_diff_1k.jpg`))
  );
}
for (const stem of ["dirt_floor", "gravel_road", "forest_floor"]) {
  check(
    `${stem} 1k albedo on disk`,
    fs.existsSync(path.join(ROOT, `assets/env/forest/${stem}_diff_1k.jpg`))
  );
}

const hiCount = ["sand", "dirt", "gravel", "tarmac"]
  .map((s) => fs.existsSync(path.join(ROOT, `assets/env/desert/${s}_diff_2k.jpg`)))
  .filter(Boolean).length;
check("Desert 2k albedo on disk", hiCount === 4, `${hiCount}/4`);

check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 819 && Number(mainV) >= 819,
  `main=${mainV} game=${gameV}`
);
check("track.js cache ≥365", Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 365);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "pbr stream armed"}`);
process.exit(fail ? 1 : 0);
