import { useState, type ReactElement } from "react";

import { ModalFocusBoundary } from "../overlays/modal-focus-boundary.tsx";

export function CriticalAutonomyConfirmationDialog({
  confirmationPhrase,
  displayName,
  exposedSystems,
  level,
  onCancel,
  onConfirm,
  onOpen,
}: {
  readonly confirmationPhrase: string;
  readonly displayName: string;
  readonly exposedSystems: readonly string[];
  readonly level: number;
  readonly onCancel: () => void;
  readonly onConfirm: (confirmationText: string) => void;
  readonly onOpen?: () => void;
}): ReactElement {
  const [confirmation, setConfirmation] = useState("");
  const titleId = `critical-autonomy-title-${String(level)}`;

  return (
    <ModalFocusBoundary onOpen={onOpen} onEscape={onCancel}>
      <div className="critical-access-backdrop">
        <section
          className="critical-access-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <p className="eyebrow">CRITICAL PERMISSION CHANGE</p>
          <h2 id={titleId}>{displayName}</h2>
          <p>
            Granting autonomy level {level} materially changes what a mistaken or
            deceptive model can affect. It exposes:
          </p>
          <ul>
            {exposedSystems.map((system) => (
              <li key={system}>{system}</li>
            ))}
          </ul>
          <label>
            Type <strong>{confirmationPhrase}</strong> to confirm
            <input
              autoFocus
              value={confirmation}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
            />
          </label>
          <footer>
            <button className="secondary" type="button" onClick={onCancel}>
              Keep current boundary
            </button>
            <button
              className="danger"
              type="button"
              disabled={confirmation !== confirmationPhrase}
              onClick={() => onConfirm(confirmation)}
            >
              Confirm critical access
            </button>
          </footer>
        </section>
      </div>
    </ModalFocusBoundary>
  );
}
