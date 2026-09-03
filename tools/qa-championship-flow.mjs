#!/usr/bin/env node
/**
 * qa-championship-flow.mjs — verify every championship stage boots.
 *
 * Sprint 8: Desert alone is not enough. This walks PRACTICE → car → each
 * main-stage course and asserts countdown + courseId without driving a lap.
 *
 * RUN: node tools/qa-championship-flow.mjs
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
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

const STAGES = ["desert", "forest", "mountain", "lakeside"];
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
  console.log(`RALLY CHAMPIONSHIP FLOW  ·  ${new Date().toISOString()}`);
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);

  try {
    for (const courseId of STAGES) {
      await step(`PRACTICE → celica → ${courseId.toUpperCase()} countdown`, async () => {
        await goto(cdp, `${server.origin}/index.html`);
        await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 15000, label: "game after reload" });
        if (courseId === "lakeside") {
          await evaluate(cdp, `localStorage.setItem("rally-lakeside", "1"); return 1;`);
        }
        await pressKey(cdp, "Enter");
        await waitFor(cdp, `return document.querySelector("#screen-menu.active") ? 1 : null;`, {
          timeout: 8000,
          label: "menu"
        });
        await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
        await waitFor(cdp, `return document.querySelector("#screen-cars.active") ? 1 : null;`, {
          timeout: 8000,
          label: "cars"
        });
        await waitFor(
          cdp,
          `const b = document.querySelector("[data-car='celica']"); return b && !b.disabled ? 1 : null;`,
          { timeout: 60000, label: "celica GLB ready" }
        );
        await clickSelector(cdp, "[data-car='celica']", "CELICA");
        await waitFor(cdp, `return document.querySelector("#screen-courses.active") ? 1 : null;`, {
          timeout: 20000,
          label: "courses"
        });
        await clickSelector(cdp, `[data-course='${courseId}']`, courseId.toUpperCase());
        const g = await waitFor(
          cdp,
          `const g = window.game;
           return g && (g.state === "countdown" || g.state === "race")
             ? { state: g.state, course: g.courseId } : null;`,
          { timeout: 180000, label: `${courseId} countdown after load` }
        );
        assert(g.course === courseId, `expected course ${courseId}, got ${g.course}`);
        return `course=${g.course} state=${g.state}`;
      });
    }

    await step("no console errors or uncaught exceptions", async () => {
      const fatal = errors.filter((e) => !/mergeGeometries/.test(String(e.text || "")));
      if (fatal.length) {
        const listed = fatal
          .slice(0, 8)
          .map((e, i) => `\n     ${i + 1}. [${e.type}] ${e.text}${e.url ? ` (${e.url})` : ""}`)
          .join("");
        throw new Error(`the page reported ${fatal.length} error(s):${listed}`);
      }
      const mergeWarn = errors.length - fatal.length;
      return mergeWarn ? `clean (${mergeWarn} tolerated mergeGeometries warn)` : "clean";
    });

    console.log(`\nPASS  ·  ${steps.length}/${steps.length} stages boot  ·  0 page errors`);
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
