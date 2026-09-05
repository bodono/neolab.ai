import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { buildPlaytestReport } from "./report.ts";
import { playtestSessionSchema, type PlaytestSession } from "./schema.ts";

function option(args: readonly string[], flag: string, fallback: string): string {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : (args[index + 1] ?? fallback);
}

const args = process.argv.slice(2);
const sessionsDirectory = resolve(
  process.cwd(),
  option(args, "--sessions", "../../playtests/sessions"),
);
const outputPath = resolve(
  process.cwd(),
  option(args, "--output", "../../artifacts/playtests/report.json"),
);
const minimumSessions = Number(option(args, "--minimum-sessions", "5"));
if (!Number.isInteger(minimumSessions) || minimumSessions <= 0) {
  throw new Error("--minimum-sessions must be a positive integer");
}

const files = readdirSync(sessionsDirectory)
  .filter((file) => file.endsWith(".json"))
  .sort();
const sessions: PlaytestSession[] = [];
const failures: string[] = [];
for (const file of files) {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolve(sessionsDirectory, file), "utf8")) as unknown;
  } catch (error) {
    failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  const parsed = playtestSessionSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      failures.push(`${file}:${issue.path.join(".")}: ${issue.message}`);
    }
    continue;
  }
  sessions.push(parsed.data);
}
if (failures.length > 0) {
  throw new Error(`Invalid playtest evidence:\n${failures.join("\n")}`);
}

const report = buildPlaytestReport(sessions, minimumSessions);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(
  `playtests: ${String(report.completedSessionIds.length)} complete, ` +
    `${String(report.draftSessionIds.length)} draft; ${report.gateStatus} -> ${outputPath}\n`,
);
if (args.includes("--require-gate") && report.gateStatus !== "ready-for-manual-review") {
  process.exitCode = 1;
}
