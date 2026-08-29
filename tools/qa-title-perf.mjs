#!/usr/bin/env node
/**
 * Title / SELECT MODE quality budget — attract must stay lighter than race.
 *
 * RUN: node tools/qa-title-perf.mjs
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

console.log(`TITLE PERF BUDGET  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const titleBlock = (config.match(/export const TITLE_SHOWROOM = \{[\s\S]*?\n\};/) || [])[0] || "";
const titlePr = Number((config.match(/titleMaxPixelRatio:\s*([\d.]+)/) || [])[1]);
const titlePx = Number((config.match(/titleMaxPixels:\s*(\d+)/) || [])[1]);
const titleShadow = Number((config.match(/titleShadowMap:\s*(\d+)/) || [])[1]);
const reflectEvery = Number((titleBlock.match(/reflectEvery:\s*(\d+)/) || [])[1]);
const skyQ = (titleBlock.match(/skyQuality:\s*"(\w+)"/) || [])[1];
const shadowEvery = Number((titleBlock.match(/shadowEvery:\s*(\d+)/) || [])[1]);

check("title DPR ≤ 1.15", titlePr > 0 && titlePr <= 1.15, `titleMaxPixelRatio=${titlePr}`);
check("title pixel budget ≤ 1.6M", titlePx > 0 && titlePx <= 1600000, `titleMaxPixels=${titlePx}`);
check("title shadow atlas ≤ 1536", titleShadow > 0 && titleShadow <= 1536, `titleShadowMap=${titleShadow}`);
check(
  "menu present Hz ≤ 30 (clicks stay responsive)",
  Number((titleBlock.match(/menuPresentHz:\s*(\d+)/) || [])[1]) > 0 &&
    Number((titleBlock.match(/menuPresentHz:\s*(\d+)/) || [])[1]) <= 30,
  `menuPresentHz=${(titleBlock.match(/menuPresentHz:\s*(\d+)/) || [])[1]}`
);
check(
  "TITLE_SHOWROOM sky is low|medium (not cinema)",
  skyQ === "low" || skyQ === "medium",
  `skyQuality=${skyQ}`
);
check(
  "title cube cadence off or ≥ 12",
  reflectEvery === 0 || reflectEvery >= 12,
  `reflectEvery=${reflectEvery}`
);
check("title shadowEvery ≥ 4", shadowEvery >= 4, `shadowEvery=${shadowEvery}`);
check("title applies setSkyQuality from TITLE_SHOWROOM", /setSkyQuality\(this\.sky,\s*titleSkyQ\)/.test(game));
check("title skips post RTs on resize", /this\.post && !onTitle/.test(game) && /Title deliberately skips post RTs/.test(game));
check("title present is a single pass", /onPad \|\| countdownLite/.test(game) || /if \(onPad \|\| countdownLite/.test(game));
check("title skips pack / stream work", /No stage \/ pack on the attract pad/.test(game));
check("cube capture pauses during preload", /_preloadBuilding\) return/.test(game));
check(
  "PRESS START warms rival LODs, not hero garage",
  /prepareRivalLods\(\(\) => this\._syncCarSelectButtons\(\)\)/.test(game) &&
    !/later\(\s*120,\s*\(\) => this\._warmGarage\(\)\)/.test(game)
);
check(
  "no Track.create on title/menu",
  /Never build during attract \/ SELECT MODE/.test(game) &&
    /No Track\.create here/.test(game)
);
check("race settle restores perf tier", /_settleRacePresent/.test(game) && /startTier: raceStartTier\(\)/.test(game));
check("unlockFpsOnTitle is off (60 Hz cap)", /unlockFpsOnTitle:\s*false/.test(config));
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 528 && Number(mainV) >= 528,
  `main=${mainV} game=${gameV}`
);
check("config import bumped", /config\.js\?v=16[3-9]/.test(game) || /config\.js\?v=1[7-9]\d/.test(game));

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "title/menu has a dedicated lighter budget"}`);
process.exit(fail ? 1 : 0);
