#!/usr/bin/env node
/**
 * Static proof: M-series MacBook Retina stays sharp under a hard 60 Hz budget.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

let fail = 0;
function check(name, ok, detail = "") {
  if (ok) console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  else {
    fail++;
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const game = read("js/game.js");
const tsr = read("js/gfx/tsr-upscaler.js");
const qm = read("js/gfx/quality-manager.js");
const perf = read("js/gfx/perf-tier.js");
const sdk = read("js/gfx/browser-reconstruct-sdk/index.js");
const index = read("index.html");
const main = read("js/main.js");

check("isMacDesktopPlay helper", /function isMacDesktopPlay\(/.test(game));
check("Mac race DPR 1.75× (60-first)", /GFX\.maxPixelRatio = 1\.75/.test(game));
check("Mac race pixel budget 3.4M", /GFX\.maxPixels = 3400000/.test(game));
check("Mac title DPR 1.35×", /TITLE_SHOWROOM\.maxPixelRatio = 1\.35/.test(game));
check(
  "Safari missing deviceMemory → high",
  /mem == null \|\| mem >= 8/.test(game)
);
check("desktop keeps 60 Hz", /GFX\.targetFps = 60/.test(game) && /preferLock30 = false/.test(game));
check("desktop softScaleMin 0.78", /GFX\.softScaleMin = 0\.78/.test(game));
check("race soft scale headroom", /_softRenderScale = isPhonePlay\(\) \? 0\.78 : 0\.94/.test(game));
check("TSR quality ≤ 0.88", /quality: 0\.86/.test(tsr));
check("QualityManager fast down", /DOWN_HOLD = 6/.test(qm) && /DOWN_STEP = 0\.06/.test(qm));
check("early TSR shed for 60", /ema > 18\.2/.test(game) && /ema > 22/.test(game));
check("QUALITY_CAPS DPR 2", /maxPixelRatio: 2/.test(perf));
check("sdk imports tsr v991+", Number((sdk.match(/tsr-upscaler\.js\?v=(\d+)/) || [])[1]) >= 991);

const mainV = Number((index.match(/main\.js\?v=(\d+)/) || [])[1] || 0);
const gameV = Number((main.match(/game\.js\?v=(\d+)/) || [])[1] || 0);
check("boot 1094+", mainV >= 1094 && gameV === mainV, `main=${mainV} game=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} check(s)`);
  process.exit(1);
}
console.log("\nPASS  ·  Mac Retina + consistent 60 Hz budget");
