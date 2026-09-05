import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { compileContent } from "./compile.ts";
import { ContentFileError } from "./yaml-io.ts";

const repoRoot = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");

try {
  const { bundle, outputPath, report, reportPath } = compileContent(repoRoot);
  console.log(
    `content: compiled version ${bundle.manifest.contentVersion} ` +
      `(hash ${bundle.manifest.bundleHash.slice(0, 12)}…) -> ${outputPath}; ` +
      `report ${String(report.summary.releaseBlocking)} blocking / ` +
      `${String(report.summary.warnings)} warnings / ` +
      `${String(report.quotaAnalysis.gaps.length)} quota gaps / ` +
      `${String(report.reviewAnalysis.gaps.length)} review gaps / ` +
      `${String(report.assetAnalysis.missingReferences.length)} asset gaps -> ${reportPath}`,
  );
} catch (error) {
  if (error instanceof ContentFileError) {
    console.error(`content error: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
