# DCC Asset Pipeline — Sprint 35

**Validate:** `node tools/dcc-pipeline.mjs`  
**Manifest:** `assets/dcc-manifest.json` (auto-generated)

## Car GLB workflow

```bash
bash tools/build-car-lods.sh
node tools/glbstats.mjs assets/*/*.glb
node tools/glbcheck.mjs assets/celica/gt4.glb
node tools/dcc-pipeline.mjs
```

## Damage variants (runtime)

- **Today:** directional dents + paint tiers in `js/assets/damage.js` (wall / rival hits). Sparks on hard contact. BODYWORK flash at tier 3. Optional `assets/<car>/damaged.glb` is catalogued by the pipeline; runtime uses procedural dents until that file exists.
- **HUD:** chase cluster BODY bar appears after the first scuff.

## Photogrammetry (external)

1. Capture → mesh cleanup in Blender  
2. Export hero + rival LOD via `build-car-lods.sh`  
3. Register in `js/cars/celica.js` `GARAGE`  
4. Re-run `dcc-pipeline.mjs`
