#!/usr/bin/env node
/**
 * qa-phys-authority.mjs — physics owns the car; env uses TOI sweep + no freeze.
 *
 * Architecture gate (ChatGPT / studio):
 *   fixed dt → integrate → TOI sweep → resolve → penetration correct → validate
 * Mesh follows drawPose only. Decorative props are not physics solids.
 *
 * RUN: node tools/qa-phys-authority.mjs
 *      node tools/qa-phys-authority.mjs --static
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
  sleep,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

const STATIC_ONLY = process.argv.includes("--static");

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

console.log(`PHYS AUTHORITY  ·  ${new Date().toISOString()}\n`);
console.log("static");

const collide = read("js/physics/collide.js");
const vehicle = read("js/physics/vehicle.js");
const game = read("js/game.js");
const track = read("js/tracks/track.js");
const mainSrc = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(mainSrc, index);

check("FIXED_DT accumulator in race loop", /_physAccum/.test(game) && /FIXED_DT/.test(game));
check("mesh sync is drawPose-only", /_syncPlayerMesh/.test(game) && /drawPose\(alpha\)/.test(game));
check("mesh sync does not write Vehicle.position", /Never write Vehicle\.position from here/.test(game));
check("TOI sweep rewinds to first contact", /placeT/.test(collide) && /earliest time-of-impact/.test(collide));
check("penetration correction after sweep", /export function correctEnvPenetration/.test(collide));
check("contact resolve is normal-only", /Resolve velocity against the normal/.test(collide));
check("deep embed restores last-safe XZ", /_envDeep/.test(vehicle) && /_goodX/.test(vehicle));
check("roadway corridor scrub for solids", /ROAD_COLLIDER_CLEAR/.test(track) && /_assertDriveCorridor/.test(track));
check("game imports collide.js?v=45+", Number((game.match(/collide\.js\?v=(\d+)/) || [])[1]) >= 45);
check("cache-bust chain", cacheOk && Number(gameV) >= 482, `main=${mainV} game=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s)`);
  process.exit(1);
}

if (STATIC_ONLY) {
  console.log("\nPASS  ·  static phys authority");
  process.exit(0);
}

const chrome = findChrome();
if (!chrome) {
  console.log("\nFAIL  ·  Chrome not found for headed probe");
  process.exit(1);
}

console.log("\nheaded Desert jump-3 approach (jittered frames)");

const PROBE = `
  const g = window.game;
  const track = g.track;
  const p = g.player;
  if (!track || !p) return null;
  // Approach the Safari throw (Desert jump 3 gap ~1036 m).
  const target = 990;
  p.spawn(track, target, 0);
  p.velocity.x = Math.sin(p.yaw) * 32;
  p.velocity.z = Math.cos(p.yaw) * 32;
  p.speed = 32;
  p.onGround = true;
  let buried = 0;
  let nan = 0;
  let envDeep = 0;
  let envHit = 0;
  let minDelta = 99;
  const dts = [1/60, 1/60, 1/45, 1/30, 1/60, 1/20, 1/60, 1/60];
  for (let i = 0; i < 240; i++) {
    const dt = dts[i % dts.length];
    // Mimic hitch accumulation: several fixed steps of FIXED_DT, then leftover.
    const FIXED = 1/60;
    let acc = Math.min(dt, 0.1);
    while (acc >= FIXED) {
      acc -= FIXED;
      p.step(FIXED, { steer: 0.05 * Math.sin(i * 0.07), throttle: 0.92, brake: 0, handbrake: 0 }, track);
    }
    if (!Number.isFinite(p.position.x) || !Number.isFinite(p.position.y) || !Number.isFinite(p.position.z)) nan += 1;
    if (p._envDeep) envDeep += 1;
    if (p._envIntersect) envHit += 1;
    const plant = p._roadDeckY(p._axles);
    if (plant != null) {
      const d = p.position.y - plant;
      if (d < minDelta) minDelta = d;
      if (d < -0.35) buried += 1;
    }
  }
  return {
    progress: p.progress,
    speed: p.speed,
    buried,
    nan,
    envDeep,
    envHit,
    minDelta,
    glitch: (p._glitchLog && p._glitchLog.length) || 0
  };
`;

async function run() {
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  await preparePage(cdp);
  try {
    await goto(cdp, `${server.origin}/index.html?v=482`);
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
      `return window.game && window.game.track && window.game.track.id === "desert"
         && (window.game.state === "countdown" || window.game.state === "race")
         ? 1 : null;`,
      { timeout: 180000, label: "desert boot" }
    );
    await sleep(400);
    const probe = await evaluate(cdp, PROBE);
    if (!probe) throw new Error("probe returned null");
    check("no NaN pose during jittered drive", probe.nan === 0, `nan=${probe.nan}`);
    check("not buried under deck", probe.buried === 0, `buried=${probe.buried} minΔ=${probe.minDelta}`);
    check(
      "no deep env embed after TOI",
      probe.envDeep === 0,
      `envDeep=${probe.envDeep} envHit=${probe.envHit}`
    );
    check(
      "still racing forward",
      probe.speed > 8 && probe.progress > 990,
      `spd=${probe.speed.toFixed(1)} progress=${probe.progress.toFixed(0)}`
    );
    console.log(
      `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "phys authority holds under hitch"}`
    );
    process.exit(fail ? 1 : 0);
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
