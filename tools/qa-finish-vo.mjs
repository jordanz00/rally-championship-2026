#!/usr/bin/env node
/**
 * Finish line: VO says FINISH only (never GO), HUD flashes FINISH, gantry reads FINISH.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const game = read("js/game.js");
const cloth = read("js/tracks/flag-cloth.js");
const hud = read("js/ui/hud.js");
const track = read("js/tracks/track.js");
const index = read("index.html");
const main = read("js/main.js");

const finishFn = game.match(/_finish\(pos\)\s*\{[\s\S]*?\n  \}/);
const body = finishFn ? finishFn[0] : "";

check("finish VO calls finishCall", /finishCall\(this\.audio\)/.test(body));
check("finish never countGo", !/audio\.countGo\(/.test(body) && !/this\.audio\.countGo\(/.test(body));
check("HUD flashes FINISH", /flashMessage\("FINISH"\)/.test(body));
check("hud is-finish class", /is-finish/.test(hud) && /text === "FINISH"/.test(hud));
check("gantry planted FINISH", /_addGantry\(finish, "FINISH"\)/.test(track));
check("bannerWord FINISH", /label === "FINISH"\) return "FINISH"/.test(cloth));
check("FINISH paint oversized", /finish \? 196/.test(cloth));

const mainV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
check("boot 1089+", mainV >= 1089 && gameV === mainV, `main=${mainV} game=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  finish VO = FINISH only · gantry says FINISH");
