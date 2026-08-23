#!/usr/bin/env node
/** qa-sprint39-perf.mjs — Sprint 39 integrated GPU perf tier */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fail = 0;
function check(l, ok, d) {
  if (ok) console.log(`  ok  ${l}`);
  else { console.log(`  FAIL  ${l} — ${d}`); fail++; }
}

const config = fs.readFileSync(path.join(ROOT, "js/config.js"), "utf8");
const perf = fs.readFileSync(path.join(ROOT, "js/gfx/perf-tier.js"), "utf8");
const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");

console.log("SPRINT 39 INTEGRATED GPU PERF\n");
check("integrated floor ms", /integratedFloorMs/.test(config));
check("perf tier module", /createPerfTier/.test(perf));
check("game perf tier tick", /perfTier/.test(game) && /createPerfTier/.test(game));
check("adapt floor preserved", /adaptFloorMs/.test(config));
console.log(fail ? `\nFAIL ${fail}` : "\nPASS");
process.exit(fail ? 1 : 0);
