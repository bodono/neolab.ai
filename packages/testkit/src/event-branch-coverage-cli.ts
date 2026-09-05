import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadCompiledContent } from "@neolab/content";

import { buildEventBranchCoverageReport } from "./event-branch-coverage.ts";

function outputPath(argv: readonly string[]): string {
  const index = argv.indexOf("--output");
  const value = index === -1 ? undefined : argv[index + 1];
  return resolve(value ?? "../../artifacts/content/event-branch-coverage.json");
}

const output = outputPath(process.argv.slice(2));
const report = buildEventBranchCoverageReport(loadCompiledContent());
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.status === "empty") {
  console.log(`event branches: catalogue empty; evidence written to ${output}`);
} else {
  console.log(
    `event branches: ${String(report.counts.covered)}/${String(report.counts.branches)} covered (${report.status}); evidence written to ${output}`,
  );
}
if (report.status === "incomplete") process.exitCode = 1;
