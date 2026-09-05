import {
  PLAYTEST_QUESTION_IDS,
  PLAYTEST_QUESTION_TEXT,
  type PlaytestQuestionId,
  type PlaytestSession,
} from "./schema.ts";

export interface PlaytestQuestionSummary {
  readonly id: PlaytestQuestionId;
  readonly question: string;
  readonly clear: number;
  readonly partial: number;
  readonly unclear: number;
  readonly notAsked: number;
  readonly clearRate: number | null;
}

export type PlaytestGateStatus =
  | "blocked-no-completed-sessions"
  | "blocked-insufficient-sessions"
  | "blocked-mixed-builds"
  | "needs-remediation"
  | "ready-for-manual-review";

export interface PlaytestReport {
  readonly reportFormat: 1;
  readonly minimumSessions: number;
  readonly gateStatus: PlaytestGateStatus;
  readonly completedSessionIds: readonly string[];
  readonly draftSessionIds: readonly string[];
  readonly buildKeys: readonly string[];
  readonly questionSummaries: readonly PlaytestQuestionSummary[];
  readonly repeatedFailureQuestionIds: readonly PlaytestQuestionId[];
  readonly issueCounts: Readonly<Record<string, number>>;
  readonly openIssueIds: readonly string[];
  readonly notes: readonly string[];
}

function buildKey(session: PlaytestSession): string {
  return `${session.build.commit}/${session.build.contentHash}`;
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function buildPlaytestReport(
  sessions: readonly PlaytestSession[],
  minimumSessions = 5,
): PlaytestReport {
  if (!Number.isInteger(minimumSessions) || minimumSessions <= 0) {
    throw new Error("minimumSessions must be a positive integer");
  }
  const completed = sessions
    .filter((session) => session.status === "complete")
    .sort((left, right) => compareIds(left.sessionId, right.sessionId));
  const drafts = sessions
    .filter((session) => session.status === "draft")
    .sort((left, right) => compareIds(left.sessionId, right.sessionId));
  const buildKeys = [...new Set(completed.map(buildKey))].sort();
  const questionSummaries = PLAYTEST_QUESTION_IDS.map((id) => {
    const results = completed.map((session) => {
      const question = session.review.questions.find((candidate) => candidate.id === id);
      if (question === undefined) throw new Error(`Validated session omitted ${id}`);
      return question.result;
    });
    const clear = results.filter((result) => result === "clear").length;
    const partial = results.filter((result) => result === "partial").length;
    const unclear = results.filter((result) => result === "unclear").length;
    const notAsked = results.filter((result) => result === "not-asked").length;
    const asked = clear + partial + unclear;
    return {
      id,
      question: PLAYTEST_QUESTION_TEXT[id],
      clear,
      partial,
      unclear,
      notAsked,
      clearRate: asked === 0 ? null : clear / asked,
    };
  });
  const repeatedFailureQuestionIds = questionSummaries
    .filter((summary) => summary.partial + summary.unclear >= 2)
    .map((summary) => summary.id);
  const issues = completed.flatMap((session) => session.issues);
  const issueCounts = Object.fromEntries(
    ["blocker", "high", "medium", "low"].map((severity) => [
      severity,
      issues.filter((issue) => issue.severity === severity).length,
    ]),
  );
  const openIssueIds = issues
    .filter((issue) => !["fixed", "retest-passed"].includes(issue.status))
    .map((issue) => issue.id)
    .sort();
  const everyQuestionClear = questionSummaries.every(
    (summary) => summary.clear === completed.length,
  );
  const gateStatus: PlaytestGateStatus =
    completed.length === 0
      ? "blocked-no-completed-sessions"
      : completed.length < minimumSessions
        ? "blocked-insufficient-sessions"
        : buildKeys.length !== 1
          ? "blocked-mixed-builds"
          : !everyQuestionClear || openIssueIds.length > 0
            ? "needs-remediation"
            : "ready-for-manual-review";
  return {
    reportFormat: 1,
    minimumSessions,
    gateStatus,
    completedSessionIds: completed.map((session) => session.sessionId),
    draftSessionIds: drafts.map((session) => session.sessionId),
    buildKeys,
    questionSummaries,
    repeatedFailureQuestionIds,
    issueCounts,
    openIssueIds,
    notes: [
      "This report validates evidence; it never substitutes for human sessions.",
      "ready-for-manual-review is not an automatic Stage 9 sign-off.",
      "Every completed session must answer all seven GDD 49.6 questions without a leading prompt.",
    ],
  };
}
