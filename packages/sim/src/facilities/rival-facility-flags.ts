import type {
  CompiledContent,
  ContentId,
  FacilityDefinition,
} from "@neolab/content-schema";

import type { LabState } from "../model/state.ts";

/**
 * Rivals build their campus off-screen as flags rather than facility
 * instances. Kept in a leaf module so finance and valuation can read it
 * without importing the facility engine.
 */
export function rivalFacilityCompleteFlag(definitionId: ContentId): string {
  return `rival:facility:${definitionId}:complete`;
}

/** Completed off-screen rival facilities that have no facility instance. */
export function completedRivalFacilityDefinitions(
  content: CompiledContent,
  lab: Readonly<LabState>,
): readonly FacilityDefinition[] {
  if (lab.control !== "rival") return [];
  const instanced = new Set(
    lab.facilities.instances.map((instance) => instance.definitionId),
  );
  return Object.values(content.facilities).filter(
    (definition) =>
      !instanced.has(definition.id) &&
      lab.flags[rivalFacilityCompleteFlag(definition.id)] === true,
  );
}
