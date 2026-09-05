import type { GameView } from "@neolab/sim/public";

type ModelCard = GameView["models"]["cards"][number];
type TrainingParentCandidate = Pick<ModelCard, "modelId" | "trainingParentEligible">;

export interface TrainingParentOptions<
  Candidate extends TrainingParentCandidate = ModelCard,
> {
  readonly eligibleModels: readonly Candidate[];
  readonly sealedModelCount: number;
  readonly initialParentModelId: string;
}

/**
 * Resolve the parent picker entirely from player-safe model-card custody data.
 * A sealed archive is never offered, even when it remains the caller's stale
 * initial selection. If every prior checkpoint is sealed, an empty selection
 * deliberately requests the sim's fresh-lineage training path.
 */
export function trainingParentOptions<Candidate extends TrainingParentCandidate>(
  models: readonly Candidate[],
  currentModelId: string | undefined,
  requestedModelId?: string,
): TrainingParentOptions<Candidate> {
  const eligibleModels = models.filter((model) => model.trainingParentEligible);
  const eligibleIds = new Set(eligibleModels.map((model) => model.modelId));
  const initialParentModelId =
    [requestedModelId, currentModelId, eligibleModels.at(-1)?.modelId].find(
      (modelId): modelId is string => modelId !== undefined && eligibleIds.has(modelId),
    ) ?? "";
  return {
    eligibleModels,
    sealedModelCount: models.length - eligibleModels.length,
    initialParentModelId,
  };
}
