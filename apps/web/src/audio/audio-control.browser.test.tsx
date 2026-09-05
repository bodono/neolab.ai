import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audio = vi.hoisted(() => ({
  skipTrack: vi.fn(),
}));

vi.mock("./audio-provider.tsx", () => ({
  useAudio: () => ({
    playbackState: "loading",
    currentTrackId: "gradients-flowing",
    canSkip: true,
    settings: {
      music: 0.65,
      events: 0.7,
      ui: 0.7,
      muteEventCues: false,
      playbackEnabled: true,
    },
    togglePlayback: vi.fn(),
    skipTrack: audio.skipTrack,
    updateSettings: vi.fn(),
  }),
}));

import { AudioControl } from "./audio-control.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("AudioControl", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.append(mount);
    root = createRoot(mount);
    audio.skipTrack.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    mount.remove();
  });

  it("allows a selected playlist track to be skipped while audio is loading", () => {
    act(() => root.render(<AudioControl />));

    const next = mount.querySelector<HTMLButtonElement>(
      "button[aria-label='Next soundtrack track']",
    );
    expect(next).not.toBeNull();
    expect(next!.disabled).toBe(false);

    act(() => next!.click());
    expect(audio.skipTrack).toHaveBeenCalledOnce();
  });
});
