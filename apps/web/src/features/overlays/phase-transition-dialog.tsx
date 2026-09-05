import type { ReactElement } from "react";

import {
  FRONTIER_PHASE_FRONTIER_CAPABILITY,
  SCALING_PHASE_FRONTIER_CAPABILITY,
} from "@neolab/sim/public";

import type { BrowserContent } from "../../app/runtime-provider.tsx";

function prerequisiteMentionsPhase(node: unknown, phase: string): boolean {
  if (node === null || typeof node !== "object") return false;
  const record = node as Record<string, unknown>;
  if (record["kind"] === "phase-at-least" && record["phase"] === phase) return true;
  return Object.values(record).some((value) =>
    Array.isArray(value)
      ? value.some((item) => prerequisiteMentionsPhase(item, phase))
      : prerequisiteMentionsPhase(value, phase),
  );
}

function papersUnlockedByPhase(content: BrowserContent, phase: string): number {
  return Object.values(content.papers.definitions).filter((paper) =>
    prerequisiteMentionsPhase(paper.prerequisites, phase),
  ).length;
}

function facilityTierUnlockedByPhase(phase: "scaling" | "frontier"): number {
  return phase === "scaling" ? 2 : 3;
}

export function facilitiesUnlockedByPhase(
  content: BrowserContent,
  phase: "scaling" | "frontier",
): readonly string[] {
  const tier = facilityTierUnlockedByPhase(phase);
  return Object.values(content.facilities)
    .filter((facility) => facility.tier === tier)
    .map((facility) => facility.displayName)
    .sort((left, right) => left.localeCompare(right));
}

const PHASE_COPY = {
  scaling: {
    title: "The Scaling era begins",
    trigger: `World capability has reached ${String(SCALING_PHASE_FRONTIER_CAPABILITY)}. Compute, capital, and headcount now set the pace.`,
    next: `The Frontier era begins when any lab's model reaches Frontier Capability ${String(FRONTIER_PHASE_FRONTIER_CAPABILITY)}.`,
  },
  frontier: {
    title: "The Frontier era begins",
    trigger: `World capability has reached ${String(FRONTIER_PHASE_FRONTIER_CAPABILITY)}. The race now turns on capability and safety evidence.`,
    next: "AGI candidacy is ahead. Build evidence before you need it.",
  },
} as const;

export function PhaseTransitionDialog({
  phase,
  content,
  onReviewFacilities,
  onReviewResearch,
  onContinue,
}: {
  readonly phase: "scaling" | "frontier";
  readonly content: BrowserContent;
  readonly onReviewFacilities: () => void;
  readonly onReviewResearch: () => void;
  readonly onContinue: () => void;
}): ReactElement {
  const copy = PHASE_COPY[phase];
  const unlockedFacilities = facilitiesUnlockedByPhase(content, phase);
  const unlockedPapers = papersUnlockedByPhase(content, phase);
  return (
    <div className="modal-backdrop">
      <section
        className="purchase-dialog phase-transition-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="phase-transition-title"
      >
        <p className="eyebrow">WORLD SHIFT // GLOBAL RACE</p>
        <h2 id="phase-transition-title">{copy.title}</h2>
        <p>{copy.trigger}</p>
        <section className="phase-transition-unlocks" aria-label="New era unlocks">
          {unlockedFacilities.length > 0 ? (
            <div>
              <p className="eyebrow">FACILITIES // NEW PLANS</p>
              <strong>
                {unlockedFacilities.length} new facility
                {unlockedFacilities.length === 1 ? " plan is" : " plans are"} now
                available
              </strong>
              <p>{unlockedFacilities.join(" · ")}</p>
            </div>
          ) : null}
          {unlockedPapers > 0 ? (
            <div>
              <p className="eyebrow">RESEARCH // NEW HORIZONS</p>
              <strong>
                {unlockedPapers} landmark research results are now discoverable
              </strong>
            </div>
          ) : null}
        </section>
        <p className="phase-transition-next">{copy.next}</p>
        <div className="exit-dialog-actions">
          <button className="secondary" type="button" onClick={onContinue}>
            Continue
          </button>
          <button className="secondary" type="button" onClick={onReviewResearch}>
            Open research tree
          </button>
          <button
            className="primary"
            type="button"
            autoFocus
            onClick={onReviewFacilities}
          >
            Open facilities
          </button>
        </div>
      </section>
    </div>
  );
}
