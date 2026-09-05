# Endgame thriller plan — six fast tracks for the race's final act

**Status:** shipped — all six tracks composed, rendered in both codecs, wired
to the player-visible endgame stages, and auditioning above the retired suite
in [`audition.html`](audition.html). The retired suite this replaced is
documented in [`endgame-music-plan.md`](endgame-music-plan.md).

## 1. Why the old suite failed

The held-breath suite scored the endgame as awe: 63–96 BPM, suspended
harmony, whisper percussion. Played against the finished game it lands as
sad and slow — the score's quietest music over its most thrilling act. The
endgame is where the race is won or lost and humanity's fate is decided;
the player's heart should be *racing*. The album's energy ceiling today is
`red-team-found-something` at 138 BPM (intensity 4). The endgame should sit
**above** the album, not below it: this suite owns the 126–152 BPM band and
intensities 3–5.

What the old suite got right, keep: motif discipline (Lab Motif, Safety
Answer, Frontier Pulse), one authored track per player-visible stage, no
shuffling, no steering, seamless loops on the one-bar grid.

## 2. Hard constraints (non-negotiable)

These restate the score bible's comfort rules plus the explicit production
rules for this suite:

- **No fuzz, ever.** No distortion, bitcrush, detuned-saw beating, resonant
  filter squeals, or noise-based risers. Excitement comes from tempo,
  harmony, meter, and register — never from timbre grit.
- **Nothing jarring.** No startling transients. Every voice keeps a gentle
  attack (≥ a few ms), limited upper harmonics, and the existing rounded
  palette: rounded leads and plucks, triangle bass, sine/FM bells, soft
  pads, low-passed brush.
- **Drums with extreme care.** Percussion stays tonal and rounded: the
  pitched kick, soft mostly-tonal taps, `tick()` bells at low amplitude,
  heavily low-passed brush faded in. **No bright hats, no noise snares, no
  cymbals.** Drive comes from *note density and migrating accents*, not
  from louder or brighter hits. `add_gentle_rhythm` and
  `add_light_drums(energetic=True)` are the proven ceiling; anything new
  must pass the "not startling in isolation" test.
- **Loudness discipline.** Same mastering headroom as the album. A thriller
  at equal volume: faster, never louder.

## 3. The anxiety toolkit (proven, non-jarring devices)

1. **Tempo:** 126–152 BPM. Every track at or above Gradients (126).
2. **The Frontier Pulse** — a repeated root interrupted one subdivision
   early — becomes the suite's signature, running in 16ths. It was built
   for exactly this ("momentum without a louder mix") and the old suite
   barely used it.
3. **Migrating accents:** ostinati of 7 or 5 sixteenths phased against 4/4
   (`compose_containment_posture` already proved odd groupings in-house);
   the accent lands somewhere new each bar — unease with zero added volume.
4. **Harmonic engines:** chromatic mediant lifts (Em→G→B♭→D) for
   exponential-takeoff feel; i↔♭II Neapolitan shimmer for dread;
   deceptive cadences and phrases that end one bar early. `red-team`'s
   chromatic descent (D–C♯–C–B♭–A…) is the house dread-line — reuse it
   faster.
5. **Clock devices:** unbroken eighth-note `tick()` pulses; a bass that
   walks in urgent quarters; harmonic rhythm that doubles across a section
   then resets at the loop point.
6. **Motif compression:** the Lab Motif in double-time fragments (it has
   only ever been stated calmly); the Safety Answer asked repeatedly, each
   time a register higher, never answered.

## 4. The six tracks

Files take new numbers 26–31; the retired 17–22 stay on disk for audition.
All loop seamlessly and all transition on the one-bar grid. This first pass
kept `last-evaluation` (05) for `evidence-sprint`; Track 34, *The Window Is
Closing*, later replaced it with the fast thriller cue the stage needed.

### 26 · The Graph Goes Vertical — stage `confirmation`

- **140 BPM · E minor with C-Lydian flashes · intensity 4 · ~2:40**
- The number appears and the floor drops. Frontier Pulse ignites in 16ths
  within two bars; chromatic mediant ladder (Em→G→B♭→D) lifts every eight
  bars so the harmony itself feels exponential; the Lab Motif tries its
  calm statement and gets compressed into double-time fragments that can't
  finish. Bells (the discovery timbre) fire ascending over the top — awe
  riding adrenaline.
- Percussion: pitched kick on quarters entering bar 9, gentle-rhythm taps.

### 27 · Hands Off The Weights — stage `containment-posture`

- **132 BPM · A Dorian · intensity 3 · ~2:50**
- Coiled procedure at speed: a moto-perpetuo pluck ostinato of **seven
  sixteenths** phased against 4/4, so the accent migrates and the room
  never quite settles; triangle bass locked to a Frontier Pulse that keeps
  arriving early. The Safety Answer runs as the bass countermelody —
  containment *is* the safety case, played fast. Dorian keeps the old
  track's key family but bright-edged and taut instead of ritual-calm.
- Percussion: soft tonal taps only; no kick until the B section.

### 28 · Every Phone At Once — stage `pressure-collision`

- **144 BPM · G minor · intensity 4 · ~2:40**
- The outside world at the door. Two bell "ring" figures loop in 3:2
  polyrhythm — pitched, rounded, never harsh — like desks of phones going
  off out of phase. The bass walks urgent quarters underneath; between
  phrases the whole ensemble answers with short Frontier Pulse stabs. The
  old track's pompous institutional figure survives as a brass-register
  pad line, now hurried, stepping on the lab's inner-voice countermelody.
- Percussion: kick on 1 and 3 only; the polyrhythm is the drummer.

### 29 · Go / No-Go — stage `final-review`

- **152 BPM · B minor · intensity 5 · ~2:30**
- The score's new ceiling, for the decision itself. An unbroken eighth-note
  tick — the clock — never stops for the entire loop. Harmony alternates
  i↔♭II (Neapolitan shimmer: dread with zero added treble). The Safety
  Answer is asked over and over, each time one register higher, and is
  never answered; the loop point lands mid-phrase so holding the decision
  means the question literally never resolves. Sparse mix — fewest voices
  in the suite, fastest pulse — so it stays comfortable to hold.
- Percussion: the tick *is* the percussion; one low tonal tap per bar.

### 30 · Ship It — stage `rollout`

- **148 BPM · F♯ minor / A major lattice · intensity 4 · ~2:45**
- The die is cast and the deploy is running. Keeps the old Root Access
  harmonic idea — victory's A major visible through F♯ minor — at triple
  the velocity: cascading rounded arps stepping downward like a progress
  bar filling, pitched kick four-on-the-floor (soft, warm, laptop-legible),
  Lab Motif fragments accelerating toward completion but always one note
  short at the loop boundary. Thrilling and terrified at once: this is the
  moment the lab stops being able to take it back.
- Percussion: the suite's only four-on-floor kick; rounded transient only.

### 31 · Adrenaline Half-Life — stage `resolved`

- **126 BPM · D major · intensity 3 · ~2:30**
- The candidate is archived, the run continues: wired relief. Gradients'
  key and tempo exactly, so the handoff to the lab pools lands seamlessly —
  but the Frontier Pulse still tremors underneath the bright chords and the
  completed Lab Motif arrives syncopated, off the beat it always used to
  land on. The lab is fine. The lab's hands are still shaking.
- Percussion: gentle-rhythm taps thinning bar by bar toward the loop point.

**BPM ladder across the suite: 140 · 132 · (104 kept) · 144 · 152 · 148 · 126.**

## 5. Historical interim wiring

Until the suite renders, the stage map borrows the score's urgent tracks —
authored, never shuffled:

| Stage | Interim track |
|---|---|
| `confirmation`, `containment-posture`, `evidence-sprint`, `rollout` | `last-evaluation` |
| `pressure-collision`, `final-review` | `red-team-found-something` |
| `containment-failure` | `loss-of-signal` (unchanged) |
| `resolved` | `gradients-flowing` |

The current live map uses Track 34, *The Window Is Closing*, for
`evidence-sprint`; this table is retained only as the implementation history.

## 6. Production checklist

1. Compose `compose_the_graph_goes_vertical` … `compose_adrenaline_half_life`
   in `tools/render_prototypes.py`; add TRACKS entries 26–31; render both
   codecs (`prototypes/26-…` through `31-…`).
2. Rubric pass per the score bible §7, plus the suite test: **played cold,
   each track must raise the pulse without ever making the listener flinch.**
   Audition each track at low volume and at speed 4x game pace for
   startle-checks.
3. `track-manifest.yaml`: six new entries (state `full-arrangement-alpha`),
   roles `endgame-*-thriller`.
4. `audition.html`: new "Endgame suite · 6 tracks" section above the OLD one.
5. Game wiring: new ids in `audio-types.ts`, entries in `audio-catalogue.ts`
   with measured durations, re-point `ENDGAME_STAGE_TRACKS`, update the
   audio unit tests.
6. Score bible amendment: §2.2's "During the endgame the Lab Motif should
   become slower and harmonically ambiguous" becomes "faster, compressed,
   and harmonically unstable"; §4's endgame rows get the new tone words
   (excited, anxious, thrilling — never sad, slow, or sombre).
7. Remove the interim borrowings from `gameplay-integration.md` §6 and
   restore one row per stage.

## 7. Addendum — the deus ex machina pair (shipped)

Two more tracks extend the family into science fiction, keeping every
comfort rule:

- **32 · Ghost in the Cluster — machine-flavoured crises · 136 BPM ·
  whole-tone over a C/F♯ tritone pendulum.** Autonomy incidents and anomaly
  clusters now sound like the machine rather than the institution: harmony
  with no tonal floor, bells answering themselves across the room, and the
  score's one deliberately inhuman pulse — dead-even sixteenths with no
  accent, uncanny by regularity alone. Institutional crises keep
  `red-team-found-something`.
- **33 · The Machine Moves First — endgame stage `containment-failure` ·
  146 BPM · planing major triads over an endless ascent.** The stage that
  used to borrow `loss-of-signal` gets its own track: a quiet Shepard-style
  ascent that rises without ever arriving, deep F/B tritone tolls, and the
  Lab Motif answered by its own inversion — the machine speaking the lab's
  language upside down.
