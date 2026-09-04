#!/usr/bin/env node
/**
 * Sprint 88 — car pick never freezes the tab.
 *
 * Championship used to start Track.create on the click turn while yieldFrame
 * resolved via queueMicrotask, so Chrome never painted the loading screen.
 * Music kept playing; the page hung.
 *
 * RUN: node tools/qa-sprint88-car-pick.mjs
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

console.log(`SPRINT 88 CAR PICK  ·  ${new Date().toISOString()}\n`);

const game = read("js/game.js");
const track = read("js/tracks/track.js");
const hud = read("js/ui/hud.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check(
  "game.js yieldFrame is a macrotask (no queueMicrotask)",
  /function yieldFrame\(/.test(game) &&
    /requestAnimationFrame\(fire\)/.test(game) &&
    /setTimeout\(fire, 0\)/.test(game) &&
    !/queueMicrotask\(fire\)/.test(game)
);
check(
  "track.js yieldFrame is a macrotask (no queueMicrotask)",
  /function yieldFrame\(/.test(track) &&
    /requestAnimationFrame\(fire\)/.test(track) &&
    /setTimeout\(fire, 0\)/.test(track) &&
    !/queueMicrotask\(fire\)/.test(track)
);
check(
  "championship car pick starts one race, not a parallel preload",
  /if \(this\.mode === "championship"\) \{[\s\S]*?this\._beginRace\(next\);\s*return;/.test(game) &&
    !/this\._scheduleTrackPreload\(next\);\s*this\._beginRace\(next\)/.test(game)
);
check(
  "loading screen fades through a short curtain (not a hard cut)",
  /return showScreen\("screen-loading", \{ outMs:/.test(hud) && !/showScreen\("screen-loading", \{ instant: true \}\)/.test(hud)
);
check(
  "load→HUD waits for the progress bar, then soft-reveals",
  /waitLoadingBarSettled/.test(game) && /showScreen\("screen-hud", \{ outMs:/.test(game)
);
check(
  "_beginRace paints loading, then yields, then boots SFX / race",
  /await showLoadingScreen\(\{[\s\S]*?await yieldFrame\(\);\s*await yieldFrame\(\);[\s\S]*?_bootSfxGraph[\s\S]*?this\._startRace\(/.test(
    game
  )
);
check("game imports track.js?v=185+", Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 185);
check("game imports hud.js?v=33+", Number((game.match(/hud\.js\?v=(\d+)/) || [])[1]) >= 33);
check("cache-bust chain", cacheOk && Number(gameV) >= 425, `main=${mainV} game=${gameV}`);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "car pick yields a real frame before Track.create"}`
);
process.exit(fail ? 1 : 0);
