import type { Brand } from "@neolab/content-schema";

/**
 * Run-scoped entity identifiers (TDD section 5.3). Run-created entities use
 * deterministic counters, e.g. `run:model:player:0007` — never random UUIDs.
 */
export type RunId = Brand<string, "RunId">;
export type LabId = Brand<string, "LabId">;
export type ModelId = Brand<string, "ModelId">;
export type ProjectId = Brand<string, "ProjectId">;
export type ResearcherId = Brand<string, "ResearcherId">;
export type EventInstanceId = Brand<string, "EventInstanceId">;
export type ModifierId = Brand<string, "ModifierId">;
export type GpuLotId = Brand<string, "GpuLotId">;
export type EvaluationId = Brand<string, "EvaluationId">;
export type AnomalyId = Brand<string, "AnomalyId">;
export type CommandId = Brand<string, "CommandId">;
