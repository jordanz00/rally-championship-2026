#!/usr/bin/env node
/**
 * Young navigator VO pack — Emma cheerful, clips on disk, boot bumped.
 *
 * RUN: node tools/qa-nav-young-vo.mjs
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

const CLIPS = [
  "easy-left",
  "easy-right",
  "medium-left",
  "medium-right",
  "hard-left",
  "hard-right",
  "hairpin-left",
  "hairpin-right",
  "jump",
  "long",
  "maybe",
  "finish",
  "count-3",
  "count-2",
  "count-1",
  "count-go",
];

console.log(`NAV YOUNG VO  ·  ${new Date().toISOString()}\n`);

const engine = read("js/audio/engine.js");
const driver = read("js/audio/codriver.js");
const game = read("js/game.js");
const attr = read("assets/sfx/ATTRIBUTION.txt");
const navAttr = read("assets/sfx/nav/ATTRIBUTION.txt");
const render = read("tools/render-nav-vo.py");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(read("js/main.js"), read("index.html"));

check("NAV_ACTOR is emma-cheerful", /export const NAV_ACTOR = "emma-cheerful"/.test(engine));
check("retired Daniel / Samantha actor ids", !/NAV_ACTOR = "daniel"/.test(engine) && !/NAV_ACTOR = "samantha"/.test(engine));
check("codriver names Emma actor", /Emma cheerful/.test(driver) && /NAV_ACTOR/.test(driver));
check("nav clips cache-bust v=8+", Number((engine.match(/nav\/\$\{key\}\.mp3\?v=(\d+)/) || [])[1]) >= 8);
check("game imports engine.js v=80+", Number((game.match(/engine\.js\?v=(\d+)/) || [])[1]) >= 80);
check("game imports codriver.js v=47+", Number((game.match(/codriver\.js\?v=(\d+)/) || [])[1]) >= 47);
check("boot cache-bust 983+", cacheOk && Number(gameV) >= 983 && Number(mainV) >= 983, `main=${mainV} game=${gameV}`);
check("attribution actor id", /emma-cheerful/.test(attr) && /emma-cheerful/.test(navAttr));
check("renderer uses Emma neural", /en-US-EmmaMultilingualNeural/.test(render) && /NAV_ACTOR/.test(render));
check("no speechSynthesis on race path", !/speechSynthesis/.test(engine) && !/speechSynthesis/.test(driver));

for (const key of CLIPS) {
  const file = path.join(ROOT, "assets/sfx/nav", `${key}.mp3`);
  const st = fs.existsSync(file) ? fs.statSync(file) : null;
  check(`clip ${key}.mp3`, !!(st && st.size > 2500), st ? `${st.size} bytes` : "missing");
}

const left = fs.readFileSync(path.join(ROOT, "assets/sfx/nav", "easy-left.mp3"));
const right = fs.readFileSync(path.join(ROOT, "assets/sfx/nav", "easy-right.mp3"));
check("easy left ≠ right", !left.equals(right));

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "emma-cheerful wired, clips on disk, boot bumped"}`);
process.exit(fail ? 1 : 0);
