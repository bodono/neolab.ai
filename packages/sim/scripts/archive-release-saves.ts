/**
 * Archives exported save envelopes for a public release so later releases can
 * prove they still load them (docs/save-compatibility.md).
 *
 *   node packages/sim/scripts/archive-release-saves.ts v0.0.20
 *
 * Run it from the exact release commit after `pnpm content:build`. It refuses
 * to touch an archive that already exists: those bytes are evidence.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { validateCompiledContent } from "@neolab/content-schema";

import { createProgressiveNewGame } from "../src/campaign/lab-maturity.ts";
import { createEndgamePlaytestState } from "../src/developer/scenarios.ts";
import { advanceOneTick } from "../src/engine/advance-tick.ts";
import { createNewGame, type NewGameConfig } from "../src/engine/create-new-game.ts";
import { SAVE_VERSION, type GameState } from "../src/model/state.ts";
import { createSaveEnvelope } from "../src/persistence/envelope.ts";
import { seed128 } from "../src/random/seed.ts";

const release = process.argv[2];
if (release === undefined || !/^v\d+\.\d+\.\d+$/.test(release)) {
  throw new Error("Usage: archive-release-saves.ts vMAJOR.MINOR.PATCH");
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const directory = join(root, "packages/sim/src/persistence/__fixtures__", release);
if (existsSync(directory)) {
  throw new Error(`${directory} already exists; archived saves are never rewritten`);
}
const content = validateCompiledContent(
  JSON.parse(
    readFileSync(join(root, "packages/content/generated/content.bundle.json"), "utf8"),
  ),
);

const config = {
  seed: seed128("2026a0c1b2d3e4f50617283940a5b6c7"),
  difficultyId: "base:difficulty.standard",
  leaderId: "base:leader.liang-wenfang",
  mandateId: "base:mandate.build-the-business",
} as unknown as NewGameConfig;

function advance(state: GameState, weeks: number): GameState {
  let current = state;
  for (let week = 0; week < weeks && current.run.status === "active"; week += 1) {
    current = advanceOneTick(current, content).state;
  }
  return current;
}

const saves: Record<string, GameState> = {
  "classic-opening": createNewGame(config, content),
  "classic-year-one": advance(createNewGame(config, content), 52),
  "classic-finished-loss": advance(createNewGame(config, content), 1_000),
  "guided-garage": advance(createProgressiveNewGame(config, content), 52),
  "endgame-candidate": advance(createEndgamePlaytestState(content, "endgame"), 8),
  "endgame-confirmation": createEndgamePlaytestState(content, "endgame-disputed-proof"),
  "endgame-recovery": createEndgamePlaytestState(content, "endgame-recovery"),
  "endgame-rollout": advance(
    createEndgamePlaytestState(content, "endgame-route-twist"),
    8,
  ),
};

mkdirSync(directory, { recursive: true });
const files: Record<string, unknown> = {};
for (const [name, state] of Object.entries(saves)) {
  const envelope = createSaveEnvelope(state, {
    saveId: `${release}-${name}`,
    slotType: "manual",
    displayName: `${release} ${name}`,
    contentHash: content.manifest.bundleHash,
    nowIso: new Date().toISOString(),
  });
  const bytes = Buffer.from(JSON.stringify(envelope));
  writeFileSync(join(directory, `${name}.json.gz`), gzipSync(bytes));
  files[`${name}.json.gz`] = {
    sha256: createHash("sha256").update(bytes).digest("hex"),
    tick: state.run.tick,
    status: state.run.status,
    endgameStage: state.endgame.stage,
    engineRulesVersion: state.engineRulesVersion,
  };
}
writeFileSync(
  join(directory, "manifest.json"),
  `${JSON.stringify({ release, saveVersion: SAVE_VERSION, files }, null, 2)}\n`,
);
console.log(`Archived ${String(Object.keys(files).length)} saves in ${directory}`);
