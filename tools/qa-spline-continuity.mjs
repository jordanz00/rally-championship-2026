#!/usr/bin/env node
/**
 * qa-spline-continuity.mjs — is the road centreline actually continuous?
 *
 * WHO THIS IS FOR: the Glitch Department. Every "teleport" and "clip through
 *   the ground" chase so far has assumed the *car* moved wrongly. This asks the
 *   prior question: does `track.sample(d)` return a continuous curve at all?
 *
 * WHAT IT DOES: walks each stage's spline in fine steps and reports any place
 *   where consecutive samples are further apart in world space than the step
 *   itself can explain, plus any non-finite or duplicated sample. A break here
 *   makes progress-based physics, the position query, AI lines and the guard all
 *   read garbage at that distance — no amount of vehicle-side patching fixes it.
 *
 * WHY: driving Desert with an autopilot showed the car's lateral offset from
 *   `sample(progress)` jump from 0.7 m to 573 m in a single 1/60 s step at
 *   progress 1111.4, immediately after landing from jump 3. The chassis cannot
 *   move 573 m in 16 ms at 44 m/s, so either the pose was restored from a stale
 *   stash or the spline is broken at that distance. This tool decides which.
 *
 * RUN:  node tools/qa-spline-continuity.mjs
 *       node tools/qa-spline-continuity.mjs --course=desert --step=0.25
 * EXIT: 0 when every stage spline is continuous.
 *
 * POWER BI MAPPING: none
 */

import {
  ROOT, startServer, launchChrome, findChrome, preparePage, goto, evaluate,
  waitFor, clickSelector,
  chromeUnavailableHint
} from "./lib/qa-harness.mjs";

const argv = process.argv.slice(2).join(" ");
const ONLY = /--course=(\w+)/.exec(argv)?.[1] || "";
const STEP = Number(/--step=([\d.]+)/.exec(argv)?.[1] || 0.5);
const COURSES = ONLY ? [ONLY] : ["desert", "forest", "mountain"];

let fail = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok    ${label}${detail ? ` — ${detail}` : ""}`);
  else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  if (!findChrome()) {
    console.error(chromeUnavailableHint());
    process.exit(/SKIP/.test(chromeUnavailableHint()) ? 0 : 1);
  }
  console.log(`ROAD SPLINE CONTINUITY  ·  ${new Date().toISOString()}`);
  console.log(`step ${STEP} m\n`);

  const server = await startServer(ROOT);
  const browser = await launchChrome({ headless: true, width: 1024, height: 640 });
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

    for (let ci = 0; ci < COURSES.length; ci++) {
      const course = COURSES[ci];
      if (ci === 0) {
        await clickSelector(cdp, `[data-course='${course}']`, course.toUpperCase());
      } else {
        // Stash the current Track instance: `courseId` is assigned before the
        // rebuild finishes, so waiting on it alone returned the *previous*
        // stage's spline and every course reported identical geometry.
        await evaluate(
          cdp,
          `window.__prevTrack = window.game.track;
           setTimeout(() => window.game._beginRace(${JSON.stringify(course)}), 0); 1`
        );
      }
      await waitFor(
        cdp,
        `const g=window.game;
         if (!g || !g.track || g.courseId!==${JSON.stringify(course)}) return null;
         if (window.__prevTrack && g.track === window.__prevTrack) return null;
         return g.track.length > 10 ? 1 : null;`,
        { timeout: 180000, label: `${course} track` }
      );

      const res = await evaluate(
        cdp,
        `
        const t = window.game.track;
        const out = {};
        const step = ${STEP};
        const len = t.length;
        const breaks = [];
        const cliffs = [];
        let prev = null;
        let prevD = 0;
        let nonFinite = 0;
        let maxGap = 0;
        let maxGapAt = 0;
        for (let d = 0; d <= len; d += step) {
          const s = t.sample(d, out);
          if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.y) || !Number.isFinite(s.z)) {
            nonFinite += 1;
            prev = null;
            continue;
          }
          const cur = { x: s.x, y: s.y, z: s.z };
          if (prev) {
            const gap = Math.hypot(cur.x - prev.x, cur.z - prev.z);
            if (gap > maxGap) { maxGap = gap; maxGapAt = d; }
            // Vertical cliffs matter as much as horizontal breaks: a road that
            // drops metres over a couple of metres of arc length is a wall the
            // car falls off, and the guard reads it as under-world / y-warp.
            // A rally stage grade never exceeds ~35%.
            const grade = Math.abs(cur.y - prev.y) / step;
            if (grade > 0.6) {
              cliffs.push({
                at: Math.round(d * 100) / 100,
                dy: Math.round((cur.y - prev.y) * 100) / 100,
                grade: Math.round(grade * 100) / 100,
                y: Math.round(cur.y * 100) / 100,
                x: Math.round(cur.x * 10) / 10,
                z: Math.round(cur.z * 10) / 10
              });
            }
            // A centreline advancing 'step' metres of arc length cannot move
            // much more than 'step' in world space. 4x is generous slack for
            // sampling resolution on tight radii.
            if (gap > step * 4 + 0.5) {
              breaks.push({
                at: Math.round(d * 100) / 100,
                gap: Math.round(gap * 100) / 100,
                fromX: Math.round(prev.x * 10) / 10, fromZ: Math.round(prev.z * 10) / 10,
                toX: Math.round(cur.x * 10) / 10, toZ: Math.round(cur.z * 10) / 10,
                dy: Math.round((cur.y - prev.y) * 100) / 100
              });
            }
          }
          prev = cur;
          prevD = d;
        }
        return {
          length: Math.round(len),
          samples: Math.round(len / step),
          breaks: breaks.slice(0, 24),
          breakCount: breaks.length,
          // Collapse runs of adjacent cliff samples into one reported ledge.
          cliffs: cliffs.filter((c, i) => i === 0 || c.at - cliffs[i - 1].at > step * 1.5).slice(0, 24),
          cliffCount: cliffs.length,
          cliffDrop: cliffs.reduce((m, c) => Math.max(m, Math.abs(c.dy)), 0),
          nonFinite,
          maxGap: Math.round(maxGap * 100) / 100,
          maxGapAt: Math.round(maxGapAt * 10) / 10
        };
        `,
        { timeoutMs: 120000 }
      );

      console.log(`${course.toUpperCase()}  length ${res.length} m  ·  ${res.samples} samples  ·  largest step ${res.maxGap} m at ${res.maxGapAt} m`);
      if (res.breakCount) {
        console.log(`  ${res.breakCount} discontinuit${res.breakCount === 1 ? "y" : "ies"}:`);
        for (const b of res.breaks) {
          console.log(
            `    at ${String(b.at).padStart(8)} m   jumps ${String(b.gap).padStart(8)} m   ` +
              `(${b.fromX},${b.fromZ}) -> (${b.toX},${b.toZ})  dy=${b.dy}`
          );
        }
      }
      if (res.cliffCount) {
        console.log(`  ${res.cliffs.length} vertical cliff ledge(s) — road drops faster than 60% grade:`);
        for (const c of res.cliffs) {
          console.log(
            `    at ${String(c.at).padStart(8)} m   dy ${String(c.dy).padStart(7)} m   ` +
              `grade ${String(c.grade).padStart(7)}   y=${c.y}  world=(${c.x},${c.z})`
          );
        }
      }
      check(`${course} spline is continuous`, res.breakCount === 0, `${res.breakCount} break(s)`);
      check(
        `${course} has no vertical cliffs in the road`,
        res.cliffCount === 0,
        `${res.cliffCount} sample(s), worst step ${res.cliffDrop.toFixed(2)} m`
      );
      check(`${course} spline has no non-finite samples`, res.nonFinite === 0, `${res.nonFinite}`);

      const dump = /--dump=([\d.]+):([\d.]+)/.exec(argv);
      if (dump) {
        const rows = await evaluate(
          cdp,
          `
          const pts = window.game.track.points;
          const from = ${Number(dump[1])}, to = ${Number(dump[2])};
          const out = [];
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (p.dist < from || p.dist > to) continue;
            out.push({
              i,
              dist: Math.round(p.dist * 100) / 100,
              y: Math.round(p.y * 1000) / 1000,
              width: p.width,
              tunnel: !!p.tunnel,
              underpass: !!p.underpass,
              jumpKind: p.jumpKind || "",
              overlapBed: p.overlapBed == null ? null : Math.round(p.overlapBed * 100) / 100
            });
          }
          return out;
          `
        );
        console.log(`  raw spline posts ${dump[1]}–${dump[2]} m (${rows.length}):`);
        let py = null;
        for (const r of rows) {
          const d = py == null ? 0 : r.y - py;
          py = r.y;
          console.log(
            `    #${String(r.i).padStart(5)} dist=${String(r.dist).padStart(8)} y=${String(r.y).padStart(8)} ` +
              `dy=${String(Math.round(d * 1000) / 1000).padStart(7)} w=${String(r.width).padStart(5)} ` +
              `${r.tunnel ? "TUNNEL " : ""}${r.underpass ? "UNDERPASS " : ""}${r.jumpKind ? "jump:" + r.jumpKind + " " : ""}` +
              `${r.overlapBed != null ? "bed=" + r.overlapBed : ""}`
          );
        }
      }
      console.log("");
    }

    if (errors.length) check("no console errors", false, errors.slice(0, 4).map((e) => e.text || e).join(" | "));
    else check("no console errors", true);

    await browser.close();
    await server.close();
    console.log(fail ? `\nFAIL — ${fail} check(s) failed` : "\nPASS — every stage centreline is continuous");
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
