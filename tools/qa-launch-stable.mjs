#!/usr/bin/env node
/**
 * qa-launch-stable.mjs — player hull must stay planted on a dead-stop launch.
 *
 * Static contracts live in qa-sprint28-launch.mjs. This probe starts a real
 * Desert race, holds throttle, and fails if visual pitch or forward speed
 * chatters like a spring.
 *
 * RUN: node tools/qa-launch-stable.mjs
 */

import {
  ROOT,
  startServer,
  launchChrome,
  findChrome,
  preparePage,
  goto,
  waitFor,
  clickResilient,
  evaluate,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

let fail = 0;
function check(label, ok, detail) {
  if (ok) console.log(`  ok  ${label}`);
  else {
    console.log(`  FAIL  ${label}  —  ${detail}`);
    fail += 1;
  }
}

async function main() {
  console.log(`LAUNCH STABLE GATE  ·  ${new Date().toISOString()}\n`);
  if (!findChrome()) {
    console.error(chromeUnavailableHint());
    process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
  }

  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true, width: 1280, height: 720 });
  const { cdp } = browser;
  await preparePage(cdp);

  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "window.game" });
    await clickResilient(cdp, "#btn-start", "PRESS START");
    await waitFor(
      cdp,
      `const e = document.querySelector(".screen.active"); return e && e.id === "screen-menu" ? 1 : null;`,
      { timeout: 15000, label: "SELECT MODE" }
    );
    await clickResilient(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(
      cdp,
      `const e = document.querySelector(".screen.active"); return e && e.id === "screen-cars" ? 1 : null;`,
      { timeout: 15000, label: "SELECT CAR" }
    );
    await waitFor(
      cdp,
      `const b = document.querySelector("[data-car='celica']"); return b && !b.disabled ? 1 : null;`,
      { timeout: 25000, label: "Celica selectable" }
    );
    await clickResilient(cdp, "[data-car='celica']", "CELICA");
    await waitFor(
      cdp,
      `const e = document.querySelector(".screen.active"); return e && e.id === "screen-courses" ? 1 : null;`,
      { timeout: 20000, label: "SELECT COURSE" }
    );
    await clickResilient(cdp, "[data-course='desert']", "DESERT");
    await waitFor(cdp, `return window.game && window.game.track ? 1 : null;`, {
      timeout: 120000,
      label: "Desert track"
    });
    await waitFor(
      cdp,
      `return window.game && (window.game.state === "countdown" || window.game.state === "race") && window.game.player && window.game.track ? 1 : null;`,
      { timeout: 30000, label: "countdown or race with player" }
    );

    const sample = await evaluate(cdp, `
      const g = window.game;
      const p = g.player;
      const track = g.track;
      const input = { steer: 0, throttle: 1, brake: 0, handbrake: 0, shiftUp: false, shiftDown: false };
      const pitch = [];
      const vx = [];
      for (let i = 0; i < 120; i++) {
        p.step(1 / 60, input, track);
        pitch.push(p.pitch);
        const fwdX = Math.sin(p.yaw);
        const fwdZ = Math.cos(p.yaw);
        vx.push(p.velocity.x * fwdX + p.velocity.z * fwdZ);
      }
      const body = pitch.slice(8);
      let pMin = Infinity, pMax = -Infinity;
      for (let i = 0; i < body.length; i++) {
        if (body[i] < pMin) pMin = body[i];
        if (body[i] > pMax) pMax = body[i];
      }
      let reversals = 0;
      const run = vx.slice(8);
      for (let i = 2; i < run.length; i++) {
        const d1 = run[i] - run[i - 1];
        const d2 = run[i - 1] - run[i - 2];
        if (d1 * d2 < 0 && Math.abs(d1) > 0.08) reversals += 1;
      }
      return {
        n: vx.length,
        pitchSpan: Number.isFinite(pMin) ? pMax - pMin : 99,
        reversals,
        lastVx: run.length ? run[run.length - 1] : 0,
        throttle: p.throttle
      };
    `);

    check(
      "probe captured launch samples",
      sample.n >= 40,
      `got ${sample.n} samples`
    );
    check(
      "visual pitch stays planted on throttle",
      sample.pitchSpan < 0.045,
      `pitch peak-to-peak ${(sample.pitchSpan * 180 / Math.PI).toFixed(2)} deg (limit 2.6)`
    );
    check(
      "forward speed does not hop",
      sample.reversals <= 10,
      `${sample.reversals} accel sign flips (limit 10)`
    );
    check(
      "launch actually moved the car",
      sample.lastVx > 8,
      `vx=${sample.lastVx.toFixed(2)} m/s`
    );
  } finally {
    await browser.close();
    await server.close();
  }

  console.log(
    `\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "launch hull is stable"}`
  );
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
