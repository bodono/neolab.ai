import type { ReactElement } from "react";

import packageMetadata from "../../package.json";

/**
 * Resolves the version the game reports about itself. A tagged build is stamped
 * with its own tag so the two can never drift: v0.0.1 shipped reporting v0.0.0
 * because this read a package version nothing bumps. Untagged builds keep
 * reporting the package version, which is what a working tree actually is.
 */
export function resolveApplicationVersion(
  taggedRef: string | undefined,
  packageVersion: string,
): string {
  const tag = taggedRef?.trim().replace(/^v/, "") ?? "";
  return tag.length === 0 ? packageVersion : tag;
}

export const APPLICATION_VERSION = resolveApplicationVersion(
  import.meta.env["VITE_RELEASE_TAG"] as string | undefined,
  packageMetadata.version,
);

export function ApplicationVersion(): ReactElement {
  return (
    <aside className="application-version" aria-label="Application version">
      <span>Neolab.ai v{APPLICATION_VERSION}</span>
      <span>
        © 2026{" "}
        <a href="https://bodono.github.io/" target="_blank" rel="noreferrer">
          Brendan O&apos;Donoghue
        </a>{" "}
        · bodonoghue85@gmail.com
      </span>
    </aside>
  );
}
