#!/usr/bin/env node
/**
 * Sprint 63 — tire contact patch sits on the visual tarmac.
 *
 * RUN: node tools/qa-sprint63-plant.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { readCacheVersions } from "./qa-cache-version.mjs";
import {
  ROOT,
  startServer,
  launchChrome,
  findChrome,
  preparePage,
  goto,
  waitFor,
  clickSelector,
  pressKey,
  evaluate,
} from "./lib/qa-harness.mjs";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok  ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log(`SPRINT 63 TIRE PLANT  ·  ${new Date().toISOString()}\n`);

const vehicle = read("js/physics/vehicle.js");
const celica = read("js/cars/celica.js");
const game = read("js/game.js");
const ai = read("js/ai.js");
const main = read("js/main.js");
const index = read("index.html");
const { gameV, mainV, ok: cacheOk } = readCacheVersions(main, index);

const plant = Number((vehicle.match(/const TIRE_PLANT\s*=\s*([0-9.]+)/) || [])[1]);
const deckFilt = Number((vehicle.match(/const DECK_FILT_RATE\s*=\s*([0-9.]+)/) || [])[1]);
const visRate = Number((vehicle.match(/const VIS_PITCH_RATE\s*=\s*([0-9.]+)/) || [])[1]);
const deckFn = (vehicle.match(/_roadDeckY\(axles\) \{[\s\S]*?\n  \}/) || [""])[0];

check(
  "contact origin is the tire patch",
  /plantOnContactPatch\(root\)/.test(celica) && /lowest \*tire rubber\*/.test(celica)
);
check(
  "TIRE_PLANT is a centimetre embed, not a 9 cm sink",
  Number.isFinite(plant) && plant > 0.008 && plant < 0.025,
  `TIRE_PLANT=${plant}`
);
check(
  "deck Y is axle-plane mid (no lower-axle 0.38 bias)",
  /return axles\.midH - TIRE_PLANT/.test(deckFn) && !/\* 0\.38/.test(deckFn)
);
check(
  "hill-sized deck errors use HANDLING.deckFollowRate",
  /DECK_NOISE_BAND/.test(vehicle) && /HANDLING\.deckFollowRate/.test(vehicle)
);
check(
  "noise-only deck filter is faster than the old 8/s lag",
  Number.isFinite(deckFilt) && deckFilt >= 22,
  `DECK_FILT_RATE=${deckFilt}`
);
check(
  "visual pitch follows real grades instead of lagging 5/s",
  Number.isFinite(visRate) && visRate >= 14 && /VIS_PITCH_SNAP/.test(vehicle),
  `VIS_PITCH_RATE=${visRate}`
);
check(
  "mesh pitch catches the axle plane on the ground",
  /_updateVisPitch\(dt, axles/.test(vehicle) && /pitchRate = landing/.test(vehicle)
);
check("game + AI import vehicle.js", /vehicle\.js\?v=\d+/.test(game) && /vehicle\.js\?v=\d+/.test(ai));
check(
  "visual hubs lift by chassisDeckEmbed (physics embed ≠ rubber through paint)",
  /export function chassisDeckEmbed/.test(celica) &&
    /chassisDeckEmbed\(p, d\.y/.test(game) &&
    /chassisDeckEmbed\(this\.vehicle, d\.y/.test(ai)
);
check("cache-bust chain", cacheOk && Number(gameV) >= 379, `main=${mainV} game=${gameV}`);

if (fail) {
  console.log(`\nFAIL  ·  ${fail} static check(s)`);
  process.exit(1);
}

const chrome = findChrome();
if (!chrome) {
  console.log("\nSKIP headed  ·  no Chrome");
  console.log("\nPASS  ·  static tire-plant contracts");
  process.exit(0);
}

console.log("\nheaded Desert start — visual rubber vs painted deck");

async function mainHeaded() {
  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true });
  const { cdp } = browser;
  try {
    await preparePage(cdp);
    await goto(cdp, `${server.origin}/index.html`);
    await waitFor(cdp, `return window.game ? 1 : null;`, { timeout: 20000, label: "game" });
    await pressKey(cdp, "Enter");
    await waitFor(
      cdp,
      `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-menu"?1:null;`,
      { timeout: 8000, label: "menu" }
    );
    await clickSelector(cdp, "[data-menu='practice']", "PRACTICE");
    await waitFor(
      cdp,
      `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-cars"?1:null;`,
      { timeout: 12000, label: "cars" }
    );
    await waitFor(
      cdp,
      `const b=document.querySelector("[data-car='celica']"); return b&&!b.disabled?1:null;`,
      { timeout: 20000, label: "celica" }
    );
    await clickSelector(cdp, "[data-car='celica']", "CELICA");
    await waitFor(
      cdp,
      `const el=document.querySelector(".screen.active"); return el&&el.id==="screen-courses"?1:null;`,
      { timeout: 25000, label: "courses" }
    );
    await clickSelector(cdp, "[data-course='desert']", "DESERT");
    await waitFor(
      cdp,
      `return window.game && (window.game.state === "countdown" || window.game.state === "race")
         ? window.game.courseId : null;`,
      { timeout: 120000, label: "desert boot" }
    );

    const probe = await evaluate(cdp, `(() => {
      const g = window.game;
      if (!g || !g.player || !g.playerMesh) return { err: "no player" };
      g.state = "paused";
      g._syncPlayerMesh(1);
      const p = g.player;
      const q = p._q;
      const road = q && Number.isFinite(q.height) ? q.height : null;
      const wheels = (g.playerMesh.userData && g.playerMesh.userData.wheels) || [];
      const worldMinY = (obj) => {
        if (!obj.geometry) return Infinity;
        if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
        const b = obj.geometry.boundingBox;
        if (!b) return Infinity;
        obj.updateWorldMatrix(true, false);
        const e = obj.matrixWorld.elements;
        const xs = [b.min.x, b.max.x];
        const ys = [b.min.y, b.max.y];
        const zs = [b.min.z, b.max.z];
        let minY = Infinity;
        for (let i = 0; i < 2; i++) {
          for (let j = 0; j < 2; j++) {
            for (let k = 0; k < 2; k++) {
              const wy = e[1] * xs[i] + e[5] * ys[j] + e[9] * zs[k] + e[13];
              if (wy < minY) minY = wy;
            }
          }
        }
        return minY;
      };
      let tireMin = Infinity;
      for (let i = 0; i < wheels.length; i++) {
        const hub = wheels[i];
        if (!hub || !hub.traverse) continue;
        hub.traverse((obj) => {
          if (!obj.isMesh || !obj.visible || !obj.geometry) return;
          if (obj.userData && obj.userData.axleScrap) return;
          const n = String(obj.name || "").toLowerCase();
          const isTire = /tire|tyre|rubber/.test(n) && !/rim|disc|caliper|brake/.test(n);
          const isWheel = /wheel|tire|tyre/.test(n) && !/rim|disc|caliper|brake/.test(n);
          if (!isTire && !isWheel) return;
          const y = worldMinY(obj);
          if (y < tireMin) tireMin = y;
        });
      }
      const embed = road != null && Number.isFinite(tireMin) ? road - tireMin : null;
      return {
        road,
        tireMin,
        embed,
        drawY: g.playerMesh.position.y,
        deckFilt: p._deckFilt,
        onGround: p.onGround,
      };
    })()`);

    if (!probe || probe.err) {
      check("headed tire AABB probe", false, probe && probe.err ? probe.err : "null");
    } else {
      const embed = probe.embed;
      console.log(
        `  probe  road=${Number(probe.road).toFixed(3)} tireMin=${Number(probe.tireMin).toFixed(3)} embed=${Number(embed).toFixed(4)} m`
      );
      check(
        "player tires kiss the deck (not floating, not clipped)",
        Number.isFinite(embed) && embed >= -0.004 && embed <= 0.012,
        `embed=${embed} m (want -4..12 mm)`
      );
      check("player is on the ground at the grid", probe.onGround === true);
    }
  } finally {
    await browser.close();
    server.close();
  }
}

mainHeaded()
  .then(() => {
    console.log(`\n${fail ? "FAIL" : "PASS"}  ·  ${fail ? fail + " check(s) failed" : "tires plant on the visual deck"}`);
    process.exit(fail ? 1 : 0);
  })
  .catch((err) => {
    console.log(`  FAIL  headed probe — ${err && err.message ? err.message : err}`);
    process.exit(1);
  });
