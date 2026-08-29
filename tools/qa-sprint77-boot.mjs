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
check("desert music is HTML-prefetched for race load (Sprint 39)", /desert\.mp3/.test(index) && /rel="prefetch"/.test(index));
check("title showroom is visible under the emblem", /#crt:has\(#screen-title\.active\) #game-view/.test(css) && /visibility:\s*visible/.test(css));
check("showroom canvas fades in, does not pop", /showroom-live/.test(css) && /showroom-live/.test(game));
check("black curtain CSS", /\.fx-curtain/.test(css) && /\.fx-curtain\.is-on/.test(css));
check("title DPR cap is showroom-soft", /titleMaxPixelRatio:\s*1\.(?:0|05|1[0-5]|25)/.test(config) && /titleMaxPixels:\s*1[0-9]{6}/.test(config));
check(
  "title shadow atlas is ≤1536 (boot stays cheap)",
  /titleShadowMap:\s*(?:512|1024|1536)/.test(config) && /GFX\.titleShadowMap/.test(game)
);
check("title boot is next-frame, not a 1.6s wait", /requestAnimationFrame\(\(\) => requestAnimationFrame\(bootGfx\)\)/.test(game) && !/, 1600\)/.test(game));
check("title loads attract car (LOD first)", /prepareTitleCar\(this\.carId\)/.test(game) && /tryRivalGltf/.test(read("js/cars/celica.js")));
check(
  "PRESS START warms LODs, not mid-attract hero garage",
  /_idleWarmAfterTitle/.test(game) &&
    /prepareRivalLods\(\(\) => this\._syncCarSelectButtons\(\)\)/.test(game) &&
    !/later\(\s*120,\s*\(\) => this\._warmGarage\(\)\)/.test(game)
);
check("title uses low postQuality string", /postQuality:\s*"low"/.test(config));
check("title present skips post on pad", /onPad \|\| countdownLite/.test(game) && /Title deliberately skips post RTs/.test(game));
check("IBL bake is deferred on splash", /_bakeSkyEnv\("title"\)/.test(game) && /_titleIblReady/.test(game));
check("showScreen fades through black", /fadeThroughBlack/.test(hud) && /FADE_OUT_MS/.test(hud) && /fx-curtain/.test(hud));
check("load bar trickles instead of hanging", /tricklePerSec/.test(hud) && /armLoadBar/.test(hud) && /scaleX/.test(hud));
check("loading fill is transform-driven", /transform:\s*scaleX\(0\)/.test(css));
check(
  "race start covers load with overlay then settles present",
  /showLoadingScreen/.test(game) && /_settleRacePresent/.test(game) && /screen-hud/.test(game)
);
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 425 && Number((game.match(/hud\.js\?v=(\d+)/) || [])[1]) >= 29,
  `main=${mainV} game=${gameV}`
);
check("css cache-bust", /game\.css\?v=(\d+)/.test(index) && Number((index.match(/game\.css\?v=(\d+)/) || [])[1]) >= 29);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "boot is cheap, fades are black, load bar trickles"}`);
process.exit(fail ? 1 : 0);
