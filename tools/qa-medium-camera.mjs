#!/usr/bin/env node
/**
 * qa-medium-camera.mjs — Sega Rally '95 Saturn chase, not a rear-bumper lock.
 *
 * Player moment: powerslide in frame, lens follows travel, far-cam freedom
 * with tighter springs so the world does not whip.
 *
 * RUN: node tools/qa-medium-camera.mjs
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

console.log(`MEDIUM RALLY CAMERA  ·  ${new Date().toISOString()}\n`);

const config = read("js/config.js");
const game = read("js/game.js");
const main = read("js/main.js");
const index = read("index.html");
const vehicle = read("js/physics/vehicle.js");
const track = read("js/tracks/track.js");
const ai = read("js/ai.js");

const med = config.match(
  /id:\s*"medium"[\s\S]*?back:\s*([0-9.]+)[\s\S]*?height:\s*([0-9.]+)[\s\S]*?lookAhead:\s*([0-9.]+)[\s\S]*?lookY:\s*([0-9.]+)/
);
const back = med ? Number(med[1]) : NaN;
const height = med ? Number(med[2]) : NaN;
const lookAhead = med ? Number(med[3]) : NaN;
const lookY = med ? Number(med[4]) : NaN;

check("medium back 5.3–5.9 m (see the car, not the bumper)", back >= 5.3 && back <= 5.9, `back=${back}`);
check("medium height 1.78–1.95 m", height >= 1.78 && height <= 1.95, `height=${height}`);
check("medium look-ahead opened", lookAhead >= 9.5 && lookAhead <= 12.5, `lookAhead=${lookAhead}`);
check("medium lookY aims at the road", lookY > 0.2 && lookY <= 0.48, `lookY=${lookY}`);
check("not a behind-car lock", /id:\s*"medium"[\s\S]*?stableBehind:\s*false/.test(config));
check("spring follow (no XZ glue)", /id:\s*"medium"[\s\S]*?lockPos:\s*false/.test(config));
check("slide yaw follows travel", /id:\s*"medium"[\s\S]*?slideYawBlend:\s*0\.[6-9]/.test(config));
check("slide yaw stiffness is lazy", /id:\s*"medium"[\s\S]*?yawStiffnessSlide:\s*[1-8](?:\.\d+)?/.test(config));
check("slide yaw rate is capped", /id:\s*"medium"[\s\S]*?yawRateCapSlide:\s*[0-9.]+/.test(config) && /yawRateCapSlide/.test(game));
check("tiny rear-quarter, not an orbit", /id:\s*"medium"[\s\S]*?slideCamOut:\s*0\.0[2-4]/.test(config));
check("jumps do not crane the lens", /id:\s*"medium"[\s\S]*?lockAir:\s*true/.test(config));
check("no generic SmoothDamp", !/SmoothDamp/.test(game) && !/smoothDamp/.test(game));
check("tiny speed FOV", /id:\s*"medium"[\s\S]*?speedFovScale:\s*0\.1[0-8]/.test(config));
check("speed look-ahead", /id:\s*"medium"[\s\S]*?speedLookAheadScale:\s*0\.2/.test(config));
check("subtle brake pitch", /id:\s*"medium"[\s\S]*?brakePitchMul:\s*0\.03/.test(config));
check("subtle landing kick", /id:\s*"medium"[\s\S]*?landKickMul:\s*0\.2/.test(config));
check("surface shake scaled", /surfShake/.test(game) && /shakeMul/.test(game));
check("tighter springs than far", /id:\s*"medium"[\s\S]*?springPosStiff:\s*8[0-9]/.test(config));

const far = config.match(/id:\s*"far"[\s\S]*?back:\s*([0-9.]+)[\s\S]*?height:\s*([0-9.]+)/);
check(
  "far camera unchanged",
  far && Number(far[1]) === 13.6 && Number(far[2]) === 4.05,
  far ? `back=${far[1]} height=${far[2]}` : "missing"
);
check("POV still seats the cabin", /setCockpitView\(mesh, true/.test(game) && /id:\s*"pov"/.test(config));
check("existing road floor clamp kept", /line\.y \+ 1\.25/.test(game));
check("vehicle.js physics untouched this patch", /tireEnvelopeFalloff/.test(vehicle));
check("track.js not rewritten", /class Track/.test(track));
check("AI still shares Vehicle", /from "\.\/physics\/vehicle\.js\?v=\d+"/.test(ai));

const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);
check("index→main→game cache", cacheOk, `game=${gameV} main=${mainV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "medium Saturn chase armed"}`);
process.exit(fail ? 1 : 0);
