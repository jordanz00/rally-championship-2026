#!/usr/bin/env node
/**
 * Championship-only · Toyota-only menu contract.
 *
 * RUN: node tools/qa-menu-championship.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

const html = read("index.html");
const game = read("js/game.js");
const css = read("css/game.css");
const main = read("js/main.js");

console.log(`MENU CHAMPIONSHIP  ·  ${new Date().toISOString()}\n`);

check("no TIME ATTACK button", !/data-menu="timeattack"/.test(html));
check("no PRACTICE button", !/data-menu="practice"/.test(html));
check("championship menu card", /data-menu="championship"/.test(html));
check("controls still available", /data-menu="controls"/.test(html));
check("no Delta car button", !/data-car="delta"/.test(html));
check("no Stratos car button", !/data-car="stratos"/.test(html));
check("Celica car button", /data-car="celica"/.test(html));
check("no MODES back link", !/data-menu="modes"/.test(html));
check("arcade panel class", /ui-panel-arcade/.test(html) && /\.ui-panel-arcade/.test(css));
check("timeattack/practice remap to championship", /id === "timeattack" \|\| id === "practice"/.test(game));
check("_pickCar locks celica", /const pick = "celica"/.test(game));
check("leave title forces championship+celica", /this\.mode = "championship"[\s\S]*?this\.carId = "celica"/.test(game));
check(
  "cache bust",
  /main\.js\?v=1133/.test(html) && /game\.js\?v=1133/.test(main) && /game\.css\?v=75/.test(html)
);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "championship-only Toyota menu"}`);
process.exit(fail ? 1 : 0);
