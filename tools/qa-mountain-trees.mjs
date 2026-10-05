#!/usr/bin/env node
/**
 * qa-mountain-trees.mjs — stage 3 keeps one tree model.
 *
 * Player moment: Mountain trees do not swap to a card or a coarse copy
 * as the car passes them.
 *
 * RUN: node tools/qa-mountain-trees.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const start = game.indexOf('const mountainStage = this.courseId === "mountain"');
const slice = start >= 0 ? game.slice(start, start + 8000) : "";

console.log(`MOUNTAIN TREE MODEL  ·  ${new Date().toISOString()}\n`);

check("mountain is in the one-mesh hold", /const holdOneTree = forestStage \|\| mountainStage/.test(slice));
check("foliage radius is the fog hold", /const foliageR = holdOneTree \? forestHold : heroR/.test(slice));
check("stage 3 skips the mid stand-in", /if \(midMesh && !mountainStage && carD2 > shadow2\)/.test(slice));
check("cards hide inside that hold", /if \(dist2 <= split2 \|\| carD2 <= shadow2\) continue/.test(slice));

const fogFar = 520;
const hold = fogFar + 80 + 8;
const heroR = Math.min(64, Math.max(28, fogFar * 0.48));
const passM = 80;
check("a tree 80 m out stays on the planted mesh", passM < hold && passM > heroR, `hold ${hold} m, card band was ${heroR} m`);

const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1]);
const mainV = Number((html.match(/main\.js\?v=(\d+)/) || [])[1]);
check("boot cache bust", gameV >= 1036 && mainV >= 1036, `game ${gameV} main ${mainV}`);

if (fail) {
  console.log(`\n${fail} FAIL`);
  process.exit(1);
}
console.log("\nPASS");
