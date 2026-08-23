# QA checklist — manual pass

A hands-on test pass, organised by the eight acceptance criteria in
[`docs/AM3-RESEARCH.md`](AM3-RESEARCH.md) §7. Budget **8–12 minutes** for the
full pass, or run just the sections touched by your change.

This exists because the automated tools cannot judge *feel*. They can prove the
game boots, runs, and animates; they cannot tell you whether mud reads
differently from tarmac under your hands. Anything marked **feel** below is
work only a human can do.

## Before you start

Run the two automated checks first — do not spend human attention on something a
script already catches.

```bash
node tools/qa-static-audit.mjs      # instant, no install
node tools/qa-boot-smoke.mjs        # ~60s, real Chrome, walks criterion 4
node tools/qa-frame-probe.mjs       # ~40s, headed, real frame times
```

Then serve the game and open it. Use a **hard reload** (Cmd-Shift-R) for the
first load of the pass so a stale cached module cannot pollute your results:

```bash
python3 -m http.server 8765     # if it is not already running
```

Record results as **PASS / FAIL / N-A**, and note the browser and machine. Frame
rate and audio conclusions are machine-specific.

---

## Criterion 1 — Locked 60 fps, no hitching on Desert with a full pack

| # | Step | Expected result |
|---|------|-----------------|
| 1.1 | Start a Championship race on Desert. Read `FPS` in the HUD bottom-right. | Steady number. On a 60 Hz display it should read **60** and not wander. |
| 1.2 | Note the number on a **120 Hz / ProMotion** display. | **Known defect:** it reads ~120, not 60. The game has no frame limiter. See QA-REPORT V-2. |
| 1.3 | Drive the full Desert lap. Watch for stutter at the tunnel mouth, the jump pair, and the first corner where the pack bunches. | No visible hitch. A single hitch in the first two seconds of the race is shader/IBL warm-up and is acceptable; repeated hitches are not. |
| 1.4 | **feel** — Does the car respond immediately to steering input, or is there a lag between input and the car turning? | Immediate. Input lag is not a frame-rate number and will not show in the probe. |
| 1.5 | Compare the same corner at 60 Hz and 120 Hz if you have both displays. | **Known defect:** handling and the speed/rev needle sweep differ between refresh rates. See QA-REPORT V-2. |

## Criterion 2 — Braking distance and slide entry differ per surface, audibly and visibly

The Desert lap is built to make this testable: sand → gravel → dirt (tunnel) →
**mud** → sand. Mountain is tarmac and cobble.

| # | Step | Expected result |
|---|------|-----------------|
| 2.1 | On the Desert opening straight (sand), reach top speed, pick a landmark, brake full. Count the distance. | A definite reference stop you can compare against. |
| 2.2 | Repeat on the **mud** band after the tunnel from the same speed. | Noticeably longer, and the car starts to rotate rather than simply slow. |
| 2.3 | Repeat on Mountain **tarmac** from the same speed. | Shortest stop of the three, and arrow-straight — no rotation. |
| 2.4 | **feel** — Brake mid-corner on mud. | The brake should act as a *drift initiator*, not a stopping device. If braking on mud just slows you down, criterion 2 has failed regardless of what the numbers say. |
| 2.5 | **feel** — Brake mid-corner on tarmac. | The car should slow and hold its line. The contrast with 2.4 is the entire mechanic. |
| 2.6 | Listen across the sand → gravel → mud transitions with SFX up. | The tire bed changes audibly at each band, not just the on-screen `SURFACE` label. |
| 2.7 | Watch the dust/spray. | Dust on sand and gravel, visibly different or absent on tarmac. |
| 2.8 | Check the HUD `SURFACE` readout tracks the band you are on. | Label changes at the transition, not several car-lengths late. |

## Criterion 3 — Lift before a crest and brake in the air lands flat and gains time

This is the Fujimoto technique from the research brief and it needs a
stopwatch, not an opinion.

| # | Step | Expected result |
|---|------|-----------------|
| 3.1 | Practice mode, Desert. Take the **first jump** flat out, throttle pinned. Note attitude on landing and the time at the next checkpoint. | Nose-high launch, long flight, unsettled landing. This is the slow way. |
| 3.2 | Same jump: **lift just before the crest**, then **brake in the air**. | Nose drops, car lands flat, and it should be measurably quicker to the same reference point. |
| 3.3 | **feel** — compare 3.1 and 3.2 back to back three times. | The lifted line should feel *deliberate and rewarded*. If flat-out is equal or faster, criterion 3 has failed. |
| 3.4 | Take the **jump pair** (34 m apart) flat out. | The second crest should arrive while the car is still unsettled from the first — "teetering on the edge of control", per the brief. |
| 3.5 | Take the jump pair with a lift into each. | Controllable. There should be a technique that tames it. |
| 3.6 | Land badly on purpose (nose-high, off-centre). | The car is upset but **not** destroyed or reset. Criterion 6 applies here too. |

## Criterion 4 — Title → PRESS START → SELECT MODE → car → Desert countdown, no refresh ritual

Automated: `node tools/qa-boot-smoke.mjs` covers 4.1–4.6 and fails loudly.
Do these by hand anyway on any change to `index.html`, `css/game.css`, or boot code.

| # | Step | Expected result |
|---|------|-----------------|
| 4.1 | Hard-reload the page. | Title screen paints promptly. `RALLY CHAMPIONSHIP` and `PRESS START` both visible. |
| 4.2 | Click **PRESS START** once, immediately, without waiting. | Advances to `SELECT MODE` on the first click. If the first click is swallowed, that is the historical bug — report it. |
| 4.3 | Reload, and this time press **Enter**. Then reload and press **Space**. | Each advances to `SELECT MODE`. |
| 4.4 | Reload and click a blank part of the splash background. | Advances. Clicking the *Garage* details block or a credit link must **not** advance. |
| 4.5 | Choose `CHAMPIONSHIP`, then `CELICA GT-FOUR`. | Goes straight to Desert with a 3-2-1 countdown. No course-select step in championship — that is by design. |
| 4.6 | Confirm you never had to refresh, and no red error panel appeared at the bottom of the screen. | Clean run. If the `boot-error` panel appears, copy its text into your report — it names the file at fault. |
| 4.7 | Repeat the whole path in a fresh **private/incognito** window. | Identical. This is the empty-localStorage case that once shipped silently muted. |
| 4.8 | Confirm you can hear engine and music once racing. | Audible. Silence here with volume sliders at 100 is a defect. |

## Criterion 5 — One lap per course, checkpoint time extensions, position rolls over

| # | Step | Expected result |
|---|------|-----------------|
| 5.1 | Race Desert. Cross the finish line. | Race ends after **one** lap. No lap 2. |
| 5.2 | Cross Desert's single checkpoint. | `CHECK POINT +0'20"00` flashes and the `TIME` readout jumps up by that amount. |
| 5.3 | Count checkpoints per stage: Desert, Forest, Mountain. | 1, 2, 3 respectively — six across the championship, split unevenly. |
| 5.4 | Finish Desert somewhere mid-pack, note your position, continue to Forest. | You start Forest in the position you finished Desert. |
| 5.5 | Win Desert outright (finish 1st). | **Known defect:** the result is forced to 2nd. See QA-REPORT V-4. |
| 5.6 | Let the clock run out. | `GAME OVER, YEAH!` and the run ends. This is the intended arcade fail state and does not violate criterion 6. |
| 5.7 | Finish Mountain in 1st. | `LAKESIDE UNLOCKED`, and Lakeside appears in the course list. |

## Criterion 6 — Walls and rivals glance; nothing hard-fails a championship run

| # | Step | Expected result |
|---|------|-----------------|
| 6.1 | Drive deliberately into the Desert embankment at speed. | The car glances off and continues. It must not stop dead, embed, or reset. |
| 6.2 | Drive into a tree / rock / building in Forest. | Glances. Speed is lost; the run is not. |
| 6.3 | Ram a rival from behind, then from the side. | Both cars are shoved. Neither is destroyed and you are not eliminated. |
| 6.4 | Drive fully off-course into open ground and keep going. | Slower, no penalty message, no forced respawn, no elimination. |
| 6.5 | Roll or land very badly. | The car recovers. Nothing terminates the championship except the clock. |
| 6.6 | On Mountain, hit the barriers on a hairpin exit at speed. | Glancing contact. Barriers are walls, not run-enders. |
| 6.7 | **feel** — does contact feel like *rally contact* (a costly scuff) or like hitting a bumper in a pinball machine? | Costly but recoverable. Over-bouncy contact is a defect even though nothing hard-failed. |

## Criterion 7 — Desert teaches with two wide turns before it tests with a long drift right

| # | Step | Expected result |
|---|------|-----------------|
| 7.1 | Start Desert. Take the opening straight to top gear. | Long enough to actually reach top gear. |
| 7.2 | Take the first two turns flat out without lifting. | Both are makeable at full throttle with room to spare. Wide, shallow, forgiving. |
| 7.3 | **feel** — as a first-time player, do those two turns teach you that steering at speed is aimed rather than snapped? | Yes. If they punish you, the teaching order has broken. |
| 7.4 | Reach the **long easy right** in open ground late in the lap (145 m radius held for 78°). | You cannot steer around it on grip alone. It requires a committed slide. |
| 7.5 | Use the outside embankment as an anchor through that corner. | It supports the car rather than scrubbing all your speed off. |
| 7.6 | Confirm the difficulty order: two easy turns → jump → snaky gravel → jump pair → tunnel → mud → long right. | Ramps up. No difficulty spike before the teaching turns. |

## Criterion 8 — Co-driver calls arrive early enough to act on, in severity + direction form

| # | Step | Expected result |
|---|------|-----------------|
| 8.1 | Race Desert with SFX audible. Listen to the calls. | Short: severity + direction. "Easy right", "Medium left", "Hard right", "Jump". No GPS-style sentences. |
| 8.2 | **feel** — for each call, could you still act on it when it arrived? | Yes, with time to set the car up. A call that lands as you enter the corner is useless and is a defect. |
| 8.3 | Check the call matches the corner. | "Right" means the corner goes right. A systematically inverted call is a sign-convention bug in `courses.js` / `Track.noteAt`. |
| 8.4 | Check severity matches. | Hairpins called hard, the 145 m sweeper called easy. |
| 8.5 | Listen for repeats on a single corner. | Each corner is called once. No stuttering or re-calling. |
| 8.6 | Listen at the jumps and the tunnel entrance. | "Jump" ahead of the crest, "Into the tunnel" before you are in it. |
| 8.7 | Drop SFX to 0 in the pause menu, then back to 100. | Calls mute and return. Voice follows the SFX slider. |
| 8.8 | **feel** — does the voice read as an American co-driver shouting, or as a satnav? | Shouted and urgent. This is a presentation criterion from the research brief. |

---

## Cross-cutting checks

Not tied to a single criterion, but each of these has broken before.

| # | Step | Expected result |
|---|------|-----------------|
| X.1 | Press `P` mid-race. Move both volume sliders. Resume. | Pause works, sliders take effect immediately, resume returns you to the race. |
| X.2 | Press `C` repeatedly during a race. | Cycles POV / medium / far. The cockpit view shows a dash and a working mirror; chase views show the analog dials. |
| X.3 | Press `T` mid-race. | Toggles AT / MT, and the HUD label follows. |
| X.4 | Press `R` mid-race. | Resets the car onto the track slightly behind where you were. |
| X.5 | Resize the browser window during a race. | Canvas and gauges re-layout without distortion or blank frames. |
| X.6 | Open DevTools console for a full lap. | No errors. `qa-boot-smoke.mjs` enforces this automatically. |
| X.7 | Check the Garage panel on the title screen. | Reports which car models loaded. Dropping a `.glb` replaces the car without a reload. |
| X.8 | Run the whole championship end to end. | Desert → Forest → Mountain, position carried forward, no dead ends at any results screen. |

## Sprint 2 — Human driving feel (do not retune from code inspection)

These tests exist because physics numbers can look unusual and still feel right. Drive them. Only change handling values if a test **fails as a player experience**.

Unlock Lakeside with `localStorage.setItem('rally-lakeside','1')` if you have not won Mountain 1st. Use Practice for isolated surface tests.

| # | Step | Expected result |
|---|------|-----------------|
| S2.A | Practice, Mountain tarmac. Steering, braking, acceleration, high-speed stability. | Immediate steer, short stops, no tank-slapper. |
| S2.B | Practice, Desert gravel corridor. Reduced grip, sliding, braking distance, throttle. | Longer stops than tarmac; throttle rotates the car; recovery is possible. |
| S2.C | Practice, Desert mud after the tunnel. Traction, braking, acceleration, slides. | Brake initiates rotation. Throttle is a tool, not a panic button. |
| S2.D | Practice, Desert first jump. Takeoff, air, landing, camera. | Nose follows lift/brake technique. Landing compresses; camera kick is noticeable but not nauseating. |
| S2.E | Practice, Desert long easy right. Drift initiation, control, recovery, countersteer. | Opposite lock catches. The car does not snap or float. |

## Sprint 2 — Environment / HUD / audio

| # | Step | Expected result |
|---|------|-----------------|
| S2.F | Practice Mountain. First hairpin. | A large rock face sits on the inside, planted on the slope, visible from the racing line. Not a floating box. |
| S2.G | Practice Lakeside (unlock first). | Water reads as a lake with a bank, not scattered discs. |
| S2.H | Screenshot Desert vs Mountain vs Lakeside. | Biomes distinguishable without the HUD course name. |
| S2.I | Glance a barrier; rub an AI car; land a jump on tarmac vs sand. | Distinct impact sounds, louder on harder hits. |
| S2.J | Race HUD without `?debug=1`. | No FPS counter. Gauges do not dominate the view. |

## Reporting

For each FAIL record: the criterion, the step number, what you saw, the browser
and machine, and whether it reproduced. File it in
[`docs/QA-REPORT.md`](QA-REPORT.md) under the severity that matches, and keep
the distinction that report uses — **verified by running something** versus
**identified by reading code**.
