#!/usr/bin/env node
/**
 * qa-sprint-desert-tumble.mjs — Desert plants only saguaros / rocks / scrub,
 * and real tumbleweeds roll occasionally.
 *
 * RUN: node tools/qa-sprint-desert-tumble.mjs
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

console.log(`DESERT CACTUS / TUMBLEWEED  ·  ${new Date().toISOString()}\n`);

const track = read("js/tracks/track.js");
const kit = read("js/tracks/prop-kit.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const crowd = read("js/tracks/crowd.js");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const desertKit = (kit.match(/const DESERT_NATURE = Object\.freeze\(\[([\s\S]*?)\]\)/) || [])[1] || "";
check("DESERT_NATURE keeps cactus_tall", /cactus_tall/.test(desertKit));
check("DESERT_NATURE drops cactus_short", !/cactus_short/.test(desertKit));
check("DESERT_NATURE drops palms", !/tree_palm/.test(desertKit));
check("DESERT_NATURE drops cone / default trees", !/tree_cone/.test(desertKit) && !/tree_default/.test(desertKit));
check("DESERT_NATURE keeps rocks", /rock_largeA/.test(desertKit) && /rock_tallA/.test(desertKit));

check("no cactus_short backdrop plant", !/_addHdBackdrop\("cactus_short"/.test(track));
check("backdrop cactus is cactus_tall only", /_addHdBackdrop\("cactus_tall"/.test(track));
check("desert does not plant acacia/palms on the shoulder", !/SAFARI_KINDS/.test(track));
check("desert does not instance tree_cone crowns", !/_addHdNature\("tree_cone"/.test(track));
check("desert plants tall sandstone instead of trees", /_addHdNature\("rock_tallA"/.test(track));
check("cacti instance cactus_tall", /propNatureMaterial\("cactus_tall"\)/.test(track));
check("real tumbleweed geo", /function tumbleweedGeometry/.test(track));
check("tumbleweeds planted on Desert", /_addDesertTumbleweeds/.test(track));
check("tumbleweeds tick / roll", /_tickTumbleweeds/.test(track) && /w\.tumbling/.test(track));
check("tumbleweed is a twig ball (cylinders + tori)", /TorusGeometry/.test(track) && /CylinderGeometry/.test(track));

check("cache main.js ↔ index.html", cacheOk, `main ${mainV} / index ${gameV}`);
check("game imports track.js?v=195+", Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 195);
check("prop-kit.js?v=22+", Number((game.match(/prop-kit\.js\?v=(\d+)/) || [])[1]) >= 22);
check("track + crowd share prop-kit version", (track.match(/prop-kit\.js\?v=(\d+)/) || [])[1] === (crowd.match(/prop-kit\.js\?v=(\d+)/) || [])[1]);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "Desert scenery uses saguaros, rocks, and rolling tumbleweeds"}`);
process.exit(fail ? 1 : 0);
