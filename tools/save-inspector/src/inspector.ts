import {
  calculateFrontierCapability,
  loadSaveEnvelope,
  stateHash,
  type GameState,
  type HiddenModelSafetyState,
  type LabState,
  type LoadedSave,
} from "@neolab/sim";

export interface SaveInspectionReport {
  readonly reportFormat: 1;
  readonly privileged: true;
  readonly envelope: {
    readonly saveId: string;
    readonly slotType: LoadedSave["envelope"]["slotType"];
    readonly displayName: string;
    readonly createdAtIso: string;
    readonly updatedAtIso: string;
    readonly saveVersion: number;
    readonly engineRulesVersion: string;
    readonly contentVersion: string;
    readonly contentHash: string;
    readonly randomContractVersion: number;
    readonly checksum: string;
  };
  readonly migration: LoadedSave["migration"];
  readonly stateHash: string;
  readonly run: {
    readonly runId: string;
    readonly seed: string;
    readonly tick: number;
    readonly calendar: GameState["run"]["calendar"];
    readonly phase: GameState["run"]["phase"];
    readonly status: GameState["run"]["status"];
    readonly endingId?: string;
    readonly playerLabId: string;
    readonly autoPauseReasons: readonly string[];
  };
  readonly playerLab: {
    readonly definitionId: string;
    readonly cashMillions: number;
    readonly auraSpendable: number;
    readonly auraLifetime: number;
    readonly physicalGpus: number;
    readonly capabilityResearchPoints: number;
    readonly safetyResearchPoints: number;
    readonly discoveredPapers: number;
    readonly starSlots: number;
    readonly employedResearchers: number;
    readonly facilities: number;
    readonly currentModelId?: string;
    readonly safety: LabState["safety"];
    readonly organisation: LabState["organisation"];
    readonly politics: LabState["politics"];
  };
  readonly counts: {
    readonly labs: number;
    readonly models: number;
    readonly researchers: number;
    readonly projects: Readonly<Record<string, number>>;
    readonly evaluations: number;
    readonly anomalies: number;
    readonly incidents: Readonly<Record<string, number>>;
    readonly events: Readonly<Record<string, number>>;
    readonly modifiers: number;
    readonly scheduledEffects: number;
    readonly decisionLog: number;
    readonly domainLog: number;
  };
  readonly models: readonly {
    readonly id: string;
    readonly ownerLabId: string;
    readonly displayName: string;
    readonly familyName: string;
    readonly generationIndex: number;
    readonly frontierCapability: number;
    readonly measuredFrontierCapability?: number;
    readonly accessLevel: number;
    readonly deploymentPolicy: string;
    readonly exposure: number;
    readonly hiddenSafety: HiddenModelSafetyState;
    readonly evaluations: number;
    readonly anomalies: number;
  }[];
  readonly endgame: {
    readonly stage: GameState["endgame"]["stage"];
    readonly candidateModelId?: string;
    readonly gateResolutions: number;
  };
  readonly score: {
    readonly entries: number;
    readonly currentRawTotal: number;
    readonly final?: GameState["score"]["final"];
  };
}

export type SaveDiffPreview =
  | string
  | number
  | boolean
  | null
  | { readonly kind: "missing" }
  | { readonly kind: "array"; readonly length: number }
  | { readonly kind: "object"; readonly keys: number };

export interface SaveDiffEntry {
  readonly path: string;
  readonly kind: "added" | "removed" | "changed";
  readonly before: SaveDiffPreview;
  readonly after: SaveDiffPreview;
}

export interface SaveDiffReport {
  readonly reportFormat: 1;
  readonly privileged: true;
  readonly left: {
    readonly saveId: string;
    readonly stateHash: string;
    readonly tick: number;
  };
  readonly right: {
    readonly saveId: string;
    readonly stateHash: string;
    readonly tick: number;
  };
  readonly totalChanges: number;
  readonly returnedChanges: number;
  readonly truncated: boolean;
  readonly changes: readonly SaveDiffEntry[];
}

function countBy(values: readonly string[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  );
}

function sumResearchPoints(
  domains: Readonly<Record<string, { readonly totalResearchPoints: number }>>,
): number {
  return Object.values(domains).reduce(
    (sum, domain) => sum + domain.totalResearchPoints,
    0,
  );
}

function candidateModelId(state: Readonly<GameState>): string | undefined {
  return state.endgame.stage === "inactive" ||
    state.endgame.stage === "candidate-activation"
    ? undefined
    : state.endgame.candidateModelId;
}

function gateResolutionCount(state: Readonly<GameState>): number {
  return state.endgame.stage === "rollout" || state.endgame.stage === "resolved"
    ? state.endgame.gateResolutions.length
    : 0;
}

export function inspectSaveEnvelope(value: unknown): SaveInspectionReport {
  const loaded = loadSaveEnvelope(value);
  const state = loaded.state;
  const lab = state.labs[state.run.playerLabId];
  if (lab === undefined) throw new Error("Loaded save has no player lab");
  const projectCounts = countBy(
    Object.values(state.projects).map((project) => project.status),
  );
  const incidentCounts = countBy(state.incidents.map((incident) => incident.category));
  const eventCounts = countBy(
    Object.values(state.eventInstances).map((event) => event.status),
  );
  const candidateId = candidateModelId(state);
  return {
    reportFormat: 1,
    privileged: true,
    envelope: {
      saveId: loaded.envelope.saveId,
      slotType: loaded.envelope.slotType,
      displayName: loaded.envelope.displayName,
      createdAtIso: loaded.envelope.createdAtIso,
      updatedAtIso: loaded.envelope.updatedAtIso,
      saveVersion: loaded.envelope.saveVersion,
      engineRulesVersion: loaded.envelope.engineRulesVersion,
      contentVersion: loaded.envelope.contentVersion,
      contentHash: loaded.envelope.contentHash,
      randomContractVersion: loaded.envelope.randomContractVersion,
      checksum: loaded.envelope.checksum,
    },
    migration: loaded.migration,
    stateHash: stateHash(state),
    run: {
      runId: state.run.runId,
      seed: state.run.seed,
      tick: state.run.tick,
      calendar: structuredClone(state.run.calendar),
      phase: state.run.phase,
      status: state.run.status,
      ...(state.run.endingId === undefined ? {} : { endingId: state.run.endingId }),
      playerLabId: state.run.playerLabId,
      autoPauseReasons: [...state.run.autoPauseReasons],
    },
    playerLab: {
      definitionId: lab.definitionId,
      cashMillions: lab.finance.cash,
      auraSpendable: lab.aura.spendable,
      auraLifetime: lab.aura.lifetime,
      physicalGpus: lab.compute.lots.reduce((sum, lot) => sum + lot.physicalCount, 0),
      capabilityResearchPoints: sumResearchPoints(lab.research.domains),
      safetyResearchPoints: sumResearchPoints(lab.research.safetyPrograms),
      discoveredPapers: lab.research.discoveredPaperIds.length,
      starSlots: lab.roster.starSlots,
      employedResearchers: lab.roster.researcherIds.length,
      facilities: lab.facilities.instances.length,
      ...(lab.models.currentModelId === undefined
        ? {}
        : { currentModelId: lab.models.currentModelId }),
      safety: structuredClone(lab.safety),
      organisation: structuredClone(lab.organisation),
      politics: structuredClone(lab.politics),
    },
    counts: {
      labs: Object.keys(state.labs).length,
      models: Object.keys(state.models).length,
      researchers: Object.keys(state.researchers).length,
      projects: projectCounts,
      evaluations: Object.keys(state.evaluations).length,
      anomalies: Object.keys(state.anomalies).length,
      incidents: incidentCounts,
      events: eventCounts,
      modifiers: Object.keys(state.modifiers).length,
      scheduledEffects: state.scheduledEffects.length,
      decisionLog: state.decisionLog.length,
      domainLog: state.domainLog.length,
    },
    models: Object.values(state.models)
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((model) => ({
        id: model.id,
        ownerLabId: model.ownerLabId,
        displayName: model.displayName,
        familyName: model.familyName,
        generationIndex: model.generationIndex,
        frontierCapability: calculateFrontierCapability(model.trueCapability),
        ...(model.measuredCapability === undefined
          ? {}
          : {
              measuredFrontierCapability: model.measuredCapability.frontierCapability,
            }),
        accessLevel: model.accessLevel,
        deploymentPolicy: model.deployment.policy,
        exposure: model.deployment.exposure,
        hiddenSafety: structuredClone(model.hiddenSafety),
        evaluations: model.evaluations.length,
        anomalies: model.anomalies.length,
      })),
    endgame: {
      stage: state.endgame.stage,
      ...(candidateId === undefined ? {} : { candidateModelId: candidateId }),
      gateResolutions: gateResolutionCount(state),
    },
    score: {
      entries: state.score.entries.length,
      currentRawTotal: state.score.entries.reduce((sum, entry) => sum + entry.amount, 0),
      ...(state.score.final === undefined
        ? {}
        : { final: structuredClone(state.score.final) }),
    },
  };
}

const MISSING = Symbol("missing");
type DiffValue = object | string | number | boolean | null | undefined | typeof MISSING;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function preview(value: DiffValue): SaveDiffPreview {
  if (value === MISSING) return { kind: "missing" };
  if (Array.isArray(value)) return { kind: "array", length: value.length };
  if (isRecord(value)) return { kind: "object", keys: Object.keys(value).length };
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value === undefined) return "undefined";
  return { kind: "object", keys: Reflect.ownKeys(value).length };
}

function asDiffValue(value: unknown): DiffValue {
  if (
    value === null ||
    value === undefined ||
    typeof value === "object" ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "symbol") return value.description ?? "symbol";
  return "[unsupported value]";
}

function pointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPath(path: string, segment: string): string {
  return `${path}/${pointerSegment(segment)}`;
}

function sortedUnion(
  left: readonly string[],
  right: readonly string[],
): readonly string[] {
  return [...new Set([...left, ...right])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function diffSaveEnvelopes(
  leftValue: unknown,
  rightValue: unknown,
  maxChanges = 200,
): SaveDiffReport {
  if (!Number.isInteger(maxChanges) || maxChanges <= 0) {
    throw new RangeError("maxChanges must be a positive integer");
  }
  const left = loadSaveEnvelope(leftValue);
  const right = loadSaveEnvelope(rightValue);
  const changes: SaveDiffEntry[] = [];
  let totalChanges = 0;
  const add = (path: string, before: DiffValue, after: DiffValue): void => {
    totalChanges += 1;
    if (changes.length >= maxChanges) return;
    changes.push({
      path: path.length === 0 ? "/" : path,
      kind: before === MISSING ? "added" : after === MISSING ? "removed" : "changed",
      before: preview(before),
      after: preview(after),
    });
  };
  const visit = (path: string, before: DiffValue, after: DiffValue): void => {
    if (before === MISSING && after === MISSING) return;
    if (before !== MISSING && after !== MISSING && Object.is(before, after)) return;

    if (Array.isArray(before) || Array.isArray(after)) {
      if (!Array.isArray(before) || !Array.isArray(after)) {
        add(path, before, after);
        return;
      }
      const beforeArray = before as readonly unknown[];
      const afterArray = after as readonly unknown[];
      const length = Math.max(beforeArray.length, afterArray.length);
      if (length === 0) return;
      for (let index = 0; index < length; index += 1) {
        visit(
          childPath(path, String(index)),
          index < beforeArray.length ? asDiffValue(beforeArray[index]) : MISSING,
          index < afterArray.length ? asDiffValue(afterArray[index]) : MISSING,
        );
      }
      return;
    }

    if (isRecord(before) || isRecord(after)) {
      if (!isRecord(before) || !isRecord(after)) {
        if (before === MISSING && isRecord(after)) {
          const keys = Object.keys(after).sort();
          if (keys.length === 0) add(path, before, after);
          else
            keys.forEach((key) =>
              visit(childPath(path, key), MISSING, asDiffValue(after[key])),
            );
          return;
        }
        if (after === MISSING && isRecord(before)) {
          const keys = Object.keys(before).sort();
          if (keys.length === 0) add(path, before, after);
          else
            keys.forEach((key) =>
              visit(childPath(path, key), asDiffValue(before[key]), MISSING),
            );
          return;
        }
        add(path, before, after);
        return;
      }
      for (const key of sortedUnion(Object.keys(before), Object.keys(after))) {
        visit(
          childPath(path, key),
          Object.hasOwn(before, key) ? asDiffValue(before[key]) : MISSING,
          Object.hasOwn(after, key) ? asDiffValue(after[key]) : MISSING,
        );
      }
      return;
    }

    add(path, before, after);
  };
  visit("", left.state, right.state);
  return {
    reportFormat: 1,
    privileged: true,
    left: {
      saveId: left.envelope.saveId,
      stateHash: stateHash(left.state),
      tick: left.state.run.tick,
    },
    right: {
      saveId: right.envelope.saveId,
      stateHash: stateHash(right.state),
      tick: right.state.run.tick,
    },
    totalChanges,
    returnedChanges: changes.length,
    truncated: totalChanges > changes.length,
    changes,
  };
}

export function formatSaveInspection(report: SaveInspectionReport): string {
  const migration =
    report.migration.applied.length === 0
      ? "identity"
      : report.migration.applied.join(", ");
  return [
    `${report.envelope.displayName} (${report.envelope.saveId})`,
    `Run ${report.run.runId} · ${report.run.status}/${report.run.phase} · tick ${String(report.run.tick)} · ${String(report.run.calendar.year)} W${String(report.run.calendar.week)}`,
    `Versions save ${String(report.envelope.saveVersion)}→${String(report.migration.targetVersion)} (${migration}) · engine ${report.envelope.engineRulesVersion} · content ${report.envelope.contentVersion}`,
    `Integrity checksum ${report.envelope.checksum.slice(0, 12)}… · state ${report.stateHash.slice(0, 12)}…`,
    `Player ${report.playerLab.definitionId} · $${report.playerLab.cashMillions.toFixed(2)}m · ${String(report.playerLab.physicalGpus)} GPUs · Aura ${report.playerLab.auraSpendable.toFixed(1)}/${report.playerLab.auraLifetime.toFixed(1)}`,
    `Research ${report.playerLab.capabilityResearchPoints.toFixed(1)} capability / ${report.playerLab.safetyResearchPoints.toFixed(1)} safety · ${String(report.playerLab.discoveredPapers)} papers`,
    `Entities ${String(report.counts.labs)} labs · ${String(report.counts.models)} models · ${String(report.counts.researchers)} researchers · ${String(report.playerLab.facilities)} player facilities`,
    `Endgame ${report.endgame.stage} · Score ${report.score.currentRawTotal.toFixed(0)}${report.score.final === undefined ? "" : ` (final ${report.score.final.adjustedScore.toFixed(0)})`}`,
    "PRIVILEGED: model truth and hidden institutional fields are included in JSON output.",
  ].join("\n");
}

function diffValue(value: SaveDiffPreview): string {
  return typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value);
}

export function formatSaveDiff(report: SaveDiffReport): string {
  const header = `${report.left.saveId} @ ${String(report.left.tick)} → ${report.right.saveId} @ ${String(report.right.tick)}: ${String(report.totalChanges)} change${report.totalChanges === 1 ? "" : "s"}`;
  const lines = report.changes.map(
    (change) =>
      `${change.kind.toUpperCase()} ${change.path}: ${diffValue(change.before)} → ${diffValue(change.after)}`,
  );
  if (report.truncated) {
    lines.push(
      `… ${String(report.totalChanges - report.returnedChanges)} additional changes omitted`,
    );
  }
  return [header, ...lines].join("\n");
}
