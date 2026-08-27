#!/usr/bin/env node
/**
 * qa-sky-preview-shots.mjs — batch-screenshot tools/sky-preview.html.
 *
 * WHO THIS IS FOR: whoever is iterating js/sky.js.
 * WHAT IT DOES: opens the isolated sky preview once per (course, tier, pitch)
 *   combination and writes a PNG plus brightness stats. One Chrome launch for
 *   the whole grid, so a full look costs a few seconds instead of a stage build.
 *
 * RUN:  node tools/qa-sky-preview-shots.mjs
 *       node tools/qa-sky-preview-shots.mjs --grid=desert:high:8,desert:min:8
 *       node tools/qa-sky-preview-shots.mjs --out=/tmp/skyprev --tag=after
 */

import fs from "node:fs";
import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, sleep,
} from "./lib/qa-harness.mjs";
import { lumaStats } from "./lib/png-luma.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => {
  const m = new RegExp(`--${n}=([^\\s]+)`).exec(argv.join(" "));
  return m ? m[1] : d;
};
const OUT = arg("out", "/tmp/skyprev");
const TAG = arg("tag", "now");
const HEADLESS = argv.includes("--headless");
/** course:tier:pitch triples. */
const GRID = arg("grid", "desert:high:6,desert:medium:6,desert:low:6,desert:min:6,desert:high:30,forest:high:6,mountain:high:6,lakeside:high:6")
  .split(",")
  .map((s) => s.split(":"))
  .map(([course, tier, pitch]) => ({ course, tier, pitch: pitch || "6" }));
/** Extra query string appended to every preview URL, e.g. --q=cover=0&mie=0 */
const EXTRA = arg("q", "");

async function main() {
  if (!findChrome()) throw new Error("no Chrome — set CHROME_PATH");
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: HEADLESS, width: 1280, height: 640 });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);
  console.log(`SKY PREVIEW SHOTS (${TAG})  ·  ${browser.browserVersion}  ·  ${HEADLESS ? "headless" : "headed"}\n`);

  try {
    for (const g of GRID) {
      const url = `${server.origin}/tools/sky-preview.html?course=${g.course}&tier=${g.tier}&pitch=${g.pitch}&t=8&ref=0${EXTRA ? `&${EXTRA}` : ""}`;
      await goto(cdp, url);
      await waitFor(cdp, `return window.__skyPreviewReady ? 1 : null;`, { timeout: 20000, label: "preview boot" });
      // Let a handful of frames land so the first-compile frame is not the shot.
      await waitFor(cdp, `return (window.__skyPreviewFrames || 0) > 12 ? 1 : null;`, { timeout: 20000, label: "frames" });
      await sleep(260);
      const cap = await cdp.send("Page.captureScreenshot", { format: "png" });
      const buf = Buffer.from(cap.data, "base64");
      const file = `${OUT}-${TAG}-${g.course}-${g.tier}-p${g.pitch}.png`;
      fs.writeFileSync(file, buf);
      const s = lumaStats(buf);
      console.log(
        `  ${g.course.padEnd(9)} ${g.tier.padEnd(7)} pitch ${String(g.pitch).padStart(2)}°  ` +
        `mean ${s.mean.toFixed(4)}  p50 ${s.p50.toFixed(3)}  p99 ${s.p99.toFixed(3)}  clip ${(s.clipped * 100).toFixed(1)}%  ${file}`
      );
    }
  } finally {
    if (errors.length) {
      console.log(`\n${errors.length} page error(s):`);
      for (const e of errors.slice(0, 10)) console.log(`  [${e.type}] ${e.text}`);
    }
    await browser.close();
    await server.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error(`FAIL  ${e.message}`); process.exit(1); });
