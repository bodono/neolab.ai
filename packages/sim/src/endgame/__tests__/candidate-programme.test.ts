import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { createNewGame } from "../../engine/create-new-game.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import { createTransaction } from "../../engine/transaction.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { CommandId, FacilityId } from "../../model/ids.ts";
import type { AgiComponentType, GameState } from "../../model/state.ts";
import { cashMillions, gpuCount, rating } from "../../model/units.ts";
import { seed128 } from "../../random/seed.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { registerCompletedTrainingArtifact } from "../candidate-lifecycle.ts";
import {
  AGI_COMPONENT_RULES,
  AGI_COMPONENT_TYPES,
  FINAL_ERA_FIRST_GENERATION_ID,
  agiComponentFlag,
  agiComponentsComplete,
  eligibleProgrammeCandidateModelIds,
  eraBlockerLabel,
  quoteAgiComponent,
} from "../candidate-programme.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): GameState {
  return createNewGame(
    {
      seed: seed128("0123456789abcdef0123456789abcdef"),
      difficultyId: contentId("base:difficulty.standard"),
      leaderId: contentId("base:leader.thomas-hassabi"),
      mandateId: contentId("base:mandate.build-the-science"),
    },
    content,
  );
}

/** A lab that clears every Panopticon gate: era, research level, cash, fleet. */
function preparedState(): GameState {
  const draft = structuredClone(newState()) as DeepMutable<GameState>;
  const lab = draft.labs[draft.run.playerLabId];
  if (lab === undefined) throw new Error("player lab missing");
  draft.world.currentGpuGenerationId = contentId(FINAL_ERA_FIRST_GENERATION_ID);
  lab.finance.cash = cashMillions(100_000);
  // Panopticon gates on the capability tree and its own exotic building now:
  // Reinforcement Learning & Agency 70+ inside the Argus Array. Never safety
  // -- a greedy racer must be able to reach the endgame uninvested.
  const agency = lab.research.domains["base:domain.reinforcement-agency"];
  if (agency === undefined) throw new Error("agency domain missing");
  agency.level = rating(75);
  lab.facilities.instances.push({
    id: "run:facility:argus" as FacilityId,
    definitionId: contentId("base:facility.argus-array-1"),
    completedAt: draft.run.tick,
    majorProjectSlotBonus: 0,
    modifierIds: [],
  });
  const lot = lab.compute.lots[0];
  if (lot === undefined) throw new Error("starting lot missing");
  // Panopticon reserves 3 EFLOP/s; 4,000 Markov-class GPUs deliver 6.7.
  lot.generationId = contentId(FINAL_ERA_FIRST_GENERATION_ID);
  lot.physicalCount = gpuCount(4_000);
  return draft;
}

function startCommand(state: GameState, componentType: AgiComponentType) {
  return {
    kind: "start-agi-component" as const,
    meta: {
      commandId: `command:agi-${componentType}` as CommandId,
      expectedTick: state.run.tick,
      issuedBy: "player" as const,
    },
    labId: state.run.playerLabId,
    componentType,
  };
}

function advance(state: GameState, ticks: number): GameState {
  let current = state;
  for (let index = 0; index < ticks; index += 1) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

describe("the Candidate Programme", () => {
  it("prices every major work as a late-game, tens-of-billions commitment", () => {
    expect(
      Object.fromEntries(
        AGI_COMPONENT_TYPES.map((componentType) => [
          componentType,
          AGI_COMPONENT_RULES[componentType].cashCostMillions,
        ]),
      ),
    ).toEqual({
      "project-panopticon": 25_000,
      "world-engine": 40_000,
      "oracle-grid": 30_000,
      "mirror-test": 20_000,
    });
  });

  it("locks every component at game start with concrete blockers", () => {
    const state = newState();
    for (const componentType of AGI_COMPONENT_TYPES) {
      const quote = quoteAgiComponent(
        state,
        content,
        state.run.playerLabId,
        componentType,
      );
      expect(quote.status).toBe("locked");
      expect(quote.blockers.length).toBeGreaterThan(0);
      expect(quote.blockers.join(" ")).toContain("Requires");
      expect(quote.blockers).toContain(
        eraBlockerLabel(content, AGI_COMPONENT_RULES[componentType].eraGenerationId),
      );
    }
    expect(agiComponentsComplete(state, state.run.playerLabId)).toBe(false);
  });

  it("opens the infrastructure bets one era early, in Rubin", () => {
    const draft = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    draft.world.currentGpuGenerationId = contentId("base:gpu.rubin");
    lab.finance.cash = cashMillions(50_000);
    const optimisation = lab.research.domains["base:domain.optimisation-scaling"];
    if (optimisation === undefined) throw new Error("optimisation domain missing");
    optimisation.level = rating(75);
    lab.facilities.instances.push({
      id: "run:facility:dc4" as FacilityId,
      definitionId: contentId("base:facility.data-centre-4"),
      completedAt: draft.run.tick,
      majorProjectSlotBonus: 0,
      modifierIds: [],
    });
    const lot = lab.compute.lots[0];
    if (lot === undefined) throw new Error("starting lot missing");
    // The Oracle Grid reserves 5 EFLOP/s; 10,000 Rubin-class GPUs deliver ~6.1.
    lot.generationId = contentId("base:gpu.rubin");
    lot.physicalCount = gpuCount(10_000);

    const oracle = quoteAgiComponent(
      draft,
      content,
      draft.run.playerLabId,
      "oracle-grid",
    );
    expect(oracle.status).toBe("available");

    // The frontier works stay behind the Markov gate even with a Rubin fleet.
    const panopticon = quoteAgiComponent(
      draft,
      content,
      draft.run.playerLabId,
      "project-panopticon",
    );
    expect(panopticon.status).toBe("locked");
    expect(panopticon.blockers).toContain(
      eraBlockerLabel(content, FINAL_ERA_FIRST_GENERATION_ID),
    );
  });

  it("builds Project Panopticon end to end: cash out, GPUs reserved, flag and modifier on completion", () => {
    const state = preparedState();
    const labId = state.run.playerLabId;
    const quote = quoteAgiComponent(state, content, labId, "project-panopticon");
    expect(quote.status).toBe("available");
    expect(quote.reservedPhysicalGpus).toBeGreaterThan(0);

    const started = applyCommand(
      state,
      content,
      startCommand(state, "project-panopticon"),
    );
    const startedLab = started.state.labs[labId];
    if (startedLab === undefined) throw new Error("player lab missing");
    expect(Number(startedLab.finance.cash)).toBe(100_000 - quote.cashCostMillions);
    expect(
      startedLab.compute.reservations.some(
        (reservation) => Number(reservation.gpus) === quote.reservedPhysicalGpus,
      ),
    ).toBe(true);
    expect(
      quoteAgiComponent(started.state, content, labId, "project-panopticon").status,
    ).toBe("in-progress");

    // 20-week build plus scheduling slack; the flag must flip on completion.
    const finished = advance(started.state, 24);
    const finishedLab = finished.labs[labId];
    if (finishedLab === undefined) throw new Error("player lab missing");
    expect(finishedLab.flags[agiComponentFlag("project-panopticon")]).toBe(true);
    expect(
      finishedLab.compute.reservations.some(
        (reservation) => Number(reservation.gpus) === quote.reservedPhysicalGpus,
      ),
    ).toBe(false);
    const modifier = Object.values(finished.modifiers).find((entry) =>
      entry.tags?.includes("project-panopticon"),
    );
    expect(modifier?.target).toBe("lab.evaluation.cashCost");
    expect(modifier?.value).toBe(0.95);
    expect(quoteAgiComponent(finished, content, labId, "project-panopticon").status).toBe(
      "complete",
    );
  });

  it("keeps the World Engine an upgrade rather than a quiet downgrade", () => {
    // It used to grant "Frontier training duration x0.95". Total FLOP is
    // committedTeraflops x durationWeeks and weekly throughput carries no
    // duration term, so that cut 5% of a run's compute and produced a WEAKER
    // model -- advertised as the reward for a 26-week, $40B megaproject.
    const worldEngine = AGI_COMPONENT_RULES["world-engine"];
    expect(worldEngine.completionModifier.target).toBe("lab.compute.workloadThroughput");
    expect(worldEngine.completionModifier.value).toBeGreaterThan(1);
    expect(worldEngine.benefitLabel).toContain("throughput");
  });

  it("counts candidacy readiness only when all four flags are set", () => {
    const draft = structuredClone(newState()) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("player lab missing");
    for (const componentType of AGI_COMPONENT_TYPES.slice(0, 3)) {
      lab.flags[agiComponentFlag(componentType)] = true;
    }
    expect(agiComponentsComplete(draft, draft.run.playerLabId)).toBe(false);
    const last = AGI_COMPONENT_TYPES[3];
    if (last === undefined) throw new Error("component list truncated");
    lab.flags[agiComponentFlag(last)] = true;
    expect(agiComponentsComplete(draft, draft.run.playerLabId)).toBe(true);
  });

  it("rejects a start while the same component is already under construction", () => {
    const state = preparedState();
    const started = applyCommand(
      state,
      content,
      startCommand(state, "project-panopticon"),
    );
    expect(() =>
      applyCommand(
        started.state,
        content,
        startCommand(started.state, "project-panopticon"),
      ),
    ).toThrow(/under construction|blocked/i);
  });

  it("keeps the endgame shut for a maxed model until the programme is complete", () => {
    const draft = structuredClone(
      addBaselineModelsForTest(newState(), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    if (lab === undefined || model === undefined) {
      throw new Error("player model missing");
    }
    // Regression: candidacy is based on capability plus the four works, not
    // a raw training-FLOP floor.
    model.investedTotalFlop = 0;
    model.measuredCapability = {
      values: {
        language: rating(92),
        reasoning: rating(91),
        agency: rating(86),
        toolUse: rating(87),
        multimodality: rating(82),
        scientificAbility: rating(84),
        embodiment: rating(80),
      },
      frontierCapability: rating(90),
      confidence: "high",
      evidenceFlags: [],
    };
    for (const attribute of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[attribute] = rating(95);
    }
    const registration = createTransaction(draft);
    expect(
      registerCompletedTrainingArtifact(
        registration,
        model.id,
        new RandomOracleV1(draft.run.seed),
      ),
    ).toBe(true);
    const registered = registration.commit({
      description: "register programme test candidate",
    }).state;
    const withoutComponents = advanceOneTick(structuredClone(registered), content).state;
    expect(withoutComponents.endgame.stage).toBe("inactive");

    const complete = structuredClone(registered) as DeepMutable<GameState>;
    const completeLab = complete.labs[complete.run.playerLabId];
    if (completeLab === undefined) throw new Error("player lab missing");
    for (const componentType of AGI_COMPONENT_TYPES) {
      completeLab.flags[agiComponentFlag(componentType)] = true;
    }
    const withComponents = advanceOneTick(complete, content).state;
    expect(withComponents.endgame).toMatchObject({
      stage: "candidate-activation",
      eligibleModelIds: [model.id],
    });
  });

  it("rechecks the full 88/80 capability gate and excludes active hazards", () => {
    const draft = structuredClone(
      addBaselineModelsForTest(newState(), content),
    ) as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : draft.models[modelId];
    if (lab === undefined || model === undefined) throw new Error("Player model missing");
    for (const componentType of AGI_COMPONENT_TYPES) {
      lab.flags[agiComponentFlag(componentType)] = true;
    }
    for (const attribute of Object.keys(model.trueCapability) as Array<
      keyof typeof model.trueCapability
    >) {
      model.trueCapability[attribute] = rating(95);
    }
    const registration = createTransaction(draft);
    expect(
      registerCompletedTrainingArtifact(
        registration,
        model.id,
        new RandomOracleV1(draft.run.seed),
      ),
    ).toBe(true);
    const registered = structuredClone(
      registration.commit({ description: "register threshold fixture" }).state,
    ) as DeepMutable<GameState>;

    expect(
      eligibleProgrammeCandidateModelIds(registered, registered.run.playerLabId),
    ).toEqual([model.id]);
    const candidate = registered.models[model.id];
    if (candidate?.candidateArtifact === undefined) {
      throw new Error("Candidate artifact missing");
    }
    candidate.trueCapability.embodiment = rating(79);
    expect(
      eligibleProgrammeCandidateModelIds(registered, registered.run.playerLabId),
    ).toEqual([]);

    candidate.trueCapability.embodiment = rating(95);
    candidate.candidateArtifact.lifecycle = "active-hazard";
    expect(
      eligibleProgrammeCandidateModelIds(registered, registered.run.playerLabId),
    ).toEqual([]);
  });
});
