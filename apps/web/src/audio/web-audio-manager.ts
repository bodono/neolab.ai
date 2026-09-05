import { CUE_ASSETS, MUSIC_ASSETS } from "./audio-catalogue.ts";
import type {
  AudioCueId,
  AudioManager,
  AudioPlaybackState,
  EndgameMusicChapter,
  LaboratoryMusicFocus,
  MusicState,
  MusicTrackId,
  VolumeSettings,
} from "./audio-types.ts";

/**
 * Per-focus track pools. The first entry is the focus's signature track and
 * plays when the focus is first entered; every later selection is drawn from
 * a shuffle bag over the pool — random order, no immediate repeats, and every
 * pool member plays once before anything repeats. Selection is
 * presentation-only and never consumes deterministic simulation RNG.
 */
const LAB_POOLS: Readonly<Record<LaboratoryMusicFocus, readonly MusicTrackId[]>> = {
  general: [
    "gradients-flowing",
    "tests-pass-first-try",
    "hello-world-model",
    "peer-reviewer-two",
    "overnight-run",
    "demo-worked-twice",
    "cashflow-positive",
    "gpus-arrive-tuesday",
    "converged-before-lunch",
    "budget-approved",
    "new-hire-orientation",
    "safety-case-draft-47",
  ],
  commercial: [
    "cashflow-positive",
    "gpus-arrive-tuesday",
    "budget-approved",
    "demo-worked-twice",
    "converged-before-lunch",
    "gradients-flowing",
  ],
  research: [
    "peer-reviewer-two",
    "tests-pass-first-try",
    "gradients-flowing",
    "new-hire-orientation",
    "overnight-run",
    "safety-case-draft-47",
  ],
  safety: [
    "safety-case-draft-47",
    "peer-reviewer-two",
    "overnight-run",
    "hello-world-model",
    "gradients-flowing",
  ],
};

/**
 * Manual NEXT spans every ordinary laboratory track, irrespective of the
 * current tab's mood. Crisis, endgame, victory, and defeat tracks remain
 * authored state transitions and are deliberately excluded.
 */
const LABORATORY_TRACKS: readonly MusicTrackId[] = [
  ...new Set(Object.values(LAB_POOLS).flat()),
];

const PLAYBACK_START_TIMEOUT_MILLISECONDS = 10_000;
const PLAYBACK_RECOVERY_DELAY_MILLISECONDS = 2_000;

export interface WebAudioEnvironment {
  readonly createContext: () => AudioContext;
  /** Presentation-only randomness for the shuffle bag; defaults to Math.random. */
  readonly random?: () => number;
  readonly fetchArrayBuffer: (url: string) => Promise<ArrayBuffer>;
  readonly setTimer: (callback: () => void, milliseconds: number) => number;
  readonly clearTimer: (timer: number) => void;
  readonly requestIdle: (callback: () => void) => void;
  /**
   * Declares this page's audio as media playback. iOS routes Web Audio through
   * a session the ring/silent switch mutes, while a media element is exempt --
   * which is why a silenced iPad plays YouTube and not this soundtrack, with no
   * signal the page can read. Optional because only Safari 16.4+ implements it.
   */
  readonly requestMediaPlaybackSession?: () => void;
}

interface AudioSessionNavigator {
  audioSession?: { type: string };
}

/** Exported for testing: the capability is absent on most browsers. */
export function applyMediaPlaybackSession(candidate: unknown): boolean {
  const session = (candidate as AudioSessionNavigator | undefined)?.audioSession;
  if (session === undefined) return false;
  session.type = "playback";
  return true;
}

function browserEnvironment(): WebAudioEnvironment {
  return {
    createContext: () => new AudioContext(),
    requestMediaPlaybackSession: () => {
      applyMediaPlaybackSession(globalThis.navigator);
    },
    fetchArrayBuffer: async (url) => {
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Audio request failed (${String(response.status)})`);
      return response.arrayBuffer();
    },
    setTimer: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
    clearTimer: (timer) => window.clearTimeout(timer),
    requestIdle: (callback) => {
      const idleWindow = window as Window & {
        requestIdleCallback?: (work: () => void, options: { timeout: number }) => number;
      };
      if (idleWindow.requestIdleCallback !== undefined) {
        idleWindow.requestIdleCallback(callback, { timeout: 5_000 });
      } else {
        window.setTimeout(callback, 1_000);
      }
    },
  };
}

/**
 * The endgame is an authored sequence, never shuffled. Musical chapters are
 * presentation concepts rather than simulation stages, so short mechanical
 * substates can share a track without restarting it.
 */
const ENDGAME_CHAPTER_TRACKS: Readonly<Record<EndgameMusicChapter, MusicTrackId>> = {
  candidacy: "the-graph-goes-vertical",
  "capability-proof": "the-graph-goes-vertical",
  "dossier-review": "the-window-is-closing",
  diagnosis: "the-window-is-closing",
  "safety-work": "hands-off-the-weights",
  "deployment-planning": "go-no-go",
  pressure: "every-phone-at-once",
  "controlled-rollout": "ship-it",
  "final-review": "go-no-go",
  "deployment-held": "go-no-go",
  "retirement-held": "hands-off-the-weights",
  "observed-resistance": "the-machine-moves-first",
  "containment-failure": "the-machine-moves-first",
  "local-recovery": "adrenaline-half-life",
  moratorium: "safety-case-draft-47",
};

/**
 * Visible branch adjacency only. It deliberately excludes ending tracks: while
 * an order is held, prefetch must not inspect or anticipate the hidden outcome.
 * At most two distinct tracks are decoded for the likely next chapters.
 */
const ENDGAME_CHAPTER_PREFETCH: Readonly<
  Record<EndgameMusicChapter, readonly EndgameMusicChapter[]>
> = {
  candidacy: ["capability-proof", "deployment-held", "retirement-held"],
  "capability-proof": ["dossier-review", "deployment-held", "retirement-held"],
  "dossier-review": ["diagnosis", "safety-work", "deployment-planning"],
  diagnosis: ["dossier-review", "safety-work"],
  "safety-work": ["dossier-review", "deployment-planning", "retirement-held"],
  "deployment-planning": ["controlled-rollout", "final-review", "retirement-held"],
  pressure: ["controlled-rollout", "retirement-held"],
  "controlled-rollout": ["final-review", "observed-resistance", "retirement-held"],
  "final-review": ["deployment-held", "retirement-held"],
  "deployment-held": ["observed-resistance", "containment-failure"],
  "retirement-held": ["observed-resistance", "local-recovery"],
  "observed-resistance": ["containment-failure", "local-recovery"],
  "containment-failure": ["local-recovery"],
  "local-recovery": [],
  moratorium: [],
};

const ENDGAME_PREFETCH_TRACK_LIMIT = 2;
const DECODED_TRACK_CACHE_LIMIT = 8;

function endgamePrefetchTracksForChapter(
  chapter: EndgameMusicChapter,
): readonly MusicTrackId[] {
  const currentTrack = ENDGAME_CHAPTER_TRACKS[chapter];
  const tracks: MusicTrackId[] = [];
  for (const nextChapter of ENDGAME_CHAPTER_PREFETCH[chapter]) {
    const track = ENDGAME_CHAPTER_TRACKS[nextChapter];
    if (track === currentTrack || tracks.includes(track)) continue;
    tracks.push(track);
    if (tracks.length === ENDGAME_PREFETCH_TRACK_LIMIT) break;
  }
  return tracks;
}

function trackForState(state: MusicState): MusicTrackId | undefined {
  switch (state.kind) {
    case "title":
      return "hello-world-model";
    case "laboratory":
      return LAB_POOLS[state.focus][0];
    case "crisis":
      return state.flavour === "machine"
        ? "ghost-in-the-cluster"
        : "red-team-found-something";
    case "endgame":
      return ENDGAME_CHAPTER_TRACKS[state.chapter];
    case "victory":
      // The one true victory keeps the most upbeat ending in the game; the
      // qualified wins are celebrated a register lower, asterisk included.
      return state.tier === "full" ? "broadly-shared-future" : "a-qualified-success";
    case "extinction":
      return "nothing-left-to-read";
    case "ending-defeat":
      return "exit-interview";
    case "ending-catastrophe":
      return "loss-of-signal";
  }
}

function isImmediateTransition(state: MusicState): boolean {
  return state.kind !== "laboratory" && state.kind !== "title";
}

function musicStateKey(state: MusicState): string {
  switch (state.kind) {
    case "laboratory":
      return `${state.kind}:${state.focus}`;
    case "crisis":
      return `${state.kind}:${state.crisisId}`;
    case "endgame":
      return `${state.kind}:${state.chapter}`;
    case "victory":
      return `${state.kind}:${state.tier}`;
    default:
      return state.kind;
  }
}

interface PlayingSource {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly trackId: MusicTrackId;
  readonly startedAt: number;
  readonly offsetAtStart: number;
}

interface ActiveCue {
  readonly cueId: AudioCueId;
  readonly priority: number;
  readonly token: number;
  source?: AudioBufferSourceNode;
}

/** Browser-only presentation audio. It never observes or mutates canonical simulation state. */
export class WebAudioManager implements AudioManager {
  readonly #environment: WebAudioEnvironment;
  readonly #listeners = new Set<(state: AudioPlaybackState) => void>();
  readonly #encoded = new Map<string, ArrayBuffer>();
  readonly #decoded = new Map<string, AudioBuffer>();
  readonly #decodedUse = new Map<string, number>();
  readonly #seenOccurrences = new Set<string>();
  readonly #cooldowns = new Map<AudioCueId, number>();

  #context: AudioContext | undefined;
  #master: GainNode | undefined;
  #music: GainNode | undefined;
  #duck: GainNode | undefined;
  #events: GainNode | undefined;
  #ui: GainNode | undefined;
  #settings: VolumeSettings = {
    music: 0.65,
    events: 0.7,
    ui: 0.7,
    muteEventCues: false,
    playbackEnabled: false,
  };
  #playbackState: AudioPlaybackState = "uninitialised";
  #musicState: MusicState = { kind: "title" };
  #selectedTrackId: MusicTrackId | undefined = "hello-world-model";
  #laboratorySelection: Partial<Record<LaboratoryMusicFocus, MusicTrackId>> = {};
  #lastSuggestionAt: number | undefined;
  #laboratoryShuffleBag: Partial<Record<LaboratoryMusicFocus, MusicTrackId[]>> = {};
  #manualLaboratoryShuffleBag: MusicTrackId[] = [];
  #manualPlaylistOverride = false;
  #lastPrefetchedEndgameChapter: EndgameMusicChapter | undefined;
  #endgamePrefetchToken = 0;
  #playing: PlayingSource | undefined;
  #pausedOffset = 0;
  #activeCue: ActiveCue | undefined;
  #musicRequestToken = 0;
  #cueRequestToken = 0;
  #playbackStartToken = 0;
  #musicStartedAt = Number.NEGATIVE_INFINITY;
  #suspendTimer: number | undefined;
  #recoveryTimer: number | undefined;
  #disposed = false;

  constructor(environment: WebAudioEnvironment = browserEnvironment()) {
    this.#environment = environment;
  }

  getPlaybackState(): AudioPlaybackState {
    return this.#playbackState;
  }

  getCurrentTrackId(): MusicTrackId | undefined {
    return this.#playing?.trackId ?? this.#selectedTrackId;
  }

  subscribe(listener: (state: AudioPlaybackState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setVolumes(settings: VolumeSettings): void {
    this.#settings = settings;
    const now = this.#context?.currentTime ?? 0;
    this.#master?.gain.setValueAtTime(settings.playbackEnabled ? 1 : 0, now);
    this.#music?.gain.setValueAtTime(settings.music, now);
    this.#events?.gain.setValueAtTime(settings.muteEventCues ? 0 : settings.events, now);
    this.#ui?.gain.setValueAtTime(settings.ui, now);
  }

  async initialiseFromUserGesture(): Promise<void> {
    if (this.#disposed || this.#playbackState === "unavailable") return;
    // Claim the media session inside the gesture and before the context exists,
    // so the very first context is created under the playback category rather
    // than being reclassified afterwards.
    this.#environment.requestMediaPlaybackSession?.();
    if (this.#playing !== undefined && this.#context?.state !== "closed") {
      await this.recoverPlayback();
      this.#scheduleEndgamePrefetch();
      this.#environment.requestIdle(() => {
        void this.#preloadEncodedCues();
      });
      return;
    }
    if (this.#context === undefined) this.#createGraph();
    const context = this.#context;
    if (context === undefined) return;
    this.#setPlaybackState("loading");
    try {
      await this.#startPlaybackWithDeadline(context, this.#pausedOffset, true);
      this.#scheduleEndgamePrefetch();
      this.#environment.requestIdle(() => {
        void this.#preloadEncodedCues();
      });
    } catch {
      this.#playbackStartToken += 1;
      this.#musicRequestToken += 1;
      this.#schedulePlaybackRecovery();
    }
  }

  async recoverPlayback(): Promise<void> {
    if (this.#disposed || !this.#settings.playbackEnabled) return;
    // Reassert on recovery too: iOS can reset the category when the page is
    // backgrounded or an interruption ends, and recovery is where playback
    // resumes afterwards.
    this.#environment.requestMediaPlaybackSession?.();
    if (this.#context === undefined) this.#createGraph();
    const context = this.#context;
    if (context === undefined || context.state === "closed") return;

    const needsTrack = this.#selectedTrackId !== undefined && this.#playing === undefined;
    if (context.state === "running" && !needsTrack) {
      this.#clearRecoveryTimer();
      this.#setPlaybackState("playing");
      return;
    }

    this.#clearRecoveryTimer();
    this.#setPlaybackState("loading");
    try {
      await context.resume();
      if (this.#disposed || !this.#settings.playbackEnabled) return;
      if (this.#selectedTrackId !== undefined && this.#playing === undefined) {
        await this.#startDesiredTrack(this.#pausedOffset, false);
      } else {
        this.#setPlaybackState("playing");
      }
      this.#clearRecoveryTimer();
    } catch {
      this.#schedulePlaybackRecovery();
    }
  }

  setMusicState(state: MusicState): void {
    const previous = this.#musicState;
    const stateChanged = musicStateKey(previous) !== musicStateKey(state);
    if (stateChanged) {
      this.#manualPlaylistOverride = false;
    }
    this.#musicState = state;
    this.#selectedTrackId = this.#trackForCurrentState();
    this.#scheduleEndgamePrefetch();
    this.#notifyListeners();
    if (this.#context === undefined || this.#playbackState !== "playing") return;
    const desired = this.#selectedTrackId;
    if (desired === this.#playing?.trackId) {
      this.#musicRequestToken += 1;
      return;
    }
    if (
      state.kind === "laboratory" &&
      previous.kind === "laboratory" &&
      this.#context.currentTime - this.#musicStartedAt < 90
    ) {
      if (stateChanged) this.#musicRequestToken += 1;
      return;
    }
    if (desired === undefined) {
      this.#musicRequestToken += 1;
      this.#stopMusic(0.8);
      return;
    }
    this.#requestDesiredTrack(0, isImmediateTransition(state));
  }

  /**
   * Major visible good news may steer the current laboratory track — GPUs
   * arriving requests the delivery-day track, a completed training run
   * requests the convergence track, and so on. Guarded so it can never make
   * the score twitchy: laboratory states only, the suggestion must belong to
   * the current focus's pool (so safety's reflective mood is never hijacked),
   * and at most one accepted suggestion per 90 seconds.
   */
  suggestLaboratoryTrack(trackId: MusicTrackId): void {
    if (this.#musicState.kind !== "laboratory") return;
    const focus = this.#musicState.focus;
    if (!LAB_POOLS[focus].includes(trackId)) return;
    const now = this.#context?.currentTime ?? 0;
    if (this.#lastSuggestionAt !== undefined && now - this.#lastSuggestionAt < 90) {
      return;
    }
    if (this.#playing?.trackId === trackId) return;
    this.#lastSuggestionAt = now;
    this.#laboratorySelection[focus] = trackId;
    const bag = this.#laboratoryShuffleBag[focus];
    if (bag !== undefined) {
      this.#laboratoryShuffleBag[focus] = bag.filter((track) => track !== trackId);
    }
    this.#manualLaboratoryShuffleBag = this.#manualLaboratoryShuffleBag.filter(
      (track) => track !== trackId,
    );
    this.#selectedTrackId = this.#trackForCurrentState();
    this.#notifyListeners();
    if (this.#context === undefined || this.#playbackState !== "playing") return;
    this.#requestDesiredTrack(0, false);
  }

  /**
   * NEXT works on the rotating playlists -- the laboratory pools, and a
   * crisis track the player has tired of. The endgame and the endings are
   * authored sequences: once the endgame begins, only its stage music plays,
   * so NEXT does nothing there and the control renders disabled.
   */
  canSkipTrack(): boolean {
    const kind = this.#musicState.kind;
    return kind === "laboratory" || kind === "crisis" || kind === "title";
  }

  skipMusic(): void {
    if (!this.canSkipTrack()) return;
    // The override survives routine re-renders of the same state, but a
    // genuinely new crisis/stage/ending gets its authored track as usual.
    this.#manualPlaylistOverride = true;
    this.#advanceManualLaboratoryPlaylist();
    this.#pausedOffset = 0;
    this.#notifyListeners();
    if (this.#context !== undefined && this.#playbackState === "playing") {
      this.#requestDesiredTrack(0, false);
    }
  }

  playCue(cueId: AudioCueId, occurrenceKey: string = cueId): void {
    if (
      this.#context === undefined ||
      this.#playbackState !== "playing" ||
      this.#settings.muteEventCues ||
      this.#seenOccurrences.has(occurrenceKey)
    ) {
      return;
    }
    const definition = CUE_ASSETS[cueId];
    const now = this.#context.currentTime;
    if ((this.#cooldowns.get(cueId) ?? Number.NEGATIVE_INFINITY) > now) return;
    if (
      this.#activeCue !== undefined &&
      (this.#activeCue.priority > definition.priority ||
        (this.#activeCue.priority === definition.priority && !definition.terminal))
    ) {
      return;
    }

    this.#seenOccurrences.add(occurrenceKey);
    this.#cooldowns.set(cueId, now + definition.cooldownSeconds);
    this.#stopCue();
    const token = ++this.#cueRequestToken;
    this.#activeCue = { cueId, priority: definition.priority, token };
    this.#duckMusic(definition.priority >= 75 ? -4 : -3);
    void this.#loadBuffer(definition.url)
      .then((buffer) => {
        if (
          this.#context === undefined ||
          this.#activeCue?.token !== token ||
          this.#playbackState !== "playing"
        ) {
          return;
        }
        const source = this.#context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.#events!);
        source.addEventListener("ended", () => {
          if (this.#activeCue?.token !== token) return;
          this.#activeCue = undefined;
          this.#restoreMusicDuck();
        });
        this.#activeCue.source = source;
        source.start();
      })
      .catch(() => {
        if (this.#activeCue?.token === token) {
          this.#activeCue = undefined;
          this.#restoreMusicDuck();
        }
      });
  }

  suspend(): void {
    if (this.#context === undefined || this.#playbackState === "paused") return;
    this.#settings = { ...this.#settings, playbackEnabled: false };
    const now = this.#context.currentTime;
    this.#master?.gain.cancelScheduledValues(now);
    this.#master?.gain.setValueAtTime(this.#master.gain.value, now);
    this.#master?.gain.linearRampToValueAtTime(0, now + 0.15);
    this.#preserveOffsetAndStopMusic();
    this.#stopCue();
    this.#setPlaybackState("paused");
    this.#suspendTimer = this.#environment.setTimer(() => {
      void this.#context?.suspend();
      this.#suspendTimer = undefined;
    }, 160);
  }

  async resumeFromUserGesture(): Promise<void> {
    if (this.#disposed || this.#playbackState === "unavailable") return;
    if (this.#context === undefined) this.#createGraph();
    const context = this.#context;
    if (context === undefined) return;
    if (this.#suspendTimer !== undefined) {
      this.#environment.clearTimer(this.#suspendTimer);
      this.#suspendTimer = undefined;
    }
    this.#settings = { ...this.#settings, playbackEnabled: true };
    this.#setPlaybackState("loading");
    try {
      await this.#startPlaybackWithDeadline(context, this.#pausedOffset, true);
      const now = context.currentTime;
      this.#master?.gain.cancelScheduledValues(now);
      this.#master?.gain.setValueAtTime(0, now);
      this.#master?.gain.linearRampToValueAtTime(1, now + 0.25);
      this.#environment.requestIdle(() => {
        void this.#preloadEncodedCues();
      });
    } catch {
      this.#playbackStartToken += 1;
      this.#musicRequestToken += 1;
      this.#schedulePlaybackRecovery();
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#playbackStartToken += 1;
    this.#musicRequestToken += 1;
    this.#cueRequestToken += 1;
    this.#endgamePrefetchToken += 1;
    this.#settings = { ...this.#settings, playbackEnabled: false };
    if (this.#suspendTimer !== undefined)
      this.#environment.clearTimer(this.#suspendTimer);
    this.#clearRecoveryTimer();
    this.#stopCue();
    this.#stopMusic(0);
    if (this.#context !== undefined) this.#context.onstatechange = null;
    void this.#context?.close();
    this.#listeners.clear();
    this.#encoded.clear();
    this.#decoded.clear();
  }

  #createGraph(): void {
    try {
      const context = this.#environment.createContext();
      const master = context.createGain();
      const music = context.createGain();
      const duck = context.createGain();
      const events = context.createGain();
      const ui = context.createGain();
      music.connect(duck);
      duck.connect(master);
      events.connect(master);
      ui.connect(master);
      master.connect(context.destination);
      this.#context = context;
      this.#master = master;
      this.#music = music;
      this.#duck = duck;
      this.#events = events;
      this.#ui = ui;
      context.onstatechange = () => {
        if (this.#disposed || !this.#settings.playbackEnabled) return;
        if (context.state === "running") {
          if (this.#selectedTrackId === undefined || this.#playing !== undefined) {
            this.#clearRecoveryTimer();
            this.#setPlaybackState("playing");
          }
          return;
        }
        if (context.state !== "closed") this.#schedulePlaybackRecovery();
      };
      this.setVolumes(this.#settings);
    } catch {
      this.#setPlaybackState("unavailable");
    }
  }

  async #startPlaybackWithDeadline(
    context: AudioContext,
    offset: number,
    immediate: boolean,
  ): Promise<void> {
    const token = ++this.#playbackStartToken;
    let timeout: number | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = this.#environment.setTimer(() => {
        reject(new Error("Audio playback did not initialise in time"));
      }, PLAYBACK_START_TIMEOUT_MILLISECONDS);
    });
    const start = (async (): Promise<void> => {
      await context.resume();
      if (token !== this.#playbackStartToken || this.#disposed) return;
      if (!this.#settings.playbackEnabled) {
        this.#setPlaybackState("paused");
        return;
      }
      await this.#startDesiredTrack(offset, immediate);
    })();
    try {
      await Promise.race([start, deadline]);
    } finally {
      if (timeout !== undefined) this.#environment.clearTimer(timeout);
    }
  }

  async #startDesiredTrack(offset: number, immediate: boolean): Promise<void> {
    const context = this.#context;
    const desired = this.#selectedTrackId;
    if (context === undefined || desired === undefined) {
      this.#stopMusic(immediate ? 0.15 : 0.8);
      this.#setPlaybackState(this.#settings.playbackEnabled ? "playing" : "paused");
      return;
    }
    const requestToken = ++this.#musicRequestToken;
    const definition = MUSIC_ASSETS[desired];
    let buffer: AudioBuffer;
    try {
      buffer = await this.#loadBuffer(definition.url);
    } catch (error) {
      if (
        requestToken !== this.#musicRequestToken ||
        this.#context !== context ||
        !this.#settings.playbackEnabled
      ) {
        return;
      }
      if (this.#selectedTrackId !== desired) {
        this.#requestDesiredTrack(0, isImmediateTransition(this.#musicState));
        return;
      }
      throw error;
    }
    if (
      requestToken !== this.#musicRequestToken ||
      this.#context !== context ||
      !this.#settings.playbackEnabled
    ) {
      return;
    }
    if (this.#selectedTrackId !== desired) {
      this.#requestDesiredTrack(0, isImmediateTransition(this.#musicState));
      return;
    }
    const transitionSeconds = this.#playing === undefined ? 0.25 : immediate ? 0.15 : 0.8;
    this.#stopMusic(transitionSeconds);
    const source = context.createBufferSource();
    const trackGain = context.createGain();
    source.buffer = buffer;
    source.loop =
      definition.loop &&
      this.#musicState.kind !== "laboratory" &&
      !this.#manualPlaylistOverride;
    source.connect(trackGain);
    trackGain.connect(this.#music!);
    const safeDuration = Math.max(buffer.duration, definition.durationSeconds, 0.001);
    const safeOffset = definition.loop
      ? ((offset % safeDuration) + safeDuration) % safeDuration
      : Math.min(Math.max(offset, 0), Math.max(0, safeDuration - 0.001));
    source.addEventListener("ended", () => {
      if (this.#playing?.source !== source) return;
      this.#playing = undefined;
      this.#pausedOffset = 0;
      if (
        !this.#manualPlaylistOverride &&
        !definition.loop &&
        this.#musicState.kind === "extinction"
      ) {
        return;
      }
      if (this.#manualPlaylistOverride) {
        this.#advanceManualLaboratoryPlaylist(definition.id);
      } else if (this.#musicState.kind === "laboratory") {
        this.#advanceLaboratoryPlaylist(definition.id);
      }
      this.#requestDesiredTrack(0, false);
    });
    trackGain.gain.setValueAtTime(0, context.currentTime);
    trackGain.gain.linearRampToValueAtTime(1, context.currentTime + transitionSeconds);
    source.start(0, safeOffset);
    this.#playing = {
      source,
      gain: trackGain,
      trackId: desired,
      startedAt: context.currentTime,
      offsetAtStart: safeOffset,
    };
    this.#musicStartedAt = context.currentTime;
    this.#pausedOffset = safeOffset;
    this.#clearRecoveryTimer();
    this.#setPlaybackState("playing");
    this.#notifyListeners();
  }

  #requestDesiredTrack(offset: number, immediate: boolean): void {
    void this.#startDesiredTrack(offset, immediate).catch(() => {
      this.#schedulePlaybackRecovery();
    });
  }

  #schedulePlaybackRecovery(
    delayMilliseconds = PLAYBACK_RECOVERY_DELAY_MILLISECONDS,
  ): void {
    if (
      this.#disposed ||
      !this.#settings.playbackEnabled ||
      this.#recoveryTimer !== undefined
    ) {
      return;
    }
    this.#setPlaybackState("loading");
    this.#recoveryTimer = this.#environment.setTimer(() => {
      this.#recoveryTimer = undefined;
      void this.recoverPlayback();
    }, delayMilliseconds);
  }

  #clearRecoveryTimer(): void {
    if (this.#recoveryTimer === undefined) return;
    this.#environment.clearTimer(this.#recoveryTimer);
    this.#recoveryTimer = undefined;
  }

  #trackForCurrentState(): MusicTrackId | undefined {
    if (this.#manualPlaylistOverride) return this.#selectedTrackId;
    if (this.#musicState.kind !== "laboratory") return trackForState(this.#musicState);
    const focus = this.#musicState.focus;
    // A focus opens on its signature track; afterwards the shuffle bag owns it.
    this.#laboratorySelection[focus] ??= LAB_POOLS[focus][0] as MusicTrackId;
    return this.#laboratorySelection[focus];
  }

  #shuffled(pool: readonly MusicTrackId[]): MusicTrackId[] {
    const random = this.#environment.random ?? Math.random;
    const bag = [...pool];
    for (let index = bag.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      const held = bag[index] as MusicTrackId;
      bag[index] = bag[swap] as MusicTrackId;
      bag[swap] = held;
    }
    return bag;
  }

  #advanceLaboratoryPlaylist(
    currentTrackId: MusicTrackId | undefined = this.#selectedTrackId,
  ): void {
    if (this.#musicState.kind !== "laboratory") return;
    const focus = this.#musicState.focus;
    const pool = LAB_POOLS[focus];
    let bag = this.#laboratoryShuffleBag[focus] ?? [];
    if (bag.length === 0) {
      // A fresh bag covers the whole pool except the track that just played,
      // so nothing repeats until everything else has had a turn.
      bag = this.#shuffled(pool.filter((track) => track !== currentTrackId));
    }
    const next = bag.shift() ?? pool[0];
    this.#laboratoryShuffleBag[focus] = bag;
    // Shipped pools are never empty; the guard keeps the type honest rather
    // than inventing a fallback track the content does not define.
    if (next === undefined) return;
    this.#laboratorySelection[focus] = next;
    this.#selectedTrackId = this.#trackForCurrentState();
  }

  #advanceManualLaboratoryPlaylist(
    currentTrackId: MusicTrackId | undefined = this.#selectedTrackId,
  ): void {
    let bag = this.#manualLaboratoryShuffleBag.filter(
      (track) => track !== currentTrackId,
    );
    if (bag.length === 0) {
      bag = this.#shuffled(LABORATORY_TRACKS.filter((track) => track !== currentTrackId));
    }
    const fallback = LABORATORY_TRACKS.find((track) => track !== currentTrackId);
    if (fallback === undefined) return;
    const next = bag.shift() ?? fallback;
    this.#manualLaboratoryShuffleBag = bag;
    if (this.#musicState.kind === "laboratory") {
      this.#laboratorySelection[this.#musicState.focus] = next;
    }
    this.#selectedTrackId = next;
  }

  #preserveOffsetAndStopMusic(): void {
    const context = this.#context;
    const playing = this.#playing;
    if (context !== undefined && playing !== undefined) {
      const definition = MUSIC_ASSETS[playing.trackId];
      const elapsed = Math.max(0, context.currentTime - playing.startedAt);
      const duration = Math.max(
        playing.source.buffer?.duration ?? 0,
        definition.durationSeconds,
        0.001,
      );
      this.#pausedOffset = definition.loop
        ? (playing.offsetAtStart + elapsed) % duration
        : Math.min(playing.offsetAtStart + elapsed, duration);
    }
    this.#stopMusic(0);
  }

  #stopMusic(fadeSeconds: number): void {
    const playing = this.#playing;
    if (playing === undefined) return;
    this.#playing = undefined;
    try {
      const now = this.#context?.currentTime ?? 0;
      playing.gain.gain.cancelScheduledValues(now);
      playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
      playing.gain.gain.linearRampToValueAtTime(0, now + fadeSeconds);
      playing.source.stop((this.#context?.currentTime ?? 0) + fadeSeconds);
    } catch {
      // A source can already have naturally ended.
    }
  }

  #stopCue(): void {
    this.#cueRequestToken += 1;
    const cue = this.#activeCue;
    this.#activeCue = undefined;
    try {
      cue?.source?.stop();
    } catch {
      // A source can already have naturally ended.
    }
    this.#restoreMusicDuck();
  }

  #duckMusic(decibels: -3 | -4): void {
    if (this.#context === undefined || this.#duck === undefined) return;
    const now = this.#context.currentTime;
    this.#duck.gain.cancelScheduledValues(now);
    this.#duck.gain.setValueAtTime(this.#duck.gain.value, now);
    this.#duck.gain.linearRampToValueAtTime(10 ** (decibels / 20), now + 0.25);
  }

  #restoreMusicDuck(): void {
    if (this.#context === undefined || this.#duck === undefined) return;
    const now = this.#context.currentTime;
    this.#duck.gain.cancelScheduledValues(now);
    this.#duck.gain.setValueAtTime(this.#duck.gain.value, now);
    this.#duck.gain.linearRampToValueAtTime(1, now + 0.8);
  }

  #scheduleEndgamePrefetch(): void {
    if (this.#musicState.kind !== "endgame") {
      this.#lastPrefetchedEndgameChapter = undefined;
      this.#endgamePrefetchToken += 1;
      return;
    }
    if (this.#context === undefined) return;
    const chapter = this.#musicState.chapter;
    if (chapter === this.#lastPrefetchedEndgameChapter) return;
    this.#lastPrefetchedEndgameChapter = chapter;
    const token = ++this.#endgamePrefetchToken;
    this.#environment.requestIdle(() => {
      if (
        this.#disposed ||
        token !== this.#endgamePrefetchToken ||
        this.#musicState.kind !== "endgame" ||
        this.#musicState.chapter !== chapter
      ) {
        return;
      }
      void this.#prefetchEndgameBranch(chapter);
    });
  }

  async #prefetchEndgameBranch(chapter: EndgameMusicChapter): Promise<void> {
    for (const trackId of endgamePrefetchTracksForChapter(chapter)) {
      if (this.#disposed || this.#context === undefined) return;
      try {
        await this.#loadBuffer(MUSIC_ASSETS[trackId].url);
      } catch {
        // Prefetching is advisory; a chapter change retries on demand.
      }
    }
  }

  async #loadBuffer(url: string): Promise<AudioBuffer> {
    const cached = this.#decoded.get(url);
    if (cached !== undefined) {
      this.#decodedUse.set(url, this.#context?.currentTime ?? 0);
      return cached;
    }
    const context = this.#context;
    if (context === undefined) throw new Error("Audio context not initialised");
    const encoded = await this.#loadEncoded(url);
    const decoded = await context.decodeAudioData(encoded.slice(0));
    this.#decoded.set(url, decoded);
    this.#decodedUse.set(url, context.currentTime);
    this.#evictDecoded(url);
    return decoded;
  }

  async #loadEncoded(url: string): Promise<ArrayBuffer> {
    const cached = this.#encoded.get(url);
    if (cached !== undefined) return cached;
    const encoded = await this.#environment.fetchArrayBuffer(url);
    this.#encoded.set(url, encoded);
    return encoded;
  }

  async #preloadEncodedCues(): Promise<void> {
    for (const definition of Object.values(CUE_ASSETS)) {
      if (this.#disposed || this.#context === undefined) return;
      try {
        await this.#loadEncoded(definition.url);
      } catch {
        // An individual missing cue must not disable music or gameplay.
      }
    }
  }

  #evictDecoded(protectedUrl: string): void {
    if (this.#decoded.size <= DECODED_TRACK_CACHE_LIMIT) return;
    const removable = [...this.#decodedUse.entries()]
      .filter(
        ([url]) =>
          url !== protectedUrl &&
          url !==
            (this.#playing === undefined
              ? undefined
              : MUSIC_ASSETS[this.#playing.trackId].url),
      )
      .sort((left, right) => left[1] - right[1])[0]?.[0];
    if (removable !== undefined) {
      this.#decoded.delete(removable);
      this.#decodedUse.delete(removable);
    }
  }

  #setPlaybackState(state: AudioPlaybackState): void {
    if (state === this.#playbackState) return;
    this.#playbackState = state;
    this.#notifyListeners();
  }

  #notifyListeners(): void {
    for (const listener of this.#listeners) listener(this.#playbackState);
  }
}

export { endgamePrefetchTracksForChapter, trackForState };
