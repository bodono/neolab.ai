import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { MAX_SAVE_IMPORT_BYTES } from "@neolab/sim";

import {
  diffSaveEnvelopes,
  formatSaveDiff,
  formatSaveInspection,
  inspectSaveEnvelope,
} from "./inspector.ts";

interface CliOptions {
  readonly files: readonly string[];
  readonly json: boolean;
  readonly output?: string;
  readonly maxChanges: number;
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm save:inspect -- SAVE.json [--json] [--output REPORT.json]",
    "  pnpm save:inspect -- LEFT.json RIGHT.json [--json] [--max-changes N] [--output DIFF.json]",
    "",
    "One file is migrated, checksum/schema/invariant validated, and summarised.",
    "Two files are validated then compared as migrated canonical states.",
    "JSON output is privileged developer evidence and includes hidden model truth.",
  ].join("\n");
}

function parseArguments(argv: readonly string[]): CliOptions {
  const files: string[] = [];
  let json = false;
  let output: string | undefined;
  let maxChanges = 200;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") continue;
    if (argument === "--json") {
      json = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (argument === "--output") {
      const value = argv[index + 1];
      if (value === undefined) throw new Error("--output requires a file path");
      output = value;
      index += 1;
      continue;
    }
    if (argument === "--max-changes") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--max-changes requires a positive integer");
      }
      maxChanges = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("-")) throw new Error(`Unknown option ${argument}`);
    if (argument !== undefined) files.push(argument);
  }
  if (files.length < 1 || files.length > 2) throw new Error(usage());
  return {
    files,
    json,
    ...(output === undefined ? {} : { output }),
    maxChanges,
  };
}

async function readSave(path: string): Promise<unknown> {
  const absolute = resolve(path);
  const metadata = await stat(absolute);
  if (!metadata.isFile()) throw new Error(`${absolute} is not a file`);
  if (metadata.size > MAX_SAVE_IMPORT_BYTES) {
    throw new Error(
      `${absolute} is ${String(metadata.size)} bytes; limit is ${String(MAX_SAVE_IMPORT_BYTES)}`,
    );
  }
  const source = await readFile(absolute, "utf8");
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(
      `${absolute} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const left = await readSave(options.files[0] ?? "");
  const report =
    options.files.length === 1
      ? inspectSaveEnvelope(left)
      : diffSaveEnvelopes(
          left,
          await readSave(options.files[1] ?? ""),
          options.maxChanges,
        );
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output !== undefined) {
    const output = resolve(options.output);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, json, "utf8");
    console.log(`Wrote ${output}`);
  }
  if (options.json) console.log(json.trimEnd());
  else if ("changes" in report) console.log(formatSaveDiff(report));
  else console.log(formatSaveInspection(report));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
