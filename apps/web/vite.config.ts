import react from "@vitejs/plugin-react";
import { copyFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const WEB_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_DIRECTORY = resolve(WEB_DIRECTORY, "../..");
const LEGAL_FILES = [
  "LICENSE",
  "COPYRIGHT.md",
  "CONTRIBUTING.md",
  "DISCLAIMER.md",
  "THIRD_PARTY_NOTICES.md",
] as const;
const LEGAL_BUNDLE_BANNER = `/*!
 * Neolab.ai — proprietary software and content.
 * Copyright © 2026 Brendan O'Donoghue. All rights reserved.
 * Licensed, not sold, under the Neolab.ai Proprietary Software and Content Licence.
 * See the LICENSE file distributed with this build for the complete terms.
 */`;

function legalFilePath(fileName: (typeof LEGAL_FILES)[number]): string {
  return resolve(REPOSITORY_DIRECTORY, fileName);
}

function deploymentBasePath(): string {
  const configured = process.env["NEOLAB_BASE_PATH"]?.trim() ?? "/";
  if (configured === "./") return configured;
  if (
    !configured.startsWith("/") ||
    configured.includes("//") ||
    configured.includes("..")
  ) {
    throw new Error(
      `NEOLAB_BASE_PATH must be root, a canonical project path, or "./": ${configured}`,
    );
  }
  return configured.endsWith("/") ? configured : `${configured}/`;
}

export default defineConfig({
  base: deploymentBasePath(),
  // Listen on the LAN, not just localhost, so `pnpm dev` on one machine is
  // reachable from another on the same network — open the mini's Bonjour name,
  // e.g. http://brendans-mac-mini.local:5173, from the MacBook. allowedHosts
  // clears Vite's host-rebinding guard for Bonjour names (a leading dot covers
  // the domain and every *.local host). Dev only; the build is unaffected.
  server: { host: true, allowedHosts: [".local"] },
  plugins: [
    react(),
    {
      name: "neolab-legal-files",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const requested = request.url?.split("?")[0]?.replace(/^\//, "");
          const fileName = LEGAL_FILES.find((candidate) => candidate === requested);
          if (fileName === undefined) {
            next();
            return;
          }
          response.statusCode = 200;
          response.setHeader(
            "Content-Type",
            fileName.endsWith(".md")
              ? "text/markdown; charset=utf-8"
              : "text/plain; charset=utf-8",
          );
          response.end(readFileSync(legalFilePath(fileName)));
        });
      },
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type === "chunk") {
            output.code = `${LEGAL_BUNDLE_BANNER}\n${output.code}`;
          }
        }
      },
      writeBundle(options) {
        if (options.dir === undefined) {
          throw new Error("Vite build has no output directory for legal files");
        }
        for (const fileName of LEGAL_FILES) {
          copyFileSync(legalFilePath(fileName), resolve(options.dir, fileName));
        }
      },
    },
  ],
});
