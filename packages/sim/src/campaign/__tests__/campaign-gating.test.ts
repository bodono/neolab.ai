import { describe, expect, it } from "vitest";

import {
  validateCompiledContent,
  type CompiledContent,
  type ContentId,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { labMaturityCommandBlocker } from "../lab-maturity.ts";
import { createProgressiveNewGame, LAB_MATURITY_STAGE_FLAG } from "../lab-maturity.ts";
import { LAB_MATURITY_STAGES, type LabMaturityStage } from "../progressive-opening.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { GameCommand } from "../../commands/types.ts";
import type { CommandId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { seed128 } from "../../random/seed.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function config() {
  return {
    seed: seed128("5ca1ab1e5ca1ab1e5ca1ab1e5ca1ab1e"),
    difficultyId: "base:difficulty.standard" as ContentId,
    leaderId: "base:leader.dario-amodeo" as ContentId,
    mandateId: "base:mandate.build-the-science" as ContentId,
  };
}

function stateAtStage(stage: LabMaturityStage): GameState {
  const draft = structuredClone(
    createProgressiveNewGame(config(), content),
  ) as DeepMutable<GameState>;
  const lab = draft.labs[draft.run.playerLabId];
  if (lab === undefined) throw new Error("Campaign gating fixture is missing its lab");
  lab.flags[LAB_MATURITY_STAGE_FLAG] = stage;
  return draft;
}

const SERVER_RACK_FACILITY_ID = "base:facility.server-rack";
const PRESS_OFFICE_FACILITY_ID = "base:facility.press-office";

interface ObjectiveCommand {
  readonly kind: GameCommand["kind"];
  /** Only the fields the maturity blocker itself reads. */
  readonly payload?: Record<string, unknown>;
}

function commandOfKind(state: GameState, objective: ObjectiveCommand): GameCommand {
  // The blocker reads kind, labId, allocation, definitionId, and policy. Every
  // other field is validated elsewhere, so this shape is enough to ask "is this
  // system reachable in this chapter?".
  return {
    kind: objective.kind,
    meta: {
      commandId: `command:gating:${objective.kind}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player",
    },
    labId: state.run.playerLabId,
    ...objective.payload,
  } as unknown as GameCommand;
}

function blockedAt(stage: LabMaturityStage, objective: ObjectiveCommand): boolean {
  const state = stateAtStage(stage);
  return labMaturityCommandBlocker(state, commandOfKind(state, objective)) !== undefined;
}

/** A research-only split: serving is deliberately gated until productisation. */
const researchAllocation = {
  allocation: { servingFleetShareBasisPoints: 0 },
} as const;

/**
 * The command each chapter's objective is completed with. A chapter whose own
 * objective is blocked in that chapter is a dead end: the player is told to do
 * something the simulation will refuse. Chapters completed by answering a
 * simulation prompt rather than issuing an order are covered by the reactive
 * list below instead.
 */
const OBJECTIVE_COMMANDS: Readonly<
  Partial<Record<LabMaturityStage, readonly ObjectiveCommand[]>>
> = {
  garage: [{ kind: "buy-gpus" }],
  cluster: [{ kind: "start-training-run" }],
  model: [{ kind: "review-rival-race" }],
  startup: [
    {
      kind: "start-facility-construction",
      payload: { definitionId: SERVER_RACK_FACILITY_ID },
    },
    { kind: "buy-gpus" },
  ],
  foundation: [
    { kind: "set-gpu-allocation", payload: researchAllocation },
    { kind: "start-training-run" },
  ],
  product: [
    { kind: "set-model-deployment-policy", payload: { policy: "guarded-api" } },
    { kind: "start-productisation" },
    { kind: "set-gpu-allocation", payload: researchAllocation },
  ],
  funding: [{ kind: "start-fundraising-campaign" }, { kind: "accept-funding-offer" }],
  lab: [{ kind: "recruit-researcher" }, { kind: "assign-researcher" }],
  institution: [
    {
      kind: "start-facility-construction",
      payload: { definitionId: PRESS_OFFICE_FACILITY_ID },
    },
    { kind: "start-training-run" },
  ],
  safety: [{ kind: "start-evaluation" }, { kind: "start-training-run" }],
  autonomy: [{ kind: "set-model-autonomy" }],
};

/**
 * Commands that answer something the simulation raised rather than something
 * the player went looking for. A locked workspace must never make one of these
 * unavailable: the prompt is already on screen and demands a response, so a
 * blocked answer is a stuck run. Both campaign soft locks found in play were
 * exactly this — an anomaly and a research branch arriving before their
 * workspace opened.
 */
const REACTIVE_COMMANDS: readonly ObjectiveCommand[] = [
  { kind: "dismiss-anomaly" },
  { kind: "investigate-anomaly" },
  { kind: "choose-generic-advance" },
  { kind: "choose-publication-policy" },
  { kind: "respond-to-decision-event" },
];

describe("progressive campaign gating", () => {
  it("always leaves a chapter at least one way to make progress", () => {
    // Sequencing inside a chapter is legitimate: the foundation chapter asks
    // for research before it will accept the FC 5 successor, and the player can
    // satisfy that from where they stand. A dead end is a chapter that offers
    // no unblocked step at all, which is what this rules out.
    const stuck: string[] = [];
    for (const stage of LAB_MATURITY_STAGES) {
      const objectives = OBJECTIVE_COMMANDS[stage] ?? [];
      if (objectives.length === 0) continue;
      if (objectives.every((objective) => blockedAt(stage, objective))) {
        stuck.push(stage);
      }
    }
    expect(stuck).toEqual([]);
  });

  it("keeps every simulation-raised prompt answerable in every chapter", () => {
    const unanswerable: string[] = [];
    for (const stage of LAB_MATURITY_STAGES) {
      for (const objective of REACTIVE_COMMANDS) {
        if (blockedAt(stage, objective)) unanswerable.push(`${stage}: ${objective.kind}`);
      }
    }
    expect(unanswerable).toEqual([]);
  });

  it("covers every chapter that is completed by issuing an order", () => {
    // Guards the table above against a new chapter being added without anyone
    // deciding whether its objective is reachable. Only the terminal chapter is
    // allowed to have no objective command, because it ends the ladder.
    const uncovered = LAB_MATURITY_STAGES.filter(
      (stage) => OBJECTIVE_COMMANDS[stage] === undefined,
    );
    expect(uncovered).toEqual(["frontier"]);
  });
});
