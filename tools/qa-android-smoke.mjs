#!/usr/bin/env node
/**
 * qa-android-smoke.mjs — Android Chrome path smoke (emulated Pixel UA).
 *
 * WHO THIS IS FOR: ship gate after Android white-screen / fill-rate work.
 * WHAT IT DOES: boots the real build in Chrome with a Pixel 7 Android UA,
 *   mobile viewport, and touch. Asserts the phone budget is armed, the
 *   canvas is not a white tab, and title → PRESS START stays interactive.
 *
 * NOTE: this is Chrome on the host with Android emulation — not a physical
 *   handset. A real-phone drive still needs a human. It does exercise the
 *   same UA / DPR / isPhonePlay / WebGL-safe branches Android Chrome hits.
 *
 * RUN:  RALLY_QA_ALLOW_CHROME=1 node tools/qa-android-smoke.mjs
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

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";

const steps = [];
let fail = 0;

function ok(name, detail = "") {
  steps.push({ name, ok: true, detail });
  console.log(`  ok  ${name}${detail ? `  —  ${detail}` : ""}`);
}

function bad(name, detail) {
  fail += 1;
  steps.push({ name, ok: false, detail });
  console.log(`  FAIL  ${name}  —  ${detail}`);
}

async function armAndroid(cdp) {
  await cdp.send("Emulation.setUserAgentOverride", {
    userAgent: ANDROID_UA,
    platform: "Linux armv8l",
    acceptLanguage: "en-US,en",
  });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
  });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true });
}

async function main() {
  console.log(`ANDROID SMOKE (Pixel 7 UA)  ·  ${new Date().toISOString()}\n`);

  const chrome = findChrome();
  if (!chrome) {
    console.log(chromeUnavailableHint());
    process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
  }

  const server = await startServer(ROOT);
  const browser = await launchChrome({
    headless: true,
    width: 412,
    height: 915,
  });
  const { cdp } = browser;

  const outDir = path.join(ROOT, "tools", "qa-out");
  fs.mkdirSync(outDir, { recursive: true });

  try {
    await preparePage(cdp);
    await armAndroid(cdp);
    await goto(cdp, `${server.origin}/index.html`);

    // Phones defer game.js parse until PRESS START (Safari / Adreno jetsam).
    await sleep(800);
    const pre = await evaluate(cdp, `
      const g = window.game;
      const body = document.body;
      const crt = document.getElementById("crt");
      const err = document.getElementById("boot-error");
      const bg = getComputedStyle(document.body).backgroundColor;
      const crtBg = crt ? getComputedStyle(crt).backgroundColor : "";
      return {
        hasGame: !!g,
        hasRenderer: !!(g && g.renderer),
        deferred: !!window.__rallyPhoneDefer,
        isMobile: body.classList.contains("is-mobile"),
        isPhoneHtml: document.documentElement.classList.contains("is-phone"),
        isTitle: crt && crt.classList.contains("is-title"),
        bootErrorVisible: !!(err && !err.hidden && (err.textContent || "").trim()),
        bootErrorText: err && !err.hidden ? String(err.textContent || "").slice(0, 200) : "",
        bodyBg: bg,
        crtBg,
        ua: navigator.userAgent,
      };
    `);

    if (!pre || typeof pre !== "object") throw new Error("pre-START probe missing");

    if (!/Android/i.test(pre.ua || "")) bad("Android UA armed", `got ${pre.ua}`);
    else ok("Android UA armed", "Pixel 7 Mobile Chrome");

    if (pre.bootErrorVisible) bad("no boot-error on splash", pre.bootErrorText);
    else ok("no boot-error on splash");

    if (!pre.isMobile && !pre.isPhoneHtml) bad("is-mobile / is-phone class", "missing");
    else ok("phone chrome class", pre.isMobile ? "body.is-mobile" : "html.is-phone");

    if (!pre.deferred) bad("engine deferred on splash", "__rallyPhoneDefer missing");
    else ok("engine deferred on splash");

    if (pre.hasGame) bad("no RallyGame on splash", "game.js parsed too early");
    else ok("no RallyGame on splash");

    if (pre.hasRenderer) bad("WebGL deferred until race", "renderer already up on splash");
    else ok("WebGL deferred until race", "splash stays HTML-only");

    if (pre.isTitle) ok("title CRT class", "crt.is-title");
    else bad("title CRT class", "missing is-title on splash");

    const whiteish = (c) => {
      const m = String(c || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      const r = +m[1],
        g = +m[2],
        b = +m[3];
      return r > 240 && g > 240 && b > 240;
    };
    if (whiteish(pre.bodyBg) || whiteish(pre.crtBg)) {
      bad("not a white tab", `body=${pre.bodyBg} crt=${pre.crtBg}`);
    } else {
      ok("not a white tab", `body=${pre.bodyBg}`);
    }

    const shot1 = await screenshot(cdp);
    const titlePath = path.join(outDir, "android-smoke-title.jpg");
    fs.writeFileSync(titlePath, Buffer.from(shot1, "base64"));
    ok("title screenshot", path.relative(ROOT, titlePath));

    await clickResilient(cdp, "#btn-start", "PRESS START");
    await waitFor(cdp, `return window.game ? 1 : null;`, {
      timeout: 45000,
      label: "window.game after START",
    });
    ok("engine after START");

    await waitFor(
      cdp,
      `return (function(){
        var a = document.querySelector(".screen.active");
        if (!a) return null;
        if (a.id === "screen-title") return null;
        return a.id;
      })();`,
      { timeout: 20000, label: "left title" }
    );
    ok("left title after START");

    const after = await evaluate(cdp, `
      const g = window.game;
      const active = document.querySelector(".screen.active");
      const err = document.getElementById("boot-error");
      return {
        screen: active ? active.id : "(none)",
        bootErrorVisible: !!(err && !err.hidden && (err.textContent || "").trim()),
        bootErrorText: err && !err.hidden ? String(err.textContent || "").slice(0, 240) : "",
        hasGame: !!g,
        hasRenderer: !!(g && g.renderer),
        gfxFailed: !!(g && g._gfxFailed),
        phonePlay: !!(g && g.touch && g.touch.enabled),
      };
    `);

    if (after.bootErrorVisible) bad("PRESS START stayed clean", after.bootErrorText);
    else ok("PRESS START stayed clean");

    if (after.hasRenderer) bad("menus stay HTML", "WebGL should wait for race start");
    else ok("menus stay HTML", "WebGL waits for Desert");

    // Kick Desert so WebGL + Track.create actually run under Android budget.
    const started = await evaluate(
      cdp,
      `
      return (async function () {
        const g = window.game;
        if (!g || typeof g._startRace !== "function") return { ok: false, why: "no _startRace" };
        try {
          g.mode = "championship";
          g.courseId = "desert";
          g.carId = "celica";
          g.stageIndex = 0;
          g._startRace("desert");
          return { ok: true };
        } catch (e) {
          return { ok: false, why: String(e && e.stack ? e.stack : e) };
        }
      })();
    `
    );
    if (!started || !started.ok) bad("kick Desert", started ? started.why : "null");
    else ok("kick Desert");

    let raceOk = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      const live = await evaluate(
        cdp,
        `
        const g = window.game;
        const err = document.getElementById("boot-error");
        return {
          state: g ? g.state : null,
          hasRenderer: !!(g && g.renderer),
          bootError: !!(err && !err.hidden && (err.textContent || "").trim()),
          bootText: err && !err.hidden ? String(err.textContent || "").slice(0, 200) : "",
          canvasW: (document.querySelector("#game-view canvas") || {}).width || 0,
        };
      `
      );
      if (live.bootError) {
        bad("Desert load clean", live.bootText);
        break;
      }
      if (live.state === "countdown" || live.state === "race") {
        raceOk = true;
        if (live.hasRenderer) ok("WebGL for race", `${live.canvasW}px wide · ${live.state}`);
        else bad("WebGL for race", "no renderer at countdown");
        break;
      }
      await sleep(500);
    }
    if (!raceOk) bad("reached countdown/race", "timeout");

    const race = await evaluate(
      cdp,
      `
      const g = window.game;
      const canvas = document.querySelector("#game-view canvas");
      const caps = window.__rallyRenderCaps || null;
      return {
        gfxFailed: !!(g && g._gfxFailed),
        hasRenderer: !!(g && g.renderer),
        canvasOk: !!(canvas && canvas.width > 8 && canvas.height > 8),
        canvasW: canvas ? canvas.width : 0,
        canvasH: canvas ? canvas.height : 0,
        dprScale: g && g._perfDprScale,
        capsLowPower: !!(caps && caps.lowPower),
        capsLock30: !!(caps && caps.preferLock30),
        api: caps && caps.api,
        state: g ? g.state : null,
      };
    `
    );

    if (race.gfxFailed) bad("no gfx fatal", "game._gfxFailed");
    else ok("no gfx fatal");

    if (!race.hasRenderer) bad("renderer for race", "lost");
    else ok("renderer for race", race.api || "ok");

    if (!race.canvasOk) bad("canvas painted", `size ${race.canvasW}x${race.canvasH}`);
    else ok("canvas painted", `${race.canvasW}x${race.canvasH}`);

    if (race.capsLock30 || race.capsLowPower || (race.dprScale != null && race.dprScale <= 0.78)) {
      ok(
        "phone GPU budget",
        `dprScale=${race.dprScale} lowPower=${race.capsLowPower} lock30=${race.capsLock30}`
      );
    } else {
      bad(
        "phone GPU budget",
        JSON.stringify({
          dprScale: race.dprScale,
          caps: { lowPower: race.capsLowPower, lock30: race.capsLock30 },
        })
      );
    }

    const shot2 = await screenshot(cdp);
    const menuPath = path.join(outDir, "android-smoke-desert.jpg");
    fs.writeFileSync(menuPath, Buffer.from(shot2, "base64"));
    ok("desert screenshot", path.relative(ROOT, menuPath));
  } catch (err) {
    bad("smoke aborted", String(err && err.stack ? err.stack : err));
  } finally {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
    try {
      await server.close();
    } catch {
      /* ignore */
    }
  }

  console.log(
    `\n${fail ? "FAIL" : "PASS"}  ·  Android UA smoke ${fail ? `(${fail} failed)` : "armed"}`
  );
  console.log(
    "NOTE: host Chrome + Pixel UA, not a physical handset. Human Android Chrome drive still required for final ship."
  );
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
