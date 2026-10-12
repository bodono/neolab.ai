import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { validateCompiledContent, type CompiledContent } from "@neolab/content-schema";

import rawBundle from "../../../../content/generated/content.bundle.json";

import { endgameClockStopReason } from "../../endgame/clock-policy.ts";
import { advanceOneTick } from "../../engine/advance-tick.ts";
import { collectInvariantViolations } from "../../engine/invariants.ts";
import { SAVE_VERSION, type GameState } from "../../model/state.ts";
import { projectGameView } from "../../selectors/game-view.ts";
import { loadSaveEnvelope } from "../envelope.ts";

/**
 * Real exported saves from each public release, loaded through the same
 * checksum, migration, schema and invariant pipeline as the browser. See
 * docs/save-compatibility.md: these bytes are evidence and are never rewritten.
 */

const content: CompiledContent = validateCompiledContent(rawBundle);
const FIXTURES = new URL("../__fixtures__/", import.meta.url);
const PLAY_ON_WEEKS = 52;

interface ArchiveManifest {
  readonly release: string;
  readonly saveVersion: number;
  readonly files: Readonly<
    Record<
      string,
      {
        readonly sha256: string;
        readonly tick: number;
        readonly status: string;
        readonly endgameStage: string;
      }
    >
  >;
}

function playerView(state: GameState): unknown {
  const lab = state.labs[state.run.playerLabId];
  const models = lab?.models.modelIds.map((modelId) => state.models[modelId]) ?? [];
  return projectGameView(state, content, {
    viewerLabId: state.run.playerLabId,
    intelligenceRatings: {},
    evidenceAccess: {
      evaluationIds: models.flatMap((model) => model?.evaluations ?? []),
      anomalyIds: models.flatMap((model) => model?.anomalies ?? []),
    },
  });
}

const archives = readdirSync(FIXTURES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

describe.each(archives)("saves exported by %s", (archive) => {
  const directory = new URL(`${archive}/`, FIXTURES);
  const manifest = JSON.parse(
    readFileSync(new URL("manifest.json", directory), "utf8"),
  ) as ArchiveManifest;

  it.each(Object.entries(manifest.files))(
    "%s loads and plays on for a year",
    (file, expected) => {
      const bytes = gunzipSync(readFileSync(new URL(file, directory)));
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.sha256);

      const loaded = loadSaveEnvelope(JSON.parse(bytes.toString("utf8")));
      expect(loaded.migration.sourceVersion).toBe(manifest.saveVersion);
      let state = loaded.state;
      expect(state.saveVersion).toBe(SAVE_VERSION);
      expect(state.run.tick).toBe(expected.tick);
      expect(state.run.status).toBe(expected.status);
      expect(state.endgame.stage).toBe(expected.endgameStage);
      expect(() => playerView(state)).not.toThrow();

      // Play on without player input until the run ends, a decision stops the
      // clock, or a year passes.
      for (
        let week = 0;
        week < PLAY_ON_WEEKS &&
        state.run.status === "active" &&
        endgameClockStopReason(state) === undefined;
        week += 1
      ) {
        state = advanceOneTick(state, content).state;
      }
      expect(collectInvariantViolations(state)).toEqual([]);
      expect(() => playerView(state)).not.toThrow();
    },
    120_000,
  );
});
