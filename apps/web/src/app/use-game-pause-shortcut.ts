import { useEffect } from "react";

const SPACE_SHORTCUT_EXCLUSION =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), [data-space-shortcut-ignore]";

function shouldIgnoreSpace(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.repeat ||
    (event.code !== "Space" && event.key !== " ") ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return true;
  }

  if (document.querySelector(":is([role='dialog'], [role='alertdialog'])") !== null) {
    return true;
  }

  return (
    event.target instanceof Element &&
    event.target.closest(SPACE_SHORTCUT_EXCLUSION) !== null
  );
}

export function useGamePauseShortcut({
  enabled,
  paused,
  onPause,
  onResume,
}: {
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly onPause: () => void;
  readonly onResume: () => void;
}): void {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (shouldIgnoreSpace(event)) return;
      event.preventDefault();
      if (paused) {
        onResume();
      } else {
        onPause();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onPause, onResume, paused]);
}
