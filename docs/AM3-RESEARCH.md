# AM3 research brief — Sega Rally Championship (1995)

Shared source of truth for the overhaul. Every agent reads this before editing.
Claims here are sourced. Do not add "facts" without a source line.

Primary sources
- PandaMonium, *Sega Rally Championship* (Reviews Every U.S. Saturn Game, ep. 33),
  https://www.youtube.com/watch?v=1CEdmZ5P0jA — 4h40m documentary, translated
  Japanese interviews and dev-build footage. Cited below as **[Doc]**.
- Wikipedia, *Sega Rally Championship* — **[Wiki]**
- Sega-16, *Behind the Design: Sega Rally Championship (Arcade)* — **[S16]**
- Contemporary press (Next Generation, EGM, Maximum, Sega Saturn Magazine) as
  quoted in the above.

---

## 1. Who made it, and what they were chasing

- Produced by Tetsuya Mizuguchi, directed by Kenji Sasaki (ex-Namco, *Ridge
  Racer*), chief programmer Sohei Yamamoto. Team was ~12 people, mostly in
  their twenties, mostly inexperienced with 3D. **[S16]**
- Rally was chosen specifically to *not* be Daytona or Ridge Racer. Mizuguchi
  found urban racers "cold and too precise"; rally gave dips, puddles, gravel,
  and surface-dependent handling. **[S16]**
- Started on Model 1, moved to Model 2 when Model 1 production stopped; art was
  redone. Model 2 delivered textured polygons (~300k polys/sec). **[Doc]**
- The team travelled: two weeks around American deserts and mountains shooting
  ~4,000 reference photos; rode as passengers with a real rally driver on
  gravel. Feel came from field research, not spreadsheets. **[Doc]**

**Directive:** the game's identity is *earth*, not *asphalt*. Warm dust, wide
skies, roadside life. Never let it read as a track-day racer.

## 2. The handling model (the reason it is remembered)

- First racing game where surface friction changes handling as a core
  mechanic — mud vs gravel vs tarmac. **[Wiki]**
- Deliberately exaggerated, not simulated: "We didn't want to make it totally
  realistic because if we did that, most players would find themselves going
  totally out of control around every corner." **[S16]**
- Brake on tarmac and you stop; brake on mud and you begin a power slide. The
  slide is the *tool*, not the failure state. **[Doc]**
- Bumps matter: two wheels on a bump plus steering away from it can end you.
  Gravity and inertia are strong; a car left alone on a hill rolls back down.
- No "perfect line" — the surface undulates enough that there is always another
  option to try.
- Saturn version got physics help from real Safari rally driver Yoshio
  Fujimoto, who advised specifically on **jump technique: lift off just before
  the crest, brake so the nose drops, land flat — flat-out jumping is
  dangerous.** **[Doc]**
- Championship mode has **no crash-out and no off-course penalty** — spectators
  line the track but you cannot be eliminated by them. **[S16]**
- Colin McRae Rally's producer credited this handling as his foundation. **[S16]**

**Directives**
1. Surface is the headline mechanic. Each surface needs a distinct brake
   distance, a distinct slide entry, and an audible + visual signature.
2. Exaggerate for fun, keep the causal chain honest.
3. Jump reward must match Fujimoto: lift before the crest and brake in the air
   to land flat and fast. Flat-out over a crest should cost time.
4. Never hard-fail the player in championship. Walls glance, they do not end runs.

## 3. Structure

- Four courses: **Desert, Forest, Mountain, Lakeside** (Lakeside is a bonus,
  unlocked by finishing Mountain in 1st). **[Doc]**
- Three cars: Celica GT-Four, Lancia Delta, hidden Lancia Stratos (unlocked by
  1st place; very fast, hard to control). **[Wiki][Doc]**
- Two transmissions: manual (neutral + 4 gears) and automatic. **[Doc]**
- **One lap per course.** 14 computer opponents. You race the clock *and* the
  pack; time is extended at checkpoints. Six checkpoints split unevenly across
  the first three courses. **[Doc]**
- Finishing position **rolls over** into the next course — 10th on course one
  means you start 10th on course two. **[Doc]**
- Saturn extras: car setup (steering response, tire grip, front/rear
  suspension, blow-off valve sound), saveable setups, split-screen 2P,
  time attack, replays, staff ghosts. **[Doc]**

## 4. Course design intent

- **Desert** — inspired by the Safari rally: wide, generous, long easy turns,
  dry dirt transitioning to darker wet mud, a few jumps, zebras and elephants
  in the gallery. First two turns are deliberately shallow and wide to teach
  3D steering. Ends in a long easy right in open ground — the first real
  drifting test, with an embankment you can use as an anchor. **[Doc]**
- **Forest** — tight, snaky, tree corridors and puddles; close walls sell speed;
  a flat-out chicane; then an opening into wide space for contrast. **[Doc]**
- **Mountain** — Corsica reference photos (textures shot in the American West),
  tarmac, hairpins, the big rock face across from the hairpin. **[Doc]**
- **Lakeside** — bonus, described as northern Europe, autumn colour. **[Doc]**
- Jumps come in sequences that leave the car progressively more off-balance,
  "teetering on the edge of control." **[Doc]**
- Draw distance was managed by **course design**: whole slices of track stream
  in behind corners and trackside detail so pop-in stays hidden. **[Doc]**

## 5. Saturn technical reality (what "Saturn style" actually means)

- Arcade Model 2 ran ~60 fps; the Saturn port ran a **locked 30 fps**, and
  hitting that required near-total re-implementation of the game, not just
  asset swaps. **[Doc]**
- Built **without** the Sega Graphics Library — SGL was not finished, so the
  team wrote their own engine. **[Doc]**
- Model 2 used monochrome textures; **Saturn used full-colour textures** but
  could not hold as many polygons in memory. So: fewer, larger, richly textured
  polygons. **[Doc]**
- Cars are *low* poly with painted detail: curves were faked with textures on
  flat polygons, and wheels are literally octagons with shadow shading to read
  as round. **[Doc]**
- Cars and track render on VDP1; **the sky is VDP2 and updates at 60 fps** while
  the world runs at 30. **[Doc]**
- Crowd density was tuned empirically — arcade Desert had ~400 spectators; the
  Saturn team added spectators incrementally to find the frame budget. **[Doc]**
- Split screen cut trees, spectators, wildlife and shortened draw distance to
  hold frame rate. **[Doc]**

**Directives for our "modern Saturn"**
1. **Silhouette and colour over shader complexity.** Flat, warm, high-contrast
   texture work. Fewer polygons, more painted detail.
2. Keep the *look* (chunky geometry, bold texture, clean sky) but run the
   *engine* at a locked 60 fps in browser. 30 fps was a Saturn constraint, not
   an aesthetic.
3. Budget by construction, not by hope: cull and stream by course layout the
   way AM3 did. Corner geometry should hide the horizon.
4. Sky is cheap and can update every frame; world detail is what you cut.

## 6. Audio and presentation

- Music by Takenobu Mitsuyoshi, Model 2 MIDI, a distinct track per course, funk
  and jazz-fusion flavoured; the famous "GAME OVER, YEAH!" sting. **[Doc]**
- Engine sounds and effects were recorded from real cars. Mizuguchi's own car
  was used for the Delta engine. **[Wiki]**
- Sound design intent: gravel thrown by the front tires should hit the door on
  the side you are travelling toward — not arrive from the front. Tunnels get
  real reverberation. **[Doc]**
- Co-driver voiced by Kenneth Ibrahim, an American, not a voice actor. Calls are
  short severity + direction: "easy right", "medium right", "long easy right
  maybe" — "maybe" signals the player must judge the corner themselves. **[Doc]**
- Cabinet transmitted vibration; the Saturn team pursued a three-dimensional
  sound effect to compensate at home. **[Doc]**

**Licensing guardrail:** we ship no Sega audio. Title music is Zane Little /
Midnight Cruiser (CC0); race and result beds are Van Loon jazz fusion (CC BY
4.0) plus Zane Little’s Wednesday Night (CC0). Engine beds are CC0 / CC BY per
`assets/*/ATTRIBUTION.txt`. Emulate the *role* of the music and calls, never
the recordings.

## 7. Acceptance criteria for this overhaul

A build is not "Sega Rally" until all of these are true in play:

1. Locked 60 fps on the target machine, no hitching on Desert with a full pack.
2. Braking distance and slide entry differ audibly and visibly per surface.
3. Lifting before a crest and braking in the air lands flat and gains time.
4. Title → PRESS START → SELECT MODE → car → Desert countdown, no refresh ritual.
5. One lap per course, checkpoint time extensions, position rolls over.
6. Walls and rivals glance; nothing hard-fails a championship run.
7. Desert teaches with two wide turns before it tests with a long drift right.
8. Co-driver calls arrive early enough to act on, in severity + direction form.
