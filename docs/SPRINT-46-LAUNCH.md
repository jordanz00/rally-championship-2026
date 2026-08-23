# Sprint 46 — Public shareable URL

**Goal:** Ship the current browser build at a stable public URL anyone can open.

**Live URL:** https://jordanz00.github.io/rally-championship-2026/

**Automated proof:**

```bash
node tools/qa-sprint46-launch.mjs
```

---

## What Sprint 46 delivered

| Deliverable | Status |
|-------------|--------|
| GitHub Pages workflow (`.github/workflows/pages.yml`) | Done |
| Public repo + push to `main` | Done |
| README with play link | Done |
| Deploy QA gate (`qa-sprint46-launch.mjs`) | Done |
| `.gitignore` excludes `.qa/` browsers (584 MB) | Done |
| Open Graph meta on `index.html` for link previews | Done |

---

## AAA scope honesty (Sprint 46 did not claim full AAA)

Sprints 1–40 closed the **browser-shippable** bar: championship flow, six GLB cars, cinema PBR, co-driver, ghosts/telemetry hooks, forest glade redesign, unified car scale, integrated-GPU perf tier.

**Still not AAA retail** (documented in `SPRINT-34-CHECKIN.md` CTO table):

- DCC damage variants in player path (pipeline exists; not every car wired)
- Full Wwise-style mix + recorded pace-note VO per corner
- Motion-captured cockpit + driver IK
- Full Pacejka + 120 Hz fixed-step on all hardware matrices
- Online multiplayer / cloud ghosts
- Full WRC-length season content

Closing those requires asset production and infra beyond a static Pages deploy — not a single sprint.

---

## Share instructions

Send the live URL. Recipients need a modern desktop browser (Chrome / Edge / Firefox / Safari). First load downloads ~170 MB of assets; allow 30–60 seconds on first visit. Audio starts after one click (browser autoplay policy).

**Cache bust after updates:** append `?v=323` or hard refresh.

---

## Maintainer deploy flow

1. Merge to `main`
2. GitHub Actions → **Deploy GitHub Pages** runs automatically
3. Wait ~2 minutes; verify live URL
4. Run `node tools/qa-sprint46-launch.mjs` locally before merge
