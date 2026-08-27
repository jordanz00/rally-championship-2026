#!/usr/bin/env node
/**
 * qa-hud-sightline.mjs — no persistent text in the middle of the driving view.
 *
 * RUN: node tools/qa-hud-sightline.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

console.log(`HUD SIGHTLINE  ·  ${new Date().toISOString()}\n`);

const css = read("css/game.css");
const html = read("index.html");

const pace = (css.match(/#hud-pace\s*\{[^}]+\}/) || [""])[0];
const flash = (css.match(/#hud-flash\s*\{[^}]+\}/) || [""])[0];

check("pace notes hidden", /display:\s*none/.test(pace));
check("pace not parked at 22% / 50%", !/top:\s*22%/.test(pace) && !/left:\s*50%/.test(pace));
check("flash not at mid-screen 38%", !/top:\s*38%/.test(flash));
check("flash sits in the top HUD band", /top:\s*14px/.test(flash));
check("html hides #hud-pace", /id="hud-pace"[^>]*hidden/.test(html) || /id="hud-pace" hidden/.test(html));
check("stylesheet cache-bust v=31+", Number((html.match(/game\.css\?v=(\d+)/) || [])[1]) >= 31);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "driving view is clear of center captions"}`);
process.exit(fail ? 1 : 0);
