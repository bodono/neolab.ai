// One expert game with a timeline and the weeks its milestones landed.
//
//   node src/expert-trace-cli.ts --seed 1 [--max-ticks 1120] [--every 52]
//                                [--save-at 820 --save state.json] [--load state.json]
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
  endgameClockStopReason,
  projectGameView,
  seed128,
  validateCommand,
  type GameState,
  type PlayerKnowledgeContext,
} from "@neolab/sim";

import { listAvailableCommands } from "./available-commands.ts";
import { expertDecisions } from "./expert-policy.ts";
import { EXPERT_POLICY_ID } from "./types.ts";

const args = process.argv.slice(2);
const read = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index < 0 ? undefined : args[index + 1];
};
const seedIndex = Number(read("--seed") ?? "1");
const maxTicks = Number(read("--max-ticks") ?? "1120");
const every = Number(read("--every") ?? "52");
const saveAt = read("--save-at");
const savePath = read("--save") ?? "expert-state.json";
const loadPath = read("--load");

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
    state.run.phase,
    state.world.currentGpuGenerationId.replace("base:gpu.", ""),
    `cash ${money(lab.finance.cash)}`,
    `gpu ${(gpus / 1000).toFixed(0)}k`,
    `FC ${strongestTrueCapability(state, state.run.playerLabId).toFixed(1)}`,
    `cap[${domains.join(",")}] saf[${safety.join(",")}]`,
    `works ${works}`,
    `rival FC ${rival.toFixed(1)}`,
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

function observe(state: Readonly<GameState>): void {
  const mark = (key: string): void => {
    if (!milestones.has(key)) milestones.set(key, state.run.tick);
  };
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
  if (state.endgame.stage !== "inactive") mark(`stage:${state.endgame.stage}`);
  if (
    Object.values(state.world.rivals).some(
      (rival) => rival.candidateCountdown !== undefined,
    )
  ) {
    mark("rival:first-countdown");
  }
}

let state: GameState =
  loadPath !== undefined
    ? (JSON.parse(readFileSync(loadPath, "utf8")) as GameState)
    : createNewGame(
        {
          seed: seed128(seedIndex.toString(16).padStart(32, "0")),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-it-right"),
        },
        content,
      );
const rejected: Record<string, number> = {};
let stoppedSteps = 0;
while (state.run.status === "active" && state.run.tick < maxTicks) {
  if (decisionDue(state)) {
    const snapshot = state;
    const commands = expertDecisions(
      {
        game: projectGameView(state, content, context(state)),
        seed: state.run.seed,
        policyId: EXPERT_POLICY_ID,
      },
      listAvailableCommands(state, content, EXPERT_POLICY_ID),
      (command) => validateCommand(snapshot, content, command),
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
}
console.log(timeline(state));
console.log(
  `status ${state.run.status} ending ${state.run.endingId ?? "-"} week ${String(state.run.tick)}`,
);
console.log(`rejected ${JSON.stringify(rejected)}`);
console.log(
  `milestones ${[...milestones.entries()]
    .sort((left, right) => left[1] - right[1])
    .map(([key, week]) => `${key}@${String(week)}`)
    .join(" ")}`,
);
