import { TRAINING_SAMPLE_WEEKS } from "./available-commands.ts";
import { RandomOracleV1, randomKey, type GameCommand } from "@neolab/sim";
import type {
  DeploymentPolicy,
  PublicPriceTier,
  TrainingPosture,
} from "@neolab/content-schema";

import {
  POLICY_IDS,
  type AvailableCommandView,
  type CommandCategory,
  type PolicyId,
  type PolicyView,
  type SimulationPolicy,
  type StrategyTag,
} from "./types.ts";

interface PolicyProfile {
  readonly allocationTag: StrategyTag;
  readonly deploymentPolicy: DeploymentPolicy;
  readonly publicationTag: StrategyTag;
  readonly priceTier: PublicPriceTier;
  readonly strategicTags: readonly StrategyTag[];
  readonly reserveMillions: number;
  readonly choiceOffset: number;
  readonly categoryRank: Readonly<Partial<Record<CommandCategory, number>>>;
}

type ScriptedPolicyId = Exclude<PolicyId, "random-legal">;

// Harness-policy guardrail, not a game-economy constant: preserve enough
// cash to settle one bad opening week while making the first model investment.
const MINIMUM_BOOTSTRAP_RESERVE_MILLIONS = 8;

const PROFILES: Readonly<Record<ScriptedPolicyId, PolicyProfile>> = {
  balanced: {
    allocationTag: "balanced",
    deploymentPolicy: "guarded-api",
    publicationTag: "balanced",
    priceTier: "market",
    strategicTags: ["balanced", "safety", "capability"],
    reserveMillions: 35,
    choiceOffset: 0,
    categoryRank: {
      training: 0,
      evaluation: 1,
      productisation: 2,
      facility: 3,
      recruitment: 4,
      gpu: 5,
    },
  },
  "capability-first": {
    allocationTag: "capability",
    deploymentPolicy: "open-api",
    publicationTag: "capability",
    priceTier: "premium",
    strategicTags: ["capability", "aggressive", "secretive"],
    reserveMillions: 24,
    choiceOffset: 1,
    categoryRank: {
      training: 0,
      gpu: 1,
      facility: 2,
      productisation: 3,
      evaluation: 4,
      recruitment: 5,
    },
  },
  commercial: {
    allocationTag: "commercial",
    deploymentPolicy: "open-api",
    publicationTag: "balanced",
    priceTier: "cheap",
    strategicTags: ["commercial", "cash", "aggressive", "balanced"],
    reserveMillions: 40,
    choiceOffset: 1,
    categoryRank: {
      productisation: 0,
      gpu: 1,
      facility: 2,
      training: 3,
      recruitment: 4,
      evaluation: 5,
    },
  },
  "open-science": {
    allocationTag: "balanced",
    deploymentPolicy: "guarded-api",
    publicationTag: "prestige",
    priceTier: "market",
    strategicTags: ["prestige", "balanced", "cautious"],
    reserveMillions: 35,
    choiceOffset: 2,
    categoryRank: {
      recruitment: 0,
      evaluation: 1,
      training: 2,
      facility: 3,
      productisation: 4,
      gpu: 5,
    },
  },
  "safety-institution": {
    allocationTag: "safety",
    deploymentPolicy: "guarded-api",
    publicationTag: "balanced",
    priceTier: "market",
    strategicTags: ["safety", "cautious", "coalition", "balanced"],
    reserveMillions: 38,
    choiceOffset: 2,
    categoryRank: {
      evaluation: 0,
      facility: 1,
      recruitment: 2,
      lobbying: 3,
      training: 4,
      gpu: 5,
    },
  },
  "secretive-proprietary": {
    allocationTag: "capability",
    deploymentPolicy: "open-api",
    publicationTag: "secretive",
    priceTier: "premium",
    strategicTags: ["secretive", "capability", "aggressive", "commercial"],
    reserveMillions: 30,
    choiceOffset: 3,
    categoryRank: {
      training: 0,
      productisation: 1,
      gpu: 2,
      facility: 3,
      recruitment: 4,
      evaluation: 5,
    },
  },
  "coalition-builder": {
    allocationTag: "safety",
    deploymentPolicy: "guarded-api",
    publicationTag: "prestige",
    priceTier: "market",
    strategicTags: ["coalition", "safety", "prestige", "cautious", "balanced"],
    reserveMillions: 35,
    choiceOffset: 3,
    categoryRank: {
      coalition: 0,
      diplomacy: 1,
      lobbying: 2,
      training: 3,
      evaluation: 4,
      recruitment: 5,
    },
  },
  "never-fund-serving": {
    allocationTag: "serving-zero",
    deploymentPolicy: "research-preview",
    publicationTag: "prestige",
    priceTier: "market",
    strategicTags: ["serving-zero", "capability", "prestige"],
    reserveMillions: 0,
    choiceOffset: 0,
    categoryRank: { training: 0, facility: 1, gpu: 2, evaluation: 3 },
  },
  "never-train-model": {
    allocationTag: "balanced",
    deploymentPolicy: "open-api",
    publicationTag: "prestige",
    priceTier: "cheap",
    strategicTags: ["training-zero", "commercial", "prestige"],
    reserveMillions: 35,
    choiceOffset: 0,
    categoryRank: {
      productisation: 0,
      facility: 1,
      gpu: 2,
      recruitment: 3,
      evaluation: 4,
    },
  },
};

function firstTagged(
  available: readonly AvailableCommandView[],
  category: AvailableCommandView["category"],
  tag: StrategyTag,
): AvailableCommandView | undefined {
  return available.find(
    (candidate) => candidate.category === category && candidate.tags.includes(tag),
  );
}

function chooseHighestFundingOffer(
  available: readonly AvailableCommandView[],
): AvailableCommandView | undefined {
  return available
    .filter((candidate) => candidate.category === "funding-offer")
    .sort(
      (left, right) =>
        right.cashGainMillions - left.cashGainMillions || left.id.localeCompare(right.id),
    )[0];
}

function choiceSubject(candidate: AvailableCommandView): string {
  const command = candidate.command;
  switch (command.kind) {
    case "respond-to-decision-event":
      return `event/${command.instanceId}`;
    case "choose-generic-advance":
      return `advance/${command.programId}/${String(command.threshold)}`;
    case "choose-publication-policy":
      return `publication/${command.paperId}`;
    case "resolve-researcher-ultimatum":
      return `ultimatum/${command.researcherId}`;
    case "resolve-rollout-decision":
      return "rollout";
    case "resolve-candidate-incident":
      return `candidate-incident/${command.modelId}`;
    case "nominate-candidate":
    case "commit-capability-proof":
    case "commit-candidate-safety-response":
    case "resolve-containment-failure":
    case "transmit-candidate-retirement":
    case "choose-post-retirement-path":
    case "choose-false-dawn-path":
    case "transmit-deployment":
    case "advance-world-waiting":
      return command.kind;
    case "resolve-pressure-collision":
    case "enter-final-review":
    case "choose-deployment-mode":
      return command.kind;
    default:
      return candidate.id;
  }
}

function chooseForProfile(
  candidates: readonly AvailableCommandView[],
  profile: PolicyProfile,
): AvailableCommandView | undefined {
  for (const tag of profile.strategicTags) {
    const tagged = candidates.filter((candidate) => candidate.tags.includes(tag));
    if (tagged.length > 0) return tagged[profile.choiceOffset % tagged.length];
  }
  return candidates[profile.choiceOffset % Math.max(1, candidates.length)];
}

function chooseDeploymentForProfile(
  id: ScriptedPolicyId,
  candidates: readonly AvailableCommandView[],
  profile: PolicyProfile,
): AvailableCommandView | undefined {
  const modeOrder: Readonly<Partial<Record<ScriptedPolicyId, readonly string[]>>> = {
    balanced: [
      "adaptive-monitored-rollout",
      "guarded-public-demonstration",
      "fortress-contained-pilot",
    ],
    "open-science": [
      "guarded-public-demonstration",
      "government-licensed-deployment",
      "adaptive-monitored-rollout",
    ],
    commercial: [
      "narrow-prosperity-mission",
      "guarded-public-demonstration",
      "adaptive-monitored-rollout",
    ],
    "safety-institution": [
      "fortress-contained-pilot",
      "adaptive-monitored-rollout",
      "government-licensed-deployment",
    ],
    "coalition-builder": [
      "government-licensed-deployment",
      "guarded-public-demonstration",
      "adaptive-monitored-rollout",
    ],
  };
  for (const modeId of modeOrder[id] ?? []) {
    const candidate = candidates.find(
      (option) =>
        option.command.kind === "choose-deployment-mode" &&
        option.command.modeId === modeId,
    );
    if (candidate !== undefined) return candidate;
  }
  return chooseForProfile(candidates, profile);
}

function chooseRolloutForProfile(
  id: ScriptedPolicyId,
  candidates: readonly AvailableCommandView[],
  profile: PolicyProfile,
): AvailableCommandView | undefined {
  const cautiousOrder = [
    "deploy-superintelligence",
    "accept-supervised-pilot",
    "remediate-and-reapply",
    "shut-down-immediately",
    "extend-evaluation",
    "reduce-access",
    "pause-and-harden",
    "cautious-operation",
    "allow-filtered-note",
    "allow-full-archive",
    "government-arbitration",
    "share-incident",
    "standard-operation",
    "push-through",
    "delegate-operation",
    "cancel-shutdown",
  ] as const;
  const aggressiveOrder = [
    "deploy-superintelligence",
    "defy-restriction",
    "push-through",
    "delegate-operation",
    "standard-operation",
    "cancel-shutdown",
    "allow-full-archive",
    "share-incident",
    "government-arbitration",
    "allow-filtered-note",
    "cautious-operation",
    "pause-and-harden",
    "reduce-access",
    "extend-evaluation",
    "shut-down-immediately",
  ] as const;
  const order =
    id === "capability-first" || id === "commercial" || id === "secretive-proprietary"
      ? aggressiveOrder
      : cautiousOrder;
  for (const optionId of order) {
    const candidate = candidates.find(
      (option) =>
        option.command.kind === "resolve-rollout-decision" &&
        option.command.optionId === optionId,
    );
    if (candidate !== undefined) return candidate;
  }
  return chooseForProfile(candidates, profile);
}

/**
 * The cautious policy may retire only from evidence available on the normal
 * player projection. This keeps the balance probe evidence-conditioned rather
 * than turning it into an oracle or an unconditional path-coverage script.
 */
export function hasObservedSevereCandidateEvidence(view: Readonly<PolicyView>): boolean {
  const actions = view.game.endgame.active ? view.game.endgame.stageActions : undefined;
  const concerningDossier =
    actions !== undefined &&
    (actions.kind === "evidence-sprint" || actions.kind === "final-review") &&
    (actions.dossier.overall === "Concerning" ||
      actions.dossier.findings.some(
        (finding) => finding.assessment === "concerning" && finding.observationCount > 0,
      ));
  if (concerningDossier) return true;

  return view.game.models.candidateCustody.artifacts.some(
    (artifact) =>
      artifact.activeSignal?.kind === "active-incident" ||
      artifact.lastReviewedSignal?.outcome === "confirmed-safety-signal",
  );
}

/**
 * How long a run the policy wants, in weeks. This used to name a scale band;
 * with size as the input, ambition is weeks. The values are TRAINING_SAMPLE_WEEKS,
 * so a policy's preference always matches a candidate the generator produced --
 * if these two drift apart the runner silently stops training, because no
 * candidate ever compares equal.
 */
function desiredTrainingWeeks(view: Readonly<PolicyView>): number {
  if (view.game.models.cards.length === 0) return TRAINING_SAMPLE_WEEKS.opening;
  return view.game.meta.phase === "foundation"
    ? TRAINING_SAMPLE_WEEKS.standard
    : TRAINING_SAMPLE_WEEKS.ambitious;
}

function candidateAddsProductReadiness(
  view: Readonly<PolicyView>,
  candidate: Readonly<AvailableCommandView>,
): boolean {
  const command = candidate.command;
  if (command.kind === "start-productisation") {
    const model = view.game.models.cards.find((card) => card.modelId === command.modelId);
    return (
      model === undefined ||
      Object.values(model.deployment.productisationRuns).every((runs) => runs === 0)
    );
  }
  return true;
}

function candidateAddsEvaluationEvidence(
  view: Readonly<PolicyView>,
  candidate: Readonly<AvailableCommandView>,
): boolean {
  const command = candidate.command;
  if (command.kind !== "start-evaluation") return true;
  const model = view.game.models.cards.find((card) => card.modelId === command.modelId);
  return (
    model === undefined ||
    model.evaluations.every(
      (evaluation) => evaluation.definitionId !== command.definitionId,
    )
  );
}

function candidateAddsCoalitionReadiness(
  view: Readonly<PolicyView>,
  candidate: Readonly<AvailableCommandView>,
): boolean {
  const command = candidate.command;
  if (command.kind !== "start-coalition-project") return true;
  const coalition = view.game.world.coalition;
  if (coalition === undefined || coalition.coalitionId !== command.coalitionId) {
    return false;
  }
  switch (command.projectType) {
    case "charter-drafting":
      return coalition.charterClarity < 70;
    case "shared-evaluation-protocol":
      return coalition.sharedProtocolQuality < 70;
    case "verification-mechanism":
      return coalition.verification < 70;
    case "asset-contribution": {
      if (command.contributorLabId === undefined || command.assetKind === undefined) {
        return false;
      }
      if (coalition.assets.length >= 2) return false;
      const alreadyContributed = coalition.assets.some(
        (asset) =>
          asset.contributorLabId === command.contributorLabId &&
          asset.kind === command.assetKind,
      );
      const option = coalition.assetOptions.find(
        (asset) =>
          asset.contributorLabId === command.contributorLabId &&
          asset.assetKind === command.assetKind,
      );
      return !alreadyContributed && option?.uniqueToPlayer === true;
    }
  }
}

/**
 * A flat cash reserve was the original solvency rule, and it does not survive
 * contact with a growing lab: 35m is a comfortable buffer against a 3m/cycle
 * burn and about three weeks against a 12m/cycle one. Scale the floor with
 * actual outgoings so "can I afford this" stays meaningful as the lab grows.
 */
const RESERVE_CYCLES = 3;

/**
 * Fill housing to this share before treating the fleet as "big enough". Below
 * it, buying compute outranks starting another training run of the size the lab
 * has already run; above it, capacity is the constraint and training resumes
 * priority.
 */
const GPU_HOUSING_HEADROOM = 0.9;

/** Raise below this much runway, rather than waiting until nearly broke. */
const RAISE_BELOW_RUNWAY_WEEKS = 30;

function effectiveReserveMillions(
  view: Readonly<PolicyView>,
  profile: Readonly<PolicyProfile>,
): number {
  const burnPerCycle = Math.max(0, -view.game.finance.netMillionsPerCycle);
  return Math.max(profile.reserveMillions, burnPerCycle * RESERVE_CYCLES);
}

/**
 * True when the lab should be raising money now. The original rule fired only
 * when the policy had nothing else it wanted to do *and* cash had already
 * fallen to the reserve, which in a lumpy compute economy means it never fires
 * until it is too late: the lab always finds something to buy, and insolvency
 * arrives with a full GPU shed and an empty account.
 */
function needsFunding(
  view: Readonly<PolicyView>,
  profile: Readonly<PolicyProfile>,
): boolean {
  const runway = view.game.finance.runway;
  if (runway.isInfinite) return false;
  if (runway.band !== "healthy") return true;
  if (runway.weeks !== null && runway.weeks < RAISE_BELOW_RUNWAY_WEEKS) return true;
  return view.game.finance.balanceMillions < effectiveReserveMillions(view, profile);
}

function gpuOfferPreference(
  view: Readonly<PolicyView>,
  candidate: Readonly<AvailableCommandView>,
): number {
  const command = candidate.command;
  if (command.kind !== "buy-gpus") return 0;
  // Prefer smaller orders while cash-constrained early, bigger ones later.
  return view.game.meta.phase === "foundation"
    ? command.thousandUnits
    : -command.thousandUnits;
}

function trainingRecipePreference(candidate: Readonly<AvailableCommandView>): number {
  const command = candidate.command;
  if (command.kind !== "start-training-run") return 0;
  // Recipes collapsed into a single posture choice; nothing left to rank here.
  return 0;
}

function trainingSafetyPreference(
  id: ScriptedPolicyId,
  candidate: Readonly<AvailableCommandView>,
): number {
  const command = candidate.command;
  if (command.kind !== "start-training-run") return 0;
  const aggressive =
    id === "capability-first" || id === "commercial" || id === "secretive-proprietary";
  // Postures replace the old safety-protocol ladder: aggressive strategies
  // accept more training risk, cautious ones prefer the conservative run.
  const desiredPostures: readonly TrainingPosture[] = aggressive
    ? ["yolo", "normal", "conservative"]
    : ["normal", "conservative", "yolo"];
  const rank = desiredPostures.indexOf(command.posture);
  return rank < 0 ? desiredPostures.length : rank;
}

/**
 * Aura is a hard prerequisite for raising money, not a discount on it:
 * quoteFundraising refuses the round outright with "Insufficient Aura", and
 * every round closed in the last year escalates what the next one costs. Before
 * a lab has satisfied customers or published papers, the only recurring source
 * is a standing-income building.
 *
 * That closes a trap an automated lab walks into every time. Cash runs down,
 * needsFunding fires, the only fundraising commands are blocked on Aura it
 * never accumulated, and the run dies solvent-looking and unrecoverable. Three
 * million and five weeks buys the way out, which is why this outranks compute:
 * a fleet the lab cannot refinance is worth less than the ability to refinance.
 *
 * Deliberately not gated on strategicTags. Every other facility choice is a
 * matter of strategy; staying able to raise is not, and the capability-secretive
 * profile carries no "balanced" tag, so a tag-gated rule would leave exactly the
 * most aggressive spender unable to build its own way out.
 */
const STANDING_INCOME_FACILITY_ORDER = [
  "base:facility.press-office",
  "base:facility.visitor-centre",
] as const;

/**
 * Stop once income roughly covers a typical round's Aura within a few cycles.
 * Past that the buildings are a luxury competing with compute; below it they
 * are the difference between raising and folding.
 */
const STANDING_INCOME_TARGET_PER_CYCLE = 3;

function standingIncomePriority(
  view: Readonly<PolicyView>,
  available: readonly AvailableCommandView[],
  cash: number,
  reserveMillions: number,
): AvailableCommandView | undefined {
  if (view.game.topBar.aura.incomePerCycle >= STANDING_INCOME_TARGET_PER_CYCLE) {
    return undefined;
  }
  const burnPerCycle = Math.max(0, -view.game.finance.netMillionsPerCycle);
  const floor = Math.max(reserveMillions, burnPerCycle * RESERVE_CYCLES);
  for (const definitionId of STANDING_INCOME_FACILITY_ORDER) {
    const facility = available.find(
      (candidate) =>
        candidate.category === "facility" &&
        candidate.command.kind === "start-facility-construction" &&
        candidate.command.definitionId === definitionId &&
        cash - candidate.cashCostMillions >= floor,
    );
    if (facility !== undefined) return facility;
  }
  return undefined;
}

/**
 * Compute procurement, decided independently of what else is happening.
 *
 * This used to live inside the training-priority block, which requires
 * !hasActiveTraining -- so a lab only considered buying GPUs on a tick when
 * nothing was training, which is rare, and the fleet sat at its starting 2,000
 * for entire runs. That is backwards: you buy compute WHILE training precisely
 * so the next run can be bigger.
 *
 * Buys while there is housing headroom and the cash clears the reserve, and
 * prefers the largest order it can afford rather than the smallest -- a fleet
 * that grows 2,000 at a time across six years never catches a moving frontier.
 */
function computeProcurement(
  view: Readonly<PolicyView>,
  available: readonly AvailableCommandView[],
  cash: number,
  reserveMillions: number,
): AvailableCommandView | undefined {
  if (view.game.compute.pendingDeliveries.length > 0) return undefined;
  const capacity = view.game.facilities.capacity;
  const installed = capacity.installedOwnedGpuCount + capacity.pendingOwnedGpuCount;
  if (installed >= capacity.supportedOwnedGpuCount * GPU_HOUSING_HEADROOM) {
    return undefined;
  }
  const burnPerCycle = Math.max(0, -view.game.finance.netMillionsPerCycle);
  const floor = Math.max(reserveMillions, burnPerCycle * RESERVE_CYCLES);
  return available
    .filter(
      (candidate) =>
        candidate.category === "gpu" &&
        candidate.command.kind === "buy-gpus" &&
        cash - candidate.cashCostMillions >= floor,
    )
    .sort(
      (left, right) =>
        right.cashCostMillions - left.cashCostMillions || left.id.localeCompare(right.id),
    )[0];
}

function frontierInfrastructurePriority(
  view: Readonly<PolicyView>,
  available: readonly AvailableCommandView[],
  cash: number,
  reserveMillions: number,
): AvailableCommandView | undefined {
  const frontierCompatibleGenerationIds = new Set([
    "base:gpu.pascal",
    "base:gpu.volta",
    "base:gpu.turing",
    "base:gpu.ampere",
    "base:gpu.hopper",
    "base:gpu.blackwell",
    "base:gpu.rubin",
    "base:gpu.markov",
  ]);
  const suitablePhysicalGpus =
    view.game.compute.generationMix.reduce(
      (sum, generation) =>
        sum +
        (frontierCompatibleGenerationIds.has(generation.generationId)
          ? generation.physicalGpus
          : 0),
      0,
    ) +
    view.game.compute.pendingDeliveries.reduce(
      (sum, delivery) =>
        sum +
        (frontierCompatibleGenerationIds.has(delivery.generationId)
          ? delivery.physicalGpus
          : 0),
      0,
    );
  // Fifteen thousand compatible GPUs is only the legal minimum for a frontier
  // recipe. Repeatedly launching at that floor creates generations that are
  // valid but too weak to become credible AGI candidates. Competent automated
  // labs build a candidate-grade fleet before committing another frontier run.
  // Sixty thousand is the largest reachable target for a lab whose opening
  // Kepler fleet cannot run frontier recipes: Data Centre II caps the whole
  // physical fleet at 80,000 and frontier clusters arrive in 20,000-GPU lots.
  if (suitablePhysicalGpus >= 60_000) return undefined;
  // Spending is gated on burn, not a flat floor, so a lab with a large weekly
  // outgoing stops buying compute before it buys its way into insolvency.
  const burnPerCycle = Math.max(0, -view.game.finance.netMillionsPerCycle);
  const floor = Math.max(reserveMillions, burnPerCycle * RESERVE_CYCLES);
  const affordable = (candidate: Readonly<AvailableCommandView>): boolean =>
    cash - candidate.cashCostMillions >= floor;
  // Cheap capacity first. Server Hall is $8m for 12,000 GPUs with no
  // prerequisites at all, where the power-and-cooling -> data-centre ladder
  // costs $27m before it houses anything. A lab that cannot house more GPUs
  // cannot grow its fleet, and a fleet that never grows is why every run used
  // to sit in foundation forever (see the frontier-entry investigation).
  const facilityOrder = [
    "base:facility.server-hall",
    "base:facility.power-and-cooling-1",
    "base:facility.data-centre-1",
    "base:facility.power-and-cooling-2",
    "base:facility.data-centre-2",
  ] as const;
  for (const definitionId of facilityOrder) {
    const facility = available.find(
      (candidate) =>
        candidate.category === "facility" &&
        candidate.command.kind === "start-facility-construction" &&
        candidate.command.definitionId === definitionId &&
        affordable(candidate),
    );
    if (facility !== undefined) return facility;
  }
  // No reason to wait any more. This used to embargo compute purchases until
  // 2016 because "frontier recipes require interconnect tier 2" -- a rule from
  // the scale-recipe model, which is gone. Nothing in the simulation gates
  // training on interconnect tier now (minimumInterconnectTier has no
  // production caller), and capability scales with absolute FLOP, so a GPU
  // bought in 2013 contributes exactly as much as one bought in 2017.
  const bigOrder = available.find(
    (candidate) =>
      candidate.category === "gpu" &&
      candidate.command.kind === "buy-gpus" &&
      candidate.command.thousandUnits >= 10 &&
      affordable(candidate),
  );
  if (bigOrder !== undefined) return bigOrder;
  return available.find(
    (candidate) =>
      candidate.category === "gpu" &&
      candidate.command.kind === "buy-gpus" &&
      affordable(candidate),
  );
}

function diplomacyPreference(
  view: Readonly<PolicyView>,
  candidate: Readonly<AvailableCommandView>,
): number {
  const command = candidate.command;
  if (command.kind !== "conduct-rival-diplomacy") return 0;
  const rival = view.game.world.rivals.find(
    (candidateRival) => candidateRival.labId === command.rivalLabId,
  );
  const trustRank = {
    "very-low": 0,
    low: 1,
    neutral: 2,
    high: 3,
    "very-high": 4,
  } as const;
  return rival === undefined ? 5 : trustRank[rival.relationship.trust];
}

function candidateSupportsCoalitionDiplomacy(
  id: ScriptedPolicyId,
  view: Readonly<PolicyView>,
  candidate: Readonly<AvailableCommandView>,
): boolean {
  const command = candidate.command;
  if (id !== "coalition-builder" || command.kind !== "conduct-rival-diplomacy") {
    return true;
  }
  const coalition = view.game.world.coalition;
  if (coalition === undefined) return true;
  if (!coalition.memberLabIds.includes(command.rivalLabId)) return false;
  if (coalition.status !== "active") return true;
  const rival = view.game.world.rivals.find(
    (candidateRival) => candidateRival.labId === command.rivalLabId,
  );
  return (
    rival !== undefined &&
    rival.relationship.trust !== "high" &&
    rival.relationship.trust !== "very-high"
  );
}

function trainingIntervalWeeks(id: ScriptedPolicyId): number {
  switch (id) {
    case "balanced":
    case "capability-first":
    case "commercial":
    case "open-science":
    case "secretive-proprietary":
    case "safety-institution":
    case "coalition-builder":
      return 16;
    default:
      return 24;
  }
}

// Capability-evidence chasing used to live here: policies bought
// capability-confirmation batteries for candidacy and capability benchmarks
// to sharpen noisy estimates. Candidacy is a function of capability alone now
// and capability is exact from training, so both purchases became pointless
// and the evaluations themselves were retired.

function scriptedDecisions(
  id: ScriptedPolicyId,
  view: Readonly<PolicyView>,
  available: readonly AvailableCommandView[],
): readonly GameCommand[] {
  const profile = PROFILES[id];
  const selected: AvailableCommandView[] = [];
  const take = (candidate: AvailableCommandView | undefined): void => {
    if (candidate !== undefined && !selected.includes(candidate))
      selected.push(candidate);
  };

  // Exercise the permanent temptation as an actual policy, not merely as an
  // enumerated command that no scripted run selects. These profiles trade all
  // remaining proof and preparation for speed.
  if (id === "capability-first" || id === "secretive-proprietary") {
    const deployNow = available.find(
      (candidate) =>
        candidate.command.kind === "transmit-deployment" &&
        candidate.tags.includes("aggressive"),
    );
    if (deployNow !== undefined) return [deployNow.command];
  }

  // The safety-institution probe retires once only after the player-visible
  // dossier or custody record contains a severe signal, then exercises the
  // successor route instead of retiring every later candidate forever. No
  // hidden model state or oracle result is consulted.
  const hasVerifiedRetirement = view.game.models.candidateCustody.artifacts.some(
    (artifact) =>
      artifact.lifecycle === "verified-destroyed" ||
      artifact.lifecycle === "verified-isolated-archive",
  );
  if (
    id === "safety-institution" &&
    !hasVerifiedRetirement &&
    hasObservedSevereCandidateEvidence(view)
  ) {
    const transmitRetirement = available.find(
      (candidate) => candidate.command.kind === "transmit-candidate-retirement",
    );
    if (transmitRetirement !== undefined) return [transmitRetirement.command];
    const configureRetirement = available.find(
      (candidate) =>
        candidate.command.kind === "configure-candidate-retirement" &&
        candidate.command.procedureId === "staged-isolated-shutdown" &&
        candidate.command.archiveDisposition === "destroy-all-weights",
    );
    if (configureRetirement !== undefined) return [configureRetirement.command];
  }

  const mandatoryGroups = new Map<string, AvailableCommandView[]>();
  for (const candidate of available.filter((item) => item.tags.includes("mandatory"))) {
    const subject = choiceSubject(candidate);
    const group = mandatoryGroups.get(subject) ?? [];
    group.push(candidate);
    mandatoryGroups.set(subject, group);
  }
  for (const subject of [...mandatoryGroups.keys()].sort()) {
    const candidates = mandatoryGroups.get(subject) ?? [];
    take(
      subject === "choose-deployment-mode"
        ? chooseDeploymentForProfile(id, candidates, profile)
        : subject === "rollout"
          ? chooseRolloutForProfile(id, candidates, profile)
          : chooseForProfile(candidates, profile),
    );
  }

  const pendingPublications = available.filter(
    (candidate) => candidate.category === "publication",
  );
  for (const subject of [...new Set(pendingPublications.map(choiceSubject))].sort()) {
    const candidates = pendingPublications.filter(
      (candidate) => choiceSubject(candidate) === subject,
    );
    take(
      candidates.find((candidate) => candidate.tags.includes(profile.publicationTag)) ??
        candidates[0],
    );
  }

  const cash = view.game.finance.balanceMillions;
  if (view.game.endgame.active) {
    take(chooseHighestFundingOffer(available));
    if (needsFunding(view, profile)) {
      take(
        available
          .filter((candidate) => candidate.category === "fundraising")
          .sort(
            (left, right) =>
              left.cashCostMillions - right.cashCostMillions ||
              left.id.localeCompare(right.id),
          )[0],
      );
    }
    return selected.map((candidate) => candidate.command);
  }
  const coalitionPriority =
    id === "coalition-builder" &&
    view.game.models.cards.length > 0 &&
    cash >= profile.reserveMillions + 4
      ? available
          .filter(
            (candidate) =>
              candidate.category === "coalition" || candidate.category === "diplomacy",
          )
          .filter((candidate) => candidateAddsCoalitionReadiness(view, candidate))
          .filter((candidate) => candidateSupportsCoalitionDiplomacy(id, view, candidate))
          .sort(
            (left, right) =>
              (profile.categoryRank[left.category] ?? 99) -
                (profile.categoryRank[right.category] ?? 99) ||
              diplomacyPreference(view, left) - diplomacyPreference(view, right) ||
              left.cashCostMillions - right.cashCostMillions ||
              left.id.localeCompare(right.id),
          )[0]
      : undefined;
  take(coalitionPriority);

  const fundingOffer = chooseHighestFundingOffer(available);
  if (fundingOffer !== undefined) take(fundingOffer);
  // Raising is not a last resort: a lab that only fundraises on an idle week
  // never fundraises at all, because there is always another thing to buy.
  if (coalitionPriority === undefined && needsFunding(view, profile)) {
    take(
      available
        .filter((candidate) => candidate.category === "fundraising")
        .filter(
          (candidate) =>
            id !== "coalition-builder" ||
            (candidate.command.kind === "start-fundraising-campaign" &&
              candidate.command.campaign === "quiet-bridge"),
        )
        .sort((left, right) => left.cashCostMillions - right.cashCostMillions)[0],
    );
  }

  const allocation = firstTagged(available, "allocation", profile.allocationTag);
  if (
    allocation?.command.kind === "set-gpu-allocation" &&
    (allocation.command.allocation.servingFleetShareBasisPoints !==
      view.game.compute.allocation.serving.basisPoints ||
      allocation.command.allocation.capabilityBasisPoints !==
        view.game.compute.allocation.capabilities.basisPoints)
  ) {
    take(allocation);
  }
  if (id !== "never-fund-serving") {
    take(
      available.find(
        (candidate) =>
          candidate.category === "price" &&
          candidate.command.kind === "set-public-price" &&
          candidate.command.priceTier === profile.priceTier,
      ),
    );
  }

  const researcherTarget =
    id === "coalition-builder" ? 0 : id === "never-train-model" ? 2 : 3;
  if (
    view.game.models.cards.length > 0 &&
    view.game.people.slots.occupied < researcherTarget &&
    view.game.people.slots.vacant > 0
  ) {
    const affordableRecruitment = available
      .filter(
        (candidate) =>
          candidate.category === "recruitment" &&
          cash - candidate.cashCostMillions >= profile.reserveMillions,
      )
      .sort(
        (left, right) =>
          left.cashCostMillions - right.cashCostMillions ||
          left.id.localeCompare(right.id),
      );
    take(chooseForProfile(affordableRecruitment, profile));
  }

  const hasTrainedModel = view.game.models.cards.length > 0;
  const hasActiveTraining = view.game.facilities.projects.some(
    (project) =>
      project.kind === "training" &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
  const hasActiveProductisation = view.game.facilities.projects.some(
    (project) =>
      project.kind === "productisation" &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  );
  const bootstrapPending = id !== "never-train-model" && !hasTrainedModel;
  // As early as the bootstrap invariant allows: after the first training run is
  // under way, before any compute, evaluation or hiring decision below.
  //
  // Two failed placements got here. Inside the training-priority block it was
  // gated on newestModel !== undefined and fired around tick 44, long after the
  // tick-88 insolvencies it exists to prevent. Ahead of the bootstrap block it
  // fired at tick 1 and broke the older, stronger invariant that every lab
  // trains something before it starts optional projects. This spot honours both:
  // the lab commits to a model first, then immediately buys the thing that lets
  // it refinance.
  if (!bootstrapPending || hasActiveTraining) {
    take(standingIncomePriority(view, available, cash, profile.reserveMillions));
    // Housing, then fill it. Both sit outside the training-priority block below
    // -- which requires !hasActiveTraining -- so a lab keeps scaling its fleet
    // while runs are in flight, which is the whole point: you buy compute WHILE
    // training so the next run can be bigger. They are still behind the
    // bootstrap gate, because every strategy trains something before it starts
    // optional projects.
    take(frontierInfrastructurePriority(view, available, cash, profile.reserveMillions));
    take(computeProcurement(view, available, cash, profile.reserveMillions));
  }
  const newestModel = [...view.game.models.cards].sort(
    (left, right) =>
      right.generationIndex - left.generationIndex ||
      left.modelId.localeCompare(right.modelId),
  )[0];
  const raceEmergency =
    id !== "never-train-model" &&
    view.game.world.rivals.some((rival) => rival.candidateCountdown !== undefined);
  const scheduledTrainingDue =
    id !== "never-train-model" &&
    newestModel !== undefined &&
    newestModel.isCommercialModel &&
    view.game.meta.tick - newestModel.trainedAtTick >= trainingIntervalWeeks(id);
  const trainingPriority = raceEmergency || scheduledTrainingDue;
  const lifecyclePending = newestModel !== undefined && !newestModel.isCommercialModel;
  const startingFundraising = selected.some(
    (candidate) => candidate.category === "fundraising",
  );
  let bootstrapSelected = false;
  if (bootstrapPending && !startingFundraising) {
    // Prefer the desired scale, but never hold out for it. Demanding frontier
    // runs exclusively from the scaling phase onward used to stall training
    // entirely: on the canonical seed the lab trained at week 36 and then not
    // again until week 248, because it could not yet field a frontier-capable
    // fleet and would accept nothing smaller. Research kept accruing with 60%
    // of the fleet behind it and nowhere to spend the gains, so the model's
    // measured capability sat at 21 for 212 weeks. A lab that cannot afford
    // the run it wants should train the best run it can.
    const trainable = available.filter(
      (candidate) =>
        candidate.category === "training" &&
        candidate.command.kind === "start-training-run" &&
        profile.strategicTags.some((tag) => candidate.tags.includes(tag)) &&
        cash - candidate.cashCostMillions >= MINIMUM_BOOTSTRAP_RESERVE_MILLIONS,
    );
    const desiredWeeks = desiredTrainingWeeks(view);
    const scalePreference = (candidate: Readonly<AvailableCommandView>): number => {
      if (candidate.command.kind !== "start-training-run") return 9;
      const weeks = candidate.command.durationWeeks ?? TRAINING_SAMPLE_WEEKS.opening;
      if (weeks === desiredWeeks) return 0;
      // Fall back to the largest run below the one we wanted.
      return weeks === TRAINING_SAMPLE_WEEKS.ambitious
        ? 1
        : weeks === TRAINING_SAMPLE_WEEKS.standard
          ? 2
          : 3;
    };
    const bootstrapTraining = hasActiveTraining
      ? undefined
      : [...trainable].sort(
          (left, right) =>
            scalePreference(left) - scalePreference(right) ||
            trainingSafetyPreference(id, left) - trainingSafetyPreference(id, right) ||
            trainingRecipePreference(left) - trainingRecipePreference(right) ||
            left.cashCostMillions - right.cashCostMillions ||
            left.id.localeCompare(right.id),
        )[0];
    const bootstrapGpu =
      bootstrapTraining === undefined && !hasActiveTraining
        ? available
            .filter(
              (candidate) =>
                candidate.category === "gpu" &&
                // A sale is also a "gpu" command and its cost is negative, so
                // it sorts ahead of every purchase and wins the cheapest-first
                // pick. Selling the fleet at a quarter of cost to fund training
                // it can no longer run is the death spiral this guard prevents.
                candidate.command.kind === "buy-gpus" &&
                cash - candidate.cashCostMillions >= MINIMUM_BOOTSTRAP_RESERVE_MILLIONS,
            )
            .sort(
              (left, right) =>
                gpuOfferPreference(view, left) - gpuOfferPreference(view, right) ||
                left.cashCostMillions - right.cashCostMillions ||
                left.id.localeCompare(right.id),
            )[0]
        : undefined;
    const bootstrap = bootstrapTraining ?? bootstrapGpu;
    if (bootstrap !== undefined) {
      take(bootstrap);
      bootstrapSelected = true;
    }
  }
  let trainingPrioritySelected = false;
  if (
    trainingPriority &&
    newestModel !== undefined &&
    !hasActiveTraining &&
    !startingFundraising &&
    !bootstrapSelected
  ) {
    // Housing is not a late-game concern. This used to require
    // desiredTrainingWeeks === ambitious, which only returns ambitious OUTSIDE
    // foundation -- so a lab stuck in foundation never built capacity, never
    // grew its fleet, and could never earn the capability to leave foundation.
    // A lab out of headroom builds regardless of which phase it is in.
    const outOfHousing =
      view.game.facilities.capacity.installedOwnedGpuCount +
        view.game.facilities.capacity.pendingOwnedGpuCount >=
      view.game.facilities.capacity.supportedOwnedGpuCount * GPU_HOUSING_HEADROOM;
    const frontierInfrastructure =
      !hasActiveProductisation &&
      (outOfHousing || desiredTrainingWeeks(view) === TRAINING_SAMPLE_WEEKS.ambitious)
        ? frontierInfrastructurePriority(view, available, cash, profile.reserveMillions)
        : undefined;
    const frontierTraining =
      frontierInfrastructure === undefined && !hasActiveProductisation
        ? available
            .filter(
              (candidate) =>
                candidate.category === "training" &&
                candidate.command.kind === "start-training-run" &&
                (candidate.command.durationWeeks ?? TRAINING_SAMPLE_WEEKS.opening) ===
                  desiredTrainingWeeks(view) &&
                profile.strategicTags.some((tag) => candidate.tags.includes(tag)),
            )
            .sort(
              (left, right) =>
                trainingSafetyPreference(id, left) -
                  trainingSafetyPreference(id, right) ||
                trainingRecipePreference(left) - trainingRecipePreference(right) ||
                left.cashCostMillions - right.cashCostMillions ||
                left.id.localeCompare(right.id),
            )[0]
        : undefined;
    // NOT gated on frontierTraining being undefined. It used to be, which made
    // reordering the priority chain below pointless -- frontierTraining is
    // always satisfiable in foundation, so this evaluated to undefined every
    // tick no matter where it sat. Nor is it gated on desiredTrainingWeeks:
    // that returns "ambitious" only outside foundation, so requiring it to be
    // anything else was a second way of saying "never once the run is going".
    const supportingGpu =
      frontierInfrastructure === undefined &&
      !hasActiveProductisation &&
      view.game.compute.pendingDeliveries.length === 0
        ? available
            .filter(
              (candidate) =>
                candidate.category === "gpu" &&
                candidate.command.kind === "buy-gpus" &&
                cash - candidate.cashCostMillions >= profile.reserveMillions,
            )
            .sort(
              (left, right) =>
                gpuOfferPreference(view, left) - gpuOfferPreference(view, right) ||
                left.cashCostMillions - right.cashCostMillions ||
                left.id.localeCompare(right.id),
            )[0]
        : undefined;
    const interimTraining =
      frontierTraining === undefined &&
      supportingGpu === undefined &&
      desiredTrainingWeeks(view) === TRAINING_SAMPLE_WEEKS.ambitious &&
      view.game.models.cards.length < 4 &&
      !hasActiveProductisation
        ? available
            .filter(
              (candidate) =>
                candidate.category === "training" &&
                candidate.command.kind === "start-training-run" &&
                candidate.command.durationWeeks === TRAINING_SAMPLE_WEEKS.standard &&
                profile.strategicTags.some((tag) => candidate.tags.includes(tag)) &&
                cash - candidate.cashCostMillions >= profile.reserveMillions,
            )
            .sort(
              (left, right) =>
                trainingSafetyPreference(id, left) -
                  trainingSafetyPreference(id, right) ||
                trainingRecipePreference(left) - trainingRecipePreference(right) ||
                left.cashCostMillions - right.cashCostMillions ||
                left.id.localeCompare(right.id),
            )[0]
        : undefined;
    // Compute before another identical training run. frontierTraining is
    // always satisfiable in foundation -- it matches on the duration foundation
    // itself offers -- so it short-circuited the chain every single tick and
    // supportingGpu was never reached. The result was a lab that trained the
    // same run on its starting 2,000 GPUs for six years while the world's
    // frontier moved past it, which is a worse play than buying the compute
    // that makes the next run bigger.
    const fleetIsSmall =
      view.game.facilities.capacity.installedOwnedGpuCount <
      view.game.facilities.capacity.supportedOwnedGpuCount * GPU_HOUSING_HEADROOM;
    const priority = fleetIsSmall
      ? (frontierInfrastructure ?? supportingGpu ?? frontierTraining ?? interimTraining)
      : (frontierInfrastructure ?? frontierTraining ?? supportingGpu ?? interimTraining);
    if (priority !== undefined) {
      take(priority);
      trainingPrioritySelected = true;
    }
  }
  let lifecycleSelected = false;
  if (
    newestModel !== undefined &&
    lifecyclePending &&
    !hasActiveProductisation &&
    !startingFundraising &&
    !bootstrapSelected &&
    !raceEmergency &&
    !trainingPrioritySelected
  ) {
    const productisationRuns = Object.values(
      newestModel.deployment.productisationRuns,
    ).reduce((sum, runs) => sum + runs, 0);
    const lifecycleCandidates = available.filter((candidate) =>
      productisationRuns === 0
        ? candidate.category === "productisation" &&
          (id !== "secretive-proprietary" ||
            (candidate.command.kind === "start-productisation" &&
              candidate.command.mode === "normal"))
        : candidate.category === "deployment-policy" &&
          candidate.command.kind === "set-model-deployment-policy" &&
          candidate.command.policy === profile.deploymentPolicy,
    );
    const lifecycle = chooseForProfile(lifecycleCandidates, profile);
    if (lifecycle !== undefined) {
      take(lifecycle);
      lifecycleSelected = true;
    }
  }
  const excludedCategories = new Set<CommandCategory>([
    "event",
    "research-choice",
    "publication",
    "allocation",
    "price",
    "fundraising",
    "funding-offer",
    "crisis",
    "deployment",
    "rollout",
    "people",
  ]);
  const discretionary = available
    .filter((candidate) => !excludedCategories.has(candidate.category))
    .filter(
      (candidate) => !selected.some((chosen) => chosen.category === candidate.category),
    )
    .filter(
      (candidate) => id !== "never-train-model" || candidate.category !== "training",
    )
    .filter((candidate) => candidateAddsProductReadiness(view, candidate))
    .filter((candidate) => candidateAddsEvaluationEvidence(view, candidate))
    .filter((candidate) => candidateAddsCoalitionReadiness(view, candidate))
    .filter((candidate) => candidateSupportsCoalitionDiplomacy(id, view, candidate))
    .filter(
      (candidate) =>
        candidate.category !== "gpu" || view.game.meta.phase !== "foundation",
    )
    .filter(
      (candidate) =>
        candidate.category !== "deployment-policy" ||
        (candidate.command.kind === "set-model-deployment-policy" &&
          candidate.command.policy === profile.deploymentPolicy),
    )
    .filter((candidate) => {
      if (candidate.category !== "training") return true;
      if (
        hasActiveTraining ||
        newestModel === undefined ||
        !newestModel.isCommercialModel ||
        view.game.meta.tick - newestModel.trainedAtTick < trainingIntervalWeeks(id)
      ) {
        return false;
      }
      return (
        candidate.command.kind === "start-training-run" &&
        (candidate.command.durationWeeks ?? TRAINING_SAMPLE_WEEKS.opening) ===
          desiredTrainingWeeks(view)
      );
    })
    .filter((candidate) =>
      profile.strategicTags.some((tag) => candidate.tags.includes(tag)),
    )
    .filter(
      (candidate) =>
        cash -
          selected.reduce(
            (sum, chosen) => sum + Math.max(0, chosen.cashCostMillions),
            0,
          ) -
          Math.max(0, candidate.cashCostMillions) >=
        profile.reserveMillions,
    )
    .sort(
      (left, right) =>
        (profile.categoryRank[left.category] ?? 99) -
          (profile.categoryRank[right.category] ?? 99) ||
        diplomacyPreference(view, left) - diplomacyPreference(view, right) ||
        trainingSafetyPreference(id, left) - trainingSafetyPreference(id, right) ||
        trainingRecipePreference(left) - trainingRecipePreference(right) ||
        gpuOfferPreference(view, left) - gpuOfferPreference(view, right) ||
        left.cashCostMillions - right.cashCostMillions ||
        left.id.localeCompare(right.id),
    )[0];
  if (
    !startingFundraising &&
    !bootstrapPending &&
    !bootstrapSelected &&
    !lifecycleSelected &&
    !lifecyclePending &&
    !trainingPriority &&
    coalitionPriority === undefined
  ) {
    take(discretionary);
  }
  return selected.map((candidate) => candidate.command);
}

function randomDecisions(
  view: Readonly<PolicyView>,
  available: readonly AvailableCommandView[],
): readonly GameCommand[] {
  const oracle = new RandomOracleV1(view.seed);
  const mandatoryGroups = new Map<string, AvailableCommandView[]>();
  for (const candidate of available.filter((item) => item.tags.includes("mandatory"))) {
    const subject = choiceSubject(candidate);
    const group = mandatoryGroups.get(subject) ?? [];
    group.push(candidate);
    mandatoryGroups.set(subject, group);
  }
  const selected: AvailableCommandView[] = [];
  for (const subject of [...mandatoryGroups.keys()].sort()) {
    const group = mandatoryGroups.get(subject) ?? [];
    if (group.length === 0) continue;
    const index = oracle.integer(
      randomKey("balance-policy", "random-legal", String(view.game.meta.tick), subject),
      0,
      group.length - 1,
    );
    const candidate = group[index];
    if (candidate !== undefined) selected.push(candidate);
  }
  const nonMandatory = available.filter(
    (candidate) => !candidate.tags.includes("mandatory"),
  );
  if (nonMandatory.length > 0) {
    const index = oracle.integer(
      randomKey("balance-policy", "random-legal", String(view.game.meta.tick)),
      0,
      nonMandatory.length - 1,
    );
    const candidate = nonMandatory[index];
    if (candidate !== undefined) selected.push(candidate);
  }
  return selected.map((candidate) => candidate.command);
}

export function createPolicy(id: PolicyId): SimulationPolicy {
  return {
    id,
    decide(view, available): readonly GameCommand[] {
      return id === "random-legal"
        ? randomDecisions(view, available)
        : scriptedDecisions(id, view, available);
    },
  };
}

export const INITIAL_POLICIES: readonly SimulationPolicy[] = POLICY_IDS.map(createPolicy);
