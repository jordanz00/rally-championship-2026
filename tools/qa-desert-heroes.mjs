#!/usr/bin/env node
/**
 * Desert Stage 1 Namaqualand heroes — files + plant path + cache bust.
 *
 * RUN: node tools/qa-desert-heroes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const HEROES = [
  "desert_hero_boulder_a",
  "desert_hero_boulder_b",
  "desert_hero_boulder_c",
  "desert_hero_boulder_d",
  "desert_hero_boulder_e",
  "desert_hero_rocks",
  "desert_hero_stones",
  "desert_hero_sand_rocks",
  "desert_hero_quiver_a",
  "desert_hero_quiver_b",
  "desert_hero_scrub",
  "desert_hero_othonna",
];

console.log(`DESERT HEROES  ·  ${new Date().toISOString()}\n`);

for (const kind of HEROES) {
  check(`GLB ${kind}`, exists(`assets/props/${kind}.glb`));
}

const kit = read("js/tracks/prop-kit.js");
const track = read("js/tracks/track.js");
const desert = read("js/tracks/desert-pbr.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const attr = read("assets/props/ATTRIBUTION.txt");
const registry = read("docs/env-asset-registry.json");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("DESERT_HERO_ROCK_KINDS export", /export const DESERT_HERO_ROCK_KINDS/.test(kit));
check("DESERT_HERO_PLANT_KINDS export", /export const DESERT_HERO_PLANT_KINDS/.test(kit));
check("DESERT_NATURE includes heroes", /DESERT_HERO_KINDS/.test(kit) && /const DESERT_NATURE/.test(kit));
check("_plantDesertProp wired", /_plantDesertProp\s*\(/.test(track) && /desertHeroBags/.test(track));
check("Kenney far-only plant path", /Far \/ no-hero fallback/.test(track));
check("photo normals on desert fast land", /Desert keeps photo normals/.test(track));
check("large sand tile", /TILE_SAND_M = 32/.test(desert));
check("ATTRIBUTION Namaqualand", /namaqualand_boulder/.test(attr) && /desert_hero_quiver/.test(attr));
check("registry DESERT_HERO_ROCKS", /"DESERT_HERO_ROCKS"/.test(registry));
check("registry DESERT_HERO_PLANTS", /"DESERT_HERO_PLANTS"/.test(registry));
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 1135 && Number(mainV) >= 1135,
  `main=${mainV} game=${gameV}`
);
check(
  "playerMesh null-safe on desert load",
  /Player car .* unavailable after stage load/.test(game) &&
    /Never wipe the race \/ load mesh/.test(game) &&
    /!isGltfCar\(id\) && !isTitleCarReady\(id\) && !isPhonePlay\(\)/.test(game)
);
check(
  "desert load not capped at 67%",
  /decimateDesertHeroGeo/.test(kit) &&
    /Do not cap at 0\.72/.test(track) &&
    /desertHeroLite/.test(kit)
);
check("track.js cache ≥456", Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 456);
check("prop-kit cache ≥61", Number((game.match(/prop-kit\.js\?v=(\d+)/) || [])[1]) >= 61);
check("desert-pbr cache ≥66", /desert-pbr\.js\?v=66/.test(game) || /desert-pbr\.js\?v=6[6-9]/.test(track));

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "desert heroes armed"}`);
process.exit(fail ? 1 : 0);
