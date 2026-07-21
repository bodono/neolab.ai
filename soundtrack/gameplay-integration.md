# Soundtrack gameplay integration

**Status:** implementation contract for the Complete Alpha soundtrack
**Canonical asset catalogue:** [`track-manifest.yaml`](track-manifest.yaml)
**Audition surface:** [`audition.html`](audition.html)

## 1. Purpose and non-negotiable rules

This document defines when Neolab.ai plays each music track and event cue, how audio transitions,
and how the player controls it. It supplements Technical Design §23; where the two differ, update
the technical design before implementation rather than silently creating a second architecture.

The implementation must preserve these rules:

1. Audio never communicates information that is absent from the visible game state.
2. A warning remains fully understandable with all sound disabled.
3. Only one music track and one event cue may be audible at once.
4. Event cues never queue into a stale burst after several events happen together.
5. Crisis and loss audio may be serious, but never abrasive, startling, or substantially louder.
6. Music playback never changes deterministic simulation state, saves, scoring, or command order.
7. The simulation emits domain events and presentation facts; it never refers to filenames.

## 2. Audio buses

Use three Web Audio gain buses:

```text
decoded music source ──> music gain ──┐
                                      ├──> master gain ──> destination
decoded event cue ────> event gain ──┤
future UI sounds ─────> UI/SFX gain ─┘
```

- **Music bus:** looping score and ending tracks.
- **Event bus:** the twenty semantic one-shot cues in the manifest.
- **UI/SFX bus:** reserved for later interface feedback; ordinary button presses should not reuse
  musical event cues.
- **Master bus:** global pause/resume and optional master volume.

Music and event volumes must be independently adjustable. Recommended defaults are 65% music and
70% event cues. Use equal-power gain curves for crossfades and short exponential ramps for volume
changes; never jump a gain value instantaneously.

## 3. Runtime ownership and API

Implement audio in `apps/web`; it must not enter the deterministic simulation package. The
`WebAudioManager` implements the Technical Design §23 `AudioManager` adapter and owns decoded
buffers, active sources, playback offsets, cooldowns, and transition timers.

The implementation needs the existing methods plus a small observable playback state for the main
page control:

```ts
type AudioPlaybackState =
  | "uninitialised"
  | "loading"
  | "playing"
  | "paused"
  | "unavailable";

interface AudioManager {
  initialiseFromUserGesture(): Promise<void>;
  setVolumes(settings: VolumeSettings): void;
  playCue(cue: AudioCueId): void;
  setMusicState(state: MusicState): void;
  suspend(): void;
  resumeFromUserGesture(): Promise<void>;
  getPlaybackState(): AudioPlaybackState;
  subscribe(listener: (state: AudioPlaybackState) => void): () => void;
  dispose(): void;
}
```

`setMusicState` is idempotent. Repeated requests for the active state must not restart the track.
`playCue` accepts a stable cue ID, not a URL. The UI presentation registry maps domain events to
cue IDs; a separate audio catalogue maps cue and music IDs to content-hashed build assets.

## 4. Main-page play/pause control

Place a persistent music play/pause button in the main dashboard top bar, visually separated from
the simulation pause and speed controls. It must remain visible at every supported breakpoint.
The simulation pause button controls time; the music button controls audio. They must not share an
icon-only ambiguous hit target.

Recommended desktop labels:

- `▶ Play music` when audio is uninitialised or paused;
- `Ⅱ Pause music` when music is playing;
- `… Loading audio` while the first track is decoded;
- `Audio unavailable` if initialisation fails.

At narrow widths the visible label may collapse to an icon, but the accessible name remains
`Play music` or `Pause music`. Required behaviour:

- native `<button type="button">`, keyboard reachable and at least 44×44 CSS pixels;
- `aria-pressed="true"` while playback is enabled;
- tooltip explicitly says that this does not pause the simulation;
- loading and unavailable states are disabled and announced politely;
- focus remains on the button after toggling;
- reduced-motion settings do not alter audio preferences;
- the player's music and event volumes persist in the settings repository, not the game save.

On pause, fade the master bus over 150 ms, preserve the current music offset, stop the active event
cue, and discard queued cues. On resume, restart the music from the preserved offset after a 250 ms
fade-in. Do not resume an event cue partway through: its gameplay moment has passed.

The title screen should retain the separate **Start with sound** and **Start muted** choices. Due
to browser autoplay rules, `initialiseFromUserGesture` must run directly from one of those actions
or from the main-page play button. A saved “music on” preference is not permission to autoplay
before a gesture.

Simulation pause, auto-pause, and event modals do not pause the soundtrack. This lets players read
without the sound repeatedly stopping. The player always retains the explicit audio button.

## 5. Music state model

Use a closed union owned by the presentation layer:

```ts
type MusicState =
  | { kind: "title" }
  | { kind: "laboratory"; focus: LaboratoryMusicFocus }
  | { kind: "crisis"; crisisId: string }
  | { kind: "endgame" }
  | { kind: "victory"; victory: "solo" | "coalition" }
  | { kind: "extinction" }
  | { kind: "ending-silence"; ending: "race-lost" | "bankruptcy" | "nationalised" };

type LaboratoryMusicFocus =
  | "general"
  | "commercial"
  | "research"
  | "safety";
```

Resolve competing states in this priority order:

```text
ending > victory > endgame > visible serious crisis > laboratory focus > title
```

Only ending, endgame, and visible serious-crisis changes may interrupt a track mid-loop. Ordinary
laboratory focus changes select the *next* track at a legal transition rather than reacting to
every panel click.

## 6. Full-track rules

| Track | Enter when | Leave when | Transition notes |
|---|---|---|---|
| `hello-world-model` | Title, leader selection, new-game setup | The playable lab dashboard opens | Start after the first sound-enabling gesture; 1.5 s fade into the lab. |
| `gradients-flowing` | Default laboratory focus | Another visible focus wins at a loop boundary | Primary early/mid-game track and fallback when no specialist focus applies. |
| `safety-case-draft-47` | Safety panel is active, safety programme was deliberately prioritised, or a visible safety review is open | Player returns to general work or a higher-priority state begins | Never select because of hidden alignment or containment values. |
| `red-team-found-something` | A player-visible serious crisis or red-team incident is active | The incident presentation resolves | Crossfade at the next bar when possible; the crisis-opened cue may begin immediately. |
| `last-evaluation` | Endgame Stage One begins or an endgame evaluation screen is active | An ending resolves | Preserve through endgame decisions; do not bounce back to ordinary lab music. |
| `broadly-shared-future` | Solo or coalition victory presentation completes its victory cue | Credits/results close | Fade in after `race-won` or `coalition-formed`; loop through results and credits. |
| `cashflow-positive` | Commercial focus is selected, or the player is visibly serving substantial demand with positive net revenue | Another focus wins at a loop boundary | Eligibility uses projected player-visible finance facts only. |
| `peer-reviewer-two` | Research/archive/paper-review focus is active | Another focus wins at a loop boundary | Prefer after a paper cue rather than restarting immediately at discovery time. |
| `nothing-left-to-read` | The containment-failure ending presentation begins | The one-shot track ends | Never loop. Fade to silence and leave the ending screen silent afterward. |

Non-extinction losses intentionally use their ending cue followed by silence. Do not reuse the
extinction track for bankruptcy, nationalisation, or an ordinary race loss; it would misstate what
happened.

## 7. Laboratory rotation

Do not turn music into a twitchy reflection of UI hover state. At the end of a track or after at
least 90 seconds of uninterrupted laboratory playback, choose the next eligible track using these
base weights:

| Candidate | General | Commercial focus | Research focus | Safety focus |
|---|---:|---:|---:|---:|
| `gradients-flowing` | 60 | 30 | 35 | 30 |
| `cashflow-positive` | 15 | 55 | 10 | 10 |
| `peer-reviewer-two` | 15 | 10 | 45 | 15 |
| `safety-case-draft-47` | 10 | 5 | 10 | 45 |

Rules:

- do not repeat the track that just ended if another candidate is eligible;
- do not change tracks more frequently than every 90 seconds for ordinary focus changes;
- a directly selected focus remains eligible for 20 seconds after its panel closes, preventing a
  brief inspection from causing a later surprising switch;
- cashflow eligibility may use visible net revenue, serving allocation, and demand—not hidden rival
  or market state;
- safety eligibility may use visible allocation, open evaluations, and declared programmes—not
  the hidden amount of safety research that would be “enough”;
- random selection is presentation-only and must not consume the deterministic simulation RNG.

## 8. Event-cue mapping

| Cue ID | Play when | Suppression and cooldown |
|---|---|---|
| `paper-discovered` | The player's lab is awarded a named paper world-first and its discovery presentation opens | Once per paper ID. |
| `major-breakthrough` | A visible major breakthrough that is not itself a paper is confirmed | Coalesce breakthroughs within 15 s; play once for the highest score value. |
| `capability-tier` | A new player-visible capability tier is first reached | Once per tier. Never play for an uncertain estimate. |
| `safety-win` | A named evaluation, safety milestone, or containment improvement visibly succeeds | Once per milestone ID; not for hidden safety drift. |
| `fundraising-complete` | A fundraising action resolves successfully and funds settle | Once per fundraising transaction. |
| `researcher-joins` | A star researcher contract becomes active | Coalesce multiple hires within 5 s. |
| `researcher-departs` | A star researcher actually leaves | Do not play for rumours or an unresolved ultimatum. |
| `rival-breakthrough` | The public lab feed announces a rival world-first or major tier | 60 s cooldown; coalesce simultaneous rival announcements. |
| `regulatory-attention` | A visible regulatory threshold, investigation, or formal intervention opens | 60 s cooldown per regulatory thread. |
| `crisis-opened` | A serious crisis modal opens | Once per crisis ID; then request crisis music. |
| `containment-warning` | The player receives explicit, visible containment evidence requiring attention | Once per incident severity band; never infer from hidden risk. |
| `coalition-proposed` | A concrete coalition offer becomes actionable | Once per offer ID. |
| `coalition-formed` | The coalition agreement is final and its victory/next-stage presentation opens | Once per run. If this is victory, transition to victory music afterward. |
| `endgame-begins` | Endgame Stage One begins | Once per run; transition to `last-evaluation`. |
| `race-won` | Solo aligned-AGI victory is confirmed | Once per run; then transition to `broadly-shared-future`. |
| `race-lost` | A rival wins the race without causing extinction | Once per run; fade music to silence after the cue. |
| `nationalised` | The nationalisation ending becomes final | Once per run; fade music to silence after the cue. |
| `bankruptcy` | Bankruptcy loss becomes final | Once per run; fade music to silence after the cue. |
| `containment-failure` | The extinction ending becomes irreversible and visible | Once per run; transition into `nothing-left-to-read`. |
| `score-milestone` | A named score milestone is awarded, not every numerical increment | 30 s cooldown; coalesce awards and show the summed score visually. |

Routine feed jokes, button clicks, slider movement, ordinary income settlement, and minor research
progress have no musical cue. Hundreds of feed entries must not create hundreds of sounds.

## 9. Cue priority, interruption, and ducking

Each presentation cue receives a priority:

| Priority | Cue families |
|---:|---|
| 100 | `containment-failure` |
| 90 | `race-won`, `race-lost`, `nationalised`, `bankruptcy`, `coalition-formed` when final |
| 75 | `endgame-begins`, `crisis-opened`, `containment-warning` |
| 55 | `regulatory-attention`, `coalition-proposed`, `rival-breakthrough` |
| 35 | research, capability, safety, fundraising, and talent cues |
| 15 | `score-milestone` |

If a cue is playing:

- a higher-priority cue replaces it with a 150 ms crossfade;
- an equal-priority cue within its coalescing window is merged or dropped;
- a lower-priority cue is dropped, not queued;
- ending cues clear all pending audio work.

Duck the music bus by 3 dB for ordinary cues and 4 dB for priorities 75–100. Use a 250 ms duck
attack and 800 ms release. Event cues must not stack, and their gain must not be increased merely
because the player lowers music volume.

## 10. Loading and browser behaviour

- Do not fetch audio before the first sound-enabling user gesture; audio is excluded from the
  first-load budget in Technical Design §23.
- After the gesture, load the current music track and the three most likely next tracks lazily.
- The complete event library is about 2.2 MB and may be fetched during browser idle time after the
  first track starts. Critical ending cues may be prioritised when endgame begins.
- Keep no more than the active track, the queued transition track, and recently used event buffers
  decoded on memory-constrained devices.
- Production builds use content-hashed Opus assets with AAC/MP3 fallback. The current M4A files are
  audition copies.
- Track 01–08 loop points come from exact PCM frame metadata, not the compressed file duration.
- Suspending a background tab must not alter the simulation clock. Resume audio only if the player
  had left playback enabled.
- Restoring a save establishes the correct current `MusicState` but does not replay historical
  event cues from the save or event log.

## 11. Accessibility and settings

- Sound is optional and disabled by one persistent main-page button.
- Every audio-signalled event has equivalent visible text and severity styling.
- Music, event, and future UI/SFX volume sliders expose numerical percentages to assistive tech.
- A “mute event cues” setting may coexist with music playback.
- Do not connect reduced motion to mute; they are independent preferences.
- Do not use stereo position as the only differentiator between cue meanings.
- The play/pause control, volume settings, and title-screen choices must work with keyboard only.

## 12. Acceptance tests

Stage S9.3 is not complete until automated tests cover:

1. the audio catalogue contains exactly every manifest track and event ID;
2. simulation packages contain no audio filenames or Web Audio imports;
3. audio initialisation only occurs from a user gesture;
4. play/pause preserves music position and discards stale event cues;
5. only Tracks 01–08 loop;
6. a higher-priority cue interrupts a lower one and lower-priority cues do not backlog;
7. cooldowns and per-entity deduplication work after save restoration;
8. hidden safety and rival state cannot select music or cues;
9. crisis, endgame, victory, extinction, and non-extinction ending transitions follow this table;
10. the button has correct accessible names, focus behaviour, and 44×44 target size;
11. all twenty-nine assets load with zero decode errors in supported browsers;
12. audio settings persist independently from deterministic game state.

Human playtesting must additionally confirm that no cue is startling on laptop speakers or
headphones, event cues remain audible without dominating the score, and players never mistake the
music button for the simulation pause control.
