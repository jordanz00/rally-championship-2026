#!/usr/bin/env node
/**
 * qa-sky-skybox.mjs — equirect HDR skybox (volumetric raymarch removed).
 * RUN: node tools/qa-sky-skybox.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

console.log(`SKY EQUIRECT SKYBOX  ·  ${new Date().toISOString()}\n`);

const sky = read("js/sky.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const perf = read("js/gfx/perf-tier.js");

check("technique is equirect-skybox", /technique:\s*"equirect-skybox"/.test(sky));
check("volumetric raymarch removed", !/volumetricClouds\(/.test(sky) && !/planet-shell-raymarch/.test(sky));
check("RGBELoader wired", /RGBELoader/.test(sky) && fs.existsSync(path.join(ROOT, "vendor/RGBELoader.js")));
check(
  "stage HDR map present",
  /STAGE_SKYBOX/.test(sky) &&
    /kloofendal_partly_cloudy_2k\.hdr/.test(sky) &&
    /kloppenheim_06_2k\.hdr/.test(sky) &&
    /sunflowers_2k\.hdr/.test(sky) &&
    /kloofendal_28d_misty_2k\.hdr/.test(sky) &&
    /lakeside:\s*"assets\/sky\/kloofendal_28d_misty_2k\.hdr"/.test(sky)
);
check(
  "HDR files on disk",
  fs.existsSync(path.join(ROOT, "assets/sky/kloofendal_partly_cloudy_2k.hdr")) &&
    fs.existsSync(path.join(ROOT, "assets/sky/kloppenheim_06_2k.hdr")) &&
    fs.existsSync(path.join(ROOT, "assets/sky/sunflowers_2k.hdr")) &&
    fs.existsSync(path.join(ROOT, "assets/sky/kloofendal_28d_misty_2k.hdr"))
);
check("ATTRIBUTION present", fs.existsSync(path.join(ROOT, "assets/sky/ATTRIBUTION.txt")));
check("MeshBasicMaterial BackSide skybox", /MeshBasicMaterial/.test(sky) && /BackSide/.test(sky));
check("userData.volumetricClouds false", /volumetricClouds:\s*false/.test(sky) || /volumetricClouds = false/.test(sky));
check("setSkyQuality retained (no-op API)", /export function setSkyQuality/.test(sky));
check("tickSky retained (no-op API)", /export function tickSky/.test(sky));
check("sky horizon tint from LIGHTING", /horizonGlow/.test(sky) && /horizonStrength/.test(sky));
check("game awaits/applies skybox before IBL", /applySky\(this\.sky/.test(game) && /isSkyReady/.test(game));
check("cloud step caps are zero", /maxViewSteps:\s*0/.test(sky) && /maxCloudViewSteps:\s*0/.test(perf));
check("sky.js?v=40+", Number((game.match(/sky\.js\?v=(\d+)/) || [])[1]) >= 40);
check("boot cache ?v=549+", Number((index.match(/main\.js\?v=(\d+)/) || [])[1]) >= 549);
check(
  "main→game lockstep",
  (main.match(/game\.js\?v=(\d+)/) || [])[1] === (index.match(/main\.js\?v=(\d+)/) || [])[1]
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "equirect skybox armed"}`);
process.exit(fail ? 1 : 0);
