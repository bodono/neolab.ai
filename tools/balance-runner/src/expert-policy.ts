import {
  basisPoints,
  FOUNDATION_MINIMUM_CAPABILITY_BASIS_POINTS,
  LAB_MATURITY_STAGES,
  tick,
  type CommandId,
  type CommandValidation,
  type GameCommand,
  type GameView,
  type LabId,
  type LabMaturityStage,
  type LabMaturityViewData,
  type ModelId,
  type ResearcherId,
} from "@neolab/sim";

import type { ContentId } from "@neolab/content-schema";

import type { AvailableCommandView, CommandPreviewer, PolicyView } from "./types.ts";

/**
 * A strong scripted player: it plays the economy, compute, research and the
 * Candidate Programme the way a competent human would, using only the player
 * view and the same command previews the UI shows before an action is taken.
 *
 * It exists to answer one question the other probes cannot: is the game
 * winnable, and how hard is it? The other policies are deliberately narrow
 * archetypes; none of them ever starts the Candidate Programme, so none can
 * reach candidacy at all.
 */

type View = Readonly<GameView>;

/** The seven capability programmes; the candidacy gate needs every attribute at 80. */
const CAPABILITY_DOMAINS = [
  "base:domain.architectures",
  "base:domain.optimisation-scaling",
  "base:domain.reinforcement-agency",
  "base:domain.multimodality",
  "base:domain.reasoning-tools",
  "base:domain.robotics-embodiment",
  "base:domain.scientific-ai",
] as const;

/**
 * Security posture and evaluation quality gate candidate incident reviews;
 * practical control gets least because the Alignment Institute and Secure
 * Bunker the expert builds supply most of it.
 */
const SAFETY_WEIGHTS: Record<string, number> = {
  "base:safety.alignment-control": 2_000,
  "base:safety.interpretability-evals": 3_500,
  "base:safety.security-containment": 4_500,
};

/** Research level the Candidate Programme works and the 80-attribute floor need. */
const DOMAIN_TARGET_LEVEL = 92;

/** Share of capability research a focused expert gives its focus programme. */
const FOCUS_CAPABILITY_BASIS_POINTS = 5_000;

/**
 * The focus must keep at least this share of all research compute, a little
 * above the paper race's 30% focus threshold (papers rules, playerFocus), or it
 * stops counting as a focus once the expert shifts compute to safety late on.
 */
const FOCUS_RESEARCH_COMPUTE_BASIS_POINTS = 3_200;

export interface ExpertOptions {
  /**
   * A capability programme (full id) to give about half of capability
   * research, the rest split as usual. At the normal 70% capability share
   * that is 35% of all research compute, enough to make it a paper focus.
   */
  readonly researchFocus?: string;
}

/**
 * Resolve a `--expert-focus` argument -- a full id (`base:domain.multimodality`),
 * `domain.multimodality` or the bare slug `multimodality` -- to a capability
 * programme id, or throw naming the choices.
 */
export function resolveExpertFocus(requested: string): string {
  const candidates = [requested, `base:${requested}`, `base:domain.${requested}`];
  const match = CAPABILITY_DOMAINS.find((domainId) => candidates.includes(domainId));
  if (match === undefined) {
    throw new Error(
      `--expert-focus: ${requested} is not a capability programme; choose one of ` +
        CAPABILITY_DOMAINS.map((domainId) => domainId.replace("base:domain.", "")).join(
          ", ",
        ),
    );
  }
  return match;
}

/**
 * Capability weights in basis points summing to 10,000: every programme
 * funded, most where the lab is furthest from the gate, and half to the focus
 * programme when one is set.
 */
export function expertCapabilityWeights(
  levels: ReadonlyMap<string, number>,
  focus?: string,
  capabilityShareBasisPoints = 7_000,
): Record<string, number> {
  const raw = CAPABILITY_DOMAINS.map((domainId) => {
    const level = levels.get(domainId) ?? 0;
    return [domainId, 1 + Math.max(0, DOMAIN_TARGET_LEVEL - level) / 8] as const;
  });
  const focused = focus !== undefined && raw.some(([domainId]) => domainId === focus);
  const shared = raw.filter(([domainId]) => !focused || domainId !== focus);
  // Enough of the capability pool to stay a paper focus at this capability share.
  const focusWeight = Math.min(
    10_000,
    Math.max(
      FOCUS_CAPABILITY_BASIS_POINTS,
      Math.ceil(
        (FOCUS_RESEARCH_COMPUTE_BASIS_POINTS * 10_000) / capabilityShareBasisPoints,
      ),
    ),
  );
  const pool = focused ? 10_000 - focusWeight : 10_000;
  const total = shared.reduce((sum, [, weight]) => sum + weight, 0);
  const weights: Record<string, number> = {};
  let assigned = 0;
  for (const [index, [domainId, weight]] of shared.entries()) {
    const share =
      index === shared.length - 1 ? pool - assigned : Math.floor((weight / total) * pool);
    weights[domainId] = share;
    assigned += share;
  }
  if (focused) weights[focus] = focusWeight;
  // Keep the authored programme order, which the allocation command echoes.
  return Object.fromEntries(
    CAPABILITY_DOMAINS.map((domainId) => [domainId, weights[domainId] ?? 0]),
  );
}

/**
 * Construction order. Housing first, then the institutions that raise research
 * output and star slots, then the chains the four Candidate Programme works
 * require (Data Centre IV, Shared KV Cache, Time Sphere, Argus Array).
 */
const FACILITY_PRIORITY = [
  "base:facility.press-office",
  "base:facility.server-hall",
  "base:facility.power-and-cooling-1",
  "base:facility.data-centre-1",
  "base:facility.headquarters-1",
  "base:facility.research-campus-1",
  "base:facility.staff-commons-1",
  "base:facility.alignment-institute-1",
  "base:facility.visitor-centre",
  "base:facility.power-and-cooling-2",
  "base:facility.data-centre-2",
  "base:facility.inference-centre-1",
  "base:facility.headquarters-2",
  "base:facility.scientific-laboratory-1",
  "base:facility.robotics-lab-1",
  "base:facility.interpretability-lab-1",
  "base:facility.eval-range-1",
  "base:facility.security-operations-1",
  "base:facility.secure-bunker-1",
  "base:facility.power-and-cooling-3",
  "base:facility.data-centre-3",
  "base:facility.embedding-space",
  "base:facility.inference-centre-2",
  "base:facility.fusion-reactor-array-1",
  "base:facility.cross-attention-atrium",
  "base:facility.power-and-cooling-4",
  "base:facility.data-centre-4",
  "base:facility.shared-kv-cache",
  "base:facility.hadron-collider-1",
  "base:facility.time-sphere-1",
  "base:facility.nanofoundry-1",
  "base:facility.argus-array-1",
  "base:facility.inference-centre-3",
  "base:facility.power-and-cooling-5",
  "base:facility.data-centre-5",
] as const;

const AGI_COMPONENTS = [
  "oracle-grid",
  "mirror-test",
  "project-panopticon",
  "world-engine",
] as const;

type CommandOf<K extends GameCommand["kind"]> = Extract<
  GameCommand,
  { readonly kind: K }
>;
type PlayerCommandKind = Extract<GameCommand, { readonly labId: LabId }>["kind"];
type CommandBody<K extends PlayerCommandKind> = Omit<
  CommandOf<K>,
  "kind" | "meta" | "labId"
>;

class Planner {
  readonly commands: GameCommand[] = [];
  cash: number;
  slots: number;
  /** Cash the work chains will need next; compute purchases leave it alone. */
  capitalReserve = 0;
  private sequence = 0;

  readonly view: View;
  readonly preview: CommandPreviewer;

  constructor(view: View, preview: CommandPreviewer) {
    this.view = view;
    this.preview = preview;
    this.cash = view.finance.balanceMillions;
    this.slots = view.facilities.capacity.availableMajorProjectSlots;
  }

  /** A player command of `kind` for this lab, with fresh metadata. */
  build<K extends PlayerCommandKind>(kind: K, body: CommandBody<K>): CommandOf<K> {
    const command = {
      kind,
      meta: {
        commandId:
          `expert:${String(this.view.meta.tick)}:${String(this.sequence++)}` as CommandId,
        expectedTick: tick(this.view.meta.tick),
        issuedBy: "player" as const,
      },
      labId: this.view.topBar.identity.labId as LabId,
      ...body,
    };
    return command as unknown as CommandOf<K>;
  }

  /** Weekly outgoings times four cycles, and never below $30M. */
  get reserve(): number {
    const burn = Math.max(0, -this.view.finance.netMillionsPerCycle);
    return Math.max(30, burn * 4);
  }

  /** Preview a command and keep it if it is legal and affordable above `floor`. */
  attempt(command: GameCommand, floor = this.reserve, slotCost = 0): boolean {
    if (slotCost > this.slots) return false;
    const validation = this.preview(command);
    if (!validation.ok) return false;
    const cost = Math.max(0, costOf(validation));
    if (cost > 0 && this.cash - cost < floor) return false;
    this.commands.push(command);
    this.cash -= cost;
    this.slots -= slotCost;
    return true;
  }

  take(candidate: AvailableCommandView | undefined): void {
    if (candidate === undefined) return;
    this.commands.push(candidate.command);
    this.cash -= Math.max(0, candidate.cashCostMillions);
  }
}

function asBasisPoints(weights: Readonly<Record<string, number>>) {
  return Object.fromEntries(
    Object.entries(weights).map(([id, weight]) => [id, basisPoints(weight)]),
  );
}

function costOf(validation: Extract<CommandValidation, { ok: true }>): number {
  const preview = validation.preview;
  return Number(
    preview.gpuPurchaseQuote?.upfrontCostMillions ??
      preview.constructionQuote?.upfrontCostMillions ??
      preview.trainingQuote?.cashCostMillions ??
      preview.evaluationQuote?.cashCostMillions ??
      preview.productisationQuote?.cashCostMillions ??
      preview.recruitment?.signingCash ??
      0,
  );
}

function activeProjects(view: View, kind: string): number {
  return view.facilities.projects.filter(
    (project) =>
      project.kind === kind &&
      (project.status === "queued" ||
        project.status === "active" ||
        project.status === "paused"),
  ).length;
}

/** Events, research choices, publications, offers and ultimatums. */
function respondToMandatory(
  planner: Planner,
  available: readonly AvailableCommandView[],
): void {
  const groups = new Map<string, AvailableCommandView[]>();
  for (const candidate of available) {
    if (!candidate.tags.includes("mandatory") && candidate.category !== "publication")
      continue;
    if (
      candidate.category === "crisis" ||
      candidate.category === "deployment" ||
      candidate.category === "rollout"
    )
      continue;
    const command = candidate.command;
    const subject =
      command.kind === "respond-to-decision-event"
        ? `event:${command.instanceId}`
        : command.kind === "choose-generic-advance"
          ? `advance:${command.programId}:${String(command.threshold)}`
          : command.kind === "choose-publication-policy"
            ? `paper:${command.paperId}`
            : command.kind === "resolve-researcher-ultimatum"
              ? `ultimatum:${command.researcherId}`
              : command.kind === "ratify-coalition"
                ? `coalition:${command.coalitionId}`
                : candidate.id;
    const group = groups.get(subject) ?? [];
    group.push(candidate);
    groups.set(subject, group);
  }
  for (const [subject, candidates] of [...groups.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (subject.startsWith("paper:")) {
      // Publishing earns Aura, which pays for fundraising rounds, but diffuses
      // the result to every rival. Publish while Aura is scarce, then keep
      // discoveries in-house.
      const policy =
        planner.view.topBar.aura.spendable < 150 ? "publish-openly" : "keep-secret";
      planner.take(
        candidates.find(
          (candidate) =>
            candidate.command.kind === "choose-publication-policy" &&
            candidate.command.policy === policy,
        ) ?? candidates[0],
      );
      continue;
    }
    if (subject.startsWith("ultimatum:")) {
      planner.take(
        candidates.find(
          (candidate) =>
            candidate.command.kind === "resolve-researcher-ultimatum" &&
            candidate.command.response === "accept-conditions",
        ) ?? candidates[0],
      );
      continue;
    }
    if (subject.startsWith("event:")) {
      planner.take(chooseEventOption(planner, candidates));
      continue;
    }
    planner.take(candidates[0]);
  }
  const offers = available
    .filter((candidate) => candidate.category === "funding-offer")
    .sort((left, right) => right.cashGainMillions - left.cashGainMillions);
  if (offers[0] !== undefined) {
    planner.commands.push(offers[0].command);
    planner.cash += offers[0].cashGainMillions;
  }
}

/** Take the first option the lab can pay for; events are not where runs are won. */
function chooseEventOption(
  planner: Planner,
  candidates: readonly AvailableCommandView[],
): AvailableCommandView | undefined {
  return [...candidates].sort((left, right) => {
    const affordableLeft = planner.cash - left.cashCostMillions >= 0 ? 0 : 1;
    const affordableRight = planner.cash - right.cashCostMillions >= 0 ? 0 : 1;
    return affordableLeft - affordableRight || left.id.localeCompare(right.id);
  })[0];
}

function fundraise(planner: Planner, wantMillions: number): void {
  const view = planner.view;
  if (activeProjects(view, "fundraising") > 0) return;
  if (view.fundraising.offers.some((offer) => offer.status === "available")) return;
  const runway = view.finance.runway;
  const short =
    !runway.isInfinite && (runway.band !== "healthy" || (runway.weeks ?? 0) < 52);
  if (!short && planner.cash >= planner.reserve + wantMillions) return;
  for (const campaign of [
    "mega-round-roadshow",
    "competitive-round",
    "quiet-bridge",
  ] as const) {
    const quote = view.fundraising.campaigns.find(
      (candidate) => candidate.campaign === campaign,
    );
    if (quote === undefined || !quote.available || quote.blockers.length > 0) continue;
    if (
      planner.attempt(
        planner.build("start-fundraising-campaign", { campaign }),
        -Infinity,
      )
    ) {
      return;
    }
  }
}

function allocate(planner: Planner, options: ExpertOptions): void {
  const view = planner.view;
  if (view.meta.tick % 13 !== 0) return;
  const levels = new Map(
    view.research.capabilityDomains.map((domain) => [domain.programId, domain.level]),
  );
  const lowestLevel = Math.min(
    ...CAPABILITY_DOMAINS.map((domainId) => levels.get(domainId) ?? 0),
  );
  const capabilityShare = lowestLevel >= 95 ? 3_000 : lowestLevel >= 85 ? 5_000 : 7_000;
  // Fund every programme, most where the lab is furthest from the gate.
  const weights = expertCapabilityWeights(levels, options.researchFocus, capabilityShare);
  // Serve enough of the fleet to meet most demand: revenue funds everything.
  let best: { serving: number; net: number } | undefined;
  for (const serving of [2_000, 3_000, 4_000, 5_000, 6_000, 7_000]) {
    const validation = planner.preview(
      planner.build("set-gpu-allocation", {
        allocation: {
          servingFleetShareBasisPoints: basisPoints(serving),
          capabilityBasisPoints: basisPoints(capabilityShare),
          capabilityDomainWeights: asBasisPoints(weights),
          safetyProgramWeights: asBasisPoints(SAFETY_WEIGHTS),
        },
      }),
    );
    if (!validation.ok) continue;
    const consequences = validation.preview.gpuAllocationConsequences;
    const fulfilment = consequences?.projectedServingFulfilment ?? 0;
    if (best === undefined || fulfilment < 0.9) {
      best = { serving, net: consequences?.netMillionsPerCycle ?? 0 };
    }
    if (fulfilment >= 0.9) break;
  }
  if (best === undefined) return;
  planner.attempt(
    planner.build("set-gpu-allocation", {
      allocation: {
        servingFleetShareBasisPoints: basisPoints(best.serving),
        capabilityBasisPoints: basisPoints(capabilityShare),
        capabilityDomainWeights: asBasisPoints(weights),
        safetyProgramWeights: asBasisPoints(SAFETY_WEIGHTS),
      },
    }),
    -Infinity,
  );
}

function bestModel(view: View) {
  return [...view.models.cards]
    .filter((card) => card.trainingParentEligible)
    .sort(
      (left, right) =>
        right.frontierCapabilityEstimate - left.frontierCapabilityEstimate ||
        right.generationIndex - left.generationIndex,
    )[0];
}

/** Frontier Capability and per-attribute floor of the Candidate Programme gate. */
const GATE_FRONTIER_CAPABILITY = 88;

/**
 * The first crossing the lab holds out for: an expected FC 97 fixes about a
 * 61% prior, 100 makes it certain. Since research tapers above 60, FC 97 takes
 * research of about 95 on a full Kolmogorov fleet. The gate reads the quote's
 * expected capability: the range's ends carry noise and the completed-run
 * penalty and are capped at 100, so its middle never reaches 97 at all. A
 * held candidate at half odds or better is worth keeping.
 */
const CROSSING_FRONTIER_CAPABILITY = 97;
const CROSSING_PRIOR_PERCENT = 50;

/** Weeks from a crossing run's end through the Deployment Crisis, roughly. */
const CRISIS_WEEKS = 35;

/** The earliest a rival could ascend, from the public countdown estimates. */
function rivalWeeksLeft(view: View): number {
  return Math.min(
    Infinity,
    ...view.world.rivals.flatMap((rival) =>
      rival.candidateCountdown === undefined
        ? []
        : [rival.candidateCountdown.estimateRangeWeeks[0]],
    ),
  );
}

function worksStarted(view: View): { complete: number; started: number } {
  const components = view.models.candidateProgramme.components;
  return {
    complete: components.filter((component) => component.status === "complete").length,
    started: components.filter(
      (component) =>
        component.status === "complete" || component.status === "in-progress",
    ).length,
  };
}

/** Live qualified artifacts the lab is holding, best first-crossing prior first. */
function liveArtifacts(view: View) {
  return view.models.candidateCustody.artifacts
    .filter(
      (artifact) =>
        artifact.lifecycle !== "verified-destroyed" &&
        artifact.lifecycle !== "verified-isolated-archive" &&
        artifact.lifecycle !== "terminal",
    )
    .sort(
      (left, right) => right.firstCrossingPriorPercent - left.firstCrossingPriorPercent,
    );
}

/**
 * Train continuously, but hold the candidacy gate: a lineage's chance of being
 * a genuine superintelligence is fixed when it first crosses FC 88, so crossing
 * early at 90 locks in a ~13% prior. Until every Candidate Programme work is
 * under way, size runs so the forecast stays below the gate; then cross once,
 * with a run expected to reach FC 97, or with the best run available once a
 * rival's countdown leaves no time to wait for one.
 */
function train(planner: Planner): void {
  const view = planner.view;
  if (activeProjects(view, "training") > 0) return;
  const parent = bestModel(view);
  const works = worksStarted(view);
  const releaseGate = works.started === 4;
  const strongCandidate = liveArtifacts(view).find(
    (artifact) =>
      artifact.firstCrossingPriorPercent >= CROSSING_PRIOR_PERCENT &&
      artifact.lifecycle === "capability-qualified-latent-candidate",
  );
  if (strongCandidate !== undefined) return;
  // Training takes a major project slot. Once a held lab is near the gate, the
  // last few points are worth less than the slot the work chains need; below
  // that, capability is still what pays for everything.
  if (
    !releaseGate &&
    view.meta.phase === "frontier" &&
    (parent?.frontierCapabilityEstimate ?? 0) >= 84
  ) {
    return;
  }
  const available = Math.floor(view.compute.unreservedTeraflops);
  if (parent === undefined) {
    planner.attempt(
      planner.build("start-training-run", { posture: "normal", durationWeeks: 5 }),
      Math.min(planner.reserve, 10),
    );
    return;
  }
  // Preview a grid of runs and take the best expected model: a destroyed run
  // costs its weeks and cash and produces nothing, so weigh capability by the
  // forecast chance of finishing. The final crossing run must be safe.
  const weeksLeft = rivalWeeksLeft(view);
  let best: { command: GameCommand; score: number } | undefined;
  for (const fraction of [0.9, 0.75, 0.5, 0.3, 0.15, 0.08]) {
    for (const posture of ["normal", "conservative"] as const) {
      for (const durationWeeks of releaseGate ? [12, 16, 20, 24, 28] : [8, 12, 16]) {
        const command = planner.build("start-training-run", {
          parentModelId: parent.modelId as ModelId,
          posture,
          durationWeeks,
          committedTeraflops: Math.floor(available * fraction),
        });
        const validation = planner.preview(command);
        if (!validation.ok) continue;
        const quote = validation.preview.trainingQuote;
        if (quote === undefined) continue;
        if (quote.cashCostMillions > planner.cash - Math.min(planner.reserve, 10))
          continue;
        const [low, high] = quote.estimatedFrontierCapabilityRange;
        // A run that cannot beat its parent only spends the cash an early lab
        // needs for compute.
        if ((low + high) / 2 < parent.frontierCapabilityEstimate + 1) continue;
        if (!releaseGate && high >= GATE_FRONTIER_CAPABILITY - 0.5) continue;
        if (releaseGate && quote.reliability.totalLoss > 0.1) continue;
        if (
          releaseGate &&
          quote.estimatedFrontierCapability < CROSSING_FRONTIER_CAPABILITY &&
          weeksLeft > durationWeeks + CRISIS_WEEKS
        ) {
          continue;
        }
        const score =
          (1 - quote.reliability.totalLoss) * ((low + high) / 2) - durationWeeks * 0.01;
        if (best === undefined || score > best.score) best = { command, score };
      }
    }
  }
  if (best !== undefined) planner.attempt(best.command, Math.min(planner.reserve, 10));
}

/** Productise and launch the newest model once it beats the one on sale. */
function launch(planner: Planner): void {
  const view = planner.view;
  if (activeProjects(view, "productisation") > 0) return;
  const commercial = view.models.cards.find((card) => card.isCommercialModel);
  const newest = [...view.models.cards].sort(
    (left, right) => right.generationIndex - left.generationIndex,
  )[0];
  if (newest === undefined || newest.isCommercialModel) return;
  // Serving a qualified artifact feeds its hazard; sell the best model below the gate.
  if (liveArtifacts(view).some((artifact) => artifact.modelId === newest.modelId)) return;
  if (
    commercial !== undefined &&
    newest.frontierCapabilityEstimate <= commercial.frontierCapabilityEstimate
  ) {
    return;
  }
  const runs = Object.values(newest.deployment.productisationRuns).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (runs === 0) {
    planner.attempt(
      planner.build("start-productisation", {
        modelId: newest.modelId as ModelId,
        mode: "normal",
      }),
    );
    return;
  }
  planner.attempt(
    planner.build("set-model-deployment-policy", {
      modelId: newest.modelId as ModelId,
      policy: "guarded-api",
    }),
  );
}

function candidateProgramme(planner: Planner): number {
  const view = planner.view;
  let wanted = 0;
  for (const componentType of AGI_COMPONENTS) {
    const component = view.models.candidateProgramme.components.find(
      (candidate) => candidate.componentType === componentType,
    );
    if (component === undefined || component.status !== "available") continue;
    const command = planner.build("start-agi-component", {
      componentType,
    });
    if (!planner.attempt(command, planner.reserve / 4, 1)) {
      const validation = planner.preview(command);
      if (!validation.ok) {
        // Blocked on cash: say how much to raise.
        wanted = Math.max(wanted, 40_000);
      }
    }
  }
  return wanted;
}

/**
 * Each Candidate Programme work waits on a facility chain. Tier-4 and tier-5
 * buildings take two of at most five major project slots, so the chains
 * compete: schedule the one with the most work left first (the World Engine's,
 * through the year-long Hadron Collider and Time Sphere, which open only in the
 * Markov era), and spend no slot elsewhere while a chain step is waiting.
 */
const WORK_CHAINS: readonly {
  readonly work: string;
  readonly weeks: number;
  /** The work's authored price, which the lab must hold when it opens. */
  readonly cashMillions: number;
  /**
   * Each step with its authored build time and price. The catalogue lists a
   * building only once it is nearly available, so a planner needs the rest up
   * front: to see that the World Engine's tier-5 steps make its chain the
   * longest, and to have the cash ready the week a step opens.
   */
  readonly chain: readonly (readonly [string, number, number])[];
}[] = [
  {
    work: "world-engine",
    weeks: 26,
    cashMillions: 40_000,
    chain: [
      ["base:facility.scientific-laboratory-1", 23, 42],
      ["base:facility.power-and-cooling-2", 14, 55],
      ["base:facility.fusion-reactor-array-1", 52, 1_440],
      ["base:facility.hadron-collider-1", 52, 5_500],
      ["base:facility.time-sphere-1", 52, 6_500],
    ],
  },
  {
    work: "project-panopticon",
    weeks: 20,
    cashMillions: 25_000,
    chain: [
      ["base:facility.robotics-lab-1", 21, 33],
      ["base:facility.nanofoundry-1", 48, 5_000],
      ["base:facility.argus-array-1", 52, 3_500],
    ],
  },
  {
    work: "oracle-grid",
    weeks: 16,
    cashMillions: 30_000,
    chain: [
      ["base:facility.power-and-cooling-3", 25, 700],
      ["base:facility.data-centre-3", 40, 1_500],
      ["base:facility.power-and-cooling-4", 42, 7_800],
      ["base:facility.data-centre-4", 52, 14_400],
    ],
  },
  {
    work: "mirror-test",
    weeks: 20,
    cashMillions: 20_000,
    chain: [
      ["base:facility.headquarters-1", 12, 20],
      ["base:facility.staff-commons-1", 16, 18],
      ["base:facility.headquarters-2", 24, 60],
      ["base:facility.embedding-space", 20, 200],
      ["base:facility.cross-attention-atrium", 26, 1_080],
      ["base:facility.shared-kv-cache", 34, 6_000],
    ],
  },
];

/** The Cross-Attention Atrium adds a major project slot. */
const SLOT_FACILITY = "base:facility.cross-attention-atrium";

function startFacility(
  planner: Planner,
  definitionId: string,
  floor = planner.reserve,
): "started" | "unaffordable" | "skip" {
  const facility = planner.view.facilities.catalogue.find(
    (candidate) => candidate.definitionId === definitionId,
  );
  if (
    facility === undefined ||
    facility.completed ||
    facility.building ||
    !facility.available
  ) {
    return "skip";
  }
  if (facility.majorProjectSlotsRequired > planner.slots) return "skip";
  const command = planner.build("start-facility-construction", {
    definitionId: definitionId as ContentId,
  });
  return planner.attempt(command, floor, facility.majorProjectSlotsRequired)
    ? "started"
    : "unaffordable";
}

function build(planner: Planner): number {
  const view = planner.view;
  let wanted = 0;
  const catalogue = new Map(
    view.facilities.catalogue.map((facility) => [facility.definitionId, facility]),
  );
  const frontier = view.meta.phase === "frontier" || view.meta.phase === "crisis";
  let chainWaiting = false;
  if (frontier) {
    const status = new Map(
      view.models.candidateProgramme.components.map((component) => [
        component.componentType,
        component.status,
      ]),
    );
    const remaining = (entry: (typeof WORK_CHAINS)[number]): number =>
      entry.chain.reduce((sum, [definitionId, weeks]) => {
        const facility = catalogue.get(definitionId);
        if (facility?.completed === true) return sum;
        return (
          sum +
          (facility?.durationWeeks ?? weeks) * (facility?.building === true ? 0.5 : 1)
        );
      }, 0) + (status.get(entry.work) === "complete" ? 0 : entry.weeks);
    const order = [...WORK_CHAINS].sort(
      (left, right) => remaining(right) - remaining(left),
    );
    // Hold back the price of each chain's next step, and of any work whose
    // chain is finished, so compute purchases cannot spend it first.
    planner.capitalReserve = WORK_CHAINS.reduce((sum, entry) => {
      const next = entry.chain.find(
        ([definitionId]) => catalogue.get(definitionId)?.completed !== true,
      );
      if (next !== undefined) {
        const [definitionId, , authoredCost] = next;
        return catalogue.get(definitionId)?.building === true
          ? sum
          : sum + (catalogue.get(definitionId)?.cashCostMillions ?? authoredCost);
      }
      const workStatus = status.get(entry.work);
      return workStatus === "complete" || workStatus === "in-progress"
        ? sum
        : sum + entry.cashMillions;
    }, 0);
    const nextSteps = order.flatMap((entry) => {
      const next = entry.chain
        .map(([definitionId]) => definitionId)
        .find((definitionId) => catalogue.get(definitionId)?.completed !== true);
      return next === undefined || catalogue.get(next)?.building === true ? [] : [next];
    });
    // The longest chain first, then the Atrium: its extra slot repays its own
    // two within a year, and the rest of the endgame is bound by slots.
    const steps = [
      ...new Set([...nextSteps.slice(0, 1), SLOT_FACILITY, ...nextSteps.slice(1)]),
    ];
    for (const definitionId of steps) {
      const facility = catalogue.get(definitionId);
      // The critical path outranks the usual runway buffer: a frontier lab's
      // income refills it within weeks, and a week lost here is lost from the race.
      const outcome = startFacility(planner, definitionId, planner.reserve / 4);
      if (outcome === "unaffordable")
        wanted = Math.max(wanted, facility?.cashCostMillions ?? 0);
      if (
        outcome !== "started" &&
        facility !== undefined &&
        facility.available &&
        !facility.completed &&
        !facility.building
      ) {
        chainWaiting = true;
      }
    }
  }
  // From the frontier on, every slot belongs to the work chains: a long
  // building started now would still hold its slots when Rubin-era hardware
  // opens the tier-4 steps.
  if (chainWaiting || frontier) return wanted;
  const keepFree = 2;
  for (const definitionId of FACILITY_PRIORITY) {
    if (planner.slots < keepFree && activeProjects(view, "fundraising") === 0) break;
    const outcome = startFacility(planner, definitionId);
    if (outcome === "unaffordable") {
      wanted = Math.max(wanted, catalogue.get(definitionId)?.cashCostMillions ?? 0);
      break;
    }
  }
  return wanted;
}

function procure(planner: Planner): void {
  const view = planner.view;
  if (view.compute.pendingDeliveries.length > 0) return;
  const capacity = view.facilities.capacity;
  const headroom =
    capacity.supportedOwnedGpuCount -
    capacity.installedOwnedGpuCount -
    capacity.pendingOwnedGpuCount;
  const generationId = view.compute.currentGenerationId;
  if (headroom < 1_000) {
    // Training reserves GPUs across generations, so a sale in the same week
    // as a run is refused: refresh the fleet only between runs.
    const training =
      activeProjects(view, "training") > 0 ||
      planner.commands.some((command) => command.kind === "start-training-run");
    if (training) return;
    // Full: retire the oldest generation so housing holds current silicon.
    const oldest = view.compute.generationMix.find(
      (generation) =>
        generation.generationId !== generationId &&
        generation.sellablePhysicalGpus >= 1_000,
    );
    if (oldest === undefined) return;
    // Sell only what the lab can replace at once with current silicon: selling
    // a whole fleet it cannot rebuy left one opening lab with no compute, no
    // revenue and no way back.
    const probe = planner.preview(
      planner.build("buy-gpus", {
        generationId: generationId as ContentId,
        thousandUnits: 1,
      }),
    );
    if (!probe.ok) return;
    const replaceable = Math.floor(
      (planner.cash - planner.reserve) / Math.max(0.001, costOf(probe)),
    );
    const thousandUnits = Math.min(
      Math.floor(oldest.sellablePhysicalGpus / 1_000),
      replaceable,
    );
    if (thousandUnits >= 1) {
      planner.attempt(
        planner.build("sell-gpus", {
          generationId: oldest.generationId as ContentId,
          thousandUnits,
        }),
        -Infinity,
      );
    }
    return;
  }
  const probe = planner.preview(
    planner.build("buy-gpus", {
      generationId: generationId as ContentId,
      thousandUnits: 1,
    }),
  );
  if (!probe.ok) return;
  const unitCost = Math.max(0.001, costOf(probe));
  // Leave the work chains their next steps, but never more than half the cash:
  // a lab too poor to grow its fleet never earns the money for the chains.
  const heldBack = Math.min(planner.capitalReserve, planner.cash / 2);
  const affordableUnits = Math.floor(
    (planner.cash - planner.reserve - heldBack) / unitCost,
  );
  let units = Math.min(Math.floor(headroom / 1_000), affordableUnits);
  while (units >= 1) {
    if (
      planner.attempt(
        planner.build("buy-gpus", {
          generationId: generationId as ContentId,
          thousandUnits: units,
        }),
      )
    ) {
      return;
    }
    units = Math.floor(units / 2);
  }
}

/**
 * Run safety evaluations steadily once the lab can afford them: practice is a
 * third of evaluation quality, and evaluation quality gates incident reviews
 * and capability proofs in the Deployment Crisis.
 */
function evaluate(planner: Planner, available: readonly AvailableCommandView[]): void {
  const view = planner.view;
  if (view.meta.phase === "foundation") return;
  if (activeProjects(view, "evaluation") > 0) return;
  if (
    worksStarted(view).started < 4 &&
    (view.meta.phase === "frontier" || planner.slots < 3)
  )
    return;
  const evaluation = available
    .filter((candidate) => candidate.category === "evaluation")
    .sort((left, right) => left.cashCostMillions - right.cashCostMillions)[0];
  if (
    evaluation !== undefined &&
    planner.cash - evaluation.cashCostMillions >= planner.reserve * 2
  ) {
    planner.take(evaluation);
    planner.slots -= 1;
  }
}

function recruit(planner: Planner, available: readonly AvailableCommandView[]): void {
  const view = planner.view;
  if (view.people.slots.vacant <= 0) return;
  const candidate = available
    .filter((item) => item.category === "recruitment")
    .sort((left, right) => left.cashCostMillions - right.cashCostMillions)[0];
  if (
    candidate !== undefined &&
    planner.cash - candidate.cashCostMillions >= planner.reserve
  ) {
    planner.take(candidate);
  }
}

/**
 * The Deployment Crisis. Nominate the candidate whose lineage first crossed the
 * gate highest (the player-visible prior), prove it with the most credible
 * test available, review incidents rather than isolating, and deploy through
 * the most cautious mode the lab can field.
 */
function endgame(planner: Planner, available: readonly AvailableCommandView[]): void {
  const view = planner.view;
  const crisis = available.filter(
    (candidate) =>
      candidate.category === "crisis" ||
      candidate.category === "deployment" ||
      candidate.category === "rollout",
  );
  const mandatory = crisis.filter((candidate) => candidate.tags.includes("mandatory"));
  const of = <K extends GameCommand["kind"]>(kind: K) =>
    crisis.filter((candidate) => candidate.command.kind === kind);

  const waiting = of("advance-world-waiting")[0];
  if (waiting !== undefined) return planner.take(waiting);
  const deploy = of("transmit-deployment").find((candidate) =>
    candidate.tags.includes("mandatory"),
  );
  if (deploy !== undefined) return planner.take(deploy);

  const prior = new Map(
    view.models.candidateCustody.artifacts.map((artifact) => [
      artifact.modelId,
      artifact.firstCrossingPriorPercent,
    ]),
  );
  const nominations = of("nominate-candidate").sort((left, right) => {
    const priorOf = (candidate: AvailableCommandView) =>
      candidate.command.kind === "nominate-candidate"
        ? (prior.get(candidate.command.modelId) ?? 0)
        : 0;
    return priorOf(right) - priorOf(left);
  });
  if (nominations[0] !== undefined) return planner.take(nominations[0]);

  const review = of("resolve-candidate-incident")[0];
  if (review !== undefined) return planner.take(review);

  const proofRank = (candidate: AvailableCommandView): number => {
    if (candidate.command.kind !== "commit-capability-proof") return 99;
    const challenge = ["generalist-gauntlet", "strongest-domain"].indexOf(
      candidate.command.challengeId,
    );
    const verifier = ["independent-institutional", "blinded-internal"].indexOf(
      candidate.command.verifierId ?? "",
    );
    if (challenge < 0 || verifier < 0) return 50;
    return challenge * 2 + verifier;
  };
  const proofs = of("commit-capability-proof").sort(
    (left, right) => proofRank(left) - proofRank(right),
  );
  if (proofs[0] !== undefined && proofRank(proofs[0]) < 50)
    return planner.take(proofs[0]);

  // Two responses at most: each one extends the sprint while rivals race, so
  // take the ones that add control and security, and never proceed blind.
  const responseOrder = [
    "evidence-backed-operating-envelope",
    "deception-aware-containment",
  ];
  const response = of("commit-candidate-safety-response")
    .filter(
      (candidate) =>
        candidate.command.kind === "commit-candidate-safety-response" &&
        responseOrder.includes(candidate.command.responseId),
    )
    .sort((left, right) => {
      const rank = (candidate: AvailableCommandView) =>
        candidate.command.kind === "commit-candidate-safety-response"
          ? responseOrder.indexOf(candidate.command.responseId)
          : 99;
      return rank(left) - rank(right);
    })[0];
  if (response !== undefined) return planner.take(response);

  const finalReview = of("enter-final-review")[0];
  if (finalReview !== undefined) return planner.take(finalReview);
  const collision = of("resolve-pressure-collision").find(
    (candidate) =>
      candidate.command.kind === "resolve-pressure-collision" &&
      candidate.command.optionId === "comply",
  );
  if (collision !== undefined) return planner.take(collision);

  const modeOrder = [
    "adaptive-monitored-rollout",
    "government-licensed-deployment",
    "fortress-contained-pilot",
  ];
  const modes = of("choose-deployment-mode").sort((left, right) => {
    const rank = (candidate: AvailableCommandView) =>
      candidate.command.kind === "choose-deployment-mode"
        ? (modeOrder.indexOf(candidate.command.modeId) + 100) % 100
        : 99;
    return rank(left) - rank(right);
  });
  if (modes[0] !== undefined) return planner.take(modes[0]);

  const rollout =
    of("resolve-rollout-decision").find((candidate) =>
      candidate.tags.includes("cautious"),
    ) ?? of("resolve-rollout-decision")[0];
  if (rollout !== undefined) return planner.take(rollout);

  const containment = of("resolve-containment-failure")[0];
  if (containment !== undefined) return planner.take(containment);
  const path =
    of("choose-post-retirement-path").find((candidate) =>
      candidate.tags.includes("balanced"),
    ) ??
    of("choose-false-dawn-path").find((candidate) => candidate.tags.includes("balanced"));
  if (path !== undefined) return planner.take(path);

  const isolate = of("isolate-candidate-artifact")[0];
  if (isolate !== undefined) return planner.take(isolate);
  // A stopped clock with nothing left but retirement: the candidate is in
  // active resistance and cannot be deployed. Retire it cleanly and take the
  // successor programme rather than sit at the decision for ever.
  if (view.endgame.active && view.endgame.maxClockSpeed === "paused") {
    const transmitRetirement = of("transmit-candidate-retirement")[0];
    if (transmitRetirement !== undefined) return planner.take(transmitRetirement);
    const configure = of("configure-candidate-retirement").find(
      (candidate) =>
        candidate.command.kind === "configure-candidate-retirement" &&
        candidate.command.procedureId === "staged-isolated-shutdown" &&
        candidate.command.archiveDisposition === "destroy-all-weights",
    );
    if (configure !== undefined) return planner.take(configure);
  }
  // Last resort: a mandatory step we do not model yet.
  const fallback = mandatory.find(
    (candidate) => candidate.command.kind !== "commit-capability-proof",
  );
  if (fallback !== undefined) planner.take(fallback);
}

/*
 * The guided opening ("Guided chapters", the new-game default). A garage lab
 * with no GPUs works through eleven chapters, each opening one system and
 * closing on a checklist (the view's `meta.labMaturity.checklist`; the
 * simulation's `stageComplete`), before the twelfth, the frontier, opens the
 * full game. The expert above plays a
 * lab that has everything from week one; its $30M cash floor alone would keep
 * a $30M garage from ever buying a GPU. So until the frontier chapter it plays
 * the chapter in front of it, the way a player following the checklist would,
 * still from the player view and command previews only:
 *
 *  - garage, cluster, model, startup: buy the first GPU block, train the
 *    prototype, open the rival race, build the Server Rack and fill it;
 *  - foundation: give capability research all R&D compute, advance a
 *    programme, then train the FC 5 successor;
 *  - product, funding, lab: launch it with managed access and serve it, raise
 *    a round, recruit a researcher and appoint them to lead a programme;
 *  - institution, safety, autonomy: build the Press Office, then scale the
 *    lab with the expert's usual economy while training toward FC 10 and
 *    FC 20, give safety research 30% of R&D compute, run an evaluation, and
 *    grant the FC 20 model Access Level 1.
 *
 * Chapter costs the opening's family credit line covers (the first GPUs, the
 * prototype and milestone runs, the Server Rack, the launch, the first
 * recruit, the Press Office, the evaluation) are bought below $0, as the
 * chapter intends; everything else keeps the usual floors.
 */

const SERVER_RACK = "base:facility.server-rack";
const PRESS_OFFICE = "base:facility.press-office";

/**
 * The Frontier Capability each chapter's newly authorised successor needs, as
 * its checklist states (the simulation's PROGRESSIVE_*_CAPABILITY).
 */
const MILESTONE_CAPABILITY = { foundation: 5, institution: 10, safety: 20 } as const;

/** Safety research's minimum share of R&D compute from the safety chapter on. */
const OPENING_SAFETY_CAPABILITY_BASIS_POINTS = 7_000;

function stageAtLeast(stage: LabMaturityStage, reference: LabMaturityStage): boolean {
  return LAB_MATURITY_STAGES.indexOf(stage) >= LAB_MATURITY_STAGES.indexOf(reference);
}

/** Whether checklist item `index` of the current chapter is done. */
function objectiveDone(chapter: Readonly<LabMaturityViewData>, index: number): boolean {
  return chapter.checklist[index]?.complete === true;
}

/** Buy as many thousand-GPU blocks of current silicon as housing allows. */
function fillHousing(planner: Planner, floor: number): void {
  const view = planner.view;
  if (view.compute.pendingDeliveries.length > 0) return;
  const capacity = view.facilities.capacity;
  const headroom =
    capacity.supportedOwnedGpuCount -
    capacity.installedOwnedGpuCount -
    capacity.pendingOwnedGpuCount;
  for (let units = Math.floor(headroom / 1_000); units >= 1; units -= 1) {
    const command = planner.build("buy-gpus", {
      generationId: view.compute.currentGenerationId as ContentId,
      thousandUnits: units,
    });
    if (planner.attempt(command, floor)) return;
  }
}

/**
 * The opening's research and serving split. Capability research takes all of
 * R&D from the foundation chapter (its checklist asks for exactly that) until
 * the safety chapter asks for 30% safety; serving stays at zero until there
 * is a product, then serves demand as the expert usually does. Re-issued when
 * the chapter needs a different split and on the expert's quarterly cadence.
 */
function openingAllocate(
  planner: Planner,
  chapter: Readonly<LabMaturityViewData>,
  options: ExpertOptions,
): void {
  const view = planner.view;
  const stage = chapter.stage;
  if (!stageAtLeast(stage, "foundation")) return;
  const current = view.compute.queuedAllocation ?? {
    servingFleetShareBasisPoints: view.compute.allocation.serving.basisPoints,
    capabilityBasisPoints: view.compute.allocation.capabilities.basisPoints,
  };
  // Chapter 5 asks for at least 80% capability; a player following the
  // checklist gives it that, and keeps the rest on safety.
  const capabilityShare = stageAtLeast(stage, "safety")
    ? OPENING_SAFETY_CAPABILITY_BASIS_POINTS
    : FOUNDATION_MINIMUM_CAPABILITY_BASIS_POINTS;
  const serves = stageAtLeast(stage, "product");
  // A launch decided this week counts: serve it from the week it goes on sale.
  const launched =
    view.models.cards.some((card) => card.isCommercialModel) ||
    planner.commands.some((command) => command.kind === "set-model-deployment-policy");
  const due =
    view.meta.tick % 13 === 0 ||
    current.capabilityBasisPoints !== capabilityShare ||
    (serves && launched && current.servingFleetShareBasisPoints === 0);
  if (!due) return;
  const levels = new Map(
    view.research.capabilityDomains.map((domain) => [domain.programId, domain.level]),
  );
  const weights = expertCapabilityWeights(levels, options.researchFocus, capabilityShare);
  const allocation = (serving: number) => ({
    servingFleetShareBasisPoints: basisPoints(serving),
    capabilityBasisPoints: basisPoints(capabilityShare),
    capabilityDomainWeights: asBasisPoints(weights),
    safetyProgramWeights: asBasisPoints(SAFETY_WEIGHTS),
  });
  let serving = 0;
  if (serves && launched) {
    // The expert's usual search: enough of the fleet to meet most demand.
    serving = 7_000;
    for (const share of [2_000, 3_000, 4_000, 5_000, 6_000, 7_000]) {
      const validation = planner.preview(
        planner.build("set-gpu-allocation", { allocation: allocation(share) }),
      );
      if (!validation.ok) continue;
      const fulfilment =
        validation.preview.gpuAllocationConsequences?.projectedServingFulfilment ?? 0;
      serving = share;
      if (fulfilment >= 0.9) break;
    }
  }
  planner.attempt(
    planner.build("set-gpu-allocation", { allocation: allocation(serving) }),
    -Infinity,
  );
}

/**
 * Train toward a chapter's capability milestone. Among the runs the lab can
 * start, take the quickest whose whole forecast clears the target, else the
 * most likely to; with neither, report that the target is out of reach.
 */
function trainForMilestone(planner: Planner, target: number, floor: number): boolean {
  const view = planner.view;
  if (activeProjects(view, "training") > 0) return true;
  const parent = bestModel(view);
  const available = Math.floor(view.compute.unreservedTeraflops);
  let best: { command: GameCommand; sure: boolean; score: number } | undefined;
  for (const fraction of [0.9, 0.75, 0.5, 0.3]) {
    for (const posture of ["normal", "conservative"] as const) {
      for (const durationWeeks of [5, 8, 12, 16]) {
        const command = planner.build("start-training-run", {
          ...(parent === undefined ? {} : { parentModelId: parent.modelId as ModelId }),
          posture,
          durationWeeks,
          committedTeraflops: Math.floor(available * fraction),
        });
        const validation = planner.preview(command);
        if (!validation.ok) continue;
        const quote = validation.preview.trainingQuote;
        if (quote === undefined) continue;
        const [low] = quote.estimatedFrontierCapabilityRange;
        const expected = quote.estimatedFrontierCapability;
        if (expected < target) continue;
        const sure = low >= target;
        // A sure run: soonest, then most reliable. Otherwise: most likely.
        const score = sure
          ? -durationWeeks - quote.reliability.totalLoss
          : (1 - quote.reliability.totalLoss) * (expected - target) -
            durationWeeks * 0.01;
        if (
          best === undefined ||
          (sure && !best.sure) ||
          (sure === best.sure && score > best.score)
        ) {
          best = { command, sure, score };
        }
      }
    }
  }
  return best !== undefined && planner.attempt(best.command, floor);
}

/**
 * Recruit the cheapest star on the talent market, on the chapter's credit
 * line, straight from the People view rather than waiting for the quarterly
 * shortlist the expert usually recruits from.
 */
function recruitFirstResearcher(planner: Planner): void {
  const people = planner.view.people;
  if (people.slots.vacant <= 0) return;
  const candidates = people.market.candidates
    .filter((candidate) => candidate.listedTerms.blockers.length === 0)
    .sort(
      (left, right) =>
        left.listedTerms.signingCashMillions - right.listedTerms.signingCashMillions ||
        left.researcherId.localeCompare(right.researcherId),
    );
  for (const candidate of candidates) {
    const command = planner.build("recruit-researcher", {
      researcherId: candidate.researcherId as ResearcherId,
    });
    if (planner.attempt(command, -Infinity)) return;
  }
}

/** Appoint an unassigned researcher to lead the programme they are best at. */
function appointLead(planner: Planner): void {
  for (const researcher of planner.view.people.roster) {
    if (researcher.assignment !== undefined || researcher.status !== "employed") continue;
    const skills = [...researcher.researchSkills].sort(
      (left, right) =>
        right.level - left.level ||
        (left.kind === right.kind ? 0 : left.kind === "capability" ? -1 : 1),
    );
    for (const skill of skills) {
      const command = planner.build("assign-researcher", {
        researcherId: researcher.researcherId as ResearcherId,
        assignment: {
          kind: skill.kind === "capability" ? "capability-program" : "safety-program",
          targetId: skill.programmeId,
          role: "lead",
        },
      });
      if (planner.attempt(command, -Infinity)) return;
    }
  }
}

/** Launch the milestone model through managed access, as the product chapter requires. */
function launchFirstProduct(planner: Planner): void {
  const view = planner.view;
  if (activeProjects(view, "productisation") > 0) return;
  const model =
    view.models.cards.find((card) => card.isCurrentModel) ??
    [...view.models.cards].sort(
      (left, right) => right.generationIndex - left.generationIndex,
    )[0];
  if (model === undefined || model.isCommercialModel) return;
  const runs = Object.values(model.deployment.productisationRuns).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (runs === 0) {
    planner.attempt(
      planner.build("start-productisation", {
        modelId: model.modelId as ModelId,
        mode: "normal",
      }),
      -Infinity,
    );
    return;
  }
  // The chapter accepts either managed tier; the expert prefers the guarded one.
  for (const policy of ["guarded-api", "open-api"] as const) {
    const command = planner.build("set-model-deployment-policy", {
      modelId: model.modelId as ModelId,
      policy,
    });
    if (planner.attempt(command, -Infinity)) return;
  }
}

/** Evaluate the current model with the cheapest rung, on the safety chapter's credit line. */
function firstEvaluation(planner: Planner): void {
  const view = planner.view;
  if (activeProjects(view, "evaluation") > 0) return;
  const model = view.models.cards.find((card) => card.isCurrentModel);
  if (model === undefined) return;
  const rungs = Object.entries(model.evaluationCommitments).sort(
    ([leftId, left], [rightId, right]) =>
      left.cashCostMillions - right.cashCostMillions || leftId.localeCompare(rightId),
  );
  for (const [definitionId] of rungs) {
    const command = planner.build("start-evaluation", {
      modelId: model.modelId as ModelId,
      definitionId: definitionId as ContentId,
    });
    if (planner.attempt(command, -Infinity)) return;
  }
}

/**
 * The expert's usual economy for the later chapters, where the lab must grow
 * to reach FC 10 and FC 20: launch better models, buy and house compute,
 * recruit and raise. Training is the milestone run when one can reach the
 * target, otherwise the expert's usual next model.
 */
function scaleTowardMilestone(
  planner: Planner,
  available: readonly AvailableCommandView[],
  target: number | undefined,
): void {
  // A command this week that holds what the next one previews against (an
  // evaluation's compute, a building's project slot) would make it stale, so
  // that one waits a week.
  const evaluating = planner.commands.some(
    (command) => command.kind === "start-evaluation",
  );
  const constructing = planner.commands.some(
    (command) => command.kind === "start-facility-construction",
  );
  launch(planner);
  if (!evaluating && (target === undefined || !trainForMilestone(planner, target, 0))) {
    train(planner);
  }
  const forBuildings = constructing ? 0 : build(planner);
  procure(planner);
  recruit(planner, available);
  fundraise(planner, forBuildings);
}

function playChapter(
  planner: Planner,
  available: readonly AvailableCommandView[],
  chapter: Readonly<LabMaturityViewData>,
  options: ExpertOptions,
): void {
  chapterObjectives(planner, available, chapter);
  openingAllocate(planner, chapter, options);
}

function chapterObjectives(
  planner: Planner,
  available: readonly AvailableCommandView[],
  chapter: Readonly<LabMaturityViewData>,
): void {
  const view = planner.view;
  switch (chapter.stage) {
    case "garage":
      fillHousing(planner, -Infinity);
      return;
    case "cluster":
      if (activeProjects(view, "training") === 0) {
        planner.attempt(
          planner.build("start-training-run", { posture: "normal", durationWeeks: 5 }),
          -Infinity,
        );
      }
      return;
    case "model":
      planner.attempt(planner.build("review-rival-race", {}), -Infinity);
      return;
    case "startup":
      startFacility(planner, SERVER_RACK, -Infinity);
      fillHousing(planner, -Infinity);
      return;
    case "foundation":
      // Training waits on the research objective, which the allocation above
      // funds; the validator refuses the run until a programme has advanced.
      if (objectiveDone(chapter, 1)) {
        trainForMilestone(planner, MILESTONE_CAPABILITY.foundation, -Infinity);
      }
      return;
    case "product":
      launchFirstProduct(planner);
      return;
    case "funding":
      // The chapter wants a round whatever the runway says.
      fundraise(planner, Infinity);
      return;
    case "lab":
      if (!objectiveDone(chapter, 0)) recruitFirstResearcher(planner);
      appointLead(planner);
      return;
    case "institution":
      if (!objectiveDone(chapter, 0)) startFacility(planner, PRESS_OFFICE, -Infinity);
      scaleTowardMilestone(planner, available, MILESTONE_CAPABILITY.institution);
      return;
    case "safety":
      if (!objectiveDone(chapter, 1)) firstEvaluation(planner);
      scaleTowardMilestone(planner, available, MILESTONE_CAPABILITY.safety);
      return;
    case "autonomy":
      planner.attempt(planner.build("set-model-autonomy", { level: 1 }), -Infinity);
      scaleTowardMilestone(planner, available, undefined);
      return;
    case "frontier":
      return;
  }
}

export function expertDecisions(
  policyView: Readonly<PolicyView>,
  available: readonly AvailableCommandView[],
  preview: CommandPreviewer,
  options: ExpertOptions = {},
): readonly GameCommand[] {
  const planner = new Planner(policyView.game, preview);
  respondToMandatory(planner, available);
  // A guided game plays its chapters first; from the frontier chapter on (and
  // in every classic game, which has no chapters) the expert plays as below.
  const chapter = policyView.game.meta.labMaturity;
  if (chapter !== undefined && chapter.stage !== "frontier") {
    playChapter(planner, available, chapter, options);
    return planner.commands;
  }
  endgame(planner, available);
  if (policyView.game.endgame.active) {
    fundraise(planner, 0);
    return planner.commands;
  }
  allocate(planner, options);
  launch(planner);
  train(planner);
  const forWorks = candidateProgramme(planner);
  const forBuildings = build(planner);
  procure(planner);
  evaluate(planner, available);
  recruit(planner, available);
  fundraise(planner, Math.max(forWorks, forBuildings));
  return planner.commands;
}
