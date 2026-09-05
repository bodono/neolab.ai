import { SAVE_VERSION } from "../model/state.ts";
import { randomKey } from "../random/key.ts";
import { RandomOracleV1 } from "../random/oracle.ts";
import { seed128 } from "../random/seed.ts";

export interface MigrationContext {
  /** Reserved for future content-ID renames supplied by the active manifest. */
  readonly contentAliases: Readonly<Record<string, string>>;
}

export interface SaveMigration<From = unknown, To = unknown> {
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(input: From, context: MigrationContext): To;
}

export interface SaveMigrationResult {
  readonly state: unknown;
  readonly sourceVersion: number;
  readonly targetVersion: number;
  readonly applied: readonly string[];
}

const DEFAULT_CONTEXT: MigrationContext = Object.freeze({ contentAliases: {} });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readVersion(value: unknown): number {
  if (!isRecord(value)) throw new Error("save state is not an object");
  const version = value["saveVersion"];
  if (!Number.isInteger(version) || Number(version) < 1) {
    throw new Error("save state has no supported saveVersion");
  }
  return Number(version);
}

/**
 * Remove fields written by short-lived development builds which never became
 * part of a numbered save format. Browser IndexedDB outlives dev-server and
 * kernel restarts, so these fields must be retired before strict validation
 * even when the saveVersion already matches the current engine.
 */
function repairRetiredDevelopmentFields(input: unknown): {
  readonly state: unknown;
  readonly applied: readonly string[];
} {
  if (!isRecord(input)) return { state: input, applied: [] };
  const clone = structuredClone(input);
  const applied = new Set<string>();

  const labs = clone["labs"];
  if (isRecord(labs)) {
    for (const labValue of Object.values(labs)) {
      if (!isRecord(labValue)) continue;
      const facilities = labValue["facilities"];
      if (isRecord(facilities)) {
        const instances = facilities["instances"];
        if (Array.isArray(instances)) {
          for (const instance of instances) {
            if (
              isRecord(instance) &&
              Object.prototype.hasOwnProperty.call(instance, "constructionCrewBonus")
            ) {
              delete instance["constructionCrewBonus"];
              applied.add("repair:retired-construction-crew-bonus");
            }
          }
        }
      }
      const organisation = labValue["organisation"];
      if (
        isRecord(organisation) &&
        Object.prototype.hasOwnProperty.call(organisation, "managementCapacity")
      ) {
        delete organisation["managementCapacity"];
        applied.add("repair:retired-management-capacity");
      }
      if (
        isRecord(organisation) &&
        Object.prototype.hasOwnProperty.call(organisation, "engineeringQuality")
      ) {
        delete organisation["engineeringQuality"];
        applied.add("repair:retired-engineering-quality");
      }
      const flags = labValue["flags"];
      if (
        isRecord(flags) &&
        Object.prototype.hasOwnProperty.call(flags, "rating-target:engineeringQuality")
      ) {
        delete flags["rating-target:engineeringQuality"];
        applied.add("repair:retired-engineering-quality");
      }
    }
  }

  const projects = clone["projects"];
  if (isRecord(projects)) {
    for (const projectValue of Object.values(projects)) {
      if (!isRecord(projectValue)) continue;
      const reservations = projectValue["reservations"];
      if (
        isRecord(reservations) &&
        Object.prototype.hasOwnProperty.call(reservations, "crisisProjectSlots")
      ) {
        // Crisis reservations moved to the unified major-project pool. A
        // crisis project saved under the old shape reserved no major slot,
        // so it claims one now.
        if (Number(reservations["crisisProjectSlots"]) > 0) {
          reservations["majorProjectSlots"] = Math.max(
            1,
            Number(reservations["majorProjectSlots"]) || 0,
          );
        }
        delete reservations["crisisProjectSlots"];
        applied.add("repair:retired-crisis-project-slots");
      }
    }
  }

  if (applied.size === 0) return { state: input, applied: [] };
  return { state: clone, applied: [...applied].sort() };
}

/**
 * The v1→v2 bump introduced the global researcher registry. Pre-v2 saves had
 * empty lab rosters, so an empty registry preserves their mechanical state;
 * the talent market can then use its schema default until a later refresh.
 */
const migrateV1ToV2: SaveMigration = Object.freeze({
  fromVersion: 1,
  toVersion: 2,
  migrate(input: unknown): unknown {
    if (!isRecord(input)) throw new Error("v1 save state is not an object");
    const clone = structuredClone(input);
    clone["saveVersion"] = 2;
    clone["researchers"] ??= {};
    return clone;
  },
});

/**
 * V3 replaces the Stage 2 scripted paper opponent with the four canonical
 * rival labs and adds intelligence-filtered public signals.
 */
const migrateV2ToV3: SaveMigration = Object.freeze({
  fromVersion: 2,
  toVersion: 3,
  migrate(input: unknown): unknown {
    if (!isRecord(input)) throw new Error("v2 save state is not an object");
    const clone = structuredClone(input);
    const world = clone["world"];
    const run = clone["run"];
    if (!isRecord(world) || !isRecord(run)) {
      throw new Error("v2 save lacks world or run state");
    }
    world["rivalSignals"] ??= [];
    const rivals = world["rivals"];
    const paperRace = world["paperRace"];
    const playerLabId = run["playerLabId"];
    const seed = run["seed"];
    if (
      isRecord(rivals) &&
      Object.keys(rivals).length > 0 &&
      isRecord(paperRace) &&
      typeof playerLabId === "string" &&
      typeof seed === "string"
    ) {
      paperRace["labOrder"] = new RandomOracleV1(seed128(seed)).shuffle(
        randomKey("paper", "lab-order"),
        [playerLabId, ...Object.keys(rivals).sort()],
      );
      const labs = clone["labs"];
      if (isRecord(labs)) {
        for (const [labId, strategyValue] of Object.entries(rivals)) {
          const lab = labs[labId];
          const strategy = isRecord(strategyValue) ? strategyValue : undefined;
          const personality = isRecord(strategy?.["personality"])
            ? strategy["personality"]
            : undefined;
          const commercialGrowth = personality?.["commercialGrowth"];
          if (!isRecord(lab)) continue;
          const flags = lab["flags"];
          if (!isRecord(flags)) continue;
          flags["market:rival-incumbency-appeal"] =
            8 + (typeof commercialGrowth === "number" ? commercialGrowth : 70) * 0.1;
        }
      }
    }
    clone["saveVersion"] = 3;
    return clone;
  },
});

/**
 * V4 drops three fields that two capability reworks removed from the model
 * without a migration, so every pre-v4 save failed to load against the strict
 * schema rather than being upgraded.
 *
 * - models.*.investedEraReferenceWeeks: capability stopped being measured in
 *   era-reference weeks and became absolute FLOP (investedTotalFlop). The
 *   old figure cannot be converted -- it was normalised against whichever
 *   GPU generation was current when the run happened, which the save does not
 *   record -- so it is dropped rather than guessed at.
 * - projects.*.payload.datasetPolicyId / .safetyProtocolId: run posture stopped
 *   pointing at a dataset policy and a safety protocol. Both are now folded
 *   into the posture itself, which the payload already carries, so no
 *   information is lost.
 */
const migrateV3ToV4: SaveMigration = Object.freeze({
  fromVersion: 3,
  toVersion: 4,
  migrate(input: unknown): unknown {
    if (!isRecord(input)) throw new Error("v3 save state is not an object");
    const clone = structuredClone(input);
    const models = clone["models"];
    if (isRecord(models)) {
      for (const model of Object.values(models)) {
        if (isRecord(model)) delete model["investedEraReferenceWeeks"];
      }
    }
    const projects = clone["projects"];
    if (isRecord(projects)) {
      for (const project of Object.values(projects)) {
        if (!isRecord(project)) continue;
        const payload = project["payload"];
        if (!isRecord(payload) || payload["kind"] !== "training") continue;
        delete payload["datasetPolicyId"];
        delete payload["safetyProtocolId"];
      }
    }
    clone["saveVersion"] = 4;
    return clone;
  },
});

/**
 * V5 drops labs.*.compute.softwareEfficiency. It was authored at 1.0, set once
 * at game creation, never written again by any code path, exposed by no
 * modifier target, and shown to the player nowhere -- a permanent multiply-by-
 * one that nonetheless appeared in the documented throughput formula, so it
 * advertised a lever that could not exist.
 */
const migrateV4ToV5: SaveMigration = Object.freeze({
  fromVersion: 4,
  toVersion: 5,
  migrate(input: unknown): unknown {
    if (!isRecord(input)) throw new Error("v4 save state is not an object");
    const clone = structuredClone(input);
    const labs = clone["labs"];
    if (isRecord(labs)) {
      for (const lab of Object.values(labs)) {
        if (!isRecord(lab)) continue;
        const compute = lab["compute"];
        if (isRecord(compute)) delete compute["softwareEfficiency"];
      }
    }
    clone["saveVersion"] = 5;
    return clone;
  },
});

export const SAVE_MIGRATIONS: readonly SaveMigration[] = Object.freeze([
  migrateV1ToV2,
  migrateV2ToV3,
  migrateV3ToV4,
  migrateV4ToV5,
]);

/** Pure sequential migration. Current-version inputs are returned unchanged. */
export function migrateSaveState(
  input: unknown,
  context: MigrationContext = DEFAULT_CONTEXT,
): SaveMigrationResult {
  const sourceVersion = readVersion(input);
  if (sourceVersion < SAVE_VERSION) {
    throw new Error("This save predates the endgame redesign");
  }
  if (sourceVersion > SAVE_VERSION) {
    throw new Error(
      `save version ${String(sourceVersion)} is newer than supported version ${String(SAVE_VERSION)}`,
    );
  }
  let state = input;
  let version = sourceVersion;
  const applied: string[] = [];
  while (version < SAVE_VERSION) {
    const migration = SAVE_MIGRATIONS.find(
      (candidate) => candidate.fromVersion === version,
    );
    if (migration === undefined || migration.toVersion <= version) {
      throw new Error(`no safe migration path from save version ${String(version)}`);
    }
    state = migration.migrate(state, context);
    const migratedVersion = readVersion(state);
    if (migratedVersion !== migration.toVersion) {
      throw new Error(
        `migration ${String(version)}→${String(migration.toVersion)} produced version ${String(migratedVersion)}`,
      );
    }
    applied.push(`${String(version)}→${String(migration.toVersion)}`);
    version = migration.toVersion;
  }
  const repaired = repairRetiredDevelopmentFields(state);
  state = repaired.state;
  applied.push(...repaired.applied);
  return Object.freeze({
    state,
    sourceVersion,
    targetVersion: version,
    applied: Object.freeze(applied),
  });
}
