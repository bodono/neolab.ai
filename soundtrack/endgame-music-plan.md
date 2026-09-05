# Endgame music plan — six tracks for the held breath

**Status:** superseded — the six tracks this plan produced are retired from the game rotation (kept in `audition.html` for reference). Played against the finished endgame they read as sad and slow where the act is thrilling. The replacement direction is [`endgame-thriller-plan.md`](endgame-thriller-plan.md).

Original status: shipped — all six tracks composed, rendered, and wired to the player-visible endgame stages. The comfort rules are absolute here as
everywhere: nothing harsh, nothing startling, no fuzz, percussion at whisper
level or absent. Tension comes from harmony, register, and time — never from
loudness or treble.

## 1. What the mood must be

**The comedy stops.** The whole game runs on the gap between cosmic stakes and
office furniture — soup, whiteboards, Reviewer Two. The endgame is where that
gap closes. The score's registers flip accordingly: satire came from timing and
instrumentation; sincerity now comes from restraint. Five of these six tracks
carry no jokes at all. One (the outside world) keeps a single dry eyebrow, and
one (False Dawn) lets the comedy return deliberately slightly wrong.

**The music knows exactly as much as the player.** This is the load-bearing
design decision, and it falls straight out of the game's hidden-information
contract. The endgame's entire drama is that the player cannot know whether
the candidate is aligned — and the score must not answer the question the
simulation refuses to. Minor-key dread would whisper "it's misaligned"; warm
major would promise safety. Both are leaks. So the harmonic language of the
whole endgame family is **suspended, mixed-mode ambiguity**: chords legible as
relative major and minor at once, pedal points that let both readings coexist,
phrases that end on neither. Hope and fear are the same notes. Only the ending
cues — played when the simulation itself commits — resolve the mode.

**Time dilates.** Weeks of procedure surround one irreversible decision. Every
track here sits below the laboratory's normal tempo range, with slow harmonic
rhythm, long pedals, and silence used as material. The busy hemiolas and
bouncing basses of ordinary play have no place; the building has gone quiet
and everyone can hear the air conditioning.

**The motifs become liturgy.**
- The **Lab Motif** appears slowed, fragmented, and reharmonised (the bible
  already mandates this) — the daytime theme remembered under oath.
- The **Safety Answer** is asked and *left unanswered* — the phrase hangs.
  The run's actual ending is what finally answers it.
- The **Frontier Pulse** slows to a heartbeat: a soft rounded kick at rest
  pulse, the only percussion most of these tracks carry.

**The people stay warm.** The building is full of humans during history.
Human-scale tenderness is allowed — a warm-lead line, a low triangle breath —
so long as warmth reads as *people*, never as a verdict on the model.

## 2. The six tracks

Each maps to a **player-visible endgame stage** from `EndgameView.stage`, so
selection can never leak hidden state. This original plan retained *The Last
Evaluation* for `evidence-sprint`; the later thriller pass superseded it with
Track 34, *The Window Is Closing*.

### 17 · The Number Appears — stage `confirmation` · 72 BPM · C Lydian over an E pedal · ~3:00

The week the evaluation suite returned the result. Vertigo and awe, not alarm.
The musical device is recognition: **C Lydian is the title screen's key of
innocent curiosity, replayed over an E pedal** — the same notes the game
opened with, now meaning something else entirely. The Lab Motif enters at
half speed, breaks off before its final two notes, and the pedal holds.

### 18 · Containment Posture — stage `containment-posture` · 86 BPM · A Dorian · ~3:10

Procedure as ritual. The lab does the careful things in the careful order:
checklists, sign-offs, the second key for the second lock. A patient ostinato
that never varies while the harmony changes around it — the fixed procedure
against shifting circumstances. Focused, not frightened; this is the
competence track. Closest living relative of *Red Team Found Something*, but
without urgency: nothing is on fire, everything is at stake.

### 19 · Everyone Is Calling — stage `pressure-collision` · 90 BPM · B♭ major/G minor lattice · ~2:50

The outside world arrives: ministries, rivals, journalists, the board. The one
track in the family allowed a dry expression — a formal, slightly pompous
low-register figure for the institutions (cousin of the regulatory cue's
"formal seal" gesture), against the lab's quiet inner voice continuing to
work. Gravity from outside, played deadpan; the pressure is real and so is
the absurdity of taking these calls during *this*.

### 20 · The Final Review — stage `final-review` · 63 BPM · B minor, suspended · ~3:20

The sparse suspense loop the score bible has always promised for critical
decisions. Nearly static: breath-length phrases with real silence between
them, a two-note pulse at heart rate, and the **Safety Answer motif asked
once per cycle and never answered**. The loop must be comfortable to sit
inside for a long time — the player may hold on this screen while they decide,
and the music's job is to wait with them, not to hurry them.

### 21 · Root Access — stage `rollout` · 76 BPM · F♯ minor / A major lattice · ~3:30

The confirmation text has been typed; the model is operating in the world.
Vast, slow, luminous, and strictly undecided: the lattice is built so that
**A major — the victory track's key — is visible through F♯ minor**, an ending
glimpsed but not yet claimable. The Frontier Pulse runs at heartbeat depth
beneath long pad swells. This is the largest-sounding track in the game and
also one of the quietest: scale expressed by register and space, not level.

### 22 · False Dawn — return to play after an archived candidate · 96 BPM · D major, altered · ~2:40

The candidate is archived; the lab walks back into ordinary weather. The
comedy is allowed back in, slightly wrong: **D major is the key of The
Gradients Are Flowing, and the Lab Motif returns with its seventh degree
missing** — the office remembered imperfectly by someone who has seen
something. Relief with a hollow centre. Plays during the post-False-Dawn
review window, then hands off to the ordinary laboratory rotation, which
will sound uncannily like it.

## 3. Integration sketch

- **Endgame music is never shuffled.** The lab pools and shuffle bag apply to
  ordinary play only; the endgame is an authored sequence keyed to the
  visible stage, because this act has a dramaturgy.
- `MusicState` gains stage granularity: `{ kind: "endgame"; stage: ... }`,
  derived only from `EndgameView.stage` (all player-visible). Stage
  transitions crossfade at a bar boundary; entering `final-review` or
  `rollout` may transition immediately, matching the existing crisis rule.
- Good-news steering is disabled throughout (already guaranteed: steering
  only applies to laboratory states).
- Ending handoffs are unchanged: victory → *A Broadly Shared Future*,
  extinction → *There Is No One Left to Read This*, other losses → their
  cue, then silence. None of the six may approach the extinction track's
  sparseness — that emptiness stays reserved for the one ending that earns it.
- Track 34, *The Window Is Closing*, now carries `evidence-sprint`, completing
  the seven-stage musical arc with a faster, more anxious cue.

## 4. Comfort and register rules (restating the absolutes)

- No snares, no hats, no tick blips anywhere in the family; the rounded kick
  at whisper level is the only percussion, and several tracks should carry
  none at all.
- Melody capped at B5; bells mid-register and rare; spectral check against
  the Gradients ceiling (2–5 kHz share < 0.080%) before any track ships.
- Loud moments are forbidden even at the climax: the deployment of a possible
  AGI is scored *quieter* than delivery day, because that is the truth of the
  room.

---

Copyright © 2026 Brendan O'Donoghue <bodonoghue85@gmail.com>. See the [project copyright notice](../COPYRIGHT.md).
