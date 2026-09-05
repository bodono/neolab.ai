import { defineConfig } from "vitest/config";

import { sharedTestConfig } from "./vitest.shared.ts";

export default defineConfig({
  test: {
    projects: ["apps/*/vitest.config.ts", "packages/*", "tools/*"],
    passWithNoTests: true,
    // Applies to anything run from the root directly. Projects matched by the
    // globs above do NOT inherit it -- see vitest.shared.ts -- so each carries
    // its own vitest.config.ts.
    ...sharedTestConfig,
  },
});
