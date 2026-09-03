#!/usr/bin/env node
/**
 * Sprint 67 — recorded co-driver, soonest turn/jump, one jump call.
 *
 * RUN: node tools/qa-sprint67-pace-vo.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pickPaceNote, makeTurnNote } from "../js/tracks/pace-call.mjs";
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
check("codriver plays each note once via paceCall", /paceCall/.test(driver) && /this\._said/.test(driver) && /noteSignature/.test(driver) && /this\._lastClip/.test(driver));
check("codriver enforces speak gap + recall", /PACE\.speakGap/.test(driver) && /PACE\.recallMetres/.test(driver) && /this\.cool > 0/.test(driver));
check("paceCall does not restart the same clip", /_navPlayingKey === phraseKey/.test(engine));
check("noteAt uses pickPaceNote", /pickPaceNote/.test(track) && /pace-call\.mjs\?v=4/.test(track));
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
check("turn id is arc start, not a 36 m bucket", /\$\{dir\}-\$\{severity\}-\$\{Math\.round\(at\)\}/.test(call));
check("in-progress arcs are skipped", /arc\.start \+ TURN_LEAD < dist/.test(call));
check("hairpin-grade turns speak hairpin", /grade = "hairpin"/.test(call) && /hairpin-left/.test(driver) && /hairpin-right/.test(driver));
check("clipKey does not rewrite hairpin to hard", !/startsWith\("hairpin-"\)/.test(driver));
check("long/maybe flags on turn notes", /LONG_ARC_M/.test(call) && /maybe:/.test(call) && /long:/.test(call));
check("paceCall accepts long/maybe opts", /paceCall\(key, opts/.test(engine) && /_navQueue/.test(engine));
check("codriver passes long/maybe phrase", /paceCall\(key, phrase\)/.test(driver) || /paceCall\(key, \{\s*long/.test(driver));
check("nav clips cache-busted", /nav\/\$\{key\}\.mp3\?v=5/.test(engine));
check("nav bus bypasses SFX compressor", /_navGain/.test(engine) && /NAV_GAIN/.test(engine));
check("playClip does not dump the line", /export function playClip/.test(bank) && /paceCall/.test(engine));
check("Daniel unified nav voice attribution", /Daniel/.test(attr) && /build-nav-grade-vo/.test(attr));

for (const key of [...NAV_CLIPS, "long", "maybe"]) {
  const file = path.join(ROOT, "assets/sfx/nav", `${key}.mp3`);
  const st = fs.existsSync(file) ? fs.statSync(file) : null;
  check(`clip ${key}.mp3`, !!(st && st.size > 2000), st ? `${st.size} bytes` : "missing");
}

for (const grade of ["easy", "medium", "hard", "hairpin"]) {
  const left = path.join(ROOT, "assets/sfx/nav", `${grade}-left.mp3`);
  const right = path.join(ROOT, "assets/sfx/nav", `${grade}-right.mp3`);
  const a = fs.readFileSync(left);
  const b = fs.readFileSync(right);
  check(`${grade} left ≠ right`, !a.equals(b));
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
  "160° pin calls hairpin left, not hard or a surface line",
  !!(pin && pin.clip === "hairpin-left"),
  pin ? pin.clip : "null"
);

const hardBend = pickPaceNote((d) => {
  const heading = d > 20 ? ((Math.min(d, 80) - 20) / 60) * (110 * Math.PI / 180) : 0;
  return { heading, jump: false, landmark: false };
}, 0, 80, 200);
check(
  "110° bend calls hard left",
  !!(hardBend && hardBend.clip === "hard-left"),
  hardBend ? hardBend.clip : "null"
);

const longEasy = makeTurnNote(100, -0.4, 28, 72);
check(
  "long easy arc notes maybe + long",
  !!(longEasy.maybe && longEasy.long && longEasy.clip === "easy-right" && /MAYBE/.test(longEasy.text)),
  longEasy.text
);
const shortEasy = makeTurnNote(100, -0.4, 28, 20);
check(
  "short easy arc has no maybe",
  !shortEasy.maybe && !shortEasy.long,
  shortEasy.text
);
const pinNoMaybe = makeTurnNote(50, 2.6, 150, 80);
check(
  "hairpin never gets maybe even on a long arc",
  !pinNoMaybe.maybe && pinNoMaybe.clip === "hairpin-left",
  pinNoMaybe.text
);

const rad = (d) => (d * Math.PI) / 180;
const grades = [
  ["easy left", 30, "easy-left"],
  ["easy right", -28, "easy-right"],
  ["medium left", 70, "medium-left"],
  ["medium right", -78, "medium-right"],
  ["hard left", 110, "hard-left"],
  ["hard right", -120, "hard-right"],
  ["hairpin left", 148, "hairpin-left"],
  ["hairpin right", -165, "hairpin-right"],
];
for (const [label, deg, clip] of grades) {
  const note = makeTurnNote(0, rad(deg), Math.abs(deg));
  check(`grade VO ${label}`, note.clip === clip, note.clip);
}

function sweeper(d) {
  let heading = 0;
  if (d > 40) heading -= Math.min(90, d - 40) * (Math.PI / 180);
  return { heading, jump: false, landmark: false };
}
const sweepA = pickPaceNote(sweeper, 0, 190, 400);
const sweepB = pickPaceNote(sweeper, 70, 190, 400);
check(
  "a long sweeper is one call, then silent while you are in it",
  !!(sweepA && sweepA.kind === "turn" && sweepA.clip === "medium-right" && sweepB == null),
  sweepA ? `${sweepA.id} then ${sweepB && sweepB.id}` : "null"
);
check(
  "long sweeper speaks maybe (AM3 judge-yourself)",
  !!(sweepA && sweepA.maybe),
  sweepA ? `${sweepA.text}` : "null"
);

check("game imports track.js?v=196+", Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 196);
check("game imports engine.js?v=56+", Number((game.match(/engine\.js\?v=(\d+)/) || [])[1]) >= 56);
check("game imports codriver.js?v=35+", Number((game.match(/codriver\.js\?v=(\d+)/) || [])[1]) >= 35);
check("engine imports soundtrack.js?v=135+", Number((engine.match(/soundtrack\.js\?v=(\d+)/) || [])[1]) >= 135);
check("engine still wires SkidVoice", /SkidVoice/.test(engine) && /this\.skid\.setState/.test(engine));
check("skid gravel pan from driftAngle", /StereoPanner|createStereoPanner/.test(read("js/audio/skid.js")) && /signedYaw|driftAngle/.test(read("js/audio/skid.js")));
check("per-course DISC_MIX in soundtrack", /DISC_MIX/.test(read("js/audio/soundtrack.js")));
check("cache-bust chain", cacheOk && Number(gameV) >= 461, `main=${mainV} game=${gameV}`);

console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "navigator says easy/medium/hard/hairpin left or right, or jump"}`);
process.exit(fail ? 1 : 0);
