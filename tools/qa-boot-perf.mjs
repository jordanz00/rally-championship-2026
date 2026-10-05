#!/usr/bin/env node
/**
 * qa-boot-perf.mjs — load + present budget is real.
 *
 * Player moment: Title paints faster. Race holds a steadier cadence.
 * Quality TSR / LOOK drop when the GPU is late. 2k maps wait.
 *
 * RUN: node tools/qa-boot-perf.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const qm = fs.readFileSync(path.join(ROOT, "js/gfx/quality-manager.js"), "utf8");
const stream = fs.readFileSync(path.join(ROOT, "js/tracks/pbr-stream.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const perf = fs.readFileSync(path.join(ROOT, "js/gfx/perf-tier.js"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`BOOT / FRAME BUDGET  ·  ${new Date().toISOString()}\n`);

check("main imports game.js?v=1021+", Number((main.match(/game\.js\?v=(\d+)/) || [])[1]) >= 1021);
check("index boots main.js?v=1021+", Number((html.match(/main\.js\?v=(\d+)/) || [])[1]) >= 1021);
check("modulepreload main", /rel="modulepreload" href="js\/main\.js\?v=\d+"/.test(html));
check("no splash HDR prefetch", !/kloofendal_partly_cloudy_2k\.hdr/.test(html));
check("stream budget helper", /function armStreamBudget/.test(game) && /settleLookaheadMeters/.test(game));
check("faster quality down", /DOWN_HOLD = 10/.test(qm) && /minScale = 0\.62/.test(qm));
check("2k maps wait", /HI_MS = 24000/.test(stream) && /__rallyHiMaps/.test(stream));
check("1k boot timeout 900", /BOOT_MS = 900/.test(stream));
check(
  "phone stays soft, desktop output is full scale",
  /_softRenderScale = isPhonePlay\(\) \? 0\.78 : 1/.test(game)
);
check("present budget adapt", /_adaptPresentBudget/.test(game) && /setMode\("balanced"\)/.test(game));
check("shadow every from tier", /_qualityShadowEvery/.test(game) && /shadowEvery: 2/.test(perf));
check("compile overlay shorter", /_drainStreamCompileUnderOverlay\(480\)/.test(game));
check("forest heroes only on Forest pick", /priority && courseId === "forest"/.test(game));
check("pbr-stream v6", /pbr-stream\.js\?v=6/.test(game));

if (fail) {
  console.log(`\nFAIL  ${fail}`);
  process.exit(1);
}
console.log("\nPASS");
