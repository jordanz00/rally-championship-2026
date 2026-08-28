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
  STREAM,
  TITLE_SHOWROOM,
} from "./config.js?v=150";
import { Input } from "./input.js?v=41";
import { Vehicle } from "./physics/vehicle.js?v=106";
import { getSurface } from "./physics/surfaces.js?v=48";
import { COURSES, COURSE_ORDER } from "./tracks/courses.js?v=64";
import { prepareCelica, prepareTitleCar, prepareHeroCar, prepareRivalLods, loadCelicaFromFile, watchForCelicaFile, isGltfCar, isTitleCarReady, garageLoadSummary, createPlayerCar, createTitleCar, createRivalCar, applyWheelPose, setBrakeLights, setHeadlights, setCockpitView, updateCockpit, updatePovHudFade, setCockpitMirrorMap, getPovRig, GARAGE_CAR_IDS, POV_HUD_LAYER } from "./cars/celica.js?v=136";
import { updateCockpitMotion } from "./cars/cockpit-anim.js?v=4";
import { Track } from "./tracks/track.js?v=210";
import { preparePropKit, prefetchPropKit, loadTitleRocks } from "./tracks/prop-kit.js?v=23";
import { Opponent } from "./ai.js?v=130";
import { RallyAudio } from "./audio/engine.js?v=55";
import { zoneFromSample } from "./audio/reverb-zones.js?v=1";
import { CoDriver } from "./audio/codriver.js?v=34";
import { Hud, showScreen, showLoadingScreen, setLoadingProgress, formatTime } from "./ui/hud.js?v=31";
import { Dust, TireMarks, ImpactSparks } from "./effects.js?v=56";
import { resolveVehicleCollisions } from "./physics/collide.js?v=45";
import { createSky, applySky, tickSky, setSkyQuality } from "./sky.js?v=28";
import { applyEnvMap, setShowcaseReflectivity } from "./gfx/pbr.js?v=27";
import { updateCameraFade, updatePackSeeThrough, paintPackSeeThrough } from "./gfx/occlusion-fade.js?v=10";
import { PhotoRealPost } from "./gfx/postfx.js?v=16";
import { createPerfTier } from "./gfx/perf-tier.js?v=9";
import { GhostRecorder, GhostPlayer } from "./telemetry/ghost.js?v=1";
import { LiveTelemetry } from "./telemetry/live-qa.js?v=1";
import { TouchControls, isPhonePlay } from "./ui/touch-controls.js?v=3";
import {
  applyStageLights,
  configurePBRRenderer,
  skyPmremCapture,
  updateRaceLightFollow,
  updateShadowFrustum,
} from "./gfx/lighting-rig.js?v=7";
import { shadowGeometry, carShadowMaterial } from "./tracks/trees.js?v=33";

/** Consecutive failing frames before we stop logging and show the error. */
const FRAME_FAIL_LIMIT = 30;

/**
 * Yield so the loading screen can paint and Chrome stays responsive.
 * Never use queueMicrotask — that keeps race start on the click turn and
 * the tab freezes while music keeps playing. setTimeout(0) still completes
 * headless QA when rAF is paused because the canvas is not painting.
 */
function yieldFrame() {
  return new Promise((resolve) => {
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(fire);
    setTimeout(fire, 0);
  });
}
/**
 * Load-time budget for linking start-grid shaders. The old full-stage
 * showAllChunks pass turned a 0.6 s mid-race hitch into a multi-second load.
 */
const PRECOMPILE_BUDGET_MS = 400;

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
    this.touch = new TouchControls(this.input);
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
    this._titleCarWarm = prepareTitleCar(this.carId);
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
    /** Wall-clock mark for the FPS window; null until the first present. */
    this._fpsMark = null;
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
    /** True until the HUD is up — do not tick 3-2-1 under the load fade. */
    this._countHold = false;
    this._mat = new THREE.Matrix4();
    this._camPos = new THREE.Vector3();
    this._camLook = new THREE.Vector3();
    this._camLookSmooth = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._camUp = new THREE.Vector3(0, 1, 0);
    this._eyeLocal = new THREE.Vector3();
    this._lookLocal = new THREE.Vector3();
    this._camBlendFrom = new THREE.Vector3();
    this._camBlendFromLook = new THREE.Vector3();
    this._camBlendFromUp = new THREE.Vector3(0, 1, 0);
    this._camBlendAnchor = new THREE.Vector3();
    this._camBlendAnchorYaw = 0;
    this._camFromPos = new THREE.Vector3();
    this._camFromLook = new THREE.Vector3();
    this._camFromUp = new THREE.Vector3(0, 1, 0);
    this._camBlendDur = 0.22;
    this._camBlendFromFov = CAMERA.fov || 60;
    this._camBlendFromNear = 0.2;
    this._mirrorEye = new THREE.Vector3();
    this._mirrorLook = new THREE.Vector3();
    this._blobQuery = {};
    this._camSnap = true;
    this._camYaw = 0;
    this._camFovSmooth = CAMERA.fov || 60;
    this._camNearSmooth = 0.2;
    this._camProjDirty = true;
    this._cockpitLive = false;
    this._povWarmKey = null;
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
    /** Frames that may reuse the last rearview image after seating (never if empty). */
    this._mirrorDefer = 0;
    /** True once the rearview RT holds a successful scene capture. */
    this._mirrorHasImage = false;
    this._shadowTick = 0;
    /** Extra countdown frames that skip quality adapt and force shadow updates. */
    this._raceWarmFrames = 0;
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
    showScreen(this.state === "menu" ? "screen-menu" : "screen-title", { instant: true });
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
    // Bind Start first, paint the splash, then mount the showroom on the next
    // frames. The hero GLB is HTML-preloaded so this is a present, not a wait.
    const bootGfx = () => {
      if (!this._bootGfx()) return;
      if (this.state === "title" || this.state === "menu") this._setupTitleStage();
    };
    requestAnimationFrame(() => requestAnimationFrame(bootGfx));
    // Light HTTP cache only. Props + stage meshes wait for PRESS START.
    this._startBackgroundWarm();
  }

  /**
   * WebGL waits until after PRESS START. Sky IBL on boot froze the tab
   * so the splash painted but clicks never ran.
   */
  _bootGfx() {
    if (this._gfxFailed) return false;
    if (this._gfxBooting) return !!(this.renderer && this.hemi);
    if (this.renderer && this.hemi) return true;
    if (this.renderer && !this.hemi) return false;
    this._gfxBooting = true;
    try {
      this._initRenderer();
      return !!(this.renderer && this.hemi);
    } catch (err) {
      this._gfxFailed = true;
      console.error(err);
      this._fatal("Graphics failed to start.", err);
      return false;
    } finally {
      this._gfxBooting = false;
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
      antialias: true,
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
    if (window.visualViewport) window.visualViewport.addEventListener("resize", this._onResize);
    if (isPhonePlay()) this._perfDprScale = 0.78;
    this._onResize();
    // Rearview RT is race/POV only — allocating it on splash hitchs the first paint.
    if (this.state !== "title" && this.state !== "menu") this._initMirror();
    this._bindMirrorContext();
    this._initEnv();

    this._sunDir = new THREE.Vector3(0.6, 0.72, 0.28).normalize();
    this.hemi = new THREE.HemisphereLight(0x8eb8e8, 0xa07842, 0.26);
    this.sun = new THREE.DirectionalLight(0xffe4b0, 1.65);
    this.sun.castShadow = false;
    const titleBoot = this.state === "title" || this.state === "menu";
    const bootShadow = titleBoot ? GFX.titleShadowMap || 1024 : 1024;
    this.sun.shadow.mapSize.set(bootShadow, bootShadow);
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
    this.sun.shadow.radius = cinema ? 2.6 : 2.2;
    this._raceShadowBias = this.sun.shadow.bias;
    this._raceShadowNormalBias = this.sun.shadow.normalBias;
    this._raceShadowRadius = this.sun.shadow.radius;
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
    // Always in the graph from boot so NUM_POINT_LIGHTS never changes on C.
    this._cabinFill = new THREE.PointLight(0xffe2c0, 0, 2.6, 1.7);
    this._cabinFill.castShadow = false;
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
      this._titleKick,
      this._cabinFill
    );

    this.sky = null;
    this.player = new Vehicle(CARS[this.carId]);
    const mountTitleCar = () => {
      this._syncCarSelectButtons();
      if (this.state !== "title" && this.state !== "menu") return;
      if (this.playerMesh && !this.playerMesh.userData.titleLod) return;
      if (!isTitleCarReady(this.carId) && !isGltfCar(this.carId)) return;
      try {
        this._showTitleLod(this.carId);
      } catch (err) {
        console.error(err);
        this._fatal("Car model failed to load.", err);
      }
    };
    const onGarageReady = () => {
      this._syncCarSelectButtons();
      for (const cid of Object.keys(this._carMeshPool)) this._invalidateCarMesh(cid);
      const loaded = isGltfCar();
      if (
        Array.isArray(loaded) &&
        loaded.length &&
        !isGltfCar(this.carId) &&
        !isTitleCarReady(this.carId)
      ) {
        this.carId = loaded[0];
        this.player = new Vehicle(CARS[this.carId]);
        this.audio.setCar(this.carId);
      }
      if (this.state === "title" || this.state === "menu") {
        mountTitleCar();
      } else if (isGltfCar(this.carId)) {
        try {
          this._promotePlayerCar();
        } catch (err) {
          console.error(err);
          this._fatal("Car model failed to load.", err);
        }
      }
      const el = document.getElementById("celica-status");
      if (el) el.textContent = garageStatus();
      this._stopGarageWatchIfComplete();
    };
    this._onGarageReady = onGarageReady;
    this._mountTitleCar = mountTitleCar;
    const titleReady = this._titleCarWarm || prepareTitleCar(this.carId);
    titleReady.then(() => {
      mountTitleCar();
      this._markShowroomLive();
    });
    this._stopCelicaWatch = watchForCelicaFile(onGarageReady);
    setTimeout(() => {
      if (this.state === "title") this._warmGarage();
    }, 4200);
  }

  /** Fade the attract canvas in once the hero car is on the pad. */
  _markShowroomLive() {
    const crt = document.getElementById("crt");
    if (crt) crt.classList.add("showroom-live");
  }

  /**
   * Remaining garage chassis wait until PRESS START (or a few idle seconds)
   * so splash only needs the title hero.
   */
  _warmGarage() {
    if (this._garageWarmStarted) return;
    // Never fight a stage build / race for the main thread.
    if (
      this.state === "loading" ||
      this.state === "countdown" ||
      this.state === "race"
    ) {
      return;
    }
    this._garageWarmStarted = true;
    prepareCelica(() => {
      if (
        this.state === "loading" ||
        this.state === "countdown" ||
        this.state === "race"
      ) {
        return;
      }
      this._syncCarSelectButtons();
    })
      .then(() => {
        if (this._onGarageReady) this._onGarageReady();
      })
      .catch((err) => console.warn("[garage] warm failed", err));
  }

  /**
   * Title LOD or hero GLB is enough to pick — the race load path already
   * awaits prepareHeroCar. Waiting on the 7 MB hero left Celica disabled
   * while Delta finished first, so championship smoke clicked a dead button.
   * @param {string} id
   */
  _carSelectable(id) {
    return isGltfCar(id) || isTitleCarReady(id);
  }

  /** Disable car picks until that chassis GLB (LOD or hero) is loaded. */
  _syncCarSelectButtons() {
    document.querySelectorAll("[data-car]").forEach((btn) => {
      const id = btn.dataset.car;
      if (!id) return;
      const ready = this._carSelectable(id);
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
    this._ensureMirrorRT();
    if (this._mirrorRT) setCockpitMirrorMap(mesh, this._mirrorRT.texture);
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

  /**
   * Hero attract mesh for title / SELECT MODE. Cockpit still waits until race.
   * @param {string} id
   */
  _showTitleLod(id) {
    if (!this.scene) return;
    if (
      this.playerMesh &&
      this.playerMesh.userData.titleLod &&
      this.playerMesh.userData.carId === id
    ) {
      this.playerMesh.visible = true;
      if (this._titleShowcase) this._applyTitleCarShowcase(true);
      this._titleCam(0);
      this._markShowroomLive();
      return;
    }
    if (this.playerMesh && !this.playerMesh.userData.titleLod) return;
    const mesh = createTitleCar(id);
    if (this.playerMesh) this.scene.remove(this.playerMesh);
    this.playerMesh = mesh;
    this.scene.add(mesh);
    if (!this._contactBlobs) this._initContactBlobs();
    if (this._titleShowcase) this._applyTitleCarShowcase(true);
    this._titleCam(0);
    this._markShowroomLive();
  }

  /**
   * Swap the splash LOD for the hero cockpit car before countdown.
   * @returns {boolean}
   */
  _promotePlayerCar() {
    if (!isGltfCar(this.carId)) return false;
    if (
      this.playerMesh &&
      !this.playerMesh.userData.titleLod &&
      this.playerMesh.userData.carId === this.carId
    ) {
      return true;
    }
    this._swapPlayerCar(this.carId);
    return !!(this.playerMesh && !this.playerMesh.userData.titleLod);
  }

  /** @param {string} id */
  _swapPlayerCar(id) {
    const next = this._ensureCarMesh(id);
    if (!next) return;
    if (this.playerMesh && this.playerMesh !== next) {
      setCockpitView(this.playerMesh, false, this.camera);
      if (this.playerMesh.userData.titleLod) this.scene.remove(this.playerMesh);
      else this.playerMesh.visible = false;
    }
    this.playerMesh = next;
    next.visible = true;
    this._ensureMirrorRT();
    if (this._mirrorRT) setCockpitMirrorMap(next, this._mirrorRT.texture);
    if (this.scene.environment) {
      if (this._titleShowcase) this._applyTitleCarShowcase(true);
      else applyEnvMap(next, this.scene.environment, VISUAL.carEnvIntensity ?? 0.52);
    }
    this._povWarmKey = "";
    this._applyCockpitCam();
    if (this.state === "race" || this.state === "countdown") this._warmPov();
  }

  _invalidateCarMesh(id) {
    const mesh = this._carMeshPool[id];
    if (mesh) {
      if (this.playerMesh === mesh) this.playerMesh = null;
      if (this.scene) this.scene.remove(mesh);
      delete this._carMeshPool[id];
    }
  }

  /**
   * Splash stays cheap. After a short idle we HTTP-cache Desert music only.
   * Prop kit + stage meshes start on PRESS START (_leaveTitle) so the attract
   * loop is not fighting four Track.create jobs.
   */
  _startBackgroundWarm() {
    setTimeout(() => {
      if (this.state !== "title") return;
      this._prefetchStageBytes(false);
    }, 2800);
  }

  /**
   * HTTP-cache stage music so the first race decode is a hit.
   * Safe without AudioContext / user gesture. `all` waits until PRESS START.
   * @param {boolean} [all]
   */
  _prefetchStageBytes(all = false) {
    const urls = all
      ? [
          "assets/music/desert.mp3?v=4",
          "assets/music/forest.mp3?v=4",
          "assets/music/mountain.mp3?v=4",
          "assets/music/lakeside.mp3?v=4",
          "assets/music/result.mp3?v=4",
        ]
      : ["assets/music/desert.mp3?v=4"];
    if (all) {
      if (this._bytesPrefetchedAll) return;
      this._bytesPrefetchedAll = true;
      this._bytesPrefetched = true;
    } else {
      if (this._bytesPrefetched) return;
      this._bytesPrefetched = true;
    }
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
      if (!this.sparks) this.sparks = new ImpactSparks(this.scene);
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
    if (this._preloadBuilding === courseId) return;
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
        // Terrain can start while PRESS START's prop-kit fetch is still in
        // flight. Track.create awaits the kit at 52% — waiting here first
        // froze the loading bar for a minute before any tarmac appeared.
        await yieldFrame();
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
        // Always release this job's slot. A priority cancel used to leave
        // `_preloadBuilding` set, so the queue deadlocked and `_beginRace`
        // started a second Track.create in parallel (tab freeze / CDP timeout).
        if (this._preloadBuilding === courseId) {
          this._preloadBuilding = null;
          this._preloadProgress = null;
        }
        if (this._preloadToken === token) this._preloadToken = null;
        this._preloadPromise = null;
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

    // Start on the next frame — setTimeout so a paused rAF cannot stall load.
    this._preloadPromise = new Promise((resolve) => {
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        run().then(resolve);
      };
      requestAnimationFrame(start);
      setTimeout(start, 0);
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
          yieldFrame(),
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
    // Promote to front of queue, but never sit 90s waiting for a different
    // stage that may have wedged. Cancel the foreign build and let the caller
    // Track.create the requested course; the cancelled job disposes itself.
    if (this._preloadQueue.includes(courseId) || this._preloadBuilding) {
      if (this._preloadBuilding && this._preloadBuilding !== courseId) {
        this._preloadToken = Symbol("preload-cancel");
        const tCancel = Date.now();
        while (
          this._preloadPromise &&
          this._preloadBuilding &&
          this._preloadBuilding !== courseId &&
          Date.now() - tCancel < 4000
        ) {
          if (report) report(0.08, "Switching stage…");
          await Promise.race([this._preloadPromise, yieldFrame()]);
        }
        // Slot still held by a wedged foreign build — clear so we can create.
        if (this._preloadBuilding && this._preloadBuilding !== courseId) {
          this._preloadBuilding = null;
          this._preloadPromise = null;
          this._preloadProgress = null;
        }
      } else {
        this._scheduleTrackPreload(courseId, { priority: true });
      }
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
        this.codriver.warm(this.audio);
        this.codriver.setVolume(v, this.audio);
        label(navVal, v);
        this.codriver.preview(this.audio);
      });
    }
  }

  _leaveTitle() {
    window.__rallyLeftTitle = true;
    if (this.state !== "title") return;
    this.state = "menu";
    try {
      this.audio.unlock();
      this.codriver.warm(this.audio);
    } catch (err) {
      console.warn(err);
    }
    this._markShowroomLive();
    showScreen("screen-menu", { instant: true });
    this._idleWarmAfterTitle();
  }

  /**
   * After PRESS START the showroom is already on screen. Do not rebuild
   * lighting, clone cars, or start Track.create on this click.
   */
  _idleWarmAfterTitle() {
    const later = (ms, fn) => {
      setTimeout(() => {
        if (this.state === "race" || this.state === "countdown" || this.state === "loading") return;
        fn();
      }, ms);
    };
    later(80, () => {
      if (!this.renderer) this._bootGfx();
    });
    later(900, () => {
      prefetchPropKit().catch((err) => console.warn("[warm] prop kit", err));
    });
    later(1400, () => this._prefetchStageBytes(false));
    // Do NOT prepareCelica() here. Parsing three hero GLBs (Stratos ~8 MB)
    // on the same main thread as Desert Track.create wedges the loading screen
    // past a minute. Cars unlock from rival LODs; heroes warm in `_loadTrackAsync`.
    later(2800, () => {
      if (this.audio && this.audio.cd && this.audio.cd.warmIdle) this.audio.cd.warmIdle();
    });
  }

  _onMenu(id) {
    this.audio.unlock();
    this.codriver.warm(this.audio);
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
      showScreen("screen-controls", { instant: true });
    } else if (id === "back") {
      showScreen("screen-menu", { instant: true });
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
    // Unlock the car buttons with the decimated rival LODs, which is all
    // _carSelectable needs (isTitleCarReady accepts a rival template). Warming
    // the full garage here instead parsed every 7 MB hero GLB right as the
    // player picked a car, and the parse then fought the track build for the
    // main thread — the Desert load blew past 120 s. These LODs are needed for
    // the pack anyway, so this is pull-forward, not extra work.
    prepareRivalLods(() => this._syncCarSelectButtons()).catch((err) =>
      console.warn("[garage] LOD warm failed", err)
    );
    this._syncCarSelectButtons();
    const stratos = document.querySelector("[data-car='stratos']");
    if (stratos) {
      stratos.disabled = !this._carSelectable("stratos");
      stratos.textContent = this._carSelectable("stratos")
        ? "STRATOS HF  ·  RWD SLIDE"
        : "STRATOS HF  ·  LOADING…";
    }
    showScreen("screen-cars", { instant: true });
  }

  _pickCar(id) {
    if (!this._carSelectable(id)) {
      if (this.hud) this.hud.flashMessage("MODEL NOT LOADED");
      return;
    }
    this.carId = id;
    this.player = new Vehicle(CARS[id]);
    this.audio.setCar(id);

    // Championship starts the race from this click. Do not also
    // `_scheduleTrackPreload` here — that used to start a second Track.create
    // on the same turn and freeze the tab. `_beginRace` joins any idle warm
    // or builds once.
    if (this.mode === "championship") {
      const next = this.champOrder[this.stageIndex] || this.champOrder[0];
      this._beginRace(next);
      return;
    }

    this._refreshCourseLock();
    showScreen("screen-courses", { instant: true });
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
    if (this.track && this.track.group) this.track.group.visible = false;
    for (const o of this.opponents) if (o.mesh) o.mesh.visible = false;
    if (this.renderer) this._setupTitleStage();
    const staleTrack = this.track;
    const stalePack = this.opponents;
    this.track = null;
    this.opponents = [];
    requestAnimationFrame(() => {
      if (staleTrack) {
        if (this.scene) this.scene.remove(staleTrack.group);
        try {
          staleTrack.dispose();
        } catch {
          /* already gone */
        }
      }
      if (this.scene) {
        for (const o of stalePack) this.scene.remove(o.mesh);
      }
    });
  }

  /**
   * Attract mode is a showroom pad: sky, tarmac, dunes, hero car.
   */
  _setupTitleStage() {
    if (!this.scene) return;
    try {
      this._applyTitleLighting();
      this._markShowroomLive();
    } catch (err) {
      // Showroom is cosmetics. A throw here used to trip the boot overlay
      // and cover PRESS START so the game could never leave the splash.
      console.warn("[title] showroom failed", err);
    }
  }

  /**
   * Wet asphalt pad + kerb + sand apron + textured apron ground.
   * Distant Kenney rocks load async. No sphere-blob dunes.
   */
  _ensureTitleWorld() {
    if (this._titleWorld) return;
    const group = new THREE.Group();
    group.name = "title-showroom";
    const aniso = Math.min(8, this.renderer && this.renderer.capabilities
      ? this.renderer.capabilities.getMaxAnisotropy()
      : 4);

    const asphaltMaps = makeTitleAsphaltMaps();
    asphaltMaps.color.anisotropy = aniso;
    asphaltMaps.roughness.anisotropy = aniso;
    const asphalt = new THREE.Mesh(
      new THREE.CircleGeometry(9.4, 96),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        map: asphaltMaps.color,
        roughnessMap: asphaltMaps.roughness,
        roughness: 0.42,
        metalness: 0.14,
        envMapIntensity: 1.15,
        clearcoat: 0.28,
        clearcoatRoughness: 0.48,
      })
    );
    asphalt.rotation.x = -Math.PI / 2;
    asphalt.receiveShadow = true;
    asphalt.position.y = 0;
    group.add(asphalt);
    this._titleFloor = asphalt;

    const kerbGeo = new THREE.RingGeometry(9.32, 9.88, 96, 1);
    kerbGeo.rotateX(-Math.PI / 2);
    const kerbCol = new Float32Array(kerbGeo.attributes.position.count * 3);
    const pos = kerbGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const ang = Math.atan2(pos.getZ(i), pos.getX(i));
      const stripe = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 22) % 2 === 0;
      if (stripe) {
        kerbCol[i * 3] = 0.86;
        kerbCol[i * 3 + 1] = 0.12;
        kerbCol[i * 3 + 2] = 0.1;
      } else {
        kerbCol[i * 3] = 0.94;
        kerbCol[i * 3 + 1] = 0.91;
        kerbCol[i * 3 + 2] = 0.84;
      }
    }
    kerbGeo.setAttribute("color", new THREE.BufferAttribute(kerbCol, 3));
    const kerb = new THREE.Mesh(
      kerbGeo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.36,
        metalness: 0.08,
        envMapIntensity: 0.72,
      })
    );
    kerb.position.y = 0.03;
    kerb.receiveShadow = true;
    group.add(kerb);

    const sandMap = makeTitleSandMap();
    sandMap.anisotropy = aniso;
    const sandMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: sandMap,
      roughness: 0.9,
      metalness: 0.03,
      envMapIntensity: 0.38,
    });
    const sand = new THREE.Mesh(new THREE.RingGeometry(9.78, 26, 72, 1), sandMat);
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = -0.035;
    sand.receiveShadow = true;
    group.add(sand);

    const groundMap = makeTitleSandMap();
    groundMap.repeat.set(14, 14);
    groundMap.anisotropy = aniso;
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(88, 48),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: groundMap,
        roughness: 0.96,
        metalness: 0.0,
        envMapIntensity: 0.22,
      })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.12;
    ground.receiveShadow = true;
    group.add(ground);

    this.scene.add(group);
    this._titleWorld = group;
    this._plantTitleRocks();
  }

  /**
   * Kenney rock GLBs around the pad. Async — splash never waits on them.
   */
  _plantTitleRocks() {
    if (this._titleRocksAsked) return;
    this._titleRocksAsked = true;
    loadTitleRocks()
      .then((templates) => {
        if (!this._titleWorld || this.state === "race" || this.state === "countdown") return;
        // Mid + far ring so the horizon has mass, not empty sky under the car.
        const poses = [
          { kind: "rock_largeA", a: 0.28, d: 16.8, s: 1.35, ry: 0.4 },
          { kind: "rock_tallA", a: 0.72, d: 19.2, s: 1.12, ry: 1.6 },
          { kind: "rock_largeB", a: 1.18, d: 24.5, s: 1.55, ry: 1.1 },
          { kind: "rock_smallA", a: 1.55, d: 15.4, s: 0.88, ry: 0.5 },
          { kind: "rock_tallA", a: 2.02, d: 22.4, s: 1.38, ry: 2.2 },
          { kind: "rock_largeA", a: 2.48, d: 28.0, s: 1.72, ry: 0.2 },
          { kind: "rock_largeB", a: 2.95, d: 17.6, s: 1.28, ry: 2.5 },
          { kind: "rock_smallA", a: 3.42, d: 20.8, s: 1.05, ry: 1.7 },
          { kind: "rock_largeA", a: 3.88, d: 26.2, s: 1.62, ry: 3.0 },
          { kind: "rock_tallA", a: 4.38, d: 18.4, s: 1.22, ry: 0.9 },
          { kind: "rock_largeB", a: 4.92, d: 25.6, s: 1.48, ry: 2.8 },
          { kind: "rock_smallA", a: 5.42, d: 16.2, s: 0.95, ry: 3.4 },
          { kind: "rock_largeA", a: 5.88, d: 23.8, s: 1.58, ry: 1.3 },
          { kind: "rock_tallA", a: 0.05, d: 31.5, s: 1.85, ry: 0.7 },
        ];
        const box = new THREE.Box3();
        for (const pose of poses) {
          const src = templates[pose.kind];
          if (!src) continue;
          const node = src.clone(true);
          node.scale.setScalar(pose.s);
          node.rotation.y = pose.ry;
          node.position.set(Math.sin(pose.a) * pose.d, 0, Math.cos(pose.a) * pose.d);
          this._titleWorld.add(node);
          box.setFromObject(node);
          if (Number.isFinite(box.min.y)) node.position.y -= box.min.y;
        }
      })
      .catch((err) => console.warn("[title] rocks", err));
  }

  /**
   * Showroom rig for the splash car: sky IBL, three-point light, lacquer boost.
   * Race lighting in _updateLights() must not stomp these values every frame.
   */
  _applyTitleLighting() {
    if (!this.scene || !this.renderer || !this.hemi || !this.sun) return;
    const L = LIGHTING.title;
    this._titleShowcase = true;
    this._ensureTitleWorld();
    if (this._titleWorld) {
      this._titleWorld.visible = true;
      if (!this._titleWorld.parent) this.scene.add(this._titleWorld);
    }
    this._plantTitleRocks();
    if (this._titleFloor) this._titleFloor.visible = true;
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
    applySky(this.sky, L, "title");
    if (this.dust && this.dust.setAtmosphere) this.dust.setAtmosphere(L);
    this._ensureTitleReflectCam();
    if (this._titleIblTimer) clearTimeout(this._titleIblTimer);
    this._titleIblTimer = 0;
    if (!this._titleIblReady) {
      const iblDelay =
        TITLE_SHOWROOM && TITLE_SHOWROOM.iblDelayMs != null ? TITLE_SHOWROOM.iblDelayMs : 420;
      this._titleIblTimer = setTimeout(() => {
        this._titleIblTimer = 0;
        if (this.state !== "title" && this.state !== "menu") return;
        try {
          this._bakeSkyEnv("title");
          this._titleIblReady = true;
          this._applyTitleCarShowcase(true);
        } catch (err) {
          console.warn("Title IBL failed", err);
        }
      }, iblDelay);
    }
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
    this.sun.castShadow = false;
    this._titleShadowFrustReady = false;
    this._tunnelBlend = 0;
    this._applyTitleCarShowcase(true);
    // Soft bloom / grade — balanced keeps bloom; AO off for pad cost.
    if (this.post && VISUAL.postFx !== false && (VISUAL.tier || 0) >= 9) {
      this.post.enabled = true;
      this.post.setQuality("balanced");
      this.post.syncFromConfig(L);
      if (this.post._compMat && this.post._compMat.uniforms) {
        const u = this.post._compMat.uniforms;
        if (u.aoStrength) u.aoStrength.value = 0;
        if (u.bloomStrength) u.bloomStrength.value = 0.18;
        if (u.vignette) u.vignette.value = 0.48;
        if (u.grain) u.grain.value = 0;
        if (u.contrast) u.contrast.value = 1.1;
        if (u.saturation) u.saturation.value = 1.05;
        if (u.warmth) u.warmth.value = L.gradeWarmth != null ? L.gradeWarmth : 0.12;
      }
      // Flag so render() can skip SSAO on the attract pad.
      this.post._titleShowroom = true;
    } else if (this.post) {
      this.post.enabled = false;
      this.post.setQuality("low");
      this.post._titleShowroom = false;
    }
    if (!this._titleShadowArmed) {
      this._titleShadowArmed = true;
      setTimeout(() => {
        if (!this.sun || !this.renderer) return;
        if (this.state !== "title" && this.state !== "menu") return;
        this.renderer.shadowMap.enabled = true;
        this.sun.castShadow = true;
        this._setShadowMapSize(GFX.titleShadowMap || 2048);
      }, 700);
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
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      if (!on) return;
      // Named hubs plus any mesh whose name is rubber/rim — GLBs do not
      // always land in userData.wheels, and spinning spokes strobe the pad.
      const n = `${o.name || ""} ${o.parent && o.parent.name ? o.parent.name : ""}`.toLowerCase();
      if (/wheel|tire|tyre|rim|brake|disc|caliper|rotor/.test(n)) o.castShadow = false;
    });
    if (on) {
      const wheels = this.playerMesh.userData && this.playerMesh.userData.wheels;
      if (Array.isArray(wheels)) {
        for (let i = 0; i < wheels.length; i++) {
          const hub = wheels[i];
          if (!hub || !hub.traverse) continue;
          hub.traverse((o) => {
            if (o.isMesh) o.castShadow = false;
          });
        }
      }
    }
  }

  /**
   * Title-only light rig — keeps fill on the lens and a rim on the silhouette.
   * @param {number} dt
   */
  _updateTitleLights(dt) {
    if (!this.sun || !this.hemi || !this.renderer) return;
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

    if (!this._titleShadowFrustReady) {
      const ext = 11;
      this.sun.shadow.camera.left = -ext;
      this.sun.shadow.camera.right = ext;
      this.sun.shadow.camera.top = ext;
      this.sun.shadow.camera.bottom = -ext;
      this.sun.shadow.camera.near = 8;
      this.sun.shadow.camera.far = 80;
      this.sun.shadow.camera.updateProjectionMatrix();
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.08;
      this.sun.shadow.radius = 2.2;
      this._titleShadowFrustReady = true;
    }
  }

  /**
   * Scene captures (cube IBL, PMREM) call renderer.render internally.
   * If the shadow map is allowed to bake then, a hidden car writes an empty
   * map and the ground shadow strobes on the next present.
   * @param {() => void} fn
   */
  _withShadowMapPaused(fn) {
    const sm = this.renderer.shadowMap;
    const prevEnabled = sm.enabled;
    const prevNeeds = sm.needsUpdate;
    sm.enabled = false;
    sm.needsUpdate = false;
    try {
      fn();
    } finally {
      sm.enabled = prevEnabled;
      sm.needsUpdate = prevNeeds;
    }
  }

  /** Live cube capture on title only — paint picks up the moving sky + pad. */
  _updateTitleReflections() {
    if (!this._reflectCam || !this.playerMesh || !this._titleIblReady) return;
    const every =
      TITLE_SHOWROOM && TITLE_SHOWROOM.reflectEvery != null ? TITLE_SHOWROOM.reflectEvery : 6;
    if (!every) return;
    this._titleReflectTick += 1;
    if (this._titleReflectTick % every !== 0) return;
    const mesh = this.playerMesh;
    const vis = mesh.visible;
    const blobs = this._contactBlobs;
    const blobVis = blobs ? blobs.map((b) => b.visible) : null;
    mesh.visible = false;
    if (blobs) for (let i = 0; i < blobs.length; i++) blobs[i].visible = false;
    this._withShadowMapPaused(() => {
      this._reflectCam.position.set(0, 0.72, 0);
      this._reflectCam.update(this.renderer, this.scene);
    });
    mesh.visible = vis;
    if (blobs && blobVis) {
      for (let i = 0; i < blobs.length; i++) blobs[i].visible = blobVis[i];
    }
    const L = LIGHTING.title;
    applyEnvMap(mesh, this._reflectRT.texture, L.envIntensity * 0.95);
    setShowcaseReflectivity(mesh, true, this._reflectRT.texture, {
      bodyEnv: L.bodyEnv,
      chromeEnv: L.chromeEnv,
      glassEnv: L.glassEnv,
    });
  }

  /**
   * Title-only CubeCamera — race keeps reflectEvery at 0 to save GPU.
   */
  _ensureTitleReflectCam() {
    const every =
      TITLE_SHOWROOM && TITLE_SHOWROOM.reflectEvery != null ? TITLE_SHOWROOM.reflectEvery : 6;
    if (!every) return;
    if (this._reflectCam && this._reflectRT) return;
    const size =
      (TITLE_SHOWROOM && TITLE_SHOWROOM.cubeSize) || GFX.cubeSize || 96;
    this._reflectRT = new THREE.WebGLCubeRenderTarget(size, {
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    });
    this._reflectCam = new THREE.CubeCamera(0.45, 220, this._reflectRT);
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
    const tick = () => yieldFrame();

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
    await tick();
    this._applyLighting(def.id);

    if (!preview) {
      report(fromCache ? 0.955 : 0.89, "Loading cars…");
      await Promise.all([prepareHeroCar(this.carId), prepareRivalLods()]).catch((err) => {
        console.warn("[load] car warm", err);
      });
      this._promotePlayerCar();
    }

    report(fromCache ? 0.96 : 0.9, "Spawning grid…");
    await tick();

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
        }
      }
      report(0.98, "Grid ready…");
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
      }
      if (n > 0) report(0.98, "Grid ready…");
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
    this._warmPov();
    this._applyCockpitCam();
    if (this._titleFloor) this._titleFloor.visible = false;
    if (this._titleWorld) {
      this._titleWorld.visible = false;
      if (this._titleWorld.parent) this.scene.remove(this._titleWorld);
    }
    if (this._titleShowcase) {
      this._titleShowcase = false;
      this._applyTitleCarShowcase(false);
    }
    this._titleRim.intensity = 0;
    this._titleKick.intensity = 0;
    this.renderer.shadowMap.enabled = true;
    this.sun.castShadow = true;
    this._setShadowMapSize(2048);
    if (this.post) {
      this.post._titleShowroom = false;
      this.post.enabled = VISUAL.postFx !== false && (VISUAL.tier || 0) >= 9;
      this.post.setQuality("balanced");
    }
    if (this._raceShadowBias != null) this.sun.shadow.bias = this._raceShadowBias;
    if (this._raceShadowNormalBias != null) this.sun.shadow.normalBias = this._raceShadowNormalBias;
    if (this._raceShadowRadius != null) this.sun.shadow.radius = this._raceShadowRadius;
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
    this._applyRivalLod();
    this._syncContactBlobs(1);
  }

  /**
   * Far rivals drop shadow casting — 14 packed GLBs filling the shadow map
   * was the pack-race hitch. Near cars keep contact shadows.
   */
  _applyRivalLod() {
    if (!this.camera || !this.opponents.length) return;
    const cx = this.camera.position.x;
    const cz = this.camera.position.z;
    const far2 = 92 * 92;
    for (let i = 0; i < this.opponents.length; i++) {
      const mesh = this.opponents[i].mesh;
      if (!mesh) continue;
      const dx = mesh.position.x - cx;
      const dz = mesh.position.z - cz;
      const far = dx * dx + dz * dz > far2;
      if (mesh.userData.lodFar === far) continue;
      mesh.userData.lodFar = far;
      if (!mesh.userData.lodShadowCasters) {
        const list = [];
        mesh.traverse((obj) => {
          if (obj.isMesh && obj.castShadow) list.push(obj);
        });
        mesh.userData.lodShadowCasters = list;
      }
      const list = mesh.userData.lodShadowCasters;
      for (let j = 0; j < list.length; j++) list[j].castShadow = !far;
    }
  }

  /**
   * Ghost any rival sitting on the chase-camera → player sightline so the
   * player's car stays readable. POV skips this (the camera is the player).
   * Amounts update here; paintPackSeeThrough runs after the mirror capture.
   * @param {boolean} chase
   * @param {number} dt
   */
  _fadeBlockingPack(chase, dt) {
    const pack = this._fadePack || (this._fadePack = []);
    pack.length = 0;
    for (let i = 0; i < this.opponents.length; i++) {
      const mesh = this.opponents[i].mesh;
      if (mesh && mesh.visible && mesh !== this.playerMesh) pack.push(mesh);
    }
    if (this.ghostMesh && this.ghostMesh.visible && this.ghostMesh !== this.playerMesh) {
      pack.push(this.ghostMesh);
    }
    const carPos = this.playerMesh ? this.playerMesh.position : this.camera.position;
    updatePackSeeThrough(pack, this.camera.position, carPos, chase, dt);
  }

  /**
   * @param {number} scale 0 = solid for mirror/cube, 1 = chase leftover opacity
   */
  _paintBlockingPack(scale) {
    paintPackSeeThrough(this._fadePack, scale);
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
      mat.opacity = i === 0 ? 0.78 : 0.5;
      mat.color.setHex(i === 0 ? 0x0c0a08 : 0x14100c);
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
      const onPad = this._titleShowcase || this.state === "title" || this.state === "menu";
      if (onPad) {
        if (i !== 0) {
          mesh.visible = false;
          continue;
        }
        st.y = 0;
        mesh.visible = true;
        mesh.position.set(d.x, 0.03, d.z);
        mesh.rotation.set(0, d.yaw, 0);
        mesh.scale.set(1.55, 1, 2.95);
        if (mesh.material) mesh.material.opacity = 0.52;
        continue;
      }
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
    this.player.confirmOnRoad(this.track);
    for (const o of this.opponents) {
      o.vehicle.stabilize();
      o.vehicle.confirmOnRoad(this.track);
    }
  }

  /**
   * Start a race. A hot cache skips the terrain rebuild, not the loading
   * overlay — GPU settle (IBL, stream, shaders, shadows) still happens
   * before countdown so lighting and scenery cannot pop in on 3-2-1.
   * @param {string} courseId
   */
  async _beginRace(courseId) {
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
    showLoadingScreen({
      title: def && def.name ? def.name : String(courseId || "STAGE").toUpperCase(),
      subtitle: stage,
      status: instant
        ? "Lighting stage…"
        : building
          ? "Finishing background stage…"
          : "Preparing course…",
    });
    if (instant) setLoadingProgress(0.9, "Lighting stage…");
    // Two real frames so #screen-loading paints before SFX / Track.create.
    await yieldFrame();
    await yieldFrame();
    if (gen !== this._loadGen) return;
    try {
      if (this.audio && this.audio._bootSfxGraph) this.audio._bootSfxGraph();
      if (this.audio && this.audio.cd && this.audio.cd.warmIdle) this.audio.cd.warmIdle();
    } catch {
      /* music already running */
    }
    this._startRace(courseId, gen).catch((err) => {
      if (gen !== this._loadGen) return;
      console.error(err);
      this._fatal(`Course "${courseId}" failed to build.`, err);
      showScreen("screen-menu");
      this.state = "menu";
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
    setLoadingProgress(0.97, "Lighting stage…");
    this._plantStartGrid();
    this._onResize();
    setLoadingProgress(0.99, "Warming shaders…");
    await yieldFrame();
    this._settleRacePresent();
    if (loadGen !== this._loadGen) return;
    setLoadingProgress(1, "Ready");
    // Second guard against a latched QA override: no hold may survive into a
    // race the player just started. QA tools arm _qaDrive after the grid is
    // live, so this never cancels a legitimate run.
    this._qaDrive = null;
    if (this.input) {
      this.input._qaHold = null;
      this.input.qaReleased = false;
    }
    this.state = "countdown";
    this.countdown = 3;
    this._countHold = true;
    this.raceTime = 0;
    this._physAccum = 0;
    this.nextCp = 0;
    this._nextStagePreloadArmed = false;
    this.lap = 1;
    this.paceLine = "";
    this.codriver.gap = PACE.speakGap || this.codriver.gap;
    this.codriver.reset();
    this.ghostRecorder.start(courseId, this.carId);
    this.telemetry.start();
    this.telemetry.exposeGlobal();
    this._setupGhostPlayback();
    this.timeLeft = this.mode === "timeattack" ? 999 : CHAMPIONSHIP.stageTime[courseId] || 80;
    this.crossedFinish = false;
    this._countShown = "";
    this.audio.restoreRaceLoops();
    this.audio.setCar(this.carId);
    await showScreen("screen-hud");
    this._countHold = false;
    this._countShown = "3";
    this.hud.flashMessage("3");
    this.audio.countBeep(3);
    if (this.mode === "championship" && this.champOrder.length) {
      const nextId = this._nextChampCourseId();
      if (nextId) {
        this._pinnedPreloadId = nextId;
        this._scheduleTrackPreload(nextId, { priority: true });
      }
    }
  }

  /**
   * Finish GPU work under the loading overlay: stream the start grid, bake
   * IBL, compile shaders, and draw shadowed frames so countdown does not pop-in.
   */
  _settleRacePresent() {
    if (!this.renderer || !this.scene || !this.camera) return;
    if (this._titleShowcase) {
      this._titleShowcase = false;
      this._applyTitleCarShowcase(false);
    }
    if (this._titleRim) this._titleRim.intensity = 0;
    if (this._titleKick) this._titleKick.intensity = 0;
    if (this._titleFloor) this._titleFloor.visible = false;
    if (this._titleWorld) {
      this._titleWorld.visible = false;
      if (this._titleWorld.parent) this.scene.remove(this._titleWorld);
    }

    this.renderer.shadowMap.enabled = true;
    this.sun.castShadow = true;
    if (this._raceShadowBias != null) this.sun.shadow.bias = this._raceShadowBias;
    if (this._raceShadowNormalBias != null) this.sun.shadow.normalBias = this._raceShadowNormalBias;
    if (this._raceShadowRadius != null) this.sun.shadow.radius = this._raceShadowRadius;

    this._updateLights(0);
    this._syncWorldStream(true);
    const radius = STREAM.countdownLoadRadius || 720;
    if (this.track && this.track.prewarmAround && this.player && this.player.position) {
      this.track.prewarmAround(this.player.position, this.camera.position, radius);
    }
    this._syncWorldStream(true);
    this._warmPov();

    // Race quality BEFORE the warm draws. Title/showroom can leave a 4096 atlas
    // + AO + high DPR armed; two SwiftShader presents at that cost used to stall
    // the loading screen past a minute before countdown ever painted.
    this._lastPresentCost = 8;
    this._raceWarmFrames = 8;
    this._shadowTick = 0;
    this._qualityDprFloor = null;
    this._qualityShadowFloor = null;
    this._qualityMirrorEvery = 1;
    this.perfTier = createPerfTier(GFX, { startTier: isPhonePlay() ? "low" : "medium" });
    this._applyQualityTier(this.perfTier.current());

    this._precompileStage();

    const present = () => {
      this.renderer.shadowMap.needsUpdate = true;
      if (this.post && this.post.enabled) this.post.render(this.scene, this.camera);
      else this.renderer.render(this.scene, this.camera);
    };
    try {
      present();
      present();
    } catch (err) {
      console.warn("Race present warm failed", err);
      this.renderer.setRenderTarget(null);
    }
  }

  /**
   * Link shaders for the start-grid view while the loading screen is up.
   *
   * `renderer.compile` only walks visible objects. The start radius is already
   * prewarmed. Compiling the entire stage (showAllChunks) was a multi-second
   * load tax for a hitch the scaler and streaming can absorb later.
   */
  _precompileStage() {
    if (!this.renderer || !this.scene || !this.camera) return;
    const t0 = performance.now();
    try {
      this.renderer.compile(this.scene, this.camera);
      if (this._mirrorCam && performance.now() - t0 < PRECOMPILE_BUDGET_MS) {
        this.renderer.compile(this.scene, this._mirrorCam);
      }
    } catch (err) {
      console.warn("Stage precompile failed", err);
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

        if (this.touch) {
          const driving = this.state === "race" || this.state === "countdown";
          this.touch.setLive(driving);
        }
        if (this._qaDrive) {
          this.input._qaHold = this._qaDrive;
          if (this.state === "countdown") this.countdown = 0;
        }
        this.input.poll();
        // A human touching the controls retires the QA override permanently.
        // Without this the block below would re-apply _qaDrive straight onto
        // this.input every frame and undo the release input.js just made.
        if (this.input.qaReleased) {
          this._qaDrive = null;
          this.input._qaHold = null;
          this.input.qaReleased = false;
        }
        if (this._qaDrive) {
          const hold = this._qaDrive;
          if (hold.throttle != null) this.input.throttle = hold.throttle;
          if (hold.steer != null) this.input.steer = hold.steer;
          if (hold.brake != null) this.input.brake = hold.brake;
          if (hold.handbrake != null) this.input.handbrake = hold.handbrake;
          if (this.player) {
            this.player.autoTrans = true;
            if (this.player.gear < 1) this.player.gear = 1;
          }
        }
        if (this.input.camera) {
          // Attract / garage keep the orbit showroom — never attach POV under the car.
          if (this.state !== "title" && this.state !== "menu") {
            this._cycleCamera();
          }
        }
        if (this.input.transToggle && this.player) {
          this.player.autoTrans = !this.player.autoTrans;
        }

        const onTitle = this.state === "title" || this.state === "menu";
        const capRender = GFX.lockRenderFps !== false && this.renderer;
        // The scaler owns the cadence: 60 Hz, or a deliberate 30 Hz once this
        // stage has proven it cannot hold 60 at the cheapest tier. Presenting
        // on a fixed cadence is what makes the frame rate *consistent* — free
        // running produced an uneven 46 fps.
        const presentHz =
          (this.perfTier && !onTitle ? this.perfTier.presentHz : 0) || GFX.targetFps || 60;
        const frameMs = 1000 / presentHz;
        const settling =
          this.state === "loading" ||
          this.state === "countdown" ||
          (this._raceWarmFrames || 0) > 0;
        const skipPresent =
          this.state === "loading" ||
          (capRender && this._lastPresent > 0 && now - this._lastPresent < frameMs - 0.4);

        // Physics always advances — capping render must not drop sim time or
        // steering feels half-speed on 120 Hz panels (was bundling _fixed here).
        this._fixed(dt);
        if (this._qaDrive && this.state === "race" && this.player) {
          if (!this._qaSamples) this._qaSamples = [];
          if (this._qaSamples.length < 400) {
            const s = this.qaSnapshot();
            s.glitchLog = undefined;
            this._qaSamples.push(s);
          }
        }
        if (this._raceWarmFrames > 0 && this.state !== "loading") this._raceWarmFrames -= 1;
        if (!skipPresent) {
          const t0 = performance.now();
          this._render(dt);
          this._lastPresentCost = performance.now() - t0;
          // Time between presents, not the CPU cost of issuing the draws.
          // renderer.render() returns once commands are queued, so a GPU-bound
          // machine reports a 5 ms "render" while actually delivering 37 ms
          // frames. Only the interval sees that, so only the interval may
          // drive the scaler.
          const presentDelta = this._lastPresent > 0 ? now - this._lastPresent : frameMs;
          this._lastPresentDelta = presentDelta;
          // One quality scaler owns DPR, shadow atlas, post, sky and mirror.
          // Settling frames are shader/shadow compiles — do not sample them or
          // the first corner starts on a tier the machine never earned.
          if (!settling && !onTitle) {
            if (!this.perfTier) {
              this.perfTier = createPerfTier(GFX, { startTier: isPhonePlay() ? "low" : "medium" });
            }
            const t = this.perfTier.tick(presentDelta);
            if (t.changed) this._applyQualityTier(t);
          }
          this._lastPresent = now;
          // Presented frames over *wall* time. This used to sum `dt` only on
          // frames that presented, so any skipped frame's time was discarded
          // and the readout reported the rAF rate rather than the delivered
          // one — a 30 Hz cadence still printed 60.
          this._fpsFrames++;
          if (this._fpsMark == null) this._fpsMark = now;
          const fpsWindow = now - this._fpsMark;
          if (fpsWindow >= 500) {
            this.fps = Math.round((this._fpsFrames * 1000) / fpsWindow);
            this._fpsFrames = 0;
            this._fpsMark = now;
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
      // Hold the clock until HUD is up. QA skip sets countdown=0 — still GO.
      if (!(this._countHold && this.countdown > 0)) {
        const before = this.countdown;
        this.countdown -= dt;
        if (before > 2 && this.countdown <= 2 && this._countShown !== "2") {
          this._countShown = "2";
          this.hud.flashMessage("2");
          this.audio.countBeep(2);
        }
        if (before > 1 && this.countdown <= 1 && this._countShown !== "1") {
          this._countShown = "1";
          this.hud.flashMessage("1");
          this.audio.countBeep(1);
        }
        if (this.countdown <= 0) {
          this.state = "race";
          this.hud.flashMessage("GO!");
          this.audio.countGo();
          this._camSnap = true;
        }
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
        if (this._camBlendT <= 0) this._camSnap = true;
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
    if (this.sparks) this.sparks.step(dt);
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
    const hitMag = Math.max(this.player.hitWall || 0, (this.player.hitCar || 0) * 0.7);
    if (hitMag > 0.45 && this.sparks) {
      this.sparks.burst(this.player.position, this.player.hitNx || 0, this.player.hitNz || 0, hitMag);
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
    const lanes = [-1.1, 0.15, 1.05, -0.55, 0.7, -1.22, 0.9, -0.25, 1.18];
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

  /**
   * Mesh follows physics. Never write Vehicle.position from here.
   * @param {number} [alpha]
   */
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

  /**
   * Cycle POV → medium → far. C only records the from-pose. Cabin / HUD /
   * mirror attach mid-blend in `_chaseCam` so this click never hitch-compiles.
   */
  _cycleCamera() {
    this.camMode = (this.camMode + 1) % CAMERA.views.length;
    this._startCamBlend();
    const mode = CAMERA.views[this.camMode];
    if (this.state === "race" || this.state === "countdown") {
      this.hud.flashMessage(mode.label);
    }
  }

  /**
   * Capture the live lens as the blend origin. The from-pose rides with the car
   * via `_carryBlendPoint` so a 0.22s ease cannot freeze in world space.
   */
  _startCamBlend() {
    this._camSnap = false;
    this._camBlendFrom.copy(this.camera.position);
    if (this._camLookSmooth.lengthSq() > 0.01) this._camBlendFromLook.copy(this._camLookSmooth);
    else {
      this.camera.getWorldDirection(this._eyeLocal);
      this._camBlendFromLook.copy(this.camera.position).addScaledVector(this._eyeLocal, 8);
    }
    this._camBlendFromUp.copy(this.camera.up);
    this._camBlendFromFov = this._camFovSmooth;
    this._camBlendFromNear = this._camNearSmooth;
    const draw = this.player && this.player._draw;
    if (draw) {
      this._camBlendAnchor.set(draw.x, draw.y, draw.z);
      this._camBlendAnchorYaw = draw.yaw;
    } else {
      this._camBlendAnchor.copy(this.camera.position);
      this._camBlendAnchorYaw = this._camYaw;
    }
    const dur = CAMERA.viewBlendTime != null ? CAMERA.viewBlendTime : 0.22;
    this._camBlendDur = dur;
    this._camBlendT = dur;
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
    this.hud.setChaseGauges(!pov);
    this._gaugeHoldPov = false;
    if (pov) {
      setCockpitView(this.playerMesh, true, this.camera);
      this._cockpitLive = true;
      this._povHudFade = 1;
      this._ensureMirrorRT();
      if (this._mirrorRT) {
        setCockpitMirrorMap(this.playerMesh, this._mirrorRT.texture);
        this._mirrorTick = 0;
      }
    } else if (this._cockpitLive) {
      setCockpitView(this.playerMesh, false, this.camera);
      this._cockpitLive = false;
      this._povHudFade = 0;
    }
    updatePovHudFade(this.playerMesh, this._povHudFade);
  }

  /**
   * Keep a C-key from-pose glued to the car so the blend never hangs in the world.
   * @param {THREE.Vector3} src world point (or direction if `asDir`)
   * @param {THREE.Vector3} out
   * @param {boolean} asDir rotate only — no translation (up vector)
   */
  _carryBlendPoint(src, out, asDir) {
    const d = this.player && this.player._draw;
    if (!d) {
      out.copy(src);
      return;
    }
    let dy = d.yaw - this._camBlendAnchorYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const c = Math.cos(dy);
    const s = Math.sin(dy);
    const ox = src.x - (asDir ? 0 : this._camBlendAnchor.x);
    const oy = src.y - (asDir ? 0 : this._camBlendAnchor.y);
    const oz = src.z - (asDir ? 0 : this._camBlendAnchor.z);
    out.set(
      ox * c - oz * s + (asDir ? 0 : d.x),
      oy + (asDir ? 0 : d.y),
      ox * s + oz * c + (asDir ? 0 : d.z)
    );
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
    if (drift > 0.08 && p.speed > 6) {
      const kickCap = CAMERA.slideKickMax != null ? CAMERA.slideKickMax : 0.045;
      const latKick =
        Math.sign(p.driftAngle) * Math.min(kickCap, drift * 0.08 + p.slidePct() * 0.025);
      this._camKickLat += (latKick - this._camKickLat) * (1 - Math.exp(-8 * dt));
      if (p.drifting) this._camFovKick = Math.max(this._camFovKick, Math.min(2.4, drift * 1.8));
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
    if (this._cockpitLive || this.playerMesh.userData._cockpitOn) {
      setCockpitView(this.playerMesh, false, this.camera);
      this._cockpitLive = false;
    }
    if (this._cabinFill) this._cabinFill.intensity = 0;
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

    const r = 6.15 + Math.sin(t * 0.55) * 0.18;
    const lookY = p.position.y + 0.78;
    this.camera.up.set(0, 1, 0);
    if (this.camera.near !== 0.18 || this.camera.fov !== 42) {
      this.camera.near = 0.18;
      this.camera.fov = 42;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.set(
      p.position.x + Math.sin(t) * r,
      p.position.y + 2.18 + Math.sin(t * 0.48) * 0.08,
      p.position.z + Math.cos(t) * r
    );
    this.camera.lookAt(p.position.x, lookY, p.position.z);
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

    const driftEarly = Math.abs(p.driftAngle || 0);
    const slidingEarly = !wantPov && driftEarly > 0.08 && p.speed > 6;
    /** Chase yaw tracks travel more than chassis when sliding — keeps the road ahead. */
    let yawTarget = yaw;
    if (slidingEarly && p.velocity) {
      const spd2 = p.velocity.x * p.velocity.x + p.velocity.z * p.velocity.z;
      if (spd2 > 4) {
        const velYaw = Math.atan2(p.velocity.x, p.velocity.z);
        let dvy = velYaw - yaw;
        while (dvy > Math.PI) dvy -= Math.PI * 2;
        while (dvy < -Math.PI) dvy += Math.PI * 2;
        const align =
          Math.min(1, driftEarly * 1.55) * (CAMERA.slideYawBlend != null ? CAMERA.slideYawBlend : 0.62);
        yawTarget = yaw + dvy * align;
      }
    }
    let dy = yawTarget - this._camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const yawStiffBase = CAMERA.yawStiffness != null ? CAMERA.yawStiffness : 32;
    const yawStiffSlide = CAMERA.yawStiffnessSlide != null ? CAMERA.yawStiffnessSlide : 16;
    const yawStiff = slidingEarly
      ? yawStiffBase + (yawStiffSlide - yawStiffBase) * Math.min(1, driftEarly * 1.8)
      : yawStiffBase;
    const yawFollow = 1 - Math.exp(-yawStiff * dt);
    if (this._camSnap) this._camYaw = yawTarget;
    else this._camYaw += dy * yawFollow;
    const sinY = Math.sin(this._camYaw);
    const cosY = Math.cos(this._camYaw);
    const lean = (CAMERA.rollFollow || 0) * d.roll;

    if (wantPov && mesh) {
      const head = rig && rig.head;
      if (head) {
        head.updateWorldMatrix(true, false);
        this._camTarget.setFromMatrixPosition(head.matrixWorld);
        if (rig.lookNode) {
          rig.lookNode.updateWorldMatrix(true, false);
          this._camLook.setFromMatrixPosition(rig.lookNode.matrixWorld);
        } else {
          const lookX = rig.lookX != null ? rig.lookX : mode.eyeX * 0.2;
          const lookY = rig.lookY != null ? rig.lookY : mode.lookY;
          const lookZ = rig.lookZ != null ? rig.lookZ : mode.lookZ;
          this._lookLocal.set(lookX, lookY, lookZ);
          this._camLook.copy(this._lookLocal).applyMatrix4(mesh.matrixWorld);
        }
      } else {
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
      }
      this._camUp.set(0, 1, 0).transformDirection(mesh.matrixWorld);
    } else {
      this._camUp.set(sinY * lean, 1, cosY * lean).normalize();
      /** Squats a touch more at speed so the road fills the lens (arcade, mild). */
      const dropCap = mode.speedDropMax != null ? mode.speedDropMax : 0.48;
      const heightDrop = Math.min(dropCap, p.speed * 0.015);
      const drift = Math.abs(p.driftAngle || 0);
      const sliding = drift > 0.08 && p.speed > 6;
      const rx = Math.cos(this._camYaw);
      const rz = -Math.sin(this._camYaw);
      /** Mild outside offset — enough for a rear-quarter, not a whip off the ribbon. */
      const out =
        sliding && p.driftAngle
          ? Math.sign(p.driftAngle) *
            Math.min(0.28, drift * 0.45) *
            (CAMERA.slideCamOut != null ? CAMERA.slideCamOut : 0.16)
          : 0;
      this._camTarget.set(
        px - sinY * mode.back + rx * out,
        py + mode.height - heightDrop,
        pz - cosY * mode.back + rz * out
      );
      const geo = this._geoFramingBias();
      let lookSin = sinY;
      let lookCos = cosY;
      if (sliding && p.velocity) {
        const velYaw = Math.atan2(p.velocity.x, p.velocity.z);
        let dvy = velYaw - this._camYaw;
        while (dvy > Math.PI) dvy -= Math.PI * 2;
        while (dvy < -Math.PI) dvy += Math.PI * 2;
        const k = Math.min(1, drift * 2.2) * (CAMERA.slideLook != null ? CAMERA.slideLook : 0.78);
        const lookYaw = this._camYaw + dvy * k;
        lookSin = Math.sin(lookYaw);
        lookCos = Math.cos(lookYaw);
      }
      const slidePush =
        sliding && CAMERA.slideLookAhead != null
          ? Math.min(1, drift * 1.8) * CAMERA.slideLookAhead
          : sliding
            ? Math.min(1, drift * 1.8) * 4.2
            : 0;
      this._camLook.set(
        px + lookSin * (mode.lookAhead + geo.lookAhead + slidePush),
        py + mode.lookY + geo.lookY,
        pz + lookCos * (mode.lookAhead + geo.lookAhead + slidePush)
      );
    }

    const dist = this._camPos.distanceTo(this._camTarget);
    const dur = this._camBlendDur > 0.001 ? this._camBlendDur : 0.12;
    const blendU = blending ? 1 - this._camBlendT / dur : 1;
    const ease = blendU * blendU * blendU * (blendU * (blendU * 6 - 15) + 10);

    if (this._camSnap && !blending) {
      this._camPos.copy(this._camTarget);
      this._camLookSmooth.copy(this._camLook);
      this.camera.up.copy(this._camUp);
      this._camSnap = false;
    } else if (blending) {
      this._camSnap = false;
      this._carryBlendPoint(this._camBlendFrom, this._camFromPos, false);
      this._carryBlendPoint(this._camBlendFromLook, this._camFromLook, false);
      this._carryBlendPoint(this._camBlendFromUp, this._camFromUp, true);
      this._camFromUp.normalize();
      this._camPos.lerpVectors(this._camFromPos, this._camTarget, ease);
      this._camLookSmooth.lerpVectors(this._camFromLook, this._camLook, ease);
      this.camera.up.copy(this._camFromUp).lerp(this._camUp, Math.min(1, ease + 0.2)).normalize();
    } else if (wantPov) {
      this._camSnap = false;
      this._camPos.copy(this._camTarget);
      this._camLookSmooth.copy(this._camLook);
      this.camera.up.copy(this._camUp);
    } else {
      this._camSnap = false;
      const stiff = mode.stiffness || CAMERA.viewBlendStiffness || 26;
      const follow = 1 - Math.exp(-stiff * dt);
      // Medium/POV-adjacent chase locks XZ to the live car so residual launch
      // hop cannot read as the body bouncing fore-aft in frame. Far view keeps
      // the slower cinematic follow.
      if (mode.id !== "far") {
        this._camPos.x = this._camTarget.x;
        this._camPos.z = this._camTarget.z;
        this._camPos.y += (this._camTarget.y - this._camPos.y) * follow;
      } else {
        this._camPos.lerp(this._camTarget, follow);
      }
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
    // Never follow the car under the stage — that is the gray void shot.
    if (!wantPov && this.track && typeof this.track.sample === "function" && Number.isFinite(p.progress)) {
      const line = this.track.sample(p.progress, this._camLine || (this._camLine = {}));
      if (line && Number.isFinite(line.y)) {
        const minY = line.y + 1.25;
        if (this.camera.position.y < minY) this.camera.position.y = minY;
        if (this._camLookSmooth.y < line.y + 0.4) this._camLookSmooth.y = line.y + 0.4;
      }
    }
    this.camera.lookAt(this._camLookSmooth);

    const punchScale = wantPov ? 0.45 : 1;
    const punch = Math.min(
      (CAMERA.maxFovPunch || 8) * (wantPov ? 0.4 : 1),
      p.speed * (CAMERA.speedFov || 0.08) * punchScale
    );
    const wantFov = (rig && wantPov ? rig.fov : mode.fov) + punch + this._camFovKick * (wantPov ? 0.55 : 1);
    const wantNear = (rig && wantPov ? rig.near : mode.near) || 0.2;
    if (blending) {
      this._camFovSmooth = this._camBlendFromFov + (wantFov - this._camBlendFromFov) * ease;
      this._camNearSmooth = this._camBlendFromNear + (wantNear - this._camBlendFromNear) * ease;
    } else {
      const fovStiff = CAMERA.fovBlendStiffness != null ? CAMERA.fovBlendStiffness : 18;
      const fovFollow = 1 - Math.exp(-fovStiff * dt);
      this._camFovSmooth += (wantFov - this._camFovSmooth) * fovFollow;
      this._camNearSmooth += (wantNear - this._camNearSmooth) * fovFollow;
    }
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

    const detachDist = CAMERA.povDetachDist != null ? CAMERA.povDetachDist : 1.6;
    if (mesh) {
      if (wantPov) {
        const seatIn = !blending || ease >= 0.45;
        if (seatIn && !this._cockpitLive) {
          setCockpitView(mesh, true, this.camera);
          this._cockpitLive = true;
          this._povHudFade = 1;
          this._ensureMirrorRT();
          if (this._mirrorRT) {
            setCockpitMirrorMap(mesh, this._mirrorRT.texture);
            this._mirrorTick = 0;
          }
          // Keep the last road image on the glass. Capture this frame if empty.
          this._mirrorDefer = this._mirrorHasImage
            ? Math.max(0, CAMERA.mirrorDeferFrames | 0)
            : 0;
        }
      } else if (this._cockpitLive) {
        const seatOut = !blending || ease >= 0.42 || dist > detachDist;
        if (seatOut) {
          setCockpitView(mesh, false, this.camera);
          this._cockpitLive = false;
          this._povHudFade = 0;
        }
      }
      updatePovHudFade(mesh, this._cockpitLive ? 1 : 0);
    }
    let showChase = !wantPov;
    if (blending && wantPov) showChase = ease < 0.48;
    if (blending && !wantPov) showChase = ease > 0.32;
    this.hud.setChaseGauges(showChase);
    this._gaugeHoldPov = false;
    if (this._cabinFill) {
      if (wantPov && this._cockpitLive) {
        this._cabinFill.intensity = 0.4;
        this._cabinFill.position.copy(this._camTarget);
        this._cabinFill.position.y -= 0.1;
      } else {
        this._cabinFill.intensity = 0;
      }
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
    applySky(this.sky, L, courseId);
    if (this.dust && this.dust.setAtmosphere) this.dust.setAtmosphere(L);
    try {
      this._bakeSkyEnv(courseId);
    } catch (err) {
      console.warn("Sky IBL failed", err);
    }
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

    if (this.playerMesh) {
      const headOn = Math.min(1, t * 1.55);
      const boost =
        t > 0.35
          ? TUNNEL.headBeamTunnelBoost != null
            ? TUNNEL.headBeamTunnelBoost
            : 1.35
          : 1;
      setHeadlights(this.playerMesh, headOn, { tunnelBoost: boost });
    }
  }

  /**
   * Grow/shrink the sun shadow atlas. Disposes the GPU map so three.js allocates
   * the new size on the next needsUpdate (title 1024, race 4096).
   *
   * @param {number} size
   * @param {boolean} [allowShrink] the quality scaler may shrink; screen
   *   transitions may not, because a dispose+realloc there is a visible hitch.
   */
  _setShadowMapSize(size, allowShrink = false) {
    if (!this.sun) return;
    const s = Math.max(256, size | 0);
    if (this.sun.shadow.mapSize.x === s && this.sun.shadow.mapSize.y === s) return;
    // Never shrink the atlas on a screen transition — dispose+realloc there is
    // a visible hitch (Sprint 60). Only the quality scaler may shrink it, and
    // only downward, once per stage.
    if (!allowShrink && this.sun.shadow.map && s < this.sun.shadow.mapSize.x) return;
    this.sun.shadow.mapSize.set(s, s);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
  }

  /**
   * Apply one quality tier. Called only on a tier transition, so the two
   * expensive knobs (framebuffer reallocation and the shadow atlas) cost one
   * frame each time the machine is re-graded instead of every frame.
   *
   * This is the whole degradation story: a slow device loses pixel density,
   * shadow resolution, bloom, cloud steps and mirror refresh — in that order
   * of visibility — rather than dropping frames.
   *
   * @param {{dpr:number, shadow:number, post:string, sky:string, mirrorEvery:number}} t
   */
  _applyQualityTier(t) {
    if (!t) return;
    // Cheap, reversible knobs — no GPU allocation, so these may follow the
    // tier up and down freely.
    this._qualityMirrorEvery = Math.max(1, t.mirrorEvery | 0);
    this._qualityShadowEvery = Math.max(1, t.shadowEvery | 0);
    if (this.post && this.post.setQuality) this.post.setQuality(t.post);
    if (this.sky) setSkyQuality(this.sky, t.sky);

    // Reallocating the canvas or the shadow atlas costs 1–3 frames (Sprint 60).
    // So the two allocating knobs are monotonic within a race: they step down
    // when the machine proves it cannot hold the tier, and never climb back
    // mid-stage. A stage start re-grades from scratch. That bounds the cost at
    // three hitches per stage instead of an oscillation that never settles.
    if (this.renderer && this.renderer.shadowMap.enabled) {
      const floor = this._qualityShadowFloor || Infinity;
      if (t.shadow < floor) {
        this._qualityShadowFloor = t.shadow;
        this._setShadowMapSize(t.shadow, true);
        this.renderer.shadowMap.needsUpdate = true;
      }
    }
    const dpr = Math.max(0.6, Math.min(1, t.dpr || 1));
    if (dpr < (this._qualityDprFloor != null ? this._qualityDprFloor : 1)) {
      this._qualityDprFloor = dpr;
      this._perfDprScale = dpr;
      this._onResize();
    }
  }

  /**
   * Native pixel ratio + aspect so PBR and reflections are not nearest-neighbor.
   */
  _onResize() {
    const host = document.getElementById("game-view");
    if (!host || !this.renderer || !this.camera) return;
    const w = Math.max(1, host.clientWidth || window.innerWidth || 1);
    const h = Math.max(1, host.clientHeight || window.innerHeight || 1);
    const onTitle = this.state === "title" || this.state === "menu";
    // GFX.maxPixelRatio is the hard ceiling — a 3× phone panel or a
    // 5K desktop must never be allowed to ask for its native density here.
    const capPr = GFX.maxPixelRatio || 1.5;
    const titlePr = GFX.titleMaxPixelRatio || 1.5;
    let pr = Math.min(
      window.devicePixelRatio || 1,
      onTitle ? titlePr : capPr,
      capPr
    );
    if (isPhonePlay()) pr = Math.min(pr, onTitle ? 1.15 : 1.15);
    if (!onTitle && this._perfDprScale != null && this._perfDprScale < 1) {
      pr *= this._perfDprScale;
    }
    const cap = onTitle ? GFX.titleMaxPixels || 2400000 : GFX.maxPixels || 2800000;
    const px = w * h * pr * pr;
    if (px > cap) pr = Math.max(onTitle ? 0.85 : 0.75, pr * Math.sqrt(cap / px));
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this._camProjDirty = true;
    this.camera.updateProjectionMatrix();
    if (this.post && !onTitle) this.post.setSize(w, h, pr);
    if (this.hud && this.hud.resizeGauges) this.hud.resizeGauges();
    if (this._mirrorRT && (this._mirrorRT.width < 8 || this._mirrorRT.height < 8)) {
      this._ensureMirrorRT();
      if (this._mirrorRT && this.playerMesh) {
        setCockpitMirrorMap(this.playerMesh, this._mirrorRT.texture);
      }
    }
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
    if (this._titleWorld && this._titleShowcase) {
      const padEnv =
        intensity != null
          ? intensity
          : LIGHTING.title.worldEnv != null
            ? LIGHTING.title.worldEnv
            : VISUAL.worldEnvIntensity;
      applyEnvMap(this._titleWorld, envMap, padEnv);
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
    let env;
    this._withShadowMapPaused(() => {
      env = this._pmrem.fromScene(tmp, cap.sigma, cap.near, cap.far);
    });
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
    this._withShadowMapPaused(() => {
      this._reflectCam.position.copy(mesh.position);
      this._reflectCam.position.y += 0.55;
      this._reflectCam.update(this.renderer, this.scene);
    });
    mesh.visible = vis;
    applyEnvMap(mesh, this._reflectRT.texture, 0.45);
  }

  /**
   * Rearview RT. Linear color space — an sRGB target sampled by MeshBasicMaterial
   * in the ACES scene reads as a black rectangle. Capture from behind the car.
   * Fixed small size (not the main framebuffer) so C never reallocates it.
   */
  _mirrorSize() {
    const w = Math.max(256, Math.min(GFX.mirrorW || 384, 384));
    const h = Math.max(80, Math.min(GFX.mirrorH || 120, 120));
    return { w, h };
  }

  /**
   * Allocate or repair the rearview target. Never dispose this on a C-key
   * switch — only recreate when missing, zero-sized, or after context loss.
   */
  _ensureMirrorRT() {
    const { w, h } = this._mirrorSize();
    const rt = this._mirrorRT;
    const alive = rt && rt.width >= 8 && rt.height >= 8 && rt.texture;
    if (alive) {
      if (!this._mirrorCam) {
        this._mirrorCam = new THREE.PerspectiveCamera(55, rt.width / rt.height, 0.25, 80);
      }
      return rt;
    }
    if (rt) {
      try {
        rt.dispose();
      } catch {
        /* context already gone */
      }
    }
    this._mirrorRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this._mirrorRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
    this._mirrorRT.texture.generateMipmaps = false;
    this._mirrorRT.texture.wrapS = THREE.RepeatWrapping;
    this._mirrorRT.texture.wrapT = THREE.ClampToEdgeWrapping;
    this._mirrorRT.texture.center.set(0.5, 0.5);
    this._mirrorRT.texture.repeat.x = -1;
    this._mirrorHasImage = false;
    if (!this._mirrorCam) {
      this._mirrorCam = new THREE.PerspectiveCamera(55, w / h, 0.25, 80);
    } else {
      this._mirrorCam.aspect = w / h;
      this._mirrorCam.updateProjectionMatrix();
    }
    return this._mirrorRT;
  }

  _initMirror() {
    this._ensureMirrorRT();
  }

  /**
   * Recreate the rearview after a GPU reset so POV never sits on a dead black map.
   */
  _bindMirrorContext() {
    if (!this.canvas || this._mirrorContextBound) return;
    this._mirrorContextBound = true;
    this.canvas.addEventListener("webglcontextlost", (ev) => {
      ev.preventDefault();
      this._mirrorHasImage = false;
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this._mirrorRT = null;
      this._ensureMirrorRT();
      if (this._mirrorRT && this.playerMesh) {
        setCockpitMirrorMap(this.playerMesh, this._mirrorRT.texture);
      }
      if (this.state === "race" || this.state === "countdown") this._warmPov();
    });
  }

  /**
   * Compile cabin + one mirror capture during load so the first C is a
   * visibility flip, not a shader hitch. Restores chase body if not in POV.
   */
  _warmPov() {
    const mesh = this.playerMesh;
    this._ensureMirrorRT();
    if (!mesh || !this.renderer || !this._mirrorRT || !this._mirrorCam) return;
    const key = `${this.courseId || ""}|${this.carId || ""}|${mesh.uuid}|${mesh.userData.titleLod ? "lod" : "hero"}`;
    if (this._povWarmKey === key) return;
    getPovRig(mesh);
    const wantPov = !!(CAMERA.views[this.camMode] && CAMERA.views[this.camMode].id === "pov");
    setCockpitView(mesh, true, this.camera);
    setCockpitMirrorMap(mesh, this._mirrorRT.texture);
    try {
      this.renderer.compile(this.scene, this.camera);
      const prevMask = this.camera.layers.mask;
      this.camera.layers.enable(POV_HUD_LAYER);
      this.renderer.compile(this.scene, this.camera);
      this.camera.layers.mask = prevMask;
      this._syncMirrorCam();
      this.renderer.compile(this.scene, this._mirrorCam);
      this._captureMirror(true);
      this._povWarmKey = key;
    } catch (err) {
      console.warn("POV warm failed", err);
    }
    if (!wantPov) {
      setCockpitView(mesh, false, this.camera);
      this._cockpitLive = false;
      this._povHudFade = 0;
    } else {
      this._cockpitLive = true;
      this._povHudFade = 1;
    }
  }

  _syncMirrorCam() {
    const mesh = this.playerMesh;
    if (!mesh) return;
    mesh.updateMatrixWorld(true);
    const rig = getPovRig(mesh);
    if (rig) {
      const cx = rig.mirrorCamX != null ? rig.mirrorCamX : 0;
      const cy = rig.mirrorCamY != null ? rig.mirrorCamY : rig.mirrorEyeY;
      const cz = rig.mirrorCamZ != null ? rig.mirrorCamZ : (rig.hull ? rig.hull.minZ - 0.9 : -2.4);
      this._mirrorEye.set(cx, cy, cz);
      this._mirrorLook.set(
        rig.mirrorLookX != null ? rig.mirrorLookX : 0,
        rig.mirrorLookY != null ? rig.mirrorLookY : cy - 0.2,
        rig.mirrorLookZ
      );
    } else {
      this._mirrorEye.set(0, 1.2, -2.4);
      this._mirrorLook.set(0, 0.9, -18);
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
    if (!pov || !this._cockpitLive) return;
    this._ensureMirrorRT();
    if (this.playerMesh && this._mirrorRT) {
      setCockpitMirrorMap(this.playerMesh, this._mirrorRT.texture);
    }
    if (this._mirrorDefer > 0 && this._mirrorHasImage) {
      this._mirrorDefer -= 1;
      return;
    }
    this._mirrorDefer = 0;
    this._mirrorTick += 1;
    // Quality scaler stretches the capture interval before it drops the mirror.
    const every = Math.max(1, this._qualityMirrorEvery || GFX.mirrorEvery | 0);
    if (this._mirrorHasImage && this._mirrorTick % every !== 0) return;
    this._captureMirror(false);
  }

  /**
   * @param {boolean} force skip the live-POV gate (used by preload)
   */
  _captureMirror(force) {
    this._ensureMirrorRT();
    if (!this._mirrorRT || !this.playerMesh || !this._mirrorCam) return;
    if (!force) {
      const pov = !!(CAMERA.views[this.camMode] && CAMERA.views[this.camMode].id === "pov");
      if (!pov || !this._cockpitLive) return;
    }
    const cab = this.playerMesh.userData.cockpit;
    const mir = this.playerMesh.userData.mirror;
    const cabVis = !!(cab && cab.visible);
    const mirVis = !!(mir && mir.visible);
    const playerVis = this.playerMesh.visible;
    const dust = this.dust && this.dust.points;
    const marks = this.tireMarks && this.tireMarks.mesh;
    const dustVis = !!(dust && dust.visible);
    const marksVis = !!(marks && marks.visible);
    const prevTone = this.renderer.toneMapping;
    const prevAuto = this.renderer.autoClear;
    const prevOut = this.renderer.outputColorSpace;
    const prevFogFar = this.scene.fog && this.scene.fog.far;
    try {
      if (cab) cab.visible = false;
      if (mir) mir.visible = false;
      this.playerMesh.visible = false;
      if (dust) dust.visible = false;
      if (marks) marks.visible = false;

      this._syncMirrorCam();
      if (this.sky) this.sky.position.copy(this._mirrorCam.position);
      if (this.scene.fog) this.scene.fog.far = Math.min(prevFogFar || 80, 80);

      const shadows = this.renderer.shadowMap.enabled;
      this.renderer.shadowMap.enabled = false;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      this.renderer.autoClear = true;
      const bg = this.scene.background;
      if (bg && bg.isColor) this.renderer.setClearColor(bg, 1);
      else this.renderer.setClearColor(0x6aa0d4, 1);
      this.renderer.setRenderTarget(this._mirrorRT);
      this.renderer.clear();
      this.renderer.render(this.scene, this._mirrorCam);
      this.renderer.setRenderTarget(null);
      this.renderer.shadowMap.enabled = shadows;
      this._mirrorHasImage = true;
      setCockpitMirrorMap(this.playerMesh, this._mirrorRT.texture);
    } catch (err) {
      console.warn("Rearview capture failed", err);
      this.renderer.setRenderTarget(null);
    } finally {
      this.renderer.toneMapping = prevTone;
      this.renderer.outputColorSpace = prevOut;
      this.renderer.autoClear = prevAuto;
      this.playerMesh.visible = playerVis;
      if (cab) cab.visible = cabVis;
      if (mir) mir.visible = mirVis;
      if (dust) dust.visible = dustVis;
      if (marks) marks.visible = marksVis;
      if (this.sky) this.sky.position.copy(this.camera.position);
      if (this.scene.fog && prevFogFar != null) this.scene.fog.far = prevFogFar;
    }
  }

  _syncWorldStream(forceSettle) {
    if (!this.track || !this.track.update || !this.camera) return;
    try {
      const p = this.player;
      const anchor = p && p.position ? p.position : this.camera.position;
      const fogFar = this.scene.fog && this.scene.fog.far ? this.scene.fog.far : 0;
      const progress = p && Number.isFinite(p.progress) ? p.progress : undefined;
      const speed = p && Number.isFinite(p.speed) ? p.speed : 0;
      const yaw = p && Number.isFinite(p.yaw) ? p.yaw : 0;
      const settling =
        forceSettle === true ||
        this.state === "countdown" ||
        this.state === "loading" ||
        (this._raceWarmFrames || 0) > 0;
      this.track.update(anchor, this.camera.position, {
        fogFar,
        progress,
        speed: settling ? 0 : speed,
        yaw,
        settle: settling,
      });
    } catch (err) {
      console.warn("Track streaming disabled", err);
      if (this.track.showAllChunks) this.track.showAllChunks();
      this.track.update = null;
    }
  }

  _renderPovHudOverlay() {
    if (!this._cockpitLive || !this.playerMesh) return;
    const cab = this.playerMesh.userData.cockpit;
    if (!cab || !cab.visible) return;
    const r = this.renderer;
    const cam = this.camera;
    const prevMask = cam.layers.mask;
    const prevAuto = r.autoClear;
    const prevTone = r.toneMapping;
    const prevBg = this.scene.background;
    const sky = this.sky;
    const skyVis = !!(sky && sky.visible);
    try {
      cam.layers.set(POV_HUD_LAYER);
      this.scene.background = null;
      if (sky) sky.visible = false;
      r.autoClear = false;
      r.clearDepth();
      // Cluster / rearview are MeshBasic maps. ACES in the main pass crushes them
      // to black; this pass writes them over the graded frame.
      r.toneMapping = THREE.NoToneMapping;
      r.render(this.scene, cam);
    } finally {
      this.scene.background = prevBg;
      if (sky) sky.visible = skyVis;
      r.toneMapping = prevTone;
      r.autoClear = prevAuto;
      cam.layers.mask = prevMask;
    }
  }

  _render(dt) {
    this._updateLights(dt);
    const onPad = this.state === "title" || this.state === "menu";
    if (this.sky && this.camera) {
      this.sky.position.copy(this.camera.position);
      if (!onPad || (this._shadowTick || 0) % 4 === 0) {
        tickSky(this.sky, performance.now() * 0.001);
      }
    }
    this._syncWorldStream();
    const chase =
      this.state !== "title" &&
      this.state !== "menu" &&
      !!(CAMERA.views[this.camMode] && CAMERA.views[this.camMode].id !== "pov");
    const carPos = this.playerMesh ? this.playerMesh.position : this.camera.position;
    updateCameraFade(this.camera.position, carPos, chase);
    this._fadeBlockingPack(chase, dt);
    // Mirror / cube must see a solid pack. Ghost after those captures.
    this._paintBlockingPack(0);
    this._renderMirror();
    // Cube / mirror captures first. They must not bake the sun shadow map
    // while the car is hidden, or the pad shadow strobes.
    if (onPad) this._updateTitleReflections();
    else this._updateReflections();
    this._paintBlockingPack(1);
    const settling =
      this.state === "countdown" ||
      this.state === "loading" ||
      (this._raceWarmFrames || 0) > 0;
    // Settling frames must bake every frame or the grid shadow pops in. On the
    // pad one hero car needs it rarely. In a race the quality scaler owns it.
    const every = settling
      ? 1
      : onPad
        ? 4
        : Math.max(1, this._qualityShadowEvery || GFX.shadowEvery | 0 || 1);
    this._shadowTick = (this._shadowTick || 0) + 1;
    if (this.renderer.shadowMap.enabled) {
      this.renderer.shadowMap.needsUpdate = this._shadowTick % every === 0;
    }
    const prevMask = this.camera.layers.mask;
    this.camera.layers.set(0);
    if (this.post && this.post.enabled) this.post.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
    this.camera.layers.mask = prevMask;
    this._renderPovHudOverlay();
  }

  /**
   * Live pose + glitch counters for the Glitch Department harness.
   * @returns {object|null}
   */
  qaSnapshot() {
    const p = this.player;
    if (!p) return null;
    const q = p._q;
    return {
      state: this.state,
      course: this.courseId,
      x: p.position.x,
      y: p.position.y,
      physY: p.position.y,
      z: p.position.z,
      yaw: p.yaw,
      progress: p.progress,
      speed: p.speed,
      onGround: !!p.onGround,
      jumpKind: q && q.jumpKind ? q.jumpKind : "",
      onRoad: q ? !!q.onRoad : false,
      roadY: q && Number.isFinite(q.height) ? q.height : null,
      plantY:
        q && Number.isFinite(q.height) ? q.height - 0.014 : null,
      velY: p.velY,
      prevY: p._prevY,
      meshY: this.playerMesh ? this.playerMesh.position.y : null,
      pipe: p._pipe || null,
      throttle: p.throttle || 0,
      finite: typeof p._isFinitePose === "function" ? p._isFinitePose() : true,
      glitchHits: p._glitchHits || 0,
      glitchLog: p._glitchLog || [],
    };
  }
}

function hashNoise(i) {
  const n = Math.sin(i * 12.9898) * 43758.5453;
  return n - Math.floor(n);
}

function makeTitleAsphaltMaps() {
  // 512² is enough for a 9 m pad orbit; 1024² blocked title GLB decode on boot.
  const s = 512;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d", { willReadFrequently: true });
  const img = g.createImageData(s, s);
  const d = img.data;
  const roughC = document.createElement("canvas");
  roughC.width = roughC.height = s;
  const rg = roughC.getContext("2d", { willReadFrequently: true });
  const rImg = rg.createImageData(s, s);
  const rd = rImg.data;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const n1 = hashNoise(x * 0.41 + y * 1.73);
      const n2 = hashNoise(x * 2.19 + y * 0.67 + 17);
      const n3 = hashNoise(x * 8.1 + y * 6.4 + 41);
      const n4 = hashNoise(x * 0.09 + y * 0.11 + 3);
      const chip = n3 > 0.93 ? 42 : n3 > 0.82 ? 10 : 0;
      const tar = n2 > 0.97 ? -18 : 0;
      const base = 28 + n1 * 16 + chip + tar + n4 * 6;
      d[i] = base;
      d[i + 1] = base - 1;
      d[i + 2] = base - 4;
      d[i + 3] = 255;
      // Darker = smoother wet patch; bright chips stay matte.
      const rough = Math.max(18, Math.min(220, 118 + n1 * 48 - chip * 1.6 + tar * 2 + n4 * 22));
      rd[i] = rough;
      rd[i + 1] = rough;
      rd[i + 2] = rough;
      rd[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = "rgba(18, 18, 20, 0.32)";
  g.lineWidth = 2.2;
  for (let k = 0; k < 7; k++) {
    g.beginPath();
    const y0 = 90 + k * 128 + hashNoise(k + 3) * 24;
    g.moveTo(0, y0);
    g.lineTo(s, y0 + 18);
    g.stroke();
  }
  // Soft centre polish so the car sits in a reflective puddle zone.
  const polish = g.createRadialGradient(s * 0.5, s * 0.5, s * 0.08, s * 0.5, s * 0.5, s * 0.42);
  polish.addColorStop(0, "rgba(55, 55, 58, 0.22)");
  polish.addColorStop(1, "rgba(0, 0, 0, 0)");
  g.fillStyle = polish;
  g.fillRect(0, 0, s, s);

  rg.putImageData(rImg, 0, 0);
  const rPolish = rg.createRadialGradient(s * 0.5, s * 0.5, s * 0.06, s * 0.5, s * 0.5, s * 0.4);
  rPolish.addColorStop(0, "rgba(40, 40, 40, 0.55)");
  rPolish.addColorStop(1, "rgba(180, 180, 180, 0)");
  rg.fillStyle = rPolish;
  rg.fillRect(0, 0, s, s);

  const color = new THREE.CanvasTexture(c);
  color.wrapS = color.wrapT = THREE.RepeatWrapping;
  color.repeat.set(5, 5);
  color.colorSpace = THREE.SRGBColorSpace;
  color.needsUpdate = true;

  const roughness = new THREE.CanvasTexture(roughC);
  roughness.wrapS = roughness.wrapT = THREE.RepeatWrapping;
  roughness.repeat.set(5, 5);
  roughness.colorSpace = THREE.NoColorSpace;
  roughness.needsUpdate = true;

  return { color, roughness };
}

function makeTitleSandMap() {
  const s = 512;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d", { willReadFrequently: true });
  const img = g.createImageData(s, s);
  const d = img.data;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const n1 = hashNoise(x * 0.33 + y * 0.91);
      const n2 = hashNoise(x * 1.7 + y * 2.4 + 9);
      const grain = n2 > 0.88 ? 28 : n2 < 0.12 ? -16 : 0;
      d[i] = 198 + n1 * 22 + grain;
      d[i + 1] = 154 + n1 * 18 + grain * 0.7;
      d[i + 2] = 98 + n1 * 14 + grain * 0.4;
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
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
