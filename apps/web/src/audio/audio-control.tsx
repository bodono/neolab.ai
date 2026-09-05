import { useLayoutEffect, useRef, useState, type ReactElement } from "react";

import { MUSIC_ASSETS } from "./audio-catalogue.ts";
import { useAudio } from "./audio-provider.tsx";

function percent(value: number): number {
  return Math.round(value * 100);
}

export function AudioControl(): ReactElement {
  const {
    playbackState,
    currentTrackId,
    canSkip,
    settings,
    togglePlayback,
    skipTrack,
    updateSettings,
  } = useAudio();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [titleOverflows, setTitleOverflows] = useState(false);
  const titleViewportRef = useRef<HTMLSpanElement>(null);
  const titleTextRef = useRef<HTMLSpanElement>(null);
  const unavailable = playbackState === "unavailable";
  const loading = playbackState === "loading";
  const muted = !settings.playbackEnabled;
  const label = unavailable
    ? "Audio unavailable"
    : muted
      ? "Unmute all game audio"
      : "Mute all game audio";
  const trackTitle = unavailable
    ? "Audio unavailable"
    : muted
      ? "ALL SOUND MUTED"
      : currentTrackId === undefined
        ? loading
          ? "Soundtrack loading…"
          : "No soundtrack selected"
        : `${loading ? "Loading · " : ""}${MUSIC_ASSETS[currentTrackId].title}`;

  useLayoutEffect(() => {
    const viewport = titleViewportRef.current;
    const title = titleTextRef.current;

    if (viewport === null || title === null) {
      return undefined;
    }

    const updateOverflow = (): void => {
      setTitleOverflows(title.scrollWidth > viewport.clientWidth + 1);
    };

    updateOverflow();

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(viewport);
    observer.observe(title);

    return () => observer.disconnect();
  }, [trackTitle]);

  return (
    <div className="audio-control">
      <span
        className="audio-now-playing"
        aria-live="polite"
        title={trackTitle}
        tabIndex={0}
        ref={titleViewportRef}
      >
        <span
          className={`audio-now-playing-track${titleOverflows ? " is-scrolling" : ""}`}
        >
          <span className="audio-now-playing-title" ref={titleTextRef}>
            {trackTitle}
          </span>
          {titleOverflows ? (
            <span className="audio-now-playing-title" aria-hidden="true">
              {trackTitle}
            </span>
          ) : null}
        </span>
      </span>
      <button
        className="audio-toggle"
        type="button"
        aria-label={label}
        aria-pressed={muted}
        title={`${label}. This mutes music and event cues; it does not pause the simulation.`}
        disabled={unavailable}
        onClick={(event) => {
          togglePlayback();
          event.currentTarget.focus();
        }}
      >
        {muted ? "UNMUTE" : "MUTE"}
      </button>
      <button
        className="audio-skip"
        type="button"
        aria-label="Next soundtrack track"
        title={
          canSkip
            ? "Play the next track in this lab playlist"
            : "The endgame and endings play their authored music; NEXT returns with ordinary play"
        }
        disabled={unavailable || currentTrackId === undefined || !canSkip}
        onClick={skipTrack}
      >
        NEXT
      </button>
      <button
        className="audio-settings-toggle"
        type="button"
        aria-label="Sound settings"
        aria-expanded={settingsOpen}
        onClick={() => setSettingsOpen((open) => !open)}
      >
        SOUND
      </button>
      {settingsOpen ? (
        <section className="audio-settings" aria-label="Sound settings panel">
          <header>
            <strong>SOUND MIX</strong>
            <button
              type="button"
              aria-label="Close sound settings"
              onClick={() => setSettingsOpen(false)}
            >
              ×
            </button>
          </header>
          {(
            [
              ["music", "Music"],
              ["events", "Event cues"],
              ["ui", "Interface sounds"],
            ] as const
          ).map(([key, name]) => (
            <label key={key}>
              <span>
                {name} <strong>{percent(settings[key])}%</strong>
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={percent(settings[key])}
                aria-label={`${name} volume`}
                aria-valuetext={`${String(percent(settings[key]))} percent`}
                onChange={(event) =>
                  updateSettings({ [key]: Number(event.target.value) / 100 })
                }
              />
            </label>
          ))}
          <label className="audio-check">
            <input
              type="checkbox"
              checked={settings.muteEventCues}
              onChange={(event) =>
                updateSettings({ muteEventCues: event.target.checked })
              }
            />
            Mute event cues
          </label>
          <small>Independent of the simulation pause control.</small>
        </section>
      ) : null}
    </div>
  );
}
