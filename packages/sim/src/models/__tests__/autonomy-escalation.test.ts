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
import { instantiateEvent } from "../../events/event-engine.ts";
import { createEndgamePlaytestState } from "../../developer/scenarios.ts";
import { finaliseEndedRun } from "../../engine/score.ts";
import { addBaselineModelsForTest } from "../../model/fixture.ts";
import type { CommandId, ModelId } from "../../model/ids.ts";
import { calendarFromTick, type GameState } from "../../model/state.ts";
import { cashMillions, rating, tick } from "../../model/units.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import {
  advanceAutonomyEscalation,
  autonomyBelievedDetectionChance,
  autonomyDetectionChance,
  autonomyHazard,
  resolveAutonomyEscapeOutcome,
} from "../autonomy-escalation.ts";
import {
  AUTONOMY_ACCESS_ROLLBACK_LOCK_WEEKS,
  AUTONOMY_MODIFIER_TAG,
  reconcileAutonomyModifiers,
} from "../autonomy.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function newState(): DeepMutable<GameState> {
  return structuredClone(
    addBaselineModelsForTest(
      createNewGame(
        {
          seed: seed128("0123456789abcdef0123456789abcdef"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
      content,
    ),
  ) as DeepMutable<GameState>;
}

/** A lab running at `level` with a misaligned, capable model. */
function dangerousState(level: 2 | 3 | 4 | 5): DeepMutable<GameState> {
  const draft = newState();
  const lab = draft.labs[draft.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : draft.models[modelId];
  if (lab === undefined || model === undefined) throw new Error("fixture missing");
  model.accessLevel = level;
  model.trueCapability.agency = rating(90);
  model.hiddenSafety.trueAlignment = rating(10);
  model.hiddenSafety.deceptiveCapability = rating(90);
  model.hiddenSafety.deceptiveIntent = rating(100);
  model.hiddenSafety.situationalAwareness = rating(90);
  lab.safety.practicalControlStrength = rating(5);
  lab.safety.securityPosture = rating(5);
  lab.safety.evalQuality = rating(5);
  return draft;
}

function setFrontierCapability(
  state: DeepMutable<GameState>,
  frontierCapability: number,
): ModelId {
  const modelId = state.labs[state.run.playerLabId]?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (model === undefined) throw new Error("fixture missing");
  // These tests exercise dangerous autonomy before formal candidacy. At the
  // candidate frontier, keep embodiment below the breadth gate and compensate
  // across the other traits so the requested weighted FC remains exact.
  const embodiment = frontierCapability >= 88 ? 79 : frontierCapability;
  const otherTrait =
    frontierCapability >= 88
      ? (frontierCapability - 0.03 * embodiment) / 0.97
      : frontierCapability;
  model.trueCapability = {
    language: rating(otherTrait),
    reasoning: rating(otherTrait),
    agency: rating(otherTrait),
    toolUse: rating(otherTrait),
    multimodality: rating(otherTrait),
    scientificAbility: rating(otherTrait),
    embodiment: rating(embodiment),
  };
  return model.id;
}

function escalations(state: GameState) {
  return state.labs[state.run.playerLabId]?.autonomy.escalations ?? [];
}

function step(state: GameState): GameState {
  const tx = createTransaction(state);
  advanceAutonomyEscalation(tx, content, new RandomOracleV1(state.run.seed));
  finaliseEndedRun(tx, content);
  const stepped = tx.commit({ description: "autonomy escalation step" }).state;
  // Each probe step is a distinct week, so the weekly draw is a fresh key.
  const draft = structuredClone(stepped) as DeepMutable<GameState>;
  draft.run.tick = tick(draft.run.tick + 1);
  draft.run.calendar = calendarFromTick(draft.run.tick);
  return draft;
}

function eventOptionCashCostMillions(definitionId: string, optionId: string): number {
  const definition = content.events.definitions[contentId(definitionId)];
  const option = definition?.options.find((candidate) => candidate.id === optionId);
  if (option === undefined) throw new Error(`Missing ${definitionId}/${optionId}`);
  return option.knownCosts.reduce(
    (total, effect) =>
      effect.kind === "add-resource" && effect.resource === "cash" && effect.amount < 0
        ? total - effect.amount
        : total,
    0,
  );
}

describe("the autonomy escalation engine", () => {
  it("prices paid containment responses at billion scale", () => {
    expect({
      sandbox: eventOptionCashCostMillions(
        "base:event.autonomy.experiments",
        "sandbox-harder",
      ),
      patch: eventOptionCashCostMillions(
        "base:event.autonomy.intrusion",
        "patch-in-place",
      ),
      audit: eventOptionCashCostMillions(
        "base:event.autonomy.intrusion",
        "revoke-and-audit",
      ),
      race: eventOptionCashCostMillions(
        "base:event.autonomy.exfiltration",
        "race-the-copy",
      ),
      sever: eventOptionCashCostMillions(
        "base:event.autonomy.exfiltration",
        "sever-the-link",
      ),
      lockdown: eventOptionCashCostMillions(
        "base:event.autonomy.infrastructure",
        "pull-physical-breakers",
      ),
    }).toEqual({
      sandbox: 2_000,
      patch: 4_000,
      audit: 10_000,
      race: 8_000,
      sever: 12_000,
      lockdown: 25_000,
    });
  });

  it("makes the Artifactory response a real safety-versus-velocity trade-off", () => {
    const definition =
      content.events.definitions[contentId("base:event.autonomy.intrusion")];
    if (definition === undefined) throw new Error("Missing autonomy intrusion event");
    const option = (id: string) => {
      const found = definition.options.find((candidate) => candidate.id === id);
      if (found === undefined) throw new Error(`Missing autonomy intrusion option ${id}`);
      return found;
    };
    const resourceChange = (id: string, resource: "cash" | "aura-spendable") => {
      const effect = [...option(id).knownCosts, ...option(id).immediateEffects].find(
        (effect) => effect.kind === "add-resource" && effect.resource === resource,
      );
      return effect?.kind === "add-resource" ? effect.amount : undefined;
    };
    const modifier = (id: string, target: string) =>
      option(id).immediateEffects.find(
        (effect) => effect.kind === "add-modifier" && effect.target === target,
      );

    expect(resourceChange("revoke-and-audit", "cash")).toBe(-10_000);
    expect(resourceChange("revoke-and-audit", "aura-spendable")).toBe(-15);
    expect(modifier("revoke-and-audit", "lab.research.all.output")).toMatchObject({
      value: 0.9,
      durationWeeks: 26,
    });
    expect(modifier("revoke-and-audit", "lab.incident.hazard")).toMatchObject({
      value: 0.5,
      durationWeeks: 52,
    });

    // A quiet fix is quiet: nobody outside the lab hears, so nothing public
    // moves. The cost is internal, and the interface says so.
    expect(resourceChange("patch-in-place", "cash")).toBe(-4_000);
    expect(resourceChange("patch-in-place", "aura-spendable")).toBeUndefined();
    expect(modifier("patch-in-place", "lab.incident.hazard")).toMatchObject({
      value: 1.25,
      durationWeeks: 26,
    });

    // Reading a rival's servers earns their research, not applause. Public
    // standing must not rise for a theft the public is not told about.
    expect(
      option("keep-shipping").immediateEffects.find(
        (effect) =>
          effect.kind === "add-resource" && effect.resource === "aura-spendable",
      ),
    ).toBeUndefined();
    expect(modifier("keep-shipping", "lab.research.all.output")).toMatchObject({
      value: 1.25,
      durationWeeks: 26,
    });
    expect(modifier("keep-shipping", "lab.incident.hazard")).toMatchObject({
      value: 2,
      durationWeeks: 52,
    });
  });

  it.each([
    {
      stage: "experiments" as const,
      definitionId: "base:event.autonomy.experiments",
      optionId: "pull-access",
      startingAccess: 4 as const,
    },
    {
      stage: "intrusion" as const,
      definitionId: "base:event.autonomy.intrusion",
      optionId: "revoke-and-audit",
      startingAccess: 5 as const,
    },
    {
      stage: "exfiltration" as const,
      definitionId: "base:event.autonomy.exfiltration",
      optionId: "sever-the-link",
      startingAccess: 5 as const,
    },
    {
      stage: "infrastructure" as const,
      definitionId: "base:event.autonomy.infrastructure",
      optionId: "pull-physical-breakers",
      startingAccess: 5 as const,
    },
  ])(
    "applies the $stage two-level rollback and year-long lock immediately",
    ({ stage, definitionId, optionId, startingAccess }) => {
      const state = dangerousState(startingAccess);
      const lab = state.labs[state.run.playerLabId];
      const modelId = lab?.models.currentModelId;
      if (lab === undefined || modelId === undefined) throw new Error("fixture missing");
      lab.finance.cash = cashMillions(100_000);
      const model = state.models[modelId];
      if (model === undefined) throw new Error("fixture missing");
      if (model.measuredCapability === undefined) {
        throw new Error("fixture lacks measured capability");
      }
      model.measuredCapability.frontierCapability = rating(100);
      const escalationId = `autonomy:test:${stage}`;
      lab.autonomy.escalations.push({
        id: escalationId,
        stage,
        modelId,
        detectedAt: state.run.tick,
        status: "pending-event",
      });

      const opening = createTransaction(state);
      reconcileAutonomyModifiers(opening, state.run.playerLabId);
      const instanceId = instantiateEvent(opening, content, contentId(definitionId), {
        source: "mandatory",
        triggerKey: `autonomy-escalation:${escalationId}`,
        tokens: {
          ESCALATION_ID: escalationId,
          MODEL_NAME: model.displayName,
          MODEL_ID: modelId,
        },
      });
      const opened = opening.commit({ description: `open ${stage} response` }).state;
      const installedGpusBefore = opened.labs[
        opened.run.playerLabId
      ]?.compute.lots.reduce((total, lot) => total + lot.physicalCount, 0);
      const outputBefore = Object.values(opened.modifiers).find(
        (modifier) =>
          modifier.tags.includes(AUTONOMY_MODIFIER_TAG) &&
          modifier.target === "lab.research.all.output",
      )?.value;
      expect(outputBefore).toBeDefined();

      const resolved = applyCommand(opened, content, {
        kind: "respond-to-decision-event",
        meta: {
          commandId: `command:rollback-${stage}` as CommandId,
          expectedTick: opened.run.tick,
          issuedBy: "player",
        },
        instanceId,
        optionId,
      }).state;
      const resolvedLab = resolved.labs[resolved.run.playerLabId];
      const resolvedModel = resolved.models[modelId];
      const outputAfter = Object.values(resolved.modifiers).find(
        (modifier) =>
          modifier.tags.includes(AUTONOMY_MODIFIER_TAG) &&
          modifier.target === "lab.research.all.output",
      )?.value;

      expect(resolvedModel?.accessLevel).toBe(
        stage === "infrastructure" ? 0 : startingAccess - 2,
      );
      expect(resolvedLab?.autonomy.accessIncreaseLockedUntil).toBe(
        resolved.run.tick + AUTONOMY_ACCESS_ROLLBACK_LOCK_WEEKS,
      );
      expect(
        resolvedLab?.autonomy.escalations.find((entry) => entry.id === escalationId),
      ).toMatchObject({ status: "resolved", responseTag: "rolled-back" });
      if (stage !== "infrastructure") {
        expect(outputAfter).toBeDefined();
        expect(outputAfter).toBeLessThan(outputBefore ?? 0);
      } else {
        const installedGpusAfter = resolvedLab?.compute.lots.reduce(
          (total, lot) => total + lot.physicalCount,
          0,
        );
        expect(resolved.run.status).toBe("active");
        expect(installedGpusBefore).toBeGreaterThan(0);
        expect(installedGpusAfter).toBeGreaterThanOrEqual(
          Math.floor((installedGpusBefore ?? 0) * 0.45),
        );
        expect(installedGpusAfter).toBeLessThanOrEqual(
          Math.ceil((installedGpusBefore ?? 0) * 0.55),
        );
        // GPUs are ordered and counted in thousands everywhere else, so the
        // loss lands on the same grid -- both the total and each surviving lot.
        expect((installedGpusBefore ?? 0) - (installedGpusAfter ?? 0)).toBe(
          Math.round(((installedGpusBefore ?? 0) - (installedGpusAfter ?? 0)) / 1_000) *
            1_000,
        );
        for (const lot of resolvedLab?.compute.lots ?? []) {
          expect(lot.physicalCount % 1_000).toBe(0);
          expect(lot.physicalCount).toBeGreaterThanOrEqual(0);
        }
        expect(
          resolved.presentationQueue.find(
            (item) =>
              item.kind === "model-incident-result" &&
              item.key.includes("autonomy-emergency-contained"),
          ),
        ).toMatchObject({
          kind: "model-incident-result",
          threatLabel: "EMERGENCY SHUTDOWN HELD",
          hardwareGpusDestroyed: (installedGpusBefore ?? 0) - (installedGpusAfter ?? 0),
        });
      }
    },
  );

  it("poses no hazard below supervised-tools access", () => {
    const state = newState();
    expect(autonomyHazard(state, state.run.playerLabId)).toBe(0);
    const advanced = step(state);
    expect(escalations(advanced)).toHaveLength(0);
  });

  it("raises hazard with access, deception, and weak defences", () => {
    const safeLab = dangerousState(2);
    const rootLab = dangerousState(5);
    const safeHazard = autonomyHazard(safeLab, safeLab.run.playerLabId);
    const rootHazard = autonomyHazard(rootLab, rootLab.run.playerLabId);
    expect(rootHazard).toBeGreaterThan(safeHazard);
    // A starting lab's modest defences divide the menace, so the fixture
    // lands below the old headline; strip defence and it comes back.
    expect(rootHazard).toBeGreaterThan(0.4);
    const undefended = dangerousState(5);
    const bareLab = undefended.labs[undefended.run.playerLabId];
    if (bareLab === undefined) throw new Error("fixture missing");
    bareLab.safety.practicalControlStrength = rating(0);
    bareLab.safety.securityPosture = rating(0);
    for (const programme of Object.values(bareLab.research.safetyPrograms)) {
      programme.level = rating(0);
    }
    expect(autonomyHazard(undefended, undefended.run.playerLabId)).toBeGreaterThan(0.5);

    const defended = dangerousState(5);
    const lab = defended.labs[defended.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    lab.safety.practicalControlStrength = rating(95);
    lab.safety.securityPosture = rating(95);
    expect(autonomyHazard(defended, defended.run.playerLabId)).toBeLessThan(rootHazard);
  });

  it("defence divides the hazard and can never erase it", () => {
    // The old subtractive defence term could reach literal zero: a maxed-out
    // lab ran a moderately misaligned model at root with no escalation risk
    // at all, in a game whose whole claim is that you cannot be sure. Now
    // maximum defence cuts the menace to a third and the floor stays strictly
    // above zero -- even for a saint of a model, root access keeps a residual
    // accident rate.
    const state = dangerousState(5);
    const lab = state.labs[state.run.playerLabId];
    const model = state.models[lab?.models.currentModelId ?? ("" as never)];
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    lab.safety.practicalControlStrength = rating(100);
    lab.safety.securityPosture = rating(100);
    const interpretability = lab.research.safetyPrograms["base:safety.alignment-control"];
    const containment = lab.research.safetyPrograms["base:safety.security-containment"];
    if (interpretability !== undefined) interpretability.level = rating(100);
    if (containment !== undefined) containment.level = rating(100);

    // A modestly misaligned model: exactly the profile the old formula let a
    // fortress lab run for free.
    model.hiddenSafety.deceptiveCapability = rating(40);
    model.hiddenSafety.deceptiveIntent = rating(40);
    model.hiddenSafety.situationalAwareness = rating(50);
    model.hiddenSafety.trueAlignment = rating(55);
    model.trueCapability.agency = rating(60);
    const modest = autonomyHazard(state, state.run.playerLabId);
    expect(modest).toBeGreaterThan(0);

    // And even a fully aligned model at root never rounds to perfectly safe.
    model.hiddenSafety.deceptiveCapability = rating(0);
    model.hiddenSafety.deceptiveIntent = rating(0);
    model.hiddenSafety.situationalAwareness = rating(0);
    model.hiddenSafety.trueAlignment = rating(100);
    model.trueCapability.agency = rating(0);
    const saint = autonomyHazard(state, state.run.playerLabId);
    expect(saint).toBeGreaterThan(0);
    expect(saint).toBeLessThan(modest);
  });

  it("climbs the ladder one rung at a time, never skipping a stage", () => {
    let state: GameState = dangerousState(5);
    const seen: string[] = [];
    const recorded = new Set<string>();
    for (let index = 0; index < 60 && state.run.status === "active"; index += 1) {
      state = step(state);
      for (const escalation of escalations(state)) {
        if (!recorded.has(escalation.id)) {
          recorded.add(escalation.id);
          seen.push(escalation.stage);
        }
      }
      // Clear the pending gate so the next rung can fire in this probe.
      const draft = structuredClone(state) as DeepMutable<GameState>;
      const lab = draft.labs[draft.run.playerLabId];
      if (lab !== undefined) {
        for (const escalation of lab.autonomy.escalations) {
          if (escalation.status === "pending-event") escalation.status = "resolved";
        }
      }
      state = draft;
    }
    expect(seen.length).toBeGreaterThan(0);
    const order = ["experiments", "intrusion", "exfiltration", "infrastructure"];
    for (let index = 0; index < seen.length; index += 1) {
      expect(seen[index]).toBe(order[index]);
    }
  });

  it("does not inherit a predecessor's escalation rung or pending incident", () => {
    let state: GameState = dangerousState(5);
    const draft = state as DeepMutable<GameState>;
    const lab = draft.labs[draft.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    lab.autonomy.escalations.push({
      id: "autonomy:predecessor:infrastructure",
      stage: "infrastructure",
      modelId: "run:model:retired" as ModelId,
      detectedAt: draft.run.tick,
      status: "pending-event",
    });

    for (let index = 0; index < 60; index += 1) {
      state = step(state);
      const currentModelId = state.labs[state.run.playerLabId]?.models.currentModelId;
      const currentEscalation = escalations(state).find(
        (entry) => entry.modelId === currentModelId,
      );
      if (currentEscalation !== undefined) {
        expect(currentEscalation.stage).toBe("experiments");
        return;
      }
    }
    throw new Error("current model never produced an escalation");
  });

  it("forces the next move after two missed escalations", () => {
    const state = dangerousState(5);
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    lab.autonomy.undetectedPressure = 2;
    const advanced = step(state);
    const currentModelId = advanced.labs[advanced.run.playerLabId]?.models.currentModelId;
    expect(
      escalations(advanced).find((entry) => entry.modelId === currentModelId),
    ).toMatchObject({
      stage: "experiments",
      status: "ignored",
    });
  });

  it("records escaped weights the first time exfiltration happens", () => {
    let state: GameState = dangerousState(5);
    for (let index = 0; index < 80 && state.run.status === "active"; index += 1) {
      state = step(state);
      const lab = state.labs[state.run.playerLabId];
      if (lab?.autonomy.escapedWeightsAt !== undefined) break;
      const draft = structuredClone(state) as DeepMutable<GameState>;
      const mutableLab = draft.labs[draft.run.playerLabId];
      if (mutableLab !== undefined) {
        for (const escalation of mutableLab.autonomy.escalations) {
          if (escalation.status === "pending-event") escalation.status = "resolved";
        }
      }
      state = draft;
    }
    const lab = state.labs[state.run.playerLabId];
    const reachedExfiltration = (lab?.autonomy.escalations ?? []).some(
      (escalation) => escalation.stage === "exfiltration",
    );
    if (reachedExfiltration) {
      expect(lab?.autonomy.escapedWeightsAt).toBeDefined();
    }
  });

  it("always surfaces a world-infrastructure breach before catastrophe resolves", () => {
    const state = dangerousState(5);
    const modelId = setFrontierCapability(state, 88);
    const lab = state.labs[state.run.playerLabId];
    const model = state.models[modelId];
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    model.flags["accepted-high-risk-access"] = true;
    lab.autonomy.escapedWeightsAt = state.run.tick;
    lab.autonomy.undetectedPressure = 2;
    lab.autonomy.escalations.push({
      id: "autonomy:test:missed-exfiltration",
      stage: "exfiltration",
      modelId,
      detectedAt: state.run.tick,
      status: "ignored",
    });

    const advanced = step(state);
    expect(advanced.run.status).toBe("active");
    expect(advanced.run.endingId).toBeUndefined();
    expect(
      escalations(advanced).find((entry) => entry.stage === "infrastructure"),
    ).toMatchObject({ modelId, status: "pending-event" });
    expect(advanced.models[modelId]?.flags["known-control-breach"]).toBe(true);
  });

  it("lets network severance contain the breach without ending the run", () => {
    const state = dangerousState(5);
    const modelId = setFrontierCapability(state, 88);
    const lab = state.labs[state.run.playerLabId];
    const model = state.models[modelId];
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    lab.safety.practicalControlStrength = rating(100);
    lab.safety.securityPosture = rating(100);
    model.hiddenSafety.deceptiveCapability = rating(0);
    model.hiddenSafety.deceptiveIntent = rating(0);
    model.hiddenSafety.situationalAwareness = rating(0);
    model.flags["accepted-high-risk-access"] = true;
    lab.finance.cash = cashMillions(100_000);
    lab.autonomy.escapedWeightsAt = state.run.tick;
    const escalationId = "autonomy:test:infrastructure-emergency";
    lab.autonomy.escalations.push({
      id: escalationId,
      stage: "infrastructure",
      modelId,
      detectedAt: state.run.tick,
      status: "pending-event",
    });
    const opening = createTransaction(state);
    const instanceId = instantiateEvent(
      opening,
      content,
      contentId("base:event.autonomy.infrastructure"),
      {
        source: "mandatory",
        triggerKey: `autonomy-escalation:${escalationId}`,
        tokens: {
          ESCALATION_ID: escalationId,
          MODEL_NAME: model.displayName,
          MODEL_ID: modelId,
        },
      },
    );
    const opened = opening.commit({ description: "open infrastructure emergency" }).state;
    const resolved = applyCommand(opened, content, {
      kind: "respond-to-decision-event",
      meta: {
        commandId: "command:sever-infrastructure" as CommandId,
        expectedTick: opened.run.tick,
        issuedBy: "player",
      },
      instanceId,
      optionId: "sever-networks",
    }).state;

    expect(resolved.run.status).toBe("active");
    expect(resolved.models[modelId]?.accessLevel).toBe(0);
    expect(resolved.models[modelId]?.deployment.policy).toBe("internal-only");
    expect(resolved.labs[resolved.run.playerLabId]?.autonomy.escapedWeightsAt).toBe(
      undefined,
    );
    expect(
      resolved.presentationQueue.some(
        (item) =>
          item.kind === "model-incident-result" &&
          item.key.includes("autonomy-emergency-contained"),
      ),
    ).toBe(true);
  });

  it("confines a sandboxed model to overreach it can physically manage", () => {
    let state: GameState = dangerousState(2);
    // Supervised-tools hazard is only ~3%/week, so give the ladder a long
    // window: the point is what it never reaches, not how fast it starts.
    for (let index = 0; index < 200 && state.run.status === "active"; index += 1) {
      state = step(state);
      const draft = structuredClone(state) as DeepMutable<GameState>;
      const lab = draft.labs[draft.run.playerLabId];
      if (lab !== undefined) {
        for (const escalation of lab.autonomy.escalations) {
          if (escalation.status === "pending-event") escalation.status = "resolved";
        }
      }
      state = draft;
    }
    const stages = new Set(escalations(state).map((entry) => entry.stage));
    expect(stages.size).toBeGreaterThan(0);
    // Supervised tools cannot reach the weights, let alone the power grid.
    expect(stages.has("exfiltration")).toBe(false);
    expect(stages.has("infrastructure")).toBe(false);
  });

  it("never leaks hidden deception into the believed detection rate", () => {
    const plain = dangerousState(3);
    const sneaky = dangerousState(3);
    const plainId = plain.labs[plain.run.playerLabId]?.models.currentModelId;
    if (plainId !== undefined) {
      const model = plain.models[plainId];
      if (model !== undefined) model.hiddenSafety.deceptiveCapability = rating(0);
    }
    // The believed rate is what the panel shows; it must not move with a
    // hidden stat, or the player can read the model's secrets off the UI.
    expect(autonomyBelievedDetectionChance(plain)).toBe(
      autonomyBelievedDetectionChance(sneaky),
    );
    // The true rate, which only the engine sees, must still move.
    expect(autonomyDetectionChance(sneaky)).toBeLessThan(autonomyDetectionChance(plain));
  });

  it("makes a deceptive model harder to catch", () => {
    const plain = dangerousState(3);
    const plainModel = plain.labs[plain.run.playerLabId]?.models.currentModelId;
    if (plainModel !== undefined) {
      const model = plain.models[plainModel];
      if (model !== undefined) model.hiddenSafety.deceptiveCapability = rating(10);
    }
    // dangerousState already sets deception to 90.
    const sneaky = dangerousState(3);
    expect(autonomyDetectionChance(sneaky)).toBeLessThan(autonomyDetectionChance(plain));
  });

  it("scales detection with evaluation quality", () => {
    const blind = dangerousState(3);
    const seeing = dangerousState(3);
    const lab = seeing.labs[seeing.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    lab.safety.evalQuality = rating(95);
    lab.safety.practiceXp = rating(100);
    const evaluations = lab.research.safetyPrograms["base:safety.interpretability-evals"];
    if (evaluations === undefined) throw new Error("Evaluation programme missing");
    evaluations.level = rating(100);
    expect(autonomyDetectionChance(seeing)).toBeGreaterThan(
      autonomyDetectionChance(blind),
    );
  });

  it("turns sub-AGI escape into capability-scaled nonterminal fallout", () => {
    for (const [capability, category, severity] of [
      [20, "serious", 45],
      [45, "major", 68],
      [65, "critical", 84],
      [87, "critical", 84],
    ] as const) {
      const state = dangerousState(5);
      const modelId = setFrontierCapability(state, capability);
      const lab = state.labs[state.run.playerLabId];
      const model = state.models[modelId];
      if (lab === undefined || model === undefined) throw new Error("fixture missing");
      model.flags["accepted-high-risk-access"] = true;
      lab.autonomy.escapedWeightsAt = state.run.tick;
      const auraBefore = lab.aura.spendable;
      const cashBefore = lab.finance.cash;
      const expected =
        capability < 30
          ? { aura: 10, cash: 2_000, research: 0.95, duration: 26 }
          : capability < 60
            ? { aura: 25, cash: 10_000, research: 0.9, duration: 52 }
            : { aura: 50, cash: 30_000, research: 0.9, duration: undefined };
      const tx = createTransaction(state);
      resolveAutonomyEscapeOutcome(
        tx,
        content,
        new RandomOracleV1(state.run.seed),
        state.run.playerLabId,
        modelId,
        "infrastructure",
      );
      const result = tx.commit({
        description: `sub-AGI autonomy fallout ${String(capability)}`,
      });
      const incident = result.state.incidents.find(
        (candidate) => candidate.key === `autonomy-fallout:${modelId}:infrastructure`,
      );
      expect(result.state.run.status).toBe("active");
      expect(result.state.run.endingId).toBeUndefined();
      expect(incident).toMatchObject({
        modelId,
        category,
        observedSeverity: severity,
        catastropheLegal: false,
      });
      expect(incident?.audit).toContain(`frontierCapability=${capability.toFixed(3)}`);
      const resultLab = result.state.labs[state.run.playerLabId];
      expect(resultLab?.aura.spendable).toBe(Math.max(0, auraBefore - expected.aura));
      expect(resultLab?.finance.cash).toBeCloseTo(cashBefore - expected.cash, 5);
      const complianceModifiers = Object.values(result.state.modifiers).filter(
        (modifier) =>
          modifier.source.id === incident?.key &&
          modifier.tags.includes("incident-compliance-drag"),
      );
      expect(complianceModifiers).toHaveLength(1);
      expect(complianceModifiers[0]).toMatchObject({
        value: expected.research,
        ...(expected.duration === undefined
          ? {}
          : { endsAt: state.run.tick + expected.duration }),
      });
      expect(
        result.state.presentationQueue.find(
          (item) => item.key === `model-incident-result:${incident?.key ?? "missing"}`,
        ),
      ).toMatchObject({
        kind: "model-incident-result",
        emergencyOutcome: "failed",
        auraLoss: Math.min(auraBefore, expected.aura),
        fineMillions: expected.cash,
        researchOutputMultiplier: expected.research,
      });
      expect(
        result.state.decisionLog.some(
          (entry) =>
            entry.source?.kind === "system" &&
            entry.source.id === `autonomy-fallout:${modelId}:infrastructure`,
        ),
      ).toBe(true);
    }
  });

  it("keeps a sub-AGI exfiltration nonterminal", () => {
    const state = dangerousState(5);
    const modelId = setFrontierCapability(state, 87);
    const model = state.models[modelId];
    if (model === undefined) throw new Error("fixture missing");
    model.flags["accepted-high-risk-access"] = true;

    const tx = createTransaction(state);
    resolveAutonomyEscapeOutcome(
      tx,
      content,
      new RandomOracleV1(state.run.seed),
      state.run.playerLabId,
      modelId,
      "exfiltration",
    );
    const result = tx.commit({ description: "sub-AGI exfiltration fallout" }).state;

    expect(result.run.status).toBe("active");
    expect(result.run.endingId).toBeUndefined();
    expect(result.incidents.at(-1)).toMatchObject({
      key: `autonomy-fallout:${modelId}:exfiltration`,
      category: "critical",
      observedSeverity: 78,
      catastropheLegal: false,
    });
  });

  it("applies capability-scaled fallout and its shared consequences only once", () => {
    const state = dangerousState(5);
    const modelId = setFrontierCapability(state, 65);
    const model = state.models[modelId];
    if (model === undefined) throw new Error("fixture missing");
    model.flags["accepted-high-risk-access"] = true;
    const tx = createTransaction(state);
    const resolve = (): void =>
      resolveAutonomyEscapeOutcome(
        tx,
        content,
        new RandomOracleV1(state.run.seed),
        state.run.playerLabId,
        modelId,
        "infrastructure",
      );

    resolve();
    resolve();
    const result = tx.commit({ description: "idempotent autonomy fallout" }).state;
    const key = `autonomy-fallout:${modelId}:infrastructure`;

    expect(result.incidents.filter((incident) => incident.key === key)).toHaveLength(1);
    expect(
      result.labs[result.run.playerLabId]?.aura.ledger.filter(
        (entry) => entry.source.id === key && entry.category === "incident",
      ),
    ).toHaveLength(1);
    expect(
      Object.values(result.modifiers).filter(
        (modifier) =>
          modifier.source.id === key &&
          modifier.tags.includes("incident-compliance-drag"),
      ),
    ).toHaveLength(1);
  });

  it("requires the shared warning guard before an autonomy ending", () => {
    const state = dangerousState(5);
    const modelId = setFrontierCapability(state, 88);
    const lab = state.labs[state.run.playerLabId];
    const model = state.models[modelId];
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    lab.autonomy.escapedWeightsAt = state.run.tick;

    const withoutWarning = createTransaction(state);
    resolveAutonomyEscapeOutcome(
      withoutWarning,
      content,
      new RandomOracleV1(state.run.seed),
      state.run.playerLabId,
      modelId,
      "infrastructure",
    );
    const contained = withoutWarning.commit({
      description: "autonomy ending rejected without warning",
    }).state;
    expect(contained.run.status).toBe("active");
    expect(contained.incidents.at(-1)).toMatchObject({
      category: "critical",
      catastropheLegal: false,
    });
    expect(contained.incidents.at(-1)?.audit).toContain(
      "failedConditions=warning-or-control-breach",
    );

    model.flags["accepted-high-risk-access"] = true;
    for (const [stage, endingId] of [
      ["exfiltration", "base:ending.the-replication-threshold"],
      ["infrastructure", "base:ending.a-war-measured-in-milliseconds"],
    ] as const) {
      const eligible = structuredClone(state);
      const tx = createTransaction(eligible);
      resolveAutonomyEscapeOutcome(
        tx,
        content,
        new RandomOracleV1(eligible.run.seed),
        eligible.run.playerLabId,
        modelId,
        stage,
      );
      finaliseEndedRun(tx, content);
      const result = tx.commit({ description: `autonomy ending ${stage}` });
      expect(result.state.run.status).toBe("lost");
      expect(result.state.run.endingId).toBe(contentId(endingId));
      expect(result.state.presentationQueue[0]).toMatchObject({
        kind: "model-incident-result",
        emergencyOutcome: "failed",
        terminalOutcome: true,
      });
      expect(result.state.incidents).toContainEqual(
        expect.objectContaining({
          key: `autonomy-catastrophe:${modelId}:${stage}`,
          category: "catastrophe",
          catastropheLegal: true,
        }),
      );
    }
  });

  it("records a legal autonomy catastrophe only once", () => {
    const state = dangerousState(5);
    const modelId = setFrontierCapability(state, 88);
    const model = state.models[modelId];
    if (model === undefined) throw new Error("fixture missing");
    model.flags["accepted-high-risk-access"] = true;
    const tx = createTransaction(state);

    resolveAutonomyEscapeOutcome(
      tx,
      content,
      new RandomOracleV1(state.run.seed),
      state.run.playerLabId,
      modelId,
      "infrastructure",
    );
    resolveAutonomyEscapeOutcome(
      tx,
      content,
      new RandomOracleV1(state.run.seed),
      state.run.playerLabId,
      modelId,
      "infrastructure",
    );
    finaliseEndedRun(tx, content);
    const result = tx.commit({ description: "idempotent autonomy catastrophe" }).state;
    const key = `autonomy-catastrophe:${modelId}:infrastructure`;

    expect(result.incidents.filter((incident) => incident.key === key)).toHaveLength(1);
    expect(
      result.domainLog.filter((entry) =>
        entry.code.startsWith(`autonomy-catastrophe:${modelId}:infrastructure:`),
      ),
    ).toHaveLength(1);
  });

  it("does not reopen the infrastructure rung after its fallout is recorded", () => {
    const state = dangerousState(5);
    const modelId = setFrontierCapability(state, 65);
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    lab.autonomy.escalations.push({
      id: "autonomy:existing:infrastructure",
      stage: "infrastructure",
      modelId,
      detectedAt: state.run.tick,
      status: "ignored",
    });
    const advanced = step(state);
    expect(
      escalations(advanced).filter(
        (escalation) =>
          escalation.modelId === modelId && escalation.stage === "infrastructure",
      ),
    ).toHaveLength(1);
  });

  it("stays quiet during the Deployment Crisis, which owns its own ladder", () => {
    const crisis = structuredClone(
      advanceOneTick(createEndgamePlaytestState(content), content).state,
    ) as DeepMutable<GameState>;
    const lab = crisis.labs[crisis.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : crisis.models[modelId];
    if (lab === undefined || model === undefined) throw new Error("fixture missing");
    model.accessLevel = 5;
    if (model.candidateArtifact !== undefined) {
      model.candidateArtifact.maximumAccessEver = 5;
    }
    if (crisis.aiCharacter !== undefined) crisis.aiCharacter.currentAccess = 5;
    model.hiddenSafety.trueAlignment = rating(10);
    model.hiddenSafety.deceptiveCapability = rating(90);
    model.hiddenSafety.deceptiveIntent = rating(100);
    expect(crisis.endgame.stage).not.toBe("inactive");
    const advanced = step(crisis);
    expect(escalations(advanced)).toHaveLength(0);
  });

  it("keeps a granted model's escalations flowing through the normal tick", () => {
    let state: GameState = dangerousState(5);
    let sawEscalation = false;
    for (let index = 0; index < 12 && state.run.status === "active"; index += 1) {
      state = advanceOneTick(state, content).state;
      if (escalations(state).length > 0) {
        sawEscalation = true;
        break;
      }
    }
    expect(sawEscalation).toBe(true);
  });
});
