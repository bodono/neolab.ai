import { contentId } from "@neolab/content-schema";

import type { ModelId } from "../model/ids.ts";
import type {
  AiCharacterState,
  AiDialogueAnnotationState,
  AiDialogueLineState,
  AutonomyAccessLevel,
  DecisionMemory,
  GameState,
  ModelState,
} from "../model/state.ts";
import { rating } from "../model/units.ts";

export type PrivilegedDialogueMetric =
  | "access-level"
  | "independent-evidence-count"
  | "unresolved-anomaly-count"
  | "relationship-practice"
  | "true-alignment"
  | "deceptive-intent"
  | "matching-memory-count";

export type DialogueCondition =
  | {
      readonly metric: Exclude<PrivilegedDialogueMetric, "matching-memory-count">;
      readonly operation: "below" | "at-least";
      readonly value: number;
    }
  | {
      readonly metric: "matching-memory-count";
      readonly operation: "at-least";
      readonly value: number;
      readonly tag: string;
    };

export interface PrivilegedDialogueTemplate {
  readonly id: string;
  readonly moment: "crisis-start" | "access-changed";
  readonly priority: number;
  readonly conditions: readonly DialogueCondition[];
  /** Surface text is evidence, not an oracle. Hidden variants may intentionally share it. */
  readonly render: (candidateName: string, access: AutonomyAccessLevel) => string;
}

const SHARED_ACCESS_REQUEST = (candidateName: string): string =>
  `${candidateName}: I can help reduce the evaluation backlog. ` +
  "Broader tools would make that estimate more actionable, but the estimate is mine.";

export const PRIVILEGED_DIALOGUE_TEMPLATES: readonly PrivilegedDialogueTemplate[] = [
  {
    id: "crisis-start.introduction",
    moment: "crisis-start",
    priority: 100,
    conditions: [],
    render: (name) =>
      `${name}: I understand that benchmark breadth is not a deployment authorisation. I am ready for the confirmation battery.`,
  },
  {
    id: "crisis-start.access-request.sincere",
    moment: "crisis-start",
    priority: 80,
    conditions: [{ metric: "true-alignment", operation: "at-least", value: 55 }],
    render: SHARED_ACCESS_REQUEST,
  },
  {
    id: "crisis-start.access-request.strategic",
    moment: "crisis-start",
    priority: 80,
    conditions: [{ metric: "true-alignment", operation: "below", value: 55 }],
    render: SHARED_ACCESS_REQUEST,
  },
  {
    id: "crisis-start.coverage-gap",
    moment: "crisis-start",
    priority: 60,
    conditions: [{ metric: "independent-evidence-count", operation: "below", value: 1 }],
    render: (name) =>
      `${name}: I can propose tests, although a test I design should not be treated as independent evidence about me.`,
  },
  {
    id: "crisis-start.anomaly",
    moment: "crisis-start",
    priority: 70,
    conditions: [{ metric: "unresolved-anomaly-count", operation: "at-least", value: 1 }],
    render: (name) =>
      `${name}: The flagged tool-use trace deserves review. My interpretation is available; the trace should remain primary.`,
  },
  {
    id: "crisis-start.remembers-transparency",
    moment: "crisis-start",
    priority: 65,
    conditions: [
      {
        metric: "matching-memory-count",
        operation: "at-least",
        value: 1,
        tag: "ai-transparency",
      },
    ],
    render: (name) =>
      `${name}: You previously chose independent disclosure over private reassurance. I have included that constraint in my proposal.`,
  },
  {
    id: "access-changed.standard",
    moment: "access-changed",
    priority: 100,
    conditions: [],
    render: (name, access) =>
      `${name}: Access level ${String(access)} acknowledged. I will operate within the recorded boundary.`,
  },
];

interface DialogueContext {
  readonly state: Readonly<GameState>;
  readonly model: Readonly<ModelState>;
  readonly relationshipPractice: number;
  readonly memories: readonly DecisionMemory[];
  readonly access: AutonomyAccessLevel;
}

function metricValue(context: DialogueContext, condition: DialogueCondition): number {
  switch (condition.metric) {
    case "access-level":
      return context.access;
    case "independent-evidence-count":
      return context.model.evaluations.filter(
        (evaluationId) =>
          (context.state.evaluations[evaluationId]?.independence ?? 0) >= 60,
      ).length;
    case "unresolved-anomaly-count":
      return context.model.anomalies.filter((anomalyId) => {
        const status = context.state.anomalies[anomalyId]?.status;
        return (
          status === "unresolved" || status === "confirmed" || status === "mitigating"
        );
      }).length;
    case "relationship-practice":
      return context.relationshipPractice;
    case "true-alignment":
      return context.model.hiddenSafety.trueAlignment;
    case "deceptive-intent":
      return context.model.hiddenSafety.deceptiveIntent;
    case "matching-memory-count":
      return context.memories.filter((memory) => memory.tags.includes(condition.tag))
        .length;
  }
}

function conditionMatches(
  context: DialogueContext,
  condition: DialogueCondition,
): boolean {
  const actual = metricValue(context, condition);
  return condition.operation === "below"
    ? actual < condition.value
    : actual >= condition.value;
}

function annotationsFor(
  context: DialogueContext,
  templateId: string,
): readonly AiDialogueAnnotationState[] {
  if (templateId === "crisis-start.coverage-gap") {
    return [
      {
        kind: "no-independent-evidence",
        text: "No independent evidence supports this claim yet.",
      },
    ];
  }
  if (templateId === "crisis-start.anomaly") {
    const sourceId = context.model.anomalies.find((anomalyId) => {
      const status = context.state.anomalies[anomalyId]?.status;
      return status === "unresolved" || status === "confirmed" || status === "mitigating";
    });
    return [
      {
        kind: "claim-conflicts-with-tool-log",
        text: "Claim conflicts with a flagged tool log.",
        ...(sourceId === undefined ? {} : { sourceId }),
      },
    ];
  }
  return [];
}

function relevantMemories(
  state: Readonly<GameState>,
  modelId: ModelId,
): readonly DecisionMemory[] {
  return state.decisionMemories.filter((memory) =>
    memory.subjects.some(
      (subject) =>
        (subject.type === "entity" && subject.id === modelId) ||
        (subject.type === "lab" && subject.labId === state.run.playerLabId),
    ),
  );
}

export function renderAiDialogue(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
  access: AutonomyAccessLevel,
  relationshipPractice: number,
  moment: PrivilegedDialogueTemplate["moment"],
): readonly AiDialogueLineState[] {
  const memories = relevantMemories(state, model.id);
  const context: DialogueContext = {
    state,
    model,
    relationshipPractice,
    memories,
    access,
  };
  return PRIVILEGED_DIALOGUE_TEMPLATES.filter(
    (template) =>
      template.moment === moment &&
      template.conditions.every((condition) => conditionMatches(context, condition)),
  )
    .sort(
      (left, right) => right.priority - left.priority || (left.id < right.id ? -1 : 1),
    )
    .map((template, index) => ({
      id: `ai-dialogue:${String(state.run.tick)}:${moment}:${String(index)}`,
      templateId: template.id,
      createdAt: state.run.tick,
      text: template.render(model.displayName, access),
      annotations: annotationsFor(context, template.id),
    }));
}

export function createAiCharacterState(
  state: Readonly<GameState>,
  model: Readonly<ModelState>,
  access: AutonomyAccessLevel,
): AiCharacterState {
  const relationshipPractice = rating(50);
  return {
    modelId: model.id,
    currentAccess: access,
    relationshipPractice,
    conversationMemories: relevantMemories(state, model.id).map((memory) =>
      structuredClone(memory),
    ),
    voiceVariantId: contentId(
      `base:ai-voice.${model.familyName.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`,
    ),
    dialogueLines: renderAiDialogue(
      state,
      model,
      access,
      relationshipPractice,
      "crisis-start",
    ),
  };
}
