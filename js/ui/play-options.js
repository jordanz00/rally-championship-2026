/**
 * Play options — help level, camera, HUD, colour vision, navigator text, auto gas,
 * smart speed, key remap, screen-reader lines, dialog focus trap.
 *
 * WHO FOR: any player, any age or skill. Open the pause menu (P / Esc).
 * WHAT: Easy = more grip help and slower rivals (default for a new player).
 *   Pro = less help. Everything is saved in localStorage.
 * HOW: edits the SAME config objects physics and AI read. Those modules import
 *   config.js at their own ?v=. If you bump them, bump VEHICLE_CFG / AI_CFG below.
 */
const VEHICLE_CFG = "../config.js?v=257";
const AI_CFG = "../config.js?v=257";
const KEY = "rally-play-opts";

const HELP = {
  easy: {
    assist: { yawAssist: 0.9, recoveryAssist: 1.9, recoverableSlide: 22, driftStability: 0.9, landingAssist: 0.8, tirePeakHold: 1.2, tireRecoverFloor: 0.56 },
    sand: { muPeak: 0.9, gripSnap: 1.48 },
    /** Keep pack speed — Easy forgives grip, not an empty road. */
    ai: { skillFloorMul: 0.88, skillCeilingMul: 0.94, maxSpeedMul: 1.85, rubberBand: 0.08 },
  },
  standard: { assist: {}, sand: {}, ai: {} },
  pro: {
    assist: { yawAssist: 0.35, recoveryAssist: 1.0, driftStability: 0.5, landingAssist: 0.35 },
    sand: {},
    ai: { skillFloorMul: 1.04, skillCeilingMul: 1.04, maxSpeedMul: 1.95, rubberBand: 0.11 },
  },
};

const CB = ["off", "rg", "by"];

/** [action, label] for the key grid. Pause / Esc stay fixed. */
const KEY_ROWS = [
  ["gas", "GAS"],
  ["brake", "BRAKE"],
  ["left", "STEER LEFT"],
  ["right", "STEER RIGHT"],
  ["handbrake", "HANDBRAKE"],
  ["shiftUp", "SHIFT UP"],
  ["shiftDown", "SHIFT DOWN"],
  ["camera", "CAMERA"],
  ["reset", "RESET CAR"],
  ["trans", "AUTO / MANUAL"],
];

function load() {
  let o = null;
  try {
    o = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch {
    o = null;
  }
  const first = !o;
  o = o || {};
  const reduced = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  return {
    // First run is Easy: the brief is "easier for everyone". A saved choice always wins.
    help: HELP[o.help] ? o.help : first ? "easy" : "standard",
    calm: o.calm != null ? !!o.calm : reduced,
    bighud: !!o.bighud,
    contrast: !!o.contrast,
    cb: CB.includes(o.cb) ? o.cb : "off",
    subs: !!o.subs,
    autogas: !!o.autogas,
    smart: !!o.smart,
  };
}

function save(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private mode */
  }
}

export async function initPlayOptions(getGame) {
  const [veh, ai] = await Promise.all([import(VEHICLE_CFG), import(AI_CFG)]);
  const A = veh.ARCADE_ASSIST;
  const SAND = veh.SURFACES && veh.SURFACES.sand;
  const AI = ai.AI;
  const baseA = { ...A };
  const baseSand = SAND ? { ...SAND } : null;
  const baseAI = { floor: AI.skillFloor, ceil: AI.skillCeiling, speed: AI.maxSpeedMul, rubber: AI.rubberBand };
  const s = load();

  const sr = document.getElementById("sr-live");
  const say = (t) => {
    if (sr) sr.textContent = t;
  };

  function applyHelp() {
    const h = HELP[s.help];
    Object.assign(A, baseA, h.assist);
    if (SAND) Object.assign(SAND, baseSand, h.sand);
    AI.skillFloor = baseAI.floor * (h.ai.skillFloorMul || 1);
    AI.skillCeiling = baseAI.ceil * (h.ai.skillCeilingMul || 1);
    AI.maxSpeedMul = h.ai.maxSpeedMul != null ? h.ai.maxSpeedMul : baseAI.speed;
    AI.rubberBand = h.ai.rubberBand != null ? h.ai.rubberBand : baseAI.rubber;
  }

  /** Runs every race frame right after input.poll. */
  function assistHook(input, player) {
    if (!player) return;
    if (s.autogas && input.brake < 0.05) input.throttle = 1;
    if (s.smart && input.handbrake < 0.1 && input.throttle > 0 && player.onGround !== false) {
      const sp = player.speed || 0;
      const turn = Math.abs(input.steer);
      if (sp > 24 && turn > 0.6) {
        // Hard turn at speed: lift and shave a little speed. Never a full stop.
        input.throttle *= 0.35;
        if (sp > 34 && input.brake < 0.2) input.brake = 0.22;
      }
    }
  }

  function applyView() {
    const b = document.body;
    b.classList.toggle("a11y-big-hud", s.bighud);
    b.classList.toggle("a11y-contrast", s.contrast);
    b.classList.toggle("a11y-subs", s.subs);
    b.classList.toggle("cb-rg", s.cb === "rg");
    b.classList.toggle("cb-by", s.cb === "by");
    syncGame();
  }

  function syncGame() {
    const g = getGame();
    if (!g) return;
    g._calmCam = s.calm;
    g._subtitles = s.subs;
    g._assistHook = s.autogas || s.smart ? assistHook : null;
  }

  const help = document.getElementById("opt-help");
  if (help) {
    help.value = s.help;
    help.addEventListener("change", () => {
      s.help = HELP[help.value] ? help.value : "standard";
      applyHelp();
      save(s);
      say("Driving help " + s.help);
    });
  }
  const cbSel = document.getElementById("opt-cb");
  if (cbSel) {
    cbSel.value = s.cb;
    cbSel.addEventListener("change", () => {
      s.cb = CB.includes(cbSel.value) ? cbSel.value : "off";
      applyView();
      save(s);
      say("Colour vision " + s.cb);
    });
  }
  const toggles = [
    ["opt-calm", "calm", "Calm camera"],
    ["opt-bighud", "bighud", "Big HUD"],
    ["opt-contrast", "contrast", "High contrast"],
    ["opt-subs", "subs", "Navigator text"],
    ["opt-autogas", "autogas", "Auto gas"],
    ["opt-smart", "smart", "Smart speed"],
  ];
  for (const [id, key, label] of toggles) {
    const el = document.getElementById(id);
    const val = document.getElementById(id + "-val");
    if (!el) continue;
    el.checked = !!s[key];
    if (val) val.textContent = s[key] ? "ON" : "OFF";
    el.addEventListener("change", () => {
      s[key] = !!el.checked;
      if (val) val.textContent = s[key] ? "ON" : "OFF";
      applyView();
      save(s);
      say(label + (s[key] ? " on" : " off"));
    });
  }

  // ---- Key remap -------------------------------------------------------
  const grid = document.getElementById("key-grid");
  let listening = null;
  function paintKeys() {
    const g = getGame();
    if (!grid || !g || !g.input) return;
    for (const [action, label] of KEY_ROWS) {
      const btn = grid.querySelector('[data-action="' + action + '"]');
      if (btn) btn.textContent = label + " · " + g.input.keyLabel(action);
    }
  }
  if (grid) {
    for (const [action, label] of KEY_ROWS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.action = action;
      btn.textContent = label;
      btn.setAttribute("aria-label", "Rebind " + label + ". Press to change, then press a key.");
      btn.addEventListener("click", () => {
        if (listening) listening.classList.remove("listening");
        listening = btn;
        btn.classList.add("listening");
        btn.textContent = label + " · press a key";
        say("Press the new key for " + label);
      });
      grid.appendChild(btn);
    }
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "key-reset";
    reset.textContent = "RESET KEYS";
    reset.addEventListener("click", () => {
      const g = getGame();
      if (g && g.input) g.input.resetKeys();
      paintKeys();
      say("Keys reset");
    });
    grid.appendChild(reset);
    // Capture phase: swallow the key before Input sees it.
    window.addEventListener(
      "keydown",
      (e) => {
        if (!listening) return;
        e.preventDefault();
        e.stopPropagation();
        const btn = listening;
        const g = getGame();
        const ok = g && g.input && g.input.setKey(btn.dataset.action, e.key);
        listening = null;
        btn.classList.remove("listening");
        say(ok ? "Key set" : "That key is not allowed");
        paintKeys();
      },
      true
    );
    document.getElementById("play-opts")?.addEventListener("toggle", paintKeys);
  }

  applyHelp();
  applyView();

  // ---- Dialog focus trap + restore ------------------------------------
  const dialogs = [...document.querySelectorAll(".screen.screen-ui")];
  const returnTo = new WeakMap();
  const focusables = (root) =>
    [...root.querySelectorAll('button, select, input, summary, [href], [tabindex]:not([tabindex="-1"])')].filter(
      (el) => !el.disabled && el.offsetParent !== null
    );
  const activeDialog = () => dialogs.find((d) => d.classList.contains("active")) || null;
  const watch = new MutationObserver((list) => {
    for (const m of list) {
      const d = m.target;
      if (d.classList.contains("active")) {
        if (!returnTo.has(d)) returnTo.set(d, document.activeElement);
        if (!d.contains(document.activeElement)) {
          const first = d.querySelector("[autofocus], .ui-card") || focusables(d)[0];
          if (first) first.focus({ preventScroll: true });
        }
      } else if (returnTo.has(d)) {
        const back = returnTo.get(d);
        returnTo.delete(d);
        if (back && back.focus && document.contains(back) && !activeDialog()) back.focus({ preventScroll: true });
      }
    }
  });
  for (const d of dialogs) watch.observe(d, { attributes: true, attributeFilter: ["class"] });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const d = activeDialog();
    if (!d) return;
    const list = focusables(d);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (!d.contains(document.activeElement)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // ---- Screen-reader lines: state changes only (4 Hz poll) -------------
  let last = "";
  const lines = {
    countdown: "Get ready. Race starts soon.",
    race: "Go.",
    paused: "Paused. Play options are in this menu.",
    result: "Stage complete.",
  };
  setInterval(() => {
    const g = getGame();
    if (!g) return;
    if (g._calmCam !== s.calm || g._subtitles !== s.subs) syncGame();
    if (!!g._assistHook !== (s.autogas || s.smart)) syncGame();
    if (g.state !== last) {
      last = g.state;
      if (lines[last]) say(lines[last]);
    }
  }, 250);
}
