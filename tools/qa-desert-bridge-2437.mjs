#!/usr/bin/env node
/**
 * Desert rock-bridge approach (~2437–2441 m) — finite road skirts + clear portal.
 *
 * RUN: node tools/qa-desert-bridge-2437.mjs
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

console.log(`DESERT BRIDGE 2437/2441 GATE  ·  ${new Date().toISOString()}\n`);
console.log("static");

check("bridge drive corridor scrub", /_scrubBridgeDriveCorridor\s*\(/.test(trackSrc));
check("bridge groups scrubbed at build end", /_scrubBridgeGroups\s*\(/.test(trackSrc));
check("mouth blocks pushed out", /clearHalfW \+ 22/.test(trackSrc) && /clearHalfD \+ 20/.test(trackSrc));
check("bridge lining preserved", /userData\.bridgeLining/.test(trackSrc));
check("drift berms bump after strip", /bermsKept/.test(trackSrc) && /_stripLanePoses\(berms\)/.test(trackSrc));
check(
  "road edge exposes finite y for skirts/kerbs",
  /y: 0\.5 \* \(yL \+ yR\)/.test(trackSrc) && /yL,\s*\n\s*yR,/.test(trackSrc)
);
check("kerbs use yL/yR not missing e.y", /e\.yL \+ 0\.02/.test(trackSrc) && /e\.yR \+ 0\.02/.test(trackSrc));
check("bridge corner keepout scrub", /corners = \[/.test(trackSrc) && /box\.min\.x/.test(trackSrc));
check("game imports track.js?v=219+", Number((gameSrc.match(/track\.js\?v=(\d+)/) || [])[1]) >= 219);

const { gameV, ok: cacheOk } = readCacheVersions(main, index);
check("cache-bust v498+", cacheOk && Number(gameV) >= 498, `v=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  desert bridge 2437/2441 contracts");
