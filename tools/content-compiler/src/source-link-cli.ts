import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkSourceLinks, collectSourceLinks } from "./source-links.ts";

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index < 0 ? undefined : process.argv[index + 1];
}

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const contentRoot = resolve(valueAfter("--content") ?? join(repoRoot, "content"));
const output = resolve(
  valueAfter("--output") ?? join(repoRoot, "artifacts", "content", "source-links.json"),
);
const concurrency = Number(valueAfter("--concurrency") ?? "4");
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
  throw new Error("--concurrency must be an integer from 1 to 16");
}

const candidates = collectSourceLinks(contentRoot);
const report = await checkSourceLinks(candidates, {
  checkedAt: new Date().toISOString(),
  concurrency,
});
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);

const { summary } = report;
process.stdout.write(
  `source links: ${String(summary.total)} checked; ${String(summary.reachable)} reachable, ` +
    `${String(summary.restricted)} restricted, ${String(summary.broken)} broken, ` +
    `${String(summary["transient-error"])} transient, ${String(summary.unsafe)} unsafe -> ${output}\n`,
);
for (const link of report.links.filter(
  ({ status }) => status !== "reachable" && status !== "restricted",
)) {
  process.stdout.write(
    `warning: ${link.status}: ${link.url}${link.httpStatus === undefined ? "" : ` (${String(link.httpStatus)})`}\n`,
  );
}
