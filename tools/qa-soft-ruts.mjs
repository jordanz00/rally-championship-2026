#!/usr/bin/env node
/**
 * Soft-road 3D tire ruts — deform field + mesh + TireMarks wiring.
 * RUN: node tools/qa-soft-ruts.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";

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

console.log(`SOFT-ROAD 3D RUTS  ·  ${new Date().toISOString()}\n`);

const deform = read("js/tracks/surface-deform.js");
const effects = read("js/effects.js");
const track = read("js/tracks/track.js");
const game = read("js/game.js");
const config = read("js/config.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

check("DEFORM_SURFACES sand/dirt/mud/gravel", /DEFORM_SURFACES[\s\S]*sand[\s\S]*dirt[\s\S]*mud[\s\S]*gravel/.test(deform));
check("deep mud/sand caps", /mud:\s*0\.185/.test(deform) && /sand:\s*0\.145/.test(deform));
check("fine deform cell", /this\.cell\s*=\s*0\.22/.test(deform));
check("trenchProfile export", /export function trenchProfile/.test(deform));
check("live dig on rut mesh", /liveDig/.test(deform) && /trenchProfile\(u\)\s*\*\s*liveDig/.test(deform));
check("stamp takes throttle/brake load", /stampSegment\([\s\S]*load/.test(deform));
check("TireMarks passes dig load", /digLoad/.test(effects) && /spinDig/.test(effects));
check("soft trails stamp wheelDeform + wheelRuts", /wheelDeform\.stampSegment/.test(effects) && /wheelRuts\.writeSegment/.test(effects));
check("track imports surface-deform v6+", /surface-deform\.js\?v=([6-9]|\d{2,})/.test(track));
check("soft sink sand ≥ 0.08", /sand:[\s\S]*?sink:\s*0\.0(8[5-9]|9\d)|sink:\s*0\.[1-9]/.test(config));
check("soft sink mud ≥ 0.12", /mud:[\s\S]*?sink:\s*0\.(1[2-9]|[2-9])/.test(config));
check("wheelRuts.flush each race tick", /wheelRuts\.flush/.test(game));
check("cache-bust chain", cacheOk && Number(gameV) >= 783, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "3D soft-road ruts wired"}`);
process.exit(fail ? 1 : 0);
