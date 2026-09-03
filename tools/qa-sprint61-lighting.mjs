#!/usr/bin/env node
/**
 * Cinema daylight — sun sculpts the stage; shadows reach chase-cam mid-ground.
 *
 * RUN: node tools/qa-sprint61-lighting.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function sliceBlock(src, startKey, endKey) {
  const start = src.indexOf(startKey);
  const end = src.indexOf(endKey, start + 1);
  return start >= 0 && end > start ? src.slice(start, end) : "";
}

function num(block, key) {
  const m = block.match(new RegExp(`${key}:\\s*([0-9.]+)`));
  return m ? Number(m[1]) : NaN;
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`CINEMA DAYLIGHT  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const postfx = read("js/gfx/postfx.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const visual = sliceBlock(config, "export const VISUAL = {", "export const STREAM");
const gfx = sliceBlock(config, "export const GFX = {", "export const VISUAL");
const desert = sliceBlock(config, "  desert: {", "  forest: {");
const forest = sliceBlock(config, "  forest: {", "  mountain: {");
const mountain = sliceBlock(config, "  mountain: {", "  lakeside: {");
const lakeside = sliceBlock(config, "  lakeside: {", "  title: {");

check("post contrast is photographic, not washed", num(visual, "gradeContrast") >= 1.08, `contrast=${num(visual, "gradeContrast")}`);
check("vignette frames the stage", num(visual, "vignette") >= 0.14, `vignette=${num(visual, "vignette")}`);
check("screen-space AO is armed", num(visual, "aoStrength") >= 0.4 && /AO_FRAG/.test(postfx));
check("race shadow frustum covers chase mid-ground", num(gfx, "shadowExtentRace") >= 48, `extent=${num(gfx, "shadowExtentRace")}`);
check("shadow far plane reaches the sun follow", num(gfx, "shadowFar") >= 160, `far=${num(gfx, "shadowFar")}`);

function keyOwns(block, name) {
  const sun = num(block, "sunInt");
  const fill = num(block, "fillInt");
  const hemi = num(block, "hemi");
  return sun > fill * 8 && sun > hemi * 3.5;
}
check("Desert key sculpts, fill does not", keyOwns(desert, "desert"), `sun=${num(desert, "sunInt")} hemi=${num(desert, "hemi")}`);
check("Forest key sculpts, fill does not", keyOwns(forest, "forest"));
check("Mountain key sculpts, fill does not", keyOwns(mountain, "mountain"));
check("Lakeside key sculpts, fill does not", keyOwns(lakeside, "lakeside"));
check("Desert fog starts in the mid-field", num(desert, "fogNear") <= 200 && num(desert, "fogNear") >= 140, `near=${num(desert, "fogNear")}`);

check("ACES filmic path", /ACESFilmicToneMapping/.test(read("js/gfx/lighting-rig.js")));
check("depth-aware AO pass", /tDepth/.test(postfx) && /DepthTexture/.test(postfx));
check("vignette still scales with the uniform", /smoothstep\(0\.45, 1\.05, d\) \* vignette/.test(postfx));
check("postfx cache-bust", Number((game.match(/postfx\.js\?v=(\d+)/) || [])[1]) >= 15);
check("lighting-rig cache-bust", /lighting-rig\.js\?v=\d+/.test(game) && Number((game.match(/lighting-rig\.js\?v=(\d+)/) || [])[1]) >= 7);
const configV = (game.match(/config\.js\?v=(\d+)/) || [])[1];
check("config.js cache-bust", Number(configV) >= 148, `v=${configV}`);
check("cache-bust chain", cacheOk && Number(gameV) >= 468, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "cinema daylight — sun, shadows, AO"}`);
process.exit(fail ? 1 : 0);
