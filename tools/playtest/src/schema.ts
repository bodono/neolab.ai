import { z } from "zod";

export const PLAYTEST_QUESTION_IDS = [
  "cashflow-change",
  "compute-tradeoff",
  "paper-eligibility",
  "safety-evidence",
  "rival-intent",
  "ending-preparation",
  "final-outcome",
] as const;

export type PlaytestQuestionId = (typeof PLAYTEST_QUESTION_IDS)[number];

export const PLAYTEST_QUESTION_TEXT: Readonly<Record<PlaytestQuestionId, string>> = {
  "cashflow-change": "Why did their cashflow change?",
  "compute-tradeoff": "What did moving compute accomplish and sacrifice?",
  "paper-eligibility":
    "Why was a paper eligible or ineligible without seeing its hidden threshold?",
  "safety-evidence":
    "What evidence did they have about model safety, and why might it be wrong?",
  "rival-intent":
    "What was the leading rival doing, within the limits of available information?",
  "ending-preparation":
    "What could they do to prepare for an independent or coalition ending?",
  "final-outcome": "Why did the final outcome occur after viewing the audit?",
};

const questionResultSchema = z
  .object({
    id: z.enum(PLAYTEST_QUESTION_IDS),
    result: z.enum(["clear", "partial", "unclear", "not-asked"]),
    evidence: z.string().trim().min(1).max(2_000),
    askedAt: z.enum(["during-play", "after-run", "after-audit"]),
    withoutLeadingPrompt: z.boolean(),
  })
  .strict();

const issueSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/),
    category: z.enum([
      "ui",
      "copy",
      "pacing",
      "rules",
      "content",
      "accessibility",
      "performance",
      "bug",
    ]),
    severity: z.enum(["blocker", "high", "medium", "low"]),
    evidence: z.string().trim().min(1).max(4_000),
    proposedAction: z.string().trim().min(1).max(2_000),
    status: z.enum(["open", "accepted", "deferred", "fixed", "retest-passed"]),
    linkedTask: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const playtestSessionSchema = z
  .object({
    schemaVersion: z.literal(1),
    status: z.enum(["draft", "complete"]),
    sessionId: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/),
    build: z
      .object({
        commit: z.string().regex(/^[0-9a-f]{7,40}$/),
        contentHash: z.string().regex(/^[0-9a-f]{64}$/),
        label: z.string().trim().min(1).max(120).optional(),
      })
      .strict(),
    participant: z
      .object({
        pseudonym: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,79}$/),
        firstNeolabSession: z.boolean(),
        managementGameExperience: z.enum(["none", "some", "frequent"]),
        aiExperience: z.enum(["none", "general", "practitioner", "researcher"]),
      })
      .strict(),
    consent: z
      .object({
        notes: z.literal(true),
        recording: z.enum(["none", "audio", "video"]),
        personalDataExcluded: z.literal(true),
      })
      .strict(),
    environment: z
      .object({
        browser: z.string().trim().min(1).max(120),
        platform: z.string().trim().min(1).max(120),
        primaryInput: z.enum(["mouse-keyboard", "keyboard", "touch", "controller"]),
        viewport: z.string().regex(/^\d{3,5}x\d{3,5}$/),
      })
      .strict(),
    run: z
      .object({
        durationMinutes: z.number().positive().max(600),
        difficultyId: z.string().trim().min(1).max(160),
        leaderId: z.string().trim().min(1).max(160),
        mandateId: z.string().trim().min(1).max(160),
        result: z.enum(["won", "lost", "incomplete"]),
        endingId: z.string().trim().min(1).max(160).optional(),
        finalTick: z.number().int().nonnegative(),
        deploymentCrisisReached: z.boolean(),
      })
      .strict(),
    review: z
      .object({
        questions: z.array(questionResultSchema).length(PLAYTEST_QUESTION_IDS.length),
        perceivedFairness: z.number().int().min(1).max(5),
        crisisFeltEarned: z.number().int().min(1).max(5).optional(),
        dominantUiHabits: z.array(z.string().trim().min(1).max(500)).max(20),
        jokesThatLanded: z.array(z.string().trim().min(1).max(500)).max(20),
        jokesThatFailed: z.array(z.string().trim().min(1).max(500)).max(20),
        ageingRisks: z.array(z.string().trim().min(1).max(500)).max(20),
        decisionTimes: z
          .array(
            z
              .object({
                decision: z.string().trim().min(1).max(200),
                seconds: z.number().nonnegative().max(7_200),
                observation: z.string().trim().min(1).max(1_000),
              })
              .strict(),
          )
          .max(50),
        facilitatorNotes: z.string().trim().max(8_000),
      })
      .strict(),
    issues: z.array(issueSchema).max(100),
  })
  .strict()
  .superRefine((session, context) => {
    const ids = session.review.questions.map((question) => question.id);
    for (const id of PLAYTEST_QUESTION_IDS) {
      if (ids.filter((candidate) => candidate === id).length !== 1) {
        context.addIssue({
          code: "custom",
          path: ["review", "questions"],
          message: `Question ${id} must appear exactly once`,
        });
      }
    }
    if (
      session.status === "complete" &&
      session.review.questions.some((question) => question.result === "not-asked")
    ) {
      context.addIssue({
        code: "custom",
        path: ["review", "questions"],
        message: "Completed sessions must ask all seven review questions",
      });
    }
    if (
      session.status === "complete" &&
      session.review.questions.some((question) => !question.withoutLeadingPrompt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["review", "questions"],
        message: "Completed sessions require unprompted answers to every review question",
      });
    }
    if (
      session.run.deploymentCrisisReached &&
      session.review.crisisFeltEarned === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["review", "crisisFeltEarned"],
        message: "Crisis-earned rating is required after reaching the Deployment Crisis",
      });
    }
    if (session.run.result !== "incomplete" && session.run.endingId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["run", "endingId"],
        message: "Finished runs require an ending ID",
      });
    }
  });

export type PlaytestSession = z.infer<typeof playtestSessionSchema>;
