#!/usr/bin/env node
/**
 * Desert mud hairpin exit (~1737 m) — full-width ribbon scrub + land wash.
 *
 * RUN: node tools/qa-desert-mud-1737.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const trackSrc = fs.readFileSync(path.join(ROOT, "js/tracks/track.js"), "utf8");
const gameSrc = fs.readFileSync(path.join(ROOT, "js/game.js"), "utf8");
const main = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`DESERT MUD 1737 GATE  ·  ${new Date().toISOString()}\n`);

check("ribbon-sample collider scrub", /_scrubCollidersOnRibbonSamples\s*\(/.test(trackSrc));
check("ribbon pose interpolation", /_ribbonPoseAt\s*\(/.test(trackSrc));
check("collider blocks sample uses car OBB", /_colliderBlocksSample\s*\(/.test(trackSrc));
check("full mud-act scrub band", /tunEnd \+ 280/.test(trackSrc) && /tunEnd \+ 220/.test(trackSrc));
check("lateral ribbon samples", /laterals = \[/.test(trackSrc) && /_nearestPointAtDist/.test(trackSrc));
check("wall face corridor drop", /over < 0\.05/.test(trackSrc));
check("mud hairpin exit land wash", /tunEnd \+ 120/.test(trackSrc) && /lateral: 96/.test(trackSrc));
check("post-tunnel wash widened", /tunEnd - 48/.test(trackSrc) && /lateral: 72/.test(trackSrc));
check("portal embankment world scrub", /_scrubPortalEmbankmentCorridor\s*\(/.test(trackSrc));
check("visual scrub re-runs collider scrub", /_scrubInstancedCorridor[\s\S]*_scrubRoadwayColliders/.test(trackSrc));
check("game imports track.js?v=218+", Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 218);

const { gameV, ok: cacheOk } = readCacheVersions(main, index);
check("cache-bust v497+", cacheOk && Number(gameV) >= 497, `v=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  mud hairpin 1737 contracts");
