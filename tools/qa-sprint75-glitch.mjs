#!/usr/bin/env node
/**
 * Sprint 75 — Glitch Department. The car stays on the road.
 *
 * Player contract: never fall through the ribbon, never warp to another part
 * of the stage, never freeze while holding throttle on the painted lane.
 *
 * RUN:  node tools/qa-sprint75-glitch.mjs
 *       node tools/qa-sprint75-glitch.mjs --static     (code gates only)
 *       node tools/qa-sprint75-glitch.mjs --headed     (watch the drive)
 * EXIT: 0 when static gates pass and (unless --static) every championship
 *       stage was driven without a teleport / bury / NaN.
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
  evaluate,
  waitFor,
  clickSelector,
  sleep,
  waitForResponsiveMainThread,
} from "./lib/qa-harness.mjs";

const STATIC_ONLY = process.argv.includes("--static");
const HEADED = process.argv.includes("--headed");
const COURSES = ["desert", "forest", "mountain"];
const DRIVE_MS = 5000;
const SAMPLE_MS = 90;
/** Metres of along-track jump between samples that is a teleport, not driving. */
const TELEPORT_M = 28;
/** Metres under the road deck that counts as buried. */
const BURIED_M = 1.6;

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

function writeReport(rows) {
  const lines = [
    "# Glitch report — road integrity",
    "",
    `**Date:** ${new Date().toISOString()}`,
    "**Department:** Glitch / QA — stay on the road.",
    "**Contract:** The car never glitches on the painted lane and never teleports.",
    "",
    "## Automated drive",
    "",
    "| Course | Samples | Dist (m) | Speed max | Glitch hits | Teleports | Buried | NaN | Verdict |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---|",
  ];
  for (const r of rows) {
    const v = r.ok ? "PASS" : "FAIL";
    lines.push(
      `| ${r.course} | ${r.samples} | ${r.dist.toFixed(1)} | ${r.speedMax.toFixed(1)} | ${r.hits} | ${r.teleports} | ${r.buried} | ${r.nan} | **${v}** |`
    );
    if (r.log && r.log.length) {
      lines.push("");
      lines.push(`### ${r.course} incidents`);
      lines.push("");
      for (const g of r.log.slice(0, 12)) {
        lines.push(`- \`${g.kind}\` t=${g.t} progress=${g.progress} ${JSON.stringify(g)}`);
      }
    }
  }
  lines.push("");
  lines.push("## Static gates");
  lines.push("");
  lines.push("Ribbon lock, along-track continuity in `Track.query`, live `_guardDrive`, phone quality start.");
  lines.push("");
  lines.push("**Proof:** `node tools/qa-sprint75-glitch.mjs`");
  lines.push("");
  fs.writeFileSync(path.join(ROOT, "docs/GLITCH-REPORT.md"), lines.join("\n"));
}

function staticGates() {
  console.log(`SPRINT 75 GLITCH DEPARTMENT  ·  ${new Date().toISOString()}\n`);
  console.log("static gates");

  const vehicle = read("js/physics/vehicle.js");
  const track = read("js/tracks/track.js");
  const collide = read("js/physics/collide.js");
  const game = read("js/game.js");
  const ai = read("js/ai.js");
  const perf = read("js/gfx/perf-tier.js");
  const input = read("js/input.js");
  const main = read("js/main.js");
  const index = read("index.html");
  const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

  check("_keepOnRibbon still rejects snaps", /_keepOnRibbon\(/.test(vehicle) && /maxStep/.test(vehicle));
  check("along-track wrap helper", /_alongDelta\(/.test(vehicle));
  check("live _guardDrive (teleport / NaN / buried)", /_guardDrive\(/.test(vehicle) && /buried/.test(vehicle));
  check("NaN restore still armed", /_restoreGoodPose\(/.test(vehicle) && /_stashGoodPose\(/.test(vehicle));
  check(
    "query prefers ribbon continuity over Euclidean nearest",
    /ALONG_W/.test(track) && /MAX_ALONG/.test(track) && /Hairpin opposite arms/.test(track)
  );
  check(
    "hinted query keeps a local winner, then walks forward if XZ left the pit",
    /bestScore < Infinity/.test(track) && /Stale pit hint/.test(track)
  );
  check("overlapping ribbons become a flyover", /_separateOverlappingRibbon\(/.test(track));
  check("snapped re-query pins to last dist", /_pinQuery\(/.test(vehicle));
  check("Y-warp restore", /y-warp/.test(vehicle));
  check(
    "off-road reset refuses an along-track warp",
    /dAlong <= 18/.test(collide) && /Never plant onto a different loop/.test(collide)
  );
  check("TIRE_PLANT unchanged", /const TIRE_PLANT\s*=\s*0\.014/.test(vehicle));
  check("QA throttle hold", /_qaHold/.test(input) && /_qaDrive/.test(game));
  check("qaSnapshot on the game", /qaSnapshot\(/.test(game));
  check("phone starts on low tier", /startTier: isPhonePlay\(\) \? "low"/.test(game));
  check("createPerfTier accepts startTier", /opts\.startTier/.test(perf));
  check("never-under-world floor", /_neverFallThrough/.test(vehicle) && /_reacquireProgress/.test(vehicle));
  check("game + AI import vehicle.js", /vehicle\.js\?v=(\d+)/.test(game) && Number((game.match(/vehicle\.js\?v=(\d+)/) || [])[1]) >= 90);
  check("game imports track.js", /track\.js\?v=(\d+)/.test(game) && Number((game.match(/track\.js\?v=(\d+)/) || [])[1]) >= 184);
  check("cache-bust chain", cacheOk && Number(gameV) >= 424, `main=${mainV} game=${gameV}`);
}

async function driveCourse(cdp, course, first) {
  if (first) {
    await clickSelector(cdp, "[data-course='" + course + "']", course.toUpperCase());
  } else {
    // Drop the previous stage's throttle hold, then kick the next load on a
    // later task so this evaluate cannot sit behind a long sync rebuild.
    await waitForResponsiveMainThread(cdp, 400, 120000);
    await evaluate(
      cdp,
      `
        const g = window.game;
        if (g) {
          g._qaDrive = null;
          if (g.input) g.input._qaHold = null;
        }
        const id = ${JSON.stringify(course)};
        setTimeout(() => { if (window.game) window.game._beginRace(id); }, 0);
        return true;
      `,
      { timeoutMs: 8000 }
    );
    await sleep(250);
  }
  await waitFor(
    cdp,
    `
      const g = window.game;
      if (!g) return null;
      if (g.state !== "countdown" && g.state !== "race") return null;
      if (g.courseId !== ${JSON.stringify(course)}) return null;
      if (!g.player || !g.track) return null;
      return { state: g.state };
    `,
    { timeout: 180000, label: `${course} countdown/race` }
  );
  await waitFor(
    cdp,
    `return window.game && (window.game.state === "countdown" || window.game.state === "race") && window.game.player && window.game.track ? 1 : null;`,
    { timeout: 20000, label: `${course} ready to drive` }
  );
  const STEPS = 240;
  const CHUNK = 30;
  const samples = [];
  let pack = { hits: 0, log: [], throttleIn: 0, throttleCar: 0 };
  for (let start = 0; start < STEPS; start += CHUNK) {
    const n = Math.min(CHUNK, STEPS - start);
    const arm = start === 0;
    pack = await evaluate(
      cdp,
      `
        const g = window.game;
        if (!g || !g.player || !g.track) return { error: "no game", samples: [] };
        if (${arm ? "true" : "false"}) {
          g.state = "race";
          g.countdown = 0;
          g._qaDrive = { throttle: 1, steer: 0, brake: 0, handbrake: 0 };
          g.input._qaHold = g._qaDrive;
        }
        const samples = [];
        const n = ${n};
        try {
          for (let i = 0; i < n; i++) {
            g.input.poll();
            g._fixed(1 / 60);
            if (i % 8 === 0) {
              const s = g.qaSnapshot();
              if (s) {
                s.glitchLog = undefined;
                samples.push(s);
              }
            }
          }
        } catch (err) {
          return { error: String(err && err.message ? err.message : err), samples, hits: 99, log: [] };
        }
        return {
          error: null,
          samples,
          hits: g.player._glitchHits || 0,
          log: g.player._glitchLog || [],
          throttleIn: g.input.throttle,
          throttleCar: g.player.throttle,
        };
      `,
      { timeoutMs: 120000 }
    );
    if (pack.error) throw new Error(`${course} pump: ${pack.error}`);
    samples.push(...(pack.samples || []));
  }
  await evaluate(
    cdp,
    `
      const g = window.game;
      if (g) {
        g._qaDrive = null;
        if (g.input) g.input._qaHold = null;
      }
      return true;
    `
  );

  let teleports = 0;
  let buried = 0;
  let nan = 0;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (!b.finite) nan += 1;
    const along = Math.abs((b.progress || 0) - (a.progress || 0));
    if (along > TELEPORT_M) teleports += 1;
    if (b.onGround && b.roadY != null && b.y < b.roadY - BURIED_M && !b.jumpKind) buried += 1;
  }
  const firstS = samples[0];
  const lastS = samples[samples.length - 1];
  const dist = lastS && firstS ? Math.abs((lastS.progress || 0) - (firstS.progress || 0)) : 0;
  const speedMax = samples.reduce((m, s) => Math.max(m, s.speed || 0), 0);
  const hits = pack.hits != null ? pack.hits : lastS ? lastS.glitchHits || 0 : 99;
  const log = pack.log || (lastS && lastS.glitchLog) || [];
  const moved = dist > 8 || speedMax > 6;
  const throttled = samples.some((s) => (s.throttle || 0) > 0.2) || pack.throttleCar > 0.2 || pack.throttleIn > 0.2;
  const ok =
    moved &&
    throttled &&
    teleports === 0 &&
    buried === 0 &&
    nan === 0 &&
    hits === 0 &&
    samples.length >= 8;
  return {
    course,
    samples: samples.length,
    dist,
    speedMax,
    hits,
    teleports,
    buried,
    nan,
    log,
    ok,
    moved,
  };
}

async function chromeDrive() {
  const chrome = findChrome();
  if (!chrome) {
    console.log("\n  SKIP  live drive — no Chrome/Chromium (set CHROME_PATH)");
    return [];
  }
  console.log(`\nlive drive  ·  ${chrome}`);
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: !HEADED });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);
  const rows = [];
  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "window.game" });
    await clickSelector(cdp, "#btn-start", "PRESS START");
    await waitFor(
      cdp,
      `const el = document.querySelector(".screen.active"); return el && el.id === "screen-menu" ? 1 : null;`,
      { timeout: 60000, label: "SELECT MODE" }
    );
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(
      cdp,
      `
        const screen = document.querySelector(".screen.active");
        if (!screen || screen.id !== "screen-cars") return null;
        const b = document.querySelector("[data-car='celica']");
        if (!b || b.disabled) return null;
        const r = b.getBoundingClientRect();
        return r.width > 8 && r.height > 8 ? 1 : null;
      `,
      { timeout: 40000, label: "Celica hittable on SELECT CAR" }
    );
    await clickSelector(cdp, "[data-car='celica']", "CELICA GT-FOUR");
    await waitFor(
      cdp,
      `const el = document.querySelector(".screen.active"); return el && el.id === "screen-courses" ? 1 : null;`,
      { timeout: 60000, label: "SELECT COURSE" }
    );

    for (let i = 0; i < COURSES.length; i++) {
      const row = await driveCourse(cdp, COURSES[i], i === 0);
      rows.push(row);
      const v = row.ok ? "ok" : "FAIL";
      console.log(
        `  ${v}  ${row.course}  samples=${row.samples} dist=${row.dist.toFixed(1)}m vmax=${row.speedMax.toFixed(1)} hits=${row.hits} tele=${row.teleports} buried=${row.buried} nan=${row.nan}`
      );
      if (!row.ok) fail += 1;
      if (i < COURSES.length - 1) await sleep(400);
    }

    if (errors.length) {
      const listed = errors.slice(0, 6).map((e) => e.text || e).join(" | ");
      check("no console errors during drive", false, listed);
    } else {
      check("no console errors during drive", true);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return rows;
}

async function main() {
  staticGates();
  let rows = [];
  if (!STATIC_ONLY) {
    try {
      rows = await chromeDrive();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.log(`  retry live drive — ${msg}`);
      try {
        rows = await chromeDrive();
      } catch (err2) {
        fail += 1;
        console.log(`  FAIL  live drive — ${err2 && err2.message ? err2.message : err2}`);
      }
    }
  } else {
    console.log("\n  skip  live drive (--static)");
  }
  if (rows.length) writeReport(rows);
  else if (!STATIC_ONLY) {
    writeReport([
      {
        course: "(no drive)",
        samples: 0,
        dist: 0,
        speedMax: 0,
        hits: 0,
        teleports: 0,
        buried: 0,
        nan: 0,
        log: [],
        ok: false,
      },
    ]);
  }

  console.log(
    `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "road lock holds — no teleport, no bury"}`
  );
  process.exit(fail ? 1 : 0);
}

main();
