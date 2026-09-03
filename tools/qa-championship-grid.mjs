#!/usr/bin/env node
/**
 * qa-championship-grid.mjs — championship grid carry after stage finish.
 *
 * Sprint 10: simulate Desert 1st, assert champPlace, pending next, grid slot.
 *
 * RUN: node tools/qa-championship-grid.mjs
 */

import {
  ROOT,
  startServer,
  launchChrome,
  findChrome,
  preparePage,
  goto,
  waitFor,
  evaluate,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error("FAIL  no Chrome found");
    process.exit(1);
  }
  console.log(`RALLY CHAMPIONSHIP GRID  ·  ${new Date().toISOString()}`);
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);

  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 15000, label: "game" });

    const desert1st = await evaluate(
      cdp,
      `const g = window.game;
      g.mode = "championship";
      g.stageIndex = 0;
      g.courseId = "desert";
      g.champOrder = ["desert", "forest", "mountain"];
      g.champPlace = 15;
      g._finish(1);
      return {
        champPlace: g.champPlace,
        pending: g._pendingNextCourse,
        stageIndex: g.stageIndex,
        headline: document.getElementById("result-headline")?.textContent || ""
      };`
    );

    if (desert1st.champPlace !== 1) throw new Error(`expected champPlace 1, got ${desert1st.champPlace}`);
    if (desert1st.pending !== "forest") throw new Error(`expected pending forest, got ${desert1st.pending}`);
    if (desert1st.stageIndex !== 0) throw new Error(`stageIndex should stay 0 until NEXT, got ${desert1st.stageIndex}`);
    if (!/1st|FOREST/i.test(desert1st.headline)) throw new Error(`headline missing grid carry: ${desert1st.headline}`);
    console.log(`  ok  Desert 1st → champPlace=1 pending=forest stageIndex=0`);

    await evaluate(cdp, `window.game._onMenu("next"); return 1;`);
    const forest = await waitFor(
      cdp,
      `const g = window.game;
       return g && (g.state === "countdown" || g.state === "race")
         ? { course: g.courseId, stageIndex: g.stageIndex, place: g.champPlace } : null;`,
      { timeout: 90000, label: "forest grid start" }
    );
    if (forest.course !== "forest") throw new Error(`expected forest, got ${forest.course}`);
    if (forest.place !== 1) throw new Error(`grid should start 1st on forest, champPlace=${forest.place}`);
    console.log(`  ok  NEXT STAGE → forest with grid 1st (slot verified via champPlace)`);

    const fatal = errors.filter((e) => !/mergeGeometries/.test(String(e.text || "")));
    if (fatal.length) throw new Error(`${fatal.length} page error(s)`);

    console.log(`\nPASS  ·  2/2 grid carry checks`);
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
