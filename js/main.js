/**
 * Rally Championship — browser entry.
 *
 * WHO THIS IS FOR: anyone opening index.html via a local server.
 * WHAT IT DOES: boots the 60 Hz Saturn-style rally game.
 * Phones: do NOT parse game.js (track/celica/three) until PRESS START —
 * Safari on iPhone 13 tab-kills if that graph races first paint.
 */

const GAME_MODULE = "./game.js?v=1247";

function bootWait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Import the engine. A cold graph is ~80 modules; one dropped response
 * poisons that URL for the document, so each retry uses a fresh query.
 * @returns {Promise<object>}
 */
async function importGameModule() {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const href = attempt === 0 ? GAME_MODULE : `${GAME_MODULE}&retry=${attempt}`;
    try {
      return await import(href);
    } catch (err) {
      lastErr = err;
      await bootWait(280 * (attempt + 1));
    }
  }
  throw lastErr;
}

function phoneLite() {
  try {
    if (window.__rallyPhoneLite === true) return true;
    if (document.documentElement.classList.contains("is-phone")) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** Drop a false "timed out" banner once the engine is actually up. */
function clearBootTimeoutBanner() {
  try {
    const el = document.getElementById("boot-error");
    if (!el || el.hidden) return;
    if (/never finished starting/i.test(el.textContent || "")) {
      el.hidden = true;
      el.textContent = "";
    }
  } catch {
    /* ignore */
  }
}

/**
 * Load RallyGame once. Safe to call from PRESS START or desktop boot.
 * @returns {Promise<object>}
 */
export async function bootEngine() {
  if (window.game) {
    clearBootTimeoutBanner();
    return window.game;
  }
  if (window.__rallyBooting) return window.__rallyBooting;
  window.__rallyBooting = (async () => {
    const mod = await importGameModule();
    if (!window.game) {
      window.game = new mod.RallyGame();
    }
    clearBootTimeoutBanner();
    try {
      sessionStorage.removeItem("rally-boot-reload");
    } catch {
      /* private mode */
    }
    return window.game;
  })();
  try {
    return await window.__rallyBooting;
  } finally {
    window.__rallyBooting = null;
  }
}

function boot() {
  if (window.game) return;
  // iPhone / Android: HTML splash only. Importing game.js here parsed
  // three + track + celica (~2.5 MB+) and Safari jetsam'd before PRESS START.
  if (phoneLite() && !window.__rallyLeftTitle) {
    window.__rallyPhoneDefer = true;
    window.__rallyBootEngine = bootEngine;
    return;
  }
  bootEngine().catch((err) => {
    console.error(err);
    const msg = String(err && (err.message || err) || "");
    const fetchFail = /failed to fetch dynamically imported module/i.test(msg);
    try {
      if (fetchFail && !sessionStorage.getItem("rally-boot-reload")) {
        sessionStorage.setItem("rally-boot-reload", "1");
        location.reload();
        return;
      }
    } catch {
      /* private mode */
    }
    const el = document.getElementById("boot-error");
    if (el) {
      el.hidden = false;
      el.textContent =
        "Engine failed to start.\n\n" +
        (err && err.stack ? String(err.stack) : msg);
    }
  });
}

window.__rallyBootEngine = bootEngine;

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
