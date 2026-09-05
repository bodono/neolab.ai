import type { CompiledContent } from "@neolab/content-schema";

import {
  createNewGame,
  FIRST_MODEL_BOOTSTRAP_RUNWAY_MILLIONS,
  FULL_GAME_CASH_GRANT_CLAIMED_FLAG,
  FULL_GAME_CASH_GRANT_TARGET,
  type NewGameConfig,
} from "../engine/create-new-game.ts";
import { applyEffect } from "../engine/effect-executor.ts";
import type { DeepMutable } from "../engine/draft.ts";
import { assertInvariants } from "../engine/invariants.ts";
import type { SimulationTransaction } from "../engine/transaction.ts";
import { deepFreeze } from "../engine/transaction.ts";
import type { GameCommand } from "../commands/types.ts";
import type { GameState } from "../model/state.ts";
import { cashMillions } from "../model/units.ts";
import {
  AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE,
  AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY,
} from "../models/capability.ts";
import {
  PROGRESSIVE_AUTONOMY_CAPABILITY,
  PROGRESSIVE_PRODUCT_CAPABILITY,
  PROGRESSIVE_SAFETY_CAPABILITY,
} from "./lab-maturity-constants.ts";
import {
  LAB_MATURITY_STAGES,
  LAB_MATURITY_STAGE_FLAG,
  PROGRESSIVE_CAMPAIGN_FLAG,
  type LabMaturityStage,
} from "./progressive-opening.ts";

export {
  FOUNDATION_SUCCESSOR_CHECKPOINT_DIFFICULTY_REDUCTION,
  PROGRESSIVE_AUTONOMY_CAPABILITY,
  PROGRESSIVE_PRODUCT_CAPABILITY,
  PROGRESSIVE_SAFETY_CAPABILITY,
} from "./lab-maturity-constants.ts";
export {
  isProgressiveOpeningProtected,
  LAB_MATURITY_STAGES,
  LAB_MATURITY_STAGE_FLAG,
  PROGRESSIVE_CAMPAIGN_FLAG,
  type LabMaturityStage,
} from "./progressive-opening.ts";
export const LAB_MATURITY_STAGE_ENTERED_AT_FLAG =
  "campaign:lab-maturity-stage-entered-at";
export const INSTITUTION_WORLD_REVIEWED_FLAG = "campaign:institution-world-reviewed";
export const FOUNDATION_RESEARCH_COMMITTED_FLAG =
  "campaign:foundation-research-committed";
export const FOUNDATION_RESEARCH_BASELINE_FLAG = "campaign:foundation-research-baseline";
export const TRAINING_AUTHORISED_STAGE_FLAG = "campaign:training-authorised-stage";
const SERVER_RACK_FACILITY_ID = "base:facility.server-rack";
const PRESS_OFFICE_FACILITY_ID = "base:facility.press-office";
const EXPANDED_OPENING_FLEET_GPUS = 4_000;

/**
 * A progressive campaign begins before the lab owns GPUs, but $45m made the
 * garage feel pre-funded rather than precarious. Twelve extra millions above
 * the authored $18m baseline leaves a standard lab with $30m: enough to buy a
 * first cluster, train, and productise once without making the
 * pre-revenue interval toothless.
 * Deferred leader and mandate backing remains recorded for the full-game handoff.
 */
export const PROGRESSIVE_GARAGE_BOOTSTRAP_RUNWAY_MILLIONS = 12;

/** First real customer revenue turns the prototype into fundraising credibility. */
export const PROTOTYPE_TRACTION_AURA_AWARD = 8;

/**
 * The founding team gets one short research sprint before ordinary scaling
 * economics take over. Without it, a single early programme level can consume
 * several dozen pre-revenue weeks even after the Server Rack is built.
 */
export const FOUNDATION_RESEARCH_SPRINT_MULTIPLIER = 4;
export const FOUNDATION_RESEARCH_SPRINT_WEEKS = 12;

export type LabFeature =
  | "compute"
  | "models"
  | "productisation"
  | "evaluations"
  | "fundraising"
  | "finances"
  | "facilities"
  | "people"
  | "research"
  | "world"
  | "bonuses"
  | "autonomy"
  | "agi";

export type LabDashboardSection =
  | "overview"
  | "compute"
  | "facilities"
  | "research"
  | "models"
  | "agi"
  | "evaluations"
  | "people"
  | "world"
  | "finances"
  | "bonuses";

export interface LabMaturityStageDefinition {
  readonly stage: LabMaturityStage;
  readonly chapter: string;
  readonly title: string;
  readonly narrative: string;
  readonly mechanic: string;
  readonly unlocked: readonly string[];
  readonly directive: string;
  readonly features: readonly LabFeature[];
  readonly visibleSections: readonly LabDashboardSection[];
  readonly completionBriefing?: LabMaturityCompletionBriefing;
}

export interface LabMaturityCompletionBriefing {
  readonly eyebrow: string;
  readonly objective: string;
  readonly summary: string;
  readonly requirements: readonly string[];
  readonly note: string;
}

const DEFINITIONS: Readonly<Record<LabMaturityStage, LabMaturityStageDefinition>> = {
  garage: {
    stage: "garage",
    chapter: "CHAPTER 01 // THE GARAGE",
    title: "So, you decided to start a neolab.",
    narrative:
      "Your goal: build safe superintelligence for the benefit of all humanity. For now, your lab operates from your parents' garage—and they want it back. But first: get some compute.",
    mechanic:
      "GPUs provide the compute used for research and model training. More compute advances research faster and can produce more capable models.",
    unlocked: [
      "GPU procurement",
      "Compute planning",
      "Family & friends credit · required chapter costs may overdraw cash",
    ],
    directive: "Buy the lab's first block of GPUs, then let the delivery arrive.",
    features: ["compute"],
    visibleSections: ["overview", "compute"],
  },
  cluster: {
    stage: "cluster",
    chapter: "CHAPTER 02 // FIRST LIGHT",
    title: "The garage is thinking.",
    narrative:
      "Your first cluster is online. The power meter is spinning; the GPUs are waiting. Train your first-ever model.",
    mechanic:
      "Training combines the lab's research with committed GPU compute to create a new model. More total training FLOP generally produces a stronger model.",
    unlocked: ["Model training", "GPU allocation"],
    directive: "Authorise your first training run.",
    features: ["compute", "models"],
    visibleSections: ["overview", "compute", "models"],
  },
  model: {
    stage: "model",
    chapter: "CHAPTER 03 // YOU ARE NOT ALONE",
    title: "The race is on.",
    narrative:
      "While you were wiring GPUs in a garage, four other labs were already moving. Find out how fast they're going.",
    mechanic:
      "Your goal is to build and safely deploy AGI before a rival does. Rival capabilities are uncertain estimates—inspect each lab to see who may be ahead.",
    unlocked: ["World and rival intelligence"],
    directive: "Open World and meet the competition.",
    features: ["compute", "models", "world"],
    visibleSections: ["overview", "compute", "models", "world"],
  },
  startup: {
    stage: "startup",
    chapter: "CHAPTER 04 // OUT OF THE GARAGE",
    title: "Your parents have run out of patience.",
    narrative:
      "Your parents co-sign the lab's opening credit line—partly because a server rack is the fastest way to get their garage back.",
    mechanic:
      "Facilities expand the lab. Compute facilities add GPU capacity; later buildings can add project space, research bonuses and other permanent advantages.",
    unlocked: ["Facilities", "The Server Rack"],
    directive: "Build the Server Rack and bring the expanded cluster online.",
    features: ["compute", "models", "facilities", "world"],
    visibleSections: ["overview", "compute", "facilities", "models", "world"],
  },
  foundation: {
    stage: "foundation",
    chapter: "CHAPTER 05 // BETTER IDEAS",
    title: "Compute alone won't get us to superintelligence.",
    narrative:
      "More GPUs help. Better ideas help more. Point the cluster at a research question, then use what you learn to train a stronger successor.",
    mechanic:
      "GPU compute allocated to research advances permanent programmes. Capability research strengthens future models; safety research improves future model safety, evidence or lab defences. Research does not change models already trained.",
    unlocked: [
      "Capability research",
      "Safety research",
      `Founding-team sprint · ×${String(FOUNDATION_RESEARCH_SPRINT_MULTIPLIER)} for ${String(FOUNDATION_RESEARCH_SPRINT_WEEKS)} weeks`,
      "Research breakthrough · FC 5 successor recipe",
    ],
    directive: "Advance one capability programme, then train an FC 5 successor.",
    features: ["compute", "models", "facilities", "research", "world"],
    visibleSections: ["overview", "compute", "facilities", "research", "models", "world"],
  },
  product: {
    stage: "product",
    chapter: "CHAPTER 06 // A PRODUCT",
    title: "People would pay for this.",
    narrative:
      "At FC 5, your model is more than just a demo. Turn it into a product, give customers access, and make the lab's first dollar.",
    mechanic:
      "Internal models earn no revenue. Prepare a launch, choose its access and allocate GPUs to serving. Serving more customer demand generates more revenue and Aura—but broader access creates more risk.",
    unlocked: ["Model launches", "Managed serving"],
    directive: "Prepare and launch the model, allocate serving GPUs, and earn revenue.",
    features: ["compute", "models", "productisation", "facilities", "research", "world"],
    visibleSections: ["overview", "compute", "facilities", "research", "models", "world"],
  },
  funding: {
    stage: "funding",
    chapter: "CHAPTER 07 // THE PITCH",
    title: "Turns out, neolabs need a lot of money.",
    narrative:
      "Customers make the lab credible. Now turn that credibility into runway—if you survive the pitch.",
    mechanic:
      "Fundraising spends Aura and time to generate offers. Larger campaigns cost more Aura but can raise more cash. Compare the cash, valuation and attached conditions before accepting.",
    unlocked: [
      "Fundraising",
      "Valuation and financial detail",
      "+8 Aura · Prototype traction",
    ],
    directive: "Raise a round and accept one offer.",
    features: [
      "compute",
      "models",
      "productisation",
      "fundraising",
      "finances",
      "facilities",
      "research",
      "world",
    ],
    visibleSections: [
      "overview",
      "compute",
      "facilities",
      "research",
      "models",
      "world",
      "finances",
    ],
  },
  lab: {
    stage: "lab",
    chapter: "CHAPTER 08 // THE TEAM",
    title: "Time to hire someone smarter than you.",
    narrative:
      "The lab is becoming an institution, which is founder language for hiring someone who knows what they are doing.",
    mechanic:
      "Researchers accelerate the workstreams they lead and bring unique abilities to the lab. Recruiting costs cash and Aura, salaries continue afterward, and some researchers expect recurring promises to be kept.",
    unlocked: ["Researcher recruitment", "Workstream leadership"],
    directive: "Recruit one researcher and assign them to lead a workstream.",
    features: [
      "compute",
      "models",
      "productisation",
      "fundraising",
      "finances",
      "facilities",
      "research",
      "people",
      "world",
    ],
    visibleSections: [
      "overview",
      "compute",
      "facilities",
      "research",
      "models",
      "people",
      "world",
      "finances",
    ],
  },
  institution: {
    stage: "institution",
    chapter: "CHAPTER 09 // BUILD DELIBERATELY",
    title: "Every breakthrough needs a press release.",
    narrative:
      "Build a Press Office for steady Aura. Then grow however the next model demands—more GPUs, researchers, facilities, funding, or research—and train toward FC 10.",
    mechanic:
      "The Press Office generates 1 Aura every four weeks. Aura pays for recruitment and fundraising. Reaching FC 10 may require more research, GPUs, facilities, people or funding—and must be achieved by a newly trained successor.",
    unlocked: [
      "Research programmes",
      "Bonuses and penalties",
      "Press Office · +1 Aura every 4 weeks",
    ],
    directive: "Build the Press Office, then scale the lab and train an FC 10 model.",
    features: [
      "compute",
      "models",
      "productisation",
      "fundraising",
      "finances",
      "facilities",
      "people",
      "research",
      "world",
      "bonuses",
    ],
    visibleSections: [
      "overview",
      "compute",
      "facilities",
      "research",
      "models",
      "people",
      "world",
      "finances",
      "bonuses",
    ],
  },
  safety: {
    stage: "safety",
    chapter: "CHAPTER 10 // THE MODEL MAY BE DANGEROUS",
    title: "Do we really know what our model is thinking?",
    narrative:
      "At FC 10, capability is no longer a harmless benchmark. Find out what the model wants, what it notices, and whether it can be stopped—and start funding the work that will let you answer that about its successors.",
    mechanic:
      "Evaluations reveal uncertain readings of a model's hidden safety; they do not change the model. Running them also builds permanent Safety Practice—your lab's safety muscle—so evaluating earlier models prepares the lab for more dangerous successors. Safety research is funded the same way capability is, out of the same R&D compute: it raises the safety of future models and the lab's ability to see what they are doing. From here, a lab that spends everything on capability is building something it cannot inspect.",
    unlocked: [
      "Safety and evaluations",
      "Model safety case",
      "Safety research floor · 30% of R&D compute",
    ],
    directive:
      "Give safety research at least 30% of R&D compute, evaluate the model, then scale as needed and train an FC 20 successor.",
    features: [
      "compute",
      "models",
      "productisation",
      "evaluations",
      "fundraising",
      "finances",
      "facilities",
      "people",
      "research",
      "world",
      "bonuses",
    ],
    visibleSections: [
      "overview",
      "compute",
      "facilities",
      "research",
      "models",
      "evaluations",
      "people",
      "world",
      "finances",
      "bonuses",
    ],
  },
  autonomy: {
    stage: "autonomy",
    chapter: "CHAPTER 11 // THE MODEL JOINS THE LAB",
    title: "The model has some ideas about how to make things go faster.",
    narrative:
      "At FC 20, it can accelerate the research that creates its successor. Every permission makes it more useful—and harder to contain.",
    mechanic:
      "This is recursive self-improvement: the current model helps research and build a more capable successor. Greater capability and access produce more research, but also increase exposure and incident risk. Reducing access later cannot undo previous exposure.",
    unlocked: ["The Autonomy Programme", "Recursive self-improvement"],
    directive: "In AGI & RSI, grant it Access Level 1 · Fixed evaluation sandbox.",
    features: [
      "compute",
      "models",
      "productisation",
      "evaluations",
      "fundraising",
      "finances",
      "facilities",
      "people",
      "research",
      "world",
      "bonuses",
      "autonomy",
    ],
    visibleSections: [
      "overview",
      "compute",
      "facilities",
      "research",
      "models",
      "agi",
      "evaluations",
      "people",
      "world",
      "finances",
      "bonuses",
    ],
  },
  frontier: {
    stage: "frontier",
    chapter: "CHAPTER 12 // THE FRONTIER",
    title: "Now build the future.",
    narrative:
      "Everything so far was preparation. Build an AGI, prove it is safe enough to deploy, and reach the finish line before someone less careful does.",
    mechanic:
      "The full game is now open. Launch models to earn revenue and Aura, raise funds and recruit specialists, expand compute with GPUs and facilities, invest that compute in research, and train increasingly capable successors. Evaluate models early to build evidence and Safety Practice, strengthen the lab's defences, and complete the four Candidate Programme works. Your goal is to prove and safely deploy AGI before a rival does—without losing control along the way.",
    unlocked: ["AGI Candidate Programme", "Recursive self-improvement", "The full game"],
    directive: "Train and deploy a safe AGI.",
    features: [
      "compute",
      "models",
      "productisation",
      "evaluations",
      "fundraising",
      "finances",
      "facilities",
      "people",
      "research",
      "world",
      "bonuses",
      "autonomy",
      "agi",
    ],
    visibleSections: [
      "overview",
      "compute",
      "facilities",
      "research",
      "models",
      "agi",
      "evaluations",
      "people",
      "world",
      "finances",
      "bonuses",
    ],
    completionBriefing: {
      eyebrow: "FINAL OBJECTIVE // THE SINGULARITY",
      objective: "Train and deploy a safe AGI.",
      summary: "Prove capability, assess safety, retain control, and decide deployment.",
      requirements: [
        `FC ${String(AGI_CANDIDATE_MINIMUM_FRONTIER_CAPABILITY)}+; every capability ${String(AGI_CANDIDATE_MINIMUM_CAPABILITY_ATTRIBUTE)}+.`,
        "Complete all four Candidate Programme works.",
        "Nominate one exact model.",
        "Build evidence, choose a route, and retain control.",
      ],
      note: "Training FLOP is not a gate. Evaluations reveal risk; they do not change the model.",
    },
  },
};

const FEATURE_STAGE: Readonly<Record<LabFeature, LabMaturityStage>> = {
  compute: "garage",
  models: "cluster",
  productisation: "product",
  evaluations: "safety",
  fundraising: "funding",
  finances: "funding",
  facilities: "startup",
  people: "lab",
  research: "foundation",
  world: "model",
  bonuses: "institution",
  autonomy: "autonomy",
  agi: "frontier",
};

function stageIndex(stage: LabMaturityStage): number {
  return LAB_MATURITY_STAGES.indexOf(stage);
}

/** Safety's minimum share of R&D compute from the safety chapter on. */
export const SAFETY_RESEARCH_SHARE_BASIS_POINTS = 3000;

/**
 * The campaign opens at 7500 basis points of capability, so clearing this is a
 * deliberate move rather than one the player drifts into.
 */
export function hasSafetyResearchShare(state: Readonly<GameState>): boolean {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return false;
  return (
    lab.compute.allocation.capabilityBasisPoints <=
    10_000 - SAFETY_RESEARCH_SHARE_BASIS_POINTS
  );
}

export function labMaturityDefinition(
  stage: LabMaturityStage,
): LabMaturityStageDefinition {
  return DEFINITIONS[stage];
}

export function isProgressiveCampaign(state: Readonly<GameState>): boolean {
  return state.labs[state.run.playerLabId]?.flags[PROGRESSIVE_CAMPAIGN_FLAG] === true;
}

export function labMaturityStage(state: Readonly<GameState>): LabMaturityStage {
  const stored = state.labs[state.run.playerLabId]?.flags[LAB_MATURITY_STAGE_FLAG];
  return typeof stored === "string" &&
    LAB_MATURITY_STAGES.includes(stored as LabMaturityStage)
    ? (stored as LabMaturityStage)
    : "frontier";
}

export function labFeatureUnlocked(
  state: Readonly<GameState>,
  feature: LabFeature,
): boolean {
  if (!isProgressiveCampaign(state)) return true;
  return stageIndex(labMaturityStage(state)) >= stageIndex(FEATURE_STAGE[feature]);
}

export function shouldHoldAmbientSimulation(state: Readonly<GameState>): boolean {
  return isProgressiveCampaign(state) && !labFeatureUnlocked(state, "world");
}

function hasOnlineGpus(state: Readonly<GameState>): boolean {
  const lab = state.labs[state.run.playerLabId];
  return lab?.compute.lots.some((lot) => lot.physicalCount > 0) === true;
}

function onlineGpuCount(state: Readonly<GameState>): number {
  const lab = state.labs[state.run.playerLabId];
  return lab?.compute.lots.reduce((total, lot) => total + lot.physicalCount, 0) ?? 0;
}

function hasExpandedOpeningFleet(state: Readonly<GameState>): boolean {
  return onlineGpuCount(state) >= EXPANDED_OPENING_FLEET_GPUS;
}

function hasModel(state: Readonly<GameState>): boolean {
  const lab = state.labs[state.run.playerLabId];
  return (lab?.models.modelIds.length ?? 0) > 0;
}

function hasCommercialProof(state: Readonly<GameState>): boolean {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return false;
  const earnedRevenue = Object.values(lab.market.segments).some(
    (segment) =>
      segment.accruedRevenueMillions > 0 || segment.lastCycleRevenueMillions > 0,
  );
  return lab.models.modelIds.some((modelId) => {
    const model = state.models[modelId];
    if (model === undefined) return false;
    const productised = Object.values(model.deployment.productisationRuns).some(
      (count) => count > 0,
    );
    const managedProductEarnedRevenue =
      lab.models.commercialModelId === model.id && earnedRevenue;
    return productised && managedProductEarnedRevenue;
  });
}

function hasCompletedSafetyEvaluation(state: Readonly<GameState>): boolean {
  return Object.values(state.evaluations).some(
    (evaluation) =>
      evaluation.ownerLabId === state.run.playerLabId && evaluation.method !== "baseline",
  );
}

function hasEarnedProductRevenue(state: Readonly<GameState>): boolean {
  const lab = state.labs[state.run.playerLabId];
  return (
    lab !== undefined &&
    Object.values(lab.market.segments).some(
      (segment) =>
        segment.accruedRevenueMillions > 0 || segment.lastCycleRevenueMillions > 0,
    )
  );
}

function hasAcceptedFunding(state: Readonly<GameState>): boolean {
  return Object.values(state.fundraising.offers).some(
    (offer) => offer.labId === state.run.playerLabId && offer.status === "accepted",
  );
}

function hasServerRack(state: Readonly<GameState>): boolean {
  const lab = state.labs[state.run.playerLabId];
  return (
    lab?.facilities.instances.some(
      (facility) => facility.definitionId === SERVER_RACK_FACILITY_ID,
    ) === true
  );
}

function hasPressOffice(state: Readonly<GameState>): boolean {
  const lab = state.labs[state.run.playerLabId];
  return (
    lab?.facilities.instances.some(
      (facility) => facility.definitionId === PRESS_OFFICE_FACILITY_ID,
    ) === true
  );
}

function hasAppointedResearcher(state: Readonly<GameState>): boolean {
  return Object.values(state.researchers).some(
    (researcher) =>
      researcher.employerLabId === state.run.playerLabId &&
      researcher.status === "employed" &&
      researcher.assignment !== undefined,
  );
}

function capabilityResearchLevelTotal(state: Readonly<GameState>): number {
  const lab = state.labs[state.run.playerLabId];
  return Object.values(lab?.research.domains ?? {}).reduce(
    (total, programme) => total + programme.level,
    0,
  );
}

function foundationResearchCommitted(state: Readonly<GameState>): boolean {
  return (
    state.labs[state.run.playerLabId]?.flags[FOUNDATION_RESEARCH_COMMITTED_FLAG] === true
  );
}

function foundationResearchAdvanced(state: Readonly<GameState>): boolean {
  const baseline =
    state.labs[state.run.playerLabId]?.flags[FOUNDATION_RESEARCH_BASELINE_FLAG];
  return typeof baseline === "number" && capabilityResearchLevelTotal(state) > baseline;
}

function institutionWorldReviewed(state: Readonly<GameState>): boolean {
  const lab = state.labs[state.run.playerLabId];
  return lab?.flags[INSTITUTION_WORLD_REVIEWED_FLAG] === true;
}

function milestoneCurrentModel(
  state: Readonly<GameState>,
  authorisedStage: LabMaturityStage,
  minimumFrontierCapability: number,
): Readonly<GameState["models"][keyof GameState["models"]]> | undefined {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return undefined;
  const currentModelId = lab.models.currentModelId;
  if (currentModelId === undefined) return undefined;
  const model = state.models[currentModelId];
  return model !== undefined &&
    model.flags[TRAINING_AUTHORISED_STAGE_FLAG] === authorisedStage &&
    (model.measuredCapability?.frontierCapability ?? 0) >= minimumFrontierCapability
    ? model
    : undefined;
}

function productMilestoneModel(state: Readonly<GameState>) {
  return milestoneCurrentModel(state, "foundation", PROGRESSIVE_PRODUCT_CAPABILITY);
}

function safetyMilestoneModel(state: Readonly<GameState>) {
  return milestoneCurrentModel(state, "institution", PROGRESSIVE_SAFETY_CAPABILITY);
}

function autonomyMilestoneModel(state: Readonly<GameState>) {
  return (
    milestoneCurrentModel(state, "autonomy", PROGRESSIVE_AUTONOMY_CAPABILITY) ??
    milestoneCurrentModel(state, "safety", PROGRESSIVE_AUTONOMY_CAPABILITY)
  );
}

function stageComplete(state: Readonly<GameState>, stage: LabMaturityStage): boolean {
  switch (stage) {
    case "garage":
      return hasOnlineGpus(state);
    case "cluster":
      return hasModel(state);
    case "model":
      return institutionWorldReviewed(state);
    case "startup":
      return hasServerRack(state) && hasExpandedOpeningFleet(state);
    case "foundation":
      return (
        foundationResearchCommitted(state) &&
        foundationResearchAdvanced(state) &&
        productMilestoneModel(state) !== undefined
      );
    case "product":
      return hasCommercialProof(state);
    case "funding":
      return hasAcceptedFunding(state);
    case "lab":
      return hasAppointedResearcher(state);
    case "institution":
      return hasPressOffice(state) && safetyMilestoneModel(state) !== undefined;
    case "safety":
      return (
        hasSafetyResearchShare(state) &&
        hasCompletedSafetyEvaluation(state) &&
        autonomyMilestoneModel(state) !== undefined
      );
    case "autonomy":
      return (autonomyMilestoneModel(state)?.accessLevel ?? 0) >= 1;
    case "frontier":
      return false;
  }
}

/** Record deliberate opening-chapter interactions in canonical save state. */
export function recordPlayerLabMaturityCommand(
  tx: SimulationTransaction,
  command: GameCommand,
): void {
  const state = tx.read();
  if (
    isProgressiveCampaign(state) &&
    labMaturityStage(state) === "model" &&
    command.kind === "review-rival-race" &&
    command.meta.issuedBy !== "rival" &&
    command.labId === state.run.playerLabId
  ) {
    tx.update((draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined)
        throw new Error("Progressive campaign player lab is missing");
      if (lab.flags[INSTITUTION_WORLD_REVIEWED_FLAG] === true) return;
      lab.flags[INSTITUTION_WORLD_REVIEWED_FLAG] = true;
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: "Chapter 3 rival race reviewed",
        category: "narrative",
        source: { kind: "system", id: "campaign.lab-maturity" },
        relatedIds: ["model", "world"],
      });
    });
    return;
  }
  if (
    isProgressiveCampaign(state) &&
    labMaturityStage(state) === "foundation" &&
    command.kind === "set-gpu-allocation" &&
    command.meta.issuedBy !== "rival" &&
    command.labId === state.run.playerLabId &&
    command.allocation.capabilityBasisPoints === 10_000
  ) {
    tx.update((draft) => {
      const lab = draft.labs[draft.run.playerLabId];
      if (lab === undefined)
        throw new Error("Progressive campaign player lab is missing");
      if (lab.flags[FOUNDATION_RESEARCH_COMMITTED_FLAG] === true) return;
      lab.flags[FOUNDATION_RESEARCH_COMMITTED_FLAG] = true;
      draft.decisionLog.push({
        tick: draft.run.tick,
        summary: "Chapter 5 compute committed to capability research",
        category: "narrative",
        source: { kind: "system", id: "campaign.lab-maturity" },
        relatedIds: ["foundation", "research"],
      });
    });
    return;
  }
}

function nextStage(stage: LabMaturityStage): LabMaturityStage | undefined {
  return LAB_MATURITY_STAGES[stageIndex(stage) + 1];
}

function releaseFullGameCashGrant(tx: SimulationTransaction): void {
  const state = tx.read();
  const lab = state.labs[state.run.playerLabId];
  const amount = lab?.flags[FULL_GAME_CASH_GRANT_TARGET];
  if (
    typeof amount !== "number" ||
    amount <= 0 ||
    lab?.flags[FULL_GAME_CASH_GRANT_CLAIMED_FLAG] === true
  ) {
    return;
  }
  applyEffect(
    tx,
    {
      kind: "add-resource",
      subject: { type: "lab", labId: state.run.playerLabId },
      resource: "cash",
      amount,
      financeCategory: "grant",
    },
    { kind: "system", id: "campaign:full-game-backing" },
  );
  tx.update((draft) => {
    const playerLab = draft.labs[draft.run.playerLabId];
    if (playerLab === undefined) {
      throw new Error("Progressive campaign player lab is missing");
    }
    playerLab.flags[FULL_GAME_CASH_GRANT_CLAIMED_FLAG] = true;
  });
}

export function synchronisePlayerLabMaturity(tx: SimulationTransaction): void {
  let state = tx.read();
  if (!isProgressiveCampaign(state)) return;
  const current = labMaturityStage(state);
  if (
    current === "foundation" &&
    typeof state.labs[state.run.playerLabId]?.flags[FOUNDATION_RESEARCH_BASELINE_FLAG] !==
      "number"
  ) {
    tx.update((draft) => {
      const playerLab = draft.labs[draft.run.playerLabId];
      if (playerLab === undefined)
        throw new Error("Progressive campaign player lab is missing");
      playerLab.flags[FOUNDATION_RESEARCH_BASELINE_FLAG] = Object.values(
        playerLab.research.domains,
      ).reduce((total, programme) => total + programme.level, 0);
    });
    state = tx.read();
  }
  if (!stageComplete(state, current)) return;
  const next = nextStage(current);
  if (next === undefined) return;
  const definition = labMaturityDefinition(next);
  if (current === "startup" && next === "foundation") {
    applyEffect(
      tx,
      {
        kind: "add-modifier",
        subject: { type: "lab", labId: state.run.playerLabId },
        target: "lab.research.capability.output",
        operation: "multiply",
        value: FOUNDATION_RESEARCH_SPRINT_MULTIPLIER,
        durationWeeks: FOUNDATION_RESEARCH_SPRINT_WEEKS,
        tags: ["founding-team-sprint"],
      },
      { kind: "system", id: "campaign:founding-team-research-sprint" },
    );
  }
  if (current === "product" && hasEarnedProductRevenue(state)) {
    applyEffect(
      tx,
      {
        kind: "add-resource",
        subject: { type: "lab", labId: state.run.playerLabId },
        resource: "aura-spendable",
        amount: PROTOTYPE_TRACTION_AURA_AWARD,
        auraChangeKind: "gain",
        auraCategory: "customer-satisfaction",
      },
      { kind: "system", id: "campaign:prototype-traction" },
    );
  }
  if (next === "frontier") {
    releaseFullGameCashGrant(tx);
  }
  tx.update((draft) => {
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("Progressive campaign player lab is missing");
    lab.flags[LAB_MATURITY_STAGE_FLAG] = next;
    lab.flags[LAB_MATURITY_STAGE_ENTERED_AT_FLAG] = draft.run.tick;
    if (next === "foundation") {
      lab.flags[FOUNDATION_RESEARCH_BASELINE_FLAG] = Object.values(
        lab.research.domains,
      ).reduce((total, programme) => total + programme.level, 0);
    }
    const key = `lab-maturity:${next}`;
    if (!draft.presentationQueue.some((item) => item.key === key)) {
      draft.presentationQueue.push({
        key,
        kind: "lab-maturity-unlock",
        attention: "modal",
        stage: next,
        createdAt: draft.run.tick,
      });
    }
    draft.decisionLog.push({
      tick: draft.run.tick,
      summary: `${definition.chapter}: ${definition.title}`,
      category: "narrative",
      source: { kind: "system", id: "campaign.lab-maturity" },
      relatedIds: [next],
    });
  });
  tx.requestAutoPause("manual");
}

/**
 * New browser campaigns begin as a literal garage lab. Scenario fixtures,
 * bots, and existing saves remain fully unlocked unless they opt in.
 */
export function createProgressiveNewGame(
  config: NewGameConfig,
  content: CompiledContent,
): GameState {
  const state = structuredClone(createNewGame(config, content)) as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Progressive campaign player lab is missing");
  const parentsGarage = content.facilities["base:facility.parents-garage"];
  if (parentsGarage === undefined) {
    throw new Error("Progressive campaign requires Your Parents' Garage");
  }
  lab.finance.cash = cashMillions(
    lab.finance.cash -
      FIRST_MODEL_BOOTSTRAP_RUNWAY_MILLIONS +
      PROGRESSIVE_GARAGE_BOOTSTRAP_RUNWAY_MILLIONS -
      (typeof lab.flags[FULL_GAME_CASH_GRANT_TARGET] === "number"
        ? lab.flags[FULL_GAME_CASH_GRANT_TARGET]
        : 0),
  );
  if (typeof lab.flags[FULL_GAME_CASH_GRANT_TARGET] === "number") {
    lab.flags[FULL_GAME_CASH_GRANT_CLAIMED_FLAG] = false;
  }
  lab.compute.lots = [];
  lab.compute.deliveries = [];
  // The founding location is a literal garage. It is not constructible and is
  // not counted as the later permanent-campus milestone.
  lab.facilities.instances = lab.facilities.instances.filter(
    (facility) => facility.definitionId === "base:facility.parents-garage",
  );
  if (lab.facilities.instances.length === 0) {
    lab.facilities.instances.push({
      definitionId: parentsGarage.id,
      completedAt: state.run.tick,
      modifierIds: [],
    });
  }
  lab.flags[PROGRESSIVE_CAMPAIGN_FLAG] = true;
  lab.flags[LAB_MATURITY_STAGE_FLAG] = "garage";
  lab.flags[LAB_MATURITY_STAGE_ENTERED_AT_FLAG] = state.run.tick;
  state.presentationQueue.push({
    key: "lab-maturity:garage",
    kind: "lab-maturity-unlock",
    attention: "modal",
    stage: "garage",
    createdAt: state.run.tick,
  });
  assertInvariants(state);
  return deepFreeze(state);
}

function requiredFeatureForCommand(kind: GameCommand["kind"]): LabFeature | undefined {
  switch (kind) {
    case "set-gpu-allocation":
    case "buy-gpus":
    case "sell-gpus":
      return "compute";
    case "start-training-run":
      return "models";
    case "set-public-price":
    case "start-productisation":
    case "set-model-deployment-policy":
      return "productisation";
    case "start-evaluation":
      return "evaluations";
    // The simulation can surface anomalies, papers, and research branches before
    // their workspaces unlock. Their mandatory modals require a response, so these
    // reactive commands must remain available throughout the progressive campaign.
    case "dismiss-anomaly":
    case "investigate-anomaly":
    case "choose-generic-advance":
    case "choose-publication-policy":
      return undefined;
    case "start-fundraising-campaign":
    case "accept-funding-offer":
      return "fundraising";
    case "start-facility-construction":
      return "facilities";
    case "assign-researcher":
    case "recruit-researcher":
    case "start-researcher-commitment":
    case "submit-retention-offer":
    case "resolve-researcher-ultimatum":
    case "dismiss-researcher":
      return "people";
    case "join-government-programme":
    case "leave-government-programme":
    case "start-lobbying-project":
    case "conduct-rival-diplomacy":
    case "review-rival-race":
    case "propose-coalition":
    case "start-coalition-project":
    case "ratify-coalition":
      return "world";
    case "start-agi-component":
    case "set-candidate-access":
    case "isolate-candidate-artifact":
    case "resolve-candidate-incident":
    case "nominate-candidate":
    case "commit-capability-proof":
    case "commit-candidate-safety-response":
    case "configure-candidate-retirement":
    case "transmit-candidate-retirement":
    case "choose-post-retirement-path":
    case "choose-false-dawn-path":
    case "transmit-deployment":
    case "advance-world-waiting":
    case "resolve-pressure-collision":
    case "enter-final-review":
    case "choose-deployment-mode":
    case "resolve-rollout-decision":
    case "resolve-containment-failure":
      return "agi";
    case "set-model-autonomy":
      return "autonomy";
    case "respond-to-decision-event":
      return undefined;
  }
}

export function labMaturityCommandBlocker(
  state: Readonly<GameState>,
  command: GameCommand,
): string | undefined {
  if (!isProgressiveCampaign(state) || command.meta.issuedBy === "rival") {
    return undefined;
  }
  if (
    labMaturityStage(state) === "foundation" &&
    command.kind === "start-training-run" &&
    !foundationResearchAdvanced(state)
  ) {
    return "Advance one capability research programme before training the FC 5 successor.";
  }
  if (
    stageIndex(labMaturityStage(state)) < stageIndex("lab") &&
    command.kind === "start-facility-construction" &&
    command.definitionId !== SERVER_RACK_FACILITY_ID
  ) {
    return "Optional facilities unlock after the first funding round. Build the Server Rack first.";
  }
  if (
    command.kind === "set-gpu-allocation" &&
    command.allocation.servingFleetShareBasisPoints > 0 &&
    !labFeatureUnlocked(state, "productisation")
  ) {
    return "Serving becomes relevant when a Frontier Capability 5 model unlocks productisation.";
  }
  if (labMaturityStage(state) === "product") {
    if (
      command.kind === "set-model-deployment-policy" &&
      (command.policy === "internal-only" || command.policy === "weights-release")
    ) {
      return "The opening launch must use managed access so the lab can earn its first revenue. Choose Guarded API or Open API; internal and weights-only releases become available afterward.";
    }
  }
  const feature = requiredFeatureForCommand(command.kind);
  if (feature === undefined || labFeatureUnlocked(state, feature)) return undefined;
  const current = labMaturityDefinition(labMaturityStage(state));
  return `This system is not available yet. Current objective: ${current.directive}`;
}

export interface LabMaturityChecklistItem {
  readonly label: string;
  readonly complete: boolean;
}

export interface LabMaturityViewData extends LabMaturityStageDefinition {
  readonly ordinal: number;
  readonly total: number;
  readonly checklist: readonly LabMaturityChecklistItem[];
  readonly complete: boolean;
  readonly safetyResearchUnlocked: boolean;
  /**
   * The Overview reminder persists throughout onboarding, then leaves the
   * dashboard two weeks after the full game opens. The maturity projection
   * itself remains available because it also drives department visibility.
   */
  readonly showOverviewPanel: boolean;
}

export function projectLabMaturity(
  state: Readonly<GameState>,
): LabMaturityViewData | undefined {
  if (!isProgressiveCampaign(state)) return undefined;
  const stage = labMaturityStage(state);
  const definition = labMaturityDefinition(stage);
  const lab = state.labs[state.run.playerLabId];
  const enteredAt = lab?.flags[LAB_MATURITY_STAGE_ENTERED_AT_FLAG];
  const showOverviewPanel =
    stage !== "frontier" ||
    (typeof enteredAt === "number" && state.run.tick - enteredAt < 2);
  const currentModelIds = lab?.models.modelIds ?? [];
  const evaluated = hasCompletedSafetyEvaluation(state);
  const productised = currentModelIds.some((modelId) =>
    Object.values(state.models[modelId]?.deployment.productisationRuns ?? {}).some(
      (count) => count > 0,
    ),
  );
  const serving = Object.values(lab?.market.segments ?? {}).some(
    (segment) =>
      segment.accruedRevenueMillions > 0 || segment.lastCycleRevenueMillions > 0,
  );
  const employed = Object.values(state.researchers).some(
    (researcher) =>
      researcher.employerLabId === state.run.playerLabId &&
      researcher.status === "employed",
  );
  const appointed = hasAppointedResearcher(state);
  const checklist: readonly LabMaturityChecklistItem[] = (() => {
    switch (stage) {
      case "garage":
        return [
          {
            label:
              (lab?.compute.deliveries.length ?? 0) > 0
                ? "First GPU delivery is in transit"
                : "Order the first GPU block",
            complete: (lab?.compute.deliveries.length ?? 0) > 0 || hasOnlineGpus(state),
          },
          { label: "Bring the first cluster online", complete: hasOnlineGpus(state) },
        ];
      case "cluster":
        return [
          {
            label: "Complete the first prototype training run (FC below 5)",
            complete: hasModel(state),
          },
        ];
      case "model":
        return [
          {
            label: "Open World and inspect the rival race",
            complete: institutionWorldReviewed(state),
          },
        ];
      case "startup":
        return [
          {
            label: "Build the Server Rack",
            complete: hasServerRack(state),
          },
          {
            label:
              onlineGpuCount(state) >= EXPANDED_OPENING_FLEET_GPUS
                ? "Expanded GPU fleet is online"
                : "Fill the Server Rack to 4,000 GPUs and let them arrive",
            complete: hasExpandedOpeningFleet(state),
          },
        ];
      case "foundation":
        return [
          {
            label: "On Research, set Broad Capability Research to 100%",
            complete: foundationResearchCommitted(state),
          },
          {
            label: "Advance one capability research programme by a level",
            complete: foundationResearchAdvanced(state),
          },
          {
            label: `Train a newly authorised successor with Frontier Capability ${String(PROGRESSIVE_PRODUCT_CAPABILITY)}+`,
            complete: productMilestoneModel(state) !== undefined,
          },
        ];
      case "product":
        return [
          { label: "Prepare and launch a model", complete: productised },
          {
            label: "Allocate GPUs to serving and earn product revenue",
            complete: serving,
          },
        ];
      case "funding":
        return [
          {
            label: "Complete a fundraising campaign",
            complete: Object.values(state.fundraising.offers).some(
              (offer) => offer.labId === state.run.playerLabId,
            ),
          },
          { label: "Accept an investment offer", complete: hasAcceptedFunding(state) },
        ];
      case "lab":
        return [
          { label: "Recruit a star researcher", complete: employed },
          { label: "Appoint a workstream lead", complete: appointed },
        ];
      case "institution":
        return [
          {
            label: "Build the Press Office for +1 Aura every 4 weeks",
            complete: hasPressOffice(state),
          },
          {
            label: `Scale the lab as needed, then train a newly authorised successor with Frontier Capability ${String(PROGRESSIVE_SAFETY_CAPABILITY)}+`,
            complete: safetyMilestoneModel(state) !== undefined,
          },
        ];
      case "safety":
        return [
          {
            label: "Give safety research at least 30% of R&D compute",
            complete: hasSafetyResearchShare(state),
          },
          { label: "Complete a safety evaluation", complete: evaluated },
          {
            label: `Scale as needed, then train a newly authorised successor with Frontier Capability ${String(PROGRESSIVE_AUTONOMY_CAPABILITY)}+`,
            complete: autonomyMilestoneModel(state) !== undefined,
          },
        ];
      case "autonomy": {
        const successor = autonomyMilestoneModel(state);
        return [
          {
            label:
              "In AGI & RSI, grant the successor Access Level 1 · Fixed evaluation sandbox",
            complete: (successor?.accessLevel ?? 0) >= 1,
          },
        ];
      }
      case "frontier":
        return [{ label: "The full strategic game is open", complete: true }];
    }
  })();
  return {
    ...definition,
    ordinal: stageIndex(stage) + 1,
    total: LAB_MATURITY_STAGES.length,
    checklist,
    complete: stage === "frontier",
    safetyResearchUnlocked: stageIndex(stage) >= stageIndex("foundation"),
    showOverviewPanel,
  };
}
