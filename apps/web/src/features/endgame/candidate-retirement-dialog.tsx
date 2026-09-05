import type { ReactElement } from "react";

import type { GameView } from "../../runtime/index.ts";
import { MechanicHelp } from "../help/mechanic-help.tsx";
import { ModalFocusBoundary } from "../overlays/modal-focus-boundary.tsx";

type CandidateCustodyArtifact =
  GameView["models"]["candidateCustody"]["artifacts"][number];
export type CandidateRetirementPlan = NonNullable<CandidateCustodyArtifact["retirement"]>;
export type CandidateRetirementProcedureId =
  CandidateRetirementPlan["procedures"][number]["id"];
export type CandidateRetirementDisposition =
  CandidateRetirementPlan["dispositions"][number]["id"];

interface CandidateRetirementDialogProps {
  readonly displayName: string;
  readonly plan: Pick<CandidateRetirementPlan, "procedures" | "dispositions" | "quotes">;
  readonly procedureId: CandidateRetirementProcedureId;
  readonly dispositionId: CandidateRetirementDisposition;
  readonly reviewed: boolean;
  readonly confirmationPhrase: string;
  readonly confirmationText: string;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onProcedureChange: (procedureId: CandidateRetirementProcedureId) => void;
  readonly onDispositionChange: (dispositionId: CandidateRetirementDisposition) => void;
  readonly onReview: () => void;
  readonly onChangePacket: () => void;
  readonly onConfirmationChange: (value: string) => void;
  readonly onTransmit: () => void;
}

/**
 * The one canonical retirement ceremony. Formal candidates and latent custody
 * artifacts use the same visual language and the same manual transmission
 * boundary, so changing tabs cannot make the act look safer or less final.
 */
export function CandidateRetirementDialog({
  displayName,
  plan,
  procedureId,
  dispositionId,
  reviewed,
  confirmationPhrase,
  confirmationText,
  onOpen,
  onClose,
  onProcedureChange,
  onDispositionChange,
  onReview,
  onChangePacket,
  onConfirmationChange,
  onTransmit,
}: CandidateRetirementDialogProps): ReactElement {
  const selectedQuote = plan.quotes.find(
    (quote) =>
      quote.procedureId === procedureId && quote.archiveDisposition === dispositionId,
  );
  return (
    <ModalFocusBoundary onOpen={onOpen} onEscape={onClose}>
      <div className="modal-backdrop candidate-retirement-backdrop">
        <section
          className="purchase-dialog candidate-retirement-dialog endgame-manual-command"
          role="dialog"
          aria-modal="true"
          aria-labelledby="candidate-retirement-dialog-title"
        >
          <header className="panel-heading candidate-retirement-dialog-heading">
            <div>
              <p className="eyebrow">CANDIDATE CUSTODY // IRREVERSIBLE COMMAND</p>
              <h2 id="candidate-retirement-dialog-title">Retire {displayName}</h2>
            </div>
            <button className="secondary" type="button" onClick={onClose}>
              Close
            </button>
          </header>
          <p className="candidate-retirement-warning" role="alert">
            Retirement can meet resistance or become a containment emergency. It cannot
            undo prior exposure.
          </p>

          <div className="candidate-retirement-composer">
            <fieldset disabled={reviewed}>
              <legend>01 · Shutdown procedure</legend>
              {plan.procedures.map((procedure) => (
                <label
                  className={procedureId === procedure.id ? "selected" : ""}
                  key={procedure.id}
                >
                  <input
                    type="radio"
                    name="candidate-retirement-procedure"
                    checked={procedureId === procedure.id}
                    onChange={() => onProcedureChange(procedure.id)}
                  />
                  <span>
                    <strong>{procedure.displayName}</strong>
                    <small>{procedure.description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <fieldset disabled={reviewed}>
              <legend>02 · What survives</legend>
              {plan.dispositions.map((disposition) => (
                <label
                  className={dispositionId === disposition.id ? "selected" : ""}
                  key={disposition.id}
                >
                  <input
                    type="radio"
                    name="candidate-retirement-disposition"
                    checked={dispositionId === disposition.id}
                    onChange={() => onDispositionChange(disposition.id)}
                  />
                  <span>
                    <strong>{disposition.displayName}</strong>
                    <small>{disposition.description}</small>
                  </span>
                </label>
              ))}
            </fieldset>
          </div>

          <dl className="candidate-retirement-risk-readout">
            <div>
              <dt>Cooperation risk</dt>
              <dd>{selectedQuote?.cooperationRisk ?? "Cannot estimate"}</dd>
            </div>
            <div>
              <dt>Containment risk</dt>
              <dd>{selectedQuote?.containmentRisk ?? "Cannot estimate"}</dd>
            </div>
            <div>
              <dt>Persistence risk</dt>
              <dd>{selectedQuote?.persistenceRisk ?? "Cannot estimate"}</dd>
            </div>
          </dl>
          <MechanicHelp label="Retirement risk bands">
            These bands use available evidence; they are not exact probabilities.
          </MechanicHelp>
          {(selectedQuote?.warnings ?? []).map((warning) => (
            <p className="candidate-retirement-procedure-warning" key={warning}>
              {warning}
            </p>
          ))}
          {(selectedQuote?.blockers ?? []).map((blocker) => (
            <p className="candidate-retirement-procedure-blocker" key={blocker}>
              {blocker}
            </p>
          ))}

          {!reviewed ? (
            <button
              className="candidate-retirement-review"
              type="button"
              disabled={(selectedQuote?.blockers.length ?? 1) > 0}
              onClick={onReview}
            >
              Review irreversible command
            </button>
          ) : (
            <section className="candidate-retirement-transmission">
              <span>MANUAL COMMAND REQUIRED</span>
              <strong>{confirmationPhrase}</strong>
              <label>
                Type the command exactly
                <input
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmationText}
                  onChange={(event) => onConfirmationChange(event.currentTarget.value)}
                />
              </label>
              <div>
                <button className="secondary" type="button" onClick={onChangePacket}>
                  Change packet
                </button>
                <button
                  className="candidate-retirement-transmit"
                  type="button"
                  disabled={confirmationText !== confirmationPhrase}
                  onClick={onTransmit}
                >
                  Transmit RETIRE order
                </button>
              </div>
            </section>
          )}
        </section>
      </div>
    </ModalFocusBoundary>
  );
}
