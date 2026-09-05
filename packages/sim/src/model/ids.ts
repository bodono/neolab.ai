import type { Brand } from "@neolab/content-schema";

/**
 * Run-scoped entity identifiers (TDD section 5.3). Run-created entities use
 * deterministic counters, e.g. `run:model:player:0007` — never random UUIDs.
 */
export type RunId = Brand<string, "RunId">;
export type LabId = Brand<string, "LabId">;
export type ModelId = Brand<string, "ModelId">;
/** Stable ancestry shared by one full training run and its weight-derived variants. */
export type ModelLineageId = Brand<string, "ModelLineageId">;
export type ProjectId = Brand<string, "ProjectId">;
export type ResearcherId = Brand<string, "ResearcherId">;
export type EventInstanceId = Brand<string, "EventInstanceId">;
export type ModifierId = Brand<string, "ModifierId">;
export type GpuLotId = Brand<string, "GpuLotId">;
export type EvaluationId = Brand<string, "EvaluationId">;
export type AnomalyId = Brand<string, "AnomalyId">;
export type CommandId = Brand<string, "CommandId">;
export type ContractId = Brand<string, "ContractId">;
export type FacilityId = Brand<string, "FacilityId">;
export type FundingOfferId = Brand<string, "FundingOfferId">;
export type CoalitionId = Brand<string, "CoalitionId">;
