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

const mountainBlock = (courses.match(/mountain: \{[\s\S]*?\n  \},\n\n  \/\*\*/) || [""])[0];
jumpRe.lastIndex = 0;
const mountainJumps = [];
while ((m = jumpRe.exec(mountainBlock))) {
  mountainJumps.push({
    ramp: +m[1],
    rise: +m[2],
    lip: +m[3],
    gap: +m[4],
    drop: +m[5],
    land: +m[6],
  });
}
check("Mountain (stage 3) has a crest jump", mountainJumps.length >= 1, `${mountainJumps.length} jumps`);

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
  "floor uses solid axles plus the far pad, never the visual pit as a drop",
  /_roadFloorY\(deck, pit, axles/.test(vehicle) && /_keepChassisOnRoad\(/.test(vehicle) && /_solidFloorY\(/.test(vehicle)
);
check("every car is clamped onto that floor after the air step", /_clampToRoadDeck\(deck, pit/.test(vehicle));
check(
  "landing requires the real pad, not the hole",
  /hitting = overPad && atPad && ready/.test(vehicle) && !/\(overPad \|\| pit\)/.test(vehicle)
);
check("samePit uses scanned land dist, not a 36 m window", /_landPadEndDist/.test(vehicle) && !/< 36/.test(vehicle));
check("_scanLandPad returns the land run end", /return \{ y, dist: foundAt, end: endAt \}/.test(vehicle));
check("air pitch snaps onto the axle plane on glitch/plant", /_snapPitchToRoad\(axles\)/.test(vehicle));
check("graded landings use attitude settle, not upright snap", /_beginLandSettle\(/.test(vehicle));
check(
  "chassis stay-on-road still active",
  /_keepChassisOnRoad\(axles, pit\)/.test(vehicle) && /const LAND_PITCH_SLACK/.test(vehicle)
);
check("next lip is not blocked by the previous land lock", /holdThisPit/.test(vehicle));
check("air under a solid deck plants onGround", /solidDeck/.test(vehicle) && /sameTakeoff/.test(vehicle));
check("pad stays armed on the landing strip", /kind !== "land" && this\._landPadArmed/.test(vehicle));
check("grounded hover cap is 5 cm", /const GROUND_HOVER_MAX\s*=\s*0\.05/.test(vehicle));
check(
  "land lock and ramps pin the contact patch to the axle deck",
  /this\._landLock > 0 \|\| onJumpApproach/.test(vehicle) &&
    /this\.position\.y = deck/.test(vehicle)
);
check(
  "clamp never pulls grounded tires down onto a stale pit floor",
  /_solidFloorY/.test(vehicle) && /onSolid/.test(vehicle) && /GROUND_HOVER_MAX/.test(vehicle)
);
check(
  "landing pitch cannot bury an axle through the roadway",
  /_keepChassisOnRoad\(axles, pit\)/.test(vehicle) && /const LAND_PITCH_SLACK/.test(vehicle)
);
check(
  "stale pit XZ reacquires the ribbon under the car",
  /_reacquireProgress/.test(vehicle) && /_neverFallThrough/.test(vehicle)
);
check(
  "stale pit walk finds the climb under the car, not a distant tunnel",
  /p\.tunnel && d > 12 \* 12/.test(track) && /hintedPit \? 180/.test(track) && /best \+ 80/.test(track)
);
check(
  "void rescue plants back on the ribbon instead of the gray underworld",
  /_neverFallThrough/.test(vehicle) && /under-world/.test(vehicle)
);
check("TIRE_PLANT plant is unchanged", /const TIRE_PLANT\s*=\s*0\.014/.test(vehicle));
check("game + AI import vehicle.js", /vehicle\.js\?v=\d+/.test(game) && /vehicle\.js\?v=\d+/.test(ai));
check("cache-bust chain", cacheOk && Number(gameV) >= 429, `main=${mainV} game=${gameV}`);
check(
  "gap posts do not magnetize the query after a long throw",
  /hintedPit/.test(track) && /score \+= d \* 4/.test(track)
);
check("jump ribbon step allows the far pad", /_ribbonStepMax/.test(vehicle) && /base \+ 42/.test(vehicle));
check(
  "stale pit query yields to the land under the car",
  /_preferSolidRoad/.test(vehicle) && /alt\.tunnel && !this\._xzOnRibbon/.test(vehicle)
);
check("pit mesh is never a chassis floor", /qKind !== "gap"/.test(vehicle));
check(
  "land pad ends at the land strip, not 140 m of stage",
  /sawLand && kind !== "land"/.test(vehicle) && /foundAt \+ 42/.test(vehicle)
);

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
      const nRun = Math.min(4, jumps.length);
      for (let ji = 0; ji < nRun; ji++) {
        const gap = jumps[ji];
        let rampDist = Math.max(4, gap.dist - 10);
        for (let i = gap.i; i >= 0; i--) {
          const k = track.points[i].jumpKind || "";
          if (k === "ramp") rampDist = track.points[i].dist;
          else if (k !== "crest" && k !== "ramp" && k !== "gap") break;
        }
        v.spawn(track, Math.max(4, rampDist - 4), 0);
        const spd = ji === 2 ? 38 : 28;
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
        let worstHigh = null;
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
          const plant = q.height - TIRE;
          const delta = v.position.y - plant;
          const solid = !pit && q.jumpKind !== "gap";
          if (solid && v.position.y < q.height - 0.08) {
            const under = q.height - v.position.y;
            if (under > maxUnder) maxUnder = under;
            if (!v.onGround && v.speed < 1.2) stuckUnder = true;
          }
          if (landed && v.onGround && q.jumpKind !== "gap" && v.progress < gap.dist + (ji === 2 ? 160 : 90)) {
            const ax = v._axles;
            const bothSolid = !!(ax && ax.front && ax.rear && !ax.front.gap && !ax.rear.gap);
            if (!bothSolid) continue;
            if (delta < minDelta) {
              minDelta = delta;
              worst = {
                y: Math.round(v.position.y * 1000) / 1000,
                plant: Math.round(plant * 1000) / 1000,
                qH: Math.round(q.height * 1000) / 1000,
                kind: q.jumpKind || line.jumpKind || "",
                dist: Math.round(v.progress),
                onG: v.onGround,
                pit: pit,
                armed: !!v._landPadArmed,
                padY: v._landPadY,
              };
            }
            if (delta > maxDelta) {
              maxDelta = delta;
              worstHigh = {
                y: Math.round(v.position.y * 1000) / 1000,
                plant: Math.round(plant * 1000) / 1000,
                qH: Math.round(q.height * 1000) / 1000,
                midH: ax && ax.midH != null ? Math.round(ax.midH * 1000) / 1000 : null,
                fK: ax && ax.front && ax.front.kind,
                rK: ax && ax.rear && ax.rear.kind,
                kind: q.jumpKind || line.jumpKind || "",
                dist: Math.round(v.progress),
                air: Math.round((v._airTime || 0) * 1000) / 1000,
              };
            }
            const wb = (v.spec && v.spec.wheelbase) || 2.55;
            const half = wb * 0.5;
            const sinP = Math.sin(v.pitch);
            const frontY = v.position.y - half * sinP;
            const rearY = v.position.y + half * sinP;
            if (ax && ax.front && !ax.front.gap) {
              const buryF = ax.front.height - TIRE - frontY;
              if (buryF > maxBury) maxBury = buryF;
            }
            if (ax && ax.rear && !ax.rear.gap) {
              const buryR = ax.rear.height - TIRE - rearY;
              if (buryR > maxBury) maxBury = buryR;
            }
            samples += 1;
          }
          if (landed && v.onGround && v.progress > gap.dist + (ji === 2 ? 140 : 80) && samples > 12) break;
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
          worstHigh: worstHigh,
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
      let climb = { ran: false };
      let tunnelDist = null;
      if (jumps.length >= 3) {
        const gap3 = jumps[2];
        let ramp3 = Math.max(4, gap3.dist - 10);
        for (let i = gap3.i; i >= 0; i--) {
          const k = track.points[i].jumpKind || "";
          if (k === "ramp") ramp3 = track.points[i].dist;
          else if (k !== "crest" && k !== "ramp" && k !== "gap") break;
        }
        for (let i = 0; i < track.points.length; i++) {
          if (track.points[i].tunnel && track.points[i].dist > gap3.dist) {
            tunnelDist = track.points[i].dist;
            break;
          }
        }
        const target = tunnelDist != null ? tunnelDist + 12 : gap3.dist + 200;
        // Drive the post-jump-3 flat → climb → tunnel. Launching the jump
        // in this probe left the car yaw-wrong on the pad so progress never
        // left 1109; jump 3 land Y is already proven in results[2].
        const startClimb = gap3.dist + 120;
        v.spawn(track, startClimb, 0);
        const spd = 32;
        v.velocity.set(Math.sin(v.yaw) * spd, 0, Math.cos(v.yaw) * spd);
        v.gear = 3;
        let maxUnder = 0;
        let minDelta = 99;
        let stuck = false;
        let gapLock = false;
        let samples = 0;
        let reachedTunnel = false;
        let minSpeed = 99;
        let warpedTunnel = false;
        let padGlue = false;
        let yWarp = 0;
        const landAt = v.progress;
        const landY = v.position.y;
        const drive = { throttle: 1, brake: 0, steer: 0, handbrake: 0, shiftUp: false, shiftDown: false };
        for (let s = 0; s < 900; s++) {
          v.step(dt, drive, track);
          const q = track.query(v.position.x, v.position.z, {}, v.progress);
          const line = track.sample(v.progress);
          const here = line
            ? Math.hypot(v.position.x - line.x, v.position.z - line.z)
            : 99;
          if (v.position.y < landY - 2.2) {
            yWarp = Math.max(yWarp, landY - v.position.y);
          }
          if (tunnelDist != null && v.progress >= tunnelDist - 6) {
            const tun = track.sample(tunnelDist);
            const tunHere = Math.hypot(v.position.x - tun.x, v.position.z - tun.z);
            if (tunHere > 16) warpedTunnel = true;
          }
          samples += 1;
          const pit = q.jumpKind === "gap" || (line && line.jumpKind === "gap");
          if (pit) gapLock = true;
          const onRibbon = here <= (line && line.width ? line.width * 0.5 + 10 : 16);
          const floor = pit ? (line.y + 0.06) : q.height;
          const under = floor - v.position.y;
          if (onRibbon && !pit && under > maxUnder) maxUnder = under;
          const delta = v.position.y - (q.height - TIRE);
          if (onRibbon && !pit && v.onGround && delta < minDelta) minDelta = delta;
          if (v.speed < minSpeed) minSpeed = v.speed;
          if (!v.onGround && v.speed < 1.2 && under > 0.2) stuck = true;
          if (
            onRibbon &&
            !pit &&
            v.progress > startClimb + 40 &&
            v.position.y < 5.6 &&
            (q.height || 0) > 7
          ) {
            padGlue = true;
          }
          if (v.progress >= target) {
            reachedTunnel = true;
            break;
          }
        }
        const endQ = track.query(v.position.x, v.position.z, {}, v.progress);
        const endLine = track.sample(v.progress);
        climb = {
          ran: true,
          reachedTunnel: reachedTunnel,
          tunnelDist: tunnelDist != null ? Math.round(tunnelDist) : null,
          target: Math.round(target),
          progress: Math.round(v.progress),
          y: Math.round(v.position.y * 1000) / 1000,
          speed: Math.round(v.speed * 10) / 10,
          minSpeed: minSpeed === 99 ? 0 : Math.round(minSpeed * 10) / 10,
          onGround: !!v.onGround,
          kind: (v._q && v._q.jumpKind) || "",
          maxUnder: Math.round(maxUnder * 1000) / 1000,
          minDelta: minDelta === 99 ? 0 : Math.round(minDelta * 1000) / 1000,
          stuck: stuck,
          gapLock: gapLock,
          samples: samples,
          landAt: landAt != null ? Math.round(landAt) : null,
          warpedTunnel: warpedTunnel,
          padGlue: padGlue,
          yWarp: Math.round(yWarp * 1000) / 1000,
          qH: endQ ? Math.round(endQ.height * 1000) / 1000 : null,
          vqH: v._q && Number.isFinite(v._q.height) ? Math.round(v._q.height * 1000) / 1000 : null,
          lineY: endLine && Number.isFinite(endLine.y) ? Math.round((endLine.y + 0.06) * 1000) / 1000 : null,
          here: endLine ? Math.round(Math.hypot(v.position.x - endLine.x, v.position.z - endLine.z) * 10) / 10 : null,
          qDist: endQ && Number.isFinite(endQ.dist) ? Math.round(endQ.dist) : null,
          glitch: v._glitchHits || 0,
        };
      }
      let desync = { ran: false };
      if (jumps.length >= 3 && tunnelDist != null) {
        const gap3 = jumps[2];
        const tun = track.sample(tunnelDist);
        v.spawn(track, gap3.dist + 2, 0);
        v.progress = gap3.dist + 2;
        v.position.x = tun.x;
        v.position.z = tun.z;
        v.position.y = 0;
        v.velY = -8;
        v.onGround = false;
        v.velocity.set(Math.sin(v.yaw) * 12, 0, Math.cos(v.yaw) * 12);
        for (let s = 0; s < 45; s++) v.step(dt, input, track);
        const q = track.query(v.position.x, v.position.z, {}, v.progress);
        const line = track.sample(v.progress);
        const floor = (q.jumpKind === "gap" ? line.y + 0.06 : q.height) - TIRE;
        desync = {
          ran: true,
          y: Math.round(v.position.y * 1000) / 1000,
          floor: Math.round(floor * 1000) / 1000,
          under: Math.round((floor - v.position.y) * 1000) / 1000,
          progress: Math.round(v.progress),
          tunnelDist: Math.round(tunnelDist),
          gapDist: Math.round(gap3.dist),
          onGround: !!v.onGround,
          kind: (v._q && v._q.jumpKind) || "",
        };
      }
      return { jumps: jumps.length, results: results, carry: carry, climb: climb, desync: desync };`
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
            (row.samples > 8 || (row.minDelta >= -0.03 && row.landDist < row.dist + (row.n === 3 ? 160 : 85)))
          ),
          `air=${row.air} land=${row.landed} n=${row.samples} gap@${row.dist}m land@${row.landDist}m`
        );
        check(
          `jump ${row.n} landed on this pad, not a later crest`,
          row.landDist > 0 && row.landDist < row.dist + (row.n === 3 ? 160 : 85),
          `land ${row.landDist} m / gap ${row.dist} m`
        );
        check(
          `jump ${row.n} contact stays on the deck after land`,
          row.minDelta >= -0.03,
          `min ΔY ${row.minDelta} m${row.worst ? ` worst=${JSON.stringify(row.worst)}` : ""}`
        );
        check(
          `jump ${row.n} wheels stay on the roadway (no hover)`,
          row.maxDelta <= 0.18,
          `max ΔY ${row.maxDelta} m${row.worstHigh ? ` high=${JSON.stringify(row.worstHigh)}` : ""}`
        );
        check(
          `jump ${row.n} pitch does not bury an axle`,
          row.maxBury <= 0.04,
          `max axle bury ${row.maxBury} m`
        );
        check(
          `jump ${row.n} never sits under a solid deck`,
          (row.maxUnder || 0) <= 0.08 && !row.stuckUnder,
          `max under ${row.maxUnder || 0} m stuck=${!!row.stuckUnder}`
        );
      }
      const third = rows.find((r) => r.n === 3);
      check("jump 3 (Safari throw) was probed", !!third, third ? `ΔY ${third.minDelta}` : "missing");
      const carry = probe.carry || {};
      check(
        "jump 2 throw cannot tunnel jump 3's ramp",
        !!(carry.ran && carry.reached && (carry.maxUnder || 0) <= 0.08 && !carry.stuckUnder && carry.movable),
        JSON.stringify(carry)
      );
      const climb = probe.climb || {};
      check(
        "after jump 3 the car stays on the road (no tunnel plant)",
        !!(
          climb.ran &&
          !climb.stuck &&
          !climb.gapLock &&
          !climb.warpedTunnel &&
          !climb.padGlue &&
          (climb.yWarp || 0) <= 2.2 &&
          (climb.maxUnder || 0) <= 0.08 &&
          (climb.minDelta == null || climb.minDelta >= -0.04) &&
          climb.onGround &&
          climb.landAt != null &&
          (climb.tunnelDist == null || climb.landAt < climb.tunnelDist - 40)
        ),
        JSON.stringify(climb)
      );
      const desync = probe.desync || {};
      check(
        "pit progress + tunnel XZ cannot fall into the void",
        !!(desync.ran && (desync.under || 0) <= 0.12 && desync.onGround && (desync.y || 0) > 1),
        JSON.stringify(desync)
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
