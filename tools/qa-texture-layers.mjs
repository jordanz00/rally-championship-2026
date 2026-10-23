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
check("road organic v9 cache", /road-organic-v9-/.test(pbr));
check("soft layer dissolve masks", /smoothstep\( 0\.18, 0\.82, n6 \)/.test(pbr));
check("surface noise v3", /sn-v3-/.test(sn) && /dust/.test(sn));
check("forest larger tiles", /TILE_FLOOR_M = 4\.1/.test(forest) && /TILE_DIRT_M = 2\.9/.test(forest));
check("desert larger tiles", /TILE_SAND_M = 11\.5/.test(desert) && /TILE_DIRT_M = 3\.2/.test(desert));
check("surface blend ≥160m", /const BLEND = 168/.test(track));
check("wider play lane", /PLAY_WIDTH = 1\.52/.test(def) && /PLAY_STRAIGHT = 2\.2/.test(def));
check("shoulder verge blend desert", /vergeEnd = 3\.4/.test(track) && /Compacted verge/.test(track));
check("cinematic vista fog", /vistaFar/.test(game) && /1\.32/.test(game));
check("pbr cache-bust v60", /pbr\.js\?v=60/.test(track) && /pbr\.js\?v=60/.test(game));
check("forest/desert pbr v64", /forest-pbr\.js\?v=64/.test(track) && /desert-pbr\.js\?v=64/.test(track));

const mainV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
check("boot main/game 1093+", mainV >= 1093 && gameV >= 1093 && mainV === gameV, `main=${mainV} game=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  texture layers + stage beauty scale");
