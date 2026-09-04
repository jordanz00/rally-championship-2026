# Gamer Wow Checklist

**Status:** Permanent development / playtest checklist.  
**Bar:** Experienced gamers must recognize this as a serious racing game — not a Three.js demo.  
**Evaluate while PLAYING at speed.** Screenshots alone do not pass.

**Companions:** [`VISUAL_GAMEPLAY_NORTH_STAR.md`](VISUAL_GAMEPLAY_NORTH_STAR.md) · [`CURSOR_GAME_DIRECTIVE.md`](../CURSOR_GAME_DIRECTIVE.md)

**How to use:** Mark PASS / FAIL / PARTIAL with date and hardware. Failures become the next sprint — not silent debt.

---

## FIRST 10 SECONDS

| # | Check | Status |
|---|---|---|
| 1 | Title / menu presentation looks polished | |
| 2 | Car looks expensive (materials, lighting, stance) | |
| 3 | Lighting looks intentional (not default gray) | |
| 4 | Environment has depth (haze / layers / not flat) | |

---

## FIRST CORNER

| # | Check | Status |
|---|---|---|
| 5 | Car feels responsive | |
| 6 | Weight transfer looks believable | |
| 7 | Suspension reacts to bumps / load | |
| 8 | Camera feels physical (not rigid offset) | |

---

## FIRST DRIFT

| # | Check | Status |
|---|---|---|
| 9 | Rear rotates progressively (not snap) | |
| 10 | Player feels the slide | |
| 11 | Dust / gravel respond to tire slip | |
| 12 | Camera communicates the slide (heading ≠ velocity) | |
| 13 | Car recovers naturally with countersteer | |

---

## FIRST JUMP

| # | Check | Status |
|---|---|---|
| 14 | Suspension unloads in air | |
| 15 | Wheels spin / attitude readable | |
| 16 | Player can influence pitch | |
| 17 | Braking affects airborne attitude | |
| 18 | Landing compresses suspension | |
| 19 | Dust / impact feedback on land | |

---

## FIRST HIGH-SPEED SECTION

| # | Check | Status |
|---|---|---|
| 20 | Game communicates speed (FOV / motion / dust — not fake shake spam) | |
| 21 | Environment streams smoothly | |
| 22 | Camera remains stable and readable | |
| 23 | Road looks detailed under the car | |
| 24 | Car remains visually readable | |

---

## FIRST SURFACE TRANSITION

| # | Check | Status |
|---|---|---|
| 25 | Grip changes | |
| 26 | Tire sound changes | |
| 27 | Particle behavior changes | |
| 28 | Road appearance changes | |
| 29 | Car behavior changes in a readable way | |

---

## AFTER 3 MINUTES

| # | Check | Status |
|---|---|---|
| 30 | Car looks dirtier than at start | |
| 31 | Tire tracks visible on dirt / gravel | |
| 32 | Environment remains visually varied (not copy-paste fatigue) | |
| 33 | Frame rate stays playable (note FPS / 1% lows) | |

---

## GAMER IMPRESSION TEST

Answer honestly after a short drive:

| Question | Y / N / Notes |
|---|---|
| Does this look like a real racing game? | |
| Does this feel like a real car? | |
| Does the environment feel handcrafted (hero moments)? | |
| Does the driving feel fun? | |
| Would you voluntarily play another race? | |
| Would you show a friend? | |

If any answer is **No**, that is the priority — not more distant trees.

---

## Perf snapshot (optional, headed)

| Metric | Value |
|---|---|
| Hardware / browser | |
| Quality tier | |
| Avg FPS | |
| 1% low | |
| Draw calls / tris (approx) | |
| Notes | |

Tools: `?debug=1` / `?perfmon=1` · `node tools/qa-frame-probe.mjs` (headed).
