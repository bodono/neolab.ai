import { describe, expect, it } from "vitest";

import { applyMediaPlaybackSession } from "../web-audio-manager.ts";

describe("applyMediaPlaybackSession", () => {
  it("declares playback so the ring switch stops muting the soundtrack", () => {
    const navigator = { audioSession: { type: "auto" } };
    expect(applyMediaPlaybackSession(navigator)).toBe(true);
    expect(navigator.audioSession.type).toBe("playback");
  });

  it("reports no capability where audioSession is unimplemented", () => {
    // Everything except Safari 16.4+, including every engine CI runs.
    expect(applyMediaPlaybackSession({})).toBe(false);
    expect(applyMediaPlaybackSession(undefined)).toBe(false);
  });

  it("overrides a category another caller already chose", () => {
    const navigator = { audioSession: { type: "ambient" } };
    expect(applyMediaPlaybackSession(navigator)).toBe(true);
    expect(navigator.audioSession.type).toBe("playback");
  });
});
