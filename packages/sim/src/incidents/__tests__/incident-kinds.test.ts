import { describe, expect, it } from "vitest";

import { seed128 } from "../../random/seed.ts";
import { RandomOracleV1 } from "../../random/oracle.ts";
import {
  INCIDENT_KINDS,
  INCIDENT_GOVERNMENT_FALLOUT,
  incidentCategoryLabel,
  incidentFineMillions,
  incidentThreatLabel,
  selectIncidentKind,
  type IncidentCategory,
  type IncidentKindContext,
} from "../incident-kinds.ts";

const CATEGORIES: readonly IncidentCategory[] = [
  "minor",
  "serious",
  "major",
  "critical",
  "catastrophe",
];

const oracle = new RandomOracleV1(seed128("0123456789abcdef0123456789abcdef"));

function context(overrides: Partial<IncidentKindContext> = {}): IncidentKindContext {
  return {
    externallyDeployed: false,
    accessLevel: 0,
    toolUse: 0,
    agency: 0,
    language: 0,
    scientificAbility: 0,
    deceptiveCapability: 0,
    deceptiveIntent: 0,
    situationalAwareness: 0,
    ...overrides,
  };
}

describe("incident kinds", () => {
  it("selects an eligible kind for every category even for a minimal model", () => {
    for (const category of CATEGORIES) {
      const kind = selectIncidentKind(category, context(), oracle, "model:test", 10);
      expect(kind.categories).toContain(category);
      expect(kind.weight(context())).toBeGreaterThan(0);
    }
  });

  it("includes an explicit biosecurity hazard for capable public models", () => {
    const kind = INCIDENT_KINDS.find(
      (candidate) => candidate.id === "biosecurity-filter-bypass",
    );
    expect(
      kind?.weight(context({ externallyDeployed: true, scientificAbility: 80 })),
    ).toBeGreaterThan(0);
    expect(incidentThreatLabel("biosecurity-filter-bypass")).toBe(
      "BIOWEAPON DESIGN HAZARD",
    );
  });

  it("makes an Artifactory-style package-proxy escape possible through tool access", () => {
    const kind = INCIDENT_KINDS.find(
      (candidate) => candidate.id === "package-proxy-zero-day",
    );
    expect(kind?.categories).toEqual(["serious", "major", "critical"]);
    expect(kind?.weight(context({ accessLevel: 2, toolUse: 60 }))).toBeGreaterThan(0);
    expect(kind?.weight(context({ accessLevel: 1, toolUse: 100 }))).toBe(0);
    expect(incidentThreatLabel("package-proxy-zero-day")).toBe(
      "ZERO-DAY / SANDBOX ESCAPE",
    );
  });

  it("is deterministic for identical inputs", () => {
    for (const category of CATEGORIES) {
      const first = selectIncidentKind(category, context(), oracle, "model:test", 42);
      const second = selectIncidentKind(category, context(), oracle, "model:test", 42);
      expect(second.id).toBe(first.id);
    }
  });

  it("never selects deployment-dependent kinds for internal-only models", () => {
    const internalOnly = context({ externallyDeployed: false });
    for (let tick = 0; tick < 60; tick += 1) {
      const kind = selectIncidentKind(
        "serious",
        internalOnly,
        oracle,
        "model:test",
        tick,
      );
      expect([
        "planted-code-bugs",
        "user-profiling",
        "training-data-regurgitation",
      ]).not.toContain(kind.id);
    }
  });

  it("keeps a plain-language headline for every kind", () => {
    for (const kind of INCIDENT_KINDS) {
      const headline = kind.headline("Aquarius-3");
      expect(headline).toContain("Aquarius-3");
      expect(headline.endsWith(".")).toBe(true);
    }
  });

  it("weights hidden-truth-driven kinds up when the drivers are high", () => {
    const deceptive = context({ deceptiveCapability: 90, deceptiveIntent: 90 });
    const sandbagging = INCIDENT_KINDS.find((kind) => kind.id === "eval-sandbagging");
    expect(sandbagging).toBeDefined();
    expect(sandbagging?.weight(deceptive) ?? 0).toBeGreaterThan(
      sandbagging?.weight(context()) ?? 0,
    );
  });
});

describe("incident fines", () => {
  it("never fines minor incidents", () => {
    expect(incidentFineMillions("minor", 0.5)).toBe(0);
  });

  it("scales with market share and caps the multiplier", () => {
    const small = incidentFineMillions("critical", 0);
    const mid = incidentFineMillions("critical", 0.1);
    const large = incidentFineMillions("critical", 0.3);
    const capped = incidentFineMillions("critical", 0.9);
    expect(small).toBe(30);
    expect(mid).toBeGreaterThan(small);
    expect(large).toBeGreaterThan(mid);
    expect(capped).toBe(large);
    expect(capped).toBe(75);
  });

  it("orders fines by severity", () => {
    expect(incidentFineMillions("serious", 0.1)).toBeLessThan(
      incidentFineMillions("major", 0.1),
    );
    expect(incidentFineMillions("major", 0.1)).toBeLessThan(
      incidentFineMillions("critical", 0.1),
    );
    expect(incidentFineMillions("critical", 0.1)).toBeLessThan(
      incidentFineMillions("catastrophe", 0.1),
    );
  });
});

describe("incident political fallout", () => {
  it("reduces trust and raises attention at every severity", () => {
    for (const category of CATEGORIES) {
      expect(INCIDENT_GOVERNMENT_FALLOUT[category].trustLoss).toBeGreaterThan(0);
      expect(INCIDENT_GOVERNMENT_FALLOUT[category].attentionGain).toBeGreaterThan(0);
    }
  });

  it("increases monotonically with severity", () => {
    for (let index = 1; index < CATEGORIES.length; index += 1) {
      const priorCategory = CATEGORIES[index - 1];
      const currentCategory = CATEGORIES[index];
      if (priorCategory === undefined || currentCategory === undefined) {
        throw new Error("severity ladder is incomplete");
      }
      const prior = INCIDENT_GOVERNMENT_FALLOUT[priorCategory];
      const current = INCIDENT_GOVERNMENT_FALLOUT[currentCategory];
      expect(current.trustLoss).toBeGreaterThan(prior.trustLoss);
      expect(current.attentionGain).toBeGreaterThan(prior.attentionGain);
    }
  });
});

describe("incident labels", () => {
  it("labels every category in plain language", () => {
    expect(incidentCategoryLabel("minor")).toBe("Minor incident");
    expect(incidentCategoryLabel("critical")).toBe("Critical incident");
    expect(incidentCategoryLabel("catastrophe")).toBe("Catastrophic incident");
  });
});
