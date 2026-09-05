import type { SimulationTransaction } from "../engine/transaction.ts";
import type { LabId, ModelId } from "../model/ids.ts";
import type { PresentationItemState } from "../model/state.ts";
import type { Tick } from "../model/units.ts";

export type RivalCandidateSetbackOutcome = Extract<
  PresentationItemState,
  { readonly kind: "rival-candidate-setback" }
>["outcome"];

export interface QueueRivalCandidateSetbackInput {
  readonly outcome: RivalCandidateSetbackOutcome;
  readonly labId: LabId;
  readonly modelId: ModelId;
  readonly countdownStartedAt: Tick;
}

/**
 * Persist a public rival-candidacy setback at the same atomic transition that
 * closes its countdown. The queue record contains only public identifiers and
 * timing; hidden resolution probabilities and draws never cross this boundary.
 */
export function queueRivalCandidateSetback(
  tx: SimulationTransaction,
  input: QueueRivalCandidateSetbackInput,
): void {
  const state = tx.read();
  const rival = state.world.rivals[input.labId];
  const lab = state.labs[input.labId];
  const model = state.models[input.modelId];
  if (
    rival === undefined ||
    lab?.control !== "rival" ||
    model?.ownerLabId !== input.labId
  ) {
    throw new Error(
      `Cannot present a rival candidate setback for ${input.labId}:${input.modelId}`,
    );
  }
  if (input.countdownStartedAt > state.run.tick) {
    throw new Error("Rival candidate setback cannot precede its countdown");
  }
  const key = [
    "rival-candidate-setback",
    input.outcome,
    input.labId,
    input.modelId,
    String(input.countdownStartedAt),
  ].join(":");
  if (state.presentationQueue.some((item) => item.key === key)) return;

  tx.update((draft) => {
    if (draft.presentationQueue.some((item) => item.key === key)) return;
    draft.presentationQueue.push({
      key,
      kind: "rival-candidate-setback",
      attention: "modal",
      outcome: input.outcome,
      labId: input.labId,
      modelId: input.modelId,
      createdAt: draft.run.tick,
      countdownStartedAt: input.countdownStartedAt,
    });
  });
}
