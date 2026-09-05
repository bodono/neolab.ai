import { describe, expect, it } from "vitest";

import { buildPlaytestReport } from "../report.ts";
import {
  PLAYTEST_QUESTION_IDS,
  playtestSessionSchema,
  type PlaytestSession,
} from "../schema.ts";

function session(
  id: string,
  overrides: {
    readonly commit?: string;
    readonly result?: "clear" | "partial" | "unclear";
    readonly status?: "draft" | "complete";
  } = {},
): PlaytestSession {
  return playtestSessionSchema.parse({
    schemaVersion: 1,
    status: overrides.status ?? "complete",
    sessionId: id,
    build: {
      commit: overrides.commit ?? "d656314",
      contentHash: "0".repeat(64),
    },
    participant: {
      pseudonym: `participant-${id}`,
      firstNeolabSession: true,
      managementGameExperience: "some",
      aiExperience: "general",
    },
    consent: { notes: true, recording: "none", personalDataExcluded: true },
    environment: {
      browser: "Chromium",
      platform: "Desktop",
      primaryInput: "mouse-keyboard",
      viewport: "1500x900",
    },
    run: {
      durationMinutes: 110,
      difficultyId: "base:difficulty.standard",
      leaderId: "base:leader.thomas-hassabi",
      mandateId: "base:mandate.build-it-right",
      result: "won",
      endingId: "base:ending.the-broadly-shared-future",
      finalTick: 520,
      deploymentCrisisReached: true,
    },
    review: {
      questions: PLAYTEST_QUESTION_IDS.map((questionId) => ({
        id: questionId,
        result: overrides.result ?? "clear",
        evidence: "The participant explained the causal chain in their own words.",
        askedAt: questionId === "final-outcome" ? "after-audit" : "after-run",
        withoutLeadingPrompt: true,
      })),
      perceivedFairness: 4,
      crisisFeltEarned: 4,
      dominantUiHabits: [],
      jokesThatLanded: [],
      jokesThatFailed: [],
      ageingRisks: [],
      decisionTimes: [],
      facilitatorNotes: "",
    },
    issues: [],
  });
}

describe("playtest evidence report", () => {
  it("requires a same-build cohort with all seven questions clear", () => {
    const report = buildPlaytestReport(
      [session("session-a"), session("session-b"), session("session-c")],
      3,
    );
    expect(report.gateStatus).toBe("ready-for-manual-review");
    expect(report.questionSummaries).toHaveLength(7);
    expect(report.questionSummaries.every((summary) => summary.clearRate === 1)).toBe(
      true,
    );
  });

  it("surfaces repeated comprehension failures for remediation", () => {
    const report = buildPlaytestReport(
      [session("session-a"), session("session-b", { result: "partial" })],
      2,
    );
    expect(report.gateStatus).toBe("needs-remediation");
    expect(report.repeatedFailureQuestionIds).toEqual([]);

    const repeated = buildPlaytestReport(
      [
        session("session-a"),
        session("session-b", { result: "partial" }),
        session("session-c", { result: "unclear" }),
      ],
      3,
    );
    expect(repeated.repeatedFailureQuestionIds).toEqual(PLAYTEST_QUESTION_IDS);
  });

  it("does not count drafts and blocks mixed candidate builds", () => {
    const report = buildPlaytestReport(
      [
        session("session-a"),
        session("session-b", { commit: "abcdef0" }),
        session("session-draft", { status: "draft" }),
      ],
      2,
    );
    expect(report.completedSessionIds).toHaveLength(2);
    expect(report.draftSessionIds).toEqual(["session-draft"]);
    expect(report.gateStatus).toBe("blocked-mixed-builds");
  });

  it("rejects a completed record that skipped a review question", () => {
    const raw = structuredClone(session("session-a")) as unknown as {
      review: { questions: Array<{ result: string }> };
    };
    const first = raw.review.questions[0];
    if (first === undefined) throw new Error("Question fixture missing");
    first.result = "not-asked";
    expect(playtestSessionSchema.safeParse(raw).success).toBe(false);
  });
});
