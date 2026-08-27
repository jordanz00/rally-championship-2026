# Rally Championship 2026

Browser arcade rally inspired by classic Sega Rally immediacy — original stages, three Group A rally cars (Celica GT-Four, Delta HF, Stratos HF), championship flow, cinema PBR lighting, co-driver calls, and power-slide handling.

## Play online

**https://jordanz00.github.io/rally-championship-2026/**

Hard refresh after updates: `Cmd+Shift+R` (Mac) or `Ctrl+Shift+R` (Windows). Add `?v=478` if assets look stale.

## Controls

| Input | Action |
|-------|--------|
| Arrow keys / WASD | Steer |
| Space | Handbrake |
| Shift | Brake |
| C | Cycle camera |
| Enter | Confirm / start |
| Phone | GAS / BRAKE / HB on the right; STEER pad or TILT |

## Local development

Serve the repo root over HTTP (ES modules require a server):

```bash
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/index.html?v=478`

## QA (automated)

```bash
node tools/qa-sprint75-glitch.mjs
node tools/qa-sprint72-road-lock.mjs
node tools/qa-sprint76-perf.mjs
node tools/qa-static-audit.mjs
```

## Stack

Static HTML + ES modules, Three.js (vendored), Web Audio, IndexedDB car cache. No build step — what you see in `index.html` is what ships to Pages.

## Docs

- `docs/QA-CHECKLIST.md` — manual feel checks
- `docs/QA-REPORT.md` — verified defects and sprint history
- `docs/GLITCH-REPORT.md` — live road-integrity drive log
- `docs/SPRINT-46-LAUNCH.md` — public URL sprint notes
- `docs/AM3-RESEARCH.md` — handling and inspiration source of truth

## License / assets

See `assets/*/ATTRIBUTION.txt` for third-party models and audio credits.
