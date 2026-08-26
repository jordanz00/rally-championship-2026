/**
 * Rally Championship — browser entry.
 *
 * WHO THIS IS FOR: anyone opening index.html via a local server.
 * WHAT IT DOES: boots the 60 Hz Saturn-style rally game.
 */

import { RallyGame } from "./game.js?v=410";

function boot() {
  if (window.game) return;
  try {
    window.game = new RallyGame();
  } catch (err) {
    console.error(err);
    const el = document.getElementById("boot-error");
    if (el) {
      el.hidden = false;
      el.textContent = String(err && err.stack ? err.stack : err);
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
