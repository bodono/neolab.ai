import type { VolumeSettings } from "./audio-types.ts";

export const DEFAULT_AUDIO_SETTINGS: VolumeSettings = Object.freeze({
  music: 0.65,
  events: 0.7,
  ui: 0.7,
  muteEventCues: false,
  playbackEnabled: false,
});

export interface AudioSettingsRepository {
  load(): VolumeSettings;
  save(settings: VolumeSettings): void;
}

function clampVolume(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;
}

export function normaliseAudioSettings(value: unknown): VolumeSettings {
  if (typeof value !== "object" || value === null) return DEFAULT_AUDIO_SETTINGS;
  const candidate = value as Partial<VolumeSettings>;
  return Object.freeze({
    music: clampVolume(candidate.music, DEFAULT_AUDIO_SETTINGS.music),
    events: clampVolume(candidate.events, DEFAULT_AUDIO_SETTINGS.events),
    ui: clampVolume(candidate.ui, DEFAULT_AUDIO_SETTINGS.ui),
    muteEventCues:
      typeof candidate.muteEventCues === "boolean"
        ? candidate.muteEventCues
        : DEFAULT_AUDIO_SETTINGS.muteEventCues,
    playbackEnabled:
      typeof candidate.playbackEnabled === "boolean"
        ? candidate.playbackEnabled
        : DEFAULT_AUDIO_SETTINGS.playbackEnabled,
  });
}

export class LocalStorageAudioSettingsRepository implements AudioSettingsRepository {
  static readonly storageKey = "neolab.ai.audio-settings.v1";

  load(): VolumeSettings {
    try {
      const stored = globalThis.localStorage?.getItem(
        LocalStorageAudioSettingsRepository.storageKey,
      );
      return stored === null || stored === undefined
        ? DEFAULT_AUDIO_SETTINGS
        : normaliseAudioSettings(JSON.parse(stored) as unknown);
    } catch {
      return DEFAULT_AUDIO_SETTINGS;
    }
  }

  save(settings: VolumeSettings): void {
    try {
      globalThis.localStorage?.setItem(
        LocalStorageAudioSettingsRepository.storageKey,
        JSON.stringify(normaliseAudioSettings(settings)),
      );
    } catch {
      // Audio preferences are non-critical. A storage-denied browser remains playable.
    }
  }
}

export class MemoryAudioSettingsRepository implements AudioSettingsRepository {
  #settings: VolumeSettings;

  constructor(initial: VolumeSettings = DEFAULT_AUDIO_SETTINGS) {
    this.#settings = normaliseAudioSettings(initial);
  }

  load(): VolumeSettings {
    return this.#settings;
  }

  save(settings: VolumeSettings): void {
    this.#settings = normaliseAudioSettings(settings);
  }
}
