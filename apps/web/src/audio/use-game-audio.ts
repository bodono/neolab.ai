import { useCallback, useEffect, useRef, useState } from "react";

import type { GameView } from "@neolab/sim/public";

import { useAudio } from "./audio-provider.tsx";
import {
  alarmCueForVisiblePresentation,
  cuesForDomainEvents,
  musicSuggestionForDomainEvent,
  resolveMusicState,
  type GameSection,
} from "./audio-presentation.ts";
import type { CueRequest } from "./audio-types.ts";
import type { BrowserGameRuntime, RuntimeReceipt } from "../runtime/index.ts";

export interface GameAudioPresentation {
  readonly notices: readonly CueRequest[];
  readonly dismissNotice: (occurrenceKey: string) => void;
  readonly dismissAllNotices: () => void;
}

export function useGameAudio(
  runtime: BrowserGameRuntime,
  view: GameView | undefined,
  section: GameSection,
): GameAudioPresentation {
  const { manager, playbackState, setMusicState } = useAudio();
  const [notices, setNotices] = useState<readonly CueRequest[]>([]);
  const seenOccurrenceKeys = useRef(new Set<string>());
  const playedOccurrenceKeys = useRef(new Set<string>());

  useEffect(() => {
    setMusicState(resolveMusicState(view, section));
  }, [section, setMusicState, view]);

  useEffect(() => {
    if (view === undefined || playbackState !== "playing") return;
    const alarm = view.presentationQueue
      .map((item) => alarmCueForVisiblePresentation(item))
      .find((candidate) => candidate !== undefined);
    if (alarm === undefined || playedOccurrenceKeys.current.has(alarm.occurrenceKey)) {
      return;
    }
    playedOccurrenceKeys.current.add(alarm.occurrenceKey);
    manager.playCue(alarm.cueId, alarm.occurrenceKey);
  }, [manager, playbackState, view]);

  useEffect(() => {
    let lastReceipt: RuntimeReceipt | undefined;
    return runtime.subscribe((snapshot) => {
      const receipt = snapshot.lastReceipt;
      if (receipt === undefined || receipt === lastReceipt) return;
      lastReceipt = receipt;
      const newRequests = cuesForDomainEvents(
        receipt.domainEvents,
        snapshot.gameView,
        receipt.tick,
      );
      const terminal = snapshot.gameView.meta.status !== "active";
      if (terminal) {
        // Resolve the final score immediately, before React's view effect and
        // before any upbeat laboratory suggestion from this receipt can run.
        // The ending state is section-independent, so call the manager directly
        // and keep this receipt subscription stable while the UI changes section.
        manager.setMusicState(resolveMusicState(snapshot.gameView, "lab"));
      }
      // At most one music steer per receipt; the manager applies its own
      // focus-pool membership and 90-second cooldown guards.
      if (!terminal) {
        const suggestion = receipt.domainEvents
          .map((event) => musicSuggestionForDomainEvent(event, snapshot.gameView))
          .find((track) => track !== undefined);
        if (suggestion !== undefined) manager.suggestLaboratoryTrack(suggestion);
      }
      const unseenRequests = newRequests.filter((request) => {
        if (seenOccurrenceKeys.current.has(request.occurrenceKey)) return false;
        seenOccurrenceKeys.current.add(request.occurrenceKey);
        return true;
      });
      if (terminal) {
        const terminalRequest = unseenRequests[0];
        if (terminalRequest === undefined) {
          setNotices([]);
          return;
        }
        // Terminal cues have the catalogue's highest priorities. Playing now
        // interrupts any positive cue already loading or sounding; marking it
        // played prevents the notice effect from starting it twice.
        playedOccurrenceKeys.current.add(terminalRequest.occurrenceKey);
        manager.playCue(terminalRequest.cueId, terminalRequest.occurrenceKey);
        setNotices([terminalRequest]);
        return;
      }
      if (unseenRequests.length === 0) return;
      // Preserve the visible cue at the head of the queue. A later burst must not
      // replace its explanation while its sound is still playing.
      setNotices((current) => [...current, ...unseenRequests].slice(0, 8));
    });
  }, [manager, runtime]);

  // Effects run after React commits the notice stack. The oldest request remains
  // the active sound cue at the bottom; newer requests are already visible above it
  // but do not make sound until earlier cues are dismissed.
  useEffect(() => {
    const request = notices[0];
    if (
      request !== undefined &&
      !playedOccurrenceKeys.current.has(request.occurrenceKey)
    ) {
      playedOccurrenceKeys.current.add(request.occurrenceKey);
      manager.playCue(request.cueId, request.occurrenceKey);
    }
  }, [manager, notices]);

  const dismissNotice = useCallback((occurrenceKey: string): void => {
    setNotices((current) =>
      current.filter((request) => request.occurrenceKey !== occurrenceKey),
    );
  }, []);

  const dismissAllNotices = useCallback((): void => {
    setNotices([]);
  }, []);

  return { notices, dismissNotice, dismissAllNotices };
}
