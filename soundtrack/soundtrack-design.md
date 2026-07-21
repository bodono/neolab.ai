# Neolab.ai soundtrack design

**Status:** Complete Alpha score bible
**Target:** nine full tracks and twenty event cues for a roughly two-hour run
**Core feeling:** brilliant people doing consequential work in a cheerful machine full of knobs

## 1. Musical thesis

The normal laboratory should sound clever, optimistic, tactile, and slightly ridiculous. The
score is electronic without being cold: rounded harmonic leads behave like excitable researchers,
triangle basses make the campus feel industrious, and soft digital bells suggest discoveries
arriving one suspiciously elegant result at a time.

The music should be enjoyable when heard repeatedly behind a management dashboard. That means
short motifs, restrained density, few exhausting high frequencies, clear bass movement, and
arrangements which leave space for interface sounds. Satire comes from timing and instrumentation,
not comedy sound effects. A seven-note ascending figure can feel both genuinely hopeful and like a
quarterly chart which has begun to believe in itself.

The reference is a *category*, not a composition to imitate: inventive puzzle-game music,
tracker-era economy, toy-like electronic timbres, and melodies with unusual but memorable turns.
No melody, chord sequence, sound patch, arrangement, or title should reproduce a recognisable
piece from another game.

## 2. Sonic identity

### 2.1 Instrument palette

| Voice | Musical function | Character |
|---|---|---|
| Rounded harmonic lead | Primary lab motif | Warm, articulate, inquisitive |
| Rounded harmonic pluck | Countermelody and momentum | Gentle machinery |
| Triangle bass | Harmonic foundation | Warm, stable, never enormous |
| Sine/FM bell | Discoveries and interface-adjacent sparkle | Precise, lightly uncanny |
| Soft wavetable pad | Safety, science, and endgame breadth | Humane technology |
| Low-passed brush texture | Sparse rhythmic movement | Distant, soft, unobtrusive |
| Rounded pitched kick | Pulse and escalation | Quiet, warm, legible on laptops |

The final production may use a tracker, FM synth, wavetable synth, or recorded hardware. It should
retain limited polyphony and deliberate timbral roles instead of filling every frequency band.
Raw pulse, hard square, and quantised chip voices are excluded from the soundtrack entirely. Both
foreground motifs and background arpeggios need gentle attacks and deliberately limited upper
harmonics. No individual layer should call attention to its timbre over the composition.

Percussion follows the same rule. Conventional bright hats and noisy snare cracks are excluded.
Any brush texture must be heavily low-passed, fade in gently, and sit near the edge of perception;
the snare role is a mostly tonal soft tap. The kick begins with a rounded pitched transient rather
than a broadband click. Crisis intensity comes from harmony, tempo, and restrained rhythmic
movement—not loudness, density, or treble energy.

**Global comfort rule:** every track, including crises and bad endings, must support a peaceful,
easy listening experience. Tension may be psychologically serious without becoming sonically
abrasive. If a sound is startling in isolation, it does not belong in the score.

### 2.2 Shared motifs

The score uses three original motif families:

1. **The Lab Motif:** scale degrees `1–3–5–7–6–5–3–2`. Upward curiosity followed by a modest
   correction. It belongs in title, normal play, and victory music.
2. **The Safety Answer:** a descending `5–4–2–3` response with one held note. It can sound calm in
   normal play or accusatory during a crisis.
3. **The Frontier Pulse:** a repeated root interrupted one subdivision early. It creates momentum
   without requiring a louder mix.

During the endgame the Lab Motif should become slower and harmonically ambiguous. A successful
ending finally completes it on a warm added-sixth chord. A loss may stop before the final answer
rather than playing a melodramatic sting.

## 3. Emotional rules

- Default music is happy, busy, and lightly eccentric—not triumphant before the player has earned
  anything.
- Research discoveries add brightness or a short countermelody rather than replacing the track.
- Low cash removes rhythmic layers before it introduces ominous harmony. The lab first sounds
  under-resourced, then frightened.
- Safety uncertainty uses space, unstable intervals, and unanswered phrases. It must not tell the
  player the hidden truth.
- Ordinary incidents duck the music briefly. Serious crises crossfade to crisis material at the
  next bar. Critical decisions may hold on a sparse suspense loop.
- Victory is sincere. Satire should not undercut the emotional payoff of a broadly good future.
- Extinction is quiet and short. The game should not turn catastrophe into a spectacular reward.

## 4. Full track catalogue

| ID | Working title | Use | Tone | BPM | Prototype |
|---|---|---|---|---:|---|
| `hello-world-model` | Hello, World Model | Title and lab selection | Curious, welcoming | 108 | 2:40 |
| `gradients-flowing` | The Gradients Are Flowing | Early and middle laboratory | Upbeat, productive | 126 | 2:32 |
| `safety-case-draft-47` | Safety Case (Draft 47) | Safety work and reflective play | Warm, uncertain | 92 | 3:08 |
| `red-team-found-something` | Red Team Found Something | Serious incident or crisis | Focused, restrained | 138 | 2:19 |
| `last-evaluation` | The Last Evaluation | Endgame evidence sprint | Expansive, tense | 104 | 3:05 |
| `broadly-shared-future` | A Broadly Shared Future | Full victory and credits | Hopeful, earned | 116 | 2:46 |
| `cashflow-positive` | Cashflow Positive* | Commercial momentum | Jaunty, overconfident | 122 | 2:22 |
| `peer-reviewer-two` | Reviewer Two Requires AGI | Publication and research archive | Fussy, cerebral | 114 | 2:32 |
| `nothing-left-to-read` | There Is No One Left to Read This | Extinction ending | Sparse, final | 60 | 2:08 |

The asterisk in `Cashflow Positive*` is part of the title and should appear in the soundtrack list.

### 4.1 Arrangement standard

Tracks 01–08 contain introductions, contrasting development, a sparse breathing section, a
thematic return, and a musical loop landing. Added duration comes from harmony, rhythm, register,
and orchestration changes rather than repeating a short render. Track 09 is a deliberately
non-looping ending with a natural fade.

### 4.2 Event-audio library

Twenty one-shot cues cover research discoveries, capability and safety progress, fundraising,
talent changes, rivals, regulation, crises, containment, coalition play, endgame entry, score
milestones, and every major ending family. Their exact IDs and assets live in
`track-manifest.yaml`.

Event cues follow four rules:

- use a recognisable score motif rather than a generic notification beep;
- never exceed the music bus's apparent loudness;
- contain no drums, alert transients, or mandatory information;
- duck the music gently by roughly 2–4 dB, with more serious meaning expressed through harmony.

They must also differ in musical *gesture*, not merely key or melody. The Complete Alpha uses
twenty named shapes—blooms, arcs, staircases, call-and-response, duets, formal seals, swells,
interwoven lines, cadences, receding phrases, deliberate empty space, and an interrupted final
fragment. Reusing one chord–bass–melody envelope for unrelated events is prohibited.

## 5. Adaptive playback model

The launch version does not need fully generative music. It needs musically aware transitions and
optional layers:

```text
base loop
  + momentum layer when research and finances are healthy
  + discovery sparkle for a world-first paper
  + low-runway subtraction when runway falls below the warning band
  + anomaly texture when unresolved evidence is serious
```

Each production track should deliver:

- a stereo base loop;
- optional rhythm and melody stems where layering materially helps;
- loop start and end measured in exact samples;
- BPM, time signature, and bar count;
- a two-bar or four-bar transition point;
- an optional one-shot discovery cadence.

Transitions should normally be quantised to a bar boundary. An urgent modal decision can duck the
current track immediately by 6–9 dB, then switch at the next legal transition. Returning from a
crisis should wait until the decision resolves; otherwise the music can imply safety before the
simulation has done so.

## 6. Browser delivery

Production masters should be exported losslessly, then encoded into at least one broadly supported
browser format. The initial engineering target is:

- stereo, 44.1 or 48 kHz production master;
- Opus around 96–128 kbps as the preferred compact asset;
- AAC/M4A or MP3 fallback where browser testing requires it;
- lazy-load the next likely track rather than the whole album;
- decode no more than the current track, transition asset, and one queued track;
- cache immutable, content-hashed audio files;
- music and SFX buses with separate sliders, mute, and remembered settings;
- begin or resume the audio context only after the player's first interaction.

The title screen should offer **Start with sound** and **Start muted**. Sound must never be required
to understand an event or warning.

## 7. Prototype evaluation rubric

For each track, listen once by itself and once while operating the dashboard for at least ten
minutes. Score from 1–5:

- Is the central motif memorable after one listen?
- Does the loop remain pleasant after repeated plays?
- Does it leave room for reading and decisions?
- Does it sound like Neolab.ai rather than generic cyberpunk?
- Is the emotional signal appropriate without revealing hidden game state?
- Are the highest voices comfortable on laptop and phone speakers?
- Would a human musician have an interesting foundation to improve?

Keep musical criticism separate from mix criticism. A strong theme with a crude prototype timbre
is valuable; a polished texture without an identity is not.

## 8. Production handoff

If a human composer or producer polishes the score, provide this bible, the manifest, source
sequences, rendered sketches, and a gameplay capture. Ask for loopable masters, stems, project
files, and a written licence covering free browser distribution, downloadable soundtrack use,
trailers, future paid editions, and derivative adaptive arrangements.

Before release, record provenance and licensing for every final asset. The current prototypes use
only programmatically generated waveforms and noise; they include no external samples.
