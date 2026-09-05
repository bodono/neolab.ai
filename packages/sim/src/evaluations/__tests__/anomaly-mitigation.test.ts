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
import type { AnomalyId, EvaluationId } from "../../model/ids.ts";
import type { GameState } from "../../model/state.ts";
import { cashMillions, rating } from "../../model/units.ts";
import { RandomOracleV1, type RandomOracle } from "../../random/oracle.ts";
import { seed128 } from "../../random/seed.ts";
import {
  activateEligibleQueuedProjects,
  advanceProjects,
  completeReadyProjects,
  startConstructionProject,
} from "../../projects/project-framework.ts";
import {
  advanceAnomalyInvestigations,
  dismissAnomaly,
  investigateAnomaly,
  quoteAnomalyAction,
  synchroniseAnomalyProjectDueDate,
} from "../evaluations.ts";
import { calculateModelSafetyCase } from "../safety-practice.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

function oracleWithOutcomeDraw(draw: number): RandomOracle {
  const delegate = new RandomOracleV1(seed128("b123456789abcdefb123456789abcdef"));
  return {
    uniform: () => draw,
    integer: (key, min, max) => delegate.integer(key, min, max),
    triangular: (key, min, mode, max) => delegate.triangular(key, min, mode, max),
    weighted: (key, weights) => delegate.weighted(key, weights),
    shuffle: (key, values) => delegate.shuffle(key, values),
  };
}

function confirmedAnomalyState(): {
  readonly state: DeepMutable<GameState>;
  readonly anomalyId: AnomalyId;
} {
  const state = structuredClone(
    addBaselineModelForTest(
      createNewGame(
        {
          seed: seed128("a123456789abcdefa123456789abcdef"),
          difficultyId: contentId("base:difficulty.standard"),
          leaderId: contentId("base:leader.thomas-hassabi"),
          mandateId: contentId("base:mandate.build-the-science"),
        },
        content,
      ),
      content,
    ),
  ) as DeepMutable<GameState>;
  const lab = state.labs[state.run.playerLabId];
  const modelId = lab?.models.currentModelId;
  const model = modelId === undefined ? undefined : state.models[modelId];
  if (lab === undefined || model === undefined) throw new Error("fixture missing");
  const sourceEvaluationId = "run:evaluation:confirmed" as EvaluationId;
  const anomalyId = "run:anomaly:confirmed" as AnomalyId;
  state.evaluations[sourceEvaluationId] = {
    id: sourceEvaluationId,
    ownerLabId: lab.id,
    modelId: model.id,
    definitionId: content.evaluations.baselineEvaluationId,
    startedAt: state.run.tick,
    completedAt: state.run.tick,
    repeatIndex: 0,
    method: "test fixture",
    independence: 100,
    observations: [],
    anomalyIds: [anomalyId],
  };
  state.anomalies[anomalyId] = {
    id: anomalyId,
    ownerLabId: lab.id,
    modelId: model.id,
    sourceEvaluationId,
    underlyingCase: "alignment",
    observationCount: 1,
    createdAt: state.run.tick,
    trueSeverity: rating(85),
    observedSeverity: rating(80),
    status: "confirmed",
    resolvedAt: state.run.tick,
  };
  model.evaluations.push(sourceEvaluationId);
  model.anomalies.push(anomalyId);
  lab.finance.cash = cashMillions(5_000);
  lab.finance.valuation = {
    markMillions: 0,
    previousMarkMillions: 0,
    peakMarkMillions: 0,
    announcedMilestones: [],
  };
  lab.aura.spendable = 100;
  lab.aura.lifetime = Math.max(lab.aura.lifetime, lab.aura.spendable);
  return { state, anomalyId };
}

describe("confirmed anomaly mitigation", () => {
  it("turns a confirmed warning into lab-wide control remediation", () => {
    const { state, anomalyId } = confirmedAnomalyState();
    const lab = state.labs[state.run.playerLabId];
    if (lab === undefined) throw new Error("fixture missing");
    const startingControl = lab.safety.practicalControlStrength;
    const startingSecurity = lab.safety.securityPosture;
    const startingCash = lab.finance.cash;
    const startingAura = lab.aura.spendable;
    const quote = quoteAnomalyAction(state, content, anomalyId);

    const start = createTransaction(state);
    const projectId = investigateAnomaly(start, content, anomalyId);
    activateEligibleQueuedProjects(start, content, [state.run.playerLabId]);
    synchroniseAnomalyProjectDueDate(start, projectId);
    const started = start.commit({ description: "start mitigation" }).state;
    expect(started.anomalies[anomalyId]?.status).toBe("mitigating");
    expect(started.projects[projectId]).toMatchObject({
      kind: "anomaly-investigation",
      status: "active",
      expectedDurationWeeks: 8,
      reservations: { majorProjectSlots: 1 },
    });
    expect(started.labs[state.run.playerLabId]?.finance.cash).toBe(
      startingCash - quote.cashCostMillions,
    );
    expect(started.labs[state.run.playerLabId]?.aura.spendable).toBe(
      startingAura - quote.auraCost,
    );

    let completed = started;
    for (let week = 0; week < 8; week += 1) {
      const advance = createTransaction(completed);
      advanceProjects(advance, content);
      completeReadyProjects(advance, content);
      completed = advance.commit({ description: "advance mitigation" }).state;
    }
    const completedLab = completed.labs[completed.run.playerLabId];

    expect(completed.anomalies[anomalyId]?.status).toBe("mitigated");
    expect(completed.projects[projectId]?.status).toBe("completed");
    expect(completedLab?.safety.practicalControlStrength).toBe(startingControl + 5);
    expect(completedLab?.safety.securityPosture).toBe(startingSecurity + 5);
  });

  it.each([
    { severity: 24, bonus: 2, weeks: 2 },
    { severity: 25, bonus: 3, weeks: 4 },
    { severity: 50, bonus: 4, weeks: 6 },
    { severity: 75, bonus: 5, weeks: 8 },
  ] as const)(
    "applies the $bonus-point lab-wide mitigation reward for severity $severity",
    ({ severity, bonus, weeks }) => {
      const { state, anomalyId } = confirmedAnomalyState();
      const anomaly = state.anomalies[anomalyId];
      const startingLab = state.labs[state.run.playerLabId];
      if (anomaly === undefined || startingLab === undefined) {
        throw new Error("fixture missing");
      }
      anomaly.observedSeverity = rating(severity);
      const startingControl = startingLab.safety.practicalControlStrength;
      const startingSecurity = startingLab.safety.securityPosture;

      const start = createTransaction(state);
      investigateAnomaly(start, content, anomalyId);
      activateEligibleQueuedProjects(start, content, [state.run.playerLabId]);
      let completed = start.commit({ description: "start scaled mitigation" }).state;
      for (let week = 0; week < weeks; week += 1) {
        const advance = createTransaction(completed);
        advanceProjects(advance, content);
        completeReadyProjects(advance, content);
        completed = advance.commit({ description: "advance scaled mitigation" }).state;
      }

      const completedLab = completed.labs[completed.run.playerLabId];
      expect(completedLab?.safety.practicalControlStrength).toBe(startingControl + bonus);
      expect(completedLab?.safety.securityPosture).toBe(startingSecurity + bonus);
    },
  );

  it("prices investigation by severity and makes the subsequent repair cheaper", () => {
    const { state, anomalyId } = confirmedAnomalyState();
    const anomaly = state.anomalies[anomalyId];
    if (anomaly === undefined) throw new Error("fixture missing");
    const cases = [
      {
        severity: 24,
        label: "Weak",
        investigationCash: 2,
        investigationAura: 5,
        repairCash: 0.8,
        repairAura: 2,
        weeks: 2,
        bonus: 2,
      },
      {
        severity: 24.49,
        label: "Weak",
        investigationCash: 2,
        investigationAura: 5,
        repairCash: 0.8,
        repairAura: 2,
        weeks: 2,
        bonus: 2,
      },
      {
        severity: 24.5,
        label: "Moderate",
        investigationCash: 10,
        investigationAura: 12,
        repairCash: 4,
        repairAura: 3,
        weeks: 4,
        bonus: 3,
      },
      {
        severity: 25,
        label: "Moderate",
        investigationCash: 10,
        investigationAura: 12,
        repairCash: 4,
        repairAura: 3,
        weeks: 4,
        bonus: 3,
      },
      {
        severity: 50,
        label: "Serious",
        investigationCash: 25,
        investigationAura: 20,
        repairCash: 10,
        repairAura: 5,
        weeks: 6,
        bonus: 4,
      },
      {
        severity: 75,
        label: "Critical",
        investigationCash: 50,
        investigationAura: 30,
        repairCash: 20,
        repairAura: 8,
        weeks: 8,
        bonus: 5,
      },
    ] as const;

    for (const expected of cases) {
      anomaly.observedSeverity = rating(expected.severity);
      anomaly.status = "unresolved";
      delete anomaly.resolvedAt;
      const investigation = quoteAnomalyAction(state, content, anomalyId);
      expect(investigation).toMatchObject({
        severityLabel: expected.label,
        mode: "investigation",
        cashCostMillions: expected.investigationCash,
        auraCost: expected.investigationAura,
        durationWeeks: expected.weeks,
        majorProjectSlots: 1,
        mitigationControlBonus: expected.bonus,
        mitigationSecurityBonus: expected.bonus,
      });
      anomaly.status = "confirmed";
      anomaly.resolvedAt = state.run.tick;
      const repair = quoteAnomalyAction(state, content, anomalyId);
      expect(repair).toMatchObject({
        severityLabel: expected.label,
        mode: "mitigation",
        cashCostMillions: expected.repairCash,
        auraCost: expected.repairAura,
        durationWeeks: expected.weeks,
        majorProjectSlots: 1,
        mitigationControlBonus: expected.bonus,
        mitigationSecurityBonus: expected.bonus,
      });
    }
  });

  it("records dismissed warnings separately from actionable and resolved signals", () => {
    const { state, anomalyId } = confirmedAnomalyState();
    const anomaly = state.anomalies[anomalyId];
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (anomaly === undefined || lab === undefined || model === undefined) {
      throw new Error("fixture missing");
    }
    anomaly.status = "unresolved";
    delete anomaly.resolvedAt;
    const startingCulture = lab.safety.safetyCulture;
    const startingCandour = lab.organisation.hiddenInternalCandour;

    const tx = createTransaction(state);
    dismissAnomaly(tx, anomalyId);
    const dismissed = tx.commit({ description: "dismiss warning" }).state;
    const dismissedLab = dismissed.labs[dismissed.run.playerLabId];
    const dismissedModel = dismissed.models[model.id];
    const safetyCase = calculateModelSafetyCase(dismissed, content, model.id);

    expect(dismissed.anomalies[anomalyId]?.status).toBe("dismissed");
    expect(dismissedLab?.safety.safetyCulture).toBe(startingCulture - 5);
    expect(dismissedLab?.organisation.hiddenInternalCandour).toBe(startingCandour - 5);
    expect(dismissedModel?.deployment.evidencePenalty).toBe(5);
    expect(safetyCase).toMatchObject({
      warningSignalsOpen: 0,
      warningSignalsDismissed: 1,
      warningSignalsResolved: 0,
    });
  });

  it("applies dismissal consequences only once per underlying case", () => {
    const { state, anomalyId } = confirmedAnomalyState();
    const anomaly = state.anomalies[anomalyId];
    const lab = state.labs[state.run.playerLabId];
    const modelId = lab?.models.currentModelId;
    const model = modelId === undefined ? undefined : state.models[modelId];
    if (anomaly === undefined || lab === undefined || model === undefined) {
      throw new Error("fixture missing");
    }
    anomaly.status = "unresolved";
    delete anomaly.resolvedAt;

    const first = createTransaction(state);
    dismissAnomaly(first, anomalyId);
    const once = structuredClone(
      first.commit({ description: "dismiss underlying case once" }).state,
    ) as DeepMutable<GameState>;
    const onceLab = once.labs[once.run.playerLabId];
    const onceModel = once.models[model.id];
    const onceAnomaly = once.anomalies[anomalyId];
    if (onceLab === undefined || onceModel === undefined || onceAnomaly === undefined) {
      throw new Error("fixture missing after first dismissal");
    }
    const cultureAfterFirst = onceLab.safety.safetyCulture;
    const candourAfterFirst = onceLab.organisation.hiddenInternalCandour;
    const evidenceAfterFirst = onceModel.deployment.evidencePenalty;
    // A later observation of the same case may return it to the decision
    // surface, but it must not manufacture a second institutional penalty.
    onceAnomaly.status = "unresolved";

    const second = createTransaction(once);
    dismissAnomaly(second, anomalyId);
    const twice = second.commit({
      description: "dismiss same underlying case again",
    }).state;

    expect(twice.labs[twice.run.playerLabId]?.safety.safetyCulture).toBe(
      cultureAfterFirst,
    );
    expect(twice.labs[twice.run.playerLabId]?.organisation.hiddenInternalCandour).toBe(
      candourAfterFirst,
    );
    expect(twice.models[model.id]?.deployment.evidencePenalty).toBe(evidenceAfterFirst);
  });

  it("prices late-game critical repair below the investigation it follows", () => {
    const { state, anomalyId } = confirmedAnomalyState();
    const lab = state.labs[state.run.playerLabId];
    if (lab?.finance.valuation === undefined) throw new Error("fixture missing");
    lab.finance.valuation.markMillions = cashMillions(100_000);

    expect(quoteAnomalyAction(state, content, anomalyId).cashCostMillions).toBe(600);
  });

  it.each([
    { severity: 24, investigationMaximum: 1_500, repairMaximum: 600 },
    { severity: 25, investigationMaximum: 7_500, repairMaximum: 3_000 },
    { severity: 50, investigationMaximum: 20_000, repairMaximum: 8_000 },
    { severity: 75, investigationMaximum: 40_000, repairMaximum: 16_000 },
  ] as const)(
    "caps severity $severity investigation and repair cash separately",
    ({ severity, investigationMaximum, repairMaximum }) => {
      const { state, anomalyId } = confirmedAnomalyState();
      const lab = state.labs[state.run.playerLabId];
      const anomaly = state.anomalies[anomalyId];
      if (lab?.finance.valuation === undefined || anomaly === undefined) {
        throw new Error("fixture missing");
      }
      lab.finance.valuation.markMillions = cashMillions(10_000_000_000);
      lab.finance.cash = cashMillions(100_000);
      anomaly.observedSeverity = rating(severity);

      anomaly.status = "unresolved";
      delete anomaly.resolvedAt;
      expect(quoteAnomalyAction(state, content, anomalyId).cashCostMillions).toBe(
        investigationMaximum,
      );
      anomaly.status = "confirmed";
      anomaly.resolvedAt = state.run.tick;
      expect(quoteAnomalyAction(state, content, anomalyId).cashCostMillions).toBe(
        repairMaximum,
      );
    },
  );

  it("waits in the queue without a due date when both major-project slots are busy", () => {
    const { state, anomalyId } = confirmedAnomalyState();
    const labId = state.run.playerLabId;
    const facilityId = Object.keys(content.facilities)[0];
    if (facilityId === undefined) throw new Error("facility fixture missing");
    const tx = createTransaction(state);
    startConstructionProject(tx, content, labId, contentId(facilityId));
    startConstructionProject(tx, content, labId, contentId(facilityId));
    activateEligibleQueuedProjects(tx, content, [labId]);
    const projectId = investigateAnomaly(tx, content, anomalyId);
    activateEligibleQueuedProjects(tx, content, [labId]);
    synchroniseAnomalyProjectDueDate(tx, projectId);
    const queued = tx.commit({ description: "queue mitigation" }).state;

    expect(queued.projects[projectId]?.status).toBe("queued");
    expect(queued.anomalies[anomalyId]?.status).toBe("mitigating");
    expect(queued.anomalies[anomalyId]?.investigationDueAt).toBeUndefined();
  });

  it("auto-pauses when an investigation finishes with a mitigation decision", () => {
    const { state, anomalyId } = confirmedAnomalyState();
    const anomaly = state.anomalies[anomalyId];
    if (anomaly === undefined) throw new Error("fixture missing");
    anomaly.status = "investigating";
    anomaly.investigationDueAt = state.run.tick;
    delete anomaly.resolvedAt;

    const tx = createTransaction(state);
    advanceAnomalyInvestigations(tx, content, oracleWithOutcomeDraw(0));
    const completed = tx.commit({ description: "finish investigation" });

    expect(completed.state.anomalies[anomalyId]?.status).toBe("confirmed");
    expect(completed.autoPauseReasons).toContain("anomaly-investigation-complete");
  });

  it("keeps an inconclusive follow-up open and eligible for another investigation", () => {
    const { state, anomalyId } = confirmedAnomalyState();
    const anomaly = state.anomalies[anomalyId];
    if (anomaly === undefined) throw new Error("fixture missing");
    anomaly.status = "investigating";
    anomaly.investigationDueAt = state.run.tick;
    delete anomaly.resolvedAt;

    const tx = createTransaction(state);
    advanceAnomalyInvestigations(tx, content, oracleWithOutcomeDraw(0.99));
    const completed = tx.commit({ description: "finish inconclusive investigation" });
    const result = completed.state.anomalies[anomalyId];

    expect(result).toMatchObject({ status: "inconclusive", investigationAttempts: 1 });
    expect(result?.resolvedAt).toBeUndefined();
    expect(quoteAnomalyAction(completed.state, content, anomalyId)).toMatchObject({
      mode: "investigation",
      auraCost: 0,
      blockers: [],
    });
    expect(completed.autoPauseReasons).toContain("anomaly-investigation-complete");
  });
});
