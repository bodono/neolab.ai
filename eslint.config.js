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
      ".claude/worktrees/**",
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
  // Tests and dev scripts are exempt: they legitimately construct forbidden
  // values (e.g. new Date) to prove the guards reject them.
  {
    files: ["packages/sim/**/*.ts"],
    ignores: ["packages/sim/**/__tests__/**", "packages/sim/scripts/**"],
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
        {
          name: "Date",
          message: "sim never reads clocks; timestamps are injected (TDD 10.1, 24.1).",
        },
        {
          name: "performance",
          message: "sim never reads clocks (TDD 10.1); the runtime clock lives in web.",
        },
        {
          name: "crypto",
          message: "sim randomness comes only from the keyed RandomOracle (TDD 10.1).",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message: "Use the keyed RandomOracle (TDD 10.1) — never Math.random.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='localeCompare']",
          message:
            "localeCompare is locale-dependent; use code-point comparison for determinism.",
        },
        {
          selector: "CallExpression[callee.property.name=/^toLocale/]",
          message: "toLocale* output is environment-dependent; format in the UI layer.",
        },
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
          paths: [
            {
              name: "@neolab/sim",
              message:
                "UI code imports @neolab/sim/public only (TDD 33.1); internals are off limits.",
            },
          ],
          patterns: [
            {
              regex: "^@neolab/sim/(?!public$)",
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

  // The browser runtime is the sole trusted owner of canonical state. It may
  // invoke the guarded audit projection after a run ends; React/UI modules
  // still cannot import the privileged surface or canonical state.
  {
    files: ["apps/web/src/runtime/browser-game-runtime.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@neolab/sim",
              message: "Use the explicit public or guarded debug export path.",
            },
          ],
          patterns: [
            {
              regex: "^@neolab/sim/(?!public$|debug$)",
              message: "The browser runtime may import only sim public and debug paths.",
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

  // A dynamically imported development-only panel is the sole UI module
  // allowed to consume privileged diagnostics. Production audit proves its
  // sentinel is absent from emitted bytes.
  {
    files: ["apps/web/src/features/developer/development-inspector.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@neolab/sim",
              message: "Use the explicit public or debug export path.",
            },
          ],
          patterns: [
            {
              regex: "^@neolab/sim/(?!public$|debug$)",
              message:
                "The development inspector may import only public and debug paths.",
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

  // --- the Zustand bridge is a player-view cache, never a second game engine.
  // App/UI modules may use command TYPES, but canonical state creation and all
  // mutation functions stay behind BrowserGameRuntime (TDD 21.1).
  {
    files: ["apps/web/src/app/**/*.ts", "apps/web/src/app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@neolab/sim",
              message:
                "UI code imports @neolab/sim/public only (TDD 33.1); internals are off limits.",
            },
            {
              name: "@neolab/sim/public",
              importNames: ["advanceOneTick", "applyCommand", "createNewGame"],
              message:
                "App stores and components must dispatch through BrowserGameRuntime; " +
                "they never own or mutate canonical game state (TDD 21.1).",
            },
          ],
          patterns: [
            {
              regex: "^@neolab/sim/(?!public$)",
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
              // Direct imports AND the barrels/self-reference that re-export
              // selectors (review finding: barrel bypass).
              group: [
                "**/selectors/**",
                "../public.ts",
                "../../public.ts",
                "../index.ts",
                "../../index.ts",
                "@neolab/sim",
                "@neolab/sim/*",
              ],
              message:
                "Simulation rules cannot read selector projections (score or any " +
                "player view) — outcomes must never depend on them (TDD 18.5, 20.2). " +
                "Import concrete modules, never the sim barrels.",
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
