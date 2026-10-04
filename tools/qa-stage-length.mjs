#!/usr/bin/env node
/**
 * qa-stage-length.mjs — every championship stage is a longer drive.
 *
 * Desert only stretches after the Safari jumps so 1654 m stays the land pad.
 *
 * RUN: node --experimental-loader ./tools/qa-strip-query-loader.mjs tools/qa-stage-length.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COURSES } from "../js/tracks/courses.js";
import { approxPieceLength } from "../js/tracks/stage-data-validate.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const defSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track-definition.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`STAGE LENGTH  ·  ${new Date().toISOString()}\n`);

check("straight scale in compiler", /PLAY_STRAIGHT = 1\.72/.test(defSrc) && /PLAY_FINISH_PAD/.test(defSrc));
check("desert waits until jump 3", /jumps >= 3/.test(defSrc));
check("game imports courses.js?v=95+", Number((gameSrc.match(/courses\.js\?v=(\d+)/) || [])[1]) >= 95);

const floors = { desert: 2900, forest: 2800, mountain: 2400, lakeside: 2200, physlab: 700 };
for (const id of Object.keys(floors)) {
  const len = approxPieceLength(COURSES[id].pieces);
  check(`${id} ≥ ${floors[id]} m`, len >= floors[id], `${len.toFixed(0)} m`);
}

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "stages run longer"}`);
process.exit(fail ? 1 : 0);
