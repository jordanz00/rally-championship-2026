#!/usr/bin/env node
/**
 * Sprint 81 — recorded 3-2-1-GO locked to the start-grid HUD.
 *
 * RUN: node tools/qa-sprint81-countdown-vo.mjs
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

const COUNT = ["count-3", "count-2", "count-1", "count-go"];

console.log(`SPRINT 81 COUNTDOWN VO  ·  ${new Date().toISOString()}\n`);

const engine = read("js/audio/engine.js");
const game = read("js/game.js");
const attr = read("assets/sfx/ATTRIBUTION.txt");
const navAttr = read("assets/sfx/nav/ATTRIBUTION.txt");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(read("js/main.js"), read("index.html"));

check("no speechSynthesis in engine", !/speechSynthesis/.test(engine));
check("count clips in NAV_CLIPS", COUNT.every((k) => engine.includes(`"${k}"`)));
check("countBeep plays VO then a light beep", /_playCountVo\(key\)/.test(engine) && /count-3/.test(engine));
check("countGo plays count-go", /_playCountVo\("count-go"\)/.test(engine));
check("HUD 3 fires with countBeep(3) when the screen is up", /flashMessage\("3"\)/.test(game) && /countBeep\(3\)/.test(game));
check("HUD 2/1 cross the remaining-time ticks", /flashMessage\("2"\)/.test(game) && /flashMessage\("1"\)/.test(game));
check("GO! and countGo on the same tick", /flashMessage\("GO!"\)/.test(game) && /countGo\(\)/.test(game));
check("countdown holds under the load fade", /_countHold/.test(game));
check("SentientMattress countdown attribution", /833028/.test(attr) && /3 \/ 2 \/ 1 \/ GO/.test(attr));
check("nav ATTRIBUTION names countdown slices", /5-4-3-2-1-GO/.test(navAttr) || /start-grid/.test(navAttr));

for (const key of COUNT) {
  const file = path.join(ROOT, "assets/sfx/nav", `${key}.mp3`);
  const st = fs.existsSync(file) ? fs.statSync(file) : null;
  check(`clip ${key}.mp3`, !!(st && st.size > 7000), st ? `${st.size} bytes` : "missing");
}

check("game imports engine.js?v=51", /engine\.js\?v=51/.test(game));
check("cache-bust chain", cacheOk && Number(gameV) >= 407, `main=${mainV} game=${gameV}`);

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "recorded 3-2-1-GO locked to the HUD countdown"}`
);
process.exit(fail ? 1 : 0);
