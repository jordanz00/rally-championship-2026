#!/usr/bin/env node
/**
 * Consistent 60 Hz present contract (desktop).
 * RUN: node tools/qa-60fps.mjs
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

console.log(`60 FPS CONTRACT  ·  ${new Date().toISOString()}\n`);

const game = read("js/game.js");
const qm = read("js/gfx/quality-manager.js");
const tsr = read("js/gfx/tsr-upscaler.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("desktop targetFps 60", /GFX\.targetFps = 60/.test(game));
check("desktop never preferLock30", /GFX\.preferLock30 = false/.test(game));
check("desktop never forceLock30AtSettle", /GFX\.forceLock30AtSettle = false/.test(game));
check("desktop pins softScaleMin at 1", /GFX\.softScaleMin = 1/.test(game));
check("GO desktop full scale", /_softRenderScale = phoneRace \? 0\.62 : 1/.test(game));
check("lockRaceLook skips mid-stage sheds", /if \(!lockRaceLook\(\)\) \{/.test(game));
check("QualityManager still owns phone scale", /TARGET_MS = 16\.7/.test(qm) && /DOWN_HOLD = 6/.test(qm));
check("TSR quality is native shade", /quality: 1\.0/.test(tsr));
check("phone present budget still sheds", /ema > 18\.2/.test(game) && /if \(lockRaceLook\(\)\) return;/.test(game));
check("lockRenderFps caps present", /GFX\.lockRenderFps = true/.test(game));
check(
  "cache-bust",
  cacheOk && Number(mainV) >= 1094 && Number(gameV) >= 1094,
  `main=${mainV} game=${gameV}`
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "desktop 60 Hz contract"}`);
process.exit(fail ? 1 : 0);
