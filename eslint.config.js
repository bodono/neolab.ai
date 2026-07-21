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
