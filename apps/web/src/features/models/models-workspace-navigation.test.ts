import { describe, expect, it } from "vitest";

import {
  candidateCustodyEvidenceDestination,
  launchPolicyChoiceIsAvailable,
  launchPolicyNeedsDispatch,
  modelEvidenceReviewRequest,
} from "./models-workspace.tsx";

describe("candidate custody navigation", () => {
  it("routes inspection to the unified model and safety view", () => {
    expect(candidateCustodyEvidenceDestination("inspect")).toBe("overview");
  });

  it("routes evidence review to the unified model and safety view", () => {
    expect(candidateCustodyEvidenceDestination("review-evidence")).toBe("overview");
  });

  it("opens the requested model at the Safety Case section", () => {
    expect(modelEvidenceReviewRequest("model:aquarius-7")).toEqual({
      modelId: "model:aquarius-7",
      workspace: "overview",
      anchor: "safety-case",
    });
  });
});

describe("productisation launch policy choices", () => {
  it("allows the current access policy as an explicit launch-plan choice", () => {
    expect(
      launchPolicyChoiceIsAvailable({
        currentPolicy: true,
        errorCodes: ["deployment-unchanged"],
        planIsEditable: true,
        validationOk: false,
      }),
    ).toBe(true);
  });

  it("does not bypass other policy blockers", () => {
    expect(
      launchPolicyChoiceIsAvailable({
        currentPolicy: true,
        errorCodes: ["deployment-unchanged", "lab-feature-locked"],
        planIsEditable: true,
        validationOk: false,
      }),
    ).toBe(false);
  });

  it("does not allow choices after the launch plan is authorised", () => {
    expect(
      launchPolicyChoiceIsAvailable({
        currentPolicy: true,
        errorCodes: ["deployment-unchanged"],
        planIsEditable: false,
        validationOk: false,
      }),
    ).toBe(false);
  });

  it("does not dispatch a redundant policy change when keeping internal access", () => {
    expect(launchPolicyNeedsDispatch("internal-only", "internal-only")).toBe(false);
  });
});
