#!/usr/bin/env node
/**
 * qa-steering.mjs — the player's controls must actually drive the car.
 *
 * WHO THIS IS FOR: anyone changing input, the physics step, or the QA drive
 *   override.
 *
 * WHY IT EXISTS: a build shipped in which the player had no controls at all —
 *   first reported as "cannot turn", then as "no steering or acceleration".
 *   A killed QA run left `input._qaHold = {throttle: 1, steer: 0}` latched on a
 *   live page, and because the hold was applied last in `poll()` it overwrote
 *   every real key: dead steering *and* stuck full throttle. Nothing in the
 *   suite pressed a key and checked the car responded, so the most basic
 *   possible regression passed QA in silence. This closes that hole for the
 *   whole control set, not just steering.
 *
 * WHAT IT PROVES, using real dispatched keyboard events rather than `_qaDrive`:
 *   1. Throttle accelerates the car from a standstill.
 *   2. Brake slows a rolling car.
 *   3. Handbrake bites (speed loss and/or rear slide).
 *   4. Left and right yaw the chassis the correct way.
 *   5. A latched QA hold cannot steal any of it: a real key retires the
 *      override, after which the player can apply throttle AND lift off again.
 *
 * HOW IT MEASURES: physics is stepped explicitly through the game's own
 *   `input.poll()` + `_fixed()`. Headless Chrome throttles requestAnimationFrame
 *   to a few frames per second, so a wall-clock input test simulates almost
 *   nothing and makes a healthy car look dead. Only the latch-release half uses
 *   real frames, because the release lives in the rAF loop in game.js.
 *
 * RUN:  node tools/qa-steering.mjs
 *       node tools/qa-steering.mjs --headed
 * EXIT: 0 only when every control responds and beats a stuck QA override.
 *
 * POWER BI MAPPING: none
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector,
} from "./lib/qa-harness.mjs";

const HEADED = process.argv.includes("--headed");
/** Minimum yaw change (rad) that counts as "the car turned" — ~5.7 deg. */
const YAW_MIN = 0.1;
/** Minimum m/s gained in 2 s of full throttle from rest. */
const ACCEL_MIN = 5;
/** Minimum m/s shed in 1 s of full brake from 30 m/s. */
const BRAKE_MIN = 4;
/** Minimum m/s shed in 1 s of handbrake from 30 m/s. */
const HANDBRAKE_MIN = 2;
/** Minimum m/s shed in 1 s of coasting, proving the player can lift off. */
const LIFT_MIN = 0.5;

/** key -> the fields Chrome needs to synthesise a real event. */
const KEYS = {
  left: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  right: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  gas: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  brake: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  hand: { key: " ", code: "Space", vk: 32 },
};

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Send a real key event through the browser, exactly as a player would.
 * @param {object} cdp
 * @param {"keyDown"|"keyUp"} type
 * @param {string} name a key of KEYS
 */
async function key(cdp, type, name) {
  const k = KEYS[name];
  await cdp.send("Input.dispatchKeyEvent", {
    type,
    key: k.key,
    code: k.code,
    windowsVirtualKeyCode: k.vk,
    nativeVirtualKeyCode: k.vk,
  });
}

/**
 * Put the car on a clean straight at a chosen speed.
 * @param {object} cdp
 * @param {number} speed m/s
 * @param {number} gear
 */
async function place(cdp, speed, gear) {
  await evaluate(cdp, `
    const g = window.game, p = g.player;
    g.state = "race";
    g.countdown = 0;
    g.timeLeft = 9999;
    p.spawn(g.track, 60, 0);
    p.velocity.set(Math.sin(p.yaw) * ${speed}, 0, Math.cos(p.yaw) * ${speed});
    p.speed = ${speed};
    p.autoTrans = true;
    p.gear = ${gear};
    p.rpm = ${speed > 1 ? 4200 : 1200};
    p._glitchHits = 0;
    p._glitchLog = [];
    return 1;
  `);
}

/**
 * Hold keys, step physics through the real input path, report what the car did.
 * @param {object} cdp
 * @param {string[]} names keys of KEYS to hold
 * @param {number} steps physics steps at 1/60
 */
async function hold(cdp, names, steps) {
  for (const n of names) await key(cdp, "keyDown", n);
  const out = await evaluate(cdp, `
    const g = window.game, p = g.player;
    const yaw0 = p.yaw, spd0 = p.speed;
    let rearSlide = false;
    for (let i = 0; i < ${steps}; i++) {
      g.input.poll();
      g._fixed(1 / 60);
      if (p._rearSlide) rearSlide = true;
    }
    let d = p.yaw - yaw0;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return {
      dYaw: Math.round(d * 1000) / 1000,
      speed0: Math.round(spd0 * 10) / 10,
      speed1: Math.round(p.speed * 10) / 10,
      dSpeed: Math.round((p.speed - spd0) * 10) / 10,
      inThrottle: Math.round((g.input.throttle || 0) * 100) / 100,
      inBrake: Math.round((g.input.brake || 0) * 100) / 100,
      inSteer: Math.round((g.input.steer || 0) * 100) / 100,
      inHand: Math.round((g.input.handbrake || 0) * 100) / 100,
      rack: Math.round((p.steer || 0) * 100) / 100,
      rearSlide,
      xzWarps: (p._glitchLog || []).filter((e) => e.kind === "xz-warp").length,
    };
  `);
  for (const n of names) await key(cdp, "keyUp", n);
  return out;
}

/** Let the real rAF game loop run (it, not _fixed, owns the QA release). */
async function realFrames(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!findChrome()) {
    console.error("FAIL  no Chrome/Chromium binary found. Set CHROME_PATH.");
    process.exit(1);
  }
  console.log(`PLAYER CONTROLS  ·  ${new Date().toISOString()}\n`);

  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: !HEADED, width: 1280, height: 720 });
  const { cdp } = browser;
  const { errors } = await preparePage(cdp);

  try {
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "window.game" });
    await clickSelector(cdp, "#btn-start", "PRESS START");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-menu"?1:null;`, { timeout: 60000, label: "SELECT MODE" });
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(
      cdp,
      `const s=document.querySelector(".screen.active");
       if(!s||s.id!=="screen-cars") return null;
       const b=document.querySelector("[data-car='celica']");
       return b && !b.disabled ? 1 : null;`,
      { timeout: 60000, label: "Celica selectable" }
    );
    await clickSelector(cdp, "[data-car='celica']", "CELICA");
    await waitFor(cdp, `const e=document.querySelector(".screen.active"); return e&&e.id==="screen-courses"?1:null;`, { timeout: 60000, label: "SELECT COURSE" });
    await clickSelector(cdp, "[data-course='desert']", "DESERT");
    await waitFor(
      cdp,
      `const g=window.game;
       return g && (g.state==="countdown"||g.state==="race") && g.player && g.track ? 1 : null;`,
      { timeout: 180000, label: "desert loaded" }
    );

    // --- 1. Throttle: the headline case the user actually reported. --------
    await place(cdp, 0, 1);
    const gas = await hold(cdp, ["gas"], 120);
    console.log(`  THROTTLE   ${gas.speed0} -> ${gas.speed1} m/s  (dSpeed=${gas.dSpeed})  input.throttle=${gas.inThrottle}`);

    // --- 2. Brake ----------------------------------------------------------
    await place(cdp, 30, 4);
    const brake = await hold(cdp, ["brake"], 60);
    console.log(`  BRAKE      ${brake.speed0} -> ${brake.speed1} m/s  (dSpeed=${brake.dSpeed})  input.brake=${brake.inBrake}`);

    // --- 3. Handbrake ------------------------------------------------------
    await place(cdp, 30, 4);
    const hand = await hold(cdp, ["hand"], 60);
    console.log(`  HANDBRAKE  ${hand.speed0} -> ${hand.speed1} m/s  (dSpeed=${hand.dSpeed})  input.handbrake=${hand.inHand}  rearSlide=${hand.rearSlide}`);

    // --- 4. Steering -------------------------------------------------------
    await place(cdp, 22, 3);
    const left = await hold(cdp, ["left"], 120);
    await place(cdp, 22, 3);
    const right = await hold(cdp, ["right"], 120);
    console.log(`  LEFT       dYaw=${left.dYaw}  input.steer=${left.inSteer}  rack=${left.rack}`);
    console.log(`  RIGHT      dYaw=${right.dYaw}  input.steer=${right.inSteer}  rack=${right.rack}\n`);

    check("throttle accelerates the car", gas.dSpeed > ACCEL_MIN, `+${gas.dSpeed} m/s in 2 s`);
    check("throttle reaches the input layer", gas.inThrottle > 0.9, `input.throttle=${gas.inThrottle}`);
    check("brake slows the car", brake.dSpeed < -BRAKE_MIN, `${brake.dSpeed} m/s in 1 s`);
    check("handbrake bites", hand.dSpeed < -HANDBRAKE_MIN || hand.rearSlide, `${hand.dSpeed} m/s, rearSlide=${hand.rearSlide}`);
    check("LEFT turns the car", left.dYaw > YAW_MIN, `dYaw=${left.dYaw}`);
    check("RIGHT turns the car", right.dYaw < -YAW_MIN, `dYaw=${right.dYaw}`);
    check("steering reaches the rack", Math.abs(left.rack) > 0.02 && Math.abs(right.rack) > 0.02, `L=${left.rack} R=${right.rack}`);
    check(
      "no xz-warp during ordinary driving",
      gas.xzWarps === 0 && brake.xzWarps === 0 && hand.xzWarps === 0 && left.xzWarps === 0 && right.xzWarps === 0,
      `gas=${gas.xzWarps} brake=${brake.xzWarps} hand=${hand.xzWarps} L=${left.xzWarps} R=${right.xzWarps}`
    );

    // --- 5. The shipped defect: a QA hold left latched by a killed run. -----
    // The hold was {throttle: 1, steer: 0}, so it is both dead steering AND
    // stuck full throttle. The release lives in the real rAF loop, so this
    // half runs real frames rather than _fixed.
    console.log("");
    await place(cdp, 0, 1);
    await evaluate(cdp, `
      const g = window.game;
      g._qaDrive = { throttle: 1, steer: 0, brake: 0, handbrake: 0 };
      g.input._qaHold = g._qaDrive;
      return 1;
    `);
    await realFrames(1200);
    const latched = await evaluate(cdp, `
      const g = window.game;
      return { qaDrive: !!g._qaDrive, throttle: g.input.throttle, steer: g.input.steer };
    `);
    console.log(`  LATCHED    qaDrive=${latched.qaDrive}  input.throttle=${latched.throttle}  input.steer=${latched.steer}`);
    check("QA hold is genuinely latched before any key", latched.qaDrive === true && latched.throttle === 1);

    // A real key must take the car back — press brake, a control the hold pins to 0.
    await key(cdp, "keyDown", "brake");
    // Poll explicitly first: headless rAF is throttled to a few frames per
    // second, so waiting on real frames alone can starve the release. input.js
    // drops _qaHold here; game.js then consumes qaReleased on its next frame.
    const seen = await evaluate(cdp, `
      const g = window.game;
      for (let i = 0; i < 3; i++) g.input.poll();
      return {
        keys: Array.from(g.input._keys || []),
        qaReleased: !!g.input.qaReleased,
        qaHold: !!g.input._qaHold,
      };
    `);
    await realFrames(1500);
    const cleared = await evaluate(cdp, `
      const g = window.game;
      return { qaDrive: !!g._qaDrive, qaHold: !!g.input._qaHold, brake: g.input.brake };
    `);
    await key(cdp, "keyUp", "brake");
    console.log(`  KEY SEEN   held=[${seen.keys.join(", ")}]  qaReleased=${seen.qaReleased}  qaHold=${seen.qaHold}`);
    check("the browser delivered the brake key to the page", seen.keys.includes("arrowdown"), `held=[${seen.keys.join(", ")}]`);
    console.log(`  AFTER KEY  qaDrive=${cleared.qaDrive}  qaHold=${cleared.qaHold}  input.brake=${cleared.brake}`);
    check("a real key retires the QA override", !cleared.qaDrive && !cleared.qaHold);
    check("brake authority is taken back from the hold", cleared.brake === 1, `input.brake=${cleared.brake}`);

    // Throttle authority restored — the player can apply it...
    await place(cdp, 0, 1);
    const gasBack = await hold(cdp, ["gas"], 120);
    console.log(`  RE-GAS     ${gasBack.speed0} -> ${gasBack.speed1} m/s  (dSpeed=${gasBack.dSpeed})`);
    check("throttle works again after a latched hold", gasBack.dSpeed > ACCEL_MIN, `+${gasBack.dSpeed} m/s`);

    // ...and, just as importantly, can lift off. A car stuck at throttle 1 that
    // ignores the player is as broken as one that will not move.
    const coast = await hold(cdp, [], 60);
    console.log(`  LIFT OFF   ${coast.speed0} -> ${coast.speed1} m/s  (dSpeed=${coast.dSpeed})  input.throttle=${coast.inThrottle}\n`);
    check("player can lift off (throttle returns to 0)", coast.inThrottle === 0, `input.throttle=${coast.inThrottle}`);
    check("lifting off actually slows the car", coast.dSpeed < -LIFT_MIN, `${coast.dSpeed} m/s while coasting`);

    const fatal = errors.filter((e) => e.type === "error" || e.type === "exception");
    check("no console errors", fatal.length === 0, fatal.slice(0, 3).map((e) => e.text || e).join(" | "));

    await browser.close();
    await server.close();
    console.log(fail ? `\nFAIL — ${fail} check(s) failed` : `\nPASS — the player has full control of the car`);
    process.exit(fail ? 1 : 0);
  } catch (err) {
    console.error(`\nFAIL  ${err.message}`);
    if (errors.length) for (const e of errors.slice(0, 6)) console.error(`  [${e.type}] ${e.text}`);
    try { await browser.close(); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
    process.exit(1);
  }
}

main();
