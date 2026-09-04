/**
 * Cursor / Technology showcase — premium “Built with Cursor” experience.
 *
 * WHO THIS IS FOR: players who finish a race or open TECH from the menu.
 * WHAT IT DOES: Fills the Technology screen with real repo stats, architecture,
 *   multi-agent story, and enables live engine metrics (existing PerformanceMonitor).
 * HOW IT CONNECTS: index.html #screen-tech · game.js menu ids · project-stats.js
 *
 * Hierarchy: AMAZING GAME → SOPHISTICATED TECH → Built with Cursor
 */

import { PROJECT_STATS } from "./project-stats.js?v=2";
import { RENDER_CAPS } from "../gfx/render-caps.js?v=1";

/**
 * Format LOC for display (e.g. 43007 → "43,007").
 * @param {number} n
 * @returns {string}
 */
function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}

/**
 * Populate static fields on #screen-tech from PROJECT_STATS (never invent).
 */
export function fillTechShowcase() {
  const s = PROJECT_STATS;
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  set("tech-stat-stages", String(s.stages));
  set("tech-stat-cars", String(s.cars));
  set("tech-stat-js", fmt(s.jsModules));
  set("tech-stat-loc", fmt(s.jsLinesOfCode));
  set("tech-stat-qa", fmt(s.qaScripts));
  set("tech-stat-glb", fmt(s.glbAssets));
  set("tech-stat-gfx", String(s.gfxModules));
  set("tech-stat-phys", String(s.physicsModules));
  set("tech-stat-audio", String(s.audioModules));
  set("tech-stat-track", String(s.trackModules));
  set("tech-stat-docs", String(s.docs));
  set("tech-stat-generated", s.generatedAt || "");

  const api = RENDER_CAPS.api || "webgl";
  const rev = RENDER_CAPS.threeRevision || "";
  set(
    "tech-renderer-live",
    api === "webgpu"
      ? `WebGPU${rev ? ` · Three r${rev}` : ""}`
      : `WebGL${rev ? ` · Three r${rev}` : " · Three.js"}`
  );
}

/**
 * Enable live PerformanceMonitor overlay (same path as ?debug=1).
 * @param {{ perfMon?: { enable?: () => void } }} [opts]
 * @returns {boolean}
 */
export function enableLiveEngineMetrics(opts = {}) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("rally-debug", "1");
    }
  } catch {
    /* private mode */
  }
  if (opts.perfMon && typeof opts.perfMon.enable === "function") {
    opts.perfMon.enable();
  }
  const tip = document.getElementById("tech-live-tip");
  if (tip) {
    tip.hidden = false;
    tip.textContent =
      "Live metrics on — FPS, frame time, draw calls and triangles update during play. Same instrumentation as ?debug=1.";
  }
  return true;
}

/**
 * Open TECH screen focused on a chapter (architecture | how | live | credits).
 * @param {string} [chapter]
 */
export function focusTechChapter(chapter) {
  const map = {
    architecture: "tech-chapter-architecture",
    how: "tech-chapter-how",
    live: "tech-chapter-live",
    credits: "tech-chapter-credits",
    timeline: "tech-chapter-timeline",
  };
  const id = map[chapter] || map.architecture;
  const el = document.getElementById(id);
  if (el && typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/**
 * @param {{ onBack?: () => void, getPerfMon?: () => object|null }} [hooks]
 */
export function wireTechShowcase(hooks = {}) {
  fillTechShowcase();

  const back = document.getElementById("tech-back");
  if (back && !back.dataset.wired) {
    back.dataset.wired = "1";
    back.addEventListener("click", () => {
      if (hooks.onBack) hooks.onBack();
    });
  }

  const liveBtn = document.getElementById("tech-enable-live");
  if (liveBtn && !liveBtn.dataset.wired) {
    liveBtn.dataset.wired = "1";
    liveBtn.addEventListener("click", () => {
      const perfMon = hooks.getPerfMon ? hooks.getPerfMon() : null;
      enableLiveEngineMetrics({ perfMon });
    });
  }

  document.querySelectorAll("[data-tech-chapter]").forEach((btn) => {
    if (btn.dataset.wired) return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", () => {
      focusTechChapter(btn.getAttribute("data-tech-chapter") || "");
    });
  });
}
