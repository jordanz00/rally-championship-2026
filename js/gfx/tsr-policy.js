/**
 * WebTSR device policy — one present matrix for desktop vs phone.
 *
 * WHO THIS IS FOR: createWebTsr hosts and RallyGame.
 * WHAT IT DOES: decides heavy temporal SR vs the cheap mobile FXAA present.
 *   Reuses isPhonePlay() and the existing ?perf= / ?tsr= flags. Does not
 *   invent a second device table.
 * HOW IT CONNECTS: game.js boots WebTSR only when wantsHeavyWebTsr();
 *   phones and ?perf=low|min get createMobilePresent instead.
 *
 * POWER BI MAPPING: none
 */

import { isPhonePlay } from "../ui/touch-controls.js?v=3";

/**
 * @param {string} [search]
 * @returns {URLSearchParams}
 */
function params(search) {
  try {
    return new URLSearchParams(
      search != null ? search : (typeof location !== "undefined" ? location.search : "")
    );
  } catch {
    return new URLSearchParams();
  }
}

/**
 * True when this session is a phone / tablet play surface.
 * `?touch=1` forces phone controls (and this budget). `?touch=0` opts out.
 * @returns {boolean}
 */
export function isPhonePresentBudget() {
  try {
    return typeof isPhonePlay === "function" && isPhonePlay();
  } catch {
    return false;
  }
}

/**
 * Desktop Quality / Balanced / Performance reconstruct.
 * Phones never take this path unless `?tsrforce=1` (lab / QA only).
 * `?perf=low|min` also stays on the cheap present so probes match phones.
 * @param {string} [search]
 * @returns {boolean}
 */
export function wantsHeavyWebTsr(search) {
  const q = params(search);
  const tsr = (q.get("tsr") || "").toLowerCase();
  if (tsr === "off" || tsr === "0" || tsr === "false" || tsr === "none") return false;
  if (q.get("tsrforce") === "1") return true;
  if (isPhonePresentBudget()) return false;
  const perf = (q.get("perf") || "").toLowerCase();
  if (perf === "low" || perf === "min") return false;
  return true;
}

/**
 * Cheap FXAA present — phones by default, or desktop `?perf=low|min`.
 * `?mobileaa=0` or `?tsr=off` skips even this (native present).
 * @param {string} [search]
 * @returns {boolean}
 */
export function wantsMobilePresent(search) {
  const q = params(search);
  const tsr = (q.get("tsr") || "").toLowerCase();
  if (tsr === "off" || tsr === "0" || tsr === "false" || tsr === "none") return false;
  if (q.get("mobileaa") === "0") return false;
  if (q.get("tsrforce") === "1") return false;
  if (isPhonePresentBudget()) return true;
  const perf = (q.get("perf") || "").toLowerCase();
  return perf === "low" || perf === "min";
}

/**
 * Appearance / LOOK is a desktop opt-in. Phones never compile it.
 * @param {string} [search]
 * @returns {boolean}
 */
export function wantsAppearanceHandle(search) {
  if (!wantsHeavyWebTsr(search)) return false;
  const q = params(search);
  if (q.get("appear") === "0" || q.get("appear") === "off") return false;
  return true;
}
