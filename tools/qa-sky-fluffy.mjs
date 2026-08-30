#!/usr/bin/env node
/**
 * qa-sky-fluffy.mjs — fluffy volumetric cumulus + lens flare + realistic atmosphere.
 * RUN: node tools/qa-sky-fluffy.mjs
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

console.log(`SKY FLUFFY CUMULUS + LENS FLARE  ·  ${new Date().toISOString()}\n`);

const sky = read("js/sky.js");
const game = read("js/game.js");
const config = read("js/config.js");
const main = read("js/main.js");
const index = read("index.html");

check("planet-shell raymarch retained", /technique:\s*"planet-shell-raymarch"/.test(sky) && /volumetricClouds\(/.test(sky));
check("fluffy Worley cores (not smoke sheet)", /worleyPuff\(/.test(sky) && /pow\(core/.test(sky) && /WEATHER_CONTRAST = 3\.15/.test(sky));
check("taller cloud shell", /CLOUD_OUTER = 9\.92/.test(sky));
check("sun peek through gaps", /peek/.test(sky) && /edgeSoft/.test(sky));
check("multiple-scatter fluff lift", /float ms = dens/.test(sky));
check("lit-top sugar + silver rim", /float sugar = powder/.test(sky) && /Extra silver lining/.test(sky));
check("cinema 16×3 raymarch", /cinemaViewSteps:\s*16/.test(sky) && /maxLightSteps:\s*3/.test(sky));
check("procedural lens flare", /vec3 lensFlare\(/.test(sky) && /uLensFlare/.test(sky) && /uCamFwd/.test(sky));
check("anamorphic streak + ghosts", /Anamorphic/.test(sky) && /Ghost orbs/.test(sky));
check("camera forward wired from game", /getWorldDirection\(this\._skyCamFwd\)/.test(game) && /tickSky\(this\.sky,.+this\._skyCamFwd\)/.test(game));
check("VISUAL.lensFlare flag", /lensFlare:\s*true/.test(config));
check("deeper desert zenith blue", /skyZenith:\s*0x063888/.test(config) && /sunBloom:\s*1\.28/.test(config));
check("sky.js?v=37+", Number((game.match(/sky\.js\?v=(\d+)/) || [])[1]) >= 37);
check("config.js?v=170+", Number((game.match(/config\.js\?v=(\d+)/) || [])[1]) >= 170);
check("boot cache ?v=548+", Number((index.match(/main\.js\?v=(\d+)/) || [])[1]) >= 548);
check("main→game lockstep", (main.match(/game\.js\?v=(\d+)/) || [])[1] === (index.match(/main\.js\?v=(\d+)/) || [])[1]);
check("Beer-Lambert + HG + powder retained", /exp\(-stepOd\)/.test(sky) && /hgPhase\(/.test(sky) && /powder/.test(sky));
check("stage palettes present", /STAGE_CLOUD_PALETTES/.test(sky) && /desert:/.test(sky) && /title:/.test(sky));

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "fluffy sky + lens flare armed"}`);
process.exit(fail ? 1 : 0);
