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

    await waitFor(cdp, `return window.game ? 1 : null;`, {
      timeout: 20000,
      label: "window.game",
    });
    ok("engine constructed", "window.game");

    // Phones defer WebGL until PRESS START — waiting for renderer on the
    // splash times out by design (Android tab-kill guard).
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
        isMobile: body.classList.contains("is-mobile"),
        isPhoneHtml: document.documentElement.classList.contains("is-phone"),
        isTitle: crt && crt.classList.contains("is-title"),
        bootErrorVisible: !!(err && !err.hidden && (err.textContent || "").trim()),
        bootErrorText: err && !err.hidden ? String(err.textContent || "").slice(0, 200) : "",
        bodyBg: bg,
        crtBg,
        ua: navigator.userAgent,
        phonePlay: !!(g && g.touch && g.touch.enabled),
      };
    `);

    if (!pre || typeof pre !== "object") throw new Error("pre-START probe missing");

    if (!/Android/i.test(pre.ua || "")) bad("Android UA armed", `got ${pre.ua}`);
    else ok("Android UA armed", "Pixel 7 Mobile Chrome");

    if (pre.bootErrorVisible) bad("no boot-error on splash", pre.bootErrorText);
    else ok("no boot-error on splash");

    if (!pre.isMobile && !pre.isPhoneHtml) bad("is-mobile / is-phone class", "missing");
    else ok("phone chrome class", pre.isMobile ? "body.is-mobile" : "html.is-phone");

    if (pre.hasRenderer) bad("WebGL deferred until START", "renderer already up on splash");
    else ok("WebGL deferred until START", "splash stays HTML-only");

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

    await waitFor(cdp, `return window.game && window.game.renderer ? 1 : null;`, {
      timeout: 35000,
      label: "game.renderer after START",
    });
    ok("WebGL renderer after START");

    const after = await evaluate(cdp, `
      const g = window.game;
      const active = document.querySelector(".screen.active");
      const err = document.getElementById("boot-error");
      const canvas = document.querySelector("#game-view canvas");
      const caps = window.__rallyRenderCaps || null;
      return {
        screen: active ? active.id : "(none)",
        bootErrorVisible: !!(err && !err.hidden && (err.textContent || "").trim()),
        bootErrorText: err && !err.hidden ? String(err.textContent || "").slice(0, 240) : "",
        hasRenderer: !!(g && g.renderer),
        canvasOk: !!(canvas && canvas.width > 8 && canvas.height > 8),
        canvasW: canvas ? canvas.width : 0,
        canvasH: canvas ? canvas.height : 0,
        dprScale: g && g._perfDprScale,
        capsLowPower: !!(caps && caps.lowPower),
        capsLock30: !!(caps && caps.preferLock30),
        api: caps && caps.api,
        gfxFailed: !!(g && g._gfxFailed),
      };
    `);

    if (after.bootErrorVisible) bad("PRESS START stayed clean", after.bootErrorText);
    else ok("PRESS START stayed clean");

    if (after.gfxFailed) bad("no gfx fatal", "game._gfxFailed");
    else ok("no gfx fatal");

    if (!after.hasRenderer) bad("renderer after START", "lost");
    else ok("renderer after START", after.api || "ok");

    if (!after.canvasOk) bad("canvas painted", `size ${after.canvasW}x${after.canvasH}`);
    else ok("canvas painted", `${after.canvasW}x${after.canvasH}`);

    if (after.capsLock30 || after.capsLowPower || (after.dprScale != null && after.dprScale <= 0.78)) {
      ok(
        "phone GPU budget",
        `dprScale=${after.dprScale} lowPower=${after.capsLowPower} lock30=${after.capsLock30}`
      );
    } else {
      bad(
        "phone GPU budget",
        JSON.stringify({
          dprScale: after.dprScale,
          caps: { lowPower: after.capsLowPower, lock30: after.capsLock30 },
        })
      );
    }

    if (after.screen && after.screen !== "screen-title") ok("menu screen live", after.screen);
    else bad("menu screen live", `still ${after.screen}`);

    const shot2 = await screenshot(cdp);
    const menuPath = path.join(outDir, "android-smoke-after-start.jpg");
    fs.writeFileSync(menuPath, Buffer.from(shot2, "base64"));
    ok("post-START screenshot", path.relative(ROOT, menuPath));
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
