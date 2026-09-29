import { describe, expect, it } from "vitest";

import { validateCompiledContent, type CompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";
import type { CapabilityVector } from "../../model/state.ts";
import { CAPABILITY_ATTRIBUTES, calculateFrontierCapability } from "../capability.ts";

const content: CompiledContent = validateCompiledContent(rawBundle);

/** Frontier Capability a lab would have with only this domain at level 100. */
function frontierShare(domainId: string): number {
  const vector = Object.fromEntries(
    CAPABILITY_ATTRIBUTES.map((attribute) => [
      attribute,
      100 * (content.training.capabilityDomainWeights[attribute][domainId] ?? 0),
    ]),
  ) as unknown as CapabilityVector;
  return calculateFrontierCapability(vector) / 100;
}

describe("capability domain weights", () => {
  it("lets every capability domain count toward Frontier Capability", () => {
    const shares = Object.fromEntries(
      Object.keys(content.research.capabilityDomains).map((domainId) => [
        domainId,
        frontierShare(domainId),
      ]),
    );
    expect(shares["base:domain.optimisation-scaling"]).toBeGreaterThan(0.05);
    for (const share of Object.values(shares)) {
      expect(share).toBeGreaterThan(0);
      expect(share).toBeLessThan(0.4);
    }
    expect(Object.values(shares).reduce((sum, share) => sum + share, 0)).toBeCloseTo(1);
  });
});
