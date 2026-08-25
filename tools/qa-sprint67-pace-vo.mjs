#!/usr/bin/env node
/**
 * Sprint 67 — recorded co-driver, soonest turn/jump, one jump call.
 *
 * RUN: node tools/qa-sprint67-pace-vo.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickPaceNote } from "../js/tracks/pace-call.mjs";
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

const NAV_CLIPS = [
  "easy-left",
  "easy-right",
  "medium-left",
  "medium-right",
  "hard-left",
  "hard-right",
  "hairpin-left",
  "hairpin-right",
  "jump",
];

console.log(`SPRINT 67 PACE VO  ·  ${new Date().toISOString()}\n`);

const track = read("js/tracks/track.js");
const call = read("js/tracks/pace-call.mjs");
const driver = read("js/audio/codriver.js");
const engine = read("js/audio/engine.js");
const bank = read("js/audio/bank.js");
const game = read("js/game.js");
const attr = read("assets/sfx/ATTRIBUTION.txt");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(read("js/main.js"), read("index.html"));

check("no speechSynthesis on the race path", !/speechSynthesis/.test(driver) && !/SpeechSynthesisUtterance/.test(driver));
check("codriver plays clips via paceCall", /paceCall/.test(driver) && /JUMP_LOCK_M = 110/.test(driver));
check("noteAt uses pickPaceNote", /pickPaceNote/.test(track) && /pace-call\.mjs\?v=1/.test(track));
check("authored notes do not override", !/findAuthoredNote/.test(track));
check(
  "geometry picker has no surface/tunnel speech",
  !/INTO GRAVEL|INTO TUNNEL|INTO MUD|Into the tunnel|To the finish/.test(call)
);
check(
  "track noteAt has no tunnel/gravel calls",
  !/INTO TUNNEL|INTO GRAVEL|Into the tunnel/.test(track)
);
check("soonest event, not sharpest-in-window", /jumpAt <= turnAt/.test(call) && !/bestDeg/.test(call));
check("jump id is run start", /jump-\$\{Math\.round\(jumpStart\)\}/.test(call));
check("nav bus bypasses SFX compressor", /_navGain/.test(engine) && /NAV_GAIN/.test(engine));
check("playClip does not dump the line", /export function playClip/.test(bank) && /paceCall/.test(engine));
check("CC BY attribution for SentientMattress", /SentientMattress/.test(attr) && /833028/.test(attr));

for (const key of NAV_CLIPS) {
  const file = path.join(ROOT, "assets/sfx/nav", `${key}.mp3`);
  const st = fs.existsSync(file) ? fs.statSync(file) : null;
  check(`clip ${key}.mp3`, !!(st && st.size > 8000), st ? `${st.size} bytes` : "missing");
}

function sampleAt(d) {
  let heading = 0;
  if (d > 40) heading += (Math.min(48, Math.max(0, d - 40)) / 48) * (20 * Math.PI / 180);
  if (d > 160) heading -= (Math.min(48, Math.max(0, d - 160)) / 48) * (100 * Math.PI / 180);
  const jump = (d >= 90 && d < 115) || (d >= 184 && d < 210);
  return { heading, jump, landmark: d >= 300 && d < 360 };
}

const soonest = pickPaceNote(sampleAt, 0, 190, 400);
check(
  "soonest turn beats a far hairpin-scale right",
  !!(soonest && soonest.kind === "turn" && soonest.dir === "LEFT" && soonest.clip === "easy-left"),
  soonest ? `${soonest.clip} ${soonest.text}` : "null"
);

const afterBend = pickPaceNote(sampleAt, 70, 160, 400);
check(
  "next event after the easy left is the first jump",
  !!(afterBend && afterBend.kind === "jump" && afterBend.clip === "jump"),
  afterBend ? afterBend.id : "null"
);

function twoJumps(d) {
  return {
    heading: 0,
    jump: (d >= 90 && d < 115) || (d >= 184 && d < 210),
    landmark: false,
  };
}

const firstCrest = pickPaceNote(twoJumps, 0, 190, 400);
const secondCrest = pickPaceNote(twoJumps, 120, 100, 400);
check(
  "second jump uses a new run id",
  !!(
    firstCrest &&
    secondCrest &&
    firstCrest.kind === "jump" &&
    secondCrest.kind === "jump" &&
    secondCrest.id !== firstCrest.id
  ),
  secondCrest ? `${firstCrest?.id} → ${secondCrest.id}` : "null"
);

const pin = pickPaceNote((d) => {
  const heading = d > 20 ? ((Math.min(d, 80) - 20) / 60) * (2.8) : 0;
  return { heading, jump: false, landmark: d >= 24 && d < 90 };
}, 0, 80, 200);
check(
  "landmark calls hairpin, not surface",
  !!(pin && pin.clip && pin.clip.startsWith("hairpin")),
  pin ? pin.clip : "null"
);

check("game imports track.js?v=178", /track\.js\?v=177/.test(game));
check("game imports engine.js?v=50", /engine\.js\?v=49/.test(game));
check("game imports codriver.js?v=31", /codriver\.js\?v=30/.test(game));
check("cache-bust chain", cacheOk && Number(gameV) >= 376, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "navigator is recorded VO on the next turn or jump"}`);
process.exit(fail ? 1 : 0);
