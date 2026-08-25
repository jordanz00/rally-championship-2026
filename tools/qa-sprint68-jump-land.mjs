#!/usr/bin/env node
/**
 * Sprint 68 — cars must not clip through the road after jumps.
 *
 * Desert teaching order: hop, then a jump PAIR. Jump 3 is the second of that
 * pair (the Safari throw). After each land, contact Y must stay on the deck.
 *
 * RUN: node tools/qa-sprint68-jump-land.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCacheVersions } from "./qa-cache-version.mjs";
import {
  ROOT,
  startServer,
  launchChrome,
  findChrome,
  preparePage,
  goto,
  waitFor,
  clickSelector,
  pressKey,
  evaluate,
} from "./lib/qa-harness.mjs";

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

function gapLength(gap) {
  const dropFast = Math.min(11, Math.max(8, gap * 0.4));
  const flyover = Math.max(10, gap - dropFast + 4);
  return dropFast + flyover;
}

console.log(`SPRINT 68 JUMP LAND  ·  ${new Date().toISOString()}\n`);
console.log("static");

const vehicle = read("js/physics/vehicle.js");
const courses = read("js/tracks/courses.js");
const track = read("js/tracks/track.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const desertBlock = (courses.match(/desert: \{[\s\S]*?\n  \},\n\n  \/\*\*/) || [""])[0];
const jumpRe =
  /\{\s*type:\s*"jump",\s*ramp:\s*([\d.]+),\s*rise:\s*([\d.]+),\s*lip:\s*([\d.]+),\s*gap:\s*([\d.]+),\s*drop:\s*([\d.]+),\s*land:\s*([\d.]+)/g;
const desertJumps = [];
let m;
while ((m = jumpRe.exec(desertBlock))) {
  desertJumps.push({
    ramp: +m[1],
    rise: +m[2],
    lip: +m[3],
    gap: +m[4],
    drop: +m[5],
    land: +m[6],
  });
}

check("Desert has the teaching hop plus the jump pair", desertJumps.length >= 3, `${desertJumps.length} jumps`);
const j1 = desertJumps[0];
const j2 = desertJumps[1];
const j3 = desertJumps[2];
check(
  "jump 1 is the short hop",
  !!(j1 && j1.rise <= 2.4 && j1.gap <= 14),
  j1 ? `rise ${j1.rise} gap ${j1.gap}` : "missing"
);
check(
  "jump 2 is the pair's first (medium)",
  !!(j2 && j2.rise >= 2.8 && j2.rise < 4 && j2.gap >= 14 && j2.gap < 22),
  j2 ? `rise ${j2.rise} gap ${j2.gap}` : "missing"
);
check(
  "jump 3 is the pair's Safari throw",
  !!(j3 && j3.rise >= 5 && j3.gap >= 24 && j3.drop >= 3.4),
  j3 ? `rise ${j3.rise} gap ${j3.gap} drop ${j3.drop}` : "missing"
);

const gap3 = j3 ? gapLength(j3.gap) : 0;
check(
  "jump 3 gap phases match track.js (dropFast + flyover)",
  gap3 > 24 && gap3 < 36,
  `gap phases ${gap3.toFixed(1)} m`
);
check(
  "pit mesh drops on the gap, land is a separate kind",
  /pushPhase\(dropFast, -drop, "gap"/.test(track) && /pushPhase\(land, drop \* 0\.18, "land"/.test(track)
);

check("_landPadArmed is the pad sentinel (pads may sit at Y ≤ 0)", /this\._landPadArmed/.test(vehicle));
check(
  "floor ignores the visual pit mesh",
  /_roadFloorY\(deck, pit\)/.test(vehicle) &&
    /if \(pit\) return this\._landPadArmed \? this\._landPadY : this\.position\.y/.test(vehicle)
);
check("every car is clamped onto that floor after the air step", /_clampToRoadDeck\(deck, pit/.test(vehicle));
check(
  "landing requires the real pad, not the hole",
  /hitting = overPad && atPad && ready/.test(vehicle) && !/\(overPad \|\| pit\)/.test(vehicle)
);
check("samePit uses scanned land dist, not a 36 m window", /_landPadEndDist/.test(vehicle) && !/< 36/.test(vehicle));
check("_scanLandPad returns { y, end } so a Y=0 pad still arms", /return \{ y, dist: foundAt, end: foundAt \}/.test(vehicle));
check("air pitch snaps onto the axle plane on the pad", /_snapPitchToRoad\(axles\)/.test(vehicle));
check("next lip is not blocked by the previous land lock", /holdThisPit/.test(vehicle));
check("air under a solid deck plants onGround", /solidDeck/.test(vehicle) && /sameTakeoff/.test(vehicle));
check("grounded hover cap is 5 cm", /const GROUND_HOVER_MAX\s*=\s*0\.05/.test(vehicle));
check(
  "land lock and ramps pin the contact patch to the axle deck",
  /this\._landLock > 0 \|\| onJumpApproach/.test(vehicle) &&
    /this\.position\.y = deck/.test(vehicle)
);
check(
  "clamp never lets grounded tires hover past GROUND_HOVER_MAX",
  /GROUND_HOVER_MAX/.test(vehicle) && /onGround && !pit && this\.position\.y > floor/.test(vehicle)
);
check(
  "landing squat does not bury the contact patch",
  /squatTarget = 0/.test(vehicle) && !/_bodyPitch - impact \* 0\.014/.test(vehicle)
);
check("TIRE_PLANT plant is unchanged", /const TIRE_PLANT\s*=\s*0\.014/.test(vehicle));
check("game + AI import vehicle.js", /vehicle\.js\?v=\d+/.test(game) && /vehicle\.js\?v=\d+/.test(ai));
check("cache-bust chain", cacheOk && Number(gameV) >= 407, `main=${mainV} game=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s)`);
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  console.log("\nSKIP headed  ·  no Chrome");
  console.log("\nPASS  ·  static jump-land contracts");
  process.exit(0);
}

console.log("\nheaded Desert jump landings");

async function mainHeaded() {
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  try {
    await preparePage(cdp);
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "game" });
    await pressKey(cdp, "Enter");
    await waitFor(
      cdp,
      `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-menu"?1:null;`,
      { timeout: 8000, label: "menu" }
    );
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(
      cdp,
      `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-cars"?1:null;`,
      { timeout: 12000, label: "cars" }
    );
    await waitFor(
      cdp,
      `const b=document.querySelector("[data-car='celica']"); return b&&!b.disabled?1:null;`,
      { timeout: 20000, label: "celica" }
    );
    await clickSelector(cdp, "[data-car='celica']", "CELICA");
    await waitFor(
      cdp,
      `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-courses"?1:null;`,
      { timeout: 25000, label: "courses" }
    );
    await clickSelector(cdp, "[data-course='desert']", "DESERT");
    await waitFor(
      cdp,
      `return window.game && (window.game.state === "countdown" || window.game.state === "race")
         ? window.game.courseId : null;`,
      { timeout: 120000, label: "desert boot" }
    );

    const probe = await evaluate(
      cdp,
      `const g = window.game;
      const track = g && g.track;
      const v = g && g.player;
      if (!track || !v || !track.points) return { err: "no track/player" };
      g.state = "paused";
      const jumps = [];
      let prev = "";
      for (let i = 0; i < track.points.length; i++) {
        const k = track.points[i].jumpKind || "";
        if (k === "gap" && prev !== "gap") jumps.push({ i: i, dist: track.points[i].dist });
        prev = k;
      }
      const dt = 1 / 60;
      const input = { throttle: 1, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false };
      const TIRE = 0.014;
      const results = [];
      const nRun = Math.min(3, jumps.length);
      for (let ji = 0; ji < nRun; ji++) {
        const gap = jumps[ji];
        let rampDist = Math.max(4, gap.dist - 10);
        for (let i = gap.i; i >= 0; i--) {
          const k = track.points[i].jumpKind || "";
          if (k === "ramp") rampDist = track.points[i].dist;
          else if (k !== "crest" && k !== "ramp" && k !== "gap") break;
        }
        v.spawn(track, Math.max(4, rampDist - 4), 0);
        const spd = 28;
        v.velocity.set(Math.sin(v.yaw) * spd, 0, Math.cos(v.yaw) * spd);
        v.gear = 3;
        let wasAir = false;
        let landed = false;
        let landDist = 0;
        let minDelta = 99;
        let maxDelta = -99;
        let maxBury = 0;
        let maxUnder = 0;
        let stuckUnder = false;
        let samples = 0;
        let worst = null;
        for (let s = 0; s < 780; s++) {
          v.step(dt, input, track);
          const q = track.query(v.position.x, v.position.z, {}, v.progress);
          const line = track.sample(v.progress);
          const pit = q.jumpKind === "gap";
          if (!v.onGround) wasAir = true;
          if (wasAir && v.onGround && !landed) {
            landed = true;
            landDist = v.progress;
          }
          const linePlant = line.y + 0.06 - TIRE;
          const delta = v.position.y - linePlant;
          const deck = line.y + 0.06;
          const solid = !pit && line.jumpKind !== "gap";
          if (solid && v.position.y < deck - 0.25) {
            const under = deck - v.position.y;
            if (under > maxUnder) maxUnder = under;
            if (!v.onGround && v.speed < 1.2) stuckUnder = true;
          }
          if (landed && v.onGround && line.jumpKind !== "gap" && v.progress < gap.dist + 90) {
            if (delta < minDelta) {
              minDelta = delta;
              worst = {
                y: Math.round(v.position.y * 1000) / 1000,
                lineY: Math.round(linePlant * 1000) / 1000,
                qH: Math.round(q.height * 1000) / 1000,
                kind: q.jumpKind || line.jumpKind || "",
                dist: Math.round(v.progress),
                onG: v.onGround,
                pit: pit,
                armed: !!v._landPadArmed,
                padY: v._landPadY,
              };
            }
            if (delta > maxDelta) maxDelta = delta;
            const wb = (v.spec && v.spec.wheelbase) || 2.55;
            const bury = Math.abs(Math.sin(v.pitch - (v._visPitch || 0))) * wb * 0.5;
            if (bury > maxBury) maxBury = bury;
            samples += 1;
          }
          if (landed && v.onGround && v.progress > gap.dist + 80 && samples > 12) break;
        }
        results.push({
          n: ji + 1,
          dist: Math.round(gap.dist),
          landDist: Math.round(landDist),
          landed: landed,
          air: wasAir,
          minDelta: Math.round(minDelta * 1000) / 1000,
          maxDelta: Math.round(maxDelta * 1000) / 1000,
          maxBury: Math.round(maxBury * 1000) / 1000,
          maxUnder: Math.round(maxUnder * 1000) / 1000,
          stuckUnder: stuckUnder,
          samples: samples,
          worst: worst,
        });
      }
      let carry = { ran: false };
      if (jumps.length >= 3) {
        const gap2 = jumps[1];
        const gap3 = jumps[2];
        let ramp2 = Math.max(4, gap2.dist - 10);
        for (let i = gap2.i; i >= 0; i--) {
          const k = track.points[i].jumpKind || "";
          if (k === "ramp") ramp2 = track.points[i].dist;
          else if (k !== "crest" && k !== "ramp" && k !== "gap") break;
        }
        v.spawn(track, Math.max(4, ramp2 - 4), 0);
        const spd = 32;
        v.velocity.set(Math.sin(v.yaw) * spd, 0, Math.cos(v.yaw) * spd);
        v.gear = 4;
        let maxUnder = 0;
        let stuckUnder = false;
        let movable = false;
        let reached = false;
        for (let s = 0; s < 1400; s++) {
          v.step(dt, input, track);
          const line = track.sample(v.progress);
          const pit = line.jumpKind === "gap";
          if (!pit && line.jumpKind !== "gap" && v.position.y < line.y + 0.06 - 0.25) {
            const under = line.y + 0.06 - v.position.y;
            if (under > maxUnder) maxUnder = under;
            if (!v.onGround && v.speed < 1.2) stuckUnder = true;
          }
          if (v.onGround && v.speed > 6) movable = true;
          if (v.progress > gap3.dist + 20) {
            reached = true;
            break;
          }
        }
        carry = {
          ran: true,
          reached: reached,
          maxUnder: Math.round(maxUnder * 1000) / 1000,
          stuckUnder: stuckUnder,
          movable: movable,
          y: Math.round(v.position.y * 1000) / 1000,
          progress: Math.round(v.progress),
          onGround: !!v.onGround,
          speed: Math.round(v.speed * 10) / 10,
        };
      }
      return { jumps: jumps.length, results: results, carry: carry };`
    );

    if (!probe || probe.err) {
      check("headed probe returned", false, probe && probe.err ? probe.err : "null");
    } else {
      check("Desert exposes at least 3 jumps", probe.jumps >= 3, `${probe.jumps} gap starts`);
      const rows = probe.results || [];
      for (const row of rows) {
        check(
          `jump ${row.n} left the ground and landed`,
          !!(
            row.air &&
            row.landed &&
            (row.samples > 8 || (row.minDelta >= -0.03 && row.landDist < row.dist + 85))
          ),
          `air=${row.air} land=${row.landed} n=${row.samples} gap@${row.dist}m land@${row.landDist}m`
        );
        check(
          `jump ${row.n} landed on this pad, not a later crest`,
          row.landDist > 0 && row.landDist < row.dist + 85,
          `land ${row.landDist} m / gap ${row.dist} m`
        );
        check(
          `jump ${row.n} contact stays on the deck after land`,
          row.minDelta >= -0.03,
          `min ΔY ${row.minDelta} m${row.worst ? ` worst=${JSON.stringify(row.worst)}` : ""}`
        );
        check(
          `jump ${row.n} wheels stay on the roadway (no hover)`,
          row.maxDelta <= 0.08,
          `max ΔY ${row.maxDelta} m`
        );
        check(
          `jump ${row.n} pitch does not bury an axle`,
          row.maxBury <= 0.06,
          `max axle bury ${row.maxBury} m`
        );
        check(
          `jump ${row.n} never sits under a solid deck`,
          (row.maxUnder || 0) <= 0.22 && !row.stuckUnder,
          `max under ${row.maxUnder || 0} m stuck=${!!row.stuckUnder}`
        );
      }
      const third = rows.find((r) => r.n === 3);
      check("jump 3 (Safari throw) was probed", !!third, third ? `ΔY ${third.minDelta}` : "missing");
      const carry = probe.carry || {};
      check(
        "jump 2 throw cannot tunnel jump 3's ramp",
        !!(carry.ran && carry.reached && (carry.maxUnder || 0) <= 0.22 && !carry.stuckUnder && carry.movable),
        JSON.stringify(carry)
      );
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

await mainHeaded().catch((err) => {
  fail += 1;
  console.log(`  FAIL  headed probe — ${err && err.message ? err.message : err}`);
});

console.log(
  `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "jump landings stay on the roadway"}`
);
process.exit(fail ? 1 : 0);
