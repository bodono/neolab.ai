import type { ReactElement, ReactNode } from "react";

import type { GameView, PresentationQueueItemView } from "@neolab/sim/public";

import { setAutonomyCommand } from "../../app/command-builders.ts";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { DecisionEventDialog } from "../events/decision-event-dialog.tsx";
import { AutonomyAccessRequestDialog } from "./autonomy-access-request-dialog.tsx";
import { CapabilityProofResultDialog } from "./capability-proof-result-dialog.tsx";
import { EndgameReturnDialog, type FalseDawnNextPath } from "./endgame-return-dialog.tsx";
import { ModalFocusBoundary } from "./modal-focus-boundary.tsx";
import { MoratoriumResultDialog } from "./moratorium-result-dialog.tsx";
import { chooseOverlay } from "./overlay-policy.ts";
import { RivalCandidateSetbackDialog } from "./rival-candidate-setback-dialog.tsx";
import { LabMaturityUnlockDialog } from "./lab-maturity-unlock-dialog.tsx";
import { SafetyPracticeLevelDialog } from "./safety-practice-level-dialog.tsx";
import { ResearcherDepartureDialog } from "../people/researcher-departure-dialog.tsx";
import { ResearcherPoachingDialog } from "../people/researcher-poaching-dialog.tsx";
import {
  CandidateContainmentIncidentAlertDialog,
  ModelIncidentAlertDialog,
} from "./incident-alert-dialog.tsx";

export interface UserOverlayRequest {
  readonly key: string;
  readonly node: ReactNode;
}

function usableOwnerLabel(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.toLowerCase() === "undefined"
    ? undefined
    : trimmed;
}

function presentationOwner(
  item: Extract<PresentationQueueItemView, { readonly ownerLabId: string }>,
  view: GameView,
): { readonly labName: string; readonly aiName: string } {
  const directRival = view.world.rivals.find((rival) => rival.labId === item.ownerLabId);
  const signalRival = view.world.rivals.find((rival) =>
    rival.latestCapabilitySignal?.summary.includes(item.modelDisplayName),
  );
  const rival = directRival ?? signalRival;
  return {
    labName: usableOwnerLabel(item.ownerLabName) ?? rival?.labName ?? "Rival lab",
    aiName: usableOwnerLabel(item.ownerAiName) ?? rival?.aiName ?? "Undisclosed AI",
  };
}

function sameTierComparisonText(
  previousModelDisplayName: string,
  frontierCapabilityDelta: number,
): string {
  const roundedDelta = Number(frontierCapabilityDelta.toFixed(1));
  if (roundedDelta > 0) {
    return `${roundedDelta.toFixed(1)} FC above ${previousModelDisplayName}.`;
  }
  if (roundedDelta < 0) {
    return `${Math.abs(roundedDelta).toFixed(1)} FC below ${previousModelDisplayName}.`;
  }
  return `Matched ${previousModelDisplayName} on FC.`;
}

function signedFrontierCapabilityDelta(frontierCapabilityDelta: number): string {
  const roundedDelta = Number(frontierCapabilityDelta.toFixed(1));
  return `${roundedDelta >= 0 ? "+" : ""}${roundedDelta.toFixed(1)} FC`;
}

export function OverlayHost({
  view,
  runtime,
  deferredEventIds,
  requestedEventId,
  exclusiveSequenceActive,
  userOverlay,
  onAcknowledgePresentation,
  onDeferEvent,
  onCloseRequestedEvent,
  onEventResolved,
  onResolveEndgameReturn,
  onInspectPresentation,
  onProductisePresentation,
}: {
  readonly view: GameView;
  readonly runtime: BrowserGameRuntime;
  readonly deferredEventIds: ReadonlySet<string>;
  readonly requestedEventId: string | undefined;
  readonly exclusiveSequenceActive: boolean;
  readonly userOverlay: UserOverlayRequest | undefined;
  readonly onAcknowledgePresentation: (key: string) => void;
  readonly onDeferEvent: (instanceId: string) => void;
  readonly onCloseRequestedEvent: () => void;
  readonly onEventResolved: (instanceId: string) => void;
  readonly onResolveEndgameReturn: (key: string, path: FalseDawnNextPath) => void;
  readonly onInspectPresentation: (key: string) => void;
  readonly onProductisePresentation: (key: string) => void;
}): ReactElement | null {
  const selection = chooseOverlay({
    events: view.eventQueue.items,
    presentations: view.presentationQueue,
    deferredEventIds,
    exclusiveSequenceActive,
    ...(requestedEventId === undefined ? {} : { requestedEventId }),
    ...(userOverlay === undefined ? {} : { userOverlayKey: userOverlay.key }),
  });
  if (selection === undefined) return null;
  if (selection.kind === "event") {
    return (
      <ModalFocusBoundary
        key={selection.item.instanceId}
        onOpen={() => runtime.pause()}
        onEscape={
          selection.tier === "critical"
            ? undefined
            : () => {
                if (selection.tier === "urgent" || selection.tier === "decision") {
                  onDeferEvent(selection.item.instanceId);
                } else {
                  onCloseRequestedEvent();
                }
              }
        }
      >
        <DecisionEventDialog
          key={selection.item.instanceId}
          item={selection.item}
          view={view}
          runtime={runtime}
          closable={selection.tier !== "critical"}
          onClose={() => {
            if (selection.tier === "urgent" || selection.tier === "decision") {
              onDeferEvent(selection.item.instanceId);
            } else {
              onCloseRequestedEvent();
            }
          }}
          onResolved={() => onEventResolved(selection.item.instanceId)}
        />
      </ModalFocusBoundary>
    );
  }
  if (selection.kind === "presentation") {
    if (selection.item.kind === "researcher-poaching") {
      return (
        <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
          <ResearcherPoachingDialog
            item={selection.item}
            onReview={() => onInspectPresentation(selection.item.key)}
            onDefer={() => onAcknowledgePresentation(selection.item.key)}
          />
        </ModalFocusBoundary>
      );
    }
    if (selection.item.kind === "researcher-departure") {
      return (
        <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
          <ResearcherDepartureDialog
            researcherName={selection.item.researcherDisplayName}
            reason={selection.item.reason}
            {...(selection.item.rivalLabName === undefined
              ? {}
              : { rivalLabName: selection.item.rivalLabName })}
            onReviewPeople={() => onInspectPresentation(selection.item.key)}
            onResume={() => onAcknowledgePresentation(selection.item.key)}
          />
        </ModalFocusBoundary>
      );
    }
    if (selection.item.kind === "lab-maturity-unlock") {
      return (
        <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
          <LabMaturityUnlockDialog
            item={selection.item}
            onContinue={() => onAcknowledgePresentation(selection.item.key)}
          />
        </ModalFocusBoundary>
      );
    }
    if (selection.item.kind === "safety-practice-level") {
      return (
        <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
          <SafetyPracticeLevelDialog
            item={selection.item}
            onContinue={() => onAcknowledgePresentation(selection.item.key)}
            onReview={() => onInspectPresentation(selection.item.key)}
          />
        </ModalFocusBoundary>
      );
    }
    if (selection.item.kind === "rival-candidate-setback") {
      return (
        <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
          <RivalCandidateSetbackDialog
            item={selection.item}
            onAcknowledge={() => onAcknowledgePresentation(selection.item.key)}
          />
        </ModalFocusBoundary>
      );
    }
    if (selection.item.kind === "model-incident-result") {
      return (
        <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
          <ModelIncidentAlertDialog
            item={selection.item}
            onAcknowledge={() => onAcknowledgePresentation(selection.item.key)}
            onReview={() => onInspectPresentation(selection.item.key)}
          />
        </ModalFocusBoundary>
      );
    }
    if (selection.item.kind === "candidate-containment-incident") {
      return (
        <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
          <CandidateContainmentIncidentAlertDialog
            item={selection.item}
            onAcknowledge={() => onAcknowledgePresentation(selection.item.key)}
            onReview={() => onInspectPresentation(selection.item.key)}
          />
        </ModalFocusBoundary>
      );
    }
    if (selection.item.kind === "endgame-return") {
      return (
        <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
          <EndgameReturnDialog
            item={selection.item}
            onChoose={(path) => onResolveEndgameReturn(selection.item.key, path)}
          />
        </ModalFocusBoundary>
      );
    }
    if (selection.item.kind === "moratorium-result") {
      return (
        <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
          <MoratoriumResultDialog
            item={selection.item}
            onAcknowledge={() => onAcknowledgePresentation(selection.item.key)}
          />
        </ModalFocusBoundary>
      );
    }
    if (selection.item.kind === "capability-proof-result") {
      return (
        <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
          <CapabilityProofResultDialog
            item={selection.item}
            onContinue={() => onAcknowledgePresentation(selection.item.key)}
          />
        </ModalFocusBoundary>
      );
    }
    if (selection.item.kind === "autonomy-unlock") {
      const requestedLevel = selection.item.level;
      const stillCurrent = view.models.currentModelId === selection.item.modelId;
      const command = setAutonomyCommand(
        view,
        requestedLevel,
        selection.item.confirmationPhrase,
      );
      const validation = runtime.validate(command);
      const grantAvailable = stillCurrent && validation.ok;
      const grantBlocker = stillCurrent
        ? validation.ok
          ? undefined
          : validation.errors.map((error) => error.message).join(" · ")
        : "a newer model is now current";
      return (
        <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
          <AutonomyAccessRequestDialog
            item={selection.item}
            crisisControlled={view.endgame.active}
            grantAvailable={grantAvailable}
            {...(grantBlocker === undefined ? {} : { grantBlocker })}
            onDecline={() => onAcknowledgePresentation(selection.item.key)}
            onGrant={(confirmationText) => {
              if (!grantAvailable) return;
              const confirmedCommand = setAutonomyCommand(
                view,
                requestedLevel,
                confirmationText,
              );
              if (!runtime.validate(confirmedCommand).ok) return;
              runtime.dispatch(confirmedCommand);
              onAcknowledgePresentation(selection.item.key);
            }}
            onReview={() => onInspectPresentation(selection.item.key)}
          />
        </ModalFocusBoundary>
      );
    }
    const owner = presentationOwner(selection.item, view);
    const productisationUnlocked =
      view.meta.labMaturity?.features.includes("productisation") ?? true;
    const canProductise = selection.item.isPlayerModel && productisationUnlocked;
    const comparison = selection.item.previousModelComparison;
    const comparisonCopy =
      comparison === undefined
        ? undefined
        : comparison.kind === "higher-tier"
          ? {
              label: "NEW LAB BEST",
              text: `+${String(comparison.tierDelta)} ${comparison.tierDelta === 1 ? "tier" : "tiers"} · ${signedFrontierCapabilityDelta(comparison.frontierCapabilityDelta)} vs ${comparison.previousModelDisplayName}.`,
            }
          : comparison.kind === "lower-tier"
            ? {
                label: "BELOW THE PREVIOUS MODEL",
                text: `${String(comparison.tierDelta)} ${Math.abs(comparison.tierDelta) === 1 ? "tier" : "tiers"} · ${signedFrontierCapabilityDelta(comparison.frontierCapabilityDelta)} vs ${comparison.previousModelDisplayName}.`,
              }
            : {
                label: "SAME CAPABILITY TIER",
                text: sameTierComparisonText(
                  comparison.previousModelDisplayName,
                  comparison.frontierCapabilityDelta,
                ),
              };
    return (
      <ModalFocusBoundary key={selection.item.key} onOpen={() => runtime.pause()}>
        <div className="modal-backdrop discovery-backdrop">
          <section
            className={[
              "discovery-dialog",
              selection.item.isPlayerModel ? "player-milestone" : "competitor-milestone",
              comparison === undefined ? undefined : `model-${comparison.kind}`,
            ]
              .filter((className) => className !== undefined)
              .join(" ")}
            role="dialog"
            aria-modal="true"
            aria-labelledby={`discovery-${selection.item.key}`}
          >
            <p className="eyebrow">
              {selection.item.isPlayerModel
                ? comparison?.kind === "higher-tier"
                  ? "MODEL EVALUATION // NEW LAB BEST"
                  : comparison?.kind === "same-tier"
                    ? "MODEL EVALUATION // TIER HELD"
                    : comparison?.kind === "lower-tier"
                      ? "MODEL EVALUATION // REGRESSION"
                      : "MODEL EVALUATION"
                : "COMPETITOR CAPABILITY SIGNAL"}{" "}
              // WEEK {selection.item.createdAtTick}
            </p>
            <h2 id={`discovery-${selection.item.key}`}>
              {selection.item.modelDisplayName}{" "}
              {selection.item.isPlayerModel ? "evaluated at" : "reportedly reached"} Tier{" "}
              {selection.item.tierLevel}
            </h2>
            {selection.item.isPlayerModel ? null : (
              <div className="competitor-model-owner">
                <strong>
                  {owner.labName} · {owner.aiName} programme
                </strong>
              </div>
            )}
            <p className="milestone-tier-name">{selection.item.title}</p>
            <p className="milestone-summary">{selection.item.summary}</p>
            {comparisonCopy === undefined ? null : (
              <div className="model-tier-comparison">
                <strong>{comparisonCopy.label}</strong>
                <span>{comparisonCopy.text}</span>
              </div>
            )}
            {selection.item.isPlayerModel &&
            selection.item.unlockLabels.length > 0 &&
            (comparison === undefined || comparison.kind === "higher-tier") ? (
              <p className="milestone-unlocks">
                <strong>UNLOCKED</strong>
                <span>{selection.item.unlockLabels.join(" · ")}</span>
              </p>
            ) : null}
            <div className="milestone-actions">
              {canProductise ? (
                <button
                  className="primary"
                  type="button"
                  onClick={() => onProductisePresentation(selection.item.key)}
                >
                  Configure launch
                </button>
              ) : null}
              <button
                className={canProductise ? "secondary" : "primary"}
                type="button"
                onClick={() => onInspectPresentation(selection.item.key)}
              >
                {selection.item.isPlayerModel
                  ? `Inspect ${selection.item.modelDisplayName}`
                  : `Inspect ${owner.labName}`}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => onAcknowledgePresentation(selection.item.key)}
              >
                Continue
              </button>
            </div>
          </section>
        </div>
      </ModalFocusBoundary>
    );
  }
  return userOverlay?.key === selection.key ? (
    <ModalFocusBoundary key={selection.key} onOpen={() => runtime.pause()}>
      {userOverlay.node}
    </ModalFocusBoundary>
  ) : null;
}
