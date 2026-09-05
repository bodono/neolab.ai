import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUDIO_SETTINGS,
  MemoryAudioSettingsRepository,
  normaliseAudioSettings,
} from "../audio-settings.ts";

describe("audio settings", () => {
  it("normalises malformed settings without consulting a game save", () => {
    expect(
      normaliseAudioSettings({
        music: 4,
        events: -1,
        ui: Number.NaN,
        muteEventCues: true,
        playbackEnabled: true,
      }),
    ).toEqual({
      music: 1,
      events: 0,
      ui: DEFAULT_AUDIO_SETTINGS.ui,
      muteEventCues: true,
      playbackEnabled: true,
    });
  });

  it("round-trips through its independent repository", () => {
    const repository = new MemoryAudioSettingsRepository();
    repository.save({
      music: 0.2,
      events: 0.3,
      ui: 0.4,
      muteEventCues: true,
      playbackEnabled: true,
    });
    expect(repository.load()).toEqual({
      music: 0.2,
      events: 0.3,
      ui: 0.4,
      muteEventCues: true,
      playbackEnabled: true,
    });
  });
});
