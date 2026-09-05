import { describe, expect, it } from "vitest";

import {
  contentId,
  validateCompiledContent,
  type CompiledContent,
} from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import { applyCommand } from "../../commands/apply.ts";
import { validateCommand } from "../../commands/validate.ts";
import {
  LAB_MATURITY_STAGE_FLAG,
  type LabMaturityStage,
} from "../../campaign/lab-maturity.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import type { DeepMutable } from "../../engine/draft.ts";
import type { CommandId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { createGuidedTutorialGame, isGuidedTutorial } from "../guided-tutorial.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function atStage(state: GameState, stage: LabMaturityStage): GameState {
  const draft = structuredClone(state) as DeepMutable<GameState>;
  const lab = draft.labs[draft.run.playerLabId];
  if (lab === undefined) throw new Error("Tutorial player lab is missing");
  lab.flags[LAB_MATURITY_STAGE_FLAG] = stage;
  return draft;
}

describe("guided tutorial scenario", () => {
  it("creates a deterministic, well-funded, event-free opening", () => {
    const first = createGuidedTutorialGame(content);
    const second = createGuidedTutorialGame(content);
    const lab = first.labs[first.run.playerLabId];

    expect(first.run.seed).toBe(second.run.seed);
    expect(isGuidedTutorial(first)).toBe(true);
    expect(lab?.finance.cash).toBeGreaterThanOrEqual(250);
    expect(lab?.aura.spendable).toBeGreaterThanOrEqual(40);
    expect(lab?.aura.lifetime).toBeGreaterThanOrEqual(lab?.aura.spendable ?? 0);
    expect(
      Object.values(content.events.definitions).every(
        (definition) =>
          (first.world.eventCooldowns[definition.cooldown.group] ?? 0) > first.run.tick,
      ),
    ).toBe(true);
  });

  it("keeps unrelated events and rival activity quiet while time advances", () => {
    let state = createGuidedTutorialGame(content);
    const rivalModelCounts = Object.values(state.labs)
      .filter((lab) => lab.control === "rival")
      .map((lab) => lab.models.modelIds.length);

    for (let week = 0; week < 20; week += 1) {
      state = advanceOneTick(state, content).state;
    }

    expect(Object.keys(state.eventInstances)).toHaveLength(0);
    expect(
      Object.values(state.labs)
        .filter((lab) => lab.control === "rival")
        .map((lab) => lab.models.modelIds.length),
    ).toEqual(rivalModelCounts);
  });

  it("hands control back to the player when a tutorial project completes", () => {
    let state = createGuidedTutorialGame(content);
    state = applyCommand(state, content, {
      kind: "buy-gpus",
      meta: {
        commandId: "command:tutorial-opening-gpus" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      generationId: state.world.currentGpuGenerationId,
      thousandUnits: 1,
    }).state;
    for (let week = 0; week < 12; week += 1) {
      if ((state.labs[state.run.playerLabId]?.compute.lots.length ?? 0) > 0) {
        break;
      }
      state = advanceOneTick(state, content).state;
    }
    state = applyCommand(state, content, {
      kind: "start-training-run",
      meta: {
        commandId: "command:tutorial-first-training" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      posture: "normal",
    }).state;

    for (let week = 0; week < 40; week += 1) {
      const result = advanceOneTick(state, content);
      if (result.domainEvents.some((event) => event.kind === "training-completed")) {
        expect(result.autoPauseReasons).toContain("manual");
        return;
      }
      state = result.state;
    }

    throw new Error("Tutorial training did not complete within the expected window");
  });

  it("pauses when the tutorial facility finishes construction", () => {
    let state = atStage(createGuidedTutorialGame(content), "startup");
    state = applyCommand(state, content, {
      kind: "start-facility-construction",
      meta: {
        commandId: "command:tutorial-first-facility" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      definitionId: contentId("base:facility.server-rack"),
    }).state;

    for (let week = 0; week < 20; week += 1) {
      const result = advanceOneTick(state, content);
      if (result.domainEvents.some((event) => event.kind === "facility-completed")) {
        expect(result.autoPauseReasons).toContain("manual");
        return;
      }
      state = result.state;
    }

    throw new Error("Tutorial facility did not complete within the expected window");
  });

  it("keeps the staged researcher, GPU, and facility lessons affordable", () => {
    let state = atStage(createGuidedTutorialGame(content), "lab");
    const researcherId = state.talentMarket.visibleResearcherIds[0];
    if (researcherId === undefined) throw new Error("Tutorial talent market is empty");

    const recruit = {
      kind: "recruit-researcher" as const,
      meta: {
        commandId: "command:tutorial-recruit" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player" as const,
      },
      labId: state.run.playerLabId,
      researcherId,
    };
    expect(validateCommand(state, content, recruit).ok).toBe(true);
    state = applyCommand(state, content, recruit).state;

    const assign = {
      kind: "assign-researcher" as const,
      meta: {
        commandId: "command:tutorial-assign" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player" as const,
      },
      labId: state.run.playerLabId,
      researcherId,
      assignment: {
        kind: "safety-program" as const,
        targetId: contentId("base:safety.alignment-control"),
        role: "lead" as const,
      },
    };
    expect(validateCommand(state, content, assign).ok).toBe(true);
    state = applyCommand(state, content, assign).state;

    const buyGpus = {
      kind: "buy-gpus" as const,
      meta: {
        commandId: "command:tutorial-buy-gpus" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player" as const,
      },
      labId: state.run.playerLabId,
      generationId: state.world.currentGpuGenerationId,
      thousandUnits: 1,
    };
    expect(validateCommand(state, content, buyGpus).ok).toBe(true);
    state = applyCommand(state, content, buyGpus).state;

    const buildFacility = {
      kind: "start-facility-construction" as const,
      meta: {
        commandId: "command:tutorial-build-facility" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player" as const,
      },
      labId: state.run.playerLabId,
      definitionId: contentId("base:facility.press-office"),
    };
    expect(validateCommand(state, content, buildFacility).ok).toBe(true);
    state = applyCommand(state, content, buildFacility).state;

    expect(state.researchers[researcherId]?.assignment).toMatchObject({
      kind: "safety-program",
      role: "lead",
    });
    expect(state.labs[state.run.playerLabId]?.compute.deliveries).toHaveLength(1);
    expect(Object.values(state.projects)).toContainEqual(
      expect.objectContaining({ kind: "construction", status: "active" }),
    );
  });
});
