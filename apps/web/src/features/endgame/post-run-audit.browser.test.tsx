import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BrowserPostRunAudit } from "../../runtime/index.ts";
import "../../styles/game.css";
import { PostRunAudit } from "./ending-screen.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function auditFixture(): BrowserPostRunAudit {
  return {
    seed: "audit-fixture-seed",
    ending: {
      id: "base:ending.false-dawn",
      displayName: "False Dawn",
      endingClass: "survival",
      consequence: "none",
      epilogue: "The claim did not survive contact with the world.",
      aftermathTimeline: [],
      mechanicalCause: "The deployed candidate was not a genuine superintelligence.",
      endedAtWeek: 140,
    },
    mechanicalCauses: {
      weakestGates: [],
      evidenceAvailableBeforeFailure: [],
      irreducibleUncertainty: [],
      strategicAlternatives: [],
    },
    epilogueAudit: {
      belief:
        "The lab's latest proof was disputed; the original capability-class prior was 32%.",
      truth:
        "Aquarius-7's lineage had not crossed the threshold, and later variants never redrew it.",
      pivotalMoment: {
        week: 118,
        title: "Aquarius-7: disputed",
        observableEvidence: "Independent teams reproduced only part of the broad claim.",
        remainingChoice: "Deployment had not yet become irreversible.",
      },
    },
    lineageTruth: [
      {
        lineageId: "lineage:aquarius",
        ownerLabId: "lab:player",
        ownerLabName: "Neolab",
        isPlayerLineage: true,
        firstQualifyingModelId: "model:aquarius-7",
        firstQualifyingModelName: "Aquarius-7",
        firstQualifyingWeek: 104,
        firstQualifyingFrontierCapability: 92,
        firstQualifyingBreadth: 87,
        probabilityAtFirstCrossing: 0.325,
        superintelligenceTruth: "not-genuine",
        draw: 0.73,
        randomKey: "lineage-si/forensic-key",
        rulesVersion: "0.3",
        nominatedModelId: "model:aquarius-7",
        variants: [
          {
            modelId: "model:aquarius-7",
            displayName: "Aquarius-7",
            generationIndex: 7,
            trainedAtWeek: 104,
            frontierCapability: 92,
            inherited: false,
            candidateLifecycle: "verified-isolated-archive",
          },
        ],
      },
    ],
    capabilityProofLedger: [
      {
        historyId:
          "proof:model:aquarius-7:1:generalist-gauntlet:independent-institutional",
        modelId: "model:aquarius-7",
        modelName: "Aquarius-7",
        lineageId: "lineage:aquarius",
        resolvedAtWeek: 118,
        challengeId: "generalist-gauntlet",
        verifierId: "independent-institutional",
        attemptIndex: 1,
        accessLevelAtProof: 3,
        resultId: "disputed",
        claimScope: "broad-superintelligence",
        evidenceStrength: 58,
        integrityLabel: "Credible",
        summary: "Independent teams reproduced only part of the broad claim.",
        consequence: "A regulator opened an inquiry.",
        probabilityPrior: 0.325,
        fixedTruth: "not-genuine",
        truthComparison: "inconclusive",
        decisionWindow: "open",
        decisionWindowExplanation:
          "The irreversible deployment boundary had not yet closed.",
        hiddenFactors: {
          capabilitySignal: 61,
          manipulationEffect: 7,
          truthContribution: -18,
        },
      },
    ],
    artifactCustody: [
      {
        modelId: "model:aquarius-7",
        displayName: "Aquarius-7",
        ownerLabId: "lab:player",
        ownerLabName: "Neolab",
        lineageId: "lineage:aquarius",
        isNominatedArtifact: true,
        basis: "Direct qualification in week 104 at FC 92.0.",
        lifecycle: "verified-isolated-archive",
        trainedAtWeek: 104,
        currentAccess: 0,
        maximumAccessEver: 3,
        trainingExposure: 18,
        hazardPressure: 42,
        containmentLoad: 3.5,
        autonomousWeeks: 4,
        networkExposureWeeks: 5,
        servingExposureWeeks: 3,
        unresolvedAnomalyBurden: 12,
        retirementAttemptCount: 1,
        retirementVerification: "verified",
        archiveDisposition: "full-archive",
        nominationExposure: {
          capturedAtWeek: 120,
          maximumAccessEver: 3,
          autonomousWeeks: 2,
          networkExposureWeeks: 3,
          servingExposureWeeks: 2,
          unresolvedAnomalyBurden: 8,
          retirementAttemptCount: 0,
        },
        custodyEvents: [
          {
            week: 130,
            kind: "retirement-attempt",
            detail:
              "Attempt 1 · staged isolated shutdown · full archive · verified · candidate resistance observed.",
          },
          {
            week: 132,
            kind: "relationship",
            detail: "Archive: independent custody verification completed.",
          },
        ],
      },
    ],
    targetedResponses: [],
    readableGates: [],
    modelTruth: [
      {
        modelId: "model:aquarius-7",
        displayName: "Aquarius-7",
        generationIndex: 7,
        trainedAtWeek: 104,
        frontierCapability: 92,
        trueAlignment: 70,
        corrigibility: 68,
        situationalAwareness: 60,
        deceptiveCapability: 38,
        deceptiveIntent: 28,
      },
    ],
    evaluationErrors: [],
    majorDraws: [],
    rivalTimelines: [],
    rivalActivity: [],
    undiscoveredWarnings: [],
    causalDecisions: [],
    counterfactuals: [],
  } as unknown as BrowserPostRunAudit;
}

describe("terminal post-run audit in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("separates prior, proof, fixed truth, and the still-open decision window", () => {
    act(() => root.render(<PostRunAudit audit={auditFixture()} />));

    expect(document.body.textContent).toContain("WHAT THE LAB BELIEVED");
    expect(document.body.textContent).toContain("WHAT WAS TRUE");
    expect(document.body.textContent).toContain("THRESHOLD NOT CROSSED");
    expect(document.body.textContent).toContain("33% capability class");
    expect(document.body.textContent).toContain("disputed");
    expect(document.body.textContent).toContain("DECISION WINDOW WAS OPEN");
    const beats = document.querySelector<HTMLElement>(".audit-epilogue-beats");
    expect(beats).not.toBeNull();
    expect(window.getComputedStyle(beats!).display).toBe("grid");
  });

  it("renders artifact retirement history and keeps raw threshold details forensic", () => {
    act(() => root.render(<PostRunAudit audit={auditFixture()} />));

    expect(document.body.textContent).toContain("What happened to the weights");
    expect(document.body.textContent).toContain("Verified isolated archive");
    expect(document.body.textContent).toContain("candidate resistance observed");
    expect(document.body.textContent).toContain("independent custody verification");
    expect(document.body.textContent).toContain("Fixed lineage threshold draws");
    expect(document.body.textContent).toContain("0.7300");
    expect(document.body.textContent?.toLowerCase()).not.toContain("coalition");
  });

  it("reports network and public-serving exposure without double-counting either", () => {
    act(() => root.render(<PostRunAudit audit={auditFixture()} />));

    const metricRows = [
      ...document.querySelectorAll<HTMLElement>(".audit-custody dl > div"),
    ];
    const network = metricRows.find(
      (row) =>
        row.querySelector("dt")?.textContent ===
        "Network-exposed weeks (includes serving)",
    );
    const serving = metricRows.find(
      (row) => row.querySelector("dt")?.textContent === "Of which public serving",
    );
    expect(network?.querySelector("dd")?.textContent).toBe("5 weeks");
    expect(serving?.querySelector("dd")?.textContent).toBe("3 weeks");
    expect(document.body.textContent).toContain(
      "network 3w · of which public serving 2w",
    );
  });

  it("keeps the final causal record above the endgame readability floor", () => {
    act(() =>
      root.render(
        <main className="ending-screen">
          <PostRunAudit audit={auditFixture()} />
        </main>,
      ),
    );

    for (const [selector, minimumPixels] of [
      [".audit-epilogue-beats p", 12],
      [".audit-lineages > header > span", 11],
      [".audit-lineages article > p", 12],
      [".audit-proof-ledger dt", 11],
      [".audit-proof-ledger dd", 12],
      [".audit-custody article > ol time", 11],
      [".audit-custody article > ol p", 12],
      [".audit-seed code", 11],
    ] as const) {
      const element = document.querySelector<HTMLElement>(selector);
      expect(element, selector).not.toBeNull();
      expect(
        Number.parseFloat(getComputedStyle(element!).fontSize),
        selector,
      ).toBeGreaterThanOrEqual(minimumPixels);
    }
  });
});
