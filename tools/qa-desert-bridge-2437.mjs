#!/usr/bin/env node
/**
 * Desert finale approach (~2437–2441 m) — rock bridge CUT (Sprint 524).
 *
 * RUN: node tools/qa-desert-bridge-2437.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`DESERT BRIDGE CUT GATE  ·  ${new Date().toISOString()}\n`);
console.log("static");

const heroStart = trackSrc.indexOf("_addDesertHeroLandmark() {");
const heroSlice = heroStart >= 0 ? trackSrc.slice(heroStart, heroStart + 280) : "";
const markStart = trackSrc.indexOf("_markDesertUnderpassCorridors() {");
const markSlice = markStart >= 0 ? trackSrc.slice(Math.max(0, markStart - 420), markStart + 220) : "";

check(
  "hero landmark does not spawn bridge",
  /Intentionally empty/.test(heroSlice) && !/this\._addDesertRockBridge\(/.test(heroSlice)
);
check(
  "underpass corridors not opened for missing arch",
  /CUT \(Sprint 524\)/.test(markSlice) && !/pt\.underpass = true/.test(markSlice)
);
check(
  "road edge exposes finite y for skirts/kerbs",
  /y: 0\.5 \* \(yL \+ yR\)/.test(trackSrc) && /yL,\s*\n\s*yR,/.test(trackSrc)
);
check("kerbs use yL/yR not missing e.y", /e\.yL \+ 0\.02/.test(trackSrc) && /e\.yR \+ 0\.02/.test(trackSrc));
check("drift berms bump after strip", /bermsKept/.test(trackSrc) && /_stripLanePoses\(berms\)/.test(trackSrc));
check("game imports track.js?v=232+", Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 232);

const { gameV, ok: cacheOk } = readCacheVersions(main, index);
check("cache-bust v524+", cacheOk && Number(gameV) >= 524, `v=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  desert rock bridge cut from player path");
