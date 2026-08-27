/**
 * HUD + analog cluster — Saturn arcade chrome with chase-cam dials.
 *
 * WHO THIS IS FOR: overlay DOM in index.html.
 * WHAT IT DOES: updates speed, gear, position, timer, surface, and draws
 *   MPH / RPM gauges in medium and far camera views.
 */

const KMH_TO_MPH = 0.621371;
/** Sweep from 7:30 to 4:30 (canvas radians, 0 = 3 o’clock). */
const GAUGE_START = Math.PI * 0.75;
const GAUGE_SWEEP = Math.PI * 1.5;

export class Hud {
  constructor() {
    this.speed = document.getElementById("hud-speed");
    this.gear = document.getElementById("hud-gear");
    this.rpmFill = document.getElementById("hud-rpm-fill");
    this.pos = document.getElementById("hud-pos");
    this.time = document.getElementById("hud-time");
    this.best = document.getElementById("hud-best");
    this.surface = document.getElementById("hud-surface");
    this.course = document.getElementById("hud-course");
    this.flash = document.getElementById("hud-flash");
    this.minimap = document.getElementById("minimap");
    this.miniCtx = this.minimap ? this.minimap.getContext("2d") : null;
    this.fps = document.getElementById("hud-fps");
    this._debugHud = isDebugHud();
    if (this.fps) this.fps.hidden = !this._debugHud;
    this.pace = document.getElementById("hud-pace");
    this.trans = document.getElementById("hud-trans");
    this.hudRoot = document.getElementById("screen-hud");
    this.cluster = document.getElementById("cluster");
    this.clusterGear = document.getElementById("cluster-gear");
    this.clusterTrans = document.getElementById("cluster-trans");
    this.clusterSurface = document.getElementById("cluster-surface");
    this.gripFill = document.getElementById("cluster-grip-fill");
    this.slideBadge = document.getElementById("cluster-slide");
    this.bodyFill = document.getElementById("cluster-body-fill");
    this.bodyWrap = document.getElementById("cluster-body");
    if (this.bodyWrap) this.bodyWrap.hidden = true;
    this._mphShown = 0;
    this._rpmShown = 0;
    this._chase = false;
    this.mphDial = new AnalogDial(document.getElementById("gauge-mph"), {
      label: "MPH",
      max: 140,
      major: 20,
      minor: 10,
      redFrom: 120,
    });
    this.rpmDial = new AnalogDial(document.getElementById("gauge-rpm"), {
      label: "×1000",
      sub: "RPM",
      max: 9,
      major: 1,
      minor: 1,
      redFrom: 7.2,
    });
  }

  /**
   * Large HTML analog speedo/tach — chase/far only. POV hides these and uses
   * the in-cabin binnacle instead.
   * @param {boolean} on
   */
  setChaseGauges(on) {
    this._chase = !!on;
    if (this.hudRoot) this.hudRoot.classList.toggle("chase-gauges", this._chase);
    if (this.cluster) this.cluster.hidden = !this._chase;
  }

  /**
   * @param {object} s
   * @param {number} [s.dt] frame delta seconds — needle lerp is dt-scaled
   */
  update(s) {
    const kmh = s.speedKmh || 0;
    const rpm = s.rpm || 0;
    const redline = s.redline || 7500;
    const speedTxt = String(Math.round(kmh)).padStart(3, "0");
    if (this._speedTxt !== speedTxt) {
      this._speedTxt = speedTxt;
      this.speed.textContent = speedTxt;
    }
    this.speed.dataset.fast = kmh > 140 ? "1" : "0";
    const gearTxt = s.gear === 0 ? "N" : String(s.gear);
    if (this._gearTxt !== gearTxt) {
      this._gearTxt = gearTxt;
      this.gear.textContent = gearTxt;
      if (this.clusterGear) this.clusterGear.textContent = gearTxt;
    }
    const rpmPct = Math.min(100, (rpm / redline) * 100) | 0;
    if (this._rpmPct !== rpmPct) {
      this._rpmPct = rpmPct;
      this.rpmFill.style.width = `${rpmPct}%`;
    }
    if (this._pos !== s.position) {
      this._pos = s.position;
      this.pos.textContent = ordinal(s.position);
      this.pos.dataset.place = s.position <= 3 ? String(s.position) : "pack";
    }
    const timeTxt = formatTime(s.timeLeft);
    if (this._timeTxt !== timeTxt) {
      this._timeTxt = timeTxt;
      this.time.textContent = timeTxt;
    }
    const urgent = s.timeLeft > 0 && s.timeLeft <= 30;
    const critical = s.timeLeft > 0 && s.timeLeft <= 10;
    const urgFlag = critical ? "2" : urgent ? "1" : "0";
    if (this.time && this.time.dataset.urgent !== urgFlag) {
      this.time.dataset.urgent = urgFlag;
    }
    const lapTxt = s.lapTime >= 0 ? formatClock(s.lapTime) : "--'--\"--";
    if (this._lapTxt !== lapTxt) {
      this._lapTxt = lapTxt;
      this.best.textContent = lapTxt;
    }
    const inAir = s.onGround === false;
    const surfaceLabel = inAir ? "AIR" : (s.surface || "");
    const surfKey = inAir ? "air" : surfaceHudKey(s.surfaceId || s.surface);
    if (this._surface !== s.surface || this._inAir !== inAir) {
      this._surface = s.surface;
      this._inAir = inAir;
      this.surface.textContent = surfaceLabel;
      this.surface.dataset.surf = surfKey;
      if (this.clusterSurface) {
        this.clusterSurface.textContent = surfaceLabel;
        this.clusterSurface.dataset.surf = surfKey;
      }
    }
    if (this._course !== s.courseName || this._courseSub !== (s.courseSub || "")) {
      this._course = s.courseName;
      this._courseSub = s.courseSub || "";
      const sub = this._courseSub ? ` · ${this._courseSub}` : "";
      this.course.textContent = `${s.courseName || ""}${sub}`;
    }
    if (this._debugHud && this.fps && this._fps !== s.fps) {
      this._fps = s.fps;
      this.fps.textContent = `${s.fps} FPS`;
    }
    if (this.pace && this._pace !== (s.pace || "")) {
      this._pace = s.pace || "";
      this.pace.textContent = this._pace;
      const p = this._pace.toUpperCase();
      let sev = "mid";
      if (/HARD|JUMP|HAIRPIN/.test(p)) sev = "hard";
      else if (/TUNNEL/.test(p)) sev = "tunnel";
      else if (/EASY/.test(p)) sev = "easy";
      this.pace.dataset.sev = sev;
    }
    if (this.trans && this._trans !== (s.trans || "AT")) {
      this._trans = s.trans || "AT";
      this.trans.textContent = this._trans;
      if (this.clusterTrans) this.clusterTrans.textContent = this._trans;
    }

    if (this.gripFill) {
      const grip = clamp01(s.gripUsed != null ? s.gripUsed : 0);
      const remain = 1 - grip;
      const hot = grip > 0.62 ? "1" : "0";
      if (this._gripRemain !== remain) {
        this._gripRemain = remain;
        this.gripFill.style.transform = `scaleX(${remain.toFixed(3)})`;
      }
      if (this.gripFill.dataset.hot !== hot) this.gripFill.dataset.hot = hot;
    }

    if (this.slideBadge) {
      const slide = clamp01(s.slidePct != null ? s.slidePct : 0);
      const show = slide > 0.2 || !!s.drifting;
      if (this.slideBadge.hidden === show) this.slideBadge.hidden = !show;
      const hot = slide > 0.55 ? "1" : "0";
      if (this.slideBadge.dataset.hot !== hot) this.slideBadge.dataset.hot = hot;
    }

    if (this.bodyWrap) this.bodyWrap.hidden = true;

    if (!this._chase) return;
    const mph = Math.max(0, kmh * KMH_TO_MPH);
    const dt = s.dt > 0 ? s.dt : 1 / 60;
    this._mphShown += (mph - this._mphShown) * (1 - Math.exp(-15 * dt));
    this._rpmShown += (rpm - this._rpmShown) * (1 - Math.exp(-20 * dt));
    this.rpmDial.setRedFrom(redline / 1000);
    this.mphDial.draw(this._mphShown, Math.round(mph));
    this.rpmDial.draw(this._rpmShown / 1000, Math.round(this._rpmShown));
  }

  resizeGauges() {
    if (this.mphDial) this.mphDial.invalidateSize();
    if (this.rpmDial) this.rpmDial.invalidateSize();
  }

  flashMessage(text) {
    if (!this.flash) return;
    this.flash.textContent = text;
    // Restart the CSS flash without forcing a synchronous layout (offsetWidth hitch).
    this.flash.classList.remove("show");
    requestAnimationFrame(() => {
      if (this.flash) this.flash.classList.add("show");
    });
  }

  drawMinimap(track, player, opponents) {
    const ctx = this.miniCtx;
    if (!ctx || !track) return;
    const w = this.minimap.width;
    const h = this.minimap.height;
    ctx.fillStyle = "#0a120c";
    ctx.fillRect(0, 0, w, h);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of track.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const pad = 12;
    const sx = (w - pad * 2) / (maxX - minX || 1);
    const sz = (h - pad * 2) / (maxZ - minZ || 1);
    const sc = Math.min(sx, sz);
    const mapX = (x) => pad + (x - minX) * sc;
    const mapZ = (z) => pad + (z - minZ) * sc;
    ctx.strokeStyle = "#7a9a62";
    ctx.lineWidth = 2;
    ctx.beginPath();
    track.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(mapX(p.x), mapZ(p.z));
      else ctx.lineTo(mapX(p.x), mapZ(p.z));
    });
    ctx.stroke();
    ctx.fillStyle = "#ffd200";
    ctx.fillRect(mapX(player.position.x) - 2, mapZ(player.position.z) - 2, 4, 4);
    ctx.fillStyle = "#d4121a";
    for (const o of opponents) {
      ctx.fillRect(mapX(o.vehicle.position.x) - 1.5, mapZ(o.vehicle.position.z) - 1.5, 3, 3);
    }
  }
}

/**
 * One round analog dial. Face is cached; needle redraws every tick.
 * Layout: numerals live on the outer rim — never stacked on a center box.
 */
class AnalogDial {
  /**
   * @param {HTMLCanvasElement|null} canvas
   * @param {{label:string, sub?:string, max:number, major:number, minor:number, redFrom:number}} spec
   */
  constructor(canvas, spec) {
    this.canvas = canvas;
    this.spec = spec;
    this.ctx = canvas ? canvas.getContext("2d") : null;
    this._face = null;
    this._css = 0;
    this._redFrom = spec.redFrom;
    this._px = 0;
  }

  invalidateSize() {
    this._px = 0;
    this._face = null;
  }

  /**
   * @param {number} rpmThousand
   */
  setRedFrom(rpmThousand) {
    const next = Math.max(5.5, Math.min(8.6, rpmThousand));
    if (Math.abs(next - this._redFrom) < 0.05) return;
    this._redFrom = next;
    this._face = null;
  }

  /**
   * @param {number} value needle (smoothed)
   * @param {number} readout integer under the needle
   */
  draw(value, readout) {
    const c = this.canvas;
    const ctx = this.ctx;
    if (!c || !ctx) return;
    if (!this._px) {
      const css = Math.round(c.clientWidth) || 220;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
      this._px = Math.max(180, css) * dpr;
    }
    const px = this._px;
    if (c.width !== px || c.height !== px) {
      c.width = px;
      c.height = px;
      this._face = null;
    }
    if (!this._face) this._face = this._paintFace(px);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    ctx.drawImage(this._face, 0, 0);
    const t = clamp(value / this.spec.max, 0, 1.04);
    this._needle(ctx, px, GAUGE_START + t * GAUGE_SWEEP);
    this._hubReadout(ctx, px, readout);
  }

  /**
   * Clean automotive face: chrome bezel, matte dial, rim numerals, no center box.
   * @param {number} px
   * @returns {HTMLCanvasElement}
   */
  _paintFace(px) {
    const off = document.createElement("canvas");
    off.width = px;
    off.height = px;
    const g = off.getContext("2d");
    const cx = px * 0.5;
    const cy = px * 0.5;
    const r = px * 0.47;
    const spec = this.spec;
    const redFrom = this._redFrom;

    // Soft outer shadow (sits on the HUD, not a hard square card).
    g.beginPath();
    g.arc(cx, cy + px * 0.012, r * 0.98, 0, Math.PI * 2);
    g.fillStyle = "rgba(0,0,0,0.38)";
    g.fill();

    // Brushed bezel.
    const bezel = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    bezel.addColorStop(0, "#ece8de");
    bezel.addColorStop(0.22, "#9a968c");
    bezel.addColorStop(0.48, "#3a3936");
    bezel.addColorStop(0.72, "#cfc9bc");
    bezel.addColorStop(1, "#1e1e1c");
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = bezel;
    g.fill();

    // Inner black lip.
    g.beginPath();
    g.arc(cx, cy, r * 0.9, 0, Math.PI * 2);
    g.fillStyle = "#0a0a0a";
    g.fill();

    // Matte face — slight dome, no busy gradients.
    g.beginPath();
    g.arc(cx, cy, r * 0.86, 0, Math.PI * 2);
    const face = g.createRadialGradient(cx, cy - r * 0.08, r * 0.05, cx, cy, r * 0.86);
    face.addColorStop(0, "#1c1e1b");
    face.addColorStop(0.7, "#101110");
    face.addColorStop(1, "#080908");
    g.fillStyle = face;
    g.fill();

    // Redline wedge (outer band only — does not invade the number ring).
    if (redFrom < spec.max) {
      const a0 = GAUGE_START + (redFrom / spec.max) * GAUGE_SWEEP;
      const a1 = GAUGE_START + GAUGE_SWEEP;
      g.beginPath();
      g.arc(cx, cy, r * 0.84, a0, a1);
      g.arc(cx, cy, r * 0.72, a1, a0, true);
      g.closePath();
      g.fillStyle = "rgba(196, 28, 28, 0.55)";
      g.fill();
    }

    // Tick marks + rim numerals (kept clear of the open center).
    g.lineCap = "butt";
    g.textAlign = "center";
    g.textBaseline = "middle";
    const fontMajor = Math.round(px * 0.078);
    g.font = `600 ${fontMajor}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    const minors = Math.round(spec.max / spec.minor);
    for (let i = 0; i <= minors; i++) {
      const v = i * spec.minor;
      if (v > spec.max + 0.001) break;
      const a = GAUGE_START + (v / spec.max) * GAUGE_SWEEP;
      const major = Math.abs(v / spec.major - Math.round(v / spec.major)) < 0.001;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const outer = r * 0.84;
      const inner = major ? r * 0.74 : r * 0.79;
      g.strokeStyle = v >= redFrom ? "#ff6a62" : "#e8e4d8";
      g.lineWidth = major ? px * 0.011 : px * 0.0055;
      g.beginPath();
      g.moveTo(cx + cos * inner, cy + sin * inner);
      g.lineTo(cx + cos * outer, cy + sin * outer);
      g.stroke();
      if (major) {
        // Numerals sit just inside the ticks — never over a center plaque.
        const lx = cx + cos * r * 0.62;
        const ly = cy + sin * r * 0.62;
        g.fillStyle = v >= redFrom ? "#ff8a82" : "#f2eee4";
        const label = Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
        g.fillText(label, lx, ly);
      }
    }

    // Unit caption above the hub — leaves the lower face open for the readout.
    g.fillStyle = "rgba(232, 228, 216, 0.62)";
    g.font = `600 ${Math.round(px * 0.04)}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    if (spec.sub) {
      g.fillText(spec.sub, cx, cy - r * 0.12);
      g.font = `500 ${Math.round(px * 0.032)}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
      g.fillStyle = "rgba(232, 228, 216, 0.42)";
      g.fillText(spec.label, cx, cy - r * 0.02);
    } else {
      g.fillText(spec.label, cx, cy - r * 0.08);
    }

    // Soft glass highlight (top crescent only).
    const glass = g.createLinearGradient(0, cy - r * 0.75, 0, cy);
    glass.addColorStop(0, "rgba(255,255,255,0.14)");
    glass.addColorStop(0.35, "rgba(255,255,255,0.04)");
    glass.addColorStop(1, "rgba(255,255,255,0)");
    g.beginPath();
    g.ellipse(cx, cy - r * 0.28, r * 0.58, r * 0.32, 0, Math.PI, Math.PI * 2);
    g.fillStyle = glass;
    g.fill();

    return off;
  }

  /**
   * @param {CanvasRenderingContext2D} g
   * @param {number} px
   * @param {number} angle
   */
  _needle(g, px, angle) {
    const cx = px * 0.5;
    const cy = px * 0.5;
    const tip = px * 0.46 * 0.8;
    g.save();
    g.translate(cx, cy);
    g.rotate(angle);
    // Shadow.
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.beginPath();
    g.moveTo(-px * 0.018, px * 0.03);
    g.lineTo(tip, px * 0.008);
    g.lineTo(tip, -px * 0.008);
    g.lineTo(-px * 0.018, -px * 0.03);
    g.closePath();
    g.fill();
    // Blade — thin white→red like a real rally cluster.
    const needle = g.createLinearGradient(0, 0, tip, 0);
    needle.addColorStop(0, "#f6f2e8");
    needle.addColorStop(0.55, "#ffd200");
    needle.addColorStop(1, "#d41018");
    g.fillStyle = needle;
    g.beginPath();
    g.moveTo(-px * 0.016, px * 0.022);
    g.lineTo(tip, px * 0.0055);
    g.lineTo(tip, -px * 0.0055);
    g.lineTo(-px * 0.016, -px * 0.022);
    g.closePath();
    g.fill();
    g.restore();

    // Pivot boss.
    g.beginPath();
    g.arc(cx, cy, px * 0.042, 0, Math.PI * 2);
    g.fillStyle = "#161614";
    g.fill();
    g.strokeStyle = "rgba(210, 205, 190, 0.55)";
    g.lineWidth = px * 0.006;
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, px * 0.016, 0, Math.PI * 2);
    g.fillStyle = "#d8d2c4";
    g.fill();
  }

  /**
   * Digital value — plain type under the hub, no framed box.
   * @param {CanvasRenderingContext2D} g
   * @param {number} px
   * @param {number} n
   */
  _hubReadout(g, px, n) {
    const cx = px * 0.5;
    // Inside the numeral ring — not stacked on a plaque.
    const cy = px * 0.5 + px * 0.26;
    const text =
      this.spec.sub === "RPM"
        ? String(Math.max(0, n)).padStart(4, "0")
        : String(Math.max(0, n)).padStart(3, "0");
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.round(px * 0.095)}px "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
    g.fillStyle = "rgba(0,0,0,0.5)";
    g.fillText(text, cx + 1, cy + 1);
    g.fillStyle = "#ffe566";
    g.fillText(text, cx, cy);
  }
}

export function formatTime(sec) {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const whole = Math.floor(r);
  const cs = Math.floor((r - whole) * 100);
  return `${m}'${String(whole).padStart(2, "0")}"${String(cs).padStart(2, "0")}`;
}

export function formatClock(sec) {
  return formatTime(sec);
}

function ordinal(n) {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

/** Semantic surface token for HUD colour accents. */
function surfaceHudKey(idOrLabel) {
  const t = String(idOrLabel || "").toLowerCase();
  if (/tarmac|cobble|asphalt/.test(t)) return "tarmac";
  if (/gravel/.test(t)) return "gravel";
  if (/sand/.test(t)) return "sand";
  if (/mud|wet/.test(t)) return "mud";
  if (/grass/.test(t)) return "grass";
  if (/snow|ice/.test(t)) return "snow";
  return "dirt";
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/**
 * FPS and other developer overlays stay off during a real race.
 * Enable with `?debug=1` or localStorage `rally-debug=1`.
 */
function isDebugHud() {
  try {
    if (typeof location !== "undefined" && /[?&]debug=1(?:&|$)/.test(location.search)) return true;
    if (typeof localStorage !== "undefined" && localStorage.getItem("rally-debug") === "1") return true;
  } catch {
    /* private mode */
  }
  return false;
}

function prefersReducedMotion() {
  try {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

function applyScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === id);
  });
}

function curtainEl() {
  return document.getElementById("fx-curtain");
}

function waitMs(ms) {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialise fades so title → menu → load never overlap. */
let curtainQueue = Promise.resolve();

const FADE_OUT_MS = 320;
const FADE_IN_MS = 480;

/**
 * Swap menus through black. `instant: true` skips the curtain (pause resume).
 * @param {string} id
 * @param {{ instant?: boolean, outMs?: number, inMs?: number }} [opts]
 * @returns {Promise<void>}
 */
export function showScreen(id, opts = {}) {
  const current = document.querySelector(".screen.active");
  if (current && current.id === id) return Promise.resolve();
  const instant = opts.instant === true || prefersReducedMotion();
  if (instant) {
    const curtain = curtainEl();
    if (curtain) curtain.classList.remove("is-on");
    applyScreen(id);
    return Promise.resolve();
  }
  const outMs = opts.outMs != null ? opts.outMs : FADE_OUT_MS;
  const inMs = opts.inMs != null ? opts.inMs : FADE_IN_MS;
  curtainQueue = curtainQueue.then(() => fadeThroughBlack(id, outMs, inMs));
  return curtainQueue;
}

/**
 * @param {string} id
 * @param {number} outMs
 * @param {number} inMs
 */
async function fadeThroughBlack(id, outMs, inMs) {
  const el = curtainEl();
  if (!el) {
    applyScreen(id);
    return;
  }
  el.classList.add("is-on");
  applyScreen(id);
  await waitMs(outMs);
  el.classList.remove("is-on");
  await waitMs(inMs);
}

const loadUi = {
  target: 0,
  shown: 0,
  status: "",
  raf: 0,
  lastTs: 0,
  stallMs: 0,
};

function paintLoadBar(shown, status) {
  const pct = shown >= 0.999 ? 100 : Math.min(99, Math.round(shown * 100));
  const bar = document.getElementById("load-bar-fill");
  const barWrap = document.getElementById("load-bar");
  const pctEl = document.getElementById("load-pct");
  const statusEl = document.getElementById("load-status");
  if (bar) bar.style.transform = `scaleX(${Math.max(0, Math.min(1, shown))})`;
  if (barWrap) barWrap.setAttribute("aria-valuenow", String(pct));
  if (pctEl) pctEl.textContent = `${pct}%`;
  if (status && statusEl) statusEl.textContent = status;
}

function tickLoadBar(ts) {
  const dt = loadUi.lastTs ? Math.min(0.05, (ts - loadUi.lastTs) / 1000) : 0.016;
  loadUi.lastTs = ts;
  const tgt = loadUi.target;
  const gap = tgt - loadUi.shown;
  if (gap > 0.0008) {
    const rate = gap > 0.12 ? 4.2 : gap > 0.04 ? 2.6 : 1.55;
    loadUi.shown += gap * (1 - Math.exp(-rate * dt));
    loadUi.stallMs = 0;
  } else {
    loadUi.stallMs += dt * 1000;
    // Main-thread stalls (terrain rows, GLB parse) used to freeze one %.
    // Trickle toward a soft cap just ahead of the last real report.
    if (tgt < 0.992 && loadUi.stallMs > 80) {
      const cap = Math.min(0.987, tgt + 0.055);
      if (loadUi.shown < cap) {
        const remain = cap - loadUi.shown;
        const tricklePerSec = 0.022 + remain * 0.28;
        loadUi.shown = Math.min(cap, loadUi.shown + tricklePerSec * dt);
      }
    }
  }
  if (tgt >= 0.999) {
    loadUi.shown += (1 - loadUi.shown) * (1 - Math.exp(-7.5 * dt));
    if (loadUi.shown > 0.995) loadUi.shown = 1;
  }
  paintLoadBar(loadUi.shown, loadUi.status);
  const loading = document.getElementById("screen-loading");
  const active = !!(loading && loading.classList.contains("active"));
  const done = loadUi.shown >= 0.999 && tgt >= 0.999;
  if (!active || done) {
    loadUi.raf = 0;
    if (done) paintLoadBar(1, loadUi.status);
    return;
  }
  loadUi.raf = requestAnimationFrame(tickLoadBar);
}

function armLoadBar() {
  if (loadUi.raf) return;
  loadUi.lastTs = 0;
  loadUi.raf = requestAnimationFrame(tickLoadBar);
}

/**
 * @param {number} frac 0–1
 * @param {string} [status]
 */
export function setLoadingProgress(frac, status) {
  const p = Math.max(0, Math.min(1, Number(frac) || 0));
  // Never let the real target jump backwards — reports can arrive out of phase.
  if (p < loadUi.target && p < 0.999) {
    if (status) loadUi.status = status;
    return;
  }
  loadUi.target = p;
  if (status) loadUi.status = status;
  setLoadingProgress._last = p;
  armLoadBar();
}

/** Reset monotonic high-water when a new load starts. */
export function showLoadingScreen(opts = {}) {
  loadUi.target = 0;
  loadUi.shown = 0;
  loadUi.stallMs = 0;
  loadUi.status = opts.status || "Preparing course…";
  setLoadingProgress._last = 0;
  const title = document.getElementById("load-stage");
  const sub = document.getElementById("load-sub");
  const status = document.getElementById("load-status");
  if (title) title.textContent = opts.title || "LOADING STAGE";
  if (sub) sub.textContent = opts.subtitle || "";
  if (status) status.textContent = loadUi.status;
  paintLoadBar(0, loadUi.status);
  armLoadBar();
  return showScreen("screen-loading", { instant: true });
}
