import type { EventQueueItemView, PresentationQueueItemView } from "@neolab/sim/public";

export type OverlayTier = "critical" | "discovery" | "urgent" | "decision" | "user";

export type OverlaySelection =
  | {
      readonly kind: "event";
      readonly tier: "critical" | "urgent" | "decision" | "user";
      readonly item: EventQueueItemView;
    }
  | {
      readonly kind: "presentation";
      readonly tier: "discovery";
      readonly item: PresentationQueueItemView;
    }
  | { readonly kind: "user"; readonly tier: "user"; readonly key: string };

export interface OverlayPolicyInput {
  readonly events: readonly EventQueueItemView[];
  readonly presentations: readonly PresentationQueueItemView[];
  readonly deferredEventIds: ReadonlySet<string>;
  readonly exclusiveSequenceActive?: boolean;
  readonly requestedEventId?: string;
  readonly userOverlayKey?: string;
}

function highestPriority(
  items: readonly EventQueueItemView[],
): EventQueueItemView | undefined {
  return [...items].sort(
    (left, right) =>
      right.priority - left.priority ||
      left.createdAtTick - right.createdAtTick ||
      (left.instanceId < right.instanceId ? -1 : 1),
  )[0];
}

/**
 * Full-screen terminal sequences are exclusive. Otherwise: critical > Deployment Crisis
 * decision > discovery > urgent > ordinary decision > user.
 */
export function chooseOverlay(input: OverlayPolicyInput): OverlaySelection | undefined {
  if (input.exclusiveSequenceActive === true) return undefined;

  // Endgame outcomes, proof verdicts, and a collapsed rival candidacy are
  // high-attention records, not ambient notices. They must not sit behind an
  // older discovery or stale crisis overlay. Presenting a rival setback pauses
  // the browser clock only while its modal is open; it does not create a
  // canonical simulation blocker.
  const highAttentionResult = input.presentations.find(
    (item) =>
      (item.kind === "endgame-return" ||
        item.kind === "moratorium-result" ||
        item.kind === "rival-candidate-setback" ||
        item.kind === "model-incident-result" ||
        item.kind === "candidate-containment-incident") &&
      item.attention === "modal",
  );
  const capabilityProofResult = input.presentations.find(
    (item) => item.kind === "capability-proof-result" && item.attention === "modal",
  );
  const highAttentionPresentation = highAttentionResult ?? capabilityProofResult;
  if (highAttentionPresentation !== undefined) {
    return {
      kind: "presentation",
      tier: "discovery",
      item: highAttentionPresentation,
    };
  }

  const critical = highestPriority(
    input.events.filter((item) => item.severity === "critical"),
  );
  if (critical !== undefined) return { kind: "event", tier: "critical", item: critical };

  if (input.userOverlayKey?.startsWith("crisis-decision:") === true) {
    return { kind: "user", tier: "user", key: input.userOverlayKey };
  }

  const presentation = input.presentations.find((item) => item.attention === "modal");
  if (presentation !== undefined) {
    return { kind: "presentation", tier: "discovery", item: presentation };
  }

  const urgent = highestPriority(
    input.events.filter(
      (item) =>
        item.severity === "urgent" && !input.deferredEventIds.has(item.instanceId),
    ),
  );
  if (urgent !== undefined) return { kind: "event", tier: "urgent", item: urgent };

  const decision = highestPriority(
    input.events.filter(
      (item) =>
        item.severity === "decision" && !input.deferredEventIds.has(item.instanceId),
    ),
  );
  if (decision !== undefined) {
    return { kind: "event", tier: "decision", item: decision };
  }

  const requested = input.events.find(
    (item) => item.instanceId === input.requestedEventId,
  );
  if (requested !== undefined) return { kind: "event", tier: "user", item: requested };

  return input.userOverlayKey === undefined
    ? undefined
    : { kind: "user", tier: "user", key: input.userOverlayKey };
}
