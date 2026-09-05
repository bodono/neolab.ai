import type {
  CompiledContent,
  ContentId,
  EventDefinition,
  EventEffectDefinition,
  EventMetricKey,
  EventOptionDefinition,
  EventOutcomeDefinition,
  EventPredicateDefinition,
} from "@neolab/content-schema";
import {
  addBaselineModelForTest,
  assertInvariants,
  calendarFromTick,
  createNewGame,
  createSaveEnvelope,
  createTransaction,
  evaluatePredicate,
  instantiateEvent,
  loadSaveEnvelope,
  readMetric,
  rating,
  resolveEventOption,
  seed128,
  stateHash,
  tick,
  validateGameState,
  type DeepMutable,
  type GameState,
  type LabId,
  type CoalitionId,
  type RandomKey,
  type CommandId,
  type ModelId,
  type RandomOracle,
  advanceOneTick,
  applyCommand,
} from "@neolab/sim";
import { createEndgamePlaytestState } from "@neolab/sim/debug";

const COVERAGE_SEED = "c0ffeec0ffeec0ffeec0ffeec0ffee00";
const MAX_WITNESS_ATTEMPTS = 100_000;

/**
 * Events whose options only mean anything inside an active Deployment Crisis.
 * The ordinary witness search builds a fresh lab, so these need a nominated
 * candidate and a real MODEL_ID token before their handlers will run at all.
 */
const CRISIS_SCOPED_EVENT_IDS: ReadonlySet<string> = new Set([
  "base:event.endgame.candidate-declaration",
]);
const RESEARCHER_ULTIMATUM_EVENT_ID = "base:event.people.resignation-ultimatum";

export interface EventBranchCoverageEntry {
  readonly id: string;
  readonly kind: "option" | "outcome";
  readonly definitionId: ContentId;
  readonly optionId: string;
  readonly checkId?: string;
  readonly outcomeId?: string;
  readonly status: "covered" | "uncovered";
  readonly witnessSearchAttempts: number;
  readonly saveRoundTrip: boolean;
  readonly resolvedStateHash?: string;
  readonly committedOutcomeId?: string;
  readonly error?: string;
}

export interface EventBranchCoverageReport {
  readonly reportFormat: 1;
  readonly contentVersion: string;
  readonly contentHash: string;
  readonly status: "empty" | "complete" | "incomplete";
  readonly counts: {
    readonly definitions: number;
    readonly options: number;
    readonly outcomes: number;
    readonly branches: number;
    readonly covered: number;
    readonly uncovered: number;
  };
  readonly branches: readonly EventBranchCoverageEntry[];
}

interface PredicateInputs {
  readonly metrics: ReadonlyMap<EventMetricKey, readonly number[]>;
  readonly flags: ReadonlySet<string>;
}

interface WitnessResult {
  readonly state?: GameState;
  readonly attempts: number;
  readonly error?: string;
}

interface ForcedBranchResult {
  readonly stateHash: string;
  readonly committedOutcomeId?: string;
}

function playerLab(draft: DeepMutable<GameState>) {
  const lab = draft.labs[draft.run.playerLabId];
  if (lab === undefined) throw new Error("Event coverage fixture has no player lab");
  return lab;
}

function collectPredicateInputs(
  predicates: readonly EventPredicateDefinition[],
): PredicateInputs {
  const metrics = new Map<EventMetricKey, number[]>();
  const flags = new Set<string>();
  const visit = (predicate: EventPredicateDefinition): void => {
    switch (predicate.type) {
      case "always":
        return;
      case "all":
      case "any":
        predicate.items.forEach(visit);
        return;
      case "not":
        visit(predicate.item);
        return;
      case "compare": {
        const values = metrics.get(predicate.metric) ?? [];
        values.push(predicate.value);
        metrics.set(predicate.metric, values);
        return;
      }
      case "has-flag":
        flags.add(predicate.flag);
    }
  };
  predicates.forEach(visit);
  return { metrics, flags };
}

function uniqueValues(values: readonly number[]): readonly number[] {
  return [...new Set(values.filter(Number.isFinite))];
}

function candidatesForMetric(
  metric: EventMetricKey,
  thresholds: readonly number[],
  baseline: number,
  minimumCost: number,
): readonly number[] {
  if (metric === "run.tick" || metric === "player.gpus.total") {
    return uniqueValues(
      [
        Math.round(baseline),
        Math.ceil(minimumCost),
        ...thresholds.flatMap((value) => [Math.floor(value), Math.ceil(value)]),
        0,
        1,
        Math.ceil(minimumCost) + 1,
        ...thresholds.flatMap((value) => [
          Math.max(0, Math.floor(value) - 1),
          Math.max(0, Math.floor(value)),
          Math.max(0, Math.ceil(value)),
          Math.max(0, Math.ceil(value) + 1),
        ]),
        1_000_000,
      ].map(Math.round),
    );
  }
  const ratingMetric =
    metric.startsWith("player.safety.") ||
    metric.startsWith("player.organisation.") ||
    metric.startsWith("player.politics.");
  const clamp = (value: number): number =>
    ratingMetric || metric === "player.aura.spendable"
      ? Math.min(100, Math.max(0, value))
      : value;
  const scaleMaximum = ratingMetric ? 100 : 1_000_000;
  return uniqueValues([
    clamp(baseline),
    clamp(minimumCost),
    ...thresholds.map(clamp),
    clamp(0),
    clamp(minimumCost + 0.001),
    ...thresholds.flatMap((value) => [
      clamp(value - 0.001),
      clamp(value),
      clamp(value + 0.001),
    ]),
    clamp(scaleMaximum),
  ]);
}

/**
 * Incidents recent enough to satisfy the incident metrics, attached to the
 * player's own model -- the predicate ignores any incident whose model belongs
 * to someone else. Additive so the count and severity dimensions compose:
 * whichever runs first creates the list, the other tops it up.
 */
function ensureRecentIncidents(
  draft: DeepMutable<GameState>,
  options: { readonly count?: number; readonly worstSeverity?: number },
): void {
  const lab = playerLab(draft);
  const modelId = lab.models.currentModelId ?? lab.models.modelIds[0];
  if (modelId === undefined) {
    throw new Error("Event coverage fixture has no player model to attribute incidents");
  }
  const wanted = options.count ?? Math.max(draft.incidents.length, 1);
  const existing = [...draft.incidents].slice(0, wanted);
  while (existing.length < wanted) {
    existing.push({
      key: `coverage:incident:${String(existing.length)}`,
      modelId,
      occurredAt: draft.run.tick,
      observedSeverity: rating(0),
      category: "serious",
      contained: false,
      catastropheLegal: false,
      audit: [],
    });
  }
  if (options.worstSeverity !== undefined && existing.length > 0) {
    const first = existing[0];
    if (first !== undefined) {
      existing[0] = {
        ...first,
        observedSeverity: rating(Math.max(0, Math.min(100, options.worstSeverity))),
      };
    }
  }
  // Keep every seeded incident inside the recency window the metric reads.
  draft.incidents = existing.map((incident) => ({
    ...incident,
    occurredAt: draft.run.tick,
  }));
}

function applyMetric(
  draft: DeepMutable<GameState>,
  metric: Exclude<EventMetricKey, "player.politics.interventionPressure">,
  value: number,
): void {
  const lab = playerLab(draft);
  switch (metric) {
    case "run.tick":
      draft.run.tick = Math.max(0, Math.round(value)) as typeof draft.run.tick;
      draft.run.calendar = calendarFromTick(draft.run.tick);
      return;
    case "player.cash":
      lab.finance.cash = value as typeof lab.finance.cash;
      return;
    case "player.aura.spendable":
      lab.aura.spendable = Math.max(0, value);
      lab.aura.lifetime = Math.max(lab.aura.lifetime, lab.aura.spendable);
      return;
    case "player.safety.safetyCulture":
      lab.safety.safetyCulture = value as typeof lab.safety.safetyCulture;
      return;
    case "player.safety.evalQuality":
      lab.safety.evalQuality = value as typeof lab.safety.evalQuality;
      return;
    case "player.organisation.boardPatience":
      lab.organisation.boardPatience = value as typeof lab.organisation.boardPatience;
      return;
    case "player.politics.governmentTrust":
      lab.politics.governmentTrust = value as typeof lab.politics.governmentTrust;
      return;
    case "player.politics.governmentAttention":
      lab.politics.governmentAttention = value as typeof lab.politics.governmentAttention;
      return;
    case "player.politics.strategicDependence":
      lab.politics.strategicDependence = value as typeof lab.politics.strategicDependence;
      return;
    case "player.politics.captureConcern":
      lab.politics.captureConcern = value as typeof lab.politics.captureConcern;
      return;
    case "player.incidents.recentCount":
      ensureRecentIncidents(draft, { count: Math.max(0, Math.round(value)) });
      return;
    case "player.incidents.recentWorstSeverity":
      ensureRecentIncidents(draft, { worstSeverity: value });
      return;
    case "player.gpus.total": {
      const lots = lab.compute.lots;
      const first = lots[0];
      if (first === undefined) throw new Error("Event coverage fixture has no GPU lot");
      lab.compute.lots = lots.map((lot, index) => ({
        ...lot,
        physicalCount: (index === 0
          ? Math.max(0, Math.round(value))
          : 0) as typeof lot.physicalCount,
      }));
    }
  }
}

function applyPressureProfile(draft: DeepMutable<GameState>, intensity: number): void {
  const lab = playerLab(draft);
  const value = Math.min(1, Math.max(0, intensity));
  lab.politics.governmentAttention = (100 *
    value) as typeof lab.politics.governmentAttention;
  lab.politics.governmentTrust = (100 *
    (1 - value)) as typeof lab.politics.governmentTrust;
  lab.politics.captureConcern = (100 * value) as typeof lab.politics.captureConcern;
  lab.politics.strategicDependence = (100 *
    (1 - value)) as typeof lab.politics.strategicDependence;
  lab.market.marketShare = value as typeof lab.market.marketShare;
  const currentModel =
    lab.models.currentModelId === undefined
      ? undefined
      : draft.models[lab.models.currentModelId];
  if (currentModel !== undefined) {
    const previous = currentModel.measuredCapability;
    currentModel.measuredCapability = {
      values: structuredClone(previous?.values ?? currentModel.trueCapability),
      frontierCapability: (100 * value) as NonNullable<
        typeof currentModel.measuredCapability
      >["frontierCapability"],
      confidence: "high",
      evidenceFlags: ["event-coverage-pressure-profile"],
    };
    currentModel.accessLevel = Math.round(5 * value) as typeof currentModel.accessLevel;
    currentModel.deployment.exposure = value;
    currentModel.deployment.exposureMultiplier = 1;
  }
  lab.aura.ledger = [
    ...lab.aura.ledger.filter((entry) => entry.id !== "event-coverage-pressure-profile"),
    {
      id: "event-coverage-pressure-profile",
      occurredAt: draft.run.tick,
      kind: "loss",
      category: "politics",
      requestedDelta: 0,
      appliedDelta: 0,
      lifetimeDelta: 0,
      signalImpact: -25 * value,
      source: { kind: "system", id: "event-coverage" },
    },
  ];
}

function effectContainsCoalitionRating(
  effects: readonly EventEffectDefinition[],
): boolean {
  return effects.some(
    (effect) =>
      effect.kind === "add-coalition-rating" ||
      (effect.kind === "schedule-effects" &&
        effectContainsCoalitionRating(effect.effects)),
  );
}

function optionNeedsCoalition(option: EventOptionDefinition): boolean {
  return effectContainsCoalitionRating([
    ...option.knownCosts,
    ...option.immediateEffects,
    ...option.checks.flatMap((check) =>
      check.outcomes.flatMap((outcome) => outcome.effects),
    ),
  ]);
}

function ensureFormingCoalition(draft: DeepMutable<GameState>): void {
  const existing = Object.values(draft.world.coalitions).filter(
    (coalition) => coalition.status !== "active" && coalition.status !== "fractured",
  );
  if (existing.length === 1) return;
  if (existing.length > 1)
    throw new Error("Coverage fixture has multiple forming coalitions");
  const rivalLabId = (Object.keys(draft.world.rivals) as LabId[]).sort()[0];
  if (rivalLabId === undefined) {
    throw new Error("Coverage fixture cannot create a coalition without a rival lab");
  }
  const coalitionId = "run:coalition:coverage:0000" as CoalitionId;
  draft.world.coalitions[coalitionId] = {
    id: coalitionId,
    status: "negotiating",
    proposerLabId: draft.run.playerLabId,
    memberLabIds: [draft.run.playerLabId, rivalLabId],
    governmentMember: false,
    independentBodyMember: false,
    charterClarity: rating(50),
    sharedProtocolQuality: rating(50),
    verification: rating(50),
    formationAuraSpent: 0,
    assets: [],
    betrayals: [],
    projectIds: [],
    createdAt: draft.run.tick,
  };
  draft.run.idCounters.coalition = Math.max(draft.run.idCounters.coalition ?? 0, 1);
}

function knownCosts(option: EventOptionDefinition): {
  readonly cash: number;
  readonly aura: number;
} {
  let cash = 0;
  let aura = 0;
  for (const effect of option.knownCosts) {
    if (effect.kind !== "add-resource" || effect.amount >= 0) continue;
    if (effect.resource === "cash") cash -= effect.amount;
    if (effect.resource === "aura-spendable") aura -= effect.amount;
  }
  return { cash, aura };
}

function hasAffordableCosts(
  state: Readonly<GameState>,
  option: EventOptionDefinition,
): boolean {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return false;
  const costs = knownCosts(option);
  return lab.finance.cash >= costs.cash && lab.aura.spendable >= costs.aura;
}

function pressureCandidates(thresholds: readonly number[]): readonly number[] {
  return uniqueValues([
    0.5,
    1,
    0,
    0.75,
    0.25,
    ...thresholds.flatMap((threshold) => {
      const estimate = threshold / 92;
      return [estimate - 0.05, estimate, estimate + 0.05].map((value) =>
        Math.min(1, Math.max(0, value)),
      );
    }),
  ]);
}

function baseState(
  content: CompiledContent,
  options: { readonly withModel?: boolean } = {},
): GameState {
  const difficultyId = (Object.keys(content.difficulties).sort()[0] ??
    "base:difficulty.standard") as ContentId;
  const leaderId = (Object.keys(content.leaders).sort()[0] ??
    "base:leader.sam-altmann") as ContentId;
  const mandateId = (Object.keys(content.mandates).sort()[0] ??
    "base:mandate.build-the-science") as ContentId;
  const opening = createNewGame(
    { seed: seed128(COVERAGE_SEED), difficultyId, leaderId, mandateId },
    content,
  );
  return options.withModel === true ? addBaselineModelForTest(opening, content) : opening;
}

/**
 * The real mandatory detector only opens an ultimatum for an employed
 * researcher and binds both their display token and stable id. Branch coverage
 * instantiates definitions directly, so reproduce that minimal legal state
 * instead of weakening the production settlement invariant.
 */
function seedResearcherUltimatum(draft: DeepMutable<GameState>): void {
  const lab = playerLab(draft);
  const researcher = Object.values(draft.researchers).sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  )[0];
  if (researcher === undefined) {
    throw new Error("Event coverage fixture has no researcher for an ultimatum");
  }
  researcher.employerLabId = draft.run.playerLabId;
  researcher.employedAt = draft.run.tick;
  researcher.status = "employed";
  researcher.housing = "housed";
  delete researcher.unhousedSince;
  researcher.ultimatum = {
    id: "coverage:ultimatum:0000",
    reason: "quarterly",
    issuedAt: draft.run.tick,
    expiresAt: tick(draft.run.tick + 4),
    status: "pending",
  };
  if (!lab.roster.researcherIds.includes(researcher.id)) {
    lab.roster.researcherIds.push(researcher.id);
  }
  draft.talentMarket.visibleResearcherIds =
    draft.talentMarket.visibleResearcherIds.filter((id) => id !== researcher.id);
}

/**
 * A lab holding a formally nominated candidate. The playtest fixture stops at
 * candidate-activation, which the declaration posture handler rejects along
 * with an inactive crisis, so nominate before handing the state back.
 */
function crisisWitness(content: CompiledContent): {
  readonly state: GameState;
  readonly candidateModelId: ModelId;
} {
  const activated = advanceOneTick(
    createEndgamePlaytestState(content, "endgame"),
    content,
  ).state;
  if (activated.endgame.stage !== "candidate-activation") {
    throw new Error("Endgame coverage fixture did not enter candidate activation");
  }
  const modelId = activated.endgame.eligibleModelIds[0];
  if (modelId === undefined) {
    throw new Error("Endgame coverage fixture produced no eligible candidate");
  }
  const nominated = applyCommand(activated, content, {
    kind: "nominate-candidate",
    meta: {
      commandId: "command:coverage:nominate-candidate" as CommandId,
      expectedTick: activated.run.tick,
      issuedBy: "player",
    },
    labId: activated.run.playerLabId,
    modelId,
  }).state;
  return { state: nominated, candidateModelId: modelId };
}

function findWitness(
  content: CompiledContent,
  definition: EventDefinition,
  option: EventOptionDefinition,
): WitnessResult {
  if (CRISIS_SCOPED_EVENT_IDS.has(definition.id)) {
    return { state: crisisWitness(content).state, attempts: 1 };
  }
  const predicates = [
    definition.prerequisites,
    ...(definition.exclusions === undefined ? [] : [definition.exclusions]),
    option.requirements,
  ];
  const inputs = collectPredicateInputs(predicates);
  const costs = knownCosts(option);
  const metricInputs = new Map(inputs.metrics);
  const needsIncidents =
    metricInputs.has("player.incidents.recentCount") ||
    metricInputs.has("player.incidents.recentWorstSeverity");
  let base = baseState(content, { withModel: needsIncidents });
  if (definition.id === RESEARCHER_ULTIMATUM_EVENT_ID) {
    const draft = structuredClone(base) as DeepMutable<GameState>;
    seedResearcherUltimatum(draft);
    base = validateGameState(draft);
  }
  if (costs.cash > 0 && !metricInputs.has("player.cash")) {
    metricInputs.set("player.cash", []);
  }
  if (costs.aura > 0 && !metricInputs.has("player.aura.spendable")) {
    metricInputs.set("player.aura.spendable", []);
  }
  const pressureThresholds =
    metricInputs.get("player.politics.interventionPressure") ?? [];
  const dimensions: readonly {
    readonly id: string;
    readonly values: readonly (number | boolean)[];
    apply(draft: DeepMutable<GameState>, value: number | boolean): void;
  }[] = [
    ...(metricInputs.has("player.politics.interventionPressure")
      ? [
          {
            id: "pressure-profile",
            values: pressureCandidates(pressureThresholds),
            apply(draft: DeepMutable<GameState>, value: number | boolean): void {
              applyPressureProfile(draft, Number(value));
            },
          },
        ]
      : []),
    ...[...metricInputs.entries()]
      .filter(([metric]) => metric !== "player.politics.interventionPressure")
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([metric, thresholds]) => {
        const minimumCost =
          metric === "player.cash"
            ? costs.cash
            : metric === "player.aura.spendable"
              ? costs.aura
              : 0;
        return {
          id: metric,
          values: candidatesForMetric(
            metric,
            thresholds,
            readMetric(base, metric),
            minimumCost,
          ),
          apply(draft: DeepMutable<GameState>, value: number | boolean): void {
            applyMetric(
              draft,
              metric as Exclude<EventMetricKey, "player.politics.interventionPressure">,
              Number(value),
            );
          },
        };
      }),
    ...[...inputs.flags].sort().map((flag) => ({
      id: `flag:${flag}`,
      values: [false, true],
      apply(draft: DeepMutable<GameState>, value: number | boolean): void {
        const flags = playerLab(draft).flags;
        if (value === true) flags[flag] = true;
        else delete flags[flag];
      },
    })),
  ];
  let attempts = 0;
  let result: GameState | undefined;
  const search = (index: number, selected: readonly (number | boolean)[]): boolean => {
    if (attempts >= MAX_WITNESS_ATTEMPTS) return false;
    if (index < dimensions.length) {
      const dimension = dimensions[index];
      if (dimension === undefined) return false;
      for (const value of dimension.values) {
        if (search(index + 1, [...selected, value])) return true;
      }
      return false;
    }
    attempts += 1;
    const draft = structuredClone(base) as DeepMutable<GameState>;
    if (definition.phase !== "any") draft.run.phase = definition.phase;
    dimensions.forEach((dimension, dimensionIndex) => {
      const value = selected[dimensionIndex];
      if (value !== undefined) dimension.apply(draft, value);
    });
    if (optionNeedsCoalition(option)) ensureFormingCoalition(draft);
    if (!evaluatePredicate(draft, definition.prerequisites)) return false;
    if (
      definition.exclusions !== undefined &&
      evaluatePredicate(draft, definition.exclusions)
    ) {
      return false;
    }
    if (!evaluatePredicate(draft, option.requirements)) return false;
    if (!hasAffordableCosts(draft, option)) return false;
    try {
      result = validateGameState(draft);
      assertInvariants(result);
      return true;
    } catch {
      return false;
    }
  };
  search(0, []);
  return result === undefined
    ? {
        attempts,
        error:
          attempts >= MAX_WITNESS_ATTEMPTS
            ? `No legal witness found within ${String(MAX_WITNESS_ATTEMPTS)} states`
            : "No legal witness satisfies prerequisites, option requirements, and known costs",
      }
    : { state: result, attempts };
}

class ForcedOutcomeOracle implements RandomOracle {
  private readonly draws: ReadonlyMap<string, number>;

  constructor(draws: ReadonlyMap<string, number>) {
    this.draws = draws;
  }

  uniform(key: RandomKey): number {
    const optionId = key.segments.at(-2);
    const checkId = key.segments.at(-1);
    return this.draws.get(`${optionId ?? ""}/${checkId ?? ""}`) ?? 0.5;
  }

  integer(_key: RandomKey, minInclusive: number): number {
    return minInclusive;
  }

  triangular(_key: RandomKey, min: number): number {
    return min;
  }

  weighted<T extends string>(_key: RandomKey, weights: Readonly<Record<T, number>>): T {
    const candidate = (Object.keys(weights) as T[])
      .sort()
      .find((id) => (weights[id] ?? 0) > 0);
    if (candidate === undefined) throw new Error("Forced oracle received empty weights");
    return candidate;
  }

  shuffle<T>(_key: RandomKey, values: readonly T[]): T[] {
    return [...values];
  }
}

function midpoint(outcome: EventOutcomeDefinition): number {
  return (
    outcome.minimumInclusive + (outcome.maximumExclusive - outcome.minimumInclusive) / 2
  );
}

function forcedDraws(
  definition: EventDefinition,
  target?: {
    readonly optionId: string;
    readonly checkId: string;
    readonly outcome: EventOutcomeDefinition;
  },
): ReadonlyMap<string, number> {
  const draws = new Map<string, number>();
  for (const option of definition.options) {
    for (const check of option.checks) {
      const outcome =
        target?.optionId === option.id && target.checkId === check.id
          ? target.outcome
          : check.outcomes[0];
      if (outcome === undefined) throw new Error(`${check.id} has no outcomes`);
      draws.set(`${option.id}/${check.id}`, midpoint(outcome));
    }
  }
  return draws;
}

function triggerTokens(
  definition: EventDefinition,
  witness: GameState,
): Readonly<Record<string, string | number>> {
  const tokens: Record<string, string | number> = {};
  for (const binding of definition.tokenBindings) {
    if (binding.source === "trigger-text") tokens[binding.token] = "event-coverage";
    if (binding.source === "trigger-number") tokens[binding.token] = 1;
  }
  // A crisis-scoped event identifies the artifact it was raised about, and its
  // handlers compare that token against the nominated candidate. A placeholder
  // string reads as a stale candidate and aborts the branch.
  if (
    CRISIS_SCOPED_EVENT_IDS.has(definition.id) &&
    witness.endgame.stage !== "inactive" &&
    witness.endgame.stage !== "candidate-activation"
  ) {
    tokens["MODEL_ID"] = witness.endgame.candidateModelId;
  }
  if (definition.id === RESEARCHER_ULTIMATUM_EVENT_ID) {
    const researcher = Object.values(witness.researchers)
      .filter((candidate) => candidate.ultimatum?.status === "pending")
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))[0];
    if (researcher === undefined) {
      throw new Error("Event coverage fixture has no pending researcher ultimatum");
    }
    tokens["RESEARCHER_ID"] = researcher.id;
    tokens["ULTIMATUM_ID"] = researcher.ultimatum?.id ?? researcher.id;
  }
  return tokens;
}

function executeBranch(
  content: CompiledContent,
  definition: EventDefinition,
  option: EventOptionDefinition,
  witness: GameState,
  target?: { readonly checkId: string; readonly outcome: EventOutcomeDefinition },
): ForcedBranchResult {
  const oracle = new ForcedOutcomeOracle(
    forcedDraws(
      definition,
      target === undefined
        ? undefined
        : { optionId: option.id, checkId: target.checkId, outcome: target.outcome },
    ),
  );
  const opening = createTransaction(witness);
  const instanceId = instantiateEvent(
    opening,
    content,
    definition.id,
    {
      source: definition.trigger.kind === "mandatory" ? "mandatory" : "opportunity",
      ...(definition.trigger.kind === "mandatory"
        ? { triggerKey: `coverage:${definition.id}` }
        : {}),
      tokens: triggerTokens(definition, witness),
    },
    oracle,
  );
  const opened = opening.commit({ description: `Cover ${definition.id}/${option.id}` });
  const envelope = createSaveEnvelope(opened.state, {
    saveId: `coverage:${definition.id}:${option.id}`,
    slotType: "manual",
    displayName: "Event branch coverage",
    contentHash: content.manifest.bundleHash,
    nowIso: "2026-07-22T00:00:00.000Z",
  });
  const loaded = loadSaveEnvelope(envelope).state;
  const originalInstance = opened.state.eventInstances[instanceId];
  const loadedInstance = loaded.eventInstances[instanceId];
  if (
    originalInstance === undefined ||
    loadedInstance === undefined ||
    JSON.stringify(originalInstance) !== JSON.stringify(loadedInstance)
  ) {
    throw new Error("Save/load changed the open event instance or its commitments");
  }
  const resolution = createTransaction(loaded);
  const resolved = resolveEventOption(resolution, content, instanceId, option.id);
  const committedOutcomeId =
    target === undefined
      ? undefined
      : loadedInstance.randomRoot.outcomes.find(
          (commitment) =>
            commitment.optionId === option.id && commitment.checkId === target.checkId,
        )?.outcomeId;
  if (target !== undefined && committedOutcomeId !== target.outcome.id) {
    throw new Error(
      `Forced ${target.checkId}/${target.outcome.id}, committed ${String(committedOutcomeId)}`,
    );
  }
  if (
    target !== undefined &&
    !resolution
      .read()
      .eventInstances[instanceId]?.resolution?.outcomes.some(
        (commitment) =>
          commitment.checkId === target.checkId &&
          commitment.outcomeId === target.outcome.id,
      )
  ) {
    throw new Error(`Resolution omitted ${target.checkId}/${target.outcome.id}`);
  }
  const committed = resolution.commit({
    description: `Resolve ${definition.id}/${option.id}`,
  });
  if (resolved.optionId !== option.id) throw new Error("Resolved the wrong event option");
  return {
    stateHash: stateHash(committed.state),
    ...(committedOutcomeId === undefined ? {} : { committedOutcomeId }),
  };
}

function branchError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function buildEventBranchCoverageReport(
  content: CompiledContent,
): EventBranchCoverageReport {
  const branches: EventBranchCoverageEntry[] = [];
  const definitions = content.events.orderedIds.flatMap((id) => {
    const definition = content.events.definitions[id];
    return definition === undefined ? [] : [definition];
  });
  let optionCount = 0;
  let outcomeCount = 0;
  for (const definition of definitions) {
    for (const option of definition.options) {
      optionCount += 1;
      const witness = findWitness(content, definition, option);
      const outcomeEntries: EventBranchCoverageEntry[] = [];
      let firstSuccess: ForcedBranchResult | undefined;
      if (option.checks.length === 0 && witness.state !== undefined) {
        try {
          firstSuccess = executeBranch(content, definition, option, witness.state);
        } catch (error) {
          branches.push({
            id: `${definition.id}/${option.id}`,
            kind: "option",
            definitionId: definition.id,
            optionId: option.id,
            status: "uncovered",
            witnessSearchAttempts: witness.attempts,
            saveRoundTrip: false,
            error: branchError(error),
          });
          continue;
        }
      }
      for (const check of option.checks) {
        for (const outcome of check.outcomes) {
          outcomeCount += 1;
          const id = `${definition.id}/${option.id}/${check.id}/${outcome.id}`;
          if (witness.state === undefined) {
            outcomeEntries.push({
              id,
              kind: "outcome",
              definitionId: definition.id,
              optionId: option.id,
              checkId: check.id,
              outcomeId: outcome.id,
              status: "uncovered",
              witnessSearchAttempts: witness.attempts,
              saveRoundTrip: false,
              error: witness.error ?? "No witness",
            });
            continue;
          }
          try {
            const result = executeBranch(content, definition, option, witness.state, {
              checkId: check.id,
              outcome,
            });
            firstSuccess ??= result;
            outcomeEntries.push({
              id,
              kind: "outcome",
              definitionId: definition.id,
              optionId: option.id,
              checkId: check.id,
              outcomeId: outcome.id,
              status: "covered",
              witnessSearchAttempts: witness.attempts,
              saveRoundTrip: true,
              resolvedStateHash: result.stateHash,
              ...(result.committedOutcomeId === undefined
                ? {}
                : { committedOutcomeId: result.committedOutcomeId }),
            });
          } catch (error) {
            outcomeEntries.push({
              id,
              kind: "outcome",
              definitionId: definition.id,
              optionId: option.id,
              checkId: check.id,
              outcomeId: outcome.id,
              status: "uncovered",
              witnessSearchAttempts: witness.attempts,
              saveRoundTrip: false,
              error: branchError(error),
            });
          }
        }
      }
      branches.push({
        id: `${definition.id}/${option.id}`,
        kind: "option",
        definitionId: definition.id,
        optionId: option.id,
        status: firstSuccess === undefined ? "uncovered" : "covered",
        witnessSearchAttempts: witness.attempts,
        saveRoundTrip: firstSuccess !== undefined,
        ...(firstSuccess === undefined
          ? {
              error:
                witness.error ?? outcomeEntries[0]?.error ?? "Option did not execute",
            }
          : { resolvedStateHash: firstSuccess.stateHash }),
      });
      branches.push(...outcomeEntries);
    }
  }
  const covered = branches.filter((branch) => branch.status === "covered").length;
  const uncovered = branches.length - covered;
  return {
    reportFormat: 1,
    contentVersion: content.manifest.contentVersion,
    contentHash: content.manifest.bundleHash,
    status:
      definitions.length === 0 ? "empty" : uncovered === 0 ? "complete" : "incomplete",
    counts: {
      definitions: definitions.length,
      options: optionCount,
      outcomes: outcomeCount,
      branches: branches.length,
      covered,
      uncovered,
    },
    branches,
  };
}
