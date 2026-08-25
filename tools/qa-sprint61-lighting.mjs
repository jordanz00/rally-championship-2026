#!/usr/bin/env node
/**
 * Sprint 61 — brighter, lower-contrast lighting (fill/hemi/ambient up, sun and post contrast down).
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

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`SPRINT 61 LIGHTING  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const postfx = read("js/gfx/postfx.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const visual = sliceBlock(config, "export const VISUAL = {", "export const STREAM");
const desert = sliceBlock(config, "  desert: {", "  forest: {");
const forest = sliceBlock(config, "  forest: {", "  mountain: {");
const mountain = sliceBlock(config, "  mountain: {", "  lakeside: {");
const lakeside = sliceBlock(config, "  lakeside: {", "  title: {");
const title = sliceBlock(config, "  title: {", "export const TUNNEL");
const tunnel = sliceBlock(config, "export const TUNNEL = {", "headEmissive:");

check("post gradeContrast is below 1.0", /gradeContrast:\s*0\.96/.test(visual));
check("vignette is light, not a corner crush", /vignette:\s*0\.08/.test(visual));
check(
  "IBL fill is above 1.0",
  /worldEnvIntensity:\s*1\.18/.test(visual) && /carEnvIntensity:\s*1\.12/.test(visual)
);
check("highlight rolloff tames punch", /highlightRolloff:\s*0\.24/.test(visual));

check(
  "Desert: more fill/hemi/ambient, less sun punch",
  /hemi:\s*1\.22/.test(desert) &&
    /sunInt:\s*2\.05/.test(desert) &&
    /fillInt:\s*0\.82/.test(desert) &&
    /ambientInt:\s*0\.64/.test(desert) &&
    /exposure:\s*1\.4/.test(desert) &&
    /worldEnv:\s*1\.16/.test(desert)
);
check(
  "Forest follows the fill recipe",
  /hemi:\s*1\.24/.test(forest) &&
    /sunInt:\s*1\.98/.test(forest) &&
    /fillInt:\s*0\.78/.test(forest) &&
    /ambientInt:\s*0\.64/.test(forest) &&
    /exposure:\s*1\.42/.test(forest)
);
check(
  "Mountain follows the fill recipe",
  /hemi:\s*1\.2/.test(mountain) &&
    /sunInt:\s*2\.05/.test(mountain) &&
    /fillInt:\s*0\.78/.test(mountain) &&
    /ambientInt:\s*0\.62/.test(mountain) &&
    /exposure:\s*1\.42/.test(mountain)
);
check(
  "Lakeside follows the fill recipe",
  /hemi:\s*1\.22/.test(lakeside) &&
    /sunInt:\s*2\.0/.test(lakeside) &&
    /fillInt:\s*0\.8/.test(lakeside) &&
    /ambientInt:\s*0\.64/.test(lakeside) &&
    /exposure:\s*1\.42/.test(lakeside)
);
check(
  "Title pad is brighter without a harder key",
  /hemi:\s*1\.48/.test(title) &&
    /sunInt:\s*2\.12/.test(title) &&
    /fillInt:\s*1\.68/.test(title) &&
    /ambientInt:\s*0\.74/.test(title) &&
    /exposure:\s*1\.74/.test(title)
);
check(
  "Tunnel shade keeps fill instead of going black",
  /ambientFloor:\s*0\.82/.test(tunnel) && /hemiRetain:\s*0\.72/.test(tunnel) && /fillRetain:\s*0\.48/.test(tunnel)
);

check(
  "vignette strength actually scales (no baked +d crush)",
  /smoothstep\(0\.45, 1\.05, d\) \* vignette/.test(postfx)
);
check(
  "postfx still grades from VISUAL.gradeContrast",
  /VISUAL\.gradeContrast/.test(postfx) && /VISUAL\.vignette/.test(postfx)
);
check("lighting-rig + postfx cache-bust", /lighting-rig\.js\?v=4/.test(game) && /postfx\.js\?v=11/.test(game));
check("sky cache-bust", /sky\.js\?v=19/.test(game));
const configV = (game.match(/config\.js\?v=(\d+)/) || [])[1];
check("config.js cache-bust", Number(configV) >= 131, `v=${configV}`);
check("cache-bust chain", cacheOk && Number(gameV) >= 376, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "brighter, softer lighting armed"}`);
process.exit(fail ? 1 : 0);
