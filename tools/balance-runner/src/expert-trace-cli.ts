// One expert game with a timeline and the weeks its milestones landed.
//
//   node src/expert-trace-cli.ts --seed 1 [--max-ticks 1120] [--every 52]
//                                [--save-at 820 --save state.json] [--load state.json]
//                                [--expert-focus multimodality] [--papers-at 860]
//                                [--opening classic|guided]
//
// `--opening guided` starts from the "Guided chapters" opening players get by
// default; the milestones then include the week each chapter opened, and the
// timeline the current chapter.
//
// A tuning tool, not a balance measurement: the timeline and milestones read
// privileged state (true capability, rival strength) to explain the run. The
// policy itself still sees only the player view and command previews.
import { readFileSync, writeFileSync } from "node:fs";

import { loadCompiledContent } from "@neolab/content";
import { contentId } from "@neolab/content-schema";
import {
  advanceOneTick,
  applyCommand,
  calculateFrontierCapability,
  createNewGame,
  createProgressiveNewGame,
  endgameClockStopReason,
  isProgressiveCampaign,
  labMaturityStage,
  migrateSaveState,
  projectGameView,
  seed128,
  validateCommand,
  type GameState,
  type PlayerKnowledgeContext,
} from "@neolab/sim";

import { listAvailableCommands } from "./available-commands.ts";
import { expertDecisions, resolveExpertFocus } from "./expert-policy.ts";
import { guidedOpeningProgress } from "./runner.ts";
import { BALANCE_OPENINGS, EXPERT_POLICY_ID, type BalanceOpening } from "./types.ts";

const args = process.argv.slice(2);
const read = (flag: string): string | undefined => {
  const index = args.lastIndexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const seedIndex = Number(read("--seed") ?? "1");
const maxTicks = Number(read("--max-ticks") ?? "1120");
const every = Number(read("--every") ?? "52");
const saveAt = read("--save-at");
const savePath = read("--save") ?? "expert-state.json";
const loadPath = read("--load");
const papersAt = read("--papers-at");
const focusArgument = read("--expert-focus");
const researchFocus =
  focusArgument === undefined ? undefined : resolveExpertFocus(focusArgument);
const opening = read("--opening") ?? "classic";
if (!BALANCE_OPENINGS.includes(opening as BalanceOpening)) {
  throw new Error(`--opening must be ${BALANCE_OPENINGS.join(" or ")}`);
}

const content = loadCompiledContent();

function context(state: Readonly<GameState>): PlayerKnowledgeContext {
  const lab = state.labs[state.run.playerLabId];
  const models = lab?.models.modelIds.map((modelId) => state.models[modelId]) ?? [];
  return {
    viewerLabId: state.run.playerLabId,
    intelligenceRatings: {},
    evidenceAccess: {
      evaluationIds: models.flatMap((model) => model?.evaluations ?? []),
      anomalyIds: models.flatMap((model) => model?.anomalies ?? []),
    },
  };
}

/** The runner's cadence: every four weeks, quarterly, and whenever a decision waits. */
function decisionDue(state: Readonly<GameState>): boolean {
  if (state.run.tick % 4 === 0 || state.run.tick % 13 === 0) return true;
  if (endgameClockStopReason(state) !== undefined) return true;
  if (state.endgame.stage !== "inactive" && state.endgame.stage !== "resolved")
    return true;
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return false;
  return (
    lab.research.pendingGenericAdvances.length > 0 ||
    Object.values(state.eventInstances).some(
      (instance) => instance.status === "unresolved",
    ) ||
    Object.values(state.fundraising.offers).some(
      (offer) => offer.status === "available",
    ) ||
    Object.values(state.world.paperRace.discoveries).some(
      (discovery) =>
        discovery.discovererLabId === state.run.playerLabId &&
        discovery.publicationPolicy === undefined,
    )
  );
}

const money = (millions: number): string =>
  Math.abs(millions) >= 1e6
    ? `${(millions / 1e6).toFixed(1)}T`
    : Math.abs(millions) >= 1e3
      ? `${(millions / 1e3).toFixed(1)}B`
      : `${millions.toFixed(0)}M`;

function strongestTrueCapability(state: Readonly<GameState>, labId: string): number {
  const lab = state.labs[labId as keyof typeof state.labs];
  return Math.max(
    0,
    ...(lab?.models.modelIds ?? []).map((modelId) => {
      const model = state.models[modelId];
      return model === undefined ? 0 : calculateFrontierCapability(model.trueCapability);
    }),
  );
}

const WORK_TYPES = ["oracle-grid", "mirror-test", "project-panopticon", "world-engine"];

function timeline(state: Readonly<GameState>): string {
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) return "player lab missing";
  const domains = Object.values(lab.research.domains).map((domain) => domain.level);
  const safety = Object.values(lab.research.safetyPrograms).map(
    (program) => program.level,
  );
  const gpus = lab.compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0);
  const works = WORK_TYPES.map((type) =>
    lab.flags[`agi-component:${type}:complete`] === true ? "#" : ".",
  ).join("");
  const rival = Math.max(
    ...Object.keys(state.world.rivals).map((labId) =>
      strongestTrueCapability(state, labId),
    ),
  );
  return [
    `wk ${String(state.run.tick).padStart(4)} ${String(state.run.calendar.year)}`,
    ...(isProgressiveCampaign(state) ? [`ch ${labMaturityStage(state)}`] : []),
    state.run.phase,
    state.world.currentGpuGenerationId.replace("base:gpu.", ""),
    `cash ${money(lab.finance.cash)}`,
    `gpu ${(gpus / 1000).toFixed(0)}k`,
    `FC ${strongestTrueCapability(state, state.run.playerLabId).toFixed(1)}`,
    `cap[${domains.join(",")}] saf[${safety.join(",")}]`,
    `works ${works}`,
    `rival FC ${rival.toFixed(1)}`,
    `papers ${String(
      Object.values(state.world.paperRace.discoveries).filter(
        (discovery) => discovery.discovererLabId === state.run.playerLabId,
      ).length,
    )}/${String(Object.keys(state.world.paperRace.discoveries).length)}`,
    `endgame ${state.endgame.stage}`,
  ].join(" | ");
}

const milestones = new Map<string, number>();
const KEY_FACILITIES = [
  "fusion-reactor-array-1",
  "hadron-collider-1",
  "time-sphere-1",
  "nanofoundry-1",
  "argus-array-1",
  "power-and-cooling-4",
  "data-centre-4",
  "cross-attention-atrium",
  "shared-kv-cache",
];

/** World FC as the event exclusions read it: the strongest true model anywhere. */
function worldFrontierCapability(state: Readonly<GameState>): number {
  return Object.values(state.models).reduce(
    (maximum, model) =>
      Math.max(maximum, calculateFrontierCapability(model.trueCapability)),
    0,
  );
}

/** The early-era events close at world FC 45. */
const EARLY_EVENT_WORLD_FC = 45;
const seenEvents = new Set<string>();
/** Ordinary decision events (opportunities, not feed items), as the runner counts them. */
const ordinaryEvents: { week: number; id: string; worldFc: number }[] = [];
let worldFcReachedEarlyLimitAt: number | undefined;

function observeEvents(state: Readonly<GameState>): void {
  const worldFc = worldFrontierCapability(state);
  if (worldFc >= EARLY_EVENT_WORLD_FC) worldFcReachedEarlyLimitAt ??= state.run.tick;
  for (const instance of Object.values(state.eventInstances)) {
    if (seenEvents.has(instance.id)) continue;
    seenEvents.add(instance.id);
    const definition = content.events.definitions[instance.definitionId];
    if (
      definition === undefined ||
      instance.source !== "opportunity" ||
      definition.severity === "feed"
    ) {
      continue;
    }
    ordinaryEvents.push({
      week: instance.createdAt,
      id: instance.definitionId.replace(/^base:event\./, ""),
      worldFc,
    });
  }
}

function eventSummary(): string {
  const early = ordinaryEvents.filter((event) => event.worldFc < EARLY_EVENT_WORLD_FC);
  return [
    `events ordinary ${String(ordinaryEvents.length)}`,
    `first wk ${ordinaryEvents[0] === undefined ? "-" : String(ordinaryEvents[0].week)}`,
    `world FC ${String(EARLY_EVENT_WORLD_FC)} wk ${worldFcReachedEarlyLimitAt === undefined ? "-" : String(worldFcReachedEarlyLimitAt)}`,
    `before world FC ${String(EARLY_EVENT_WORLD_FC)}: ${String(early.length)}` +
      (early.length === 0
        ? ""
        : ` [${early.map((event) => `${event.id}@${String(event.week)}`).join(" ")}]`),
  ].join(" | ");
}

function observe(state: Readonly<GameState>): void {
  const mark = (key: string): void => {
    if (!milestones.has(key)) milestones.set(key, state.run.tick);
  };
  observeEvents(state);
  if (isProgressiveCampaign(state)) mark(`chapter:${labMaturityStage(state)}`);
  const generation = state.world.currentGpuGenerationId.replace("base:gpu.", "");
  if (["rubin", "markov", "kolmogorov"].includes(generation)) mark(`era:${generation}`);
  mark(`phase:${state.run.phase}`);
  const lab = state.labs[state.run.playerLabId];
  for (const instance of lab?.facilities.instances ?? []) {
    const id = instance.definitionId.replace("base:facility.", "");
    if (KEY_FACILITIES.includes(id)) mark(`built:${id}`);
  }
  for (const type of WORK_TYPES) {
    if (lab?.flags[`agi-component:${type}:complete`] === true) mark(`work:${type}`);
  }
  for (const lineage of Object.values(state.lineageSIRecords)) {
    const owner = state.models[lineage.firstQualifyingModelId]?.ownerLabId;
    if (owner !== state.run.playerLabId) continue;
    mark(
      `crossed:FC${lineage.firstQualifyingFrontierCapability.toFixed(1)}:` +
        `${(lineage.probabilityAtFirstCrossing * 100).toFixed(0)}%:` +
        lineage.superintelligenceTruth,
    );
  }
  if (state.endgame.stage !== "inactive") mark(`stage:${state.endgame.stage}`);
  if (
    Object.values(state.world.rivals).some(
      (rival) => rival.candidateCountdown !== undefined,
    )
  ) {
    mark("rival:first-countdown");
  }
}

/** World firsts: the player's share overall and per programme it led. */
function paperSummary(state: Readonly<GameState>): string {
  const discoveries = Object.values(state.world.paperRace.discoveries);
  const playerId = state.run.playerLabId;
  const byProgramme = new Map<string, { won: number; total: number }>();
  for (const discovery of discoveries) {
    const programmeId =
      content.papers.definitions[discovery.paperId]?.breakthroughRequirement
        .programmeId ?? "unknown";
    const entry = byProgramme.get(programmeId) ?? { won: 0, total: 0 };
    entry.total += 1;
    if (discovery.discovererLabId === playerId) entry.won += 1;
    byProgramme.set(programmeId, entry);
  }
  const won = discoveries.filter(
    (discovery) => discovery.discovererLabId === playerId,
  ).length;
  return [
    `papers player ${String(won)}/${String(discoveries.length)}`,
    ...[...byProgramme.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(
        ([programmeId, entry]) =>
          `${programmeId.replace(/^base:(domain|safety)\./, "")} ${String(entry.won)}/${String(entry.total)}`,
      ),
  ].join(" | ");
}

/**
 * A state saved by an older build goes through the game's own save migrations
 * (a raw state or a save envelope), so fields added since are filled in.
 */
function loadTraceState(path: string): GameState {
  const raw = JSON.parse(readFileSync(path, "utf8")) as { readonly state?: unknown };
  return migrateSaveState(raw.state ?? raw).state as GameState;
}

const config = {
  seed: seed128(seedIndex.toString(16).padStart(32, "0")),
  difficultyId: contentId("base:difficulty.standard"),
  leaderId: contentId("base:leader.thomas-hassabi"),
  mandateId: contentId("base:mandate.build-it-right"),
};
let state: GameState =
  loadPath !== undefined
    ? loadTraceState(loadPath)
    : opening === "guided"
      ? createProgressiveNewGame(config, content)
      : createNewGame(config, content);
if (isProgressiveCampaign(state)) {
  milestones.set(`chapter:${labMaturityStage(state)}`, state.run.tick);
}
const rejected: Record<string, number> = {};
let stoppedSteps = 0;
// A guided game also decides when its opening pauses: a chapter opens or an
// objective completes (see the runner's guidedOpeningProgress).
let decidedOpeningProgress = guidedOpeningProgress(state);
while (state.run.status === "active" && state.run.tick < maxTicks) {
  const openingProgress = guidedOpeningProgress(state);
  if (decisionDue(state) || openingProgress !== decidedOpeningProgress) {
    decidedOpeningProgress = openingProgress;
    const snapshot = state;
    const commands = expertDecisions(
      {
        game: projectGameView(state, content, context(state)),
        seed: state.run.seed,
        policyId: EXPERT_POLICY_ID,
      },
      listAvailableCommands(state, content, EXPERT_POLICY_ID),
      (command) => validateCommand(snapshot, content, command),
      researchFocus === undefined ? {} : { researchFocus },
    );
    for (const command of commands) {
      const validation = validateCommand(state, content, command);
      if (!validation.ok) {
        for (const error of validation.errors) {
          const key = `${command.kind}:${error.code}`;
          rejected[key] = (rejected[key] ?? 0) + 1;
        }
        continue;
      }
      state = applyCommand(state, content, command).state;
    }
  }
  if (state.run.status !== "active") break;
  if (endgameClockStopReason(state) !== undefined) {
    stoppedSteps += 1;
    if (stoppedSteps > 16) {
      console.log(`clock stopped without progress in ${state.endgame.stage}`);
      break;
    }
    continue;
  }
  stoppedSteps = 0;
  state = advanceOneTick(state, content).state;
  observe(state);
  if (saveAt !== undefined && state.run.tick === Number(saveAt)) {
    writeFileSync(savePath, JSON.stringify(state));
  }
  if (state.run.tick % every === 0) console.log(timeline(state));
  if (papersAt !== undefined && state.run.tick === Number(papersAt)) {
    console.log(`week ${papersAt} ${paperSummary(state)}`);
  }
}
console.log(timeline(state));
console.log(
  `status ${state.run.status} ending ${state.run.endingId ?? "-"} week ${String(state.run.tick)}`,
);
console.log(`rejected ${JSON.stringify(rejected)}`);
console.log(paperSummary(state));
console.log(
  `milestones ${[...milestones.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([key, week]) => `${key}@${String(week)}`)
    .join(" ")}`,
);
console.log(eventSummary());
