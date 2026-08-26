#!/usr/bin/env node
/**
 * Sprint 77 — fast boot, cheap title showroom, black fades, trickle load bar.
 *
 * RUN: node tools/qa-sprint77-boot.mjs
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

console.log(`SPRINT 77 BOOT / TITLE / LOAD  ·  ${new Date().toISOString()}\n`);

const index = read("index.html");
const css = read("css/game.css");
const hud = read("js/ui/hud.js");
const game = read("js/game.js");
const main = read("js/main.js");
const config = read("js/config.js");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("boot curtain in HTML", /id="fx-curtain"/.test(index) && /fx-curtain is-on/.test(index));
check("boot curtain fades on first paint", /c.classList.remove\("is-on"\)/.test(index));
check("desert music is not HTML-prefetched (boot bandwidth)", !/desert\.mp3/.test(index));
check("title showroom is visible under the emblem", /#crt:has\(#screen-title\.active\) #game-view/.test(css) && /visibility:\s*visible/.test(css));
check("showroom canvas fades in, does not pop", /showroom-live/.test(css) && /showroom-live/.test(game));
check("black curtain CSS", /\.fx-curtain/.test(css) && /\.fx-curtain\.is-on/.test(css));
check("title DPR cap is showroom-sharp", /titleMaxPixelRatio:\s*1\.5/.test(config) && /titleMaxPixels:\s*2400000/.test(config));
check("title shadow atlas is 1024 (boot stays cheap)", /titleShadowMap:\s*1024/.test(config) && /GFX\.titleShadowMap/.test(game));
check("title boot is next-frame, not a 1.6s wait", /requestAnimationFrame\(\(\) => requestAnimationFrame\(bootGfx\)\)/.test(game) && !/, 1600\)/.test(game));
check("title loads the hero car (LOD fallback)", /prepareTitleCar\(this\.carId\)/.test(game) && /tryLocalGltf/.test(read("js/cars/celica.js")));
check("full garage waits for PRESS START", /this\._warmGarage\(\)/.test(game) && !/\.then\(\(\) => prepareCelica\(\)\)/.test(game));
check("title skips post-process RTs", /this\.post\.enabled = false/.test(game) && /this\.post && !onTitle/.test(game));
check("IBL bake is deferred on splash", /_bakeSkyEnv\("title"\)/.test(game) && /_titleIblReady/.test(game));
check("showScreen fades through black", /fadeThroughBlack/.test(hud) && /FADE_OUT_MS/.test(hud) && /fx-curtain/.test(hud));
check("load bar trickles instead of hanging", /tricklePerSec/.test(hud) && /armLoadBar/.test(hud) && /scaleX/.test(hud));
check("loading fill is transform-driven", /transform:\s*scaleX\(0\)/.test(css));
check("race start awaits the loading fade", /showLoadingScreen/.test(game) && /await showScreen\("screen-hud"\)/.test(game));
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 425 && /hud\.js\?v=29/.test(game),
  `main=${mainV} game=${gameV}`
);
check("css cache-bust", /game\.css\?v=29/.test(index));

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "boot is cheap, fades are black, load bar trickles"}`);
process.exit(fail ? 1 : 0);
