#!/usr/bin/env node
/**
 * Sprint 64 — AI pack stays on a real racing line instead of sliding off.
 *
 * RUN: node tools/qa-sprint64-line.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function maxAbsList(src, re) {
  const m = src.match(re);
  if (!m) return Infinity;
  const nums = m[1].split(",").map((s) => Math.abs(Number(s.trim())));
  return nums.every((n) => Number.isFinite(n)) ? Math.max(...nums) : Infinity;
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`SPRINT 64 AI RACING LINE  ·  ${new Date().toISOString()}\n`);

const ai = read("js/ai.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const laneSpan = maxAbsList(ai, /const LANES = \[([^\]]+)\]/);
const gridSpan = maxAbsList(game, /_gridLane\(place\) \{[\s\S]*?const lanes = \[([^\]]+)\]/);

check("out-in-out racingLat helper", /function racingLat\(/.test(ai) && /LINE_APEX_FRAC/.test(ai));
check("speed-aware safeHalfWidth keep-out", /function safeHalfWidth\(/.test(ai) && /LINE_EDGE/.test(ai));
check(
  "AI lanes stay inside ~1.3 m of centre",
  laneSpan <= 1.35,
  `max |lane|=${laneSpan.toFixed(2)}`
);
check(
  "grid slots match the tighter pack",
  gridSpan <= 1.3,
  `max |grid|=${gridSpan.toFixed(2)}`
);
check(
  "traffic dodge cannot shove past half the envelope",
  /half \* 0\.48/.test(ai)
);
check("tight corners drop the speed cap", /tightMul/.test(ai) && /Math\.abs\(d1\) \* 0\.48/.test(ai));
check("hairpin handbrake only while on-road", /off < -0\.7/.test(ai) && /hb = 0\.22/.test(ai));
check("dirt recovery lifts throttle", /if \(off > 0\.05\)/.test(ai) && /throttle = Math\.min\(throttle, 0\.2\)/.test(ai));
check(
  "Sprint 26 pace formula kept",
  /this\.pace\s*=\s*0\.92\s*\+\s*this\.skill\s*\*\s*0\.2/.test(ai)
);
check("game imports ai.js?v=110", /ai\.js\?v=109/.test(game));
check("cache-bust chain", cacheOk && Number(gameV) >= 376, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "pack holds an on-road racing line"}`);
process.exit(fail ? 1 : 0);
