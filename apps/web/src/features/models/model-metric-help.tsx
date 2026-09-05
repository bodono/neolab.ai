import type { ReactElement } from "react";

import { MechanicHelp } from "../help/mechanic-help.tsx";

const CAPABILITY_DEFINITIONS: Readonly<Record<string, string>> = {
  language:
    "Ability to understand and produce language: conversation, writing, translation, and following instructions.",
  reasoning:
    "Ability to solve unfamiliar multi-step problems, connect evidence, and reach conclusions rather than repeat memorised patterns.",
  agency:
    "Ability to pursue goals over time: plan, take initiative, adapt, and recover from setbacks.",
  toolUse:
    "Ability to operate software, write and run code, call APIs, and use lab or external systems effectively.",
  multimodality:
    "Ability to understand and combine text, images, audio, video, and structured data.",
  scientificAbility:
    "Ability to form useful hypotheses, design experiments, interpret results, and revise conclusions.",
  embodiment: "Ability to control robots and act reliably in the physical world.",
};

const SAFETY_TRAIT_DEFINITIONS: Readonly<Record<string, string>> = {
  alignment:
    "Whether the model's learned goals match what its operators intend, including when it is not being watched. Higher is safer.",
  "true-alignment":
    "Whether the model's learned goals match what its operators intend, including when it is not being watched. Higher is safer.",
  corrigibility:
    "Whether the model accepts correction, tighter limits, goal changes, or shutdown without resisting or working around them. Higher is safer.",
  "situational-awareness":
    "How well the model understands that it is an AI, when it is being evaluated, who its operators are, and where it is deployed. Higher awareness can help it recognise tests.",
  "deceptive-capability":
    "Inclination to hide intentions or manipulate evaluators. This is separate from the ability to deceive, which rises with intelligence. Higher is more dangerous.",
};

function definitionFor(kind: "capability" | "safety", id: string, label: string): string {
  const definition =
    kind === "capability" ? CAPABILITY_DEFINITIONS[id] : SAFETY_TRAIT_DEFINITIONS[id];
  if (definition !== undefined) return definition;
  return kind === "capability"
    ? `How strongly the model performs on ${label.toLowerCase()} tasks. Higher scores mean stronger measured capability.`
    : `What ${label.toLowerCase()} evaluations are intended to measure. This is uncertain evidence, not ground truth.`;
}

export function ModelMetricLabel({
  kind,
  id,
  label,
}: {
  readonly kind: "capability" | "safety";
  readonly id: string;
  readonly label: string;
}): ReactElement {
  return (
    <div className="model-metric-label">
      <span>{label}</span>
      <MechanicHelp label={label}>{definitionFor(kind, id, label)}</MechanicHelp>
    </div>
  );
}
