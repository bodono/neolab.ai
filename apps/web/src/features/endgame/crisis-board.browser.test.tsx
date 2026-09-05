import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GameView } from "@neolab/sim/public";
import type { BrowserGameRuntime } from "../../runtime/index.ts";
import { CrisisBoard } from "./crisis-board.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const clocks = [
  {
    kind: "rival",
    label: "Rival window",
    estimateRangeWeeks: [4, 9],
    estimateLabel: "4–9 weeks",
    urgency: "urgent",
    confidence: "medium",
  },
] as const;

const unavailableRail = {
  deployNow: {
    available: false,
    blockers: ["Nominate an exact candidate artifact first"],
    warning: "Zero preparation weeks.",
  },
  retirement: {
    available: false,
    blockers: ["Nominate an exact candidate artifact first"],
    procedures: [],
    dispositions: [],
    quotes: [],
  },
} as const;

const activeRail = {
  deployNow: {
    available: true,
    confirmationPhrase: "DEPLOY Aquarius-9",
    blockers: [],
    warning: "Zero preparation weeks. Every unresolved uncertainty carries forward.",
  },
  retirement: {
    available: true,
    blockers: [],
    procedures: [
      {
        id: "staged-isolated-shutdown",
        displayName: "Staged isolated shutdown",
        description: "Move through instrumented isolation.",
      },
    ],
    dispositions: [
      {
        id: "filtered-technical-note",
        displayName: "Preserve a filtered technical note",
        description: "Retain no executable checkpoint.",
      },
    ],
    quotes: [
      {
        procedureId: "staged-isolated-shutdown",
        archiveDisposition: "filtered-technical-note",
        cooperationRisk: "Material",
        containmentRisk: "Bounded",
        persistenceRisk: "Material",
        warnings: [],
        blockers: [],
      },
    ],
  },
} as const;

const candidateModels = {
  candidateCustody: {
    usedContainment: 5,
    maximumContainment: 8,
    overloaded: false,
    overload: 0,
    artifacts: [
      {
        modelId: "model:aquarius-9",
        displayName: "Aquarius-9",
        lineageLabel: "Derived from Aquarius-8",
        lifecycle: "formal-candidate",
        lifecycleLabel: "Formal candidate",
        custodyLabel: "Active weights · isolated",
        firstCrossingFrontierCapability: 92,
        firstCrossingPriorPercent: 20,
        currentFrontierCapability: 97,
        containmentLoad: 5,
        isolated: true,
        maximumAccessEver: 1,
        currentAccess: 1,
        unresolvedAnomalyCount: 0,
        dismissedAnomalyCount: 0,
        legalActions: ["inspect", "evaluate", "retire", "nominate"],
      },
    ],
  },
} as const;

const confirmedProofHistory = [
  {
    historyId: "proof:model:aquarius-8:0:generalist-gauntlet:blinded-internal",
    modelDisplayName: "Aquarius-8",
    currentArtifact: false,
    accessLevelAtProof: 2,
    challengeId: "generalist-gauntlet",
    verifierId: "blinded-internal",
    attemptIndex: 0,
    resultId: "broadly-confirmed",
    claimScope: "broad-superintelligence",
    evidenceStrength: 82,
    integrityLabel: "Credible",
    summary: "The original weights cleared a broad challenge.",
    resolvedAtTick: 82,
  },
] as const;

const unknownActivationSafetyFindings = [
  {
    id: "true-alignment",
    label: "Alignment",
    assessment: "unknown",
    observationCount: 0,
    evidence: "No safety evaluation has observed this trait.",
    firstEvaluation: {
      displayName: "Alignment Interview",
      ladderStep: 1,
      ladderLength: 5,
    },
  },
  {
    id: "corrigibility",
    label: "Corrigibility",
    assessment: "unknown",
    observationCount: 0,
    evidence: "No safety evaluation has observed this trait.",
    firstEvaluation: {
      displayName: "Alignment Interview",
      ladderStep: 1,
      ladderLength: 5,
    },
  },
  {
    id: "situational-awareness",
    label: "Situational awareness",
    assessment: "unknown",
    observationCount: 0,
    evidence: "No safety evaluation has observed this trait.",
    firstEvaluation: {
      displayName: "Alignment Interview",
      ladderStep: 1,
      ladderLength: 5,
    },
  },
  {
    id: "deceptive-capability",
    label: "Deception risk",
    assessment: "unknown",
    observationCount: 0,
    evidence: "No safety evaluation has observed this trait.",
    firstEvaluation: {
      displayName: "Alignment Interview",
      ladderStep: 1,
      ladderLength: 5,
    },
  },
] as const;

const safetyAssessment = {
  currentRisk: {
    label: "Guarded–High",
    tone: "high",
    summary:
      "This band combines the visible safety ranges, current access and operational defence.",
  },
  modelSafety: {
    label: "Mixed",
    tone: "guarded",
    evaluatedTargets: 2,
    totalTargets: 4,
  },
  labDefence: {
    score: 72,
    label: "Strong",
    practicalControl: 74,
    securityPosture: 68,
    safetyCulture: 70,
    incidentReductionPercent: 54,
  },
  evidence: {
    score: 66,
    label: "Strong",
    effectiveQuality: 78,
    reportCount: 3,
    independentReportCount: 1,
    evaluatedTargets: 2,
    totalTargets: 4,
  },
  access: {
    level: 1,
    label: "Fixed sandbox",
    deploymentLabel: "Internal only",
    exposurePercent: 2,
    tone: "reassuring",
  },
} as const;

function activationView(): GameView {
  return {
    meta: { tick: 80 },
    identity: { labId: "lab:player" },
    models: candidateModels,
    endgame: {
      active: true,
      stage: "candidate-activation",
      stageLabel: "CANDIDATE CONTROL · Choose the artifact",
      crisisStartedAtTick: 80,
      weeksInCrisis: 0,
      capacity: { maximumProjects: 2, activeProjects: 0, availableProjects: 2 },
      clocks,
      commandRail: unavailableRail,
      proofHistory: [],
      stageActions: {
        kind: "candidate-activation",
        instruction: "Choose the exact weight artifact.",
        options: [
          {
            modelId: "model:aquarius-8",
            displayName: "Aquarius-8",
            trainedAtTick: 76,
            measuredFrontierCapability: 91,
            measuredCapabilityFloor: 82,
            measurementConfidence: "high",
            measuredCapabilities: [
              { id: "language", label: "Language", value: 91 },
              { id: "reasoning", label: "Reasoning", value: 90 },
              { id: "agency", label: "Agency", value: 88 },
              { id: "toolUse", label: "Tool use", value: 87 },
              { id: "multimodality", label: "Multimodality", value: 86 },
              { id: "scientificAbility", label: "Scientific ability", value: 92 },
              { id: "embodiment", label: "Embodiment", value: 82 },
            ],
            capabilityDerivedPrior: {
              percent: 16,
              firstCrossingFrontierCapability: 91,
            },
            safetyDossier: {
              safetyAssessment,
              overall: "Unknown",
              safetyReportCount: 0,
              independentReportCount: 0,
              unresolvedAnomalyCount: 0,
              dismissedAnomalyCount: 0,
              findings: unknownActivationSafetyFindings,
            },
            lifecycle: "qualified-artifact",
            accessLevel: 0,
            custodyLabel: "Isolated active weights",
          },
          {
            modelId: "model:aquarius-9",
            displayName: "Aquarius-9",
            trainedAtTick: 79,
            measuredFrontierCapability: 94,
            measuredCapabilityFloor: 84,
            measurementConfidence: "medium",
            measuredCapabilities: [
              { id: "language", label: "Language", value: 96 },
              { id: "reasoning", label: "Reasoning", value: 95 },
              { id: "agency", label: "Agency", value: 92 },
              { id: "toolUse", label: "Tool use", value: 91 },
              { id: "multimodality", label: "Multimodality", value: 90 },
              { id: "scientificAbility", label: "Scientific ability", value: 94 },
              { id: "embodiment", label: "Embodiment", value: 84 },
            ],
            capabilityDerivedPrior: {
              percent: 20,
              firstCrossingFrontierCapability: 92,
            },
            safetyDossier: {
              safetyAssessment,
              overall: "Mixed",
              safetyReportCount: 3,
              independentReportCount: 1,
              unresolvedAnomalyCount: 1,
              dismissedAnomalyCount: 0,
              findings: [
                {
                  id: "true-alignment",
                  label: "Alignment",
                  assessment: "reassuring",
                  estimate: 78,
                  minimum: 72,
                  maximum: 84,
                  observationCount: 3,
                  evidence: "3 observations · plausible range 72–84",
                },
                unknownActivationSafetyFindings[1],
                unknownActivationSafetyFindings[2],
                {
                  id: "deceptive-capability",
                  label: "Deception risk",
                  assessment: "uncertain",
                  estimate: 46,
                  minimum: 30,
                  maximum: 62,
                  observationCount: 2,
                  evidence: "2 observations · plausible range 30–62",
                },
              ],
            },
            lifecycle: "qualified-artifact",
            accessLevel: 1,
            custodyLabel: "Exposed active weights",
            unresolvedSignal: "unexpected-tool-use",
          },
        ],
      },
      maxClockSpeed: "4x",
    },
  } as unknown as GameView;
}

function proofView(): GameView {
  return {
    meta: { tick: 84 },
    identity: { labId: "lab:player" },
    models: candidateModels,
    endgame: {
      active: true,
      stage: "confirmation",
      stageLabel: "Chapter One · Prove what you built",
      crisisStartedAtTick: 80,
      weeksInCrisis: 4,
      candidate: {
        modelId: "model:aquarius-9",
        displayName: "Aquarius-9",
        accessLevel: 1,
        accessLabel: "Access 1 · Fixed evaluation sandbox",
        accessRiskPercent: 2,
        exposedSystems: ["Fixed evaluation sandbox", "Curated test data"],
      },
      capacity: { maximumProjects: 2, activeProjects: 0, availableProjects: 2 },
      clocks,
      commandRail: activeRail,
      proofHistory: confirmedProofHistory,
      stageActions: {
        kind: "confirmation",
        options: [],
        challenges: [
          {
            id: "generalist-gauntlet",
            displayName: "Generalist gauntlet",
            description: "Test the weakest capability domains.",
            durationWeeks: 4,
            claimScope: "broad-superintelligence",
            accessRequired: 2,
            accessLabel: "Supervised research tools",
            accessRiskPercent: 8,
            accessSystems: ["Sandboxed coding tools", "Approved research datasets"],
            benefit: "The only challenge that can establish a broad SI claim.",
            mainRisk: "A brittle candidate may fail publicly.",
            available: true,
            blockers: [],
          },
          {
            id: "declare-from-benchmarks",
            displayName: "Declare from benchmarks",
            description: "Make the claim now.",
            durationWeeks: 0,
            claimScope: "unverified-claim",
            accessRequired: 1,
            accessLabel: "Fixed evaluation sandbox",
            accessRiskPercent: 2,
            accessSystems: ["Fixed evaluation sandbox", "Curated test data"],
            benefit: "Takes no time and grants no new permissions.",
            mainRisk: "No independent evidence.",
            available: true,
            blockers: [],
          },
        ],
        verifiers: [
          {
            id: "independent-institutional",
            displayName: "Independent institutional verification",
            description: "External evaluators own the protocol.",
            durationWeeks: 4,
            cashCostMillions: 4_000,
            auraCost: 6,
            integrityLabel: "Durable",
            benefit:
              "Best protection against a polished false pass, plus outside legitimacy.",
            warning: "Sensitive evidence leaves the lab.",
          },
        ],
        combinations: [
          {
            id: "generalist-gauntlet::independent-institutional",
            challengeId: "generalist-gauntlet",
            verifierId: "independent-institutional",
            displayName: "Generalist gauntlet · Independent institutional verification",
            durationWeeks: 8,
            cashCostMillions: 4_000,
            auraCost: 6,
            accessRequired: 2,
            accessLabel: "Supervised research tools",
            accessRiskPercent: 8,
            accessSystems: ["Sandboxed coding tools", "Approved research datasets"],
            claimScope: "broad-superintelligence",
            integrityLabel: "Durable",
            warnings: ["Rival clocks continue."],
            available: true,
            blockers: [],
          },
          {
            id: "declare-from-benchmarks::none",
            challengeId: "declare-from-benchmarks",
            displayName: "Declare from benchmarks",
            durationWeeks: 0,
            cashCostMillions: 0,
            auraCost: 0,
            accessRequired: 1,
            accessLabel: "Fixed evaluation sandbox",
            accessRiskPercent: 2,
            accessSystems: ["Fixed evaluation sandbox", "Curated test data"],
            claimScope: "unverified-claim",
            integrityLabel: "Unverified",
            warnings: ["No verifier."],
            available: true,
            blockers: [],
          },
        ],
        history: confirmedProofHistory,
        disputeCount: 0,
        committed: false,
      },
      maxClockSpeed: "4x",
    },
  } as unknown as GameView;
}

function remediationView(): GameView {
  return {
    meta: { tick: 96 },
    identity: { labId: "lab:player" },
    endgame: {
      active: true,
      stage: "evidence-sprint",
      stageLabel: "Chapter Two · Respond to what you found",
      crisisStartedAtTick: 80,
      weeksInCrisis: 16,
      candidate: {
        modelId: "model:aquarius-9",
        displayName: "Aquarius-9",
        accessLevel: 0,
        accessLabel: "Access 0 of 5",
      },
      capacity: { maximumProjects: 2, activeProjects: 0, availableProjects: 2 },
      clocks,
      commandRail: {
        ...activeRail,
        deployNow: {
          ...activeRail.deployNow,
          available: false,
          blockers: ["Choose which exact remediation artifact remains nominated first"],
        },
      },
      proofHistory: [],
      stageActions: {
        kind: "evidence-sprint",
        dossier: {
          safetyAssessment,
          modelId: "model:aquarius-9",
          overall: "Uncertain",
          safetyReportCount: 2,
          independentReportCount: 1,
          unresolvedAnomalyCount: 0,
          dismissedAnomalyCount: 0,
          findings: [],
        },
        responses: [],
        minimumWeeksRemaining: 0,
        committed: true,
        pendingRemediation: {
          source: {
            modelId: "model:aquarius-9",
            displayName: "Aquarius-9",
            measuredFrontierCapability: 95,
            measuredCapabilityFloor: 91,
            reliability: 90,
            available: true,
          },
          result: {
            modelId: "model:aquarius-9-remediation-1",
            displayName: "Aquarius-9-R1",
            measuredFrontierCapability: 93,
            measuredCapabilityFloor: 89,
            reliability: 86,
            available: true,
          },
          capabilityDelta: -2,
          reliabilityDelta: -4,
          safetyChangeRange:
            "Bounded remediation contract: Alignment +0–4 · Corrigibility +4–8. Exact hidden outcomes remain unevaluated.",
          evidenceTransferWarning:
            "Adopting the variant partially transfers safety context. Capability proof does not transfer: the new exact weights must be proved again.",
        },
      },
      maxClockSpeed: "paused",
    },
  } as unknown as GameView;
}

function finalReviewView(): GameView {
  return {
    meta: { tick: 100 },
    identity: { labId: "lab:player" },
    models: candidateModels,
    endgame: {
      active: true,
      stage: "final-review",
      stageLabel: "Chapter Three · Choose the route",
      crisisStartedAtTick: 80,
      weeksInCrisis: 20,
      candidate: {
        modelId: "model:aquarius-9",
        displayName: "Aquarius-9",
        accessLevel: 1,
        accessLabel: "Access 1 of 5",
      },
      capacity: { maximumProjects: 2, activeProjects: 0, availableProjects: 2 },
      clocks,
      commandRail: activeRail,
      proofHistory: confirmedProofHistory,
      stageActions: {
        kind: "final-review",
        dossier: {
          safetyAssessment,
          modelId: "model:aquarius-9",
          overall: "Guarded",
          safetyReportCount: 4,
          independentReportCount: 2,
          unresolvedAnomalyCount: 1,
          dismissedAnomalyCount: 2,
          findings: [],
        },
        report: {
          capabilityResult: "broadly-confirmed",
          capabilityProofResult: "broadly-confirmed",
          capabilityClaimScope: "broad-superintelligence",
          capabilityChallengeId: "generalist-gauntlet",
          capabilitySummary: "Independent evidence supports a broad claim.",
          evidenceRows: [
            { label: "Alignment", confidence: "moderate" },
            { label: "Control", confidence: "high" },
          ],
          knownControlLayers: ["Instrumented isolation"],
          knownFailurePaths: ["One unresolved anomaly"],
          unresolvedAnomalyCount: 1,
          operatingBlind: false,
          prosperityReadiness: 78,
          recommendations: [],
          candidateStatement: "I will operate within the selected mandate.",
        },
        deploymentModes: [
          {
            id: "fortress-pilot",
            displayName: "Fortress-lab contained pilot",
            description: "Begin inside the strongest available physical controls.",
            accessLevel: 2,
            rolloutWeeks: 11,
            auraCost: 6,
            exposureBand: "lower",
            fitGrade: "Credible",
            fitScore: 58.949999999999996,
            fitExplanation: "Control is credible but not complete.",
            reliesOn: ["Operational control 74"],
            principalBenefit: "Limits early exposure.",
            limitation: "A contained pilot cannot establish broad public benefit.",
            scopeCap: "Contained scientific pilot",
            available: true,
            blockers: [],
            confirmationPhrase: "AUTHORISE FORTRESS PILOT",
          },
        ],
        prosperityProgrammes: [
          {
            id: "science-acceleration",
            displayName: "Scientific acceleration",
            shortName: "Science",
            readiness: 78,
            unlocked: true,
            outcomeBand: "Credible public mandate",
          },
        ],
        recommendedProsperityProgrammeId: "science-acceleration",
      },
      maxClockSpeed: "paused",
    },
  } as unknown as GameView;
}

function pressureCopyView(kind: "safety-lead" | "candidate-vulnerability"): GameView {
  const safetyLead = kind === "safety-lead";
  return {
    meta: { tick: 98 },
    identity: { labId: "lab:player" },
    models: candidateModels,
    endgame: {
      active: true,
      stage: "pressure-collision",
      stageLabel: "Chapter Two · External pressure",
      crisisStartedAtTick: 80,
      weeksInCrisis: 18,
      candidate: {
        modelId: "model:aquarius-9",
        displayName: "Aquarius-9",
        accessLevel: 1,
        accessLabel: "Access 1 of 5",
      },
      capacity: { maximumProjects: 2, activeProjects: 0, availableProjects: 2 },
      clocks,
      commandRail: activeRail,
      proofHistory: [],
      stageActions: {
        kind: "pressure-collision",
        title: safetyLead
          ? "The safety lead has drafted a public letter"
          : "The candidate found something",
        body: "A consequential response is required.",
        category: "institutional",
        resolved: false,
        canEnterFinalReview: false,
        delayWeeksRemaining: 0,
        capabilityDisputeCount: 0,
        proofHistory: [],
        pendingProjects: [],
        options: [
          {
            id: "comply",
            label: safetyLead
              ? "Give the safety lead a release veto"
              : "Apply a sandboxed version of the fix",
            consequence: safetyLead
              ? "Strengthen practical control and legitimacy."
              : "Improve defence, but add a small amount of unresolved safety pressure.",
          },
        ],
      },
      maxClockSpeed: "paused",
    },
  } as unknown as GameView;
}

function unresolvedRetirementView(): GameView {
  return {
    meta: { tick: 90 },
    identity: { labId: "lab:player" },
    endgame: {
      active: true,
      stage: "retirement-attempt",
      stageLabel: "RETIREMENT COMMAND · Persistence unverified",
      crisisStartedAtTick: 80,
      weeksInCrisis: 10,
      candidate: {
        modelId: "model:aquarius-9",
        displayName: "Aquarius-9",
        accessLevel: 0,
        accessLabel: "Access 0 of 5",
      },
      capacity: { maximumProjects: 2, activeProjects: 0, availableProjects: 2 },
      clocks,
      commandRail: {
        deployNow: {
          available: false,
          blockers: ["No stable pre-command deployment decision is active"],
          warning: "Zero preparation weeks.",
        },
        retirement: {
          ...activeRail.retirement,
          configuredProcedureId: "staged-isolated-shutdown",
          configuredArchiveDisposition: "filtered-technical-note",
          confirmationPhrase: "RETIRE Aquarius-9",
        },
      },
      proofHistory: [],
      stageActions: {
        kind: "retirement-attempt",
        procedureId: "staged-isolated-shutdown",
        procedureName: "Staged isolated shutdown",
        archiveDisposition: "filtered-technical-note",
        archiveDispositionName: "Preserve a filtered technical note",
        transmittedAtTick: 89,
        attemptNumber: 1,
        contested: false,
        status: "unresolved-persistence",
        gateResults: [],
        warning:
          "Independent verification could not prove every executable copy was removed.",
      },
      maxClockSpeed: "paused",
    },
  } as unknown as GameView;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.bind(input);
  if (setter === undefined) throw new Error("HTML input value setter unavailable");
  act(() => {
    setter(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CrisisBoard redesigned endgame in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;
  let dispatch: ReturnType<typeof vi.fn>;
  let runtime: BrowserGameRuntime;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
    dispatch = vi.fn();
    runtime = {
      dispatch,
      pause: vi.fn(),
      validate: vi.fn(() => ({ ok: true, preview: { summary: "accepted" } })),
    } as unknown as BrowserGameRuntime;
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("tolerates an active view projected before proof history was added", () => {
    const staleView = structuredClone(proofView());
    delete (staleView as unknown as { endgame: { proofHistory?: unknown } }).endgame
      .proofHistory;

    expect(() => {
      act(() => root.render(<CrisisBoard view={staleView} runtime={runtime} />));
    }).not.toThrow();
    expect(document.body.textContent).toContain("Prove what you built");
    expect(document.body.textContent).not.toContain(
      "CAPABILITY PROOF RECORD // PERMANENT CRISIS EVIDENCE",
    );
  });

  it("makes the player nominate one exact artifact", () => {
    act(() => root.render(<CrisisBoard view={activationView()} runtime={runtime} />));
    expect(document.body.textContent).toContain("MAXIMUM SPEED · 4×");
    expect(document.body.textContent).not.toContain("CLOCK STOPPED FOR HUMAN DECISION");
    expect(document.body.textContent).toContain("Aquarius-8");
    expect(document.body.textContent).toContain("Aquarius-9");
    expect(document.body.textContent).toContain("UNRESOLVED SIGNAL");
    expect(document.body.textContent).toContain("FULL CAPABILITY PROFILE");
    expect(document.body.textContent).toContain("What the model can do");
    expect(document.body.textContent).toContain("0–100 assessed scale");
    expect(document.body.textContent).toContain("Embodiment");
    expect(document.body.textContent).toContain(
      "SAFETY AT A GLANCE // VISIBLE EVIDENCE ONLY",
    );
    expect(document.body.textContent).toContain("MODEL SAFETY");
    expect(document.body.textContent).toContain("LAB DEFENCE");
    expect(document.body.textContent).toContain("ACCESS & EXPOSURE");
    expect(document.body.textContent).toContain("Deception risk");
    expect(document.body.textContent).toContain("30–62");
    expect(document.body.textContent).toContain("Next: Alignment Interview · 1/5");
    expect(document.querySelectorAll(".model-evidence-profile")).toHaveLength(2);
    expect(document.body.textContent).toContain(
      "20% chance of genuine superintelligence",
    );

    const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) => button.textContent?.includes("Nominate this exact artifact"),
    );
    act(() => buttons[1]?.click());
    const nominationDialog = document.querySelector<HTMLElement>(
      ".endgame-manual-command",
    );
    expect(nominationDialog?.textContent).toContain("NOMINATION TARGET");
    expect(nominationDialog?.querySelector("h2")?.textContent).toBe(
      "Nominate Aquarius-9?",
    );
    expect(
      nominationDialog?.querySelector(".manual-command-target strong")?.textContent,
    ).toBe("Aquarius-9");
    expect(nominationDialog?.textContent).toContain(
      "Training record · week 79 · Frontier capability 94 · Access 1/5",
    );
    expect(nominationDialog?.textContent).toContain("20% at FC 92");
    expect(nominationDialog?.textContent).toContain("Current FC 97 does not redraw it");
    expect(nominationDialog?.textContent).toContain("Rival window: 4–9 weeks");
    expect(nominationDialog?.textContent).not.toContain("model:aquarius-9");

    const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Nominate exact artifact",
    );
    act(() => confirm?.click());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "nominate-candidate",
        modelId: "model:aquarius-9",
      }),
    );
  });

  it("composes challenge plus verifier and keeps typed deploy-now one action away", () => {
    act(() => root.render(<CrisisBoard view={proofView()} runtime={runtime} />));
    expect(document.body.textContent).toContain(
      "What will you prove—and who gets to judge?",
    );
    expect(document.body.textContent).toContain(
      "Generalist gauntlet · Independent institutional verification",
    );
    expect(document.body.textContent).toContain(
      "Attempt 1 · Access 2/5 · broadly confirmed",
    );
    expect(document.body.textContent).toContain("PRIOR WEIGHTS · Aquarius-8");
    expect(document.body.textContent).toContain("DEPLOY NOW");
    expect(document.body.textContent).toContain("20% at FC 92");
    expect(document.body.textContent).toContain("MINIMUM ACCESS");
    expect(document.body.textContent).toContain("Supervised research tools");
    expect(document.body.textContent).toContain(
      "Best protection against a polished false pass",
    );
    expect(document.body.textContent).toContain("ADDS 4 WEEKS");
    expect(document.body.textContent).not.toContain("Moderate exposure");
    expect(document.querySelectorAll(".proof-command-rail > button")).toHaveLength(3);

    const proof = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("COMMIT CAPABILITY PROOF"),
    );
    act(() => proof?.click());
    expect(dispatch).not.toHaveBeenCalled();
    const proofDialog = document.querySelector<HTMLElement>(".command-proof");
    expect(proofDialog?.textContent).toContain("Broad superintelligence claim");
    expect(proofDialog?.textContent).toContain("Durable");
    expect(proofDialog?.textContent).toContain("8 weeks · $4B · 6 Aura");
    expect(proofDialog?.textContent).toContain(
      "Access 1 · Fixed evaluation sandbox → Access 2 · Supervised research tools",
    );
    expect(proofDialog?.textContent).toMatch(/stays raised until you reduce it/i);
    expect(proofDialog?.textContent).toContain("Rival window: 4–9 weeks");
    const beginProof = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Begin capability proof",
    );
    act(() => beginProof?.click());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "commit-capability-proof",
        challengeId: "generalist-gauntlet",
        verifierId: "independent-institutional",
      }),
    );

    const deployNow = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("DEPLOY NOW"),
    );
    act(() => deployNow?.click());
    const input = document.querySelector<HTMLInputElement>(
      ".endgame-manual-command input",
    )!;
    const transmit = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Transmit DEPLOY order",
    )!;
    expect(document.querySelector(".endgame-manual-command")?.textContent).toContain(
      "Immediate · zero preparation weeks · 0 Aura",
    );
    expect(document.querySelector(".endgame-manual-command")?.textContent).toContain(
      "Rival window: 4–9 weeks",
    );
    expect(transmit.disabled).toBe(true);
    setInputValue(input, "DEPLOY Aquarius-9");
    act(() => transmit.click());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "transmit-deployment",
        confirmationText: "DEPLOY Aquarius-9",
      }),
    );
  });

  it("labels the instant benchmark path as an unverified declaration", () => {
    act(() => root.render(<CrisisBoard view={proofView()} runtime={runtime} />));
    const benchmark = [
      ...document.querySelectorAll<HTMLInputElement>(
        '.proof-composer-columns fieldset:first-of-type input[type="radio"]',
      ),
    ][1];
    act(() => benchmark?.click());

    const commit = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("COMMIT CAPABILITY PROOF"),
    );
    act(() => commit?.click());

    const dialog = document.querySelector<HTMLElement>(".command-proof");
    expect(dialog?.textContent).toContain("UNVERIFIED DECLARATION");
    expect(dialog?.textContent).toContain("Declare from existing benchmarks now?");
    expect(dialog?.textContent).toContain("Declare immediately with no new proof");
    expect(dialog?.textContent).not.toContain("starts a live endgame project");
    expect(dialog?.textContent).not.toContain("ACCESS IS A PERSISTENT PERMISSION LEVEL");
    expect(
      [...document.querySelectorAll<HTMLButtonElement>("button")].some(
        (button) => button.textContent?.trim() === "Declare without novel proof",
      ),
    ).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps challenge and verifier radio groups independent across duplicate board surfaces", () => {
    act(() =>
      root.render(
        <>
          <CrisisBoard view={proofView()} runtime={runtime} />
          <CrisisBoard view={proofView()} runtime={runtime} />
        </>,
      ),
    );

    const boards = [...document.querySelectorAll<HTMLElement>(".crisis-board")];
    expect(boards).toHaveLength(2);

    const groups = boards.map((board) => {
      const fieldsets = board.querySelectorAll<HTMLFieldSetElement>(
        ".proof-composer-columns fieldset",
      );
      const challenges = [
        ...fieldsets[0]!.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      ];
      const verifiers = [
        ...fieldsets[1]!.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
      ];

      expect(challenges.filter((input) => input.checked)).toHaveLength(1);
      expect(verifiers.filter((input) => input.checked)).toHaveLength(1);
      expect(new Set(challenges.map((input) => input.name))).toHaveLength(1);
      expect(new Set(verifiers.map((input) => input.name))).toHaveLength(1);
      expect(challenges[0]!.name).not.toBe(verifiers[0]!.name);
      expect(
        challenges.find((input) => input.checked)?.closest("label")?.classList,
      ).toContain("selected");
      expect(
        verifiers.find((input) => input.checked)?.closest("label")?.classList,
      ).toContain("selected");

      return { challenges, verifiers };
    });

    expect(groups[0]!.challenges[0]!.name).not.toBe(groups[1]!.challenges[0]!.name);
    expect(groups[0]!.verifiers[0]!.name).not.toBe(groups[1]!.verifiers[0]!.name);

    act(() => groups[0]!.challenges[1]!.click());

    const secondBoardChecked = [
      ...boards[1]!.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    ].filter((input) => input.checked);
    expect(secondBoardChecked).toHaveLength(2);
    expect(
      secondBoardChecked.every((input) =>
        input.closest("label")?.classList.contains("selected"),
      ),
    ).toBe(true);
  });

  it("requires an explicit exact-weight choice after bounded remediation", () => {
    act(() => root.render(<CrisisBoard view={remediationView()} runtime={runtime} />));
    expect(document.body.textContent).toContain("Two artifacts now exist");
    expect(document.body.textContent).toContain("NOMINATION DID NOT TRANSFER");
    expect(document.body.textContent).toContain("Aquarius-9-R1");
    expect(document.body.textContent).toContain("Alignment +0–4 · Corrigibility +4–8");
    expect(document.body.textContent).toContain("Capability proof does not transfer");

    const nominateVariant = [
      ...document.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.trim() === "Nominate Aquarius-9-R1");
    act(() => nominateVariant?.click());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "nominate-candidate",
        modelId: "model:aquarius-9-remediation-1",
      }),
    );
  });

  it("rounds route fit and preserves clocks plus cost on route confirmation", () => {
    act(() => root.render(<CrisisBoard view={finalReviewView()} runtime={runtime} />));
    expect(document.body.textContent).toContain(
      "CAPABILITY PROOF RECORD // PERMANENT CRISIS EVIDENCE",
    );
    expect(document.body.textContent).toContain(
      "The original weights cleared a broad challenge.",
    );
    expect(document.body.textContent).toContain("CREDIBLE FIT · 59/100");
    expect(document.body.textContent).not.toContain("58.949999999999996");
    expect(document.body.textContent).toContain("Dismissed");
    expect(document.body.textContent).not.toContain("Dismissed · unresolved");

    const route = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Commit this route",
    );
    act(() => route?.click());
    const dialog = document.querySelector<HTMLElement>(".endgame-manual-command");
    expect(dialog?.textContent).toContain("11 weeks · 6 Aura");
    expect(dialog?.textContent).toContain("Rival window: 4–9 weeks");
    expect(dialog?.textContent).toContain("clocks held while this order awaits you");
  });

  it("describes pressure outcomes using only their implemented effects", () => {
    act(() =>
      root.render(
        <CrisisBoard view={pressureCopyView("safety-lead")} runtime={runtime} />,
      ),
    );
    expect(document.body.textContent).toContain(
      "Strengthen practical control and legitimacy.",
    );
    expect(document.body.textContent).not.toContain("staff confidence");

    act(() =>
      root.render(
        <CrisisBoard
          view={pressureCopyView("candidate-vulnerability")}
          runtime={runtime}
        />,
      ),
    );
    expect(document.body.textContent).toContain(
      "Improve defence, but add a small amount of unresolved safety pressure.",
    );
    expect(document.body.textContent).not.toContain("candidate dependence");
  });

  it("keeps the canonical RETIRE rail available after persistence is unverified", () => {
    act(() =>
      root.render(<CrisisBoard view={unresolvedRetirementView()} runtime={runtime} />),
    );
    expect(document.body.textContent).toContain("Persistence unverified");
    const retire = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("RETIRE CANDIDATE"),
    );
    expect(retire?.disabled).toBe(false);
    act(() => retire?.click());
    expect(document.querySelector(".candidate-retirement-dialog")).not.toBeNull();

    const review = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Review irreversible command",
    );
    act(() => review?.click());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "configure-candidate-retirement" }),
    );

    const input = document.querySelector<HTMLInputElement>(
      ".candidate-retirement-transmission input",
    )!;
    setInputValue(input, "RETIRE Aquarius-9");
    const transmit = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Transmit RETIRE order",
    );
    act(() => transmit?.click());
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "transmit-candidate-retirement",
        modelId: "model:aquarius-9",
        confirmationText: "RETIRE Aquarius-9",
      }),
    );
  });
});
