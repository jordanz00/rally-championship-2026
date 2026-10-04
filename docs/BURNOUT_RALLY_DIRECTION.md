# Burnout-style rally — CEO → CTO binding direction

**Status:** Binding product identity as of 2026-10-04.  
**Authority:** CEO / Executive Producer through CTO / Lead Engineer.  
**Supersedes as fantasy:** “muted photoreal rally” and “Sega Rally clone as the brand.”  
**Does not supersede:** arcade rally handling (`docs/SEGA_RALLY_DRIVING_MODEL.md`), Forest-first environment gate, `Track.query()` contract, no `config.js` edits, no parallel `src/**/*.ts`.

Companions: [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md) · [`.cursor/rules/virtual-racing-game-studio.mdc`](../.cursor/rules/virtual-racing-game-studio.mdc) · [`QUALITY_TARGET.md`](QUALITY_TARGET.md) · [`STABILIZATION-BRIEF.md`](STABILIZATION-BRIEF.md)

---

## One sentence

A **Burnout-style rally**: Paradise juice on dirt — slides, jumps, near-misses, rush, and a hot arcade present — still a rally championship, not a city crash-out.

---

## Executive chain (how each seat uses this)

| Seat | Mandate |
|---|---|
| **CEO / EP** | Ship a 10-minute drive that feels like Burnout on a rally stage. Reject muted sim looks and invisible refactors. |
| **Game Director** | Speed, spectacle, readable dirt. Conflicts resolve toward *fun and rush*, not accuracy. |
| **Development Manager** | One coherent player-visible slice per sprint. Keep the build runnable. |
| **CTO / Lead Engineer** | Evolve `js/`. Do not rewrite `vehicle.js` / `Track.query()`. Rush, look, camera, audio, HUD are the juice layer. |
| **Gameplay** | Earn rush. Dump it on throttle. Near-miss is a reward. Walls tax the tank. |
| **Art / Lighting** | Hot teal-amber grade, candy paint, sun bloom. Lakeside stays pulled. |
| **Camera** | Speed and weight without shrinking the medium car (`speedFovScale: 0` stays). Kick on rush / land / GO. |
| **Audio / UI** | Cabin rush, NEAR MISS, RUSH bar. Arcade chrome, not a sim overlay. |
| **QA** | Proof is a Desert pack slide + a close pass, not a screenshot of sat. |

---

## What we are / are not

**Are**
- Rally stages (Desert, Forest, Mountain, Lakeside)
- Group A cars, championship pack
- Arcade dirt handling (Sega Rally *feel*, original cars/stages)
- Burnout *juice*: rush tank, near-miss, hot grade, speed CA, GO punch

**Are not**
- Burnout Paradise city / traffic / takedown license
- Hardcore sim
- A Sega Rally rip
- “More bloom” as the whole feature

---

## Systems that already own this

| Layer | File |
|---|---|
| Rush tank + On Fire | `js/gameplay/rally-rush.js` |
| Saturn + dump overlay | `js/physics/burnout-drive.js` (applied in `vehicle.js`) |
| Arcade grade | `js/gfx/burnout-look.js` + `js/gfx/postfx.js` |
| Present hook | `PhotoRealPost.setDriveFeel` in `js/game.js` |
| Boost wake | `BoostWake` + `ImpactSparks.wake` in `js/effects.js` |
| Cabin hiss | `RallyAudio.setRush` in `js/audio/engine.js` |
| HUD | `#hud-rush`, `NEAR MISS` / `RUSH` / `ON FIRE` in `js/ui/hud.js` |

Do not invent a second boost meter. Extend RallyRush.

---

## CTO constraints (non-negotiable)

1. Gameplay feel → visual juice → performance → maintainability → sim.
2. Never degrade fun for accuracy.
3. No `config.js` edits. No `Track.query()` rewrite. No vehicle rewrite unless the friend-test fails.
4. Cache-bust `?v=` on module-graph change.
5. Lakeside exposure / Forest shade floors / Forest `headBeam` 1295 stay.
6. Automated proof: `tools/qa-rally-rush.mjs` · `tools/qa-burnout-look.mjs`.

---

## Friend-test (CEO question #4)

Would you send a friend a 10-minute Desert run and say **“it’s Burnout, but rally”**?

If they say “nice Three.js rally,” the sprint failed.
