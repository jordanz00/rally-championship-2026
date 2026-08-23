/**
 * Game loop — 60 Hz physics, modern arcade framebuffer, championship flow.
 *
 * WHO THIS IS FOR: the entry point.
 * WHAT IT DOES: menus, race start, locked-step physics, camera, HUD, AI pack.
 * HOW IT CONNECTS: main.js constructs RallyGame after DOM is ready.
 */

import * as THREE from "../vendor/three.module.js";
import {
  FIXED_DT,
  MAX_SUBSTEPS,
  CAMERA,
  CHAMPIONSHIP,
  CARS,
  PACE,
  LIGHTING,
  TUNNEL,
  GFX,
  VISUAL,
} from "./config.js?v=122";
import { Input } from "./input.js?v=37";
import { Vehicle } from "./physics/vehicle.js?v=67";
import { getSurface } from "./physics/surfaces.js?v=43";
import { COURSES, COURSE_ORDER } from "./tracks/courses.js?v=59";
import { prepareCelica, loadCelicaFromFile, watchForCelicaFile, isGltfCar, garageLoadSummary, createPlayerCar, createRivalCar, applyWheelPose, setBrakeLights, setHeadlights, setCockpitView, updateCockpit, updatePovHudFade, setCockpitMirrorMap, getPovRig, GARAGE_CAR_IDS } from "./cars/celica.js?v=100";
import { updateCockpitMotion } from "./cars/cockpit-anim.js?v=1";
import { Track } from "./tracks/track.js?v=162";
import { preparePropKit } from "./tracks/prop-kit.js?v=16";
import { Opponent } from "./ai.js?v=91";
import { RallyAudio } from "./audio/engine.js?v=48";
import { zoneFromSample } from "./audio/reverb-zones.js?v=1";
import { CoDriver } from "./audio/codriver.js?v=28";
import { Hud, showScreen, showLoadingScreen, setLoadingProgress, formatTime } from "./ui/hud.js?v=26";
import { Dust, TireMarks } from "./effects.js?v=52";
import { resolveVehicleCollisions } from "./physics/collide.js?v=32";
import { createSky, applySky, tickSky } from "./sky.js?v=15";
import { applyEnvMap, setShowcaseReflectivity } from "./gfx/pbr.js?v=21";
import { updateCameraFade } from "./gfx/occlusion-fade.js?v=4";
import { PhotoRealPost } from "./gfx/postfx.js?v=8";
import { createPerfTier } from "./gfx/perf-tier.js?v=1";
import { accumulateDamage, applyDamageVisuals, resetDamageVisuals } from "./assets/damage.js?v=1";
import { GhostRecorder, GhostPlayer } from "./telemetry/ghost.js?v=1";
import { LiveTelemetry } from "./telemetry/live-qa.js?v=1";
import {
  applyStageLights,
  configurePBRRenderer,
  skyPmremCapture,
  updateRaceLightFollow,
  updateShadowFrustum,
} from "./gfx/lighting-rig.js?v=2";
import { shadowGeometry, carShadowMaterial } from "./tracks/trees.js?v=28";

/** Consecutive failing frames before we stop logging and show the error. */
const FRAME_FAIL_LIMIT = 30;

/**
 * Seconds of warning the co-driver aims to give. Ibrahim's calls were useful
 * because they arrived while you could still lift; 2.6 s covers speech latency
 * plus a lift-and-turn-in at Desert pace.
 */
const CODRIVER_LEAD_SECONDS = 2.6;

/** Celica, Delta, Stratos — every chassis the garage watcher waits on. */
const GARAGE_CAR_COUNT = GARAGE_CAR_IDS.length;

export class RallyGame {
  constructor() {
    this.state = window.__rallyLeftTitle ? "menu" : "title";
    this.mode = "championship";
    this.courseId = "desert";
    this.carId = "celica";
    this._bindUi();

    this.input = new Input();
    this.hud = new Hud();
    this.audio = new RallyAudio();
    this.codriver = new CoDriver();
    this.ghostRecorder = new GhostRecorder();
    this.telemetry = new LiveTelemetry();
    this.ghostPlayer = null;
    this.ghostMesh = null;
    this.perfTier = null;
    this.stageIndex = 0;
    this.champOrder = COURSE_ORDER.slice();
    this.champPlace = CHAMPIONSHIP.startPosition;
    this.carId = "celica";
    this.stratosUnlocked = true;
    this.lakesideUnlocked = false;
    try {
      // Legacy key still unlocks Lakeside; Stratos is starter content now.
      if (localStorage.getItem("rally-stratos") === "1") {
        this.lakesideUnlocked = true;
      }
      this.lakesideUnlocked =
        this.lakesideUnlocked || localStorage.getItem("rally-lakeside") === "1";
    } catch {
      /* private mode */
    }
    this.lap = 1;
    this.paceLine = "";
    this._pendingNextCourse = null;
    this.menuIndex = 0;
    this.accum = 0;
    this._physAccum = 0;
    this.last = performance.now();
    this.fps = 60;
    this._fpsFrames = 0;
    this._fpsT = 0;
    /** 1 = full DPR; drops toward GFX.minPixelRatio when present cost exceeds 30 fps floor. */
    this._perfDprScale = 1;
    this._lastPresent = 0;
    this._minimapT = 0;
    this.raceTime = 0;
    this.timeLeft = 90;
    this.nextCp = 0;
    this.camMode = CAMERA.defaultMode;
    this.countdown = 0;
    this._gridCamHold = 0;
    this._countShown = "";
    this._mat = new THREE.Matrix4();
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this._camLookSmooth = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._camUp = new THREE.Vector3(0, 1, 0);
    this._eyeLocal = new THREE.Vector3();
    this._lookLocal = new THREE.Vector3();
    this._mirrorEye = new THREE.Vector3();
    this._mirrorLook = new THREE.Vector3();
    this._blobQuery = {};
    this._camSnap = true;
    this._camYaw = 0;
    this._camFovSmooth = CAMERA.fov || 60;
    this._camNearSmooth = 0.2;
    this._camProjDirty = true;
    this._cockpitLive = false;
    /** POV HUD fade 0..1 — gauges + mirror scale in with the seat. */
    this._povHudFade = 0;
    /** Keep large HTML gauges off until the pull-out from POV has settled. */
    this._gaugeHoldPov = false;
    /** Seconds remaining of intentional C-key blend (no hard snaps). */
    this._camBlendT = 0;
    this._shake = 0;
    this._camKickY = 0;
    this._camKickLat = 0;
    this._camFovKick = 0;
    this._wasAir = false;
    this._pack = [];
    this._blobPack = [];
    this._qLight = {};
    this._mirrorTick = 0;
    /** Frames to skip rear-mirror capture after entering POV — spreads GPU cost. */
    this._mirrorDefer = 0;
    this._shadowTick = 0;
    this._skyEnvCache = Object.create(null);
    this._audioState = {
      rpm: 0,
      throttle: 0,
      slip: 0,
      speed: 0,
      surfaceDust: 0,
      surfaceId: "dirt",
      driftAngle: 0,
      onGround: true,
      bump: 0,
      shock: 0,
      carId: "celica",
      gear: 1,
      active: true,
      reverbZone: "open",
      inTunnel: false,
    };
    this._hudState = {
      speedKmh: 0,
      gear: 1,
      rpm: 900,
      redline: 7500,
      position: 15,
      timeLeft: 90,
      lapTime: 0,
      surface: "",
      courseName: "",
      courseSub: "",
      fps: 60,
      pace: "",
      trans: "AT",
      onGround: true,
    };

    this._bindVolume();
    showScreen(this.state === "menu" ? "screen-menu" : "screen-title");
    this.renderer = null;
    this.scene = null;
    this.player = null;
    this.playerMesh = null;
    /** @type {Record<string, import("three").Group>} */
    this._carMeshPool = Object.create(null);
    /** @type {Record<string, import("./tracks/track.js").Track>} */
    this._trackCache = Object.create(null);
    this._preloadToken = null;
    /** Course id currently building in the background. */
    this._preloadBuilding = null;
    /** @type {Promise<import("./tracks/track.js").Track|null>|null} */
    this._preloadPromise = null;
    /** Background build queue (title warm + championship lookahead). */
    this._preloadQueue = [];
    /** Max stages kept hot in RAM (full cup when possible). */
    this._preloadMax = 4;
    /** Next championship stage pinned against cache eviction. */
    this._pinnedPreloadId = null;
    /** True once we've kicked off preload for the upcoming stage this lap. */
    this._nextStagePreloadArmed = false;
    /** @type {{ courseId: string, frac: number, status: string }|null} */
    this._preloadProgress = null;
    this._loadGen = 0;
    this.opponents = [];
    this.track = null;
    this.dust = null;
    this.tireMarks = null;
    this.sky = null;
    this._gfxFailed = false;
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    // Bind Start first, paint the splash, then bring up a light attract scene.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!this._bootGfx()) return;
        if (this.state === "title" || this.state === "menu") this._setupTitleStage();
        this._warmRaceSystems();
        this._warmCarMeshes();
      });
    });
    // Stage geometry does not need WebGL — start Desert while the player reads the splash.
    this._startBackgroundWarm();
  }

  /**
   * WebGL waits until after PRESS START. Sky IBL on boot froze the tab
   * so the splash painted but clicks never ran.
   */
  _bootGfx() {
    if (this.renderer) return true;
    if (this._gfxFailed) return false;
    try {
      this._initRenderer();
      return true;
    } catch (err) {
      this._gfxFailed = true;
      console.error(err);
      this._fatal("Graphics failed to start.", err);
      return false;
    }
  }

  /**
   * Put an engine failure on screen. Silent failures are the single worst
   * bug class here: the menus keep responding while nothing can ever race.
   */
  _fatal(label, err) {
    const el = document.getElementById("boot-error");
    if (!el) return;
    el.hidden = false;
    el.textContent = `${label}\n\n${String(err && err.stack ? err.stack : err)}`;
  }

  _initRenderer() {
    const host = document.getElementById("game-view");
    this.renderer = new THREE.WebGLRenderer({
      // Post path renders to an RT — canvas MSAA does not help and costs GPU.
      antialias: !(VISUAL.postFx && (VISUAL.tier || 0) >= 9),
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    configurePBRRenderer(this.renderer);
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.autoClear = true;
    this.canvas = this.renderer.domElement;
    this.canvas.className = "saturn-canvas";
    this.canvas.style.pointerEvents = "none";
    host.appendChild(this.canvas);

    this.post = new PhotoRealPost(this.renderer);
    this.post.syncFromConfig();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x4a7ab8);
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 16 / 9, 0.18, 1400);
    this.scene.add(this.camera);
    this._onResize = this._onResize.bind(this);
    window.addEventListener("resize", this._onResize);
    this._onResize();
    this._initMirror();
    this._initEnv();

    this._sunDir = new THREE.Vector3(0.6, 0.72, 0.28).normalize();
    this.hemi = new THREE.HemisphereLight(0x8eb8e8, 0xa07842, 0.26);
    this.sun = new THREE.DirectionalLight(0xffe4b0, 1.65);
    this.sun.castShadow = false;
    this.sun.shadow.mapSize.set(GFX.shadowMap, GFX.shadowMap);
    this.sun.shadow.camera.near = 4;
    this.sun.shadow.camera.far = 120;
    const ext = GFX.shadowExtent;
    this.sun.shadow.camera.left = -ext;
    this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.bottom = -ext;
    const cinema = (VISUAL.tier || 0) >= 13 || VISUAL.cinemaRealism === true;
    this.sun.shadow.bias = cinema ? -0.00018 : -0.00012;
    this.sun.shadow.normalBias = cinema ? 0.045 : 0.038;
    this.sun.shadow.radius = cinema ? 4.2 : 3.4;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.fill = new THREE.DirectionalLight(0x8eb4dc, 0.12);
    this.fill.position.set(-30, 22, -18);
    this._skyRim = new THREE.DirectionalLight(0xb8d4f0, 0);
    this._skyRim.castShadow = false;
    this.ambient = new THREE.AmbientLight(0xffe2b8, 0.06);
    this.caveLight = new THREE.SpotLight(0xffe2b8, 0, TUNNEL.caveDistance || 52, Math.PI / 2.35, 0.62, TUNNEL.caveDecay || 1.15);
    this.caveLight.castShadow = false;
    this.caveLight.shadow.mapSize.set(512, 512);
    this.caveLight.shadow.camera.near = 1.2;
    this.caveLight.shadow.camera.far = 22;
    this.caveLight.shadow.bias = -0.00045;
    this.caveLight.shadow.normalBias = 0.014;
    // Fixed pool — never add/remove lights, never toggle `visible`. three.js
    // recompiles every material when NUM_POINT_LIGHTS changes, which was the
    // one-frame glitch at the Desert tunnel mouth. Fourteen lights are spaced
    // along the whole bore and stay on; they do not hop to the car.
    this._wallLights = [];
    const wallDist = TUNNEL.wallDistance || 68;
    const wallDecay = TUNNEL.wallDecay || 0.95;
    const wallHex = TUNNEL.wallColor != null ? TUNNEL.wallColor : 0xffd9a0;
    for (let i = 0; i < 14; i++) {
      const lamp = new THREE.PointLight(wallHex, 0, wallDist, wallDecay);
      lamp.castShadow = false;
      this._wallLights.push(lamp);
    }
    this._titleRim = new THREE.DirectionalLight(0xc8e0ff, 0);
    this._titleKick = new THREE.PointLight(0xfff4d8, 0, 30, 1.55);
    this._titleSunDir = new THREE.Vector3(0.48, 0.82, 0.32).normalize();
    this._titleReflectTick = 0;
    this._titleShowcase = false;
    this._tunnelBlend = 0;
    this._fogColor = new THREE.Color();
    this._tunnelFog = new THREE.Color(TUNNEL.fog != null ? TUNNEL.fog : 0x5a4030);
    this.scene.add(
      this.hemi,
      this.sun,
      this.sun.target,
      this.fill,
      this.fill.target,
      this._skyRim,
      this._skyRim.target,
      this.ambient,
      this.caveLight,
      this.caveLight.target,
      ...this._wallLights,
      this._titleRim,
      this._titleRim.target,
      this._titleKick
    );

    this.sky = null;
    this.player = new Vehicle(CARS[this.carId]);
    const onGarageReady = () => {
      this._syncCarSelectButtons();
      for (const cid of Object.keys(this._carMeshPool)) this._invalidateCarMesh(cid);
      const loaded = isGltfCar();
      if (Array.isArray(loaded) && loaded.length && !isGltfCar(this.carId)) {
        this.carId = loaded[0];
        this.player = new Vehicle(CARS[this.carId]);
        this.audio.setCar(this.carId);
      }
      if (isGltfCar(this.carId)) {
        try {
          if (!this.playerMesh) {
            this.playerMesh = createPlayerCar(this.carId);
            this.scene.add(this.playerMesh);
            setCockpitMirrorMap(this.playerMesh, this._mirrorRT.texture);
            this._applyCockpitCam();
            this._initContactBlobs();
            if (this.state === "title" || this.state === "menu") {
              if (this._titleShowcase) this._applyTitleCarShowcase(true);
              this._titleCam(0);
            }
          } else {
            this._swapPlayerCar(this.carId);
          }
        } catch (err) {
          console.error(err);
          this._fatal("Car model failed to load.", err);
        }
      }
      const el = document.getElementById("celica-status");
      if (el) el.textContent = garageStatus();
      this._stopGarageWatchIfComplete();
    };
    prepareCelica().then(onGarageReady);
    preparePropKit().catch((err) => console.warn("[props]", err));
    this._stopCelicaWatch = watchForCelicaFile(onGarageReady);
  }

  /** Disable car picks until that chassis GLB is on disk and loaded. */
  _syncCarSelectButtons() {
    document.querySelectorAll("[data-car]").forEach((btn) => {
      const id = btn.dataset.car;
      if (!id) return;
      const ready = isGltfCar(id);
      btn.disabled = !ready;
      if (!ready) btn.title = `Load assets/${id}/*.glb to unlock this car`;
      else btn.removeAttribute("title");
    });
  }

  /**
   * The garage watcher re-fetches every missing car GLB every 1.5s, forever —
   * including mid-race. A missing model therefore cost a burst of failed
   * requests on a loop. Once all three chassis are real GLBs there is nothing
   * left to wait for, so stop polling.
   */
  _stopGarageWatchIfComplete() {
    if (!this._stopCelicaWatch) return;
    const loaded = isGltfCar();
    if (!Array.isArray(loaded) || loaded.length < GARAGE_CAR_COUNT) return;
    this._pauseGarageWatch();
  }

  /** Stop GLB polling — title/garage only; never run mid-race. */
  _pauseGarageWatch() {
    if (this._stopCelicaWatch) {
      this._stopCelicaWatch();
      this._stopCelicaWatch = null;
    }
  }

  _replacePlayerCar(mesh) {
    if (this.playerMesh) {
      setCockpitView(this.playerMesh, false, this.camera);
      this.scene.remove(this.playerMesh);
    }
    this.playerMesh = mesh;
    this.scene.add(mesh);
    setCockpitMirrorMap(mesh, this._mirrorRT.texture);
    if (this.scene.environment) {
      if (this._titleShowcase) this._applyTitleCarShowcase(true);
      else applyEnvMap(mesh, this.scene.environment, VISUAL.carEnvIntensity ?? 0.52);
    }
    this._applyCockpitCam();
  }

  /**
   * Build each hero car once, then swap visibility — re-cloning a 7 MB GLB
   * on every garage click was freezing the UI for seconds.
   * @param {string} id
   * @returns {import("three").Group}
   */
  _ensureCarMesh(id) {
    if (!isGltfCar(id)) return null;
    if (!this._carMeshPool[id]) {
      const mesh = createPlayerCar(id);
      mesh.visible = false;
      this._carMeshPool[id] = mesh;
      if (this.scene) this.scene.add(mesh);
    }
    return this._carMeshPool[id];
  }

  /** @param {string} id */
  _swapPlayerCar(id) {
    const next = this._ensureCarMesh(id);
    if (!next) return;
    if (this.playerMesh && this.playerMesh !== next) {
      setCockpitView(this.playerMesh, false, this.camera);
      this.playerMesh.visible = false;
    }
    this.playerMesh = next;
    next.visible = true;
    if (this._mirrorRT) setCockpitMirrorMap(next, this._mirrorRT.texture);
    if (this.scene.environment) {
      if (this._titleShowcase) this._applyTitleCarShowcase(true);
      else applyEnvMap(next, this.scene.environment, VISUAL.carEnvIntensity ?? 0.52);
    }
    this._applyCockpitCam();
  }

  /** Drop-in GLB invalidates the cached hero shell for that chassis. */
  _invalidateCarMesh(id) {
    const mesh = this._carMeshPool[id];
    if (mesh) {
      if (this.playerMesh === mesh) this.playerMesh = null;
      if (this.scene) this.scene.remove(mesh);
      delete this._carMeshPool[id];
    }
  }

  /**
   * Kick prop kit + championship stages while the title/menu is still open.
   * Starts immediately after first paint — idle timeouts left Desert cold
   * until the player had already opened Championship.
   */
  _startBackgroundWarm() {
    const kick = () => {
      if (this.state === "race" || this.state === "countdown" || this.state === "loading") return;
      this._prefetchStageBytes();
      preparePropKit()
        .then(() => {
          if (this.state === "race" || this.state === "countdown" || this.state === "loading") return;
          // Desert first (championship / default), then the rest of the cup.
          this._scheduleTrackPreload(this.courseId || "desert", { priority: true });
          for (const id of COURSE_ORDER) {
            if (id !== (this.courseId || "desert")) this._scheduleTrackPreload(id);
          }
        })
        .catch((err) => console.warn("[warm] prop kit", err));
    };
    // Next frame after construct — keep the splash clickable, then go hard.
    requestAnimationFrame(() => {
      requestAnimationFrame(kick);
    });
  }

  /**
   * HTTP-cache stage music + any linked beds so the first race decode is a hit.
   * Safe without AudioContext / user gesture.
   */
  _prefetchStageBytes() {
    if (this._bytesPrefetched) return;
    this._bytesPrefetched = true;
    const urls = [
      "assets/music/desert.mp3?v=4",
      "assets/music/forest.mp3?v=4",
      "assets/music/mountain.mp3?v=4",
      "assets/music/lakeside.mp3?v=4",
      "assets/music/result.mp3?v=4",
    ];
    for (const url of urls) {
      fetch(url, { mode: "cors", credentials: "same-origin" }).catch(() => {});
    }
  }

  /**
   * Dust / tire marks allocate GPU buffers — build them once during idle so
   * the loading screen does not hitch on first race.
   */
  _warmRaceSystems() {
    if (!this.scene) return;
    try {
      if (!this.dust) this.dust = new Dust(this.scene);
      if (!this.tireMarks) this.tireMarks = new TireMarks(this.scene);
    } catch (err) {
      console.warn("[warm] race systems", err);
    }
  }

  /** @param {string} courseId */
  _isTrackReady(courseId) {
    return !!(courseId && this._trackCache[courseId]);
  }

  /**
   * Drop oldest cached stages when over budget. Never evict `keepId`.
   * @param {string} [keepId]
   */
  _pruneTrackCache(keepId) {
    const pin = this._pinnedPreloadId;
    let keys = Object.keys(this._trackCache);
    while (keys.length > this._preloadMax) {
      const drop =
        keys.find((k) => k !== keepId && k !== pin) || keys.find((k) => k !== keepId) || keys[0];
      if (!drop || drop === keepId || drop === pin) break;
      try {
        this._trackCache[drop].dispose();
      } catch {
        /* ignore */
      }
      delete this._trackCache[drop];
      keys = Object.keys(this._trackCache);
    }
  }

  /**
   * Build a stage in the background (async, cancellable). Ready cache is
   * consumed by `_loadTrackAsync` so the first race can skip terrain work.
   * @param {string} courseId
   * @param {{ priority?: boolean }} [opts]
   */
  _scheduleTrackPreload(courseId, opts = {}) {
    if (!courseId || !COURSES[courseId]) return;
    if (this._trackCache[courseId]) return;
    if (this.track && this.track.id === courseId && this.state !== "title" && this.state !== "menu") {
      return;
    }

    const priority = !!opts.priority;
    // Deduplicate queue.
    this._preloadQueue = this._preloadQueue.filter((id) => id !== courseId);
    if (priority) this._preloadQueue.unshift(courseId);
    else this._preloadQueue.push(courseId);

    // Priority pick cancels a non-matching in-flight build so the hot course wins.
    if (priority && this._preloadBuilding && this._preloadBuilding !== courseId) {
      const cancelled = this._preloadBuilding;
      this._preloadToken = Symbol("preload-cancel");
      // Keep building/promise set until the cancelled job's finally clears them
      // and pumps the queue — starting a second Track.create in parallel OOMs.
      if (cancelled && !this._trackCache[cancelled] && !this._preloadQueue.includes(cancelled)) {
        this._preloadQueue.push(cancelled);
      }
    }

    this._pumpPreloadQueue();
  }

  /**
   * Championship stage that follows the current grid slot (if any).
   * @returns {string|null}
   */
  _nextChampCourseId() {
    if (this.mode !== "championship" || !this.champOrder.length) return null;
    const nextIdx = this.stageIndex + 1;
    if (nextIdx >= this.champOrder.length) return null;
    return this.champOrder[nextIdx];
  }

  /**
   * Start (or promote) background build for the upcoming championship stage.
   * Safe to call multiple times — only arms once per race until the next stage loads.
   * @param {string} [reason]
   */
  _armNextStagePreload(reason) {
    if (this._nextStagePreloadArmed) return;
    const nextId = this._pendingNextCourse || this._nextChampCourseId();
    if (!nextId || !COURSES[nextId]) return;
    if (this._isTrackReady(nextId)) {
      this._nextStagePreloadArmed = true;
      return;
    }
    this._nextStagePreloadArmed = true;
    this._pinnedPreloadId = nextId;
    this._scheduleTrackPreload(nextId, { priority: true });
    if (reason) console.debug("[preload] next stage", nextId, "—", reason);
  }

  /**
   * At the halfway checkpoint (or 50% lap progress) start loading the next stage.
   */
  _maybePreloadNextStageAtHalfway() {
    if (this.mode !== "championship" || this.state !== "race") return;
    if (this._nextStagePreloadArmed || !this.track || !this.player) return;

    const half = this.track.length * 0.5;
    const cps = this.track.checkpoints || [];
    let triggerAt = half;
    if (cps.length > 0) {
      triggerAt = cps.reduce(
        (best, cp) => (Math.abs(cp - half) < Math.abs(best - half) ? cp : best),
        cps[0]
      );
    }
    if (this.player.progress >= triggerAt * 0.97 || this.player.progress >= half) {
      this._armNextStagePreload("halfway");
    }
  }

  /** Start the next queued stage build if the worker is free. */
  _pumpPreloadQueue() {
    if (this._preloadBuilding || this._preloadPromise) return;
    while (this._preloadQueue.length && this._trackCache[this._preloadQueue[0]]) {
      this._preloadQueue.shift();
    }
    const courseId = this._preloadQueue.shift();
    if (!courseId) return;
    if (this._trackCache[courseId]) {
      this._pumpPreloadQueue();
      return;
    }

    const token = Symbol("preload");
    this._preloadToken = token;
    this._preloadBuilding = courseId;

    const run = async () => {
      try {
        await preparePropKit();
        if (this._preloadToken !== token) return null;
        await new Promise((r) => requestAnimationFrame(r));
        if (this._preloadToken !== token) return null;

        const track = await Track.create(COURSES[courseId], (p, msg) => {
          if (this._preloadToken !== token) return;
          this._preloadProgress = {
            courseId,
            frac: Math.max(0, Math.min(1, p)),
            status: msg || "Building course…",
          };
        });
        if (this._preloadToken !== token) {
          track.dispose();
          return null;
        }
        this._trackCache[courseId] = track;
        this._pruneTrackCache(courseId);
        return track;
      } catch (err) {
        console.warn("[preload] track build failed", err);
        return null;
      } finally {
        if (this._preloadToken === token) {
          this._preloadToken = null;
          this._preloadBuilding = null;
          this._preloadPromise = null;
          this._preloadProgress = null;
        }
        // Continue the queue during title/menu/result and mid-race lookahead.
        if (
          this.state === "title" ||
          this.state === "menu" ||
          this.state === "result" ||
          this.state === "race" ||
          this.state === "countdown" ||
          this.state === "loading"
        ) {
          queueMicrotask(() => this._pumpPreloadQueue());
        }
      }
    };

    // Start on the next frame — no multi-second idle delay.
    this._preloadPromise = new Promise((resolve) => {
      requestAnimationFrame(() => {
        run().then(resolve);
      });
    });
  }

  /**
   * If a matching background build is in flight, wait for it instead of
   * starting a second Track.create on the loading screen.
   * @param {string} courseId
   * @param {(frac: number, status: string) => void} [report]
   */
  async _awaitTrackPreload(courseId, report) {
    if (this._trackCache[courseId]) return;

    const waitWithProgress = async () => {
      while (!this._trackCache[courseId]) {
        const prog = this._preloadProgress;
        if (report) {
          if (prog && prog.courseId === courseId) {
            report(0.08 + prog.frac * 0.84, prog.status);
          } else {
            report(0.12, "Finishing background stage…");
          }
        }
        if (!this._preloadPromise || this._preloadBuilding !== courseId) break;
        await Promise.race([
          this._preloadPromise,
          new Promise((r) => requestAnimationFrame(r)),
        ]);
      }
      if (!this._trackCache[courseId] && this._preloadPromise && this._preloadBuilding === courseId) {
        await this._preloadPromise;
      }
    };

    if (this._preloadBuilding === courseId && this._preloadPromise) {
      await waitWithProgress();
      return;
    }
    // Promote to front of queue and wait if we asked for a cold stage mid-warm.
    if (this._preloadQueue.includes(courseId) || this._preloadBuilding) {
      this._scheduleTrackPreload(courseId, { priority: true });
      if (this._preloadBuilding === courseId && this._preloadPromise) {
        await waitWithProgress();
      }
    }
  }

  /** Warm hero meshes so car select / first race does not hitch on clone. */
  _warmCarMeshes() {
    if (!this.renderer) return;
    this._syncCarSelectButtons();
    const ids = ["celica", "delta", "stratos"];
    const ready = ids.filter((id) => isGltfCar(id));
    let i = 0;
    const step = () => {
      if (this.state === "race" || this.state === "countdown" || this.state === "loading") return;
      if (i >= ready.length) return;
      this._ensureCarMesh(ready[i++]);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  _bindUi() {
    document.querySelectorAll("[data-menu]").forEach((btn) => {
      btn.addEventListener("click", () => this._onMenu(btn.dataset.menu));
    });
    document.querySelectorAll("[data-course]").forEach((btn) => {
      const warm = () => {
        const id = btn.dataset.course;
        if (id) this._scheduleTrackPreload(id, { priority: true });
      };
      btn.addEventListener("pointerenter", warm);
      btn.addEventListener("focus", warm);
      btn.addEventListener("click", () => {
        this.courseId = btn.dataset.course;
        this._beginRace(this.courseId);
      });
    });
    document.querySelectorAll("[data-car]").forEach((btn) => {
      btn.addEventListener("click", () => this._pickCar(btn.dataset.car));
    });
    const start = document.getElementById("btn-start");
    if (start) start.addEventListener("click", () => this._leaveTitle());
    const title = document.getElementById("screen-title");
    if (title) {
      title.addEventListener("click", (e) => {
        if (e.target.closest("button, input, label, a, details, summary, #celica-drop")) return;
        this._leaveTitle();
      });
    }
    const picker = document.getElementById("celica-file");
    if (picker) {
      picker.addEventListener("change", async () => {
        const file = picker.files && picker.files[0];
        if (!file) return;
        try {
          await loadCelicaFromFile(file);
          this._invalidateCarMesh(this.carId);
          this._swapPlayerCar(this.carId);
          const el = document.getElementById("celica-status");
          if (el) el.textContent = garageStatus();
        } catch (err) {
          console.error(err);
          alert("Could not read that 3D file. Use the Sketchfab GLB download.");
        }
      });
    }
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", async (e) => {
      e.preventDefault();
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (!file) return;
      const n = file.name.toLowerCase();
      if (!n.endsWith(".glb") && !n.endsWith(".gltf")) return;
      try {
        await loadCelicaFromFile(file);
        this._invalidateCarMesh(this.carId);
        this._swapPlayerCar(this.carId);
        const el = document.getElementById("celica-status");
        if (el) el.textContent = garageStatus();
      } catch (err) {
        console.error(err);
      }
    });
    window.addEventListener(
      "keydown",
      (e) => {
        if (this.state !== "title") return;
        if (e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter" || e.key === " ") {
          e.preventDefault();
          this._leaveTitle();
        }
      },
      true
    );
  }

  /**
   * Pause-menu MUSIC / SFX / NAVIGATOR faders. Levels persist in localStorage.
   */
  _bindVolume() {
    const music = document.getElementById("vol-music");
    const sfx = document.getElementById("vol-sfx");
    const nav = document.getElementById("vol-nav");
    const musicVal = document.getElementById("vol-music-val");
    const sfxVal = document.getElementById("vol-sfx-val");
    const navVal = document.getElementById("vol-nav-val");
    const label = (el, v) => {
      if (el) el.textContent = String(Math.round(v * 100));
    };
    if (music) {
      music.value = String(Math.round(this.audio.musicVol * 100));
      label(musicVal, this.audio.musicVol);
      music.addEventListener("input", () => {
        const v = Number(music.value) / 100;
        this.audio.unlock();
        this.audio.setMusicVolume(v);
        label(musicVal, v);
      });
    }
    if (sfx) {
      sfx.value = String(Math.round(this.audio.sfxVol * 100));
      label(sfxVal, this.audio.sfxVol);
      sfx.addEventListener("input", () => {
        const v = Number(sfx.value) / 100;
        this.audio.unlock();
        this.audio.setSfxVolume(v);
        label(sfxVal, v);
        this.audio.previewSfx();
      });
    }
    if (nav) {
      nav.value = String(Math.round(this.codriver.volume * 100));
      label(navVal, this.codriver.volume);
      nav.addEventListener("input", () => {
        const v = Number(nav.value) / 100;
        this.audio.unlock();
        this.codriver.warm();
        this.codriver.setVolume(v);
        label(navVal, v);
        this.codriver.preview();
      });
    }
  }

  _leaveTitle() {
    window.__rallyLeftTitle = true;
    if (this.state !== "title") return;
    this.state = "menu";
    showScreen("screen-menu");
    try {
      this.audio.unlock();
      this.codriver.warm();
    } catch (err) {
      console.warn(err);
    }
    this._bootGfx();
    if (this.renderer) {
      this._setupTitleStage();
      this._warmRaceSystems();
    }
    // Keep Desert hot — most players open Championship next.
    this._scheduleTrackPreload(this.courseId || "desert", { priority: true });
    for (const id of COURSE_ORDER) {
      if (id !== (this.courseId || "desert")) this._scheduleTrackPreload(id);
    }
    this._warmCarMeshes();
  }

  _onMenu(id) {
    this.audio.unlock();
    this.codriver.warm();
    if (id === "championship") {
      this.mode = "championship";
      this.stageIndex = 0;
      this.champOrder = COURSE_ORDER.slice();
      this.champPlace = CHAMPIONSHIP.startPosition;
      this._showCars();
    } else if (id === "timeattack") {
      this.mode = "timeattack";
      this._showCars();
    } else if (id === "practice") {
      this.mode = "practice";
      this._showCars();
    } else if (id === "controls") {
      showScreen("screen-controls");
    } else if (id === "back") {
      showScreen("screen-menu");
      this.state = "menu";
    } else if (id === "retry") {
      this._beginRace(this.courseId);
    } else if (id === "resume") {
      this.state = "race";
      showScreen("screen-hud");
    } else if (id === "next") {
      const next = this._pendingNextCourse || this.champOrder[this.stageIndex + 1];
      if (next) {
        this.stageIndex = Math.max(0, this.champOrder.indexOf(next));
        this._pendingNextCourse = null;
        this._beginRace(next);
      }
    } else if (id === "title") {
      this._showTitle();
    }
  }

  _showCars() {
    this.state = "menu";
    this._syncCarSelectButtons();
    const stratos = document.querySelector("[data-car='stratos']");
    if (stratos) {
      stratos.disabled = !isGltfCar("stratos");
      stratos.textContent = isGltfCar("stratos")
        ? "STRATOS HF  ·  2WD"
        : "STRATOS HF  ·  LOADING…";
    }
    showScreen("screen-cars");
    this._warmCarMeshes();
    if (this.mode === "championship" && this.champOrder.length) {
      this._scheduleTrackPreload(this.champOrder[this.stageIndex] || this.champOrder[0]);
    }
  }

  _pickCar(id) {
    if (!isGltfCar(id)) {
      if (this.hud) this.hud.flashMessage("MODEL NOT LOADED");
      return;
    }
    this.carId = id;
    this.player = new Vehicle(CARS[id]);
    this.audio.setCar(id);

    const finishPick = () => {
      if (this.mode === "championship") {
        const next = this.champOrder[this.stageIndex] || this.champOrder[0];
        this._scheduleTrackPreload(next);
        this._beginRace(next);
      } else {
        this._refreshCourseLock();
        showScreen("screen-courses");
        this._scheduleTrackPreload(this.courseId || "desert");
      }
    };

    if (!this.renderer) {
      finishPick();
      return;
    }

    requestAnimationFrame(() => {
      this._swapPlayerCar(id);
      requestAnimationFrame(finishPick);
    });
  }

  _refreshCourseLock() {
    try {
      if (localStorage.getItem("rally-lakeside") === "1" || localStorage.getItem("rally-stratos") === "1") {
        this.lakesideUnlocked = true;
      }
    } catch {
      /* private mode */
    }
    const lake = document.querySelector("[data-course='lakeside']");
    if (lake) lake.hidden = !this.lakesideUnlocked;
  }

  _showTitle() {
    this.state = "title";
    showScreen("screen-title");
    if (this.track && this.scene) {
      this.scene.remove(this.track.group);
      this.track.dispose();
      this.track = null;
    }
    if (this.scene) {
      for (const o of this.opponents) this.scene.remove(o.mesh);
    }
    this.opponents = [];
    if (this.renderer) this._setupTitleStage();
  }

  /**
   * Attract mode is sky + car only. Building Desert here froze the first
   * paint so PRESS START never appeared (cached JS runs before a frame).
   */
  _setupTitleStage() {
    if (!this.scene) return;
    this._applyTitleLighting();
  }

  /**
   * Showroom rig for the splash car: sky IBL, three-point light, lacquer boost.
   * Race lighting in _updateLights() must not stomp these values every frame.
   */
  _applyTitleLighting() {
    if (!this.scene || !this.renderer) return;
    const L = LIGHTING.title;
    this._titleShowcase = true;
    if (!this._titleFloor) {
      const geo = new THREE.CircleGeometry(52, 48);
      const mat = new THREE.MeshStandardMaterial({
        color: 0xc8a870,
        roughness: 0.38,
        metalness: 0.22,
      });
      this._titleFloor = new THREE.Mesh(geo, mat);
      this._titleFloor.rotation.x = -Math.PI / 2;
      this._titleFloor.receiveShadow = true;
      this.scene.add(this._titleFloor);
    } else if (this._titleFloor.material && this._titleFloor.material.isMeshStandardMaterial) {
      this._titleFloor.material.roughness = 0.38;
      this._titleFloor.material.metalness = 0.22;
    }
    this._titleFloor.visible = true;
    if (this.player) {
      this.player.position.set(0, 0.02, 0);
      this.player.pitch = 0;
      this.player.roll = 0;
    }
    this.renderer.toneMappingExposure = L.exposure;
    this.renderer.shadowMap.enabled = true;
    if (!this.sky) {
      this.sky = createSky();
      this.scene.add(this.sky);
    }
    this.sky.visible = true;
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(L.fog, L.fogNear, L.fogFar);
    else {
      this.scene.fog.color.setHex(L.fog);
      this.scene.fog.near = L.fogNear;
      this.scene.fog.far = L.fogFar;
    }
    if (!this.scene.background || !this.scene.background.isColor) {
      this.scene.background = new THREE.Color(L.skyBack);
    } else {
      this.scene.background.setHex(L.skyBack);
    }
    applySky(this.sky, L);
    if (this.dust && this.dust.setAtmosphere) this.dust.setAtmosphere(L);
    setTimeout(() => {
      try {
        this._bakeSkyEnv("title");
      } catch (err) {
        console.warn("Title IBL failed", err);
      }
    }, 0);
    this.hemi.color.setHex(L.hemiSky);
    this.hemi.groundColor.setHex(L.hemiGround);
    this.hemi.intensity = L.hemi;
    this.sun.color.setHex(L.sun);
    this.sun.intensity = L.sunInt;
    this._titleSunDir.set(L.sunDir[0], L.sunDir[1], L.sunDir[2]).normalize();
    this.fill.color.setHex(L.fill);
    this.fill.intensity = L.fillInt;
    this.ambient.color.setHex(L.ambient);
    this.ambient.intensity = L.ambientInt;
    this._titleRim.color.setHex(L.rim);
    this._titleRim.intensity = L.rimInt;
    this._titleKick.color.setHex(L.kick);
    this._titleKick.intensity = L.kickInt;
    this.caveLight.intensity = 0;
    for (const lamp of this._wallLights) lamp.intensity = 0;
    this.sun.castShadow = true;
    this._tunnelBlend = 0;
    this._applyTitleCarShowcase(true);
    if (!this._reflectRT) {
      this._reflectRT = new THREE.WebGLCubeRenderTarget(128, {
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
      });
      this._reflectCam = new THREE.CubeCamera(0.35, 120, this._reflectRT);
    }
    this._onResize();
    this._updateTitleLights(0);
    // Place the orbit camera immediately — menu can boot before any _titleCam tick,
    // which left the camera at (0,0,0) looking up through the chassis.
    this._titleCam(0);
  }

  /** Lacquer/chrome boost for splash; restored when a track loads. */
  _applyTitleCarShowcase(on) {
    if (!this.playerMesh) return;
    const L = LIGHTING.title;
    const env = this.scene.environment || this._skyEnv;
    setShowcaseReflectivity(this.playerMesh, on, env, {
      bodyEnv: L.bodyEnv,
      chromeEnv: L.chromeEnv,
      glassEnv: L.glassEnv,
    });
    if (on && env) applyEnvMap(this.playerMesh, env, L.envIntensity);
    else if (!on && env) applyEnvMap(this.playerMesh, env, VISUAL.carEnvIntensity ?? 0.52);
    this.playerMesh.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
  }

  /**
   * Title-only light rig — keeps fill on the lens and a rim on the silhouette.
   * @param {number} dt
   */
  _updateTitleLights(dt) {
    const L = LIGHTING.title;
    if (this._skyRim) this._skyRim.intensity = 0;
    const p = this.player ? this.player.position : { x: 0, y: 0, z: 0 };
    const d = this._titleSunDir;
    this.sun.position.set(p.x + d.x * 36, p.y + d.y * 36, p.z + d.z * 36);
    this.sun.target.position.set(p.x, p.y + 0.55, p.z);
    this.sun.target.updateMatrixWorld();
    this.sun.intensity = L.sunInt;
    this.hemi.intensity = L.hemi;
    this.ambient.intensity = L.ambientInt;
    this.renderer.toneMappingExposure = L.exposure;

    if (this.camera) {
      this.fill.position.copy(this.camera.position);
      this.fill.position.y += 1.35;
      this.fill.target.position.set(p.x, p.y + 0.62, p.z);
      this.fill.target.updateMatrixWorld();
    } else {
      this.fill.position.set(p.x - d.x * 22, p.y + 16, p.z - d.z * 22);
    }
    this.fill.intensity = L.fillInt;

    this._titleRim.position.set(p.x - d.x * 28, p.y + 14, p.z - d.z * 28);
    this._titleRim.target.position.set(p.x, p.y + 0.5, p.z);
    this._titleRim.target.updateMatrixWorld();
    this._titleRim.intensity = L.rimInt;

    this._titleKick.position.set(p.x + d.z * 4.2, p.y + 1.15, p.z - d.x * 4.2);

    const ext = 9;
    this.sun.shadow.camera.left = -ext;
    this.sun.shadow.camera.right = ext;
    this.sun.shadow.camera.top = ext;
    this.sun.shadow.camera.bottom = -ext;
    this.sun.shadow.camera.near = 2;
    this.sun.shadow.camera.far = 42;
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  /** Live cube capture on title only — paint picks up the moving sky. */
  _updateTitleReflections() {
    if (!this._reflectCam || !this.playerMesh) return;
    this._titleReflectTick += 1;
    if (this._titleReflectTick % 3 !== 0) return;
    const mesh = this.playerMesh;
    const vis = mesh.visible;
    mesh.visible = false;
    this._reflectCam.position.set(0, 0.72, 0);
    this._reflectCam.update(this.renderer, this.scene);
    mesh.visible = vis;
    const L = LIGHTING.title;
    applyEnvMap(mesh, this._reflectRT.texture, L.envIntensity * 0.92);
    setShowcaseReflectivity(mesh, true, this._reflectRT.texture, {
      bodyEnv: L.bodyEnv,
      chromeEnv: L.chromeEnv,
      glassEnv: L.glassEnv,
    });
  }

  /**
   * Build or attach a course, reporting progress for the loading screen.
   * @param {string} courseId
   * @param {boolean} preview
   * @param {(frac: number, status: string) => void} [onProgress]
   */
  async _loadTrackAsync(courseId, preview, onProgress) {
    if (this._pinnedPreloadId === courseId) this._pinnedPreloadId = null;
    if (this.track) {
      this.scene.remove(this.track.group);
      this.track.dispose();
    }
    for (const o of this.opponents) this.scene.remove(o.mesh);
    this.opponents = [];

    const def = COURSES[courseId];
    this.courseId = courseId;
    const report = (frac, status) => {
      if (onProgress) onProgress(Math.max(0, Math.min(1, frac)), status);
    };
    const tick = () => new Promise((resolve) => requestAnimationFrame(resolve));

    // Join any in-flight background build for this course before starting another.
    await this._awaitTrackPreload(courseId, report);

    let fromCache = false;
    if (this._trackCache[courseId]) {
      fromCache = true;
      report(0.92, "Course ready — wiring stage…");
      this.track = this._trackCache[courseId];
      delete this._trackCache[courseId];
    } else {
      // Track build is ~86% of wall time; map its 0–1 straight onto the bar.
      this.track = await Track.create(def, (p, msg) => report(p * 0.86, msg));
    }

    this.scene.add(this.track.group);
    const bootErr = document.getElementById("boot-error");
    if (bootErr) {
      bootErr.hidden = true;
      bootErr.textContent = "";
    }
    if (this.tireMarks) this.tireMarks.reset();
    report(fromCache ? 0.94 : 0.88, "Applying stage lighting…");
    if (!fromCache) await tick();
    this._applyLighting(def.id);

    report(fromCache ? 0.96 : 0.9, "Spawning grid…");
    if (!fromCache) await tick();

    const spacing =
      (CHAMPIONSHIP.gridSpacingByCourse && CHAMPIONSHIP.gridSpacingByCourse[courseId]) ||
      CHAMPIONSHIP.gridSpacing;
    let n = 0;
    if (!preview && this.mode === "championship") {
      const byCourse = CHAMPIONSHIP.opponentsByCourse;
      n = (byCourse && byCourse[courseId]) || CHAMPIONSHIP.opponents;
    } else if (!preview && this.mode === "practice") {
      n = CHAMPIONSHIP.practiceOpponents;
    }

    /**
     * Sprint 26 exclusive grid: player owns their championship slot; AI fill
     * every other slot. Sharing a progress with AI[0] after a 1st-place rollover
     * was shoving the car on GO — the stage 2/3/4 "glitch into place" bug.
     */
    if (!preview && this.mode === "championship" && n > 0) {
      const place = this.champPlace || CHAMPIONSHIP.startPosition;
      const total = n + 1;
      const playerSlot = Math.min(n, Math.max(0, place - 1));
      let aiIndex = 0;
      for (let slot = 0; slot < total; slot++) {
        const dist = 16 + slot * spacing;
        if (slot === playerSlot) {
          this.player.spawn(this.track, dist, this._gridLane(place));
        } else {
          const gridPlace = slot + 1;
          const ai = new Opponent(this.track, aiIndex, dist, {
            fieldSize: n,
            courseId,
            champPlace: place,
            lane: this._gridLane(gridPlace),
          });
          this.opponents.push(ai);
          this.scene.add(ai.mesh);
          aiIndex += 1;
          if (!fromCache) {
            report(0.9 + (aiIndex / n) * 0.08, `Grid ${aiIndex} / ${n}…`);
            await tick();
          }
        }
      }
      if (fromCache) report(0.98, "Grid ready…");
    } else {
      this.player.spawn(this.track, 8, 0);
      for (let i = 0; i < n; i++) {
        const dist = 16 + i * spacing;
        const ai = new Opponent(this.track, i, dist, {
          fieldSize: n,
          courseId,
          champPlace: this.champPlace || CHAMPIONSHIP.startPosition,
        });
        this.opponents.push(ai);
        this.scene.add(ai.mesh);
        if (n > 0 && !fromCache) {
          report(0.9 + ((i + 1) / n) * 0.08, `Grid ${i + 1} / ${n}…`);
          await tick();
        }
      }
    }

    this.playerMesh.visible = true;
    this._plantStartGrid();

    report(0.99, "Final checks…");
    if (!fromCache) await tick();

    const mini = document.getElementById("minimap");
    if (mini) mini.hidden = this.mode === "championship";
    this.hud.drawMinimap(this.track, this.player, this.opponents);
    if (!preview) this._collideCars();
    this._plantStartGrid();
    this._applyCockpitCam();
    if (this._titleFloor) this._titleFloor.visible = false;
    if (this._titleShowcase) {
      this._titleShowcase = false;
      this._applyTitleCarShowcase(false);
    }
    this._titleRim.intensity = 0;
    this._titleKick.intensity = 0;
    this.renderer.shadowMap.enabled = true;
    this.sun.castShadow = true;
    report(1, "Ready");
  }

  /**
   * Plant every car mesh + chase cam on the start grid before the player sees
   * countdown. Prevents the stage 2/3/4 "pop in at GO" glitch.
   */
  _plantStartGrid() {
    if (!this.player || !this.playerMesh) return;
    this.playerMesh.visible = true;
    this._syncPackMeshes();
    this._camSnap = true;
    this._chaseCam(1 / 60);
    this._syncWorldStream();
    /** Hold hard cam snap through most of the 3-2-1 so the grid never drifts in. */
    this._gridCamHold = 2.8;
  }

  /** Plant every car mesh on its interpolated physics pose before the first frame draws. */
  _syncPackMeshes() {
    const racing = this.state === "race" || this.state === "countdown";
    // Player: always current pose — interpolation made turn-in look a beat late.
    this._syncPlayerMesh(1);
    const alpha = racing ? Math.max(0, Math.min(1, (this._physAccum || 0) / FIXED_DT)) : 1;
    for (const o of this.opponents) o.syncMesh(alpha);
    this._syncContactBlobs(1);
  }

  /**
   * Soft contact discs under the nearest cars. Soft radial alpha + smoothed
   * ground Y so the blob under the player never z-fights or strobes.
   */
  _initContactBlobs() {
    this._contactBlobs = [];
    const geo = shadowGeometry();
    for (let i = 0; i < 8; i++) {
      const mat = carShadowMaterial();
      // Player (slot 0): slightly darker / larger read. Rivals: softer.
      mat.opacity = i === 0 ? 0.62 : 0.42;
      mat.color.setHex(i === 0 ? 0x14100c : 0x1a140e);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = -2;
      mesh.userData.blob = {
        y: null,
        sx: 1,
        sz: 1,
        op: mat.opacity,
        baseOp: mat.opacity,
      };
      this.scene.add(mesh);
      this._contactBlobs.push(mesh);
    }
  }

  /**
   * Plant contact discs on the road/ground under each car — never on the chassis.
   * Over a jump the blob stays on the pit/pad below while the car is in the air.
   * @param {number} alpha
   */
  _syncContactBlobs(alpha) {
    const blobs = this._contactBlobs;
    if (!blobs || !this.player) return;
    const pack = this._blobPack || (this._blobPack = []);
    pack.length = 0;
    pack.push(this.player);
    const n = Math.min(this.opponents.length, blobs.length - 1);
    for (let i = 0; i < n; i++) pack.push(this.opponents[i].vehicle);

    const track = this.track;
    const q = this._blobQuery;
    // Steady follow — raw query Y + hover used to flash every frame on rough ribbon.
    const yFollow = 1 - Math.exp(-18 * Math.max(1 / 120, FIXED_DT));
    const scaleFollow = 1 - Math.exp(-12 * Math.max(1 / 120, FIXED_DT));
    for (let i = 0; i < blobs.length; i++) {
      const mesh = blobs[i];
      const st = mesh.userData.blob;
      const v = pack[i];
      if (!v) {
        mesh.visible = false;
        continue;
      }
      const d = v.drawPose(alpha);
      let groundY = d.y;
      if (track && track.query) {
        const hit = track.query(d.x, d.z, q, v.progress);
        if (hit && Number.isFinite(hit.height)) groundY = hit.height;
      }
      // Always plant on the road/pad — never ride the chassis (jumps keep the disc below).
      if (st.y == null) st.y = groundY;
      else st.y += (groundY - st.y) * yFollow;

      const hover = Math.max(0, d.y - st.y);
      // Fade + shrink smoothly while airborne; never pop.
      const wantSx = (i === 0 ? 1.35 : 1.1) / (1 + hover * 0.11);
      const wantSz = (i === 0 ? 2.55 : 2.2) / (1 + hover * 0.11);
      const wantOp = st.baseOp / (1 + hover * 0.22);
      st.sx += (wantSx - st.sx) * scaleFollow;
      st.sz += (wantSz - st.sz) * scaleFollow;
      st.op += (wantOp - st.op) * scaleFollow;

      mesh.visible = true;
      mesh.position.set(d.x, st.y + 0.055, d.z);
      mesh.rotation.set(0, d.yaw, 0);
      mesh.scale.set(st.sx, 1, st.sz);
      if (mesh.material && mesh.material.opacity !== st.op) {
        mesh.material.opacity = st.op;
      }
    }
  }

  _racePack() {
    const pack = this._pack;
    pack.length = 0;
    pack.push(this.player);
    for (let i = 0; i < this.opponents.length; i++) pack.push(this.opponents[i].vehicle);
    return pack;
  }

  _collideCars() {
    if (!this.opponents.length) return;
    const pack = this._racePack();
    resolveVehicleCollisions(pack);
    this.player.stabilize();
    for (const o of this.opponents) o.vehicle.stabilize();
  }

  /**
   * Start a race. When the stage is already hot from title warm, skip the
   * loading screen and go straight into countdown.
   * @param {string} courseId
   */
  _beginRace(courseId) {
    this._pauseGarageWatch();
    this.state = "loading";
    this._loadGen += 1;
    const gen = this._loadGen;
    const def = COURSES[courseId];
    const diff = def && def.difficulty ? def.difficulty.toUpperCase() : "";
    const stage =
      this.mode === "championship" && this.champOrder.length
        ? `STAGE ${this.stageIndex + 1}  ·  ${diff}`
        : diff;
    const instant = this._isTrackReady(courseId);
    const building = this._preloadBuilding === courseId;
    if (!instant) {
      showLoadingScreen({
        title: def && def.name ? def.name : String(courseId || "STAGE").toUpperCase(),
        subtitle: stage,
        status: building ? "Finishing background stage…" : "Preparing course…",
      });
    }
    requestAnimationFrame(() => {
      this._startRace(courseId, gen).catch((err) => {
        if (gen !== this._loadGen) return;
        console.error(err);
        this._fatal(`Course "${courseId}" failed to build.`, err);
        showScreen("screen-menu");
        this.state = "menu";
      });
    });
  }

  async _startRace(courseId, loadGen = this._loadGen) {
    this.audio.unlock();
    // Title-screen garage polling has no job once a stage is loading.
    if (this._stopCelicaWatch) {
      this._stopCelicaWatch();
      this._stopCelicaWatch = null;
    }
    this._bootGfx();
    if (!this.renderer) {
      this._fatal(
        "Cannot start the race: WebGL is unavailable.",
        "The renderer failed to initialise, so no course can load."
      );
      return;
    }
    try {
      this._warmRaceSystems();
      const L0 = LIGHTING[courseId] || LIGHTING.desert;
      if (this.dust && this.dust.setAtmosphere) this.dust.setAtmosphere(L0);
      await this._loadTrackAsync(courseId, false, (frac, status) => {
        if (loadGen !== this._loadGen) return;
        setLoadingProgress(frac, status);
      });
    } catch (err) {
      if (loadGen !== this._loadGen) return;
      console.error(err);
      this._fatal(`Course "${courseId}" failed to build.`, err);
      showScreen("screen-menu");
      this.state = "menu";
      return;
    }
    if (loadGen !== this._loadGen) return;
    setLoadingProgress(1, "Ready");
    this._plantStartGrid();
    this.state = "countdown";
    this.countdown = 3.2;
    this.raceTime = 0;
    this._physAccum = 0;
    this.nextCp = 0;
    this._nextStagePreloadArmed = false;
    this.lap = 1;
    this.paceLine = "";
    this.codriver.gap = PACE.speakGap || this.codriver.gap;
    this.codriver.reset();
    this.player.damage = 0;
    if (this.playerMesh) resetDamageVisuals(this.playerMesh);
    this.ghostRecorder.start(courseId, this.carId);
    this.telemetry.start();
    this.telemetry.exposeGlobal();
    this._setupGhostPlayback();
    this.timeLeft = this.mode === "timeattack" ? 999 : CHAMPIONSHIP.stageTime[courseId] || 80;
    this.crossedFinish = false;
    this._countShown = "";
    this.audio.restoreRaceLoops();
    this.audio.setCar(this.carId);
    showScreen("screen-hud");
    this.hud.flashMessage("READY");
    this._onResize();
    if (this.mode === "championship" && this.champOrder.length) {
      const nextId = this._nextChampCourseId();
      if (nextId) {
        this._pinnedPreloadId = nextId;
        this._scheduleTrackPreload(nextId, { priority: true });
      }
    }
  }

  _loop(now) {
    try {
      if (!this.renderer) {
        this.last = now;
        if (this.input) this.input.poll();
        if (this.audio) this.audio.syncMusic(this.state, this.courseId);
      } else {
        let dt = (now - this.last) / 1000;
        this.last = now;
        if (!(dt > 0) || dt > 1) dt = FIXED_DT;
        // Hitch cap = physics budget, not a 24 ms clamp that starved 30 fps.
        if (dt > FIXED_DT * MAX_SUBSTEPS) dt = FIXED_DT * MAX_SUBSTEPS;

        this.input.poll();
        if (this.input.camera) {
          // Attract / garage keep the orbit showroom — never attach POV under the car.
          if (this.state !== "title" && this.state !== "menu") {
            this.camMode = (this.camMode + 1) % CAMERA.views.length;
            // Drift into the next lens — never hard-snap, never stall the sim.
            this._camSnap = false;
            this._camBlendT = 1.15;
            const mode = CAMERA.views[this.camMode];
            if (mode && mode.id === "pov") {
              // Defer the rear-mirror RT so the first POV frames stay free.
              this._mirrorDefer =
                CAMERA.mirrorDeferFrames != null ? CAMERA.mirrorDeferFrames : 12;
            }
            this._applyCockpitCam();
            if (this.state === "race" || this.state === "countdown") {
              this.hud.flashMessage(mode.label);
            }
          }
        }
        if (this.input.transToggle && this.player) {
          this.player.autoTrans = !this.player.autoTrans;
        }

        const onTitle = this.state === "title" || this.state === "menu";
        const capRender =
          GFX.lockRenderFps !== false &&
          this.renderer &&
          !(GFX.unlockFpsOnTitle && onTitle);
        const frameMs = 1000 / (GFX.targetFps || 60);
        const skipPresent =
          capRender && this._lastPresent > 0 && now - this._lastPresent < frameMs - 0.4;

        // Physics always advances — capping render must not drop sim time or
        // steering feels half-speed on 120 Hz panels (was bundling _fixed here).
        this._fixed(dt);
        if (!skipPresent) {
          // Adaptive present: protect a hard ≥30 fps floor, then chase 60.
          if (this.post && this._lastPresentCost != null) {
            const hi = GFX.adaptHighMs ?? 22;
            const lo = GFX.adaptLowMs ?? 14.5;
            const floor = GFX.adaptFloorMs ?? 33.3;
            const cost = this._lastPresentCost;
            if (cost > floor || (this.fps > 0 && this.fps < 30)) {
              this.post.setQuality("low");
              const floorPr = GFX.minPixelRatio ?? 0.85;
              if (this._perfDprScale > floorPr + 0.001) {
                this._perfDprScale = floorPr;
                this._onResize();
              }
            } else if (cost > hi) {
              this.post.setQuality("low");
            } else if (cost > lo + 1.5) {
              this.post.setQuality("balanced");
            } else if (cost < lo) {
              this.post.setQuality("high");
              if (this._perfDprScale < 0.999) {
                this._perfDprScale = Math.min(1, this._perfDprScale + 0.04);
                this._onResize();
              }
            }
          }
          const t0 = performance.now();
          this._render(dt);
          this._lastPresentCost = performance.now() - t0;
          if (!this.perfTier) this.perfTier = createPerfTier(GFX);
          const pick = this.perfTier.tick(this._lastPresentCost, {
            renderer: this.renderer,
            postFx: this.post,
            visual: VISUAL,
          });
          if (pick.pr < this._perfDprScale - 0.02) {
            this._perfDprScale = pick.pr;
            this._onResize();
          }
          this._lastPresent = now;
          this._fpsFrames++;
          this._fpsT += dt;
          if (this._fpsT >= 0.5) {
            this.fps = Math.round(this._fpsFrames / this._fpsT);
            this._fpsFrames = 0;
            this._fpsT = 0;
          }
        }
      }
      this._frameFails = 0;
    } catch (err) {
      // A throw here repeats every frame. Log the first few, then surface it
      // once and stay quiet, so the console still shows the original cause.
      this._frameFails = (this._frameFails || 0) + 1;
      if (this._frameFails <= 3) console.error("Frame failed", err);
      if (this._frameFails === FRAME_FAIL_LIMIT) this._fatal("The game loop is failing every frame.", err);
    }
    requestAnimationFrame(this._loop);
  }

  _fixed(dt) {
    this.audio.syncMusic(this.state, this.courseId);
    if (this.state === "title" || this.state === "menu") {
      this._titleCam(dt);
      if (this.state === "menu") {
        const s = this._audioState;
        s.rpm = 900;
        s.throttle = 0;
        s.slip = 0;
        s.speed = 0;
        s.surfaceDust = 0;
        s.carId = this.carId;
        s.active = false;
        s.idleHum = true;
        this.audio.setState(s);
      }
      return;
    }

    if (this.state === "loading") return;

    if (this.state === "paused") {
      const s = this._audioState;
      s.rpm = this.player.rpm;
      s.throttle = 0;
      s.slip = 0;
      s.speed = 0;
      s.surfaceDust = 0;
      s.carId = this.carId;
      s.active = false;
      this.audio.setState(s);
      if (this.input.pause) {
        this.state = "race";
        showScreen("screen-hud");
      }
      return;
    }

    if (this.state === "result") {
      const s = this._audioState;
      s.rpm = this.player ? this.player.spec.idleRpm : 900;
      s.throttle = 0;
      s.slip = 0;
      s.speed = 0;
      s.surfaceDust = 0;
      s.carId = this.carId;
      s.active = false;
      this.audio.setState(s);
      return;
    }

    if (this.state === "countdown") {
      this.countdown -= dt;
      const n = Math.ceil(this.countdown);
      if (n >= 1 && n <= 3 && String(n) !== this._countShown) {
        this._countShown = String(n);
        this.hud.flashMessage(String(n));
        this.audio.countBeep(n);
      }
      if (this.countdown <= 0) {
        this.state = "race";
        this.hud.flashMessage("GO!");
        this.audio.countGo();
        this._camSnap = true;
      }
      const idle = this.player.spec.idleRpm;
      const blip = this.countdown > 0.35 && this.countdown < 2.9 ? 0.1 + 0.07 * Math.sin(this.countdown * 9) : 0.04;
      const a = this._audioState;
      a.rpm = idle + blip * 400;
      a.throttle = blip;
      a.slip = 0;
      a.speed = 0;
      a.surfaceDust = 0;
      a.carId = this.carId;
      a.gear = 1;
      a.active = true;
      this.audio.setState(a);
      const h = this._hudState;
      h.speedKmh = 0;
      h.gear = 1;
      h.rpm = a.rpm;
      h.redline = this.player.spec.redline;
      h.position = this._racePosition();
      h.timeLeft = this.timeLeft;
      h.lapTime = 0;
      h.surface = getSurface(this.player.surfaceId).label;
      h.surfaceId = this.player.surfaceId;
      h.courseName = COURSES[this.courseId].name;
      h.courseSub = COURSES[this.courseId].subtitle || "";
      h.fps = this.fps;
      h.pace = "";
      h.trans = this.player.autoTrans ? "AT" : "MT";
      h.onGround = true;
      h.dt = dt;
      this.hud.update(h);
      // Keep the grid planted — do not let chase cam drift in from the last stage.
      if (this._gridCamHold > 0) {
        this._gridCamHold -= dt;
        this._camSnap = true;
      }
      this._syncPackMeshes();
      this._chaseCam(dt);
      return;
    }

    if (this.state !== "race") return;

    if (this.input.pause) {
      this.state = "paused";
      showScreen("screen-paused");
      return;
    }
    if (this.input.reset) {
      this.player.spawn(this.track, Math.max(4, this.player.progress - 8), 0);
    }

    this._physAccum = Math.min((this._physAccum || 0) + dt, FIXED_DT * MAX_SUBSTEPS);
    const pack = this._racePack();
    while (this._physAccum >= FIXED_DT) {
      this._physAccum -= FIXED_DT;
      this.player.step(FIXED_DT, this.input, this.track);
      for (const o of this.opponents) o.step(FIXED_DT, this.player.progress, pack);
      this._collideCars();
    }
    this._feelPad(dt);

    this.raceTime += dt;
    this.timeLeft -= dt;
    this._checkpoints();
    this.dust.emit(this.player, dt);
    for (const o of this.opponents) this.dust.emit(o.vehicle, dt);
    this.dust.step(dt);
    this.tireMarks.emit(this.player, this.track, dt);
    for (const o of this.opponents) this.tireMarks.emit(o.vehicle, this.track, dt);
    this.tireMarks.step(dt);

    const pos = this._racePosition();
    // Calls must land before the corner is committed, so look ahead by TIME,
    // not by a fixed distance. A flat 42 m is only ~1.2 s of warning at speed.
    const look = Math.min(
      PACE.lookMax || 165,
      Math.max(PACE.look || 42, this.player.speed * (PACE.leadSeconds || CODRIVER_LEAD_SECONDS))
    );
    const note = this.track.noteAt(this.player.progress, look);
    const pace = this.codriver.update(note, dt, this.audio, this.player.progress, this.player.speed);
    if (pace.spoken) this.paceLine = pace.display;

    if (this.player.progress > (this.track.finishDist || this.track.length - 12) && this.raceTime > 8) {
      if (this.mode === "practice" && this.lap < CHAMPIONSHIP.practiceLaps) {
        this.lap += 1;
        this.player.spawn(this.track, 8, 0);
        this.hud.flashMessage("LAP 2");
      } else {
        this._finish(pos);
        return;
      }
    }
    if (this.timeLeft <= 0 && this.mode !== "timeattack") {
      this._dnf();
      return;
    }

    const surf = getSurface(this.player.surfaceId);
    const a = this._audioState;
    a.rpm = this.player.rpm;
    a.throttle = this.player.throttle;
    a.slip = this.player.slip;
    a.speed = this.player.speed;
    a.surfaceDust = surf.dust;
    a.surfaceId = this.player.surfaceId;
    a.driftAngle = this.player.driftAngle;
    a.onGround = this.player.onGround;
    a.bump = this.player._feltBump;
    a.shock = this.player._surfShock;
    a.carId = this.carId;
    a.gear = this.player.gear;
    a.active = true;
    const roadSample = this.track.sample(this.player.progress);
    const scenery = COURSES[this.courseId]?.scenery || "";
    a.reverbZone = zoneFromSample(roadSample, scenery);
    a.inTunnel = !!roadSample.tunnel;
    this.audio.setState(a);
    if (this.audio.updateCrowd && this.track && this.track.crowdPoints) {
      const yaw = this.player.yaw || 0;
      const spd = this.player.speed || 0;
      const vel = {
        x: Math.sin(yaw) * spd,
        y: 0,
        z: Math.cos(yaw) * spd,
      };
      const pos = this.player.position || { x: 0, y: 1, z: 0 };
      const fwd = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
      const up = { x: 0, y: 1, z: 0 };
      this.audio.updateCrowd(pos, vel, this.track.crowdPoints(), fwd, up);
    }
    if (this.player.lastImpact > 1.35) {
      this.audio.landThump(this.player.lastImpact, this.player.surfaceId, {
        upset: this.player.lastLandUpset || 0,
        airTime: this.player.lastAirTime || 0,
      });
    }
    this.player.lastImpact = 0;
    this.player.lastLandUpset = 0;
    this.player.lastAirTime = 0;
    if (this.player.hitWall > 0.7) {
      this.audio.wallGlance(this.player.hitWall);
      this.codriver.boundaryHit(this.player.hitWall);
    }
    if (this.player.hitWall > 0.25) {
      this.player.damage = accumulateDamage(this.player.damage, this.player.hitWall);
    }
    this.player.hitWall = 0;
    if (this.player.hitCar > 0.2) this.audio.carBump(this.player.hitCar);
    this.player.hitCar = 0;

    const h = this._hudState;
    h.speedKmh = this.player.speedKmh();
    h.gear = this.player.gear;
    h.rpm = this.player.rpm;
    h.redline = this.player.spec.redline;
    h.position = pos;
    h.timeLeft = this.timeLeft;
    h.lapTime = this.raceTime;
    h.surface = surf.label;
    h.surfaceId = this.player.surfaceId;
    h.courseName = COURSES[this.courseId].name;
    h.courseSub = COURSES[this.courseId].subtitle || "";
    h.fps = this.fps;
    h.pace = this.paceLine;
    h.trans = this.player.autoTrans ? "AT" : "MT";
    h.onGround = this.player.onGround;
    h.gripUsed = this.player.gripUsed();
    h.slidePct = this.player.slidePct();
    h.drifting = this.player.drifting;
    h.dt = dt;
    this.hud.update(h);
    if (this.playerMesh) applyDamageVisuals(this.playerMesh, this.player.damage || 0);
    this.ghostRecorder.tick(dt, this.player);
    if (this.ghostPlayer && this.ghostMesh) this.ghostPlayer.tick(dt, this.ghostMesh);
    this.telemetry.sample(dt, {
      grip: this.player.gripUsed(),
      slide: this.player.slidePct(),
      frameMs: this._lastPresentCost || 16,
      fps: this.fps,
      tier: this.perfTier ? this.perfTier.tier : "high",
      speed: Math.round(this.player.speed * 10) / 10,
      zone: a.reverbZone,
    });
    if ((this._minimapT += dt) >= 0.12 && this.mode !== "championship") {
      this._minimapT = 0;
      this.hud.drawMinimap(this.track, this.player, this.opponents);
    }

    this._syncPackMeshes();
    this._chaseCam(dt);
  }

  _checkpoints() {
    const cps = this.track.checkpoints;
    if (this.nextCp < cps.length && this.player.progress > cps[this.nextCp]) {
      const cpDist = cps[this.nextCp];
      this.timeLeft += CHAMPIONSHIP.checkpointBonus;
      this.nextCp += 1;
      this.audio.beep();
      this.hud.flashMessage(`CHECK POINT  +${formatTime(CHAMPIONSHIP.checkpointBonus)}`);
      if (cpDist >= this.track.length * 0.45) {
        this._armNextStagePreload("checkpoint");
      }
    }
    this._maybePreloadNextStageAtHalfway();
  }

  _racePosition() {
    let pos = 1;
    for (const o of this.opponents) {
      if (o.vehicle.progress > this.player.progress) pos++;
    }
    return pos;
  }

  _setupGhostPlayback() {
    if (this.mode !== "timeattack" || !this.scene) return;
    const data = GhostRecorder.loadBest(this.courseId, this.carId);
    if (!data) return;
    this.ghostPlayer = new GhostPlayer(data);
    if (!this.ghostMesh) {
      this.ghostMesh = createRivalCar({}, 0, this.carId);
      this.ghostMesh.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          m.transparent = true;
          m.opacity = 0.42;
          m.depthWrite = false;
        }
      });
      this.scene.add(this.ghostMesh);
    }
    this.ghostPlayer.reset();
  }

  _finish(pos) {
    const ghostData = this.ghostRecorder.export();
    if (ghostData) GhostRecorder.saveBest(ghostData);
    this.ghostRecorder.stop();
    this.telemetry.stop();
    this.state = "result";
    this._pendingNextCourse = null;
    if (this.mode === "championship") {
      this.champPlace = pos;
      const lastMain = this.courseId === "mountain";
      const onLake = this.courseId === "lakeside";
      const courseName = COURSES[this.courseId].name;
      if (lastMain && pos === 1) {
        this.champOrder = COURSE_ORDER.concat("lakeside");
        this._pendingNextCourse = "lakeside";
        this._pinnedPreloadId = "lakeside";
        this._scheduleTrackPreload("lakeside", { priority: true });
        this._renderResult(`${ordinal(pos)} · MOUNTAIN CLEAR`, [
          "LAKESIDE UNLOCKED",
          "NEXT STAGE: LAKESIDE",
        ]);
        document.getElementById("result-next").hidden = false;
        this._unlockLakeside();
      } else if (onLake) {
        this._renderResult(
          pos === 1 ? "CHAMPION" : `${ordinal(pos)} · LAKESIDE`,
          pos === 1
            ? ["LAKESIDE 1st", "BONUS CLEAR"]
            : ["LAKESIDE COMPLETE"]
        );
        document.getElementById("result-next").hidden = true;
        if (pos === 1) this._unlockStratos();
      } else if (this.stageIndex < this.champOrder.length - 1 && !lastMain) {
        const nextId = this.champOrder[this.stageIndex + 1];
        const nextName = COURSES[nextId] ? COURSES[nextId].name : nextId.toUpperCase();
        this._pendingNextCourse = nextId;
        this._pinnedPreloadId = nextId;
        this._scheduleTrackPreload(nextId, { priority: true });
        this._renderResult(`${ordinal(pos)} · ${courseName} CLEAR`, [
          `GRID ${ordinal(pos)} AT ${nextName}`,
          `STAGE TIME ${this.hud.best.textContent}`,
        ]);
        document.getElementById("result-next").hidden = false;
      } else if (lastMain) {
        this._renderResult(`${ordinal(pos)} OVERALL`, ["NEED 1st FOR LAKESIDE"]);
        document.getElementById("result-next").hidden = true;
      } else {
        this._pendingNextCourse =
          this.stageIndex < this.champOrder.length - 1 ? this.champOrder[this.stageIndex + 1] : null;
        if (this._pendingNextCourse) {
          this._pinnedPreloadId = this._pendingNextCourse;
          this._scheduleTrackPreload(this._pendingNextCourse, { priority: true });
        }
        this._renderResult(`${ordinal(pos)} · ${courseName} CLEAR`, [
          `STAGE TIME ${this.hud.best.textContent}`,
        ]);
        document.getElementById("result-next").hidden = !this._pendingNextCourse;
      }
    } else {
      this._renderResult(`FINISH · ${ordinal(pos)}`, [this.hud.best.textContent]);
      document.getElementById("result-next").hidden = true;
    }
    if (pos <= 3 && this.audio.ready) this.audio.countGo();
    if (this.audio.ready) this.audio.fadeOutRaceLoops(1.4);
    showScreen("screen-result");
  }

  /**
   * Structured championship / practice result copy.
   * @param {string} headline
   * @param {string[]} bullets
   */
  _renderResult(headline, bullets = []) {
    const head = document.getElementById("result-headline");
    const list = document.getElementById("result-detail");
    const legacy = document.getElementById("result-copy");
    if (head) head.textContent = headline;
    if (list) {
      while (list.firstChild) list.removeChild(list.firstChild);
      for (const line of bullets) {
        const li = document.createElement("li");
        li.textContent = line;
        list.appendChild(li);
      }
    }
    if (legacy) {
      legacy.textContent = bullets.length ? `${headline}  ·  ${bullets.join("  ·  ")}` : headline;
    }
  }

  /** Championship grid lateral slot aligned with rival lanes. */
  _gridLane(place) {
    const lanes = [-2.2, 0.2, 2.15, -1.15, 1.25, -2.45, 1.85, -0.6, 2.6];
    return lanes[(Math.max(1, place) - 1) % lanes.length];
  }

  _unlockLakeside() {
    this.lakesideUnlocked = true;
    this._refreshCourseLock();
    try {
      localStorage.setItem("rally-lakeside", "1");
    } catch {
      /* ignore */
    }
  }

  _unlockStratos() {
    // Stratos is starter content; Lakeside 1st still records the legacy flag
    // and unlocks the bonus stage.
    this.stratosUnlocked = true;
    this.lakesideUnlocked = true;
    try {
      localStorage.setItem("rally-stratos", "1");
      localStorage.setItem("rally-lakeside", "1");
    } catch {
      /* ignore */
    }
    this._refreshCourseLock();
  }

  _dnf() {
    this.state = "result";
    document.getElementById("result-copy").textContent = "GAME OVER, YEAH!";
    document.getElementById("result-next").hidden = true;
    this.codriver.gameOverYeah();
    this.audio.gameOverYeah();
    if (this.audio.ready) this.audio.fadeOutRaceLoops(1.4);
    showScreen("screen-result");
  }

  _snapCam() {
    this._camSnap = true;
    this._chaseCam(1 / 60);
  }

  _syncPlayerMesh(alpha = 1) {
    if (!this.playerMesh || !this.player) return;
    const p = this.player;
    const d = p.drawPose(alpha);
    this.playerMesh.position.set(d.x, d.y, d.z);
    this.playerMesh.rotation.set(d.pitch, d.yaw, d.roll, "YXZ");
    applyWheelPose(this.playerMesh.userData.wheels || [], d.spin, d.steer, d.roll);
    const braking = p.brake > 0.08 || p.handbrake > 0.28;
    if (this.playerMesh.userData.brakeOn !== braking) {
      this.playerMesh.userData.brakeOn = braking;
      setBrakeLights(this.playerMesh, braking);
    }
    updateCockpit(this.playerMesh, {
      speedKmh: p.speedKmh(),
      rpm: p.rpm,
      redline: p.spec.redline,
      steer: d.steer,
      dt: 1 / 60,
    });
    updateCockpitMotion(this.playerMesh, {
      steer: d.steer,
      gear: p.gear,
      dt: 1 / 60,
      yawRate: p.yawRate,
      slidePct: p.slidePct(),
    });
    this.playerMesh.updateMatrixWorld(true);
  }

  _applyCockpitCam() {
    if (!this.playerMesh) return;
    // Title / SELECT MODE / garage always use the free orbit camera.
    if (this.state === "title" || this.state === "menu") {
      setCockpitView(this.playerMesh, false, this.camera);
      this._cockpitLive = false;
      this._gaugeHoldPov = false;
      this.hud.setChaseGauges(false);
      return;
    }
    const pov = !!(CAMERA.views[this.camMode] && CAMERA.views[this.camMode].id === "pov");
    // Hide the big cluster as soon as POV is chosen; restore after the slide-out.
    if (pov) {
      this.hud.setChaseGauges(false);
      this._gaugeHoldPov = true;
    } else if (!this._gaugeHoldPov) {
      this.hud.setChaseGauges(true);
    }
    // Attach / detach of the cabin is owned by _chaseCam so the zoom stays continuous.
  }

  /**
   * Arcade cabinet shake + dual-rumble. Landing hits harder than gravel chatter.
   * @param {number} dt
   */
  _feelPad(dt) {
    const p = this.player;
    const landed = this._wasAir && p.onGround;
    this._wasAir = !p.onGround;
    let mag = 0;
    if (landed) mag = Math.min(1, 0.35 + Math.abs(p.velY || 0) * 0.04);
    else if (p.slip > 0.28) mag = Math.min(0.55, p.slip * 0.42);
    else if (p._feltBump > 0.04 && p.speed > 8) mag = Math.min(0.22, p._feltBump * p.speed * 0.012);
    if (mag > 0.05) this.input.rumble(mag, landed ? 90 : 32);
    const bump = (p._feltBump || 0) * p.speed * 0.01 + (p._surfShock || 0) * 0.07;
    const landShake = p._landLock > 0.08 ? 0.1 : 0;
    const target = Math.min(0.14, bump + landShake);
    this._shake += (target - this._shake) * (1 - Math.exp(-12 * dt));
    if (this._shake < 0.002) this._shake = 0;

    if (landed) {
      const impact = Math.max(Math.abs(p.velY || 0), p.lastImpact || 0);
      this._camKickY = Math.min(0.28, 0.06 + impact * 0.028);
      this._camFovKick = Math.min(3.8, 0.9 + impact * 0.18);
    }
    const drift = Math.abs(p.driftAngle || 0);
    if (drift > 0.1 && p.speed > 8) {
      const latKick = Math.sign(p.driftAngle) * Math.min(0.14, drift * 0.22 + p.slidePct() * 0.06);
      this._camKickLat += (latKick - this._camKickLat) * (1 - Math.exp(-9 * dt));
      if (p.drifting) this._camFovKick = Math.max(this._camFovKick, Math.min(2.2, drift * 1.8));
    } else {
      this._camKickLat *= Math.exp(-5 * dt);
    }
    this._camKickY *= Math.exp(-7.5 * dt);
    this._camFovKick *= Math.exp(-6.2 * dt);
    if (this._camKickY < 0.002) this._camKickY = 0;
    if (this._camFovKick < 0.04) this._camFovKick = 0;
  }

  /**
   * Attract-mode orbit: camera circles one way, car yaws the other so
   * you see every panel instead of a locked relative pose.
   * @param {number} dt
   */
  _titleCam(dt) {
    if (!this.playerMesh || !this.player) return;
    setCockpitView(this.playerMesh, false, this.camera);
    const p = this.player;
    const t = performance.now() * 0.00022;
    p.yaw = -t * 0.88 + Math.sin(t * 0.34) * 0.1;
    p.pitch = 0;
    p.roll = Math.sin(t * 0.62) * 0.018;
    p.steer = Math.sin(t * 1.15) * 0.24;
    const spin = dt * 9;
    if (p.wheelSpin) {
      p.wheelSpin[0] += spin;
      p.wheelSpin[1] += spin;
      p.wheelSpin[2] += spin;
      p.wheelSpin[3] += spin;
    }
    this._syncPlayerMesh();
    setHeadlights(this.playerMesh, false);
    this._syncContactBlobs(1);

    const r = 6.15 + Math.sin(t * 0.55) * 0.42;
    const lookY = p.position.y + 0.68;
    this.camera.up.set(0, 1, 0);
    this.camera.near = 0.2;
    this.camera.fov = 36;
    this.camera.position.set(
      p.position.x + Math.sin(t) * r,
      p.position.y + 1.34 + Math.sin(t * 0.48) * 0.18,
      p.position.z + Math.cos(t) * r
    );
    this.camera.lookAt(p.position.x, lookY, p.position.z);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Chase-cam look bias near authored geography so landmarks occupy the frame
   * while moving — Sprint 4: scale through framing, not global brightness.
   * @returns {{ lookY: number, lookAhead: number }}
   */
  _geoFramingBias() {
    const track = this.track;
    if (!track || !this.player) return { lookY: 0, lookAhead: 0 };
    const dist = this.player.lapDist;
    let lookY = 0;
    let lookAhead = 0;
    if (this.courseId === "mountain" && track._landmark) {
      const pin = track._landmark;
      const d = Math.abs(dist - pin.dist);
      if (d < 105) {
        const t = 1 - d / 105;
        lookY -= 0.48 * t * t;
        lookAhead += 3 * t;
      }
    }
    if (this.courseId === "mountain" && track._findLastLandmark) {
      const gravel = track._findLastLandmark();
      if (gravel) {
        const d = Math.abs(dist - gravel.dist);
        if (d < 88) {
          const t = 1 - d / 88;
          lookY -= 0.34 * t * t;
          lookAhead += 2.2 * t;
        }
      }
    }
    if (this.courseId === "forest" && track._landmark) {
      const pin = track._landmark;
      const d = Math.abs(dist - pin.dist);
      if (d < 90) {
        const t = 1 - d / 90;
        lookY -= 0.38 * t * t;
        lookAhead += 2.4 * t;
      }
    }
    if (this.courseId === "forest" && track._findLastLandmark) {
      const fin = track._findLastLandmark();
      if (fin) {
        const d = Math.abs(dist - fin.dist);
        if (d < 82) {
          const t = 1 - d / 82;
          lookY -= 0.32 * t * t;
          lookAhead += 2.0 * t;
        }
      }
    }
    if (this.courseId === "lakeside" && track._lakes) {
      for (let i = 0; i < track._lakes.length; i++) {
        const lake = track._lakes[i];
        const d0 = track.length * lake.from;
        const d1 = track.length * lake.to;
        if (dist < d0 - 24 || dist > d1 + 24) continue;
        const mid = (d0 + d1) * 0.5;
        const span = (d1 - d0) * 0.5 + 24;
        const t = 1 - Math.min(1, Math.abs(dist - mid) / span);
        lookY -= 0.42 * t * t;
        lookAhead += 2.2 * t;
        break;
      }
    }
    return { lookY, lookAhead };
  }

  _chaseCam(dt) {
    const p = this.player;
    const d = p._draw;
    const px = d.x;
    const py = d.y;
    const pz = d.z;
    const yaw = d.yaw;
    const mode = CAMERA.views[this.camMode] || CAMERA.views[1];
    const wantPov = mode.id === "pov";
    const mesh = this.playerMesh;
    const rig = wantPov && mesh ? getPovRig(mesh) : null;
    if (this._camBlendT > 0) this._camBlendT = Math.max(0, this._camBlendT - dt);
    const blending = this._camBlendT > 0;

    let dy = yaw - this._camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const yawStiff = CAMERA.yawStiffness != null ? CAMERA.yawStiffness : 32;
    const yawFollow = 1 - Math.exp(-yawStiff * dt);
    if (this._camSnap) this._camYaw = yaw;
    else this._camYaw += dy * yawFollow;
    const sinY = Math.sin(this._camYaw);
    const cosY = Math.cos(this._camYaw);
    const lean = (CAMERA.rollFollow || 0) * d.roll;

    if (wantPov && mesh) {
      const eyeX = rig ? rig.eyeX : mode.eyeX;
      const eyeY = rig ? rig.eyeY : mode.eyeY;
      const eyeZ = rig ? rig.eyeZ : mode.eyeZ;
      const lookX = rig ? rig.lookX : mode.eyeX * 0.2;
      const lookY = rig ? rig.lookY : mode.lookY;
      const lookZ = rig ? rig.lookZ : mode.lookZ;
      this._eyeLocal.set(eyeX, eyeY, eyeZ);
      this._lookLocal.set(lookX, lookY, lookZ);
      this._camTarget.copy(this._eyeLocal).applyMatrix4(mesh.matrixWorld);
      this._camLook.copy(this._lookLocal).applyMatrix4(mesh.matrixWorld);
      this._camUp.set(0, 1, 0).transformDirection(mesh.matrixWorld);
    } else {
      this._camUp.set(sinY * lean, 1, cosY * lean).normalize();
      /** Squats a touch more at speed so the road fills the lens (arcade, mild). */
      const dropCap = mode.speedDropMax != null ? mode.speedDropMax : 0.48;
      const heightDrop = Math.min(dropCap, p.speed * 0.015);
      this._camTarget.set(
        px - sinY * mode.back,
        py + mode.height - heightDrop,
        pz - cosY * mode.back
      );
      const geo = this._geoFramingBias();
      this._camLook.set(
        px + sinY * (mode.lookAhead + geo.lookAhead),
        py + mode.lookY + geo.lookY,
        pz + cosY * (mode.lookAhead + geo.lookAhead)
      );
    }

    const dist = this._camPos.distanceTo(this._camTarget);
    let stiff = mode.stiffness || 18;
    // Soft while still sliding between views; hold soft for the whole C blend.
    if (wantPov || blending) stiff = Math.min(stiff, CAMERA.povBlendStiffness || 6.8);
    if (dist > 1.2 || blending) stiff = Math.min(stiff, CAMERA.viewBlendStiffness || 7.2);
    const follow = this._camSnap ? 1 : 1 - Math.exp(-stiff * dt);

    // Never teleport mid C-key blend — only race-start / grid snaps may jump.
    if (this._camSnap && !blending) {
      this._camPos.copy(this._camTarget);
      this._camLookSmooth.copy(this._camLook);
      this.camera.up.copy(this._camUp);
      this._camSnap = false;
    } else {
      this._camSnap = false;
      this._camPos.lerp(this._camTarget, follow);
      this._camLookSmooth.lerp(this._camLook, follow);
      this.camera.up.lerp(this._camUp, follow).normalize();
    }

    this.camera.position.copy(this._camPos);
    // Shake only while the chase is settled — mid-transition shake reads as hitch.
    if (!wantPov && !blending && this._shake > 0 && dist < 2.5) {
      const t = performance.now() * 0.053;
      this.camera.position.x += Math.sin(t) * this._shake * 0.22;
      this.camera.position.y += Math.sin(t * 1.7) * this._shake * 0.38;
    }
    if (!wantPov && !blending) {
      this.camera.position.y += this._camKickY;
      this.camera.position.x += cosY * this._camKickLat;
      this.camera.position.z += -sinY * this._camKickLat;
    }
    this.camera.lookAt(this._camLookSmooth);

    const punchScale = wantPov ? 0.45 : 1;
    const punch = Math.min(
      (CAMERA.maxFovPunch || 8) * (wantPov ? 0.4 : 1),
      p.speed * (CAMERA.speedFov || 0.08) * punchScale
    );
    const wantFov = (rig && wantPov ? rig.fov : mode.fov) + punch + this._camFovKick * (wantPov ? 0.55 : 1);
    const wantNear = (rig && wantPov ? rig.near : mode.near) || 0.2;
    // FOV eases on its own clock so arriving at the seat does not snap the lens.
    const fovStiff = CAMERA.fovBlendStiffness != null ? CAMERA.fovBlendStiffness : 5.5;
    const fovFollow = this._camSnap && !blending ? 1 : 1 - Math.exp(-fovStiff * dt);
    this._camFovSmooth += (wantFov - this._camFovSmooth) * fovFollow;
    this._camNearSmooth += (wantNear - this._camNearSmooth) * fovFollow;
    if (
      Math.abs(this.camera.fov - this._camFovSmooth) > 0.02 ||
      Math.abs(this.camera.near - this._camNearSmooth) > 0.002 ||
      this._camProjDirty
    ) {
      this.camera.fov = this._camFovSmooth;
      this.camera.near = this._camNearSmooth;
      this.camera.updateProjectionMatrix();
      this._camProjDirty = false;
    }

    // Attach cabin HUD only after the zoom has nearly arrived (no mid-slide pop).
    const attachDist = CAMERA.povAttachDist != null ? CAMERA.povAttachDist : 2.2;
    const detachDist = CAMERA.povDetachDist != null ? CAMERA.povDetachDist : 2.4;
    if (wantPov && mesh && !this._cockpitLive && dist < attachDist) {
      setCockpitView(mesh, true, this.camera);
      this._cockpitLive = true;
      this._povHudFade = 0;
      if (this._mirrorRT) {
        setCockpitMirrorMap(mesh, this._mirrorRT.texture);
        if (this._mirrorDefer <= 0) {
          this._mirrorDefer =
            CAMERA.mirrorDeferFrames != null ? Math.ceil(CAMERA.mirrorDeferFrames * 0.5) : 6;
        }
        this._mirrorTick = 0;
      }
    } else if (wantPov && mesh && this._cockpitLive && dist > attachDist * 1.35) {
      // Mid-blend drift — keep HUD parented until the lens is nearly seated.
      setCockpitView(mesh, true, this.camera);
    } else if (!wantPov && this._cockpitLive && mesh) {
      // Restore the exterior once the lens has left the seat (not when far from
      // the chase target — that fires on frame 1 and pops the body).
      const povRig = getPovRig(mesh);
      const pe = povRig || CAMERA.views[0];
      this._eyeLocal.set(pe.eyeX, pe.eyeY, pe.eyeZ).applyMatrix4(mesh.matrixWorld);
      if (this._camPos.distanceTo(this._eyeLocal) > detachDist) {
        setCockpitView(mesh, false, this.camera);
        this._cockpitLive = false;
        this._povHudFade = 0;
      }
    }

    const fadeIn = 4.8;
    const fadeOut = 6.2;
    if (wantPov && this._cockpitLive) {
      this._povHudFade = Math.min(1, (this._povHudFade || 0) + dt * fadeIn);
    } else if (mesh) {
      this._povHudFade = Math.max(0, (this._povHudFade || 0) - dt * fadeOut);
    }
    if (mesh) updatePovHudFade(mesh, this._povHudFade);

    // Large HTML speedo/tach: off in POV; after leaving, wait until the lens
    // has nearly arrived at medium/far so dials do not pop over the zoom-out.
    if (wantPov) {
      this.hud.setChaseGauges(false);
      this._gaugeHoldPov = true;
    } else if (this._gaugeHoldPov) {
      if (dist < 2.6 && !this._cockpitLive) {
        this.hud.setChaseGauges(true);
        this._gaugeHoldPov = false;
      }
    } else {
      this.hud.setChaseGauges(true);
    }
  }

  /**
   * Stage key/fill/sky so Lambert cars and dirt actually have a lit side.
   * @param {string} courseId
   */
  _applyLighting(courseId) {
    const L = LIGHTING[courseId] || LIGHTING.desert;
    this.renderer.toneMappingExposure = L.exposure;
    if (this.post) this.post.syncFromConfig(L);
    if (!this.sky) {
      this.sky = createSky();
      this.scene.add(this.sky);
    }
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(L.fog, L.fogNear, L.fogFar);
    else {
      this.scene.fog.color.setHex(L.fog);
      this.scene.fog.near = L.fogNear;
      this.scene.fog.far = L.fogFar;
    }
    if (!this.scene.background || !this.scene.background.isColor) {
      this.scene.background = new THREE.Color(L.skyBack || L.fog);
    } else {
      this.scene.background.setHex(L.skyBack || L.fog);
    }
    applySky(this.sky, L);
    delete this._skyEnvCache[courseId];
    if (this.dust && this.dust.setAtmosphere) this.dust.setAtmosphere(L);
    setTimeout(() => {
      try {
        this._bakeSkyEnv();
      } catch (err) {
        console.warn("Sky IBL failed", err);
      }
    }, 0);
    this.hemi.color.setHex(L.hemiSky);
    this.hemi.groundColor.setHex(L.hemiGround);
    applyStageLights(
      {
        sun: this.sun,
        fill: this.fill,
        hemi: this.hemi,
        ambient: this.ambient,
        skyRim: VISUAL.pbrSkyRim !== false ? this._skyRim : null,
      },
      L
    );
    this._sunDir.set(L.sunDir[0], L.sunDir[1], L.sunDir[2]).normalize();
    this._fogColor.setHex(L.fog);
    this._tunnelBlend = 0;
    this._updateLights();
  }

  /**
   * One directional sun as the key. Hemisphere/ambient are fill only.
   * Tunnel shade is a look-ahead along the racing line (dim 18 m before
   * the entrance, restore sun over the last 48 m) then dt-smoothed so a
   * hitch never pops the light list. Wall sconces stay on for the whole
   * bore — they are not a pool that follows the car.
   */
  _updateLights(dt) {
    if (this.state === "title" || this.state === "menu") {
      this._updateTitleLights(dt);
      return;
    }
    this._titleRim.intensity = 0;
    this._titleKick.intensity = 0;
    const p = this.player ? this.player.position : this._camPos;
    const d = this._sunDir;

    const dist = this.player ? this.player.progress : 0;
    const target =
      this.track && this.track.tunnelShade ? this.track.tunnelShade(dist) : 0;
    const blendDt = dt > 0 ? dt : FIXED_DT;
    this._tunnelBlend += (target - this._tunnelBlend) * (1 - Math.exp(-10.4 * blendDt));
    if (this._tunnelBlend < 0.004) this._tunnelBlend = 0;
    if (this._tunnelBlend > 0.996) this._tunnelBlend = 1;

    const t = this._tunnelBlend;
    const L = LIGHTING[this.courseId] || LIGHTING.desert;
    updateRaceLightFollow(
      {
        sun: this.sun,
        fill: this.fill,
        hemi: this.hemi,
        ambient: this.ambient,
        skyRim: VISUAL.pbrSkyRim !== false ? this._skyRim : null,
      },
      p,
      d,
      t,
      L
    );
    if (this.renderer.shadowMap.enabled) {
      updateShadowFrustum(this.sun, GFX.shadowExtentRace, GFX.shadowNear, GFX.shadowFar);
    }
    const boost = TUNNEL.exposureBoost != null ? TUNNEL.exposureBoost : 1.18;
    this.renderer.toneMappingExposure = L.exposure * (1 + (boost - 1) * t);

    this.caveLight.position.set(p.x, p.y + 5.8, p.z);
    const yaw = this.player ? this.player.yaw : 0;
    this.caveLight.target.position.set(
      p.x + Math.sin(yaw) * 12,
      p.y + 0.35,
      p.z + Math.cos(yaw) * 12
    );
    this.caveLight.target.updateMatrixWorld();
    this.caveLight.intensity = t * (TUNNEL.caveInt != null ? TUNNEL.caveInt : 48);
    this.caveLight.visible = true;

    const walls = this._wallLights || [];
    const fixtures =
      this.track && this.track.fixedTunnelLamps
        ? this.track.fixedTunnelLamps(walls.length)
        : this.track && this.track.nearestTunnelLamps
          ? this.track.nearestTunnelLamps(p, walls.length)
          : [];
    const wallInt = TUNNEL.wallInt != null ? TUNNEL.wallInt : 72;
    for (let i = 0; i < walls.length; i++) {
      const lamp = walls[i];
      lamp.visible = true;
      const fix = fixtures[i];
      if (fix) {
        lamp.position.set(fix.x, fix.y, fix.z);
        lamp.intensity = wallInt;
      } else {
        lamp.intensity = 0;
      }
    }

    if (this.scene.fog) {
      this._fogColor.setHex(L.fog);
      this.scene.fog.color.lerpColors(this._fogColor, this._tunnelFog, t);
      const tn = TUNNEL.fogNear != null ? TUNNEL.fogNear : 32;
      const tf = TUNNEL.fogFar != null ? TUNNEL.fogFar : 320;
      this.scene.fog.near = L.fogNear * (1 - t) + tn * t;
      this.scene.fog.far = L.fogFar * (1 - t) + tf * t;
    }

    if (this.playerMesh) setHeadlights(this.playerMesh, Math.min(1, t * 1.35));
  }

  /**
   * Native pixel ratio + aspect so PBR and reflections are not nearest-neighbor.
   */
  _onResize() {
    const host = document.getElementById("game-view");
    if (!host || !this.renderer || !this.camera) return;
    const w = Math.max(640, host.clientWidth || window.innerWidth);
    const h = Math.max(360, host.clientHeight || window.innerHeight);
    const onTitle = this.state === "title" || this.state === "menu";
    let pr = Math.min(
      window.devicePixelRatio || 1,
      onTitle ? GFX.titleMaxPixelRatio || 2 : GFX.maxPixelRatio || 1.25
    );
    if (!onTitle && this._perfDprScale != null && this._perfDprScale < 1) {
      pr *= this._perfDprScale;
    }
    const cap = onTitle ? GFX.titleMaxPixels || 3600000 : GFX.maxPixels || 2800000;
    const px = w * h * pr * pr;
    if (px > cap) pr = Math.max(0.75, pr * Math.sqrt(cap / px));
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this._camProjDirty = true;
    this.camera.updateProjectionMatrix();
    if (this.post) this.post.setSize(w, h, pr);
    if (this.hud && this.hud.resizeGauges) this.hud.resizeGauges();
  }

  /**
   * Sky IBL plus a live cube map so paint and glass reflect the stage.
   */
  _initEnv() {
    this._pmrem = null;
    this._reflectTick = 0;
    this._reflectRT = null;
    this._reflectCam = null;
    if (GFX.reflectEvery) {
      this._reflectRT = new THREE.WebGLCubeRenderTarget(GFX.cubeSize || 64, {
        generateMipmaps: true,
        minFilter: THREE.LinearMipmapLinearFilter,
      });
      this._reflectCam = new THREE.CubeCamera(0.45, 220, this._reflectRT);
    }
  }

  /**
   * Capture the atmospheric sky into scene.environment (diffuse + specular IBL).
   */
  _applyWorldEnv(envMap, intensity) {
    if (!envMap || !VISUAL.realisticArcade) return;
    if (this.track && this.track.group) {
      applyEnvMap(this.track.group, envMap, intensity != null ? intensity : VISUAL.worldEnvIntensity);
    }
  }

  _bakeSkyEnv(cacheKey) {
    if (!this.sky || !this.renderer) return;
    if (!this._pmrem) this._pmrem = new THREE.PMREMGenerator(this.renderer);
    const key = cacheKey || this.courseId || "desert";
    const L = LIGHTING[key] || LIGHTING.desert;
    const cached = this._skyEnvCache[key];
    if (cached) {
      this._skyEnv = cached;
      this.scene.environment = cached;
      if (this.playerMesh) {
        const tint = key === "title" ? LIGHTING.title.envIntensity : VISUAL.carEnvIntensity ?? 0.52;
        applyEnvMap(this.playerMesh, cached, tint);
        if (key === "title" && this._titleShowcase) {
          setShowcaseReflectivity(this.playerMesh, true, cached, {
            bodyEnv: LIGHTING.title.bodyEnv,
            chromeEnv: LIGHTING.title.chromeEnv,
            glassEnv: LIGHTING.title.glassEnv,
          });
        }
      }
      this._applyWorldEnv(cached, L.worldEnv ?? VISUAL.worldEnvIntensity);
      return;
    }
    const tmp = new THREE.Scene();
    const prev = this.sky.position;
    const px = prev.x;
    const py = prev.y;
    const pz = prev.z;
    this.sky.position.set(0, 0, 0);
    tmp.add(this.sky);
    const cap = skyPmremCapture();
    const env = this._pmrem.fromScene(tmp, cap.sigma, cap.near, cap.far);
    this.scene.add(this.sky);
    this.sky.position.set(px, py, pz);
    this._skyEnvCache[key] = env.texture;
    this._skyEnv = env.texture;
    this.scene.environment = this._skyEnv;
    if (this.playerMesh) {
      const tint = key === "title" ? LIGHTING.title.envIntensity : VISUAL.carEnvIntensity ?? 0.52;
      applyEnvMap(this.playerMesh, this._skyEnv, tint);
      if (key === "title" && this._titleShowcase) {
        setShowcaseReflectivity(this.playerMesh, true, this._skyEnv, {
          bodyEnv: LIGHTING.title.bodyEnv,
          chromeEnv: LIGHTING.title.chromeEnv,
          glassEnv: LIGHTING.title.glassEnv,
        });
      }
    }
    this._applyWorldEnv(this._skyEnv, L.worldEnv ?? VISUAL.worldEnvIntensity);
  }

  /**
   * Refresh car reflections a few times a second. Hide the player so it does
   * not reflect itself as a black blob.
   */
  _updateReflections() {
    if (!GFX.reflectEvery || !this._reflectCam || !this.playerMesh) return;
    this._reflectTick += 1;
    if (this._reflectTick % GFX.reflectEvery !== 0) return;
    const mesh = this.playerMesh;
    const vis = mesh.visible;
    mesh.visible = false;
    this._reflectCam.position.copy(mesh.position);
    this._reflectCam.position.y += 0.55;
    this._reflectCam.update(this.renderer, this.scene);
    mesh.visible = vis;
    applyEnvMap(mesh, this._reflectRT.texture, 0.45);
  }

  /**
   * Rearview for cockpit: linear filter, more pixels so it reads as glass.
   */
  _initMirror() {
    const mw = GFX.mirrorW || 512;
    const mh = GFX.mirrorH || 160;
    this._mirrorRT = new THREE.WebGLRenderTarget(mw, mh, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    // Intermediate map — no sRGB tag (avoids double convert + black glass).
    this._mirrorRT.texture.colorSpace = THREE.NoColorSpace;
    this._mirrorRT.texture.generateMipmaps = false;
    this._mirrorCam = new THREE.PerspectiveCamera(48, mw / mh, 0.2, 520);
  }

  _syncMirrorCam() {
    const mesh = this.playerMesh;
    if (!mesh) return;
    mesh.updateMatrixWorld(true);
    const rig = getPovRig(mesh);
    if (rig) {
      this._mirrorEye.set(rig.mirrorEyeX, rig.mirrorEyeY, rig.mirrorEyeZ);
      this._mirrorLook.set(rig.mirrorLookX, rig.mirrorLookY, rig.mirrorLookZ);
    } else {
      this._mirrorEye.set(0.16, 1.26, 0.42);
      this._mirrorLook.set(0.16, 1.02, -24);
    }
    this._mirrorEye.applyMatrix4(mesh.matrixWorld);
    this._mirrorLook.applyMatrix4(mesh.matrixWorld);
    this._mirrorCam.position.copy(this._mirrorEye);
    this._camUp.set(0, 1, 0).transformDirection(mesh.matrixWorld);
    this._mirrorCam.up.copy(this._camUp);
    this._mirrorCam.lookAt(this._mirrorLook);
    this._mirrorCam.updateProjectionMatrix();
    this._mirrorCam.updateMatrixWorld();
  }

  _renderMirror() {
    const pov = !!(CAMERA.views[this.camMode] && CAMERA.views[this.camMode].id === "pov");
    if (!pov || !this._mirrorRT || !this.playerMesh) return;
    if (this._mirrorDefer > 0) {
      this._mirrorDefer -= 1;
      return;
    }
    this._mirrorTick += 1;
    const mirrorEvery = (this._povHudFade || 0) > 0.25 ? 1 : GFX.mirrorEvery || 2;
    if (this._mirrorTick % mirrorEvery !== 0) return;
    const cab = this.playerMesh.userData.cockpit;
    const mir = this.playerMesh.userData.mirror;
    const cabVis = !!(cab && cab.visible);
    const mirVis = !!(mir && mir.visible);
    const playerVis = this.playerMesh.visible;
    const prevTone = this.renderer.toneMapping;
    const prevAuto = this.renderer.autoClear;
    try {
      if (cab) cab.visible = false;
      if (mir) mir.visible = false;
      this.playerMesh.visible = false;

      this._syncMirrorCam();
      if (this.sky) this.sky.position.copy(this._mirrorCam.position);

      const shadows = this.renderer.shadowMap.enabled;
      this.renderer.shadowMap.enabled = false;
      // One tone map only — on the glass it was ACES twice and read as black.
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.autoClear = true;
      const bg = this.scene.background;
      if (bg && bg.isColor) this.renderer.setClearColor(bg, 1);
      this.renderer.setRenderTarget(this._mirrorRT);
      this.renderer.clear();
      this.renderer.render(this.scene, this._mirrorCam);
      this.renderer.setRenderTarget(null);
      this.renderer.shadowMap.enabled = shadows;
      setCockpitMirrorMap(this.playerMesh, this._mirrorRT.texture);
    } catch (err) {
      console.warn("Rearview capture failed", err);
      this.renderer.setRenderTarget(null);
    } finally {
      this.renderer.toneMapping = prevTone;
      this.renderer.autoClear = prevAuto;
      this.playerMesh.visible = playerVis;
      if (cab) cab.visible = cabVis;
      if (mir) mir.visible = mirVis;
      if (this.sky) this.sky.position.copy(this.camera.position);
    }
  }

  _syncWorldStream() {
    if (!this.track || !this.track.update || !this.camera) return;
    try {
      const p = this.player;
      const anchor = p && p.position ? p.position : this.camera.position;
      const fogFar = this.scene.fog && this.scene.fog.far ? this.scene.fog.far : 0;
      const progress = p && Number.isFinite(p.progress) ? p.progress : undefined;
      const speed = p && Number.isFinite(p.speed) ? p.speed : 0;
      const yaw = p && Number.isFinite(p.yaw) ? p.yaw : 0;
      this.track.update(anchor, this.camera.position, { fogFar, progress, speed, yaw });
    } catch (err) {
      console.warn("Track streaming disabled", err);
      if (this.track.showAllChunks) this.track.showAllChunks();
      this.track.update = null;
    }
  }

  _renderPovHudOverlay() {
    const pov = !!(CAMERA.views[this.camMode] && CAMERA.views[this.camMode].id === "pov");
    if (!pov || !this._cockpitLive || (this._povHudFade || 0) < 0.02 || !this.camera) return;
    const prevMask = this.camera.layers.mask;
    const prevTone = this.renderer.toneMapping;
    const prevAuto = this.renderer.autoClear;
    const prevFog = this.scene.fog;
    this.scene.fog = null;
    this.camera.layers.set(1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    this.scene.fog = prevFog;
    this.camera.layers.mask = prevMask;
    this.renderer.toneMapping = prevTone;
    this.renderer.autoClear = prevAuto;
  }

  _render(dt) {
    this._updateLights(dt);
    // Soft shadows every N frames — full update each present was a hitch tax.
    const every = Math.max(1, GFX.shadowEvery | 0 || 1);
    this._shadowTick = (this._shadowTick || 0) + 1;
    if (this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.needsUpdate = this._shadowTick % every === 0;
    }
    if (this.sky && this.camera) {
      this.sky.position.copy(this.camera.position);
      tickSky(this.sky, performance.now() * 0.001);
    }
    this._syncWorldStream();
    this._renderMirror();
    const chase =
      this.state !== "title" &&
      this.state !== "menu" &&
      !!(CAMERA.views[this.camMode] && CAMERA.views[this.camMode].id !== "pov");
    const carPos = this.playerMesh ? this.playerMesh.position : this.camera.position;
    updateCameraFade(this.camera.position, carPos, chase);
    if (this.state === "title" || this.state === "menu") this._updateTitleReflections();
    else this._updateReflections();
    const prevMask = this.camera.layers.mask;
    this.camera.layers.set(0);
    if (this.post && this.post.enabled) this.post.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
    this.camera.layers.mask = prevMask;
    this._renderPovHudOverlay();
  }
}

function ordinal(n) {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return `${n}th`;
}

function garageStatus() {
  const labels = {
    celica: "Celica",
    delta: "Delta HF",
    stratos: "Stratos",
    jaguar: "E-Type",
    focus: "Focus ST",
    accord: "Accord Sport",
  };
  const rows = garageLoadSummary();
  if (!rows.some((r) => r.gltf)) return "Drop a GLB in assets/<car>/ to unlock";
  return (
    "LOADED · " +
    rows
      .map((r) => {
        const name = labels[r.id] || r.id;
        if (!r.gltf) return `${name} (missing GLB)`;
        if (r.placeholder) return `${name} (placeholder GLB)`;
        return name;
      })
      .join(" · ")
  );
}
