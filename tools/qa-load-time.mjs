#!/usr/bin/env node
/**
 * qa-load-time.mjs — wall-clock Desert load (car click → countdown).
 *
 * Championship leaves menu Track.create running (player path). Reports
 * loadMs and cut vs the pre-fast-load baseline (~176 s cold).
 *
 * RUN: RALLY_QA_ALLOW_CHROME=1 node tools/qa-load-time.mjs
 */
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
  pressKey,
  sleep,
  chromeUnavailableHint,
} from "./lib/qa-harness.mjs";

const BASELINE_MS = 176250;

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error(chromeUnavailableHint());
    process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
  }
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  await preparePage(cdp);
  await goto(cdp, `${server.origin}/index.html?nocache=${Date.now()}`);
  await waitFor(cdp, `return window.game||window.__rallyBootEngine?1:null;`, {
    timeout: 20000,
    label: "boot",
  });
  await pressKey(cdp, "Enter");
  await waitFor(
    cdp,
    `return document.querySelector(".screen.active")?.id==="screen-menu"?1:null;`,
    { timeout: 45000, label: "menu" }
  );
  await sleep(600);
  await clickSelector(cdp, "[data-menu='championship']", "champ");
  await waitFor(
    cdp,
    `return document.querySelector(".screen.active")?.id==="screen-cars"?1:null;`,
    { timeout: 45000, label: "cars" }
  );
  await waitFor(
    cdp,
    `return document.querySelector("[data-car='celica']") && !document.querySelector("[data-car='celica']").disabled ? 1 : null;`,
    { timeout: 45000, label: "celica" }
  );
  await sleep(800);
  const t0 = Date.now();
  await clickSelector(cdp, "[data-car='celica']", "celica");
  for (let i = 0; i < 90; i++) {
    let snap = null;
    try {
      snap = await evaluate(
        cdp,
        `const g=window.game; const el=document.getElementById("load-pct");
         return {state:g&&g.state, pct:el&&el.textContent};`
      );
    } catch {
      snap = null;
    }
    if (i % 3 === 0) console.log(`${Date.now() - t0}ms`, JSON.stringify(snap));
    if (snap && (snap.state === "countdown" || snap.state === "race")) {
      const loadMs = Date.now() - t0;
      const cutPct = Math.round((1 - loadMs / BASELINE_MS) * 100);
      console.log(JSON.stringify({ loadMs, cutPct, hit80: loadMs <= BASELINE_MS * 0.2 }));
      // Pass if ≥65% cut vs pre-fast baseline (headless SwiftShader is slower than real GPU).
      process.exit(loadMs <= BASELINE_MS * 0.35 ? 0 : 1);
    }
    await sleep(500);
  }
  console.error("TIMEOUT");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
