#!/usr/bin/env node
/** Passes must not flash giant PASS / place text. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = fs.readFileSync(path.join(root, "js/game.js"), "utf8");
const config = fs.readFileSync(path.join(root, "js/config.js"), "utf8");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const main = fs.readFileSync(path.join(root, "js/main.js"), "utf8");

let fail = 0;
function check(name, ok) {
  if (ok) console.log(`PASS  ${name}`);
  else {
    fail++;
    console.log(`FAIL  ${name}`);
  }
}

const pulse = game.match(/_pulsePlaceChange\(pos\)\s*\{[\s\S]*?\n  \}/);
const body = pulse ? pulse[0] : "";

check("no PASS flashMessage", !/flashMessage\(\s*early \? "PASS"/.test(body) && !/flashMessage\("PASS"\)/.test(body));
check("no place ordinal flash in pulse", !/flashMessage\(/.test(body));
check("flashGains off", /flashGains:\s*false/.test(config));
check("place punch kept", /punchPlace\(pos/.test(body));

const mainV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
check("boot 1090+", mainV >= 1090 && gameV === mainV);

if (fail) process.exit(1);
console.log("\nPASS  ·  no on-screen PASS flash");
