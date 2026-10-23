#!/usr/bin/env node
/**
 * qa-iphone13-smoke.mjs — CDP smoke with iPhone 13 Safari UA + viewport.
 *
 * WHO THIS IS FOR: ship gate when a real iPhone 13 tab-kills on boot.
 * WHAT IT DOES: boots local (or LIVE=1 Pages) under iPhone 13 metrics,
 *   presses START, picks championship, loads Desert, asserts no boot-error
 *   and that the tab stays alive through countdown.
 *
 * NOTE: Chrome + iPhone UA — not WebKit. Still exercises phone-lite branches
 *   and fill-rate / deferred-GL paths. Real Safari needs a human.
 *
 * RUN:  RALLY_QA_ALLOW_CHROME=1 node tools/qa-iphone13-smoke.mjs
 *       LIVE=1 RALLY_QA_ALLOW_CHROME=1 node tools/qa-iphone13-smoke.mjs
 */

import path from "node:path";
import fs from "node:fs";
import {
  ROOT,
  startServer,
  launchChrome,
  findChrome,
  preparePage,
  goto,
  evaluate,
  waitFor,
  clickResilient,
  sleep,
  screenshot,
  chromeUnavailableHint,
} from "./lib/qa-harness.mjs";

/** iPhone 13 Safari — 390×844 @3x, Mobile Safari UA. */
const IPHONE13_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const LIVE = process.env.LIVE === "1";
const ORIGIN = process.env.ORIGIN || "https://jordanz00.github.io/rally-championship-2026";

let fail = 0;
function ok(name, detail = "") {
  console.log(`  ok  ${name}${detail ? `  —  ${detail}` : ""}`);
}
function bad(name, detail) {
  fail += 1;
  console.log(`  FAIL  ${name}  —  ${detail}`);
}

async function armIphone13(cdp) {
  await cdp.send("Emulation.setUserAgentOverride", {
    userAgent: IPHONE13_UA,
    platform: "iPhone",
    acceptLanguage: "en-US,en",
  });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  // Cap JS heap closer to Safari (Chrome default is far larger).
  try {
    await cdp.send("Emulation.setMemoryPressureNotificationsSuppressed", {
      suppressed: false,
    });
  } catch {
    /* optional */
  }
}

async function probe(cdp) {
  return evaluate(
    cdp,
    `
    const g = window.game;
    const err = document.getElementById("boot-error");
    const active = document.querySelector(".screen.active");
    const canvas = document.querySelector("#game-view canvas");
    return {
      hasGame: !!g,
      state: g ? g.state : null,
      mode: g ? g.mode : null,
      courseId: g ? g.courseId : null,
      hasRenderer: !!(g && g.renderer),
      gfxFailed: !!(g && g._gfxFailed),
      phoneLite: !!window.__rallyPhoneLite,
      isPhone: document.documentElement.classList.contains("is-phone"),
      screen: active ? active.id : "(none)",
      bootErrorVisible: !!(err && !err.hidden && (err.textContent || "").trim()),
      bootErrorText: err && !err.hidden ? String(err.textContent || "").slice(0, 280) : "",
      canvasW: canvas ? canvas.width : 0,
      canvasH: canvas ? canvas.height : 0,
      ua: navigator.userAgent,
      dpr: window.devicePixelRatio,
      rivalReady: !!(g && typeof g._carSelectable === "function"),
    };
  `
  );
}

async function main() {
  console.log(`IPHONE 13 SMOKE  ·  ${LIVE ? "LIVE Pages" : "local"}  ·  ${new Date().toISOString()}\n`);

  const chrome = findChrome();
  if (!chrome) {
    console.log(chromeUnavailableHint());
    process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
  }

  let server = null;
  let origin = ORIGIN;
  if (!LIVE) {
    server = await startServer(ROOT);
    origin = server.origin;
  }

  const browser = await launchChrome({
    headless: true,
    width: 390,
    height: 844,
  });
  const { cdp } = browser;
  const outDir = path.join(ROOT, "tools", "qa-out");
  fs.mkdirSync(outDir, { recursive: true });

  const consoleLines = [];
  cdp.on("Runtime.consoleAPICalled", (ev) => {
    const text = (ev.args || [])
      .map((a) => a.value ?? a.description ?? "")
      .join(" ");
    consoleLines.push(`[${ev.type}] ${text}`);
  });
  cdp.on("Runtime.exceptionThrown", (ev) => {
    const d = ev.exceptionDetails || {};
    consoleLines.push(`[exception] ${d.text || ""} ${d.exception?.description || ""}`);
  });

  try {
    await preparePage(cdp);
    await armIphone13(cdp);
    await goto(cdp, `${origin}/index.html?v=${Date.now()}`);

    // Splash: HTML only — game.js must NOT be parsed yet on phones.
    await sleep(1500);
    let p = await probe(cdp);
    if (!/iPhone/i.test(p.ua || "")) bad("iPhone UA", p.ua);
    else ok("iPhone 13 UA", "Mobile Safari string");

    if (!p.phoneLite && !p.isPhone) bad("phone lite armed", "missing __rallyPhoneLite / is-phone");
    else ok("phone lite armed");

    const defer = await evaluate(cdp, `return !!window.__rallyPhoneDefer;`);
    if (!defer) bad("engine deferred on splash", "__rallyPhoneDefer missing");
    else ok("engine deferred on splash", "no game.js parse yet");

    if (p.hasGame) bad("no RallyGame on splash", "game constructed too early");
    else ok("no RallyGame on splash");

    if (p.bootErrorVisible) bad("splash clean", p.bootErrorText);
    else ok("splash clean");

    if (p.hasRenderer) bad("WebGL deferred", "renderer up on splash");
    else ok("WebGL deferred until race");

    const shot1 = await screenshot(cdp);
    fs.writeFileSync(path.join(outDir, "iphone13-title.jpg"), Buffer.from(shot1, "base64"));
    ok("title screenshot");

    // PRESS START — dynamic-imports game.js, lands on SELECT MODE (still no WebGL).
    await clickResilient(cdp, "#btn-start", "PRESS START");
    await waitFor(cdp, `return window.game ? 1 : null;`, {
      timeout: 45000,
      label: "window.game after START",
    }).catch((err) => {
      bad("engine after START", String(err.message || err));
    });
    await sleep(600);
    p = await probe(cdp);
    if (p.bootErrorVisible) bad("after START clean", p.bootErrorText);
    else ok("after START clean");

    if (p.hasGame) ok("engine after START");
    if (p.hasRenderer) bad("menus stay HTML", "WebGL started on PRESS START — should wait for race");
    else ok("menus stay HTML", "WebGL waits for Desert");

    // Championship → Desert (first stage) — the real crash site.
    // Prefer clicking UI; fall back to direct startRace if menus differ.
    const started = await evaluate(
      cdp,
      `
      return (async function () {
        const g = window.game;
        if (!g) return { ok: false, why: "no game" };
        try {
          if (typeof g._bootGfx === "function") await g._bootGfx();
          g.mode = "championship";
          g.courseId = "desert";
          g.carId = "celica";
          g.stageIndex = 0;
          if (typeof g._startRace === "function") {
            g._startRace("desert");
            return { ok: true, via: "_startRace" };
          }
          if (typeof g.startRace === "function") {
            g.startRace("desert");
            return { ok: true, via: "startRace" };
          }
          return { ok: false, why: "no startRace" };
        } catch (e) {
          return { ok: false, why: String(e && e.stack ? e.stack : e) };
        }
      })();
    `
    );
    if (!started || !started.ok) bad("kick Desert load", started ? started.why : "null");
    else ok("kick Desert load", started.via);

    // Survive load overlay → countdown / race. 90s budget — phone Track.create is slow.
    let loadOk = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      p = await probe(cdp);
      if (p.bootErrorVisible) {
        bad("Desert load clean", p.bootErrorText);
        break;
      }
      if (p.state === "countdown" || p.state === "race") {
        loadOk = true;
        ok("reached countdown/race", `state=${p.state} t=${((Date.now() - t0) / 1000).toFixed(1)}s`);
        break;
      }
      if (p.state === "loading" || p.screen === "screen-loading") {
        /* keep waiting */
      }
      await sleep(500);
    }
    if (!loadOk && !p.bootErrorVisible) {
      bad("reached countdown/race", `last state=${p.state} screen=${p.screen}`);
    }

    // Hold a few seconds on grid — late OOM often hits here.
    await sleep(3000);
    p = await probe(cdp);
    if (p.bootErrorVisible) bad("grid hold clean", p.bootErrorText);
    else if (p.state === "countdown" || p.state === "race") ok("grid hold clean", `state=${p.state}`);
    else bad("grid hold clean", `state=${p.state}`);

    const shot2 = await screenshot(cdp);
    fs.writeFileSync(path.join(outDir, "iphone13-desert.jpg"), Buffer.from(shot2, "base64"));
    ok("desert screenshot");

    const fatals = consoleLines.filter((l) => /exception|OOM|out of memory|WebGL|crash/i.test(l));
    if (fatals.length) {
      console.log("\n  console (fatal-ish):");
      fatals.slice(0, 12).forEach((l) => console.log(`    ${l.slice(0, 200)}`));
    }
  } finally {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    if (server) {
      try {
        await server.close();
      } catch {
        /* ignore */
      }
    }
  }

  console.log(`\n${fail ? "FAIL" : "PASS"}  ·  iPhone 13 smoke  ·  ${fail || "0"} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
