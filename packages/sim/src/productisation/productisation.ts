import {
  contentId,
  type CompiledContent,
  type DeploymentPolicy,
  type ProductisationMode,
  type ProductisationRecipeDefinition,
} from "@neolab/content-schema";

import { calculateAuraGain, modelLaunchBaseAura } from "../aura/aura.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import { resolveModifierValue } from "../engine/modifier-resolver.ts";
import type { DeepMutable } from "../engine/draft.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { archiveRecoveryPhase } from "../endgame/archive-recovery.ts";
import type { LabId, ModelId, ProjectId } from "../model/ids.ts";
import { calculateFrontierCapability } from "../models/capability.ts";
import {
  formatRunEntityId,
  type GameState,
  type ProjectPayload,
  type ProjectState,
} from "../model/state.ts";
import { cashMillions, rating } from "../model/units.ts";
import { processCapabilityTierMilestones } from "../models/tiers.ts";
import { isProgressiveOpeningCreditAvailable } from "../campaign/progressive-opening.ts";
import {
  recordResearcherCompactActions,
  recordResearcherModelReleaseCompactEvent,
} from "../researchers/compacts.ts";
import type { ProjectHandler } from "../projects/project-framework.ts";

type ProductisationPayload = Extract<ProjectPayload, { readonly kind: "productisation" }>;

const OPEN_API_LAUNCH_AURA_MULTIPLIER = 1.5;

const OPTIMISATION_SCALING_PROGRAMME = "base:domain.optimisation-scaling";
export const MAX_LAUNCH_EXPERIENCE = 20;
const MAX_PRODUCT_QUALITY_EXPERIENCE_BONUS = 7.5;
const MAX_RELIABILITY_EXPERIENCE_BONUS = 12.5;

export interface ProductisationRequest {
  readonly labId: LabId;
  readonly modelId: ModelId;
  readonly mode: ProductisationMode;
}

export interface ProductisationQuote {
  readonly futureProjectId: ProjectId;
  readonly modelId: ModelId;
  readonly mode: ProductisationMode;
  readonly displayName: string;
  readonly durationWeeks: number;
  readonly cashCostMillions: number;
  readonly productQualityEstimate: number;
  readonly reliabilityEstimate: number;
  readonly engineeringBreakdown?: ProductEngineeringBreakdown;
  readonly exposureMultiplier: number;
  readonly incidentDeploymentFactor: number;
  readonly evidencePenalty: number;
  readonly blockers: readonly string[];
}

export interface ProductEngineeringBreakdown {
  readonly frontierCapability: number;
  readonly optimisationResearch: number;
  readonly launchExperience: number;
  readonly maximumLaunchExperience: number;
  readonly trainingPosture: "conservative" | "normal" | "yolo";
  readonly productQuality: {
    readonly base: number;
    readonly capability: number;
    readonly optimisation: number;
    readonly launchExperience: number;
    readonly target: number;
    readonly releaseEngineering: number;
    readonly flatAdjustment: number;
  };
  readonly reliability: {
    readonly base: number;
    readonly capability: number;
    readonly optimisation: number;
    readonly launchExperience: number;
    readonly trainingPosture: number;
    readonly target: number;
    readonly releaseEngineering: number;
    readonly flatAdjustment: number;
  };
}

export interface DeploymentAuraPreview {
  readonly firstPublicLaunch: boolean;
  readonly firstWeightsRelease: boolean;
  readonly rawAura: number;
  readonly auraAward: number;
}

export function quoteDeploymentAura(
  state: Readonly<GameState>,
  content: CompiledContent,
  modelId: ModelId,
  policy: DeploymentPolicy,
): DeploymentAuraPreview {
  const model = state.models[modelId];
  const definition = content.deployment.policies[policy];
  if (model === undefined || definition === undefined) {
    throw new Error("Invalid model deployment Aura quote");
  }
  const firstWeightsRelease =
    policy === "weights-release" &&
    model.flags["deployment:weights-release:aura-awarded"] !== true;
  const firstPublicLaunch =
    policy !== "internal-only" &&
    model.flags["deployment:public-launch:aura-awarded"] !== true;
  const basePublicLaunchAura = firstPublicLaunch
    ? modelLaunchBaseAura(content.aura, model.measuredCapability?.frontierCapability ?? 0)
    : 0;
  const publicLaunchAura =
    policy === "open-api"
      ? Math.ceil(basePublicLaunchAura * OPEN_API_LAUNCH_AURA_MULTIPLIER)
      : basePublicLaunchAura;
  const rawAura = publicLaunchAura + (firstWeightsRelease ? definition.oneTimeAura : 0);
  return {
    firstPublicLaunch,
    firstWeightsRelease,
    rawAura,
    auraAward: calculateAuraGain(state, rawAura, [
      ...(firstPublicLaunch ? ["aura.firstPublicLaunchGain"] : []),
      ...(firstWeightsRelease ? ["aura.openPaperModelOrDatasetGain"] : []),
    ]).final,
  };
}

function requireLab(state: Readonly<GameState>, labId: LabId) {
  const lab = state.labs[labId];
  if (lab === undefined) throw new Error(`Unknown lab ${labId}`);
  return lab;
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function productisationTargetFractions(recipe: ProductisationRecipeDefinition): Readonly<{
  productQuality: number;
  reliability: number;
}> {
  const runtimeRecipe = recipe as unknown as Readonly<Record<string, unknown>>;
  // A development tab can briefly retain the old content bundle while Vite hot
  // reloads simulation code that expects the renamed baseline fields. Supporting
  // both spellings keeps an in-progress run coherent across that mixed-version
  // boundary; freshly compiled content always takes the first branch.
  const productQuality =
    runtimeRecipe["productQualityTowardTarget"] ??
    runtimeRecipe["productQualityTowardBaseline"] ??
    runtimeRecipe["productQualityTowardEngineering"];
  const reliability =
    runtimeRecipe["reliabilityTowardTarget"] ??
    runtimeRecipe["reliabilityTowardBaseline"] ??
    runtimeRecipe["reliabilityTowardEngineering"];
  if (typeof productQuality !== "number" || !Number.isFinite(productQuality)) {
    throw new Error(`Invalid product-quality fraction for ${recipe.mode}`);
  }
  if (typeof reliability !== "number" || !Number.isFinite(reliability)) {
    throw new Error(`Invalid reliability fraction for ${recipe.mode}`);
  }
  return { productQuality, reliability };
}

function trainingPosture(model: Readonly<GameState["models"][ModelId]>) {
  const posture = model.flags["training:posture"];
  return posture === "conservative" || posture === "yolo" ? posture : "normal";
}

export function labLaunchExperience(state: Readonly<GameState>, labId: LabId): number {
  const lab = state.labs[labId];
  if (lab === undefined) return 0;
  const completedLaunches = lab.models.modelIds.reduce((sum, modelId) => {
    const model = state.models[modelId];
    return (
      sum +
      Object.values(model?.deployment.productisationRuns ?? {}).reduce(
        (modelSum, runs) => modelSum + runs,
        0,
      )
    );
  }, 0);
  return Math.min(MAX_LAUNCH_EXPERIENCE, completedLaunches);
}

function productEngineeringBreakdown(
  state: Readonly<GameState>,
  labId: LabId,
  modelId: ModelId,
  recipe: ProductisationRecipeDefinition,
): ProductEngineeringBreakdown {
  const lab = requireLab(state, labId);
  const model = state.models[modelId];
  if (model === undefined) throw new Error(`Unknown model ${modelId}`);
  const fractions = productisationTargetFractions(recipe);
  const frontierCapability = calculateFrontierCapability(model.trueCapability);
  const optimisationResearch =
    lab.research.domains[OPTIMISATION_SCALING_PROGRAMME]?.level ?? 0;
  const launchExperience = labLaunchExperience(state, labId);
  const posture = trainingPosture(model);
  const postureReliability = posture === "conservative" ? 6 : posture === "yolo" ? -8 : 0;

  const qualityBase = 30;
  const qualityCapability = frontierCapability * 0.45;
  const qualityOptimisation = optimisationResearch * 0.22;
  const qualityExperience =
    (launchExperience / MAX_LAUNCH_EXPERIENCE) * MAX_PRODUCT_QUALITY_EXPERIENCE_BONUS;
  const qualityTarget = clamp(
    qualityBase + qualityCapability + qualityOptimisation + qualityExperience,
  );
  const qualityEngineering =
    Math.max(0, qualityTarget - model.productQuality) * fractions.productQuality;

  const reliabilityBase = 40;
  const reliabilityCapability = frontierCapability * 0.2;
  const reliabilityOptimisation = optimisationResearch * 0.25;
  const reliabilityExperience =
    (launchExperience / MAX_LAUNCH_EXPERIENCE) * MAX_RELIABILITY_EXPERIENCE_BONUS;
  const reliabilityTarget = clamp(
    reliabilityBase +
      reliabilityCapability +
      reliabilityOptimisation +
      reliabilityExperience +
      postureReliability,
  );
  const reliabilityEngineering =
    Math.max(0, reliabilityTarget - model.reliability) * fractions.reliability;

  return {
    frontierCapability,
    optimisationResearch,
    launchExperience,
    maximumLaunchExperience: MAX_LAUNCH_EXPERIENCE,
    trainingPosture: posture,
    productQuality: {
      base: qualityBase,
      capability: qualityCapability,
      optimisation: qualityOptimisation,
      launchExperience: qualityExperience,
      target: qualityTarget,
      releaseEngineering: qualityEngineering,
      flatAdjustment: recipe.productQualityFlat,
    },
    reliability: {
      base: reliabilityBase,
      capability: reliabilityCapability,
      optimisation: reliabilityOptimisation,
      launchExperience: reliabilityExperience,
      trainingPosture: postureReliability,
      target: reliabilityTarget,
      releaseEngineering: reliabilityEngineering,
      flatAdjustment: recipe.reliabilityFlat,
    },
  };
}

export function quoteProductisation(
  state: Readonly<GameState>,
  content: CompiledContent,
  request: ProductisationRequest,
): ProductisationQuote {
  const lab = requireLab(state, request.labId);
  const model = state.models[request.modelId];
  const recipe = content.deployment.productisation[request.mode];
  if (recipe === undefined)
    throw new Error(`Unknown productisation mode ${request.mode}`);
  const openingCreditAvailable = isProgressiveOpeningCreditAvailable(
    state,
    request.labId,
    "productisation",
  );
  const cashCostMillions = recipe.cashCostMillions;
  const blockers: string[] = [];
  if (
    request.labId === state.run.playerLabId &&
    archiveRecoveryPhase(state) === "containment"
  ) {
    blockers.push(
      "Candidate containment is in its postmortem phase; productisation resumes during the supervised rebuild",
    );
  }
  if (model === undefined || model.ownerLabId !== request.labId) {
    blockers.push("The selected model is not owned by this lab");
  }
  if (model?.flags["endgame:false-dawn-long-pause-archive"] === true) {
    blockers.push(
      "The model was surrendered to a verified Long Pause archive and cannot be productised",
    );
  }
  if (
    lab.projects.projectIds.some((projectId) => {
      const project = state.projects[projectId];
      return (
        project?.payload.kind === "productisation" &&
        project.payload.modelId === request.modelId &&
        !["completed", "cancelled", "failed"].includes(project.status)
      );
    })
  ) {
    blockers.push("This model already has an active productisation project");
  }
  if (
    cashCostMillions > 0 &&
    lab.finance.cash < cashCostMillions &&
    !openingCreditAvailable
  ) {
    blockers.push("Insufficient cash");
  }
  const engineeringBreakdown =
    model === undefined
      ? undefined
      : productEngineeringBreakdown(state, request.labId, request.modelId, recipe);
  const productQualityEstimate =
    model === undefined || engineeringBreakdown === undefined
      ? 0
      : clamp(
          model.productQuality +
            engineeringBreakdown.productQuality.releaseEngineering +
            engineeringBreakdown.productQuality.flatAdjustment,
        );
  const reliabilityEstimate =
    model === undefined || engineeringBreakdown === undefined
      ? 0
      : clamp(
          model.reliability +
            engineeringBreakdown.reliability.releaseEngineering +
            engineeringBreakdown.reliability.flatAdjustment,
        );
  const isFirstProductisation = !lab.projects.projectIds.some(
    (projectId) => state.projects[projectId]?.payload.kind === "productisation",
  );
  const recurringDuration = resolveModifierValue(
    state,
    "lab.product.durationWeeks",
    recipe.durationWeeks,
    { labId: request.labId, clampMin: 1 },
  ).final;
  // Researcher product-instinct effects apply to every productisation. The
  // separate first-project target remains for explicitly one-off government
  // burdens. Existing projects count even if they later fail or are cancelled,
  // so concurrent starts cannot both be treated as the first authorisation.
  const durationWeeks = Math.max(
    1,
    Math.round(
      isFirstProductisation
        ? resolveModifierValue(
            state,
            "lab.product.firstProject.durationWeeks",
            recurringDuration,
            { labId: request.labId, clampMin: 1 },
          ).final
        : recurringDuration,
    ),
  );
  return {
    futureProjectId: formatRunEntityId(
      "project",
      request.labId,
      state.run.idCounters.project,
    ) as ProjectId,
    modelId: request.modelId,
    mode: request.mode,
    displayName: recipe.displayName,
    durationWeeks,
    cashCostMillions,
    productQualityEstimate,
    reliabilityEstimate,
    ...(engineeringBreakdown === undefined ? {} : { engineeringBreakdown }),
    exposureMultiplier: recipe.exposureMultiplier,
    incidentDeploymentFactor: recipe.incidentDeploymentFactor,
    evidencePenalty: recipe.evidencePenalty,
    blockers,
  };
}

export function startProductisation(
  tx: SimulationTransaction,
  content: CompiledContent,
  request: ProductisationRequest,
): ProjectId {
  const quote = quoteProductisation(tx.read(), content, request);
  if (quote.blockers.length > 0) {
    throw new Error(`Productisation blocked: ${quote.blockers.join("; ")}`);
  }
  const projectId = tx.allocateId("project", request.labId) as ProjectId;
  if (projectId !== quote.futureProjectId) {
    throw new Error("Productisation quote became stale before project creation");
  }
  if (quote.cashCostMillions > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId: request.labId },
        resource: "cash",
        amount: -quote.cashCostMillions,
        financeCategory: "project-cost",
      },
      { kind: "system", id: projectId },
    );
  }
  const project: ProjectState = {
    id: projectId,
    ownerLabId: request.labId,
    definitionId: contentId(`base:project.productisation.${request.mode}`),
    kind: "productisation",
    status: "queued",
    createdAt: tx.read().run.tick,
    expectedDurationWeeks: quote.durationWeeks,
    progress: 0,
    reservations: { majorProjectSlots: 1 },
    assignedResearcherIds: [],
    completionOrder: tx.read().run.idCounters.project - 1,
    payload: {
      kind: "productisation",
      modelId: request.modelId,
      mode: request.mode,
      quotedAt: tx.read().run.tick,
      cashCostMillions: cashMillions(quote.cashCostMillions),
    },
  };
  tx.update((draft) => {
    const lab = draft.labs[request.labId];
    if (lab === undefined) throw new Error(`Unknown lab ${request.labId}`);
    draft.projects[projectId] = structuredClone(project) as DeepMutable<ProjectState>;
    lab.projects.projectIds.push(projectId);
  });
  tx.emit({
    kind: "project-queued",
    labId: request.labId,
    projectId,
    projectKind: "productisation",
  });
  tx.emit({
    kind: "productisation-started",
    labId: request.labId,
    modelId: request.modelId,
    projectId,
    mode: request.mode,
  });
  return projectId;
}

function requirePayload(project: ProjectState): ProductisationPayload {
  if (project.payload.kind !== "productisation") {
    throw new Error(`Project ${project.id} is not productisation`);
  }
  return project.payload;
}

export function completeProductisation(
  tx: SimulationTransaction,
  content: CompiledContent,
  projectId: ProjectId,
): void {
  const project = tx.read().projects[projectId];
  if (project === undefined || project.status !== "active" || project.progress < 1) {
    throw new Error(`Productisation project ${projectId} is not ready to complete`);
  }
  const payload = requirePayload(project);
  const recipe = content.deployment.productisation[payload.mode];
  const model = tx.read().models[payload.modelId];
  const lab = tx.read().labs[project.ownerLabId];
  if (recipe === undefined || model === undefined || lab === undefined) {
    throw new Error(`Productisation completion state missing for ${projectId}`);
  }
  if (model.flags["endgame:false-dawn-long-pause-archive"] === true) {
    // A project can become ready in the same transition that custody changes,
    // or survive in a stale imported state. Recheck the seal at completion so
    // an already-authorised project cannot manufacture a deployment bypass.
    tx.update((draft) => {
      const mutable = draft.projects[projectId];
      if (mutable === undefined) throw new Error(`Unknown project ${projectId}`);
      mutable.status = "cancelled";
    });
    return;
  }
  const quote = quoteProductisation(tx.read(), content, {
    labId: project.ownerLabId,
    modelId: payload.modelId,
    mode: payload.mode,
  });
  const productQuality = quote.productQualityEstimate;
  const reliability = quote.reliabilityEstimate;
  tx.update((draft) => {
    const mutable = draft.models[payload.modelId];
    if (mutable === undefined) throw new Error(`Unknown model ${payload.modelId}`);
    mutable.productQuality = rating(productQuality);
    mutable.reliability = rating(reliability);
    mutable.deployment.productisationRuns[payload.mode] += 1;
    mutable.deployment.exposureMultiplier = Math.min(
      mutable.deployment.exposureMultiplier,
      recipe.exposureMultiplier,
    );
    mutable.deployment.incidentDeploymentFactor *= recipe.incidentDeploymentFactor;
    mutable.deployment.evidencePenalty = rating(
      clamp(mutable.deployment.evidencePenalty + recipe.evidencePenalty),
    );
    const policy = content.deployment.policies[mutable.deployment.policy];
    mutable.deployment.exposure = policy.irreversible
      ? policy.exposure
      : policy.exposure * mutable.deployment.exposureMultiplier;
    mutable.flags[`productisation:${payload.mode}:completed`] = true;
  });
  if (
    model.deployment.plannedPolicy !== undefined &&
    model.deployment.plannedPolicy !== "internal-only"
  ) {
    setModelDeploymentPolicy(
      tx,
      content,
      project.ownerLabId,
      payload.modelId,
      model.deployment.plannedPolicy,
    );
  }
  processCapabilityTierMilestones(tx, content, payload.modelId);
  tx.emit({
    kind: "productisation-completed",
    labId: project.ownerLabId,
    modelId: payload.modelId,
    projectId,
    mode: payload.mode,
    productQuality,
    reliability,
  });
}

export function setModelDeploymentPolicy(
  tx: SimulationTransaction,
  content: CompiledContent,
  labId: LabId,
  modelId: ModelId,
  policy: DeploymentPolicy,
): void {
  if (
    labId === tx.read().run.playerLabId &&
    archiveRecoveryPhase(tx.read()) === "containment" &&
    policy !== "internal-only"
  ) {
    throw new Error(
      "Candidate containment is in its postmortem phase; external deployment is locked",
    );
  }
  const model = tx.read().models[modelId];
  const lab = tx.read().labs[labId];
  const definition = content.deployment.policies[policy];
  if (
    model === undefined ||
    model.ownerLabId !== labId ||
    lab === undefined ||
    definition === undefined
  ) {
    throw new Error("Invalid model deployment policy change");
  }
  if (
    model.flags["endgame:false-dawn-long-pause-archive"] === true &&
    policy !== "internal-only"
  ) {
    throw new Error(
      "The model was surrendered to a verified Long Pause archive and cannot be deployed",
    );
  }
  if (model.deployment.irreversible) {
    throw new Error("Released weights cannot be made exclusive again");
  }
  const runCount = Object.values(model.deployment.productisationRuns).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (
    ["research-preview", "guarded-api", "open-api", "weights-release"].includes(policy) &&
    runCount === 0
  ) {
    tx.update((draft) => {
      const mutableModel = draft.models[modelId];
      if (mutableModel === undefined) throw new Error("Deployment target disappeared");
      mutableModel.deployment.plannedPolicy = policy;
      mutableModel.deployment.changedAt = draft.run.tick;
    });
    return;
  }
  const launch = quoteDeploymentAura(tx.read(), content, modelId, policy);
  tx.update((draft) => {
    const mutableModel = draft.models[modelId];
    const mutableLab = draft.labs[labId];
    if (mutableModel === undefined || mutableLab === undefined) {
      throw new Error("Deployment target disappeared");
    }
    mutableModel.deployment.policy = policy;
    delete mutableModel.deployment.plannedPolicy;
    mutableModel.deployment.exposure = definition.irreversible
      ? definition.exposure
      : definition.exposure * mutableModel.deployment.exposureMultiplier;
    mutableModel.deployment.irreversible = definition.irreversible;
    mutableModel.deployment.changedAt = draft.run.tick;
    if (policy !== "internal-only" && policy !== "weights-release") {
      mutableLab.models.commercialModelId = modelId;
    } else if (mutableLab.models.commercialModelId === modelId) {
      delete mutableLab.models.commercialModelId;
    }
    if (launch.firstWeightsRelease) {
      mutableModel.flags["deployment:weights-release:aura-awarded"] = true;
    }
    if (launch.firstPublicLaunch) {
      mutableModel.flags["deployment:public-launch:aura-awarded"] = true;
    }
  });
  if (launch.auraAward > 0) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId },
        resource: "aura-spendable",
        amount: launch.auraAward,
        auraChangeKind: "gain",
        auraCategory: "model-launch",
        auraSignalImpact: launch.auraAward * content.aura.modelLaunchSignalImpactPerAura,
      },
      { kind: "system", id: `model-launch:${modelId}` },
    );
  }
  recordResearcherModelReleaseCompactEvent(
    tx,
    content,
    labId,
    model.measuredCapability?.frontierCapability ?? 0,
    policy,
  );
  const recordsOpenModel =
    (policy === "open-api" || policy === "weights-release") &&
    model.flags["compact:open-model-recorded"] !== true;
  if (recordsOpenModel) {
    tx.update((draft) => {
      const mutableModel = draft.models[modelId];
      if (mutableModel !== undefined) {
        mutableModel.flags["compact:open-model-recorded"] = true;
      }
    });
    recordResearcherCompactActions(tx, content, labId, ["open-model"]);
  }
  tx.emit({ kind: "model-deployment-changed", labId, modelId, policy });
}

export const PRODUCTISATION_PROJECT_HANDLER: ProjectHandler<"productisation"> = {
  kind: "productisation",
  advance(tx, _content, project): void {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.progress = Math.min(
        1,
        mutable.progress + 1 / mutable.expectedDurationWeeks,
      );
    });
  },
  complete(tx, content, project): void {
    completeProductisation(tx, content, project.id);
  },
  cancel(tx, project): void {
    tx.update((draft) => {
      const mutable = draft.projects[project.id];
      if (mutable === undefined) throw new Error(`Unknown project ${project.id}`);
      mutable.status = "cancelled";
    });
  },
};
