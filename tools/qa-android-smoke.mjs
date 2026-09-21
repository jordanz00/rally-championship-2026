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

    await waitFor(cdp, `return window.game && window.game.renderer ? 1 : null;`, {
      timeout: 25000,
      label: "game.renderer",
    });
    ok("WebGL renderer ready");

    const boot = await evaluate(cdp, `
      const g = window.game;
      const body = document.body;
      const crt = document.getElementById("crt");
      const err = document.getElementById("boot-error");
      const canvas = document.querySelector("#game-view canvas");
      const bg = getComputedStyle(document.body).backgroundColor;
      const crtBg = crt ? getComputedStyle(crt).backgroundColor : "";
      const caps = window.__rallyRenderCaps || null;
      return {
        hasGame: !!g,
        hasRenderer: !!(g && g.renderer),
        isMobile: body.classList.contains("is-mobile"),
        isPhoneHtml: document.documentElement.classList.contains("is-phone"),
        isTitle: crt && crt.classList.contains("is-title"),
        bootErrorVisible: !!(err && !err.hidden && (err.textContent || "").trim()),
        bootErrorText: err && !err.hidden ? String(err.textContent || "").slice(0, 200) : "",
        canvasOk: !!(canvas && canvas.width > 8 && canvas.height > 8),
        canvasW: canvas ? canvas.width : 0,
        canvasH: canvas ? canvas.height : 0,
        bodyBg: bg,
        crtBg,
        ua: navigator.userAgent,
        phonePlay: !!(g && g.touch && g.touch.enabled),
        dprScale: g && g._perfDprScale,
        capsLowPower: !!(caps && caps.lowPower),
        capsLock30: !!(caps && caps.preferLock30),
        api: caps && caps.api,
      };
    `);

    if (!boot || typeof boot !== "object") throw new Error("boot probe missing");

    if (!/Android/i.test(boot.ua || "")) bad("Android UA armed", `got ${boot.ua}`);
    else ok("Android UA armed", "Pixel 7 Mobile Chrome");

    if (boot.bootErrorVisible) bad("no boot-error panel", boot.bootErrorText);
    else ok("no boot-error panel");

    if (!boot.isMobile && !boot.isPhoneHtml) bad("is-mobile / is-phone class", "missing");
    else ok("phone chrome class", boot.isMobile ? "body.is-mobile" : "html.is-phone");

    if (!boot.hasRenderer) bad("WebGL renderer", "game.renderer missing");
    else ok("WebGL renderer", boot.api || "ok");

    if (!boot.canvasOk) bad("canvas painted", `size ${boot.canvasW}x${boot.canvasH}`);
    else ok("canvas painted", `${boot.canvasW}x${boot.canvasH}`);

    const whiteish = (c) => {
      const m = String(c || "").match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      const r = +m[1],
        g = +m[2],
        b = +m[3];
      return r > 240 && g > 240 && b > 240;
    };
    if (whiteish(boot.bodyBg) || whiteish(boot.crtBg)) {
      bad("not a white tab", `body=${boot.bodyBg} crt=${boot.crtBg}`);
    } else {
      ok("not a white tab", `body=${boot.bodyBg}`);
    }

    if (boot.isTitle) ok("title CRT class", "crt.is-title");
    else bad("title CRT class", "missing is-title on splash");

    if (boot.phonePlay || boot.capsLock30 || boot.capsLowPower || (boot.dprScale != null && boot.dprScale <= 0.78)) {
      ok(
        "phone GPU budget",
        `touch=${!!boot.phonePlay} dprScale=${boot.dprScale} lowPower=${boot.capsLowPower} lock30=${boot.capsLock30}`
      );
    } else {
      bad(
        "phone GPU budget",
        JSON.stringify({
          phonePlay: boot.phonePlay,
          dprScale: boot.dprScale,
          caps: { lowPower: boot.capsLowPower, lock30: boot.capsLock30 },
        })
      );
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
      { timeout: 15000, label: "left title" }
    );

    const after = await evaluate(cdp, `
      const active = document.querySelector(".screen.active");
      const err = document.getElementById("boot-error");
      const menu = document.getElementById("screen-menu");
      return {
        screen: active ? active.id : "(none)",
        menuActive: !!(menu && menu.classList.contains("active")),
        bootErrorVisible: !!(err && !err.hidden && (err.textContent || "").trim()),
        hasRenderer: !!(window.game && window.game.renderer),
      };
    `);

    if (after.bootErrorVisible) bad("PRESS START stayed clean", "boot-error appeared");
    else ok("PRESS START stayed clean");

    if (!after.hasRenderer) bad("renderer after START", "lost");
    else ok("renderer after START");

    if (after.screen && after.screen !== "screen-title") ok("left title", after.screen);
    else bad("left title", `still ${after.screen}`);

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
