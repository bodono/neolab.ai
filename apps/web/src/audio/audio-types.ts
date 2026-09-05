export const MUSIC_TRACK_IDS = [
  "hello-world-model",
  "gradients-flowing",
  "safety-case-draft-47",
  "red-team-found-something",
  "broadly-shared-future",
  "cashflow-positive",
  "peer-reviewer-two",
  "nothing-left-to-read",
  "overnight-run",
  "gpus-arrive-tuesday",
  "tests-pass-first-try",
  "new-hire-orientation",
  "demo-worked-twice",
  "budget-approved",
  "converged-before-lunch",
  "a-qualified-success",
  "exit-interview",
  "loss-of-signal",
  "the-graph-goes-vertical",
  "hands-off-the-weights",
  "every-phone-at-once",
  "go-no-go",
  "ship-it",
  "adrenaline-half-life",
  "ghost-in-the-cluster",
  "the-machine-moves-first",
  "the-window-is-closing",
] as const;

export const AUDIO_CUE_IDS = [
  "paper-discovered",
  "major-breakthrough",
  "capability-tier",
  "safety-win",
  "fundraising-complete",
  "researcher-joins",
  "researcher-departs",
  "rival-breakthrough",
  "regulatory-attention",
  "crisis-opened",
  "containment-warning",
  "coalition-proposed",
  "coalition-formed",
  "endgame-begins",
  "race-won",
  "race-lost",
  "nationalised",
  "bankruptcy",
  "containment-failure",
  "score-milestone",
] as const;

export type MusicTrackId = (typeof MUSIC_TRACK_IDS)[number];
export type AudioCueId = (typeof AUDIO_CUE_IDS)[number];
export type AudioPlaybackState =
  "uninitialised" | "loading" | "playing" | "paused" | "unavailable";

export interface VolumeSettings {
  readonly music: number;
  readonly events: number;
  readonly ui: number;
  readonly muteEventCues: boolean;
  readonly playbackEnabled: boolean;
}

/**
 * Player-visible musical chapters for the endgame presentation.
 *
 * This deliberately does not mirror the simulation's crisis-stage union. A
 * mechanical stage may contain several short substates without restarting the
 * score, and several stages may share one musical chapter. Chapter selection is
 * derived only from player-visible state in audio-presentation.ts.
 */
export type EndgameMusicChapter =
  | "candidacy"
  | "capability-proof"
  | "dossier-review"
  | "diagnosis"
  | "safety-work"
  | "deployment-planning"
  | "pressure"
  | "controlled-rollout"
  | "final-review"
  | "deployment-held"
  | "retirement-held"
  | "observed-resistance"
  | "containment-failure"
  | "local-recovery"
  | "moratorium";

export type LaboratoryMusicFocus = "general" | "commercial" | "research" | "safety";
export type AudioNoticeTone = "positive" | "information" | "warning" | "critical";
export type AudioNoticeDestination =
  | "agi"
  | "bonuses"
  | "compute"
  | "crisis"
  | "evaluations"
  | "facilities"
  | "finances"
  | "models"
  | "overview"
  | "people"
  | "research"
  | "world";

export type MusicState =
  | { readonly kind: "title" }
  | { readonly kind: "laboratory"; readonly focus: LaboratoryMusicFocus }
  | {
      readonly kind: "crisis";
      readonly crisisId: string;
      /**
       * Machine-flavoured crises -- autonomy incidents and anomaly clusters,
       * where the model itself is the problem -- sound like the machine;
       * institutional crises keep the red-team track.
       */
      readonly flavour: "machine" | "institutional";
    }
  | { readonly kind: "endgame"; readonly chapter: EndgameMusicChapter }
  | {
      readonly kind: "victory";
      readonly tier: "full" | "qualified";
    }
  | { readonly kind: "extinction" }
  /** Non-catastrophic losses: the lab is finished, the world is fine. */
  | { readonly kind: "ending-defeat" }
  /** Catastrophic non-extinction losses: control is gone, the world continues. */
  | { readonly kind: "ending-catastrophe" };

export interface CueRequest {
  readonly cueId: AudioCueId;
  /** Stable visible occurrence identity; prevents duplicate presentation playback. */
  readonly occurrenceKey: string;
  /**
   * Player-facing copy rendered before the cue is allowed to play. Event audio must
   * never communicate game state without an equivalent visible explanation.
   */
  readonly notice: {
    readonly title: string;
    readonly detail: string;
    readonly tone: AudioNoticeTone;
    readonly externalLink?: {
      readonly href: string;
      readonly label: string;
    };
    readonly internalAction?: {
      readonly destination: AudioNoticeDestination;
      readonly label: string;
    };
  };
}

export interface AudioManager {
  initialiseFromUserGesture(): Promise<void>;
  /**
   * Repairs a browser-suspended context or a failed track transition without
   * restarting healthy playback. Safe to call after any ordinary user gesture.
   */
  recoverPlayback(): Promise<void>;
  setVolumes(settings: VolumeSettings): void;
  playCue(cue: AudioCueId, occurrenceKey?: string): void;
  setMusicState(state: MusicState): void;
  skipMusic(): void;
  /** False while an authored sequence (endgame stage or ending) owns the music. */
  canSkipTrack(): boolean;
  /** Advisory: major visible good news steering the laboratory track. */
  suggestLaboratoryTrack(trackId: MusicTrackId): void;
  suspend(): void;
  resumeFromUserGesture(): Promise<void>;
  getPlaybackState(): AudioPlaybackState;
  getCurrentTrackId(): MusicTrackId | undefined;
  subscribe(listener: (state: AudioPlaybackState) => void): () => void;
  dispose(): void;
}
