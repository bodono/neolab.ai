import { describe, expect, it } from "vitest";

import { CUE_ASSETS, MUSIC_ASSETS } from "../audio-catalogue.ts";
import type { VolumeSettings } from "../audio-types.ts";
import {
  WebAudioManager,
  endgamePrefetchTracksForChapter,
  trackForState,
  type WebAudioEnvironment,
} from "../web-audio-manager.ts";

class FakeAudioParam {
  value = 1;
  readonly ramps: number[] = [];

  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void {
    this.value = value;
  }
  linearRampToValueAtTime(value: number): void {
    this.value = value;
    this.ramps.push(value);
  }
}

class FakeGain {
  readonly gain = new FakeAudioParam();
  connect(): void {}
}

class FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  readonly starts: number[] = [];
  readonly stops: number[] = [];
  #ended: (() => void) | undefined;

  connect(): void {}
  start(_when = 0, offset = 0): void {
    this.starts.push(offset);
  }
  stop(when = 0): void {
    this.stops.push(when);
  }
  addEventListener(type: string, listener: () => void): void {
    if (type === "ended") this.#ended = listener;
  }
  finish(): void {
    this.#ended?.();
  }
}

class FakeAudioContext {
  currentTime = 0;
  state: AudioContextState = "suspended";
  onstatechange: ((this: BaseAudioContext, ev: Event) => unknown) | null = null;
  readonly destination = {};
  readonly sources: FakeSource[] = [];
  resumeCount = 0;
  suspendCount = 0;
  resumeResult: Promise<void> = Promise.resolve();

  createGain(): GainNode {
    return new FakeGain() as unknown as GainNode;
  }
  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }
  decodeAudioData(): Promise<AudioBuffer> {
    return Promise.resolve({ duration: 200 } as AudioBuffer);
  }
  resume(): Promise<void> {
    this.resumeCount += 1;
    return this.resumeResult.then(() => {
      if (this.state === "running") return;
      this.state = "running";
      this.onstatechange?.call(this as unknown as BaseAudioContext, {} as Event);
    });
  }
  suspend(): Promise<void> {
    this.suspendCount += 1;
    this.state = "suspended";
    this.onstatechange?.call(this as unknown as BaseAudioContext, {} as Event);
    return Promise.resolve();
  }
  close(): Promise<void> {
    this.state = "closed";
    return Promise.resolve();
  }

  interrupt(): void {
    this.state = "suspended";
    this.onstatechange?.call(this as unknown as BaseAudioContext, {} as Event);
  }
}

const enabled: VolumeSettings = {
  music: 0.65,
  events: 0.7,
  ui: 0.7,
  muteEventCues: false,
  playbackEnabled: true,
};

function fixture(random?: () => number): {
  readonly manager: WebAudioManager;
  readonly context: FakeAudioContext;
  readonly fetched: string[];
  readonly fireLastTimer: () => void;
} {
  const context = new FakeAudioContext();
  const fetched: string[] = [];
  const timers: ((() => void) | undefined)[] = [];
  const environment: WebAudioEnvironment = {
    createContext: () => context as unknown as AudioContext,
    ...(random === undefined ? {} : { random }),
    fetchArrayBuffer: (url) => {
      fetched.push(url);
      return Promise.resolve(new ArrayBuffer(4));
    },
    setTimer: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimer: (timer) => {
      timers[timer - 1] = undefined;
    },
    requestIdle: () => undefined,
  };
  return {
    manager: new WebAudioManager(environment),
    context,
    fetched,
    fireLastTimer: () => {
      const timer = timers.findLast((candidate) => candidate !== undefined);
      if (timer === undefined) throw new Error("Expected an active timer");
      timer();
    },
  };
}

describe("WebAudioManager", () => {
  it("does not create or fetch audio until a user gesture", async () => {
    const { manager, context, fetched } = fixture();
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "title" });
    expect(fetched).toEqual([]);
    expect(context.resumeCount).toBe(0);

    await manager.initialiseFromUserGesture();
    expect(context.resumeCount).toBe(1);
    expect(fetched).toEqual([MUSIC_ASSETS["hello-world-model"].url]);
    expect(manager.getPlaybackState()).toBe("playing");
  });

  it("does not restart healthy title music when entering leader selection", async () => {
    const { manager, context } = fixture();
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "title" });
    await manager.initialiseFromUserGesture();
    const originalSource = context.sources[0];
    context.currentTime = 37;

    await manager.initialiseFromUserGesture();

    expect(context.sources).toEqual([originalSource]);
    expect(originalSource?.stops).toEqual([]);
    expect(manager.getCurrentTrackId()).toBe("hello-world-model");
  });

  it("does not let a stale track load replace the track the player returned to", async () => {
    const context = new FakeAudioContext();
    let resolveCrisisTrack: ((buffer: ArrayBuffer) => void) | undefined;
    const crisisTrack = new Promise<ArrayBuffer>((resolve) => {
      resolveCrisisTrack = resolve;
    });
    const environment: WebAudioEnvironment = {
      createContext: () => context as unknown as AudioContext,
      fetchArrayBuffer: (url) =>
        url === MUSIC_ASSETS["red-team-found-something"].url
          ? crisisTrack
          : Promise.resolve(new ArrayBuffer(4)),
      setTimer: () => 1,
      clearTimer: () => undefined,
      requestIdle: () => undefined,
    };
    const manager = new WebAudioManager(environment);
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "title" });
    await manager.initialiseFromUserGesture();
    const originalSource = context.sources[0];

    manager.setMusicState({
      kind: "crisis",
      crisisId: "pending",
      flavour: "institutional",
    });
    manager.setMusicState({ kind: "title" });
    resolveCrisisTrack?.(new ArrayBuffer(4));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(context.sources).toEqual([originalSource]);
    expect(originalSource?.stops).toEqual([]);
    expect(manager.getCurrentTrackId()).toBe("hello-world-model");
  });

  it("keeps a pending manual skip through repeated renders of the same lab state", async () => {
    const context = new FakeAudioContext();
    let resolveNextTrack: ((buffer: ArrayBuffer) => void) | undefined;
    const nextTrack = new Promise<ArrayBuffer>((resolve) => {
      resolveNextTrack = resolve;
    });
    const environment: WebAudioEnvironment = {
      createContext: () => context as unknown as AudioContext,
      random: () => 0.5,
      fetchArrayBuffer: (url) =>
        url === MUSIC_ASSETS["gradients-flowing"].url
          ? Promise.resolve(new ArrayBuffer(4))
          : nextTrack,
      setTimer: () => 1,
      clearTimer: () => undefined,
      requestIdle: () => undefined,
    };
    const manager = new WebAudioManager(environment);
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "laboratory", focus: "general" });
    await manager.initialiseFromUserGesture();

    manager.skipMusic();
    manager.setMusicState({ kind: "laboratory", focus: "general" });
    resolveNextTrack?.(new ArrayBuffer(4));

    await expect.poll(() => context.sources.length).toBe(2);
    expect(manager.getCurrentTrackId()).not.toBe("gradients-flowing");
  });

  it("preserves the music position and discards the active cue on pause", async () => {
    const { manager, context, fireLastTimer } = fixture();
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "laboratory", focus: "general" });
    await manager.initialiseFromUserGesture();
    context.currentTime = 37;
    manager.playCue("paper-discovered", "paper:one");
    await Promise.resolve();
    await Promise.resolve();
    const cueSource = context.sources.at(-1)!;

    manager.suspend();
    expect(manager.getPlaybackState()).toBe("paused");
    expect(cueSource.stops).toHaveLength(1);
    fireLastTimer();
    await manager.resumeFromUserGesture();
    expect(context.sources.at(-1)?.starts.at(-1)).toBeCloseTo(37, 5);
  });

  it("can be muted while a track is still loading", async () => {
    const { manager, context } = fixture();
    let finishResume: (() => void) | undefined;
    context.resumeResult = new Promise<void>((resolve) => {
      finishResume = resolve;
    });
    manager.setVolumes(enabled);

    const initialising = manager.initialiseFromUserGesture();
    await Promise.resolve();
    manager.suspend();

    expect(manager.getPlaybackState()).toBe("paused");
    finishResume?.();
    await initialising;
    expect(manager.getPlaybackState()).toBe("paused");
    expect(context.sources).toHaveLength(0);
  });

  it("manual NEXT shuffles every ordinary laboratory track without immediate repeats", async () => {
    // A cycling stub keeps the shuffle deterministic for the test without
    // pinning any particular order into the assertion.
    let step = 0;
    const stub = (): number => {
      step += 1;
      return (step % 7) / 7;
    };
    const { manager, context } = fixture(stub);
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "laboratory", focus: "general" });
    await manager.initialiseFromUserGesture();

    // Every ordinary game tab opens on the shared signature, then manual NEXT
    // can reach the complete laboratory soundtrack.
    expect(manager.getCurrentTrackId()).toBe("gradients-flowing");
    expect(context.sources[0]?.loop).toBe(false);

    const laboratoryTracks = [
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
    ];
    const heard: string[] = [manager.getCurrentTrackId() ?? ""];
    for (let advance = 0; advance < laboratoryTracks.length - 1; advance += 1) {
      const before = manager.getCurrentTrackId();
      manager.skipMusic();
      await expect.poll(() => manager.getCurrentTrackId()).not.toBe(before);
      const current = manager.getCurrentTrackId() ?? "";
      expect(laboratoryTracks).toContain(current);
      heard.push(current);
    }
    // One full bag: every pool member exactly once before anything repeats.
    expect([...new Set(heard)].sort()).toEqual([...laboratoryTracks].sort());

    // The next draw opens a fresh bag and still never repeats the last track.
    const last = manager.getCurrentTrackId();
    manager.skipMusic();
    await expect.poll(() => manager.getCurrentTrackId()).not.toBe(last);
    expect(laboratoryTracks).toContain(manager.getCurrentTrackId() ?? "");
  });

  it("warms only the visible endgame branch and follows retirement when committed", async () => {
    const context = new FakeAudioContext();
    const fetched: string[] = [];
    const idle: (() => void)[] = [];
    const manager = new WebAudioManager({
      createContext: () => context as unknown as AudioContext,
      fetchArrayBuffer: (url) => {
        fetched.push(url);
        return Promise.resolve(new ArrayBuffer(4));
      },
      setTimer: () => 1,
      clearTimer: () => undefined,
      requestIdle: (callback) => {
        idle.push(callback);
        return undefined;
      },
    });
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "endgame", chapter: "candidacy" });
    // Before the first gesture there is no AudioContext, so nothing is decoded.
    expect(idle).toHaveLength(0);
    await manager.initialiseFromUserGesture();
    expect(idle.length).toBeGreaterThan(0);
    for (const callback of idle) callback();
    const candidacyTracks = [
      "the-graph-goes-vertical",
      "go-no-go",
      "hands-off-the-weights",
    ];
    await expect
      .poll(() =>
        candidacyTracks.filter((trackId) => fetched.some((url) => url.includes(trackId))),
      )
      .toEqual(candidacyTracks);
    expect(fetched.some((url) => url.includes("ship-it"))).toBe(false);
    expect(fetched.some((url) => url.includes("every-phone-at-once"))).toBe(false);

    const callbacksBeforeRetirement = idle.length;
    manager.setMusicState({ kind: "endgame", chapter: "retirement-held" });
    expect(idle.length).toBeGreaterThan(callbacksBeforeRetirement);
    idle.at(-1)?.();
    await expect
      .poll(() =>
        ["the-machine-moves-first", "adrenaline-half-life"].filter((trackId) =>
          fetched.some((url) => url.includes(trackId)),
        ),
      )
      .toEqual(["the-machine-moves-first", "adrenaline-half-life"]);
    manager.dispose();
  });

  it("limits every endgame chapter prefetch to two non-current tracks", () => {
    const chapters = [
      "candidacy",
      "capability-proof",
      "dossier-review",
      "diagnosis",
      "safety-work",
      "deployment-planning",
      "pressure",
      "controlled-rollout",
      "final-review",
      "deployment-held",
      "retirement-held",
      "observed-resistance",
      "containment-failure",
      "local-recovery",
      "moratorium",
    ] as const;
    for (const chapter of chapters) {
      const tracks = endgamePrefetchTracksForChapter(chapter);
      expect(tracks.length).toBeLessThanOrEqual(2);
      expect(new Set(tracks).size).toBe(tracks.length);
      expect(tracks).not.toContain(trackForState({ kind: "endgame", chapter }));
    }
  });

  it("does not restart music for rerenders or adjacent chapters sharing a track", async () => {
    const { manager, context } = fixture(() => 0.5);
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "endgame", chapter: "candidacy" });
    await manager.initialiseFromUserGesture();
    expect(context.sources).toHaveLength(1);

    manager.setMusicState({ kind: "endgame", chapter: "candidacy" });
    manager.setMusicState({ kind: "endgame", chapter: "capability-proof" });
    await Promise.resolve();
    expect(manager.getCurrentTrackId()).toBe("the-graph-goes-vertical");
    expect(context.sources).toHaveLength(1);

    manager.setMusicState({ kind: "endgame", chapter: "dossier-review" });
    await expect.poll(() => manager.getCurrentTrackId()).toBe("the-window-is-closing");
    expect(context.sources).toHaveLength(2);
  });

  it("locks NEXT during the endgame so only the authored stage music plays", async () => {
    const { manager } = fixture(() => 0.5);
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "endgame", chapter: "final-review" });
    await manager.initialiseFromUserGesture();
    expect(manager.getCurrentTrackId()).toBe("go-no-go");
    expect(manager.canSkipTrack()).toBe(false);

    // NEXT is a no-op: the endgame is an authored sequence, never a playlist.
    manager.skipMusic();
    await Promise.resolve();
    expect(manager.getCurrentTrackId()).toBe("go-no-go");

    // The stage advancing still swaps tracks; ordinary play unlocks NEXT.
    manager.setMusicState({ kind: "endgame", chapter: "controlled-rollout" });
    await expect.poll(() => manager.getCurrentTrackId()).toBe("ship-it");
    expect(manager.canSkipTrack()).toBe(false);
    manager.setMusicState({ kind: "laboratory", focus: "general" });
    expect(manager.canSkipTrack()).toBe(true);
  });

  it("lets NEXT override a thematic crisis track until a genuinely new crisis begins", async () => {
    const { manager, context } = fixture(() => 0.5);
    manager.setVolumes(enabled);
    manager.setMusicState({
      kind: "crisis",
      crisisId: "first",
      flavour: "institutional",
    });
    await manager.initialiseFromUserGesture();
    expect(manager.getCurrentTrackId()).toBe("red-team-found-something");
    expect(context.sources.at(-1)?.loop).toBe(true);

    manager.skipMusic();
    await expect
      .poll(() => manager.getCurrentTrackId())
      .not.toBe("red-team-found-something");
    const manuallySelected = manager.getCurrentTrackId();
    expect(context.sources.at(-1)?.loop).toBe(false);

    // A fresh view object for the same crisis must not undo the player's skip.
    manager.setMusicState({
      kind: "crisis",
      crisisId: "first",
      flavour: "institutional",
    });
    await Promise.resolve();
    expect(manager.getCurrentTrackId()).toBe(manuallySelected);

    // Manual playback continues through the ordinary shuffle rather than
    // looping a single replacement track forever.
    context.sources.at(-1)?.finish();
    await expect.poll(() => manager.getCurrentTrackId()).not.toBe(manuallySelected);
    expect(manager.getCurrentTrackId()).not.toBe("red-team-found-something");

    // A different crisis is new authored information and receives its cue.
    manager.setMusicState({
      kind: "crisis",
      crisisId: "second",
      flavour: "institutional",
    });
    await expect.poll(() => manager.getCurrentTrackId()).toBe("red-team-found-something");
  });

  it("keeps automatic track endings inside the active focus pool", async () => {
    const { manager, context } = fixture(() => 0.5);
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "laboratory", focus: "safety" });
    await manager.initialiseFromUserGesture();

    const safetyPool = [
      "safety-case-draft-47",
      "peer-reviewer-two",
      "overnight-run",
      "hello-world-model",
      "gradients-flowing",
    ];
    expect(manager.getCurrentTrackId()).toBe("safety-case-draft-47");

    for (let advance = 0; advance < safetyPool.length * 2; advance += 1) {
      const before = manager.getCurrentTrackId();
      context.sources.at(-1)?.finish();
      await expect.poll(() => manager.getCurrentTrackId()).not.toBe(before);
      expect(safetyPool).toContain(manager.getCurrentTrackId() ?? "");
    }
  });

  it("steers the laboratory track for major good news, with pool and cooldown guards", async () => {
    const { manager, context } = fixture(() => 0.5);
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "laboratory", focus: "general" });
    await manager.initialiseFromUserGesture();
    expect(manager.getCurrentTrackId()).toBe("gradients-flowing");

    // GPUs arrive: the delivery-day track takes over with a fade.
    manager.suggestLaboratoryTrack("gpus-arrive-tuesday");
    await expect.poll(() => manager.getCurrentTrackId()).toBe("gpus-arrive-tuesday");

    // A second suggestion inside the 90-second cooldown is ignored.
    manager.suggestLaboratoryTrack("converged-before-lunch");
    await Promise.resolve();
    expect(manager.getCurrentTrackId()).toBe("gpus-arrive-tuesday");

    // After the cooldown, a suggestion outside the focus pool is ignored:
    // safety's reflective mood is never hijacked by a funding round.
    context.currentTime = 120;
    manager.setMusicState({ kind: "laboratory", focus: "safety" });
    await expect.poll(() => manager.getCurrentTrackId()).toBe("gpus-arrive-tuesday");
    manager.suggestLaboratoryTrack("budget-approved");
    await Promise.resolve();
    expect(manager.getCurrentTrackId()).not.toBe("budget-approved");
  });

  it("queues recovery instead of declaring a transient start timeout permanent", async () => {
    const { manager, context, fireLastTimer } = fixture();
    context.resumeResult = new Promise(() => undefined);
    manager.setVolumes(enabled);

    const initialising = manager.initialiseFromUserGesture();
    await Promise.resolve();
    fireLastTimer();
    await initialising;

    expect(manager.getPlaybackState()).toBe("loading");
  });

  it("repairs a browser-suspended context without restarting healthy playback", async () => {
    const { manager, context, fireLastTimer } = fixture();
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "laboratory", focus: "general" });
    await manager.initialiseFromUserGesture();
    const originalSource = context.sources[0];

    await manager.recoverPlayback();
    expect(context.sources).toEqual([originalSource]);

    context.interrupt();
    fireLastTimer();
    await expect.poll(() => context.state).toBe("running");
    expect(manager.getPlaybackState()).toBe("playing");
    expect(context.sources).toEqual([originalSource]);
  });

  it("retries after a natural track transition fails to load", async () => {
    const context = new FakeAudioContext();
    const attempts = new Map<string, number>();
    const timers: ((() => void) | undefined)[] = [];
    const environment: WebAudioEnvironment = {
      createContext: () => context as unknown as AudioContext,
      fetchArrayBuffer: (url) => {
        const attempt = (attempts.get(url) ?? 0) + 1;
        attempts.set(url, attempt);
        // The shuffled successor is not knowable in advance: fail the first
        // attempt of every track except the opening one.
        if (url !== MUSIC_ASSETS["gradients-flowing"].url && attempt === 1) {
          return Promise.reject(new Error("transient fetch failure"));
        }
        return Promise.resolve(new ArrayBuffer(4));
      },
      setTimer: (callback) => {
        timers.push(callback);
        return timers.length;
      },
      clearTimer: (timer) => {
        timers[timer - 1] = undefined;
      },
      requestIdle: () => undefined,
    };
    const manager = new WebAudioManager(environment);
    manager.setVolumes(enabled);
    manager.setMusicState({ kind: "laboratory", focus: "general" });
    await manager.initialiseFromUserGesture();
    context.sources[0]?.finish();
    await expect.poll(() => manager.getPlaybackState()).toBe("loading");

    const recovery = timers.findLast((candidate) => candidate !== undefined);
    expect(recovery).toBeDefined();
    recovery?.();

    await expect.poll(() => context.sources.length).toBe(2);
    expect(context.sources[1]?.starts).toEqual([0]);
    expect(manager.getCurrentTrackId()).not.toBe("gradients-flowing");
    expect(manager.getPlaybackState()).toBe("playing");
  });

  it("interrupts lower-priority cues, drops lower priority work, and deduplicates occurrences", async () => {
    const { manager, context, fetched } = fixture();
    manager.setVolumes(enabled);
    await manager.initialiseFromUserGesture();

    manager.playCue("score-milestone", "score:one");
    await expect.poll(() => context.sources.length).toBe(2);
    const low = context.sources.at(-1)!;
    manager.playCue("containment-failure", "ending:one");
    await expect.poll(() => context.sources.length).toBe(3);
    expect(low.stops).toHaveLength(1);
    const afterHigh = fetched.length;

    manager.playCue("paper-discovered", "paper:dropped");
    manager.playCue("containment-failure", "ending:one");
    await Promise.resolve();
    expect(fetched).toHaveLength(afterHigh);
    expect(fetched).toContain(CUE_ASSETS["score-milestone"].url);
    expect(fetched).toContain(CUE_ASSETS["containment-failure"].url);
  });

  it("lets a terminal cue interrupt an equally urgent positive cue", async () => {
    const { manager, context, fetched } = fixture();
    manager.setVolumes(enabled);
    await manager.initialiseFromUserGesture();

    manager.playCue("coalition-formed", "coalition:formed");
    await expect.poll(() => context.sources.length).toBe(2);
    const positiveCue = context.sources.at(-1)!;

    manager.playCue("race-lost", "ending:loss");
    await expect.poll(() => context.sources.length).toBe(3);

    expect(positiveCue.stops).toHaveLength(1);
    expect(fetched).toContain(CUE_ASSETS["coalition-formed"].url);
    expect(fetched).toContain(CUE_ASSETS["race-lost"].url);
  });

  it("maps every closed music state to the intended track or deliberate silence", () => {
    expect(trackForState({ kind: "title" })).toBe("hello-world-model");
    expect(trackForState({ kind: "crisis", crisisId: "ghost", flavour: "machine" })).toBe(
      "ghost-in-the-cluster",
    );
    expect(trackForState({ kind: "endgame", chapter: "containment-failure" })).toBe(
      "the-machine-moves-first",
    );
    expect(
      trackForState({ kind: "crisis", crisisId: "visible", flavour: "institutional" }),
    ).toBe("red-team-found-something");
    expect(trackForState({ kind: "endgame", chapter: "diagnosis" })).toBe(
      "the-window-is-closing",
    );
    expect(trackForState({ kind: "endgame", chapter: "capability-proof" })).toBe(
      "the-graph-goes-vertical",
    );
    expect(trackForState({ kind: "endgame", chapter: "safety-work" })).toBe(
      "hands-off-the-weights",
    );
    expect(trackForState({ kind: "endgame", chapter: "dossier-review" })).toBe(
      "the-window-is-closing",
    );
    expect(trackForState({ kind: "endgame", chapter: "deployment-planning" })).toBe(
      "go-no-go",
    );
    expect(trackForState({ kind: "endgame", chapter: "pressure" })).toBe(
      "every-phone-at-once",
    );
    expect(trackForState({ kind: "endgame", chapter: "final-review" })).toBe("go-no-go");
    expect(trackForState({ kind: "endgame", chapter: "deployment-held" })).toBe(
      "go-no-go",
    );
    expect(trackForState({ kind: "endgame", chapter: "retirement-held" })).toBe(
      "hands-off-the-weights",
    );
    expect(trackForState({ kind: "endgame", chapter: "controlled-rollout" })).toBe(
      "ship-it",
    );
    expect(trackForState({ kind: "endgame", chapter: "local-recovery" })).toBe(
      "adrenaline-half-life",
    );
    expect(trackForState({ kind: "endgame", chapter: "moratorium" })).toBe(
      "safety-case-draft-47",
    );
    expect(trackForState({ kind: "victory", tier: "full" })).toBe(
      "broadly-shared-future",
    );
    expect(trackForState({ kind: "victory", tier: "qualified" })).toBe(
      "a-qualified-success",
    );
    expect(trackForState({ kind: "extinction" })).toBe("nothing-left-to-read");
    expect(trackForState({ kind: "ending-defeat" })).toBe("exit-interview");
    expect(trackForState({ kind: "ending-catastrophe" })).toBe("loss-of-signal");
  });

  it("does not expose The Last Evaluation as playable endgame music", () => {
    expect(Object.values(MUSIC_ASSETS).map((asset) => asset.title)).not.toContain(
      "The Last Evaluation",
    );
  });
});
