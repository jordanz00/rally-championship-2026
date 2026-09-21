#!/usr/bin/env node
/**
 * Per-car powertrain — recorded idle/load beds, no toy synth layers.
 *
 * RUN: node tools/qa-powertrain.mjs
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

console.log(`POWERTRAIN REALISM  ·  ${new Date().toISOString()}\n`);

const pt = read("js/audio/powertrain.js");
const eng = read("js/audio/engine.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const attr = read("assets/sfx/ATTRIBUTION.txt");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

for (const id of ["celica", "delta", "stratos"]) {
  check(
    `${id} has idle/load/lift beds`,
    pt.includes(`${id}-idle.mp3`) && pt.includes(`${id}-load.mp3`) && pt.includes(`${id}-lift.mp3`)
  );
  const fileOk = ["idle", "load", "lift"].every((k) =>
    fs.existsSync(path.join(ROOT, `assets/sfx/${id}-${k}.mp3`))
  );
  check(`${id} mp3 on disk`, fileOk);
}

check("Celica + Delta are turbo; Stratos is NA V6", /turbo:\s*true/.test(pt) && /stratos:[\s\S]*?turbo:\s*false/.test(pt));
check("cylinder counts differ (4 vs 6)", /cylinders:\s*4/.test(pt) && /cylinders:\s*6/.test(pt));
check("recorded-only mix (no scream / pulse / whistle)", /highVol:\s*0/.test(pt) && /pulseVol:\s*0/.test(pt) && /whistleVol:\s*0/.test(pt));
check("octave-down throat layer", /throatSrc/.test(pt) && /throatVol/.test(pt) && /loadRate \* 0\.5/.test(pt));
check("throat EQ 80–250 Hz", /throatHz/.test(pt) && /throatEq/.test(pt) && /makeThroatCurve/.test(pt));
check("engine bypasses surface HP", /new PowertrainVoice\(ctx, impactIn\)/.test(eng));
check("compressed loopRate (no helium stretch)", /function loopRate/.test(pt) && /n \* 0\.4/.test(pt));
check("gear-shift transient", /_maybeGearShift/.test(pt) && /_prevGear/.test(pt));
check("dynamic EQ under load", /_tickDynamicEq/.test(pt));
check("soft compressor on exhaust bus", /createDynamicsCompressor/.test(pt));
check("engine imports powertrain v32+", Number((eng.match(/powertrain\.js\?v=(\d+)/) || [])[1]) >= 32);
check("game passes brake to SFX state", /a\.brake = this\.player\.brake/.test(game));
check("ATTRIBUTION notes throat mix", /octave-down copy/.test(attr));
check(
  "cache-bust chain",
  cacheOk && Number(gameV) >= 530 && Number(mainV) >= 530,
  `main=${mainV} game=${gameV}`
);
check("engine.js cache ≥58", Number((game.match(/engine\.js\?v=(\d+)/) || [])[1]) >= 58);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "per-car powertrain realism armed"}`);
process.exit(fail ? 1 : 0);
