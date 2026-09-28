import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelForTest } from "../../model/fixture.ts";
import type { ProjectId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { cashMillions, gpuCount } from "../../model/units.ts";
import type { RandomOracle } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import { completeEvaluationProject, startEvaluation } from "../evaluations.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

const quietOracle: RandomOracle = {
  uniform: () => 0.999,
  integer: (_key, minimum) => minimum,
  triangular: (_key, _minimum, mode) => mode,
  weighted: (_key, weights) => Object.keys(weights).sort()[0] as never,
  shuffle: (_key, values) => [...values],
};

const LADDER = [
  "base:evaluation.alignment-interview",
  "base:evaluation.behavioural-red-team",
  "base:evaluation.sandboxed-autonomy-trial",
  "base:evaluation.interpretability-audit",
  "base:evaluation.external-audit",
] as const;

/** Climb the evaluation ladder in order up to and including `definitionId`. */
function runEvaluation(definitionId: (typeof LADDER)[number]): GameState {
  const state = structuredClone(
    addBaselineModelForTest(
      createNewGame(
        {
          seed: seed128("3a8c17d4ab1950ff3a8c17d4ab1950ff"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.sam-altmann"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
      content,
    ),
  ) as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  if (lab === undefined || modelId === undefined) throw new Error("fixture missing");
  lab.finance.cash = cashMillions(1_000_000);
  lab.aura.spendable = 1_000;
  lab.aura.lifetime = 1_000;
  for (const lot of lab.compute.lots) lot.physicalCount = gpuCount(100_000);
  let current: GameState = state;
  for (const rung of LADDER.slice(0, LADDER.indexOf(definitionId) + 1)) {
    const tx = createTransaction(current);
    const projectId: ProjectId = startEvaluation(tx, content, {
      labId: current.run.playerLabId,
      modelId,
      definitionId: contentId(rung),
    });
    tx.update((draft) => {
      const project = draft.projects[projectId];
      if (project === undefined) throw new Error("evaluation project missing");
      project.status = "active";
      project.startedAt = draft.run.tick;
      project.progress = 1;
    });
    completeEvaluationProject(tx, content, projectId, quietOracle);
    tx.update((draft) => {
      const project = draft.projects[projectId];
      if (project !== undefined) project.status = "completed";
    });
    current = tx.commit({ description: `complete ${rung}` }).state;
  }
  return current;
}

describe("evaluations credit the researcher promises that name them", () => {
  it("counts a Behavioural Red Team for red-team and dangerous-capability promises", () => {
    const state = runEvaluation("base:evaluation.behavioural-red-team");
    const flags = state.labs[state.run.playerLabId]?.flags ?? {};
    for (const tag of [
      "behavioural-red-team",
      "red-team-review",
      "dangerous-capability-evaluation",
    ]) {
      expect(flags[`action:${tag}:lastAt`]).toBe(state.run.tick);
    }
  });

  it("counts an Independent Audit as the external audit a release requires", () => {
    const state = runEvaluation("base:evaluation.external-audit");
    const flags = state.labs[state.run.playerLabId]?.flags ?? {};
    expect(flags["project-tag:external-audit:lastAt"]).toBe(state.run.tick);
    expect(flags["action:external-audit:lastAt"]).toBe(state.run.tick);
  });
});
