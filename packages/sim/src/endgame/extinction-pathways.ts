import { contentId, type CompiledContent, type ContentId } from "@neolab/content-schema";

import type { GameState } from "../model/state.ts";
import { randomKey, type RandomKey } from "../random/key.ts";
import type { RandomOracle } from "../random/oracle.ts";

export type ExtinctionPathwayId =
  | "incubation-window"
  | "final-command-chain"
  | "grey-horizon"
  | "empty-patrol"
  | "tomb-atmosphere"
  | "every-side-was-certain";

export const EXTINCTION_ENDING_BY_PATHWAY: Readonly<
  Record<ExtinctionPathwayId, ContentId>
> = {
  "incubation-window": contentId("base:ending.the-incubation-window"),
  "final-command-chain": contentId("base:ending.the-final-command-chain"),
  "grey-horizon": contentId("base:ending.the-grey-horizon"),
  "empty-patrol": contentId("base:ending.the-empty-patrol"),
  "tomb-atmosphere": contentId("base:ending.the-tomb-atmosphere"),
  "every-side-was-certain": contentId("base:ending.every-side-was-certain"),
};

export interface ConcreteExtinctionPathwaySelection {
  readonly pathwayId: ExtinctionPathwayId;
  readonly endingId: ContentId;
  readonly weights: Readonly<Record<ExtinctionPathwayId, number>>;
  readonly randomKey: RandomKey;
  readonly draw: number;
}

function clamp(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function activeFacilityFamilies(
  state: Readonly<GameState>,
  content: CompiledContent,
): ReadonlySet<string> {
  const lab = state.labs[state.run.playerLabId];
  return new Set(
    (lab?.facilities.instances ?? [])
      .map((instance) => content.facilities[instance.definitionId]?.family)
      .filter((family): family is string => family !== undefined),
  );
}

function activeFacilityTags(
  state: Readonly<GameState>,
  content: CompiledContent,
): ReadonlySet<string> {
  const lab = state.labs[state.run.playerLabId];
  return new Set(
    (lab?.facilities.instances ?? []).flatMap(
      (instance) => content.facilities[instance.definitionId]?.tags ?? [],
    ),
  );
}

/**
 * Relative likelihood of each concrete extinction mechanism. These weights
 * select the shape of a catastrophe; they do not change its fatality chance.
 * Every pathway remains possible, but the player's facilities, access grant,
 * deployment route, and political conditions make particular mechanisms more
 * or less plausible.
 */
export function extinctionPathwayWeights(
  state: Readonly<GameState>,
  content: CompiledContent,
): Readonly<Record<ExtinctionPathwayId, number>> {
  if (
    state.endgame.stage !== "rollout" &&
    state.endgame.stage !== "containment-failure"
  ) {
    throw new Error("A live rollout is required to select an extinction pathway");
  }
  const model = state.models[state.endgame.candidateModelId];
  const lab = state.labs[state.run.playerLabId];
  if (model === undefined || lab === undefined) {
    throw new Error("Extinction pathway state incomplete");
  }
  const families = activeFacilityFamilies(state, content);
  const tags = activeFacilityTags(state, content);
  const programme = state.endgame.prosperityProgrammeId;
  const access = clamp(model.accessLevel, 0, 5);
  const laboratoryAccess = Math.max(0, access - 3);
  const rootAccess = access >= 5 ? 1 : 0;
  const accelerated =
    state.endgame.deploymentModeId === "accelerated-autonomous-deployment" ? 1 : 0;
  const publicDeployment =
    state.endgame.deploymentModeId === "guarded-public-deployment" ? 1 : 0;
  const independentOversight =
    state.endgame.deploymentModeId === "government-licensed-deployment" ||
    state.endgame.deploymentModeId === "guarded-public-demonstration"
      ? 1
      : 0;
  const scientificPilot =
    state.endgame.deploymentModeId === "restricted-scientific-pilot" ? 1 : 0;
  const governmentAttention = clamp(lab.politics.governmentAttention) / 100;
  const governmentDistrust = (100 - clamp(lab.politics.governmentTrust)) / 100;
  const strategicDependence = clamp(lab.politics.strategicDependence) / 100;
  const captureConcern = clamp(lab.politics.captureConcern) / 100;
  const defenceIntegration = lab.politics.programmes.includes("defence-applications")
    ? 1
    : 0;
  const governmentIntegration =
    lab.politics.programmes.includes("public-sector-contract") ||
    lab.politics.programmes.includes("national-champion")
      ? 1
      : 0;

  return {
    "incubation-window":
      1 +
      (families.has("biofoundry") ? 8 : 0) +
      (programme === "medicine-biological-discovery" ? 4 : 0) +
      scientificPilot * 2 +
      laboratoryAccess,
    "final-command-chain":
      2 +
      defenceIntegration * 7 +
      governmentIntegration * 2 +
      accelerated * 4 +
      publicDeployment * 2 +
      laboratoryAccess * 1.5 +
      rootAccess * 2 +
      strategicDependence * 3 +
      captureConcern * 2,
    "grey-horizon":
      1 +
      (families.has("nanofoundry") ? 9 : 0) +
      (programme === "materials-manufacturing-abundance" ? 4 : 0) +
      scientificPilot * 2 +
      accelerated * 2 +
      laboratoryAccess +
      rootAccess * 3,
    "empty-patrol":
      1 +
      (families.has("robotics-lab") ? 7 : 0) +
      model.trueCapability.embodiment / 25 +
      accelerated * 3 +
      publicDeployment * 2 +
      laboratoryAccess * 2,
    "tomb-atmosphere":
      1 +
      (tags.has("energy") ? 5 : 0) +
      (programme === "clean-energy-climate-repair" ? 5 : 0) +
      scientificPilot * 2 +
      publicDeployment +
      laboratoryAccess,
    "every-side-was-certain":
      2 +
      governmentDistrust * 4 +
      governmentAttention * 3 +
      strategicDependence * 2 +
      captureConcern * 4 +
      governmentIntegration * 3 +
      publicDeployment * 3 +
      independentOversight * 2 +
      accelerated * 2 +
      rootAccess * 3 +
      (model.trueCapability.language + model.trueCapability.agency) / 50,
  };
}

export function selectConcreteExtinctionPathway(
  state: Readonly<GameState>,
  content: CompiledContent,
  oracle: RandomOracle,
  context: string,
): ConcreteExtinctionPathwaySelection {
  if (
    state.endgame.stage !== "rollout" &&
    state.endgame.stage !== "containment-failure"
  ) {
    throw new Error("A live rollout is required to select an extinction pathway");
  }
  const model = state.models[state.endgame.candidateModelId];
  if (model === undefined) throw new Error("Extinction pathway candidate missing");
  const weights = extinctionPathwayWeights(state, content);
  const key = randomKey(
    "endgame",
    model.id,
    state.endgame.deploymentModeId ??
      state.endgame.incidentOriginStage ??
      "pre-deployment",
    context,
    "extinction-pathway",
  );
  const pathwayId = oracle.weighted(key, weights);
  return {
    pathwayId,
    endingId: EXTINCTION_ENDING_BY_PATHWAY[pathwayId],
    weights,
    randomKey: key,
    draw: oracle.uniform(key),
  };
}
