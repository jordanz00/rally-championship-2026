#!/usr/bin/env node
/**
 * qa-mountain-start.mjs — Mountain stage 3 opening must not wall off the ribbon.
 *
 * Sprint 11: sample land-plane trench heights near the start grid; road bed must
 * sit below ribbon Y (no solid slab through the opening climb).
 *
 * RUN: node tools/qa-mountain-start.mjs
 */

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

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error("FAIL  no Chrome found");
    process.exit(1);
  }
  console.log(`RALLY MOUNTAIN START  ·  ${new Date().toISOString()}`);
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);

  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 15000, label: "game" });
    await pressKey(cdp, "Enter");
    await waitFor(cdp, `return document.querySelector("#screen-menu.active") ? 1 : null;`, {
      timeout: 8000,
      label: "menu",
    });
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(cdp, `return document.querySelector("#screen-cars.active") ? 1 : null;`, {
      timeout: 12000,
      label: "cars",
    });
    await waitFor(
      cdp,
      `const b = document.querySelector("[data-car='celica']"); return b && !b.disabled ? 1 : null;`,
      { timeout: 60000, label: "celica enabled" }
    );
    await clickSelector(cdp, "[data-car='celica']", "CELICA");
    await waitFor(cdp, `return document.querySelector("#screen-courses.active") ? 1 : null;`, {
      timeout: 15000,
      label: "courses",
    });
    await clickSelector(cdp, "[data-course='mountain']", "MOUNTAIN");
    await waitFor(
      cdp,
      `return window.game && (window.game.state === "countdown" || window.game.state === "race")
         ? window.game.courseId : null;`,
      { timeout: 90000, label: "mountain boot" }
    );

    const sample = await evaluate(
      cdp,
      `const g = window.game;
      const track = g.track;
      const player = g.player;
      if (!track || !player) return null;
      const px = player.position.x;
      const pz = player.position.z;
      const road = track._nearestRoad(px, pz);
      const checks = [];
      const cell = track._landCell || 14;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          const x = px + dx * cell * 0.5;
          const z = pz + dz * cell * 0.5;
          const near = track._nearestRoad(x, z);
          const gh = track._groundHeight(x, z, "mountain");
          checks.push({ dist: near.dist, roadY: near.roadY, groundY: gh, delta: gh - near.roadY });
        }
      }
      const worst = checks.reduce((a, b) => (b.delta > a.delta ? b : a), checks[0]);
      const trench = checks.filter((c) => c.dist < 22);
      const maxTrenchDelta = trench.length
        ? trench.reduce((m, c) => Math.max(m, c.delta), -99)
        : worst.delta;
      return {
        course: g.courseId,
        playerY: player.position.y,
        roadY: road.roadY,
        worst,
        maxTrenchDelta,
        sweepPoints: track.points.filter((p) => p.sweep).length,
      };`
    );

    if (!sample || sample.course !== "mountain") throw new Error("mountain track not loaded");
    if (sample.maxTrenchDelta > -0.2) {
      throw new Error(
        `land mesh too high in trench near start (max delta ${sample.maxTrenchDelta.toFixed(2)} m; want <= -0.2)`
      );
    }
    console.log(
      `  ok  trench bed below ribbon (max delta ${sample.maxTrenchDelta.toFixed(2)} m, roadY≈${sample.roadY.toFixed(1)})`
    );
    if (sample.sweepPoints < 8) throw new Error(`expected sweep berm points, got ${sample.sweepPoints}`);
    console.log(`  ok  Act 6 sweep authored (${sample.sweepPoints} sample points)`);

    const fatal = errors.filter((e) => !/mergeGeometries/.test(String(e.text || "")));
    if (fatal.length) throw new Error(`${fatal.length} page error(s)`);

    console.log(`\nPASS  ·  2/2 mountain start checks`);
    await browser.close();
    server.close();
    process.exit(0);
  } catch (err) {
    console.error(`\nFAIL  ${err.message || err}`);
    await browser.close();
    server.close();
    process.exit(1);
  }
}

main();
