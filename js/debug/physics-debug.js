/**
 * Physics Lab — Sega Rally feel tuning overlay (Stage 4).
 *
 * WHO THIS IS FOR: developers tuning HANDLING / ARCADE_ASSIST against drive feel.
 * WHAT IT DOES: live telemetry + runtime dials. Never show "DRIFT ASSIST" to players.
 * HOW IT CONNECTS: docs/SEGA_RALLY_DRIVING_MODEL.md · Vehicle.physSnapshot() ·
 *   mutates ARCADE_ASSIST / HANDLING objects read each physics step.
 *
 * Enable: ?physlab=1 · localStorage rally-physlab=1 · F8 toggle
 * Lightweight read-only: ?physdebug=1 / ?debug=1 (no dials)
 */

import { ARCADE_ASSIST, HANDLING } from "../config.js?v=204";

/** @typedef {{ key: string, label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void }} LabDial */

function searchFlag(re) {
  try {
    if (typeof location !== "undefined" && re.test(location.search)) return true;
  } catch {
    /* private */
  }
  return false;
}

function storageFlag(key) {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem(key) === "1") return true;
  } catch {
    /* private */
  }
  return false;
}

function wantsPhysLab() {
  return searchFlag(/[?&]physlab=1(?:&|$)/) || storageFlag("rally-physlab");
}

function wantsPhysDebug() {
  return (
    wantsPhysLab() ||
    searchFlag(/[?&]physdebug=1(?:&|$)/) ||
    searchFlag(/[?&]debug=1(?:&|$)/) ||
    storageFlag("rally-physdebug")
  );
}

/**
 * @returns {PhysicsDebug}
 */
export function createPhysicsDebug() {
  return new PhysicsDebug();
}

export class PhysicsDebug {
  constructor() {
    this.enabled = wantsPhysDebug();
    this.labMode = wantsPhysLab();
    this.el = null;
    this._dialHost = null;
    this._telem = null;
    this._boundKeys = false;
    if (this.enabled) this._ensureDom();
    this._bindHotkey();
  }

  _bindHotkey() {
    if (this._boundKeys || typeof window === "undefined") return;
    this._boundKeys = true;
    window.addEventListener("keydown", (e) => {
      if (e.code !== "F8" || e.repeat) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/i.test(e.target.tagName)) return;
      e.preventDefault();
      this.toggleLab();
    });
  }

  /** Toggle full lab (dials + telemetry). Persists to localStorage. */
  toggleLab() {
    this.labMode = !this.labMode;
    this.enabled = this.enabled || this.labMode;
    if (this.labMode) this.enabled = true;
    try {
      localStorage.setItem("rally-physlab", this.labMode ? "1" : "0");
    } catch {
      /* private */
    }
    if (this.enabled) this._ensureDom();
    this._syncDialVisibility();
  }

  /** Force lab on (e.g. starting PHYS LAB course). */
  enableLab() {
    this.labMode = true;
    this.enabled = true;
    try {
      localStorage.setItem("rally-physlab", "1");
    } catch {
      /* private */
    }
    this._ensureDom();
    this._syncDialVisibility();
  }

  _ensureDom() {
    if (this.el || typeof document === "undefined") return;
    const root = document.createElement("div");
    root.id = "phys-lab";
    root.setAttribute("aria-hidden", "true");
    Object.assign(root.style, {
      position: "fixed",
      right: "8px",
      bottom: "8px",
      zIndex: "90",
      width: "min(340px, 94vw)",
      padding: "10px 12px",
      font: "11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace",
      color: "#ffe8c8",
      background: "rgba(14, 8, 2, 0.88)",
      border: "1px solid rgba(220, 160, 80, 0.45)",
      borderRadius: "4px",
      pointerEvents: "none",
      userSelect: "none",
    });

    const title = document.createElement("div");
    title.textContent = "RALLY PHYSICS LAB";
    Object.assign(title.style, {
      fontWeight: "700",
      letterSpacing: "0.06em",
      marginBottom: "6px",
      color: "#ffd090",
      borderBottom: "1px solid rgba(220, 160, 80, 0.35)",
      paddingBottom: "4px",
    });
    root.appendChild(title);

    const hint = document.createElement("div");
    hint.textContent = "F8 toggle · dials write ARCADE_ASSIST / HANDLING live";
    Object.assign(hint.style, { opacity: "0.65", marginBottom: "8px", fontSize: "10px" });
    root.appendChild(hint);

    this._dialHost = document.createElement("div");
    this._dialHost.id = "phys-lab-dials";
    Object.assign(this._dialHost.style, {
      display: "none",
      pointerEvents: "auto",
      marginBottom: "8px",
    });
    root.appendChild(this._dialHost);
    this._buildDials(this._dialHost);

    this._telem = document.createElement("pre");
    Object.assign(this._telem.style, {
      margin: "0",
      whiteSpace: "pre",
      pointerEvents: "none",
    });
    root.appendChild(this._telem);

    document.body.appendChild(root);
    this.el = root;
    this._syncDialVisibility();
  }

  _syncDialVisibility() {
    if (!this._dialHost || !this.el) return;
    this._dialHost.style.display = this.labMode ? "block" : "none";
    this.el.style.pointerEvents = this.labMode ? "auto" : "none";
    this.el.style.display = this.enabled ? "block" : "none";
  }

  /**
   * @param {HTMLElement} host
   */
  _buildDials(host) {
    /** @type {LabDial[]} */
    const dials = [
      {
        key: "yawAssist",
        label: "Yaw Assist",
        min: 0,
        max: 0.6,
        step: 0.01,
        get: () => ARCADE_ASSIST.yawAssist,
        set: (v) => {
          ARCADE_ASSIST.yawAssist = v;
        },
      },
      {
        key: "recoveryAssist",
        label: "Recovery",
        min: 0,
        max: 1,
        step: 0.01,
        get: () => ARCADE_ASSIST.recoveryAssist,
        set: (v) => {
          ARCADE_ASSIST.recoveryAssist = v;
        },
      },
      {
        key: "recoverableSlide",
        label: "Catch Window",
        min: 6,
        max: 18,
        step: 0.5,
        get: () => ARCADE_ASSIST.recoverableSlide,
        set: (v) => {
          ARCADE_ASSIST.recoverableSlide = v;
        },
      },
      {
        key: "driftStability",
        label: "Drift Grip",
        min: 0,
        max: 0.8,
        step: 0.01,
        get: () => ARCADE_ASSIST.driftStability,
        set: (v) => {
          ARCADE_ASSIST.driftStability = v;
        },
      },
      {
        key: "landingAssist",
        label: "Landing",
        min: 0,
        max: 0.8,
        step: 0.01,
        get: () => ARCADE_ASSIST.landingAssist,
        set: (v) => {
          ARCADE_ASSIST.landingAssist = v;
        },
      },
      {
        key: "tireSlideSoft",
        label: "Grip Soft",
        min: 1,
        max: 3.5,
        step: 0.05,
        get: () => ARCADE_ASSIST.tireSlideSoft,
        set: (v) => {
          ARCADE_ASSIST.tireSlideSoft = v;
        },
      },
      {
        key: "throttleSlide",
        label: "Throttle Slide",
        min: 0.5,
        max: 4,
        step: 0.05,
        get: () => HANDLING.throttleSlide,
        set: (v) => {
          HANDLING.throttleSlide = v;
        },
      },
      {
        key: "trailBrakeYaw",
        label: "Trail Brake",
        min: 0,
        max: 1.8,
        step: 0.02,
        get: () => HANDLING.trailBrakeYaw,
        set: (v) => {
          HANDLING.trailBrakeYaw = v;
        },
      },
      {
        key: "handbrakeYawKick",
        label: "Handbrake",
        min: 0.5,
        max: 5,
        step: 0.05,
        get: () => HANDLING.handbrakeYawKick,
        set: (v) => {
          HANDLING.handbrakeYawKick = v;
        },
      },
      {
        key: "weightTransferMul",
        label: "Weight Xfer",
        min: 0.5,
        max: 4,
        step: 0.05,
        get: () => HANDLING.weightTransferMul,
        set: (v) => {
          HANDLING.weightTransferMul = v;
        },
      },
      {
        key: "counterAuthority",
        label: "Countersteer",
        min: 1,
        max: 5,
        step: 0.05,
        get: () => HANDLING.counterAuthority,
        set: (v) => {
          HANDLING.counterAuthority = v;
        },
      },
    ];

    for (const d of dials) {
      const row = document.createElement("label");
      Object.assign(row.style, {
        display: "grid",
        gridTemplateColumns: "92px 1fr 44px",
        gap: "6px",
        alignItems: "center",
        marginBottom: "4px",
        cursor: "pointer",
      });
      const name = document.createElement("span");
      name.textContent = d.label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(d.min);
      input.max = String(d.max);
      input.step = String(d.step);
      input.value = String(d.get());
      Object.assign(input.style, { width: "100%", accentColor: "#e8a040" });
      const val = document.createElement("span");
      val.textContent = Number(d.get()).toFixed(2);
      Object.assign(val.style, { textAlign: "right", opacity: "0.9" });
      input.addEventListener("input", () => {
        const v = Number(input.value);
        d.set(v);
        val.textContent = v.toFixed(2);
      });
      // Keep game from seeing key events while scrubbing.
      input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
      row.appendChild(name);
      row.appendChild(input);
      row.appendChild(val);
      host.appendChild(row);
    }
  }

  /**
   * @param {object|null} snap from Vehicle.physSnapshot()
   */
  paint(snap) {
    if (!this.enabled || !snap) return;
    this._ensureDom();
    if (!this._telem) return;
    const bar = (v, lo, hi) => {
      const t = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, hi - lo)));
      const n = Math.round(t * 10);
      return "█".repeat(n) + "░".repeat(10 - n);
    };
    const slipDeg = snap.slipAngleDeg || 0;
    const yawDeg = ((snap.yawRate || 0) * 180) / Math.PI;
    const surf = String(snap.surface || "?").toUpperCase();
    this._telem.textContent =
      `Grip µ     ${bar(snap.feltMu, 0.4, 1.7)}  ${(snap.feltMu || 0).toFixed(2)}\n` +
      `Slip       ${bar(Math.abs(slipDeg), 0, 35)}  ${slipDeg.toFixed(1)}°\n` +
      `Yaw rate   ${bar(Math.abs(yawDeg), 0, 90)}  ${yawDeg.toFixed(0)}°/s\n` +
      `\n` +
      `Speed      ${snap.speedKmh.toFixed(0)} km/h   G${snap.gear}  ${snap.rpm} rpm\n` +
      `Surface    ${surf}\n` +
      ` thr ${(snap.throttle * 100) | 0}%  brk ${(snap.brake * 100) | 0}%  ` +
      `hb ${(snap.handbrake * 100) | 0}%  st ${snap.steer.toFixed(2)}\n` +
      ` vx ${snap.vx.toFixed(1)}  vy ${snap.vy.toFixed(1)}\n` +
      ` αF ${((snap.alphaF * 180) / Math.PI).toFixed(1)}°  ` +
      `αR ${((snap.alphaR * 180) / Math.PI).toFixed(1)}°  ` +
      `κF ${snap.kappaF.toFixed(2)}  κR ${snap.kappaR.toFixed(2)}\n` +
      ` FL ${bar(-snap.suspFL, 0, 0.14)} FR ${bar(-snap.suspFR, 0, 0.14)}\n` +
      ` RL ${bar(-snap.suspRL, 0, 0.14)} RR ${bar(-snap.suspRR, 0, 0.14)}\n` +
      ` ${snap.onGround ? "GROUND" : "AIR"}` +
      `${snap.rearSlide ? "  REAR-SLIDE" : ""}` +
      `${snap.frontSlide ? "  FRONT-SLIDE" : ""}`;
  }
}
