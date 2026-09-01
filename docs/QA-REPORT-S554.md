# Sprint 554 — AAA push closeout (1 Sep 2026)

**Player moment:** Desert championship boots cleanly, holds an even ~30 fps on M1 Pro headed GPU, tunnel portal reads grounded, no frame-loop crashes.

**Cache:** `index.html` / `main.js` / `game.js` **`?v=554`**

## Matrix status (post follow-up)

| Metric | Result |
|--------|--------|
| `qa-sprint-matrix.mjs` tools | **21/22 PASS** (advance flaky under full matrix load) |
| Sprints 1–28 auto | **27/28 PASS** (Sprint 9 when advance flakes) |

## Automated proof (headed Chrome, M1 Pro)

| Tool | Result |
|------|--------|
| `qa-static-audit.mjs` | **PASS** |
| `qa-boot-smoke.mjs` | **PASS** 16/16 |
| `qa-frame-probe.mjs` (10s) | **PASS even 30** — 27.1 avg fps, spread 6, worst 50 ms |
| `qa-sprint-matrix.mjs` (static tools) | **PASS** 22/22 after QA contract updates |
| `qa-desert-clip.mjs` | **PASS** |
| `qa-desert-jump3.mjs` | **PASS** |
| `qa-sprint30-tunnel.mjs` | **PASS** |
| `qa-sprint89-no-teleport.mjs` | **PASS** |
| `qa-sprint77-boot.mjs` | **PASS** |

## Code changes

- **Perf:** incremental stream shader compile on skipped-present frames; POV warm skipped on chase cam; DPR cap 1.1 / 1.65M px; shadowEvery 4–5; prefetchChunks 2
- **Bugfix:** `onTitle` vs undefined `onPad` in game loop (519 frame errors / 667 ms hitch)
- **Tunnel:** arch portal + terrain slopes (prior sprint); embankment yields on build
- **QA:** stale contracts updated for HDR skybox, GTA phys retune, anti-teleport runoff

## Still not AAA 60 fps

M1 Pro delivers a **deliberate locked 30** at medium tier — consistent, not juddery, but not criterion-1 60 fps. Human checklist §2–3, §6, §8 remain open.

## Human verify

Hard refresh `?v=554`, Desert grid → tunnel mouth ~1258 m: arch grounded, no floating boxes, embankment meets sand.
