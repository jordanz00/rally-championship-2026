#!/usr/bin/env node
/**
 * Static proof: road/terrain projection uses stochastic multi-scale layers
 * and softer surface fades — not single-sheet wallpaper UV.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const pbr = read("js/gfx/pbr.js");
const sn = read("js/gfx/surface-noise.js");
const forest = read("js/tracks/forest-pbr.js");
const desert = read("js/tracks/desert-pbr.js");
const track = read("js/tracks/track.js");
const def = read("js/tracks/track-definition.js");
const index = read("index.html");
const main = read("js/main.js");
const game = read("js/game.js");

check("stochastic UV helper", /vec2 stochasticUv\(/.test(pbr));
check("macro/meso/micro layer weights", /wMacro/.test(pbr) && /wMeso/.test(pbr) && /wMicro/.test(pbr));
check("road organic v11 cache", /road-organic-v11-/.test(pbr));
check("soft layer dissolve masks", /smoothstep\( 0\.12, 0\.88, n6 \)/.test(pbr));
check("surface noise v6 (no GLSL reserved `patch`)", /sn-v6-/.test(sn) && /dust/.test(sn) && !/float patch\s*=/.test(sn));
check("forest larger tiles", /TILE_FLOOR_M = 5\.2/.test(forest) && /TILE_DIRT_M = 3\.6/.test(forest));
check("desert larger tiles", /TILE_SAND_M = 38/.test(desert) && /TILE_DIRT_M = 11\.5/.test(desert));
check("surface blend ≥200m", /const BLEND = 220/.test(track));
check("slide play lane", /PLAY_WIDTH = 1\.4/.test(def) && /PLAY_STRAIGHT = 2\./.test(def));
check("shoulder verge blend desert", /vergeEnd = 4\.6/.test(track) && /Compacted verge/.test(track));
check("cinematic vista fog", /vistaFar/.test(game) && /1\.48/.test(game));
check("pbr cache-bust v67+", Number((track.match(/pbr\.js\?v=(\d+)/) || [])[1]) >= 67 && Number((game.match(/pbr\.js\?v=(\d+)/) || [])[1]) >= 67);
check(
  "forest/desert pbr bumped",
  Number((track.match(/forest-pbr\.js\?v=(\d+)/) || [])[1]) >= 67 &&
    Number((track.match(/desert-pbr\.js\?v=(\d+)/) || [])[1]) >= 68
);
check("desert hero backdrop rocks", /desert_hero_boulder_a/.test(track) && /liveHeroes/.test(track));
check("sky horizon seam soft", /hs \* 0\.58/.test(read("js/sky.js")));

const mainV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
check("boot main/game 1146+", mainV >= 1146 && gameV >= 1146 && mainV === gameV, `main=${mainV} game=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  texture layers + stage beauty scale");
