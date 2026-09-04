# System Authority Map — Rally Championship 2026

Identify the owner before coding. Do not create a second authority.

| Domain | Authority |
|--------|-----------|
| Boot | `index.html` → `js/main.js` → RallyGame |
| Race orchestration | `js/game.js` (high risk) |
| Config dials | `js/config.js` |
| Vehicle dynamics | `js/physics/vehicle.js` |
| Jump / land grade | `js/physics/jump.js` |
| Surfaces | `js/physics/surfaces.js` |
| World build | `js/tracks/track.js` (no wholesale rewrite) |
| Course list | `js/tracks/courses.js` |
| Stage data | `js/tracks/stages/*-definition.js` |
| World integrity | world-geometry-validator + TrackDefinition |
| Cars / POV / dirt | `js/cars/*` (esp. `celica.js`) |
| AI decisions | `js/ai.js` (shared Vehicle) |
| Audio mix | `js/audio/*` |
| Graphics / tiers | `js/gfx/*` |
| Camera springs | `js/camera/*` |
| Dust / marks | `js/effects.js` |
| HUD | `js/ui/*` |
| Trackside kits | `js/tracks/prop-kit.js` + `assets/props/` |
| Debug | `js/debug/*` · `?dev=1` / `?physlab=1` |

**Hot spots:** `game.js`, `track.js`, `vehicle.js`, `celica.js`, `config.js`
