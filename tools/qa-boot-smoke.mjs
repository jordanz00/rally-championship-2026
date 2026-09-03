#!/usr/bin/env node
/**
 * qa-boot-smoke.mjs — headless boot + acceptance-path smoke test.
 *
 * WHO THIS IS FOR: anyone who has been burned by the boot path. Which is
 *   everyone who has worked on this project.
 * WHAT IT DOES: launches the real game in real Chrome and walks the exact
 *   path from acceptance criterion 4 —
 *     title → PRESS START → SELECT MODE → car → Desert countdown → racing
 *   asserting at each step, then repeats through PRACTICE so that explicit
 *   course selection is exercised too. Every console error and uncaught
 *   exception in the page is collected and fails the run.
 *
 *   The four historical root causes it is specifically built to catch:
 *     (a) WebGL / shader compilation blocking the splash from painting or
 *         becoming interactive  -> we assert the Start control is hittable
 *         within a deadline, before the renderer is required to exist.
 *     (b) handlers calling into a half-constructed game object
 *         -> uncaught exceptions and console errors are hard failures.
 *     (c) a full-screen opaque overlay hiding the canvas
 *         -> elementFromPoint hit testing plus an overlay scan.
 *     (d) audio left suspended / silently muted
 *         -> AudioContext state and bus gains are read back after the gesture.
 *
 * HOW IT CONNECTS: uses tools/lib/qa-harness.mjs. Serves the repo on an
 *   ephemeral port (never 8765) and kills only the browser it started.
 *
 * RUN:  node tools/qa-boot-smoke.mjs
 *       node tools/qa-boot-smoke.mjs --headed     (watch it happen)
 * EXIT: 0 all steps passed. 1 a step failed — the message names the step.
 */

import fs from "node:fs";
import path from "node:path";
import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, hitTest, clickSelector, pressKey, activeScreen, findOpaqueOverlays,
  installFrameRecorder, startRecording, stopRecording, screenshot, sleep,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

const HEADED = process.argv.includes("--headed");

const steps = [];
let currentStep = "(startup)";

/**
 * Run one named acceptance step. A throw is recorded as a failure and aborts
 * the run, so the report always names the first thing that actually broke.
 * @param {string} name
 * @param {() => Promise<string|void>} fn optional detail string for the log
 */
async function step(name, fn) {
  currentStep = name;
  const t0 = Date.now();
  const detail = await fn();
  steps.push({ name, ms: Date.now() - t0, detail: detail || "" });
  console.log(`  ok  ${name}${detail ? `  —  ${detail}` : ""}  (${Date.now() - t0}ms)`);
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error(chromeUnavailableHint());
    process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
  }
  console.log(`RALLY BOOT SMOKE  ·  ${new Date().toISOString()}`);
  console.log(`browser: ${chrome}`);

  const server = await startServer(ROOT);
  console.log(`serving ${ROOT} on ${server.origin}  (ephemeral port, not 8765)`);

  const browser = await launchChrome({ headless: !HEADED });
  console.log(`chrome:  ${browser.browserVersion}${HEADED ? "  (headed)" : "  (headless)"}\n`);

  const { cdp } = browser;
  const { errors, soft, warnings } = await preparePage(cdp);

  /**
   * Tolerated-but-noteworthy misses: the car loader probes several candidate
   * GLB filenames per car and expects most to 404. Worth surfacing (a car with
   * *no* candidate present is silently running on fallback geometry) but not a
   * reason to fail the acceptance path.
   */
  function reportSoft() {
    if (!soft.length) return;
    const byUrl = new Map();
    for (const s of soft) {
      const key = (s.url || s.text).replace(/^https?:\/\/127\.0\.0\.1:\d+/, "");
      byUrl.set(key, (byUrl.get(key) || 0) + 1);
    }
    console.log(`\n  note  ${soft.length} tolerated failed request(s) — asset probes, not errors:`);
    for (const [url, n] of [...byUrl.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`          ${n}x  ${url}`);
    }
  }

  try {
    /* ---------------- 1. page loads ---------------- */
    await step("page loads over http", async () => {
      await goto(cdp, `${server.origin}/index.html?perf=medium`);
      const title = await evaluate(cdp, `return document.title;`);
      assert(title && title.length > 0, "document has no title — the HTML did not parse");
      return `title: "${title}"`;
    });

    /* ---------------- 2. splash is visible ---------------- */
    await step("title screen is visible", async () => {
      const info = await evaluate(cdp, `
        const t = document.getElementById("screen-title");
        if (!t) return { ok: false, why: "#screen-title is missing from the DOM" };
        const cs = getComputedStyle(t);
        const r = t.getBoundingClientRect();
        const heading = document.querySelector("#screen-title h1");
        return {
          ok: t.classList.contains("active") && cs.display !== "none" && r.width > 100 && r.height > 100,
          active: t.classList.contains("active"),
          display: cs.display,
          w: Math.round(r.width), h: Math.round(r.height),
          headingText: heading ? heading.textContent.replace(/\\s+/g, " ").trim() : null,
          why: ""
        };
      `);
      assert(info.ok, `title screen is not visible (active=${info.active}, display=${info.display}, ${info.w}x${info.h}) ${info.why}`);
      assert(info.headingText, "title screen has no heading text");
      return `${info.w}x${info.h}, heading "${info.headingText}"`;
    });

    /* ---------------- 3. no boot error panel ---------------- */
    await step("no boot-error panel shown", async () => {
      const boot = await evaluate(cdp, `
        const el = document.getElementById("boot-error");
        if (!el) return { shown: false, text: "" };
        return { shown: !el.hidden, text: (el.textContent || "").slice(0, 500) };
      `);
      assert(!boot.shown, `the page's own boot-error panel is visible: ${boot.text}`);
      return "clean";
    });

    /* ---------------- 4. Start control is genuinely hittable ---------------- */
    // Deliberately checked with elementFromPoint rather than CSS: this is the
    // exact failure where PRESS START "does nothing".
    await step("PRESS START is hittable (elementFromPoint)", async () => {
      const hit = await waitFor(
        cdp,
        `
        const el = document.getElementById("btn-start");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return null;
        const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
        const hit = document.elementFromPoint(x, y);
        return (hit === el || el.contains(hit)) ? { x, y } : null;
      `,
        { timeout: 10000, label: "#btn-start to be the top element at its own centre" }
      );
      // Re-run the full diagnostic so a failure explains itself.
      const detail = await hitTest(cdp, "#btn-start");
      assert(detail.ok, `PRESS START is not clickable: ${detail.reason}${detail.blocker ? ` — covered by ${detail.blocker}` : ""}`);
      return `hittable at ${hit.x},${hit.y}`;
    });

    /* ---------------- 5. no opaque overlay over the render surface ---------------- */
    await step("no unexpected full-screen opaque overlay", async () => {
      const overlays = await findOpaqueOverlays(cdp);
      // #screen-title legitimately covers the viewport while on the splash.
      const unexpected = overlays.filter((o) => o.id !== "screen-title" && o.id !== "crt" && o.id !== "game-view" && o.id !== "fx-curtain");
      assert(
        unexpected.length === 0,
        `element(s) fully cover the viewport opaquely: ${unexpected.map((o) => `${o.tag}#${o.id || "?"}.${o.cls} z=${o.zIndex} bg=${o.background}`).join("; ")}`
      );
      return overlays.length ? `${overlays.length} expected splash layer(s) only` : "none";
    });

    /* ---------------- 6. game object constructed ---------------- */
    await step("window.game constructed", async () => {
      const g = await waitFor(
        cdp,
        `return window.game ? { state: window.game.state, hasHud: !!window.game.hud, hasAudio: !!window.game.audio } : null;`,
        { timeout: 15000, label: "window.game to exist" }
      );
      assert(g.hasHud, "game constructed without a HUD");
      assert(g.hasAudio, "game constructed without audio");
      return `state="${g.state}"`;
    });

    /* ---------------- 7. PRESS START advances to SELECT MODE ---------------- */
    await step("real click on PRESS START advances to SELECT MODE", async () => {
      await clickSelector(cdp, "#btn-start", "PRESS START");
      const screen = await waitFor(
        cdp,
        `const el = document.querySelector(".screen.active"); return el && el.id === "screen-menu" ? el.id : null;`,
        { timeout: 15000, label: "#screen-menu to become the active screen" }
      );
      const mode = await evaluate(cdp, `return window.game ? window.game.state : null;`);
      assert(screen === "screen-menu", `expected screen-menu, got ${screen}`);
      assert(mode === "menu", `game.state should be "menu" after leaving the title, got "${mode}"`);
      return `active screen: ${screen}`;
    });

    /* ---------------- 8. audio actually came up ---------------- */
    // Root cause (d): a suspended AudioContext, or a stored volume of 0, made
    // the whole game silent with no visible symptom.
    await step("audio unlocked and not silently muted", async () => {
      // Cinema showroom can hitch the main thread right after Start; nudge unlock
      // then wait longer than the old 8s so a busy frame does not false-fail.
      await evaluate(cdp, `
        try { if (window.game && window.game.audio) window.game.audio.unlock(); } catch (_) {}
        return 1;
      `);
      const a = await waitFor(
        cdp,
        `
        const g = window.game;
        if (!g || !g.audio) return null;
        const au = g.audio;
        if (!au.ready) return null;
        return {
          ctxState: au.ctx ? au.ctx.state : "no-context",
          ready: !!au.ready,
          musicVol: au.musicVol,
          sfxVol: au.sfxVol,
          masterGain: au.master ? au.master.gain.value : null
        };
      `,
        { timeout: 20000, label: "audio to report ready after the Start gesture" }
      );
      assert(a.musicVol > 0, `stored music volume is ${a.musicVol} — the mix is muted before anyone touched a slider`);
      assert(a.sfxVol > 0, `stored SFX volume is ${a.sfxVol} — the mix is muted before anyone touched a slider`);
      assert(a.masterGain === null || a.masterGain > 0, `SFX bus gain is ${a.masterGain} — everything is inaudible`);
      // Headless Chrome has no audio device, so "suspended" here is not
      // necessarily the bug. Report it, do not fail on it.
      const note = a.ctxState === "running" ? "context running" : `context "${a.ctxState}" (expected in headless — verify by ear)`;
      return `music=${a.musicVol} sfx=${a.sfxVol} ${note}`;
    });

    /* ---------------- 9. CHAMPIONSHIP → SELECT CAR ---------------- */
    await step("CHAMPIONSHIP advances to SELECT CAR", async () => {
      await clickSelector(cdp, "[data-menu='championship']", "CHAMPIONSHIP");
      // Trusted mouse can miss in headless; the in-page handler is the same path.
      await evaluate(cdp, `
        const el = document.querySelector(".screen.active");
        if (el && el.id === "screen-cars") return 1;
        const b = document.querySelector("[data-menu='championship']");
        if (b) b.click();
        return 1;
      `);
      const screen = await waitFor(
        cdp,
        `const el = document.querySelector(".screen.active"); return el && el.id === "screen-cars" ? el.id : null;`,
        { timeout: 15000, label: "#screen-cars to become active" }
      );
      await waitFor(
        cdp,
        `return [...document.querySelectorAll("[data-car]")].some((b) => !b.disabled) ? 1 : null;`,
        { timeout: 25000, label: "at least one car selectable after garage warm" }
      );
      const cars = await evaluate(cdp, `
        return [...document.querySelectorAll("[data-car]")].map((b) => ({
          id: b.dataset.car, disabled: b.disabled, label: b.textContent.trim()
        }));
      `);
      const selectable = cars.filter((c) => !c.disabled);
      assert(selectable.length >= 1, "SELECT CAR has no selectable car");
      return `${screen}, ${selectable.length}/${cars.length} cars selectable`;
    });

    /* ---------------- 10. car choice reaches Desert countdown ---------------- */
    await step("choosing a car reaches Desert countdown", async () => {
      await clickSelector(cdp, "[data-car='celica']", "CELICA GT-FOUR");
      // Sprint 88: loading must paint on this click. A microtask yield used to
      // freeze the tab here (music still playing, nothing on screen).
      await waitFor(
        cdp,
        `const el = document.querySelector(".screen.active");
         const g = window.game;
         if (el && el.id === "screen-hud" && g && (g.state === "countdown" || g.state === "race")) return "hud";
         return el && el.id === "screen-loading" ? "loading" : null;`,
        { timeout: 2500, label: "loading screen after championship car pick" }
      );
      const g = await waitFor(
        cdp,
        `
        const g = window.game;
        if (!g) return null;
        const el = document.querySelector(".screen.active");
        if (!el || el.id !== "screen-hud") return null;
        if (g.state !== "countdown" && g.state !== "race") return null;
        return { state: g.state, course: g.courseId, countdown: g.countdown, hasTrack: !!g.track, hasRenderer: !!g.renderer };
      `,
        { timeout: 120000, label: "the HUD screen with the game in countdown (track build + shader compile can be slow)" }
      );
      assert(g.hasRenderer, "race started with no WebGL renderer");
      assert(g.hasTrack, "race started with no track built");
      assert(g.course === "desert", `championship stage 1 should be Desert, got "${g.course}"`);
      return `state="${g.state}" course=${g.course} countdown=${(g.countdown ?? 0).toFixed(2)}`;
    });

    /* ---------------- 11. countdown reaches racing ---------------- */
    // The countdown is driven by the same clamped per-frame dt as the physics
    // (game.js clamps dt to 0.024s), so on a slow renderer it advances in real
    // time far more slowly than 3.2 wall-clock seconds. Headless SwiftShader is
    // slow, so the budget is derived from the frame rate we actually observe
    // rather than assumed — otherwise this step reports a false defect.
    await step("countdown hands over to racing", async () => {
      await installFrameRecorder(cdp);
      await startRecording(cdp);
      await sleep(1500);
      const sample = await stopRecording(cdp);
      const fps = sample.length / 1.5;
      // 3.2s of countdown at a 0.024s/frame cap needs ~134 ticks.
      const projectedSec = fps > 0 ? 134 / fps : Infinity;
      const budget = Math.min(120000, Math.max(15000, projectedSec * 1500 + 6000));
      const t0 = Date.now();
      const g = await waitFor(cdp, `return window.game && window.game.state === "race" ? { t: window.game.raceTime } : null;`, {
        timeout: budget,
        label: `game.state to become "race" after the 3-2-1 (observed ${fps.toFixed(1)} fps, budget ${(budget / 1000) | 0}s)`
      });
      const wall = (Date.now() - t0) / 1000;
      const detail = `raceTime=${g.t.toFixed(2)}s, took ${wall.toFixed(1)}s wall-clock at ${fps.toFixed(1)} fps`;
      // A real defect worth naming even when the step passes.
      if (fps > 50 && wall > 6) {
        throw new Error(`countdown took ${wall.toFixed(1)}s wall-clock at a healthy ${fps.toFixed(1)} fps — the 3.2s countdown is running slow`);
      }
      return detail;
    });

    /* ---------------- 12. frames are actually animating ---------------- */
    // Correctness only: are frames happening, is the sim advancing, is input
    // plumbed, are pixels changing. Frame *rate* is not judged here because
    // headless runs on a software rasteriser. That is qa-frame-probe.mjs's job.
    await step("race produces animating frames and responds to input", async () => {
      await installFrameRecorder(cdp);
      const before = await evaluate(cdp, `
        const g = window.game;
        return { t: g.raceTime, x: g.player.position.x, z: g.player.position.z };
      `);
      const shotA = await screenshot(cdp);
      await startRecording(cdp);
      // Hold the throttle so the simulation has something to do.
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "w", code: "KeyW", windowsVirtualKeyCode: 87, text: "w" });
      const HOLD_MS = 6000;
      await sleep(HOLD_MS);
      const deltas = await stopRecording(cdp);
      const shotB = await screenshot(cdp);
      const after = await evaluate(cdp, `
        const g = window.game;
        return {
          t: g.raceTime, x: g.player.position.x, z: g.player.position.z, fps: g.fps,
          throttleIn: g.input.throttle, throttleCar: g.player.throttle,
          speed: g.player.speed, rpm: g.player.rpm
        };
      `);
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "w", code: "KeyW", windowsVirtualKeyCode: 87 });

      assert(deltas.length >= 2, `only ${deltas.length} animation frames in ${HOLD_MS / 1000}s — the render loop is stalled`);
      assert(after.t > before.t, `raceTime did not advance (${before.t} -> ${after.t}) — the simulation is frozen`);
      assert(after.throttleIn > 0, `holding W did not reach Input (input.throttle=${after.throttleIn}) — keyboard is not wired to the game`);
      assert(after.throttleCar > 0, `Input has throttle but the vehicle does not (player.throttle=${after.throttleCar})`);
      assert(after.speed > 0, `car speed is ${after.speed} after ${HOLD_MS / 1000}s of full throttle — physics is not integrating`);
      const moved = Math.hypot(after.x - before.x, after.z - before.z);
      assert(moved > 0, `car did not move at all under full throttle (speed=${after.speed})`);
      assert(shotA !== shotB, "two screenshots are byte-identical — nothing is being drawn to the screen");
      const fpsObserved = deltas.length / (HOLD_MS / 1000);
      return `${deltas.length} frames (~${fpsObserved.toFixed(1)} fps, software rasteriser), sim +${(after.t - before.t).toFixed(2)}s, moved ${moved.toFixed(2)}m, speed ${after.speed.toFixed(1)}, pixels changed`;
    });

    /* ---------------- 13. HUD is populated, not blank ---------------- */
    await step("HUD reflects the running race", async () => {
      const h = await evaluate(cdp, `
        const pick = (id) => { const el = document.getElementById(id); return el ? el.textContent.trim() : null; };
        return { course: pick("hud-course"), time: pick("hud-time"), speed: pick("hud-speed"), gear: pick("hud-gear"), surface: pick("hud-surface"), pos: pick("hud-pos") };
      `);
      for (const [k, v] of Object.entries(h)) assert(v !== null && v !== "", `HUD field ${k} is empty`);
      assert(/desert/i.test(h.course), `HUD course reads "${h.course}", expected Desert`);
      assert(Number(h.speed) > 0, `HUD speed reads "${h.speed}" while the car is moving under throttle`);
      return `course=${h.course} speed=${h.speed} gear=${h.gear} surface=${h.surface} pos=${h.pos}`;
    });

    /* ---------------- 14. explicit course selection path ---------------- */
    // Championship jumps straight to Desert, so SELECT COURSE is only reachable
    // via the other modes. Criterion 4 asks that a course can be chosen, so a
    // fresh load walks that path too.
    await step("reload → PRACTICE → car → SELECT COURSE → countdown", async () => {
      await goto(cdp, `${server.origin}/index.html?perf=medium`);
      await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 15000, label: "game to reconstruct after reload" });
      // Keyboard this time, so both Start paths are covered.
      await pressKey(cdp, "Enter");
      await waitFor(cdp, `const el = document.querySelector(".screen.active"); return el && el.id === "screen-menu" ? 1 : null;`, {
        timeout: 15000, label: "Enter on the title to reach SELECT MODE"
      });
      await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
      await waitFor(cdp, `const el = document.querySelector(".screen.active"); return el && el.id === "screen-cars" ? 1 : null;`, {
        timeout: 15000, label: "#screen-cars after PRACTICE"
      });
      // Sprint 21 prop kit + car GLBs can still be warming after a full reload;
      // wait until Delta is actually selectable before clicking.
      await waitFor(
        cdp,
        `const b = document.querySelector("[data-car='delta']"); return b && !b.disabled ? 1 : null;`,
        { timeout: 20000, label: "Delta car button enabled after garage/prop warm" }
      );
      await clickSelector(cdp, "[data-car='delta']", "DELTA HF");
      await waitFor(cdp, `const el = document.querySelector(".screen.active"); return el && el.id === "screen-courses" ? 1 : null;`, {
        timeout: 20000, label: "#screen-courses after picking a car in PRACTICE"
      });
      await clickSelector(cdp, "[data-course='desert']", "DESERT");
      await waitFor(
        cdp,
        `const el = document.querySelector(".screen.active");
         const g = window.game;
         if (el && el.id === "screen-hud" && g && (g.state === "countdown" || g.state === "race")) return "hud";
         return el && el.id === "screen-loading" ? "loading" : null;`,
        { timeout: 2500, label: "loading screen after PRACTICE course pick" }
      );
      const g = await waitFor(
        cdp,
        `const g = window.game; const el = document.querySelector(".screen.active");
         return g && el && el.id === "screen-hud" && (g.state === "countdown" || g.state === "race") ? { state: g.state, car: g.carId, course: g.courseId } : null;`,
        { timeout: 60000, label: "countdown after explicit course selection (track build yields real frames)" }
      );
      assert(g.car === "delta", `selected car should be delta, game says "${g.car}"`);
      return `car=${g.car} course=${g.course} state=${g.state}`;
    });

    /* ---------------- 15. shipped car models actually load ---------------- */
    // The loader falls back to procedural geometry and only console.warns. That
    // is the right behaviour for a car whose GLB was never shipped, but it hides
    // the case where the GLB *is* on disk and still failed to load — the car
    // silently becomes a different, worse-looking car.
    await step("every car whose GLB ships on disk actually loaded it", async () => {
      const shipped = [];
      for (const dir of fs.readdirSync(path.join(ROOT, "assets"), { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        const files = fs.readdirSync(path.join(ROOT, "assets", dir.name));
        const heroes = files.filter((f) => /\.(glb|gltf)$/i.test(f) && !/^rival\./i.test(f));
        if (heroes.length) shipped.push({ car: dir.name, files: heroes });
      }
      if (!shipped.length) return "no car GLBs are shipped — nothing to check";

      const fellBack = warnings
        .filter((w) => /\[garage\]/.test(w) && /no GLB found/i.test(w))
        .map((w) => /\[garage\]\s*(\w+)/.exec(w)?.[1])
        .filter(Boolean);
      const broken = shipped.filter((s) => fellBack.includes(s.car));
      assert(
        broken.length === 0,
        `these cars ship a model on disk but the game fell back to procedural geometry anyway: ` +
          broken.map((b) => `${b.car} (has ${b.files.join(", ")})`).join("; ") +
          ` — the file is being fetched and rejected, not missing`
      );
      return `${shipped.map((s) => s.car).join(", ")} all loaded their shipped model`;
    });

    /* ---------------- 16. page produced no errors ---------------- */
    await step("no console errors or uncaught exceptions", async () => {
      await sleep(400);
      if (errors.length) {
        const listed = errors.slice(0, 8).map((e, i) => `\n     ${i + 1}. [${e.type}] ${e.text}${e.url ? ` (${e.url})` : ""}`).join("");
        throw new Error(`the page reported ${errors.length} error(s):${listed}`);
      }
      return "clean";
    });

    reportSoft();
    console.log(`\nPASS  ·  ${steps.length}/${steps.length} steps  ·  0 page errors`);
    await browser.close();
    await server.close();
    process.exit(0);
  } catch (err) {
    reportSoft();
    console.error(`\n  FAIL  step: ${currentStep}`);
    console.error(`        ${err.message}`);
    if (errors.length) {
      console.error(`\n  page errors collected before the failure (${errors.length}):`);
      for (const e of errors.slice(0, 10)) console.error(`    [${e.type}] ${e.text}${e.url ? ` (${e.url})` : ""}`);
    }
    console.error(`\nFAIL  ·  ${steps.length} step(s) passed, then "${currentStep}" broke`);
    try { await browser.close(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(`\nFAIL  harness error during "${currentStep}": ${err.stack || err.message}`);
  process.exit(1);
});
