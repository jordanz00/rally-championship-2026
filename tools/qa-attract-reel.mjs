#!/usr/bin/env node
/**
 * Attract reel — music-video title coverage, not a pad spinner.
 *
 * RUN: node tools/qa-attract-reel.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`ATTRACT REEL  ·  ${new Date().toISOString()}\n`);

const reel = read("js/cinema/attract-reel.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const css = read("css/game.css");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("AttractReel export", /export class AttractReel/.test(reel));
check("AttractDirector shots", /bumper/.test(reel) && /whip/.test(reel) && /headon/.test(reel) && /smash/.test(reel));
check("no Track import in reel", !/from ["'].*tracks\/track/.test(reel));
check("closed rally spline", /KNOTS/.test(reel) && /CatmullRomCurve3/.test(reel));
check("game starts reel after IBL", /_startAttractReel/.test(game) && /_revealTitleShowroom/.test(game));
check("game stops reel before race", /_stopAttractReel\(\)/.test(game));
check("attract-fx overlay in index", /id="attract-fx"/.test(index) && /attract-letterbox/.test(index));
check("letterbox + flash CSS", /attract-letterbox/.test(css) && /attract-flash/.test(css) && /attract-live/.test(css));
check("title CRT is dark for footage", /#crt\.is-title/.test(css) && /#050705/.test(css));
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 967 && Number(mainV) >= 967,
  `main=${mainV} game=${gameV}`
);
check("game imports attract-reel", Number((game.match(/attract-reel\.js\?v=(\d+)/) || [])[1]) >= 8);
check("css bust ≥57", /game\.css\?v=57/.test(index));
check("no giant pale points", !/size: 0\.42/.test(reel) && !/0xd8c4a0/.test(reel));
check("dirt grit sprite + small point cap", /makeGritSprite/.test(reel) && /min\(aSize \* uScale \/ dist, 5\.5\)/.test(reel));
check("tire tracks on the ribbon", /attract-tracks/.test(reel) && /_stampTracks/.test(reel));
check("dust is dirt brown", /0\.4 \* shade, 0\.26 \* shade, 0\.12 \* shade/.test(reel));

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "attract reel armed"}`);
process.exit(fail ? 1 : 0);
