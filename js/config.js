/**
 * Rally Championship — global tunables.
 *
 * WHO THIS IS FOR: anyone tweaking feel, Saturn look, or car performance.
 * WHAT IT DOES: one place for physics, surfaces, render, and championship rules.
 * HOW IT CONNECTS: imported by vehicle, tracks, renderer, HUD, and the game loop.
 *
 * GTA IV rival (Sprint 75c): HANDLING/CHASSIS/SURFACES encode Rockstar's
 * readable-mass formula, not a handling.dat clone. Sources in HANDLING.
 */

export const FIXED_DT = 1 / 60;
/**
 * Fixed steps the loop may run to catch up after one slow frame.
 * Three lets a 20 ms hitch stay in real time; more than that and a stall
 * would snowball into a substep spiral, so the loop drops the surplus.
 */
export const MAX_SUBSTEPS = 3;

/** Native framebuffer — PBR needs real resolution, not a 640px Saturn blit. */
export const INTERNAL_WIDTH = 1600;
export const INTERNAL_HEIGHT = 900;

/**
 * GPU budget for a 60 Hz arcade pack (14 cars on Desert).
 * Live CubeCamera is 6 extra scene draws — leave it off; sky IBL is enough.
 * Shadows update every frame (skipping frames feels like hitching).
 */
export const GFX = {
  /**
   * Race — sharper stage, 30 fps floor (Sprint 547).
   * Sprint 536 cut Retina to hold 60; players prefer readable pixels with a
   * clean lock-to-30 over a soft 1.0× image that still judders. Target 60;
   * when the machine cannot, present every second vsync (even 30) rather than
   * free-running below that.
   */
  /**
   * Visual Pass V1 — hard DPR ceiling. Never use raw devicePixelRatio alone
   * (Retina 2×–3× multiplies fill-rate). Quality ladder may scale this down.
   */
  maxPixelRatio: 1.15,
  maxPixels: 1800000,
  /** Title / SELECT MODE — LOD car, soft fill-rate so menus stay clickable. */
  titleMaxPixelRatio: 1.0,
  titleMaxPixels: 1200000,
  /** Title sun atlas — pad runs without live shadows; size kept for race settle. */
  titleShadowMap: 512,
  /** AM3 criterion 1 — cap presentation at 60 Hz; physics stays fixed-step. */
  targetFps: 60,
  lockRenderFps: true,
  /**
   * Title stays locked to targetFps. Uncapping only spends more GPU on the same
   * sky/shadow budget; the orbit already reads smooth at a clean 60.
   */
  unlockFpsOnTitle: false,
  /**
   * Soft PCF sun atlas. 2048² was still too heavy once the scaler hit `min`
   * on M1; 1536 keeps a readable contact blob at chase distance.
   */
  shadowMap: 1536,
  shadowExtent: 36,
  /**
   * Race sun ortho half-width (metres). V1 prioritizes vehicle/road/near-field
   * over distant coverage — 40 m keeps contact sharp without ballooning texels.
   */
  shadowExtentRace: 40,
  shadowNear: 2.5,
  shadowFar: 140,
  /** Shared soft-PCF bias contract (all championship stages). */
  shadowBias: -0.00016,
  shadowNormalBias: 0.042,
  shadowRadius: 2.4,
  /**
   * Soft PCF hides a skipped bake. Every third present on the race default;
   * min tier stretches further / can disable the atlas entirely.
   */
  shadowEvery: 1,
  reflectEvery: 0,
  cubeSize: 64,
  /**
   * Rearview RT — low-res fixed size (readable cabin glass, ~1/4 of a
   * 1600-wide framebuffer). Full-res was a hitch; postage-stamp is unreadable.
   * FOV is vertical; ~26° at 384×120 ≈ 70° horizontal — a real cabin mirror,
   * not a 130° security cam. Far covers the road/trees/rivals behind you.
   */
  mirrorW: 384,
  mirrorH: 120,
  /** Chase / non-POV mirror cadence (presented frames). POV uses mirrorEveryPov. */
  mirrorEvery: 2,
  /** POV rearview — every presented frame; tier throttle made glass feel laggy. */
  mirrorEveryPov: 1,
  /** Vertical FOV for the rearview camera (Three.js PerspectiveCamera). */
  mirrorFov: 26,
  /** Draw distance for the rearview pass (metres). */
  mirrorFar: 200,
  mirrorNear: 0.4,
  /** PMREM sky capture far plane (internal bake is 256³). */
  pmremFar: 240,
  /** PMREM atlas resolution — 64³ is the 60 Hz / 30-lock budget (QA sprint 12/23). */
  pmremSize: 64,
  /**
   * Adaptive present quality (Sprint 24 / 30 fps floor).
   * frameMs above highMs → drop post bloom; above floorMs → emergency low + DPR cut.
   */
  adaptHighMs: 20,
  adaptLowMs: 14.5,
  /** Hard floor — present cost above this forces low post + thinner pixel ratio. */
  adaptFloorMs: 33.3,
  /**
   * Minimum DPR scale the quality ladder may fall to.
   * 0.5 × maxPixelRatio 1.25 ≈ 0.625 effective at `min` — still enough headroom
   * to protect the 30 fps floor when the sharper race budget runs hot.
   */
  minPixelRatio: 0.5,
  /**
   * Present-cadence lock (Sprint 96 / 547). If the machine still cannot hold
   * the 60 Hz target, stop free-running at ~46 fps with alternating 16.8/33.7 ms
   * frames and deliberately present every second vsync instead. A clean 30 is
   * the minimum acceptable cadence.
   */
  lock30AboveMs: 20,
  /**
   * When the machine cannot hold 60, lock an even 30 *before* dumping the
   * quality ladder to `min`. Photographic shadows/AO beat a soft 50 fps mush.
   * Settle does not force 30 — capable GPUs still free-run at 60 from GO.
   */
  preferLock30: true,
  /** Do not arm lock-30 during GPU settle; let evidence decide after GO. */
  forceLock30AtSettle: false,
  /**
   * Once the race present path is armed, never downgrade post / sky / shadow /
   * DPR mid-stage. Tunnel streaming and shader warms spike present cost for a
   * few frames — that must not read as a graphics mode change. Cadence may
   * still lock to 30 Hz if the machine cannot hold 60.
   */
  lockRaceQuality: true,
  /**
   * Soft present scale floor (QualityManager) when lockRaceQuality blocks tier dumps.
   * Floor kept high so soft-scale resize does not stutter car shadows mid-corner.
   */
  softScaleMin: 0.88,
  /** Sprint 39 / 536 — integrated GPU / M-series targets. */
  integratedFloorMs: 17.5,
  integratedEmergencyMs: 20,
  integratedShadowMap: 1024,
};

/**
 * Sprint 23–25 photoreal / UE5-inspired look — Sprint 30 cinema realism (tier 13).
 */
export const VISUAL = {
  realisticArcade: true,
  /** SK1 tier — tier 13: photographic environment, textures, lighting (Sprint 30). */
  tier: 13,
  /** ACES filmic path + denser procedural albedo (not arcade punch alone). */
  cinemaRealism: true,
  /** Clearcoat paint, metal chrome, roughness maps, stronger IBL response. */
  ue5Look: true,
  /** Physically based sun/hemi intensities (no legacy light model). */
  physicalLighting: true,
  /**
   * Photographic grade — believable midtones, restrained sat, soft bloom.
   * Depth comes from ACES + IBL + texture, not saturation/bloom boosts.
   */
  postFx: true,
  /** V1 — restrained grade; polish from ACES + IBL, not punchier post. */
  bloomStrength: 0.14,
  bloomThreshold: 0.74,
  vignette: 0.11,
  gradeContrast: 1.08,
  gradeSaturation: 1.02,
  gradeWarmth: 0.06,
  /** Film grain off — it read as crawling static on the volumetric sky. */
  sharpen: 0,
  fxaa: false,
  filmGrain: 0,
  /** Trackside crowds, animals, trees, rocks from assets/props/*.glb. */
  glbProps: true,
  /** Extra dune/bank/ridge octaves + denser procedural land paint. */
  terrainRealism: true,
  /** Ghost only fragments on the cam→car sightline (tight tube; opaque otherwise). */
  cameraOcclusionFade: true,
  /** Soft distance fade — stronger at tier 13 for atmospheric depth. */
  aerialPerspective: true,
  aerialStrength: 0.88,
  aerialStart: 22,
  aerialEnd: 680,
  /**
   * Per-scenery aerial curves (V6 surgical air). Multiplies strength; optional
   * start/end override road-distance fade so Desert dust ≠ Mountain thin air.
   */
  aerialByScenery: {
    desert: { strength: 1.12, start: 18, end: 620 },
    forest: { strength: 1.05, start: 22, end: 560 },
    mountain: { strength: 0.92, start: 28, end: 780 },
    lakeside: { strength: 1.18, start: 16, end: 520 },
  },
  /** One authored silhouette cluster per stage (desert arch, forest cedars, lakeside pier). */
  heroLandmarks: true,
  /** Stronger water env response at tier 4+ (lakeside). */
  waterReflection: true,
  /** Rally boards at landmarks + km markers — reads as authored stage. */
  tracksideSignage: true,
  /** Darker/larger ground blobs under trees and hero props. */
  contactShadowBoost: true,
  /** Subtle UV scroll on lake surfaces (cheap motion read). */
  waterScroll: true,
  /** Sprint 27 — billowing rear dirt wake + grit (effects.js). */
  rearDirtWake: true,
  /** Stage sky dust band + horizon bounce (sky.js). */
  envAtmosphere: true,
  /** Procedural anamorphic lens flare + ghosts when the sun is in frame. */
  lensFlare: true,
  /** Tier 13 IBL — world and car read sunlit materials. */
  worldEnvIntensity: 1.08,
  carEnvIntensity: 1.36,
  /** Sprint 32 — sky-rim directional (no shadow) for PBR specular fill. */
  pbrSkyRim: true,
  /** Composite highlight shoulder after ACES ( tame spec bloom ). */
  highlightRolloff: 0.18,
  pbrSkySigma: 0,
  /** Screen-space crevice AO — contact; kept modest so blacks stay open. */
  aoStrength: 0.42,
  aoRadius: 1.35,
  /** Normal strength on road/terrain. */
  normalStrength: 1.55,
  /** Half-res normals — capped below full-res fill-rate cliff (Sprint 96). */
  normalMapScale: 0.92,
  /**
   * Albedo ×2.65 + procedural roughness — photographic ground grain (Sprint 23/30).
   */
  textureScale: 2.65,
  roughnessMaps: true,
  /** Cone/cylinder segments for procedural foliage + trunk cards. */
  propSegments: 20,
  /** Icosahedron subdivisions for rocks, tumbleweed, shrub blobs. */
  rockDetail: 5,
  /**
   * Visual Pass V5 — vegetation density / clustering (InstancedMesh + LOD).
   * Counts feed `_fillWild`; cluster chances feed `_plantForestTree` / cactus.
   */
  veg: {
    forestFarTrees: 720,
    forestFarBush: 145,
    lakesideFarTrees: 400,
    mountainFarTrees: 280,
    desertFarCacti: 175,
    desertFarRocks: 220,
    desertFarBush: 135,
    mountainFarRocks: 210,
    forestClusterChance: 0.4,
    mountainClusterChance: 0.34,
    cactusClusterChance: 0.42,
    /** prop-kit `scaleGeometryToHeight` for Background_Tree_Atlas cards. */
    packCardRefH: 14,
  },
};

/**
 * GTA-style world streaming — only draw geometry within a radius of the player.
 * Load/unload align with fog so slices appear while still haze-hidden, not at
 * the visible edge. Hysteresis stops boundary flicker.
 */
export const STREAM = {
  /** Load at fog.far × this — geometry must exist before it clears the haze. */
  loadFogFactor: 1.08,
  /** Unload beyond fog so slices stay warm until fully fogged out. */
  unloadFogFactor: 1.16,
  /** Fallback radii when the scene has no fog (metres). */
  loadRadius: 900,
  unloadRadius: 980,
  /** Heightmap tile edge length (metres). */
  terrainTileSize: 256,
  /** Base heightmap density — cinema tier uses terrainTileSegsCinema. */
  terrainTileSegs: 24,
  /** Tier 13 only — smoother ridges without forcing 28 on every machine. */
  terrainTileSegsCinema: 28,
  backdropSectors: 16,
  /** Spline chunks kept loaded ahead/behind the car (220 m each). */
  prefetchChunks: 2,
  /** Driving seconds to pre-warm streaming along the racing line. */
  lookaheadSeconds: 2.5,
  /** Extra load margin for large bounds (terrain tiles, backdrop rings). */
  boundsPadding: 80,
  /** Minimum gap between load and unload when using fixed radii (metres). */
  hysteresis: 80,
  /** Floor load radius when fog is tight (tunnels, title) — avoids sudden pops. */
  minLoadRadius: 280,
  /** Countdown / GPU-settle radius — the start grid must be fully drawn. */
  countdownLoadRadius: 820,
  /**
   * Tree / prop mesh LOD (metres to chunk sphere). Inside lodNear the player
   * sees authored GLB canopies; beyond it, crossed-plane cards. Hysteresis
   * stops the swap strobing on a 220 m slice boundary.
   */
  /** V5 — slightly wider GLB band so verge trees stay authored longer. */
  lodNear: 148,
  lodHysteresis: 28,
  /** Far rivals drop castShadow beyond this (metres) — pack fill-rate win. */
  rivalShadowFar: 85,
  /**
   * Nature InstancedMesh drop castShadow beyond this (metres to chunk sphere).
   * Near trees keep soft contact; mid/far rely on contact blobs + sun.
   */
  natureShadowFar: 48,
  /** Scrub / ferns never pay shadow atlas beyond this (metres). */
  scrubShadowFar: 28,
  /**
   * Build-time LOD / veg budgets by settle tier (lockRaceQuality freezes mid-race).
   * High keeps V5 wow; medium/low/min swap to pack cards sooner + thinner far bags.
   */
  lodNearByTier: {
    high: 148,
    medium: 110,
    low: 90,
    min: 75,
  },
  vegScaleByTier: {
    high: 1,
    medium: 0.75,
    low: 0.6,
    min: 0.5,
  },
};

/** Visual tarmac sits this far above the spline. Physics deck must match. */
export const ROAD_DECK = 0.06;

export const COLORS = {
  castrolGreen: 0x0a7a3c,
  castrolGreenDark: 0x065c2c,
  castrolWhite: 0xf4f4f0,
  castrolRed: 0xd4121a,
  castrolYellow: 0xffd200,
  toyotaRed: 0xeb0a1e,
  asphalt: 0x6a6a72,
  gravel: 0x9a8a72,
  dirt: 0x7b5e42,
  cobble: 0x8a8378,
  grass: 0x4d7b42,
  sand: 0xa89068,
  mud: 0x5a4a38,
  /** Packed driving ribbon — stronger mid-tones so surface type reads at speed (V3). */
  ribbonSand: 0xb08a52,
  ribbonGravel: 0x92785c,
  ribbonDirt: 0x825838,
  ribbonTarmac: 0x52565e,
  ribbonCobble: 0x6e6a62,
  ribbonMud: 0x443628,
  ribbonGrass: 0x3a6a2a,
  kerbCream: 0xf2ead0,
  kerbRed: 0xd4121a,
  dunePale: 0xd8c090,
  // Must match LIGHTING.*.fog — aerial land tint and scene fog share one haze.
  fogDesert: 0xdcc8a0,
  fogForest: 0xa0b8cc,
  fogMountain: 0x98b4d0,
  fogLakeside: 0x90b4c4,
};

/**
 * Per-stage outdoor rig: physically based sky (Rayleigh/Mie), key sun, sky fill.
 * Sky colors stay atmospheric blue — they do not copy sand/grass/rock.
 * sunDir is a unit-ish vector (x, y, z) toward the light.
 */
export const LIGHTING = {
  desert: {
    /**
     * Safari earth bias — warm sand bounce + amber key; zenith stays blue sky,
     * not a cold fill wash (AM3 §1 / Sprint v581).
     */
    skyGradient: [
      [0.0, "#6a7a88"],
      [0.28, "#a0b8c8"],
      [0.46, "#d8c8a8"],
      [0.58, "#5aa0d8"],
      [0.76, "#2478c0"],
      [1.0, "#0a4088"],
    ],
    skyZenith: 0x0a4088,
    skyHorizon: 0xd8c8a8,
    skyTurbidity: 2.05,
    skyRayleigh: 1.28,
    skyMie: 0.0054,
    skyMieG: 0.84,
    skyExposure: 1.14,
    skyAtmoBlend: 0.92,
    sunSkyBoost: 1.14,
    sunBloom: 1.22,
    lensFlare: 1.06,
    zenithBoost: 0.46,
    groundBounceMix: 0.24,
    cloudCover: 0.3,
    cloudScale: 1.72,
    horizonGlow: 0xf4d8b0,
    horizonStrength: 0.4,
    dustStrength: 0.34,
    wind: [1.85, 0, 0.65],
    fog: 0xdcc8a0,
    fogNear: 125,
    fogFar: 980,
    hemiSky: 0xa8c0d0,
    hemiGround: 0xd4a870,
    hemi: 0.74,
    sun: 0xffecd0,
    sunKelvin: 5050,
    sunInt: 3.28,
    sunDir: [0.54, 0.72, 0.36],
    rimSky: 0xd0c4a8,
    rimInt: 0.38,
    fill: 0xc8b090,
    fillInt: 0.32,
    ambient: 0xc4b090,
    ambientInt: 0.14,
    exposure: 1.12,
    gradeWarmth: 0.24,
    skyBack: 0x3a88b8,
    worldEnv: 1.34,
  },
  forest: {
    /**
     * Temperate broken sky — cool zenith, soft white fluff, dappled sun.
     */
    skyGradient: [
      [0.0, "#4e7088"],
      [0.34, "#82b0d0"],
      [0.48, "#a8cce8"],
      [0.6, "#2e90dc"],
      [0.8, "#0e68b8"],
      [1.0, "#084088"],
    ],
    skyZenith: 0x0e68b8,
    skyHorizon: 0xa8cce8,
    skyTurbidity: 1.55,
    skyRayleigh: 1.36,
    skyMie: 0.0032,
    skyMieG: 0.78,
    skyExposure: 1.12,
    skyAtmoBlend: 0.92,
    sunSkyBoost: 1.1,
    sunBloom: 1.14,
    lensFlare: 1.0,
    zenithBoost: 0.46,
    groundBounceMix: 0.11,
    cloudCover: 0.4,
    cloudScale: 1.68,
    horizonGlow: 0xc8dcd0,
    horizonStrength: 0.24,
    dustStrength: 0.06,
    wind: [0.35, 0, -0.85],
    fog: 0xa0b8cc,
    fogNear: 82,
    fogFar: 880,
    skyBack: 0x2274c0,
    hemiSky: 0x8ec4e8,
    hemiGround: 0x4a7840,
    hemi: 0.64,
    sun: 0xfff8e8,
    sunKelvin: 5550,
    sunInt: 2.9,
    sunDir: [0.5, 0.72, 0.38],
    rimSky: 0xb0d4f0,
    rimInt: 0.36,
    fill: 0x88b0c8,
    fillInt: 0.24,
    ambient: 0x88a090,
    ambientInt: 0.14,
    exposure: 1.12,
    gradeWarmth: 0.05,
    worldEnv: 1.28,
  },
  mountain: {
    /**
     * Sprint 30 cinema Mountain — thin alpine air, hard key, cool rock bounce.
     */
    skyGradient: [
      [0.0, "#5a7088"],
      [0.4, "#88b0d0"],
      [0.52, "#98c4e8"],
      [0.68, "#2e84d4"],
      [0.88, "#1058b8"],
      [1.0, "#083888"],
    ],
    skyZenith: 0x1058b0,
    skyHorizon: 0x98c4e8,
    skyTurbidity: 1.45,
    skyRayleigh: 1.28,
    skyMie: 0.0026,
    skyMieG: 0.74,
    skyExposure: 1.12,
    skyAtmoBlend: 0.9,
    sunSkyBoost: 1.12,
    sunBloom: 1.16,
    lensFlare: 1.05,
    zenithBoost: 0.48,
    groundBounceMix: 0.1,
    cloudCover: 0.28,
    cloudScale: 1.65,
    horizonGlow: 0xb8d0e4,
    horizonStrength: 0.22,
    dustStrength: 0.045,
    wind: [2.4, 0, 1.1],
    fog: 0x98b4d0,
    fogNear: 118,
    fogFar: 1040,
    skyBack: 0x2070c8,
    hemiSky: 0x90c4f0,
    hemiGround: 0x6a6454,
    hemi: 0.6,
    sun: 0xfffaf5,
    sunKelvin: 6300,
    sunInt: 3.1,
    sunDir: [0.62, 0.62, 0.34],
    rimSky: 0xa8d0f8,
    rimInt: 0.36,
    fill: 0x88a8c8,
    fillInt: 0.2,
    ambient: 0x8098a8,
    ambientInt: 0.12,
    exposure: 1.12,
    gradeWarmth: 0.03,
    worldEnv: 1.14,
  },
  lakeside: {
    /**
     * Sprint 30 cinema Lakeside — cool water bounce, soft mist, bright key.
     */
    skyGradient: [
      [0.0, "#5a8090"],
      [0.38, "#88b8c8"],
      [0.52, "#90c4e0"],
      [0.7, "#2e8cc8"],
      [0.9, "#1468b0"],
      [1.0, "#0a4a90"],
    ],
    skyZenith: 0x1468a8,
    skyHorizon: 0x90c4e0,
    skyTurbidity: 2.05,
    skyRayleigh: 1.26,
    skyMie: 0.004,
    skyMieG: 0.76,
    skyExposure: 1.1,
    skyAtmoBlend: 0.9,
    sunSkyBoost: 1.08,
    sunBloom: 1.1,
    lensFlare: 0.98,
    zenithBoost: 0.4,
    groundBounceMix: 0.13,
    cloudCover: 0.36,
    cloudScale: 1.7,
    horizonGlow: 0xb0d4e0,
    horizonStrength: 0.34,
    dustStrength: 0.14,
    wind: [-0.8, 0, 1.4],
    fog: 0x90b4c4,
    fogNear: 62,
    fogFar: 720,
    skyBack: 0x2278b8,
    hemiSky: 0x88c4e0,
    hemiGround: 0x3e6c4c,
    hemi: 0.66,
    sun: 0xfff0e0,
    sunKelvin: 5800,
    sunInt: 2.7,
    sunDir: [0.56, 0.68, 0.28],
    rimSky: 0x98d0ec,
    rimInt: 0.34,
    fill: 0x78b0c8,
    fillInt: 0.24,
    ambient: 0x78a0b0,
    ambientInt: 0.14,
    exposure: 1.12,
    gradeWarmth: 0.05,
    worldEnv: 1.16,
  },
  /**
   * Title attract / SELECT MODE — cinema showroom. Sculpted key + cool rim,
   * golden horizon, wet IBL. Not a flat blue pad wash.
   */
  title: {
    skyTurbidity: 2.05,
    skyRayleigh: 1.2,
    skyMie: 0.0028,
    skyMieG: 0.86,
    skyExposure: 1.2,
    skyAtmoBlend: 0.9,
    // Broken cumulus with depth — expensive sky behind the hero car.
    cloudCover: 0.5,
    cloudScale: 2.2,
    fog: 0xa2cce8,
    fogNear: 120,
    fogFar: 400,
    skyBack: 0x164e88,
    skyZenith: 0x0a3568,
    horizonGlow: 0xffe6c8,
    horizonStrength: 0.36,
    sunBloom: 1.08,
    lensFlare: 1.1,
    dustStrength: 0.05,
    groundBounceMix: 0.24,
    zenithBoost: 0.44,
    sun: 0xfff1d6,
    // Lower sun = longer contact shadow + chrome catch-lights.
    sunInt: 3.4,
    sunDir: [0.64, 0.56, 0.34],
    fill: 0xa0c0f0,
    fillInt: 0.2,
    ambient: 0xffe2c4,
    ambientInt: 0.055,
    hemiSky: 0xc4dcff,
    hemiGround: 0xc49858,
    hemi: 0.4,
    exposure: 1.2,
    gradeWarmth: 0.12,
    rim: 0xc0e0ff,
    rimInt: 2.15,
    kick: 0xffc878,
    kickInt: 1.12,
    envIntensity: 2.25,
    bodyEnv: 2.15,
    chromeEnv: 2.9,
    glassEnv: 2.05,
    /** Pad / apron pick up sky IBL so asphalt reads wet. */
    worldEnv: 1.42,
  },
};

/**
 * Title / SELECT MODE quality budget — readable showroom at a stable 60 Hz.
 *
 * Race quality is owned by `raceStartTier()` + `createPerfTier` after leave-title
 * settle. These knobs must not leak into the stage present path.
 */
export const TITLE_SHOWROOM = {
  /**
   * Delay PMREM until the splash has had a few presents. Baking mid-orbit
   * froze PRESS START; 900 ms keeps lacquer without a launch hitch.
   */
  iblDelayMs: 900,
  /**
   * Live cube refresh every N presents (0 = sky IBL only). Six faces hitch the
   * attract loop; pad chrome uses the one-shot PMREM bake instead.
   */
  reflectEvery: 0,
  cubeSize: 64,
  /** Low cumulus (6×1, no Worley) — medium 12×2 was the remaining pad GPU floor. */
  skyQuality: "low",
  /** Uniform time advance cadence on the pad (clouds drift; sky is still cheap). */
  skyTickEvery: 10,
  /**
   * Sun atlas on the pad is disabled (castShadow stays false). Cadence kept
   * so a mistaken re-arm cannot bake every frame.
   */
  shadowEvery: 16,
  /** Match GFX title caps so resize cannot silently climb. */
  maxPixelRatio: 1.0,
  maxPixels: 1200000,
  shadowMap: 512,
  /**
   * Attract post flag. Title skips post RTs (`post.setSize` only on race) so
   * presents stay a single ACES pass; quality string is for QA/docs only.
   */
  postQuality: "low",
  /**
   * Present Hz on SELECT MODE / cars / courses (splash stays at targetFps).
   * Half rate leaves the main thread free for clicks while the LOD still spins.
   */
  menuPresentHz: 30,
};

/**
 * Desert rock tunnel — fill + sconces + headlights when the sun is killed.
 * Outdoor LIGHTING still owns the key; these values only apply while
 * tunnelShade() blends toward 1.
 */
export const TUNNEL = {
  /** Ambient floor at full shade (was ~0.08 — pitch black bore). */
  ambientFloor: 0.82,
  /** How much outdoor hemi survives at full shade (was 0.15). */
  hemiRetain: 0.72,
  /** Fill directional remnant at full shade. */
  fillRetain: 0.48,
  /** Overhead spot that follows the car (physical intensity). */
  caveInt: 48,
  caveDistance: 52,
  caveDecay: 1.15,
  /** Fixed wall PointLights (physical intensity). */
  wallInt: 72,
  wallDistance: 68,
  wallDecay: 0.95,
  wallColor: 0xffd9a0,
  /** Fog inside the bore — warm brown, not black. */
  fog: 0x5a4030,
  fogNear: 32,
  fogFar: 320,
  /**
   * Exposure multiplier at full shade. V1 keeps this near 1.0 — tunnel
   * brightness comes from cave/wall lamps + light dimming, not ACES pumping.
   */
  exposureBoost: 1.04,
  /** Lens emissive when headlights are fully on. */
  headEmissive: 34,
  /**
   * SpotLight beam intensity per lamp (physical). Must punch the bore once
   * the key sun is killed — 520 read as a glow, not a road light.
   */
  headBeam: 1280,
  headBeamDistance: 175,
  headBeamAngle: Math.PI / 7.8,
  headBeamPenumbra: 0.48,
  headBeamDecay: 0.95,
  /** Extra headlight gain once tunnel shade is committed (player only). */
  headBeamTunnelBoost: 1.35,
};

/**
 * Per-surface tire and chassis response — the headline mechanic.
 *
 * AM3 research: "brake on tarmac and you stop; brake on mud and you begin a
 * power slide." Each surface therefore needs three separable characters, not
 * one grip number: how far it takes to STOP, how early it BREAKS AWAY, and
 * how it RECOVERS once it has. The five fields below own those three jobs.
 *
 * muPeak: peak friction. muSlide: sliding friction (drift).
 * slipPeak: slip angle (rad) where the tire tips from grip into a holdable
 *   slide. Small = knife-edge and late (tarmac); large = early and lazy (mud).
 * brakeHold: 1 = the surface lets a tire sit at peak slip under braking, so
 *   the stop is short and dead straight. 0 = the wheel locks freely and you
 *   brake on muSlide instead. This is what makes a tarmac stop feel like a
 *   wall and a mud stop feel like an invitation.
 * brakeYaw: fraction of the brake pedal that becomes ROTATION instead of
 *   deceleration once you are also steering. ~0 on tarmac, near 1 on mud —
 *   the literal implementation of the research quote above.
 * slideHold: how long a slide sustains itself with no driver input.
 *   <1 self-centres (tarmac snaps straight), >1 carries (mud hangs on).
 * gripSnap: authority of an ACTIVE recovery — countersteer and unwinding.
 *   High = the car obeys instantly (tarmac). Low = you must be patient (mud).
 * bumpSteer: how strongly ribbon roughness couples into yaw here.
 * roll: rolling resistance. sink: extra compression feel.
 * bump: high-frequency suspension noise amplitude (meters).
 * color: HUD / dust / landscape. ribbon: packed driving surface (darker so the line reads).
 */
export const SURFACES = {
  tarmac: {
    id: "tarmac",
    label: "TARMAC",
    muPeak: 1.64,
    /**
     * AM3: brake on tarmac and you STOP. Peak/slide gap still allows a tidy
     * attitude, but brakeHold keeps the stop short and mostly straight.
     * Sprint v581: widen STOP vs mud POWER-SLIDE — almost no brake yaw, snap recovery.
     */
    muSlide: 1.14,
    slipPeak: 0.078,
    /** Threshold braking holds: shortest stop on the championship, arrow-straight. */
    brakeHold: 1.0,
    brakeYaw: 0.02,
    slideHold: 0.58,
    gripSnap: 1.88,
    bumpSteer: 0.32,
    roll: 0.011,
    sink: 0,
    bump: 0.012,
    dust: 0,
    speedScale: 1.0,
    driftEase: 0.82,
    pacejkaB: 3.85,
    pacejkaC: 1.28,
    pacejkaE: 0.12,
    color: COLORS.asphalt,
    ribbon: COLORS.ribbonTarmac,
  },
  gravel: {
    id: "gravel",
    label: "GRAVEL",
    muPeak: 1.1,
    muSlide: 0.6,
    slipPeak: 0.152,
    /** Half-locking: brakes bite, then let go — the classic gravel pitch-in. */
    brakeHold: 0.3,
    brakeYaw: 0.92,
    slideHold: 1.7,
    /** Catch authority on opposite-lock — still patient vs tarmac, not mush. */
    gripSnap: 1.34,
    bumpSteer: 0.88,
    roll: 0.03,
    sink: 0.02,
    bump: 0.054,
    dust: 1.12,
    speedScale: 0.93,
    driftEase: 1.58,
    pacejkaB: 3.25,
    pacejkaC: 1.22,
    pacejkaE: 0.16,
    color: COLORS.gravel,
    dustColor: 0x6e6860,
    ribbon: COLORS.ribbonGravel,
  },
  dirt: {
    id: "dirt",
    label: "DIRT",
    muPeak: 1.06,
    muSlide: 0.74,
    slipPeak: 0.128,
    brakeHold: 0.34,
    brakeYaw: 0.78,
    slideHold: 1.48,
    gripSnap: 1.36,
    bumpSteer: 0.9,
    roll: 0.03,
    sink: 0.022,
    bump: 0.052,
    dust: 1.0,
    speedScale: 0.9,
    driftEase: 1.48,
    pacejkaB: 3.05,
    pacejkaC: 1.2,
    pacejkaE: 0.18,
    color: COLORS.dirt,
    dustColor: 0x6a553f,
    ribbon: COLORS.ribbonDirt,
  },
  cobble: {
    id: "cobble",
    label: "COBBLE",
    muPeak: 1.32,
    muSlide: 0.92,
    slipPeak: 0.085,
    /** Almost tarmac stopping power, but the stones steer you while you do it. */
    brakeHold: 0.88,
    brakeYaw: 0.18,
    slideHold: 0.75,
    gripSnap: 1.4,
    bumpSteer: 1.05,
    roll: 0.02,
    sink: 0.008,
    bump: 0.062,
    dust: 0,
    speedScale: 0.95,
    driftEase: 0.9,
    color: COLORS.cobble,
    ribbon: COLORS.ribbonCobble,
  },
  grass: {
    id: "grass",
    label: "GRASS",
    muPeak: 0.92,
    muSlide: 0.68,
    slipPeak: 0.12,
    brakeHold: 0.42,
    brakeYaw: 0.4,
    slideHold: 0.98,
    gripSnap: 1.1,
    bumpSteer: 1.1,
    roll: 0.048,
    sink: 0.038,
    bump: 0.024,
    dust: 0.35,
    speedScale: 0.8,
    driftEase: 1.05,
    color: COLORS.grass,
    ribbon: COLORS.ribbonGrass,
  },
  sand: {
    id: "sand",
    label: "SAND",
    muPeak: 0.88,
    muSlide: 0.52,
    slipPeak: 0.158,
    brakeHold: 0.22,
    brakeYaw: 0.98,
    slideHold: 2.05,
    gripSnap: 1.08,
    bumpSteer: 0.8,
    roll: 0.048,
    sink: 0.055,
    bump: 0.024,
    dust: 1.48,
    speedScale: 0.88,
    driftEase: 1.72,
    pacejkaB: 3.1,
    pacejkaC: 1.22,
    pacejkaE: 0.17,
    color: COLORS.sand,
    /** Dust plume — cooler earth than the packed ribbon (avoids banana-yellow wake). */
    dustColor: 0x8a7354,
    ribbon: COLORS.ribbonSand,
  },
  mud: {
    id: "mud",
    label: "MUD",
    muPeak: 0.7,
    muSlide: 0.4,
    slipPeak: 0.178,
    /** AM3 headline: brake on mud and you begin a power slide — not a stop. */
    brakeHold: 0.03,
    brakeYaw: 1.28,
    slideHold: 2.48,
    gripSnap: 0.92,
    bumpSteer: 0.98,
    roll: 0.09,
    sink: 0.095,
    bump: 0.036,
    dust: 1.15,
    speedScale: 0.7,
    driftEase: 1.95,
    pacejkaB: 2.8,
    pacejkaC: 1.2,
    pacejkaE: 0.2,
    color: COLORS.mud,
    dustColor: 0x3e3428,
    ribbon: COLORS.ribbonMud,
  },
};

/**
 * Global driving feel — the exaggeration dials.
 *
 * AM3 / Sakamoto (Sega Rally 1995): surface friction is the headline; the slide
 * is a *tool*, not a failure; exaggerate for fun so novices stay in control;
 * brake on mud begins a power slide; downshift while turning is a drift trigger.
 * Sprint 73–75c added GTA IV *readable weight* as a secondary layer — AM3 wins
 * when the two conflict (easy catch, holdable attitude, distinct surfaces).
 *
 * Sources: docs/AM3-RESEARCH.md; Sega-16 Behind the Design; Saturn manual tips
 * (brake tap / downshift before the curve); Sakamoto on novice-friendly slides.
 */
export const HANDLING = {
  /** Tire substeps for the player. Four keeps 240 Hz tire relaxation stable. */
  substeps: 4,
  /** Opponents — three substeps keeps pack suspension smooth without player cost. */
  aiSubsteps: 3,
  brakeTorqueFront: 3200,
  brakeTorqueRear: 2100,
  /**
   * Rear lock — arcade e-brake must dump rear µ hard so the tail snaps out
   * into a power slide (initiation), not a gentle scrub.
   */
  handbrakeTorque: 7200,
  /** Slip ratio where longitudinal force peaks. Brake modulation aims here. */
  peakKappa: 0.11,
  /**
   * Countersteer authority. Opposite lock during a slide must feel like a
   * switch, not a suggestion — this is what turns the slide into a tool.
   */
  counterAuthority: 3.35,
  /**
   * How hard throttle pushes the slide wider on loose ground (and pulls it
   * straight on hard ground). Scales with the surface driftEase spread, so
   * one dial covers "throttle steers you" across all seven surfaces.
   */
  throttleSlide: 2.25,
  /**
   * Bump + steering-away amplifier. Research: two wheels on a bump plus
   * steering away from it can end you. Amplify it, do not hide it.
   */
  bumpSteerAmplify: 1.35,
  /**
   * Ribbon roughness felt as yaw/lateral disturbance, per m/s of speed.
   * Raise for a rougher, more nervous stage; lower for a rail.
   */
  bumpYawGain: 0.024,
  /**
   * Grade (rad) below which a stopped car may hold on stiction. Above it,
   * gravity wins and the car rolls back down the hill.
   */
  stictionSlope: 0.05,
  /**
   * Base ceiling on lateral velocity so a slide is dramatic but never a spin.
   * Scaled per surface by slideHold in vehicle.js (SLIDE_CAP_MIN/MAX).
   */
  /** Arcade power-slide ceiling — big attitude, long carry, snappy pitch-in. */
  maxSlideVel: 22.5,
  maxSlideVelHandbrake: 31.0,
  /**
   * Handbrake power-slide knobs (arcade initiation → sustain):
   * enter = hb fraction to treat as sliding;
   * bleedMul = lateral slip decay while e-brake held (lower = longer slide);
   * yawKick = rotation shove when hb + steer (initiation snap);
   * powerMul = throttle widens the slide while e-brake is held (power oversteer).
   */
  handbrakeEnter: 0.05,
  handbrakeBleedMul: 0.022,
  /** Initiation shove — player finishes the slide (Phase 1: not instant 90°). */
  handbrakeYawKick: 3.15,
  handbrakePowerMul: 2.35,
  /** Power-slide sustain without e-brake (throttle + steer sideways). */
  driftBleedMul: 0.022,
  /** Lateral grip scale at full slide angle (lower = slipperier / bigger attitude). */
  slideGripMul: 0.15,
  /**
   * Extra rear µ dump while e-brake is held (0 = none, 1 = almost no rear grip).
   * This is the mechanical "lock the rears" feel of a rally handbrake turn.
   */
  handbrakeRearMu: 0.06,
  /**
   * Throttle + steer pitch-in on loose ground (no e-brake). Higher = easier
   * to light the rear with power alone — classic arcade power slide.
   */
  powerSlidePitch: 2.55,
  /**
   * Trail-brake rotation. Brake + steer on loose surfaces transfers weight
   * forward and rotates the nose — AM3 "brake into the corner" technique.
   */
  trailBrakeYaw: 0.88,
  /**
   * Bonus countersteer authority when catching a slide at the limit.
   * Scales yawFollow when opposite lock is active — catch = switch.
   */
  expertCounterMul: 1.74,
  /**
   * Readable weight transfer. Brake unloads the rear → oversteer;
   * throttle unloads the front → mild push. Keep below GTA IV so novices
   * are not "drunk car" heavy.
   */
  weightTransferMul: 2.28,
  /** Bicycle understeer gradient — mild push at speed, still AM3-easy. */
  speedUndersteer: 0.00185,
  /** Lift-off oversteer mid-corner — close throttle, the tail comes. */
  liftOffYaw: 0.92,
  /** Extra yaw past the grip cap that still arrives (mushy breakaway, not a rail). */
  limitMush: 0.58,
  /** Visible chassis lean from lateral g — readable weight, not a cabinet tip. */
  bodyRollMul: 2.05,
  bodyRollMax: 0.138,
  /**
   * Phase 1 — readable longitudinal weight transfer on the mesh (radians toward
   * nose-down when braking). Kept modest so Sprint 542 planted stance remains.
   */
  brakeDiveVis: 0.052,
  accelSquatVis: 0.038,
  /** Extra visual scale on per-wheel travel (player mesh). Keep near 1 — 1.5× read as trampoline. */
  wheelTravelVisual: 1.05,
  /**
   * Visual drive squat / dive — always 0. Non-zero values tilted the car
   * nose-up on throttle. Landing squash uses JUMP settle, not these.
   */
  brakeDive: 0,
  accelSquat: 0,
  /**
   * Tire-moment yaw blend. Mid = mass you can feel without drunk-car lag.
   */
  tireYawBlend: 0.44,
  /**
   * Sakamoto gear-drift: downshift while turning unloads the rear.
   * Manual and auto both use this kick so the default auto box still drifts.
   * Lower/abrupt downshift while turning = tighter drift (doc transcript).
   */
  gearDriftKick: 0.66,
  gearDriftKickMax: 1.35,
  gearDriftYaw: 0.95,
  /**
   * Brake+steer rotation scale (multiplies surface.brakeYaw). AM3: brake on
   * mud begins a power slide; tarmac still mostly stops straight.
   */
  brakeSteerYaw: 1.58,
  /**
   * GTA analog: fTractionCurveMin / fTractionCurveMax gap
   * (handling.dat Wc- / Wc+). Scales muSlide so once you break away you
   * STAY sliding until you catch it. <1 = IV looser; 1 = V glued.
   */
  tractionMinMul: 0.82,
  /**
   * GTA analog: fLowSpeedTractionLossMult (handling.meta name; IV got the
   * same wheelspin from a low CurveMin). Small — hairpins must stay snappy.
   */
  lowSpeedTractionLoss: 0.14,
  /**
   * GTA analog: m_fDriveInertia (Ti). Physical scale: 1 = stock wheel I,
   * >1 heavier hubs / slower spin-up. IV's dat encodes the inverse
   * (1.0 = lightest); we do not copy that encoding.
   */
  driveInertia: 0.94,
  /**
   * Sprint 28 — dead-stop launch. Multiplies drive torque at 0 km/h and fades
   * toward 1.0 by launchFadeKmh. Raised for arcade exit punch after drifts.
   */
  launchBoost: 1.62,
  launchFadeKmh: 105,
  /**
   * Extra drive when throttling out of a yaw slide (AM3 arcade exit).
   * Multiplies tqDrive while sideways + on throttle so the car *surges*
   * as you straighten — classic rally power-slide fun.
   */
  slideExitBoost: 1.46,
  /** |driftAngle| (rad) where exit boost is fully armed. */
  slideExitAngle: 0.12,
  /** Fade exit boost once speed exceeds this (km/h) so top end stays honest. */
  slideExitFadeKmh: 175,
  /**
   * Chassis stability — follow the axle-plane deck, filter only ribbon noise.
   * Player and AI share the planted hull; rivals still use cheap road probes.
   */
  /** Residual HF bobble on top of query micro-terrain (main unevenness is in Track.query). */
  roadChatterScale: 0.055,
  /** Lateral road camber from left/right wheel height (radians scale). */
  roadRollGain: 1.05,
  /** Max wheel hub travel into/out of the well (metres) — Group A rally travel. */
  wheelTravelMax: 0.1,
  /**
   * Per-corner suspension (1/s toward geometric compression). Bump is faster
   * than rebound so landings plant; rebound stays firm (not trampoline).
   */
  suspBumpRate: 58,
  suspReboundRate: 42,
  /** Extra normal load (N) per metre of wheel compression into the arch. */
  suspLoadGain: 9200,
  /** Camber→lateral force scale from road-induced roll (subtle). */
  camberLatGain: 0.12,
  deckFollowRate: 58,
  /** Direct deck plant rate (1/s) — slightly softer so suspension can work. */
  /** Direct deck plant rate (1/s) — snappy so cars stay glued to the ribbon. */
  groundPlantRate: 72,
  groundSpringHz: 24,
  groundSpringZeta: 1.15,
  /** Landing-squash follow rate (1/s). Accel/brake do not pitch the mesh. */
  squatSmoothRate: 12,
  /**
   * Arcade automatic — tuned for fast rally fun, not economy cruising.
   * Hold gears near redline on throttle; drop early under brake / kick-down.
   */
  auto: {
    /** Fraction of redline for WOT upshift (hold the pull). */
    upWot: 0.955,
    /** Light-throttle upshift (fraction of redline). */
    upCoast: 0.68,
    /** Kick-down when throttle is pinned and RPM is below this. */
    kickDownRpm: 4800,
    /** Brake-downshift floor at light brake (rises with pedal). */
    brakeDownMin: 5000,
    /** Brake-downshift floor at full brake / handbrake. */
    brakeDownMax: 6400,
    /** Coasting downshift RPM (throttle shut, no brake). */
    coastDownRpm: 3400,
    /** Min seconds between shifts (brake path uses the short cool). */
    coolUp: 0.09,
    coolDown: 0.055,
    coolBrake: 0.04,
  },
};

/**
 * Hidden / tunable arcade assists — the "Sega Rally dial".
 *
 * Philosophy (docs/AM3-RESEARCH.md §2 + player brief):
 *   REAL INPUT → BELIEVABLE DYNAMICS → SUBTLE ASSIST → FUN
 * Not: INPUT → fake rotate-on-spot.
 *
 * These do NOT replace tire forces. They widen the recovery window and help
 * turn-in without removing consequences for being too fast / too greedy.
 *
 * Binding feel contract: docs/SEGA_RALLY_DRIVING_MODEL.md
 * (~70% physical / ~30% invisible assist — philosophy, not a formula).
 * Live dials: ?physlab=1 or F8 (js/debug/physics-debug.js).
 *
 * WHO THIS IS FOR: handling tuners. Keep values modest — "I saved that" not
 * "the game steered for me". Never expose a "DRIFT ASSIST" HUD to players.
 */
export const ARCADE_ASSIST = {
  /**
   * Extra yaw toward steering intent while grip is building (0 = off).
   * Cap is hard inside vehicle.js — never a spin motor.
   */
  yawAssist: 0.20,
  /** Soften lateral velocity when opposite-lock + slip still recoverable. */
  recoveryAssist: 0.76,
  /** |vy| (m/s) below which recoveryAssist may help (above = consequence). */
  recoverableSlide: 12.5,
  /** Extra rear grip rebuild while countersteering at mid slip (0–1 scale). */
  driftStability: 0.48,
  /** Landing: damp residual yaw rate after a planted touchdown. */
  landingAssist: 0.55,
  /**
   * Tire sweet-spot width. Higher = longer progressive fall from peak grip
   * into slide (grip→slide→recover), not cliff→spin.
   */
  tireSlideSoft: 2.4,
  /** Mild peak boost near slipPeak (arcade "tires work hardest at ~5–10°"). */
  tirePeakBoost: 1.08,
};

/**
 * Jump model per Yoshio Fujimoto, the Safari rally driver who advised the
 * Saturn team: lift off just before the crest, brake so the nose drops, land
 * flat. Flat-out jumping is dangerous.
 *
 * The causal chain we implement: lifting unloads the launch (less vertical
 * throw), braking spins the wheels down and the reaction torque drops the
 * nose, and a chassis whose pitch matches the descent path lands on all four
 * wheels with almost no scrub. Nose-high arrivals land tail-first, scrub, and
 * leave the car unsettled for the next crest.
 */
export const JUMP = {
  /** Seconds of lift + brake before the lip that count as full technique. */
  techniqueWindow: 0.3,
  /**
   * Fraction of launch velocity kept by a perfectly executed lift.
   * Good technique lands flatter/lower; flat-out throws higher and arrives wrong.
   */
  liftLaunchCut: 0.56,
  /** Flat-out launch bonus (multiplies raw before technique cut). */
  flatOutLaunchBoost: 1.2,
  /** Nose-down attitude (rad) a full lift-and-brake buys you at the lip. */
  liftNoseDrop: 0.26,
  /**
   * Apex height multiplier (h ∝ vy²). High enough that a Safari lip hangs
   * like a real throw — not a stubby hop, not a floaty hang.
   */
  launchHeightScale: 0.52,
  /**
   * Extra apex cut for AI / lowDetail pack only (h ∝ vy²). 0.2 = one-fifth of
   * the shared launchHeightScale flight — rivals were still lofting like rockets.
   */
  aiLaunchHeightScale: 0.2,
  /** Ballistic launch ceiling (m/s) after launchHeightScale. */
  maxLaunchVy: 9.6,
  /**
   * Floor only for real lips — was 1.8 and forced a hop on every crest.
   * Tiny transitions can leave with near-zero vertical and still glide.
   */
  minLaunchVy: 0.04,
  /** Road-following vertical gain on ramps — speed × sin(pitch) × this. */
  rampVyScale: 0.95,
  /** How much stored ramp climb energy joins the ballistic leave (0–1). */
  throwBlend: 0.45,
  /**
   * Suspension stores energy on the ramp; the lip releases it into launch speed.
   * Keep below ballistic so leaves read as throws, not trampoline hops.
   */
  springBurst: 1.85,
  springCompressRate: 3.8,
  springReleaseRate: 10,
  /** Throttle/brake weight transfer into compress while climbing a lip. */
  springThrottle: 0.42,
  springBrake: 0.62,
  springPitch: 2.8,
  /**
   * Attitude (rad, + = nose up) the driver commands in mid-air. Holding
   * throttle keeps the wheels driving and the nose up; braking spins them
   * down and the reaction torque tips the nose over. Soft — not RC-plane.
   */
  airPitchUp: 0.26,
  airPitchDown: 0.38,
  airPitchRate: 3.2,
  airPitchMax: 0.46,
  /** In-air pitch inertia — higher = coasts like a heavy chassis. */
  airPitchInertia: 2.05,
  airPitchDamp: 1.05,
  /**
   * Fraction of leave attitude taken from the live mesh/road pitch so the
   * car does not pop from planted to a canned hop pose at the lip.
   */
  leaveCarry: 0.72,
  /**
   * Nose-high aero lift. Modest hang at speed — large values flatten the apex
   * into a float then a late drop (reads as a hop).
   */
  aeroFloat: 0.12,
  /** Extra g when the nose is down (dive). */
  aeroDive: 0.24,
  /**
   * Airborne longitudinal bleed. Keep momentum in flight — old airNoseDrag 0.58
   * + floor 0.84 dumped ~40% speed on a lofted hang and made every crest stall.
   * Attitude still trims a little (nose-up presents more area); base is near zero.
   */
  airBaseDrag: 0.002,
  airNoseDrag: 0.14,
  /** Lateral / yaw bleed while airborne (1/s). Soft — hard bleed killed throw. */
  airLatBleed: 0.28,
  airYawBleed: 0.35,
  /** Pitch/path mismatch (rad) that counts as a fully botched arrival. */
  mismatchFull: 0.22,
  /**
   * Speed kept on a flat landing vs a fully mismatched one.
   *
   * THIS IS THE PAIR THAT DECIDES WHETHER TECHNIQUE PAYS. Lifting and braking
   * into a lip costs real speed on the approach, so a botched arrival has to
   * cost MORE than that or the taught line is a trap and flat-out wins — which
   * is the opposite of what the research asks for. Landing tail-first at speed
   * therefore drags off nearly a fifth of it in one hit, on top of the grip the
   * unsettled pool takes away afterwards. Widen the gap to make the technique
   * matter more; narrow it to make crests more forgiving.
   *
   * Sprint v581 (Fujimoto): flat keep ≈ all speed; flat-out mismatch dumps ~40%.
   */
  flatScrub: 0.998,
  worstScrub: 0.58,
  /** Yaw kick (rad/s) a fully botched landing throws at you. */
  landUpsetYaw: 0.85,
  /**
   * "Teetering on the edge of control": each bad landing tops up an unsettled
   * pool that bleeds grip and adds yaw noise. It decays over this many
   * seconds, so a JUMP SEQUENCE compounds where a single jump forgives.
   */
  balanceDecay: 2.8,
  /**
   * Grip lost at a full unsettled pool. Enough to feel, not enough to spin.
   * This is the other half of the technique payoff and the part that makes a
   * jump SEQUENCE bite: the corner after a botched crest is where you actually
   * pay for it, because the pool is still draining when you get there.
   */
  balanceGripLoss: 0.3,
  /**
   * RAGE-style rigid-body air (GTA IV/V vehicle, not ped Euphoria).
   * Variation is state at the lip — speed, attitude, compress, line — never RNG.
   */
  lipGrain: 0.1,
  inheritPitch: 0.55,
  /** How much authored jumpThrow (rise×gap) scales leave velocity. */
  jumpScaleInfluence: 0.42,
  /** Extra throw from sampled lip grade vs axle pitch alone. */
  lipGradeInfluence: 0.35,
  /** Surface bump → spring pop (sand/mud compress more than gravel). */
  surfaceSpringGain: 3.4,
  /** Surface bump → landing bounce / unsettle. */
  surfaceLandGain: 3.2,
  /** Climb rate stored on the ramp converted to leave energy. */
  climbThrowGain: 0.72,
  /** Lateral speed couples into air roll (off-line takeoffs). */
  airCrossCouple: 0.12,
  airRollMax: 0.28,
  airRollDamp: 1.35,
  /**
   * Tail-first rebound amp. Keep small — big bounce reads as floaty hop.
   */
  landBounce: 0.11,
  /** Descent rate (m/s) before a mismatched landing can leave the ground again. */
  landBounceImpact: 6.8,
  /** Minimum graded bounce before re-air is allowed. */
  landReairMin: 1.25,
  /** Fraction of downward vel absorbed into the land spring on pad kiss. */
  landVelAbsorb: 0.9,
  /**
   * After touchdown: suspension squash + one short rebound, then snap level.
   * Long settle windows read as floaty / late recovery.
   */
  landSettleMin: 0.12,
  landSettleMax: 0.3,
  /** Extra Three.js pitch (rad) allowed while settle is live. */
  landSettlePitchMax: 0.14,
  /** Extra roll (rad) carried through the settle rock. */
  landSettleRollMax: 0.12,
  /** Nose-down squash (rad) per m/s of impact (seed; spring owns the curve). */
  landImpactSquash: 0.028,
  /** Attitude offset decay (1/s) — higher = levels out faster after touchdown. */
  landSettleDamp: 7.0,
  /** Extra damp as settle nears end (snaps the last of the rock). */
  landSettleDampEnd: 14.5,
  /** Legacy squash exponential — prefer landCompress spring when present. */
  landSquashDamp: 5.6,
  /** Visual suspension sink (m) per m/s of impact. */
  landCompressGain: 0.105,
  landCompressMax: 0.12,
  /** Near-critical land spring — weight on kiss, one quick rebound, plant. */
  landCompressWn: 28,
  landCompressZeta: 0.98,
  /** Rebound extension past rest (m, negative x) for visible bounce. */
  landCompressExtMin: -0.008,
  /** Pitch blend rate (1/s) while land settle is live. */
  landPitchBlend: 22,
  /** Roll spring scale while settle is live (<1 = heavier rock). */
  landRollWnScale: 0.78,
  landRollZeta: 1.02,
};

/**
 * Chassis templates — AM3 picked these because they were real WRC cars that
 * had never raced each other (Celica vs Delta), plus the hidden 2WD Stratos.
 */
const CHASSIS = {
  mass: 1260,
  yawInertia: 2480,
  pitchInertia: 860,
  rollInertia: 640,
  wheelbase: 2.55,
  trackFront: 1.51,
  trackRear: 1.51,
  /** Real-world overall length (m) — GLB fit target; 1 unit = 1 m in track space. */
  lengthM: 4.37,
  cgHeight: 0.41,
  wheelRadius: 0.325,
  restLength: 0.36,
  travel: 0.18,
  /** Softish Group A springs — travel you can see, still controlled. */
  spring: 42000,
  damper: 5800,
  damperBump: 7200,
  damperRebound: 4800,
  antiRollFront: 7800,
  antiRollRear: 5600,
  maxSteer: 0.52,
  /** AM3 novice rack — quick into hairpins, still muted at top speed. */
  steerSpeed: 126,
  steerReturn: 108,
  /** High-speed mute — mild push above 180 km/h, not a rail fight. */
  steerFalloff: 0.009,
  yawGain: 1.28,
  /**
   * GTA analog: m_fTractionBias (Wh). 0.5 = equal axles. Lower = more rear
   * grip = planted Sultan 4WD. Higher = more front grip = Comet oversteer.
   */
  tractionBiasFront: 0.46,
  /**
   * Sprint 28 — Group A launch. peakPowerKw scales the torque map in vehicle.js.
   * Dead-stop pull uses launchBoost + a fatter low-RPM curve + shorter 1st.
   */
  peakPowerKw: 335,
  redline: 7600,
  idleRpm: 950,
  /**
   * Index 0 is NEUTRAL (ratio 0), then four forward gears — the Saturn box.
   * Shorter 1–2 for punchy launches and drift exits; 4th still meets maxSpeed.
   */
  gears: [0, 3.72, 2.18, 1.42, 0.95],
  topGear: 4,
  finalDrive: 4.55,
  drivetrain: "4wd",
  torqueSplitFront: 0.48,
  engineBrake: 0.3,
  /** Less aero wall so mid/exit pull stays strong after a slide. */
  aeroDrag: 0.28,
  downforce: 0.14,
  /** Soft ceiling (m/s × surface.speedScale). Celica cruises ~255 on tarmac. */
  maxSpeedKmh: 255,
  driftMul: 1.0,
};

export const CARS = {
  celica: {
    ...CHASSIS,
    id: "celica",
    name: "CELICA GT-FOUR",
    short: "CELICA",
    blurb: "4WD  ·  planted power-slide — learn the stage like AM3 Desert",
    /** Phase 1 identity: less rear rotation, traction-biased 4WD. */
    driftMul: 0.96,
    yawGain: 1.16,
    tractionBiasFront: 0.43,
    steerSpeed: 118,
    yawInertia: 2620,
    engineName: "3S-GTE turbo",
    turbo: true,
  },
  delta: {
    ...CHASSIS,
    id: "delta",
    name: "DELTA HF",
    short: "DELTA",
    blurb: "4WD  ·  snappy Integrale — rotate and go",
    lengthM: 3.85,
    yawInertia: 1680,
    maxSteer: 0.52,
    steerSpeed: 148,
    steerReturn: 108,
    yawGain: 1.5,
    tractionBiasFront: 0.5,
    /** A hair under Celica top — same punch, still catchable in hairpins. */
    maxSpeedKmh: 246,
    driftMul: 1.22,
    engineName: "2.0 16v turbo",
    turbo: true,
  },
  stratos: {
    ...CHASSIS,
    id: "stratos",
    name: "STRATOS HF",
    short: "STRATOS",
    blurb: "RWD  ·  fastest, loosest — hold it with throttle",
    mass: 980,
    yawInertia: 1320,
    lengthM: 3.71,
    wheelbase: 2.18,
    drivetrain: "2wd",
    torqueSplitFront: 0,
    maxSteer: 0.56,
    steerSpeed: 148,
    steerReturn: 96,
    steerFalloff: 0.007,
    yawGain: 1.62,
    tractionBiasFront: 0.62,
    driveInertia: 0.92,
    /** Sprint 28: stays the fastest car (~265), still surface-limited. */
    maxSpeedKmh: 268,
    peakPowerKw: 355,
    driftMul: 1.38,
    /** Starter car — unlocked with Celica / Delta from SELECT CAR. */
    locked: false,
    idleRpm: 1100,
    redline: 7800,
    /** Taller box than the 4WDs; shorter 1st for launch. */
    gears: [0, 3.25, 1.95, 1.35, 0.92],
    engineName: "Dino 2.4 V6",
    turbo: false,
  },
};

/** Castrol Celica GT-Four ST205-inspired chassis (default player car). */
export const CELICA = CARS.celica;

export const CAMERA = {
  chaseDistance: 7.8,
  chaseHeight: 2.08,
  lookAhead: 13,
  stiffness: 28,
  fov: 60,
  /**
   * Extra FOV at speed — Model 2 “the world rushes in,” IV chase-cam mass UI.
   * Punch ≈ speed(m/s) × speedFov, capped by maxFovPunch (~18° flat-out).
   * Per-view `speedFovScale` can mute this (medium keeps start framing).
   */
  speedFov: 0.28,
  maxFovPunch: 16,
  /** Metres of look-ahead added per m/s of speed (road prediction). */
  speedLookAhead: 0.14,
  /**
   * Phase 1 spring chase (non-POV). Stiffness ≈ ω²; damping defaults to critical.
   */
  springPosStiff: 48,
  springPosDamp: 0,
  springPosStiffY: 22,
  springLookStiff: 36,
  springLookDamp: 0,
  springFovStiff: 28,
  /** Extra XZ spring stiffness while accelerating so medium does not trail the car. */
  accelFollowBoost: 1.55,
  /** Camera lean from longitudinal g (brake = nose-down look, accel = squat). */
  accelCamPitch: 0.14,
  brakeCamPitch: 0.22,
  /** Multiplier on existing land Y/FOV kick in `_feelPad` (Stage 6 mass punch). */
  landKickScale: 1.12,
  /** Pitch bias scale in `_chaseCam` (was hard-coded 0.04 / 0.03). */
  brakePitchMul: 0.065,
  accelPitchMul: 0.045,
  /** World-up lean from chassis roll — a hint, not a horizon swing. */
  rollFollow: 0.26,
  /** How hard chase yaw tracks the car — high = no “camera late” lag. */
  yawStiffness: 36,
  /**
   * Soften chase yaw follow while sliding so the lens does not whip with
   * body attitude into the outside of the turn.
   */
  yawStiffnessSlide: 16,
  /**
   * When sliding, blend chase yaw target toward velocity (travel) vs chassis
   * yaw. Higher = camera stays behind the racing line; car still reads angled.
   */
  slideYawBlend: 0.62,
  /**
   * Chase look blends toward velocity in a slide so the road you are sliding
   * toward stays in frame while the car sits at an angle (arcade poster).
   */
  slideLook: 0.78,
  /** Metres of camera offset to the outside of a power slide (subtle rear-quarter). */
  slideCamOut: 0.16,
  /** Extra look-ahead (m) while sliding so the exit stays readable. */
  slideLookAhead: 4.2,
  /** Cap on |lateral kick| during a slide (metres). */
  slideKickMax: 0.045,
  /**
   * Seconds for a C-key pose ease. Short so mode swaps feel instant, not a hang.
   */
  viewBlendTime: 0.28,
  /** POV↔chase ease — keep brief; hitch-free warm means we do not need a long cover.
   */
  viewBlendTimePov: 0.32,
  /** Chase follow while settled — snappy, no float. */
  viewBlendStiffness: 26,
  /** Seat lock once POV blend finishes (hard copy, this is a fallback). */
  povBlendStiffness: 42,
  /** FOV / near ease while settled. During a C-key blend they track the pose. */
  fovBlendStiffness: 18,
  /** Metres from POV eye before the cabin attaches. */
  povAttachDist: 1.35,
  /** Pull back this far before restoring the exterior body when leaving POV. */
  povDetachDist: 1.6,
  /**
   * Blend ease when cabin/body visibility flips (0–1). Early seat = no empty-shell wait.
   */
  povSeatEase: 0.18,
  /**
   * Extra frames the rearview may reuse its last image after seating.
   * Never used when the RT is empty — that path captures immediately.
   */
  mirrorDeferFrames: 1,
  /** C cycles POV → medium chase → far. Default race view is medium. */
  defaultMode: 1,
  views: [
    {
      id: "pov",
      label: "POV",
      /** Fallback — per-car rig from celica.getPovRig() overrides these. */
      eyeX: -0.36,
      eyeY: 1.28,
      eyeZ: -0.12,
      lookY: 1.18,
      lookZ: 4.5,
      fov: 80,
      stiffness: 42,
      near: 0.05,
    },
    {
      id: "medium",
      label: "MEDIUM",
      /** Default chase — closer / lower so the car fills the frame without bumper crop. */
      back: 4.55,
      height: 1.42,
      lookAhead: 7.4,
      lookY: 0.42,
      fov: 64,
      /** Mild speed squat — keeps pavement in frame without burying the roof. */
      speedDropMax: 0.14,
      /**
       * Kill speed FOV / look stretch — accel used to make the lens feel yards farther
       * than the start-grid framing even though `back` was fixed.
       */
      speedFovScale: 0.08,
      speedLookAheadScale: 0.2,
      /** Harder XZ follow than global so throttle does not leave the camera trailing. */
      springPosStiff: 78,
      springPosStiffY: 28,
      stiffness: 34,
      near: 0.2,
    },
    {
      id: "far",
      label: "FAR",
      /** Higher / wider for pack readability — leave alone for Sprint 19 speed pass. */
      back: 13.6,
      height: 4.05,
      lookAhead: 19,
      lookY: 0.62,
      fov: 54,
      stiffness: 18,
      near: 0.28,
    },
  ],
};

/**
 * Arcade championship, per the research brief: ONE LAP per course, 14 computer
 * opponents, you start 15th, and the clock is extended at checkpoints. Six
 * checkpoints are split unevenly across the first three courses (1 / 2 / 3 —
 * see js/tracks/courses.js). The split follows stage LENGTH, not stage count:
 * a checkpoint buys back time proportional to how much driving is left, which
 * lands at roughly one per 35-40 s of lap.
 * Finishing position ROLLS OVER into the next course. Nothing hard-fails a run:
 * walls and rivals glance, there is no off-course elimination.
 * Lakeside unlocks only from 1st after Mountain. Practice is two laps.
 */
export const CHAMPIONSHIP = {
  opponents: 14,
  /**
   * A full 14-car pack on every stage, as shipped. Tight stages get a longer
   * grid pitch instead of fewer cars so the field still thins out into a
   * believable running order before the first corner.
   */
  opponentsByCourse: {
    desert: 14,
    forest: 14,
    mountain: 14,
    lakeside: 14,
  },
  startPosition: 15,
  /** One checkpoint buys back roughly a third of a stage. */
  checkpointBonus: 25,
  gridSpacing: 10,
  gridSpacingByCourse: {
    forest: 13,
    mountain: 13,
    lakeside: 12,
  },
  practiceOpponents: 1,
  practiceLaps: 2,
  /**
   * Starting clock per stage, in seconds. DIFFICULTY DIAL: raise to forgive.
   *
   * Calibrated against two measured reference points per stage, not guesswork:
   *
   *  1. A theoretical optimum from the layout itself (corner-radius-limited
   *     speed, then a brake pass, then an accel pass, on the same per-surface mu
   *     the tire model uses): Desert 84 s, Forest 91 s, Mountain 96 s,
   *     Lakeside 66 s. No human hits this; it is the floor.
   *  2. Actual driven laps by the AI field in the real physics. Front-runner /
   *     back-marker: Desert 106/130 s, Forest 105/134 s, Mountain 122/155 s,
   *     Lakeside 81/105 s.
   *
   * Total clock available is stageTime + checkpoints * checkpointBonus, so:
   * Desert 125 s, Forest 140 s, Mountain 153 s, Lakeside 102 s. The front of the
   * field clears that with 19-31 s in hand, and the very back of the field does
   * not clear it at all — driving at back-marker pace should genuinely time out,
   * which is the point of a rally clock. If the pack could not beat the clock the
   * championship would make no sense; if everyone could, it would not be a rally.
   *
   * STILL NEEDS A HUMAN LAP. A real player sits somewhere between the two
   * references and nobody has driven these in a browser yet, so treat these as a
   * safe starting point that errs generous rather than as final balance.
   */
  stageTime: {
    desert: 108,
    forest: 90,
    mountain: 86,
    lakeside: 56,
  },
};

/**
 * Opponent pace and personality.
 *
 * Goal from the brief: rivals should read as drivers, not as a train. They get
 * surface-aware pace, believable slides, occasional small mistakes, and a
 * rubber band tight enough to stay invisible. They must be beatable, and they
 * must never punt the player off the road.
 */
export const AI = {
  /**
   * Sprint 26: pack must outpace a throttle-only player. Floor/ceiling raised so
   * holding accelerate without steering cannot casually take 1st on every stage.
   */
  skillFloor: 0.9,
  skillCeiling: 1.05,
  /** Corner-entry braking bias. Higher = more trail-braking, later apex. */
  trailBrake: 0.55,
  /** Seconds between a rival's chances to make a small mistake. */
  mistakeInterval: 8.5,
  /** Peak size of a mistake: a late brake, a wide line, a scruffy exit. */
  mistakeSize: 0.22,
  /**
   * Catch-up authority, as a fraction of throttle. Still invisible — only when
   * a rival is behind the player after a mistake.
   */
  rubberBand: 0.09,
  /** Metres of gap at which the rubber band reaches full (still tiny) effect. */
  rubberBandRange: 200,
  /** Pro line: tighter apex on tarmac, wider on loose surfaces. */
  proLineTarmac: 1.18,
  proLineLoose: 0.82,
  /** Extra look-ahead for braking points (metres). */
  proLookNear: 2,
  proLookFar: 6,
  /** Extra skill per stage so Forest/Mountain/Lakeside rivals keep pace with the player. */
  skillByCourse: {
    desert: 0.02,
    forest: 0.04,
    mountain: 0.07,
    lakeside: 0.1,
  },
  /**
   * Rivals yield harder to the player than to each other. AM3 championship has
   * no crash-out, so a rival must never be the reason a run ends.
   */
  playerRespect: 1.85,
  /**
   * Drift discipline. A rival that stays flat on the throttle while sideways
   * keeps its own slide alive, scrubs all its speed away, and laps at a fraction
   * of the pace a player manages — it looks less like a driver and more like a
   * dog chasing its tail. These three make them LIFT when the angle gets away
   * from them, which is what a real driver does and what makes the save read as
   * driving rather than luck.
   *
   * driftTarget: slide angle (rad) a rival is happy to carry on the throttle.
   *   About 17°, a usable rally drift, so they still look committed.
   * driftPanic: extra angle (rad) beyond the target at which they are fully off
   *   the throttle and just gathering it up.
   * driftMinThrottle: they never lift ALL the way, so a slide still gets driven
   *   out rather than dying in the middle of the road.
   */
  driftTarget: 0.28,
  driftPanic: 0.45,
  driftMinThrottle: 0.22,
  /**
   * Corner-speed margin. Sprint 26: rivals lean closer to the limit so a clean
   * AI lap beats a no-steer throttle hold.
   */
  cornerMargin: 0.98,
};

/** Co-driver look-ahead (Kenneth Ibrahim-style pace notes). Sprint 8: act-on timing. */
export const PACE = {
  /** Minimum metres to scan ahead at low speed. */
  look: 72,
  /** Cap so hairpins do not call corners half a lap early. */
  lookMax: 190,
  /** Seconds of warning at speed — game.js uses max(look, speed * leadSeconds). */
  leadSeconds: 2.85,
  /** Seconds between shouted calls. */
  speakGap: 2.0,
  /** Minimum metres before the same corner can be called again at speed. */
  recallMetres: 14,
  /** Metres of re-call gap added per m/s of road speed. */
  recallSpeedScale: 0.32,
  /** Delay before medium/easy calls fire (ms). Hard calls are instant. */
  speakDelayMs: 28,
  hardSpeakDelayMs: 0,
};

/**
 * Pack-battle feedback (no telemetry HUD). Place changes used to tick the
 * ordinal silently — gains now punch the banner + chirp so overtakes read as
 * racing moments. Drops only punch the place glyph (no nag banner).
 */
export const RACE_FEEDBACK = {
  /** Ignore grid launch shuffle before this many race seconds. */
  placeArmSec: 2.4,
  /** Minimum seconds between place pulses. */
  placeCooldownSec: 1.05,
  /** Flash centre banner on gains (e.g. "2ND!"). */
  flashGains: true,
  /** Soft chirp under a gain flash. */
  gainChirp: true,
};
