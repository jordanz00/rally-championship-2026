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
   * Race sun ortho half-width (metres). Tight chase frustum — denser contact
   * under the car and fewer mid-ground casters in the atlas (fill-rate win).
   */
  shadowExtentRace: 28,
  shadowNear: 2,
  shadowFar: 160,
  /**
   * Soft PCF hides a skipped bake. Every third present on the race default;
   * min tier stretches further / can disable the atlas entirely.
   */
  shadowEvery: 3,
  reflectEvery: 0,
  cubeSize: 64,
  /**
   * Rearview RT — low-res fixed size (readable cabin glass, ~1/4 of a
   * 1600-wide framebuffer). Full-res was a hitch; postage-stamp is unreadable.
   * FOV is vertical; ~26° at 384×120 ≈ 70° horizontal — a real cabin mirror,
   * not a 130° security cam. Far covers the road/trees/rivals behind you.
   */
  mirrorW: 256,
  mirrorH: 80,
  /** Chase / non-POV mirror cadence (presented frames). POV uses mirrorEveryPov. */
  mirrorEvery: 2,
  /** POV rearview — every other present keeps glass live without a full hitch. */
  mirrorEveryPov: 2,
  /** Vertical FOV for the rearview camera (Three.js PerspectiveCamera). */
  mirrorFov: 26,
  /** Draw distance for the rearview pass (metres). */
  mirrorFar: 110,
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
   * Prefer locking to an even 30 only after EMA evidence (perf-tier).
   * Forcing lock-30 at settle made capable machines feel laggy from GO.
   */
  preferLock30: false,
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
  bloomStrength: 0.18,
  bloomThreshold: 0.72,
  vignette: 0.16,
  gradeContrast: 1.14,
  gradeSaturation: 1.04,
  gradeWarmth: 0.08,
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
  aerialStrength: 0.64,
  aerialStart: 28,
  aerialEnd: 580,
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
  highlightRolloff: 0.22,
  pbrSkySigma: 0,
  /** Screen-space crevice AO — high tier only (postfx gates balanced). */
  aoStrength: 0.64,
  aoRadius: 1.48,
  /** Normal strength on road/terrain. */
  normalStrength: 1.55,
  /** Half-res normals — capped below full-res fill-rate cliff (Sprint 96). */
  normalMapScale: 0.92,
  /**
   * Albedo ×2.4 + procedural roughness — denser than 2.0, cheaper than 2.65.
   */
  textureScale: 2.4,
  roughnessMaps: true,
  /** Cone/cylinder segments for procedural foliage + trunk cards. */
  propSegments: 18,
  /** Icosahedron subdivisions for rocks, tumbleweed, shrub blobs. */
  rockDetail: 4,
};

/**
 * GTA-style world streaming — only draw geometry within a radius of the player.
 * Load/unload align with fog so slices appear while still haze-hidden, not at
 * the visible edge. Hysteresis stops boundary flicker.
 */
export const STREAM = {
  /** Load at fog.far × this — geometry must exist before it clears the haze. */
  loadFogFactor: 1.05,
  /** Unload beyond fog so slices stay warm until fully fogged out. */
  unloadFogFactor: 1.14,
  /** Fallback radii when the scene has no fog (metres). */
  loadRadius: 820,
  unloadRadius: 920,
  /** Heightmap tile edge length (metres). */
  terrainTileSize: 256,
  /** Base heightmap density — cinema tier uses terrainTileSegsCinema. */
  terrainTileSegs: 22,
  /** High perf / cinema only — smoother ridges without forcing on every machine. */
  terrainTileSegsCinema: 26,
  backdropSectors: 16,
  /** Spline chunks kept loaded ahead/behind the car (220 m each). */
  prefetchChunks: 2,
  /** Driving seconds to pre-warm streaming along the racing line. */
  lookaheadSeconds: 2.2,
  /** Extra load margin for large bounds (terrain tiles, backdrop rings). */
  boundsPadding: 70,
  /** Minimum gap between load and unload when using fixed radii (metres). */
  hysteresis: 70,
  /** Floor load radius when fog is tight (tunnels, title) — avoids sudden pops. */
  minLoadRadius: 260,
  /** Countdown / GPU-settle radius — start grid fully drawn, not whole stage. */
  countdownLoadRadius: 700,
  /**
   * Tree / prop mesh LOD (metres to chunk sphere). Inside lodNear the player
   * sees authored GLB canopies; beyond it, crossed-plane cards. Hysteresis
   * stops the swap strobing on a 220 m slice boundary.
   */
  lodNear: 110,
  lodHysteresis: 24,
  /** Far rivals drop castShadow beyond this (metres) — pack fill-rate win. */
  rivalShadowFar: 70,
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
  asphalt: 0x4a4a52,
  gravel: 0x8a7a62,
  dirt: 0x6b4e32,
  cobble: 0x7a7368,
  grass: 0x3d6b32,
  sand: 0xc4a56a,
  mud: 0x4a3a28,
  /** Packed driving ribbon — darker than landscape sand/grass so the line reads. */
  ribbonSand: 0x8a6238,
  ribbonGravel: 0x5c4a38,
  ribbonDirt: 0x4a3018,
  ribbonTarmac: 0x32363e,
  ribbonCobble: 0x4e4a44,
  ribbonMud: 0x2e2218,
  ribbonGrass: 0x2a481c,
  kerbCream: 0xf2ead0,
  kerbRed: 0xd4121a,
  dunePale: 0xd8c090,
  // Matches LIGHTING.desert.fog — the backdrop tint and the scene fog must be
  // the same colour or the far dunes sit in front of a differently coloured haze.
  fogDesert: 0xd0bfa2,
  fogForest: 0xb8d0e8,
  fogMountain: 0xb0cce8,
  fogLakeside: 0xa8c8dc,
};

/**
 * Per-stage outdoor rig: physically based sky (Rayleigh/Mie), key sun, sky fill.
 * Sky colors stay atmospheric blue — they do not copy sand/grass/rock.
 * sunDir is a unit-ish vector (x, y, z) toward the light.
 */
export const LIGHTING = {
  desert: {
    /**
     * Photographic Safari sky — deep zenith, warm aureole, fluffy cumulus islands.
     */
    skyGradient: [
      [0.0, "#5a7488"],
      [0.3, "#8cb4d8"],
      [0.46, "#c4def4"],
      [0.56, "#4aa0e8"],
      [0.74, "#1e78d0"],
      [1.0, "#063888"],
    ],
    skyZenith: 0x063888,
    skyHorizon: 0xc4def4,
    skyTurbidity: 1.85,
    skyRayleigh: 1.42,
    skyMie: 0.0048,
    skyMieG: 0.82,
    skyExposure: 1.16,
    skyAtmoBlend: 0.94,
    sunSkyBoost: 1.18,
    sunBloom: 1.28,
    lensFlare: 1.12,
    zenithBoost: 0.52,
    groundBounceMix: 0.14,
    cloudCover: 0.32,
    cloudScale: 1.72,
    horizonGlow: 0xf0dcc0,
    horizonStrength: 0.26,
    dustStrength: 0.18,
    wind: [1.85, 0, 0.65],
    fog: 0xd4c4a8,
    fogNear: 165,
    fogFar: 1180,
    hemiSky: 0x8cb4e4,
    hemiGround: 0xc8a068,
    hemi: 0.68,
    sun: 0xfff4e0,
    sunKelvin: 5600,
    sunInt: 3.35,
    sunDir: [0.54, 0.72, 0.36],
    rimSky: 0xb0d4f4,
    rimInt: 0.52,
    fill: 0x98bce0,
    fillInt: 0.28,
    ambient: 0xa8bcd0,
    ambientInt: 0.12,
    exposure: 1.14,
    gradeWarmth: 0.15,
    skyBack: 0x2488d0,
    worldEnv: 1.38,
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
    horizonStrength: 0.18,
    dustStrength: 0.04,
    wind: [0.35, 0, -0.85],
    fog: 0xa0b8cc,
    fogNear: 100,
    fogFar: 980,
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
    horizonStrength: 0.16,
    dustStrength: 0.03,
    wind: [2.4, 0, 1.1],
    fog: 0x98b4d0,
    fogNear: 140,
    fogFar: 1180,
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
    exposure: 1.1,
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
    horizonStrength: 0.22,
    dustStrength: 0.1,
    wind: [-0.8, 0, 1.4],
    fog: 0x90b4c4,
    fogNear: 90,
    fogFar: 880,
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
    envIntensity: 2.1,
    bodyEnv: 1.98,
    chromeEnv: 2.72,
    glassEnv: 1.58,
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
  /** Exposure multiplier at full shade. */
  exposureBoost: 1.22,
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
    muPeak: 1.58,
    /**
     * AM3: brake on tarmac and you STOP. Peak/slide gap still allows a tidy
     * attitude, but brakeHold keeps the stop short and mostly straight.
     */
    muSlide: 1.08,
    slipPeak: 0.072,
    /** Threshold braking holds: shortest stop on the championship, arrow-straight. */
    brakeHold: 1.0,
    brakeYaw: 0.06,
    slideHold: 0.78,
    gripSnap: 1.72,
    bumpSteer: 0.35,
    roll: 0.014,
    sink: 0,
    bump: 0.014,
    dust: 0,
    speedScale: 1.0,
    driftEase: 0.82,
    pacejkaB: 4.4,
    pacejkaC: 1.36,
    pacejkaE: 0.06,
    color: COLORS.asphalt,
    ribbon: COLORS.ribbonTarmac,
  },
  gravel: {
    id: "gravel",
    label: "GRAVEL",
    muPeak: 1.14,
    muSlide: 0.68,
    slipPeak: 0.135,
    /** Half-locking: brakes bite, then let go — the classic gravel pitch-in. */
    brakeHold: 0.38,
    brakeYaw: 0.82,
    slideHold: 1.55,
    gripSnap: 1.28,
    bumpSteer: 0.82,
    roll: 0.026,
    sink: 0.014,
    bump: 0.048,
    dust: 0.85,
    speedScale: 0.94,
    driftEase: 1.55,
    pacejkaB: 3.5,
    pacejkaC: 1.26,
    pacejkaE: 0.13,
    color: COLORS.gravel,
    ribbon: COLORS.ribbonGravel,
  },
  dirt: {
    id: "dirt",
    label: "DIRT",
    muPeak: 1.06,
    muSlide: 0.74,
    slipPeak: 0.118,
    brakeHold: 0.34,
    brakeYaw: 0.78,
    slideHold: 1.48,
    gripSnap: 1.24,
    bumpSteer: 0.9,
    roll: 0.03,
    sink: 0.022,
    bump: 0.052,
    dust: 1.0,
    speedScale: 0.9,
    driftEase: 1.48,
    pacejkaB: 3.3,
    pacejkaC: 1.24,
    pacejkaE: 0.15,
    color: COLORS.dirt,
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
    muPeak: 0.94,
    muSlide: 0.6,
    slipPeak: 0.145,
    brakeHold: 0.3,
    brakeYaw: 0.9,
    slideHold: 1.82,
    gripSnap: 1.18,
    bumpSteer: 0.75,
    roll: 0.04,
    sink: 0.038,
    bump: 0.02,
    dust: 1.15,
    speedScale: 0.9,
    driftEase: 1.65,
    pacejkaB: 3.1,
    pacejkaC: 1.22,
    pacejkaE: 0.17,
    ribbon: COLORS.ribbonSand,
  },
  mud: {
    id: "mud",
    label: "MUD",
    muPeak: 0.8,
    muSlide: 0.52,
    slipPeak: 0.155,
    /** AM3 headline: brake on mud and you begin a power slide. */
    brakeHold: 0.12,
    brakeYaw: 1.0,
    slideHold: 1.95,
    gripSnap: 1.08,
    bumpSteer: 0.9,
    roll: 0.06,
    sink: 0.055,
    bump: 0.03,
    dust: 0.7,
    speedScale: 0.74,
    driftEase: 1.72,
    pacejkaB: 2.8,
    pacejkaC: 1.2,
    pacejkaE: 0.2,
    color: COLORS.mud,
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
  throttleSlide: 1.85,
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
  handbrakeEnter: 0.022,
  handbrakeBleedMul: 0.018,
  handbrakeYawKick: 4.35,
  handbrakePowerMul: 2.85,
  /** Power-slide sustain without e-brake (throttle + steer sideways). */
  driftBleedMul: 0.026,
  /** Lateral grip scale at full slide angle (lower = slipperier / bigger attitude). */
  slideGripMul: 0.17,
  /**
   * Extra rear µ dump while e-brake is held (0 = none, 1 = almost no rear grip).
   * This is the mechanical "lock the rears" feel of a rally handbrake turn.
   */
  handbrakeRearMu: 0.06,
  /**
   * Throttle + steer pitch-in on loose ground (no e-brake). Higher = easier
   * to light the rear with power alone — classic arcade power slide.
   */
  powerSlidePitch: 2.15,
  /**
   * Trail-brake rotation. Brake + steer on loose surfaces transfers weight
   * forward and rotates the nose — AM3 "brake into the corner" technique.
   */
  trailBrakeYaw: 0.82,
  /**
   * Bonus countersteer authority when catching a slide at the limit.
   * Scales yawFollow when opposite lock is active — catch = switch.
   */
  expertCounterMul: 1.55,
  /**
   * Readable weight transfer. Brake unloads the rear → oversteer;
   * throttle unloads the front → mild push. Keep below GTA IV so novices
   * are not "drunk car" heavy.
   */
  weightTransferMul: 1.95,
  /** Bicycle understeer gradient — lower = tighter at speed (AM3 easy control). */
  speedUndersteer: 0.00165,
  /** Lift-off oversteer mid-corner — close throttle, the tail comes. */
  liftOffYaw: 0.88,
  /** Extra yaw past the grip cap that still arrives (mushy breakaway, not a rail). */
  limitMush: 0.58,
  /** Visible chassis lean from lateral g — a hint of weight, not a cabinet tip. */
  bodyRollMul: 1.55,
  bodyRollMax: 0.105,
  /**
   * Visual drive squat / dive — always 0. Non-zero values tilted the car
   * nose-up on throttle. Landing squash uses JUMP settle, not these.
   */
  brakeDive: 0,
  accelSquat: 0,
  /**
   * Tire-moment yaw blend. Lower = snappier arcade bicycle (AM3); higher =
   * delayed mass (GTA IV). Prefer AM3 for championship fun.
   */
  tireYawBlend: 0.36,
  /**
   * Sakamoto gear-drift: downshift while turning unloads the rear.
   * Manual and auto both use this kick so the default auto box still drifts.
   */
  gearDriftKick: 0.52,
  gearDriftKickMax: 1.12,
  gearDriftYaw: 0.72,
  /**
   * Brake+steer rotation scale (multiplies surface.brakeYaw). AM3: brake on
   * mud begins a power slide; tarmac still mostly stops straight.
   */
  brakeSteerYaw: 1.35,
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
  driveInertia: 1.02,
  /**
   * Sprint 28 — dead-stop launch. Multiplies drive torque at 0 km/h and fades
   * linearly to 1.0 by launchFadeKmh so corners keep the same mid-speed balance.
   */
  launchBoost: 1.42,
  launchFadeKmh: 78,
  /**
   * Chassis stability — follow the axle-plane deck, filter only ribbon noise.
   * Player and AI share the planted hull; rivals still use cheap road probes.
   */
  /** Residual HF bobble on top of query micro-terrain (main unevenness is in Track.query). */
  roadChatterScale: 0.12,
  /** Lateral road camber from left/right wheel height (radians scale). */
  roadRollGain: 0.92,
  /** Max wheel hub travel into/out of the well (metres). */
  wheelTravelMax: 0.088,
  deckFollowRate: 62,
  /** Direct deck plant rate (1/s) — replaces spring bobble for the player. */
  groundPlantRate: 54,
  groundSpringHz: 28,
  groundSpringZeta: 1.22,
  /** Landing-squash follow rate (1/s). Accel/brake do not pitch the mesh. */
  squatSmoothRate: 14,
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
  techniqueWindow: 0.38,
  /**
   * Fraction of launch velocity kept by a perfectly executed lift.
   * Good technique lands flatter/lower; flat-out throws higher and arrives wrong.
   */
  liftLaunchCut: 0.64,
  /** Flat-out launch bonus (multiplies raw before technique cut). */
  flatOutLaunchBoost: 1.08,
  /** Nose-down attitude (rad) a full lift-and-brake buys you at the lip. */
  liftNoseDrop: 0.18,
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
  airPitchUp: 0.22,
  airPitchDown: 0.28,
  airPitchRate: 3.2,
  airPitchMax: 0.42,
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
  mismatchFull: 0.28,
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
   */
  flatScrub: 0.997,
  worstScrub: 0.7,
  /** Yaw kick (rad/s) a fully botched landing throws at you. */
  landUpsetYaw: 0.68,
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
  balanceGripLoss: 0.2,
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
  landVelAbsorb: 0.86,
  /**
   * After touchdown: suspension squash + one short rebound, then snap level.
   * Long settle windows read as floaty / late recovery.
   */
  landSettleMin: 0.14,
  landSettleMax: 0.38,
  /** Extra Three.js pitch (rad) allowed while settle is live. */
  landSettlePitchMax: 0.14,
  /** Extra roll (rad) carried through the settle rock. */
  landSettleRollMax: 0.12,
  /** Nose-down squash (rad) per m/s of impact (seed; spring owns the curve). */
  landImpactSquash: 0.02,
  /** Attitude offset decay (1/s) — higher = levels out faster after touchdown. */
  landSettleDamp: 5.4,
  /** Extra damp as settle nears end (snaps the last of the rock). */
  landSettleDampEnd: 11.5,
  /** Legacy squash exponential — prefer landCompress spring when present. */
  landSquashDamp: 4.8,
  /** Visual suspension sink (m) per m/s of impact. */
  landCompressGain: 0.09,
  landCompressMax: 0.11,
  /** Near-critical land spring — weight on kiss, one quick rebound, plant. */
  landCompressWn: 20.5,
  landCompressZeta: 0.86,
  /** Rebound extension past rest (m, negative x) for visible bounce. */
  landCompressExtMin: -0.014,
  /** Pitch blend rate (1/s) while land settle is live. */
  landPitchBlend: 18,
  /** Roll spring scale while settle is live (<1 = heavier rock). */
  landRollWnScale: 0.78,
  landRollZeta: 0.98,
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
  wheelRadius: 0.32,
  restLength: 0.34,
  travel: 0.16,
  spring: 36000,
  damper: 5200,
  damperBump: 5600,
  damperRebound: 4400,
  antiRollFront: 6200,
  antiRollRear: 4400,
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
  peakPowerKw: 272,
  redline: 7500,
  idleRpm: 950,
  /**
   * Index 0 is NEUTRAL (ratio 0), then four forward gears — the Saturn box.
   * Sprint 28: shorter 1–2 for hard launches; 4th (~0.95) still meets maxSpeed.
   */
  gears: [0, 3.55, 2.08, 1.4, 0.95],
  topGear: 4,
  finalDrive: 4.35,
  drivetrain: "4wd",
  torqueSplitFront: 0.5,
  engineBrake: 0.34,
  /** Sprint 28: less aero wall so top-end keeps pulling after the launch. */
  aeroDrag: 0.33,
  downforce: 0.16,
  /** Soft ceiling (m/s × surface.speedScale). Celica cruises ~250 on tarmac. */
  maxSpeedKmh: 250,
  driftMul: 1.0,
};

export const CARS = {
  celica: {
    ...CHASSIS,
    id: "celica",
    name: "CELICA GT-FOUR",
    short: "CELICA",
    blurb: "4WD  ·  planted power-slide — learn the stage like AM3 Desert",
    driftMul: 1.05,
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
    yawInertia: 1780,
    maxSteer: 0.5,
    steerSpeed: 128,
    steerReturn: 100,
    yawGain: 1.35,
    tractionBiasFront: 0.5,
    /** A hair under Celica top — same punch, still catchable in hairpins. */
    maxSpeedKmh: 246,
    driftMul: 1.12,
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
    yawInertia: 1420,
    lengthM: 3.71,
    wheelbase: 2.18,
    drivetrain: "2wd",
    torqueSplitFront: 0,
    maxSteer: 0.54,
    steerSpeed: 138,
    steerReturn: 96,
    steerFalloff: 0.007,
    yawGain: 1.42,
    tractionBiasFront: 0.56,
    driveInertia: 0.92,
    /** Sprint 28: stays the fastest car (~265), still surface-limited. */
    maxSpeedKmh: 265,
    peakPowerKw: 288,
    driftMul: 1.16,
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
   */
  speedFov: 0.30,
  maxFovPunch: 18,
  /** World-up lean from chassis roll — a hint, not a horizon swing. */
  rollFollow: 0.22,
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
   * Seconds for a C-key pose ease. Short enough to feel instant, long enough
   * to read as a move instead of a cut. From-pose rides with the car.
   */
  viewBlendTime: 0.22,
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
      /** Default chase — 50% further back than 3.98 m so the rear bumper stays in frame. */
      back: 5.97,
      height: 1.80,
      lookAhead: 8.2,
      lookY: 0.5,
      fov: 62,
      /** Mild speed squat — keeps pavement in frame without burying the roof. */
      speedDropMax: 0.16,
      stiffness: 28,
      near: 0.22,
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
