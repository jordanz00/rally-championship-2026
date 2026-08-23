#!/usr/bin/env node
/**
 * qa-championship-advance.mjs — championship progression + RETRY sanity.
 *
 * Sprint 9: Lakeside unlock visibility, pending next stage, RETRY does not
 * advance stageIndex before the player clicks NEXT STAGE.
 *
 * RUN: node tools/qa-championship-advance.mjs
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

const steps = [];
let currentStep = "(startup)";

async function step(name, fn) {
  currentStep = name;
  const t0 = Date.now();
  const detail = await fn();
  steps.push({ name, ms: Date.now() - t0, detail: detail || "" });
  console.log(`  ok  ${name}${detail ? `  —  ${detail}` : ""}  (${Date.now() - t0}ms)`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error("FAIL  no Chrome found");
    process.exit(1);
  }
  console.log(`RALLY CHAMPIONSHIP ADVANCE  ·  ${new Date().toISOString()}`);
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);

  try {
    await step("lakeside course visible after unlock flag", async () => {
      await goto(cdp, `${server.origin}/index.html`);
      await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 15000, label: "game" });
      await evaluate(cdp, `localStorage.setItem("rally-lakeside", "1"); return 1;`);
      await pressKey(cdp, "Enter");
      await waitFor(cdp, `return document.querySelector("#screen-menu.active") ? 1 : null;`, {
        timeout: 8000,
        label: "menu",
      });
      await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
      await waitFor(cdp, `return document.querySelector("#screen-cars.active") ? 1 : null;`, {
        timeout: 8000,
        label: "cars",
      });
      await clickSelector(cdp, "[data-car='celica']", "CELICA");
      await waitFor(cdp, `return document.querySelector("#screen-courses.active") ? 1 : null;`, {
        timeout: 12000,
        label: "courses",
      });
      const lake = await waitFor(
        cdp,
        `const el = document.querySelector("[data-course='lakeside']");
         return el ? { hidden: el.hidden } : null;`,
        { timeout: 8000, label: "lakeside button" }
      );
      assert(!lake.hidden, "lakeside should be visible when rally-lakeside=1");
      return "lakeside visible";
    });

    await step("RETRY keeps stageIndex on same championship stage", async () => {
      await goto(cdp, `${server.origin}/index.html`);
      await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 15000, label: "game reload" });
      const out = await evaluate(
        cdp,
        `const g = window.game;
        g.mode = "championship";
        g.stageIndex = 0;
        g.courseId = "desert";
        g.champPlace = 4;
        g.champOrder = ["desert", "forest", "mountain"];
        g._pendingNextCourse = "forest";
        g.state = "result";
        return { before: g.stageIndex, pending: g._pendingNextCourse };`
      );
      assert(out.before === 0 && out.pending === "forest", "setup failed");
      await evaluate(cdp, `window.game._onMenu("retry"); return 1;`);
      await waitFor(
        cdp,
        `const g = window.game;
         return g && (g.state === "countdown" || g.state === "race")
           ? { state: g.state, course: g.courseId } : null;`,
        { timeout: 90000, label: "retry countdown" }
      );
      const after = await evaluate(
        cdp,
        `const g = window.game;
        return {
          stageIndex: g.stageIndex,
          courseId: g.courseId,
          pending: g._pendingNextCourse,
        };`
      );
      assert(after.stageIndex === 0, `RETRY advanced stageIndex to ${after.stageIndex}`);
      assert(after.courseId === "desert", `RETRY wrong course ${after.courseId}`);
      assert(after.pending === "forest", "pending next should survive RETRY");
      return `stageIndex=${after.stageIndex} course=${after.courseId}`;
    });

    await step("NEXT STAGE advances to pending course", async () => {
      await goto(cdp, `${server.origin}/index.html`);
      await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 15000, label: "game reload" });
      await evaluate(
        cdp,
        `const g = window.game;
        g.mode = "championship";
        g.stageIndex = 0;
        g.courseId = "desert";
        g.champOrder = ["desert", "forest", "mountain"];
        g._pendingNextCourse = "forest";
        g.state = "result";
        return 1;`
      );
      await evaluate(cdp, `window.game._onMenu("next"); return 1;`);
      const g = await waitFor(
        cdp,
        `const g = window.game;
         return g && (g.state === "countdown" || g.state === "race")
           ? { stageIndex: g.stageIndex, course: g.courseId, pending: g._pendingNextCourse } : null;`,
        { timeout: 90000, label: "next stage countdown" }
      );
      assert(g.course === "forest", `expected forest, got ${g.course}`);
      assert(g.stageIndex === 1, `expected stageIndex 1, got ${g.stageIndex}`);
      assert(g.pending == null, "pending should clear after NEXT");
      return `stageIndex=${g.stageIndex} course=${g.course}`;
    });

    await step("no fatal console errors", async () => {
      const fatal = errors.filter((e) => !/mergeGeometries/.test(String(e.text || "")));
      if (fatal.length) {
        throw new Error(`page reported ${fatal.length} error(s)`);
      }
      const mergeWarn = errors.length - fatal.length;
      return mergeWarn ? `clean (${mergeWarn} tolerated mergeGeometries warn)` : "clean";
    });

    console.log(`\nPASS  ·  ${steps.length}/${steps.length} advance checks`);
    await browser.close();
    server.close();
    process.exit(0);
  } catch (err) {
    console.error(`\nFAIL  step: ${currentStep}`);
    console.error(err.message || err);
    await browser.close();
    server.close();
    process.exit(1);
  }
}

main();
