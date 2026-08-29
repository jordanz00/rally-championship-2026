#!/usr/bin/env node
/**
 * Sprint 58 — title attract car uses the rival LOD so splash is not blocked
 * on the 7 MB hero + cockpit GLB.
 *
 * RUN: node tools/qa-sprint58-title-lod.mjs
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

console.log(`SPRINT 58 TITLE LOD  ·  ${new Date().toISOString()}\n`);

const celica = read("js/cars/celica.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const titleStart = celica.indexOf("export function createTitleCar");
const rivalStart = celica.indexOf("export function createRivalCar");
const titleSlice = titleStart >= 0 && rivalStart > titleStart ? celica.slice(titleStart, rivalStart) : "";

check(
  "prepareTitleCar loads rival LOD first (hero is fallback)",
  /export async function prepareTitleCar/.test(celica) &&
    /await tryRivalGltf\(chassis\)/.test(celica) &&
    celica.indexOf("await tryRivalGltf(chassis)") < celica.indexOf("await tryLocalGltf(chassis)")
);
check(
  "createTitleCar prefers rival LOD templates, hides cockpit",
  /rivalTemplates\[chassis\]/.test(titleSlice) &&
    titleSlice.indexOf("rivalTemplates[chassis]") < titleSlice.indexOf("templates[chassis]") &&
    /hideHeavyInterior\(clone\)/.test(celica) &&
    /titleLod = true/.test(titleSlice)
);
check(
  "title boot shows the attract car, garage warms after",
  /prepareTitleCar\(this\.carId\)/.test(game) &&
    /_markShowroomLive/.test(game) &&
    /_warmGarage/.test(game)
);
check(
  "title mesh is createTitleCar, not createPlayerCar",
  /_showTitleLod/.test(game) && /createTitleCar\(id\)/.test(game)
);
check(
  "race promotes LOD to hero before the grid",
  /_promotePlayerCar/.test(game) &&
    /Loading cars/.test(game) &&
    /await Promise\.all\(\[prepareHeroCar\(this\.carId\)/.test(game)
);
const celicaV = (game.match(/celica\.js\?v=(\d+)/) || [])[1];
check("celica.js cache-bust", Number(celicaV) >= 141, `game → celica v=${celicaV}`);
check("cache-bust chain", cacheOk && Number(gameV) >= 528, `main=${mainV} game=${gameV}`);

const hero = path.join(ROOT, "assets/celica/gt4.glb");
const lod = path.join(ROOT, "assets/celica/rival.glb");
if (fs.existsSync(hero) && fs.existsSync(lod)) {
  const heroB = fs.statSync(hero).size;
  const lodB = fs.statSync(lod).size;
  check(
    "Celica rival.glb is smaller than hero",
    lodB > 64 && lodB < heroB,
    `${(lodB / 1e6).toFixed(1)} MB LOD vs ${(heroB / 1e6).toFixed(1)} MB hero`
  );
} else {
  check("Celica rival.glb is on disk", fs.existsSync(lod), lod);
}

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "title attract uses the hero car"}`);
process.exit(fail ? 1 : 0);
