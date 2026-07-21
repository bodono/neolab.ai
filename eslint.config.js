// @ts-check
import tseslint from "typescript-eslint";

/**
 * Architectural boundaries (TDD sections 4.1 and 3.1) are enforced here:
 *  - `sim` must stay browser- and UI-free.
 *  - the web app may only use `@neolab/sim/public`.
 *  - simulation and content code may not weaken the type system.
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "packages/content/generated/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // --- sim stays pure: no UI libraries, no browser globals, no web app code.
  {
    files: ["packages/sim/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "sim must not depend on React (TDD 4.1)." },
            { name: "react-dom", message: "sim must not depend on React (TDD 4.1)." },
            { name: "zustand", message: "sim must not depend on Zustand (TDD 4.1)." },
          ],
          patterns: [
            {
              group: ["react/*", "react-dom/*", "zustand/*", "**/apps/web/**"],
              message: "sim must not import UI or web-app code (TDD 4.1).",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "sim must not touch browser APIs (TDD 4.1)." },
        { name: "document", message: "sim must not touch browser APIs (TDD 4.1)." },
        { name: "navigator", message: "sim must not touch browser APIs (TDD 4.1)." },
        { name: "localStorage", message: "sim must not touch browser APIs (TDD 4.1)." },
        { name: "indexedDB", message: "sim must not touch browser APIs (TDD 4.1)." },
        { name: "fetch", message: "sim must not touch the network (TDD 4.1)." },
      ],
    },
  },

  // --- the web app may import only the public sim surface.
  {
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@neolab/sim", "@neolab/sim/*", "!@neolab/sim/public"],
              message:
                "UI code imports @neolab/sim/public only (TDD 33.1); internals are off limits.",
            },
            {
              group: ["**/packages/sim/**"],
              message: "Do not deep-import sim sources from the web app (TDD 4.1).",
            },
          ],
        },
      ],
    },
  },

  // --- score never feeds back into the simulation (TDD 18.5): rule code in
  // engine/, commands/, and future systems/ may write score via awardScore but
  // can never read projections. Selectors are one-way, read-only outputs.
  {
    files: [
      "packages/sim/src/engine/**/*.ts",
      "packages/sim/src/commands/**/*.ts",
      "packages/sim/src/systems/**/*.ts",
    ],
    ignores: ["packages/sim/src/**/__tests__/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/selectors/**"],
              message:
                "Simulation rules cannot read selector projections (score or any " +
                "player view) — outcomes must never depend on them (TDD 18.5, 20.2).",
            },
          ],
        },
      ],
    },
  },

  // --- simulation and content code: no type-system escape hatches.
  {
    files: [
      "packages/sim/**/*.ts",
      "packages/content-schema/**/*.ts",
      "packages/content/**/*.ts",
      "tools/content-compiler/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-expect-error": "allow-with-description",
        },
      ],
    },
  },
);
