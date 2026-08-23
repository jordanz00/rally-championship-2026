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

- **Today:** shader tiers in `js/assets/damage.js` (0–3 from wall rubs)
- **Next:** author `assets/<car>/damaged.glb` and swap at tier ≥ 2 in `celica.js`

## Photogrammetry (external)

1. Capture → mesh cleanup in Blender  
2. Export hero + rival LOD via `build-car-lods.sh`  
3. Register in `js/cars/celica.js` `GARAGE`  
4. Re-run `dcc-pipeline.mjs`
