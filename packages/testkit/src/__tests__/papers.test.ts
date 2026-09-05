import { describe, expect, it } from "vitest";

import { contentId } from "@neolab/content-schema";
import {
  advanceOneTick,
  advancePaperRace,
  applyCommand,
  createSaveEnvelope,
  createTransaction,
  describePaperScientificPayload,
  describePaperUnlockEffect,
  derivePaperBreakthroughChance,
  deriveRivalPublicationChance,
  labKnowsPaper,
  listEligiblePapers,
  loadSaveEnvelope,
  rating,
  paperMechanicalBenefits,
  reconcilePaperBenefits,
  resolveModifierValue,
  stableStringify,
  stateHash,
  tick,
  validateCommand,
  type CommandId,
  type DeepMutable,
  type GameState,
  type LabId,
  type RandomOracle,
} from "@neolab/sim";

import { scenario, scenarioContent } from "../scenario.ts";

const content = scenarioContent();
const backprop = contentId("base:paper.backpropagation");
const wienerSafetyPaper = contentId("base:paper.moral-technical-consequences-automation");
const alignmentControl = contentId("base:safety.alignment-control");
const architectures = contentId("base:domain.architectures");
const optimisation = contentId("base:domain.optimisation-scaling");
const alwaysBreakthroughOracle: RandomOracle = {
  uniform: () => 0,
  integer: (_key, minimum) => minimum,
  triangular: (_key, minimum) => minimum,
  weighted: (_key, weights) => Object.keys(weights).sort()[0] as never,
  shuffle: (_key, values) => [...values],
};

function mutable(state: GameState): DeepMutable<GameState> {
  return structuredClone(state) as DeepMutable<GameState>;
}

function withPlayerWorldFirst(policyPaperId = backprop): DeepMutable<GameState> {
  const state = mutable(scenario().build());
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("player lab missing");
  lab.research.discoveredPaperIds.push(policyPaperId);
  state.world.paperRace.discoveries[policyPaperId] = {
    paperId: policyPaperId,
    discovererLabId: state.run.playerLabId,
    discoveredAt: state.run.tick,
  };
  return state;
}

describe("compiled paper catalogue", () => {
  it("contains a substantial sourced real-paper set and deterministic graph indexes", () => {
    const papers = Object.values(content.papers.definitions);
    const realPapers = papers.filter((paper) => paper.historicity === "real");
    expect(realPapers.length).toBeGreaterThanOrEqual(10);
    for (const paper of papers) {
      expect(
        Object.values(paper.domainWeights).reduce((sum, weight) => sum + weight, 0),
      ).toBeCloseTo(1, 10);
      expect(paper.education.archiveExplanation.length).toBeGreaterThan(300);
    }
    for (const paper of realPapers) {
      expect(paper.authors.length).toBeGreaterThan(0);
      expect(paper.publicationYear).toBeGreaterThan(1900);
      expect(paper.primarySourceUrl).toMatch(/^https:\/\//);
    }
    expect(content.papers.graph.reverseUnlocks[backprop]?.length).toBeGreaterThan(5);
    expect(content.papers.graph.papersByDomain["base:domain.architectures"]).toContain(
      contentId("base:paper.transformer"),
    );
    expect(content.papers.graph.papersByDomain[alignmentControl]).toContain(
      wienerSafetyPaper,
    );
    // The transformer is a 2017 paper. It was frontier-gated only because the
    // compiler shifted authored phase names up by one, which is what put 91 of
    // 134 papers out of reach; it now sits in scaling where its date puts it.
    expect(content.papers.graph.earliestReachablePhase["base:paper.transformer"]).toBe(
      "scaling",
    );
    expect(content.papers.graph.realHistoryDisplayOrder).toContain(backprop);
    const displayYears = content.papers.graph.realHistoryDisplayOrder.map(
      (paperId) => content.papers.definitions[paperId]?.publicationYear ?? 0,
    );
    expect(displayYears).toEqual([...displayYears].sort((left, right) => left - right));
  });

  it("derives every displayed direct benefit from a real, non-zero effect", () => {
    for (const paper of Object.values(content.papers.definitions)) {
      const benefits = paperMechanicalBenefits(paper);
      const labels = benefits.map(describePaperUnlockEffect);
      expect(describePaperScientificPayload(paper)).toBe(
        labels.length === 0 ? "No additional mechanical unlocks" : labels.join("; "),
      );
      for (const effect of benefits) {
        expect(effect.target).not.toMatch(/^research\.family\./);
        expect(
          effect.operation === "add" &&
            typeof effect.value === "number" &&
            effect.value === 0,
        ).toBe(false);
        expect(
          effect.operation === "multiply" &&
            typeof effect.value === "number" &&
            effect.value === 1,
        ).toBe(false);
      }
      for (const label of labels) {
        expect(label).not.toMatch(/\b(?:base|lab|world|prosperity)\s*:/i);
        expect(label).not.toContain("research.family");
      }
    }
  });

  it("preserves an authored any-paper prerequisite as an any predicate", () => {
    const gan = content.papers.definitions["base:paper.generative-adversarial-nets"];
    expect(gan).toBeDefined();
    expect(gan?.prerequisites.kind).toBe("all");
    if (gan?.prerequisites.kind !== "all") return;
    const anyPrerequisite = gan.prerequisites.items.find(
      (prerequisite) => prerequisite.kind === "any",
    );
    expect(anyPrerequisite?.kind).toBe("any");
    if (anyPrerequisite?.kind === "any") {
      expect(anyPrerequisite.items.length).toBeGreaterThan(1);
    }
  });
});

describe("level-gated paper breakthroughs", () => {
  it("keeps the exact level and breakthrough chance out of canonical state", () => {
    const state = mutable(scenario().build());
    const lab = state.labs[state.run.playerLabId];
    const paper = content.papers.definitions[backprop];
    if (lab === undefined || paper === undefined)
      throw new Error("paper fixture missing");
    const architectureState = lab.research.domains[architectures];
    const optimisationState = lab.research.domains[optimisation];
    if (architectureState === undefined || optimisationState === undefined) {
      throw new Error("paper programme fixture missing");
    }
    architectureState.level = rating(0);
    optimisationState.level = rating(0);
    expect(
      derivePaperBreakthroughChance(state, content, state.run.playerLabId, backprop),
    ).toBe(0);
    architectureState.level = rating(paper.breakthroughRequirement.level);
    optimisationState.level = rating(3);
    expect(
      derivePaperBreakthroughChance(state, content, state.run.playerLabId, backprop),
    ).toBe(content.papers.rules.breakthroughChance.basePerWeek);
    expect(JSON.stringify(state)).not.toContain("paperBreakthrough");
  });

  it("lists only papers whose paper, level, and phase prerequisites are met", () => {
    const state = mutable(scenario().build());
    const lab = state.labs[state.run.playerLabId];
    const paper = content.papers.definitions[backprop];
    if (lab === undefined || paper === undefined)
      throw new Error("paper fixture missing");
    const architectureState = lab.research.domains[architectures];
    const optimisationState = lab.research.domains[optimisation];
    if (architectureState === undefined || optimisationState === undefined) {
      throw new Error("paper programme fixture missing");
    }
    architectureState.level = rating(0);
    optimisationState.level = rating(0);
    expect(
      listEligiblePapers(state, content, state.run.playerLabId).map(
        (candidate) => candidate.paperId,
      ),
    ).not.toContain(backprop);
    architectureState.level = rating(paper.breakthroughRequirement.level);
    optimisationState.level = rating(3);
    const eligible = listEligiblePapers(state, content, state.run.playerLabId).map(
      (paper) => paper.paperId,
    );
    expect(eligible).toContain(backprop);
    expect(eligible).not.toContain(contentId("base:paper.transformer"));
    expect(eligible).not.toContain(contentId("base:paper.lenet-document-recognition"));
  });

  it("makes and advances safety landmarks through safety-programme research", () => {
    const state = mutable(scenario().build());
    const lab = state.labs[state.run.playerLabId];
    const alignment = lab?.research.safetyPrograms[alignmentControl];
    if (lab === undefined || alignment === undefined) {
      throw new Error("player safety programme missing");
    }
    const safetyPaper = content.papers.definitions[wienerSafetyPaper];
    if (safetyPaper === undefined) throw new Error("safety paper missing");
    alignment.level = rating(safetyPaper.breakthroughRequirement.level);

    expect(
      listEligiblePapers(state, content, state.run.playerLabId).map(
        (paper) => paper.paperId,
      ),
    ).toContain(wienerSafetyPaper);

    const tx = createTransaction(state);
    advancePaperRace(tx, content, alwaysBreakthroughOracle);
    const result = tx.commit({ description: "advance safety paper race" });

    expect(
      result.state.labs[state.run.playerLabId]?.research.discoveredPaperIds,
    ).toContain(wienerSafetyPaper);
  });
});

describe("paper race resolution", () => {
  it.each([
    "0123456789abcdef0123456789abcdef",
    "fedcba9876543210fedcba9876543210",
  ] as const)(
    "resolves a simultaneous threshold crossing in run-shuffled order for seed %s",
    (seed) => {
      const state = mutable(scenario().withSeed(seed).build());
      const expectedFirst = state.world.paperRace.labOrder[0];
      const paper = content.papers.definitions[backprop];
      if (expectedFirst === undefined) throw new Error("paper order missing");
      if (paper === undefined) throw new Error("backprop paper missing");
      for (const labId of state.world.paperRace.labOrder) {
        const lab = state.labs[labId as LabId];
        if (lab === undefined) throw new Error(`paper lab ${labId} missing`);
        const architectureState = lab.research.domains[architectures];
        const optimisationState = lab.research.domains[optimisation];
        if (architectureState === undefined || optimisationState === undefined) {
          throw new Error(`paper programmes missing for ${labId}`);
        }
        architectureState.level = rating(paper.breakthroughRequirement.level);
        optimisationState.level = rating(3);
      }

      const tx = createTransaction(state);
      advancePaperRace(tx, content, alwaysBreakthroughOracle);
      const result = tx.commit({ description: "forced simultaneous paper race" });
      expect(result.state.world.paperRace.labOrder[0]).toBe(expectedFirst);
      expect(result.state.world.paperRace.discoveries[backprop]?.discovererLabId).toBe(
        expectedFirst,
      );
      for (const labId of state.world.paperRace.labOrder) {
        expect(labKnowsPaper(result.state, labId, backprop)).toBe(true);
      }
      // World-first credit is now resolved by publication, not awarded before
      // the discoverer decides whether the result is public.
      if (expectedFirst === state.run.playerLabId) {
        expect(
          result.state.score.entries.some((entry) => entry.key.includes(backprop)),
        ).toBe(false);
      }
    },
  );

  // The slowest test in the suite, and deliberately without a per-test timeout:
  // it is exactly the one that wants the project's full ceiling rather than a
  // tighter local one. See vitest.shared.ts for why that number is what it is.
  it("runs a seeded player/rival catalogue race byte-identically", () => {
    const run = (): GameState => {
      let state = scenario()
        .withSeed("0123456789abcdef0123456789abcdef")
        .withPlayerLab((lab) => lab.cash(10_000).gpus("gpu.kepler", 10_000))
        .build();
      let commandIndex = 0;
      for (let week = 0; week < 180; week += 1) {
        const player = state.labs[state.run.playerLabId];
        if (player === undefined) throw new Error("player lab missing");
        const trainingActive = player.projects.projectIds.some((projectId) => {
          const project = state.projects[projectId];
          return (
            project?.kind === "training" &&
            !["completed", "cancelled", "failed"].includes(project.status)
          );
        });
        if (player.models.modelIds.length < 3 && !trainingActive) {
          state = applyCommand(state, content, {
            kind: "start-training-run",
            meta: {
              commandId: `command:stage-3-training:${String(commandIndex)}` as CommandId,
              expectedTick: state.run.tick,
              issuedBy: "player",
            },
            labId: state.run.playerLabId,
            posture: "normal",
          }).state;
          commandIndex += 1;
        }
        state = advanceOneTick(state, content).state;
        for (const discovery of Object.values(state.world.paperRace.discoveries)) {
          if (
            discovery.discovererLabId === state.run.playerLabId &&
            discovery.publicationPolicy === undefined
          ) {
            state = applyCommand(state, content, {
              kind: "choose-publication-policy",
              meta: {
                commandId: `command:paper-policy:${String(commandIndex)}` as CommandId,
                expectedTick: state.run.tick,
                issuedBy: "player",
              },
              labId: state.run.playerLabId,
              paperId: discovery.paperId,
              policy: "publish-openly",
            }).state;
            commandIndex += 1;
          }
        }
      }
      return state;
    };
    const first = run();
    const second = run();
    expect(stableStringify(first)).toBe(stableStringify(second));
    expect(stateHash(first)).toBe(stateHash(second));
    expect(
      first.labs[first.run.playerLabId]?.models.modelIds.length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      Object.keys(content.papers.definitions).filter((paperId) =>
        labKnowsPaper(first, first.run.playerLabId, contentId(paperId)),
      ).length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      Object.keys(first.world.rivals).some(
        (labId) =>
          (first.labs[labId as LabId]?.research.discoveredPaperIds.length ?? 0) >= 3,
      ),
    ).toBe(true);
    expect(first.world.paperRace.rival.discoveredPaperIds).toHaveLength(0);
    expect(Object.keys(first.world.paperRace.discoveries).length).toBeGreaterThanOrEqual(
      5,
    );
    expect(
      Object.values(first.world.paperRace.discoveries).every(
        (discovery) => discovery.publicationPolicy !== undefined,
      ),
    ).toBe(true);
    expect(
      first.score.entries.some(
        (entry) =>
          entry.key.startsWith("paper/world-first/") ||
          entry.key.startsWith("paper/rediscovery/"),
      ),
    ).toBe(true);

    const envelope = createSaveEnvelope(first, {
      saveId: "paper-golden",
      slotType: "manual",
      displayName: "Paper race",
      contentHash: content.manifest.bundleHash,
      nowIso: "2026-07-21T12:00:00.000Z",
    });
    const loaded = loadSaveEnvelope(JSON.parse(JSON.stringify(envelope))).state;
    expect(stateHash(loaded)).toBe(stateHash(first));
  });
});

describe("publication and secrecy", () => {
  it("makes ordinary rival publication progressively less likely as the race matures", () => {
    const state = mutable(scenario().build());
    const rivalId = Object.keys(state.world.rivals).sort()[0] as LabId | undefined;
    if (rivalId === undefined) throw new Error("rival strategy missing");
    const rival = state.world.rivals[rivalId];
    if (rival === undefined) throw new Error("rival strategy missing");
    rival.personality.secrecy = rating(50);

    state.run.phase = "foundation";
    expect(deriveRivalPublicationChance(state, rivalId)).toBe(0.92);
    state.run.phase = "scaling";
    expect(deriveRivalPublicationChance(state, rivalId)).toBe(0.76);
    state.run.phase = "frontier";
    expect(deriveRivalPublicationChance(state, rivalId)).toBe(0.36);
    state.run.phase = "crisis";
    expect(deriveRivalPublicationChance(state, rivalId)).toBe(0.16);

    rival.personality.secrecy = rating(80);
    expect(deriveRivalPublicationChance(state, rivalId)).toBeLessThan(0.16);
  });

  it("presents publication as a sharp prestige-versus-exclusivity choice", () => {
    const state = withPlayerWorldFirst();
    const command = (
      policy: "publish-openly" | "keep-secret",
    ): Parameters<typeof validateCommand>[2] => ({
      kind: "choose-publication-policy",
      meta: {
        commandId: `command:policy-preview:${policy}` as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      paperId: backprop,
      policy,
    });

    const publish = validateCommand(state, content, command("publish-openly"));
    const secret = validateCommand(state, content, command("keep-secret"));

    expect(publish.ok && publish.preview.summary).toContain(
      "Every lab immediately receives",
    );
    expect(publish.ok && publish.preview.summary).toContain("cannot be rediscovered");
    expect(publish.ok && publish.preview.summary).toContain(
      "No additional mechanical unlocks",
    );
    expect(secret.ok && secret.preview.summary).toContain(
      "Every other lab must independently rediscover the paper",
    );
    expect(secret.ok && secret.preview.summary).toContain("grants 0 Aura");
  });

  const cases = [
    ["publish-openly", 10, 1_100],
    ["controlled-publication", 6, 1_050],
    ["keep-secret", 0, 0],
    ["release-everything", 14, 1_100],
  ] as const;

  it.each(cases)(
    "%s applies its prestige and immediate-publication state",
    (policy, auraGain, scoreAward) => {
      const state = withPlayerWorldFirst();
      const auraBefore = state.labs[state.run.playerLabId]?.aura.spendable ?? 0;
      const result = applyCommand(state, content, {
        kind: "choose-publication-policy",
        meta: {
          commandId: `command:policy:${policy}` as CommandId,
          expectedTick: state.run.tick,
          issuedBy: "player",
        },
        labId: state.run.playerLabId,
        paperId: backprop,
        policy,
      });
      expect(result.state.labs[state.run.playerLabId]?.aura.spendable).toBe(
        auraBefore + auraGain,
      );
      expect(result.state.world.paperRace.discoveries[backprop]).toMatchObject({
        publicationPolicy: policy,
      });
      const paperScore = result.state.score.entries
        .filter((entry) => entry.key.includes(backprop))
        .reduce((sum, entry) => sum + entry.amount, 0);
      expect(paperScore).toBe(scoreAward);
      for (const labId of result.state.world.paperRace.labOrder) {
        expect(labKnowsPaper(result.state, labId, backprop)).toBe(
          policy !== "keep-secret" || labId === state.run.playerLabId,
        );
      }
    },
  );

  it("keeps numerical paper benefits lab-scoped under secrecy and shares them on publication", () => {
    const perceptron = contentId("base:paper.perceptron");
    const target = "lab.research.program.base:domain.architectures.output";
    const secretState = withPlayerWorldFirst(perceptron);
    const rivalId = secretState.world.paperRace.labOrder.find(
      (labId) => labId !== secretState.run.playerLabId,
    ) as LabId | undefined;
    if (rivalId === undefined) throw new Error("rival paper lab missing");
    const secret = applyCommand(secretState, content, {
      kind: "choose-publication-policy",
      meta: {
        commandId: "command:perceptron-secret" as CommandId,
        expectedTick: secretState.run.tick,
        issuedBy: "player",
      },
      labId: secretState.run.playerLabId,
      paperId: perceptron,
      policy: "keep-secret",
    }).state;
    expect(
      resolveModifierValue(secret, target, 1, {
        labId: secret.run.playerLabId,
        includeUnscoped: false,
      }).final,
    ).toBeCloseTo(1.02);
    expect(
      resolveModifierValue(secret, target, 1, {
        labId: rivalId,
        includeUnscoped: false,
      }).final,
    ).toBe(1);

    const publicState = withPlayerWorldFirst(perceptron);
    const published = applyCommand(publicState, content, {
      kind: "choose-publication-policy",
      meta: {
        commandId: "command:perceptron-public" as CommandId,
        expectedTick: publicState.run.tick,
        issuedBy: "player",
      },
      labId: publicState.run.playerLabId,
      paperId: perceptron,
      policy: "publish-openly",
    }).state;
    expect(
      resolveModifierValue(published, target, 1, {
        labId: rivalId,
        includeUnscoped: false,
      }).final,
    ).toBeCloseTo(1.02);
  });

  it("applies safety-culture paper benefits as real ratings, not inert starting flags", () => {
    const paperId = contentId("base:paper.concrete-problems-in-ai-safety");
    const state = withPlayerWorldFirst(paperId);
    const paper = content.papers.definitions[paperId];
    const before = state.labs[state.run.playerLabId]?.safety.safetyCulture;
    if (before === undefined || paper === undefined) {
      throw new Error("safety culture fixture missing");
    }
    const result = applyCommand(state, content, {
      kind: "choose-publication-policy",
      meta: {
        commandId: "command:safety-paper-secret" as CommandId,
        expectedTick: state.run.tick,
        issuedBy: "player",
      },
      labId: state.run.playerLabId,
      paperId,
      policy: "keep-secret",
    }).state;
    expect(result.labs[state.run.playerLabId]?.safety.safetyCulture).toBe(before + 3);
    expect(describePaperScientificPayload(paper, "private")).toContain(
      "Safety culture +3",
    );
  });

  it("gives a secret-paper rediscovery reduced prestige and no policy choice", () => {
    const perceptron = contentId("base:paper.perceptron");
    const state = mutable(scenario().build());
    const rivalId = state.world.paperRace.labOrder.find(
      (labId) => labId !== state.run.playerLabId,
    ) as LabId | undefined;
    if (rivalId === undefined) throw new Error("rival paper lab missing");
    const rivalStrategy = state.world.rivals[rivalId];
    if (rivalStrategy === undefined) throw new Error("rival strategy missing");
    rivalStrategy.personality.secrecy = rating(100);
    state.world.paperRace.labOrder = [
      rivalId,
      state.run.playerLabId,
      ...state.world.paperRace.labOrder.filter(
        (labId) => labId !== rivalId && labId !== state.run.playerLabId,
      ),
    ];
    for (const lab of Object.values(state.labs)) {
      const architecture = lab.research.domains[architectures];
      if (architecture !== undefined) architecture.level = rating(10);
    }
    const auraBefore = state.labs[state.run.playerLabId]?.aura.spendable ?? 0;
    const tx = createTransaction(state);
    advancePaperRace(tx, content, alwaysBreakthroughOracle);
    const result = tx.commit({ description: "secret paper rediscovery" });

    expect(result.state.world.paperRace.discoveries[perceptron]?.publicationPolicy).toBe(
      "keep-secret",
    );
    expect(
      result.state.labs[state.run.playerLabId]?.research.discoveredPaperIds,
    ).toContain(perceptron);
    expect(result.state.labs[state.run.playerLabId]?.aura.spendable).toBe(auraBefore + 1);
    expect(
      result.state.score.entries.find(
        (entry) => entry.key === `paper/rediscovery/${perceptron}`,
      )?.amount,
    ).toBe(80);
    const policyAttempt = validateCommand(result.state, content, {
      kind: "choose-publication-policy",
      meta: {
        commandId: "command:rediscovery-policy-attempt" as CommandId,
        expectedTick: result.state.run.tick,
        issuedBy: "player",
      },
      labId: result.state.run.playerLabId,
      paperId: perceptron,
      policy: "publish-openly",
    });
    expect(policyAttempt.ok).toBe(false);
  });

  it("makes a rival publication public immediately without a player rediscovery", () => {
    const state = mutable(scenario().build());
    const player = state.labs[state.run.playerLabId];
    if (player === undefined) throw new Error("player lab missing");
    const multimodality = player.research.domains["base:domain.multimodality"];
    const architectures = player.research.domains["base:domain.architectures"];
    const lenet = content.papers.definitions["base:paper.lenet-document-recognition"];
    if (
      multimodality === undefined ||
      architectures === undefined ||
      lenet === undefined
    ) {
      throw new Error("required research domains missing");
    }
    multimodality.level = rating(lenet.breakthroughRequirement.level);
    architectures.level = rating(6);
    const rivalId = state.world.paperRace.labOrder.find(
      (labId) => labId !== state.run.playerLabId,
    );
    if (rivalId === undefined) throw new Error("rival paper lab missing");
    const rival = state.labs[rivalId as LabId];
    if (rival === undefined) throw new Error("canonical rival lab missing");
    rival.research.discoveredPaperIds.push(backprop);
    state.world.paperRace.discoveries[backprop] = {
      paperId: backprop,
      discovererLabId: rivalId,
      discoveredAt: tick(0),
      publicationPolicy: "publish-openly",
      policyChosenAt: tick(0),
    };
    const tx = createTransaction(state);
    reconcilePaperBenefits(tx, content);
    const result = tx.commit({ description: "reconcile immediate publication" });

    expect(labKnowsPaper(result.state, state.run.playerLabId, backprop)).toBe(true);
    expect(
      result.state.labs[state.run.playerLabId]?.research.discoveredPaperIds,
    ).not.toContain(backprop);
    expect(
      result.state.labs[state.run.playerLabId]?.research.diffusionKnowledge[backprop],
    ).toBeUndefined();
    expect(result.state.score.entries).toHaveLength(0);
    expect(
      listEligiblePapers(result.state, content, state.run.playerLabId).map(
        (paper) => paper.paperId,
      ),
    ).toContain(contentId("base:paper.lenet-document-recognition"));
  });
});
