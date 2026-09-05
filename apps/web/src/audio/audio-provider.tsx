import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  DEFAULT_AUDIO_SETTINGS,
  type AudioSettingsRepository,
} from "./audio-settings.ts";
import type {
  AudioManager,
  AudioPlaybackState,
  MusicTrackId,
  MusicState,
  VolumeSettings,
} from "./audio-types.ts";

interface AudioContextValue {
  readonly manager: AudioManager;
  readonly settings: VolumeSettings;
  readonly playbackState: AudioPlaybackState;
  readonly currentTrackId: MusicTrackId | undefined;
  readonly startWithSound: () => void;
  readonly startMuted: () => void;
  readonly togglePlayback: () => void;
  readonly skipTrack: () => void;
  readonly canSkip: boolean;
  readonly updateSettings: (patch: Partial<VolumeSettings>) => void;
  readonly setMusicState: (state: MusicState) => void;
}

const Context = createContext<AudioContextValue | undefined>(undefined);

export function AudioProvider({
  manager,
  repository,
  children,
}: {
  readonly manager: AudioManager;
  readonly repository: AudioSettingsRepository;
  readonly children: ReactNode;
}): ReactElement {
  const [settings, setSettings] = useState(() => repository.load());
  const [playbackState, setPlaybackState] = useState(() => manager.getPlaybackState());
  const [currentTrackId, setCurrentTrackId] = useState(() => manager.getCurrentTrackId());
  const [canSkip, setCanSkip] = useState(() => manager.canSkipTrack());
  const managerLifecycle = useRef({ manager, generation: 0 });
  if (managerLifecycle.current.manager !== manager) {
    managerLifecycle.current = { manager, generation: 0 };
  }

  useEffect(
    () =>
      manager.subscribe((state) => {
        setPlaybackState(state);
        setCurrentTrackId(manager.getCurrentTrackId());
        setCanSkip(manager.canSkipTrack());
      }),
    [manager],
  );
  useEffect(() => manager.setVolumes(settings), [manager, settings]);
  useEffect(() => {
    if (!settings.playbackEnabled) return;

    const recover = (): void => {
      void manager.recoverPlayback();
    };
    const recoverWhenVisible = (): void => {
      if (document.visibilityState === "visible") recover();
    };

    // A development hot reload or a browser-managed AudioContext suspension can
    // leave the persisted preference set to "sound on" while the replacement
    // context is silent. Try immediately, when the page becomes visible, and on
    // the next genuine user gesture. The manager is a no-op while audio is healthy.
    recover();
    window.addEventListener("pageshow", recover);
    document.addEventListener("visibilitychange", recoverWhenVisible);
    document.addEventListener("pointerdown", recover, true);
    document.addEventListener("keydown", recover, true);
    return () => {
      window.removeEventListener("pageshow", recover);
      document.removeEventListener("visibilitychange", recoverWhenVisible);
      document.removeEventListener("pointerdown", recover, true);
      document.removeEventListener("keydown", recover, true);
    };
  }, [manager, settings.playbackEnabled]);
  useEffect(() => {
    const generation = ++managerLifecycle.current.generation;
    return () => {
      // React StrictMode immediately replays effects in development. Defer disposal
      // for one microtask so the replay can claim the same manager; a real unmount or
      // hot-reload replacement leaves this generation current and stops every source.
      queueMicrotask(() => {
        const active = managerLifecycle.current;
        if (active.manager !== manager || active.generation === generation) {
          manager.dispose();
        }
      });
    };
  }, [manager]);

  const persist = useCallback(
    (next: VolumeSettings): void => {
      setSettings(next);
      repository.save(next);
    },
    [repository],
  );

  const value = useMemo<AudioContextValue>(
    () => ({
      manager,
      settings,
      playbackState,
      currentTrackId,
      startWithSound: () => {
        const next = { ...settings, playbackEnabled: true };
        manager.setVolumes(next);
        persist(next);
        void manager.initialiseFromUserGesture();
      },
      startMuted: () => {
        const next = { ...settings, playbackEnabled: false };
        manager.suspend();
        manager.setVolumes(next);
        persist(next);
      },
      togglePlayback: () => {
        if (settings.playbackEnabled) {
          manager.suspend();
          persist({ ...settings, playbackEnabled: false });
        } else {
          const next = { ...settings, playbackEnabled: true };
          manager.setVolumes(next);
          persist(next);
          void manager.resumeFromUserGesture();
        }
      },
      skipTrack: () => manager.skipMusic(),
      canSkip,
      updateSettings: (patch) => {
        const next: VolumeSettings = {
          ...DEFAULT_AUDIO_SETTINGS,
          ...settings,
          ...patch,
        };
        manager.setVolumes(next);
        persist(next);
      },
      setMusicState: (state) => manager.setMusicState(state),
    }),
    [canSkip, currentTrackId, manager, persist, playbackState, settings],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAudio(): AudioContextValue {
  const value = useContext(Context);
  if (value === undefined) throw new Error("Audio provider is not available");
  return value;
}
