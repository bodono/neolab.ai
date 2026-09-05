import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { CriticalAutonomyConfirmationDialog } from "./critical-autonomy-confirmation-dialog.tsx";

describe("critical autonomy confirmation", () => {
  it.each([
    [4, "Laboratory operator", "GRANT LAB CONTROL"],
    [5, "Root and external network", "GRANT ROOT ACCESS"],
  ] as const)(
    "uses the established typed-command danger dialog for level %i",
    (level, displayName, phrase) => {
      const markup = renderToStaticMarkup(
        createElement(CriticalAutonomyConfirmationDialog, {
          confirmationPhrase: phrase,
          displayName,
          exposedSystems: ["Laboratory controls", "Credential store"],
          level,
          onCancel: vi.fn(),
          onConfirm: vi.fn(),
        }),
      );

      expect(markup).toContain("critical-access-backdrop");
      expect(markup).toContain("critical-access-dialog");
      expect(markup).toContain("CRITICAL PERMISSION CHANGE");
      expect(markup).toContain(`Type <strong>${phrase}</strong> to confirm`);
      expect(markup).toContain('class="danger"');
      expect(markup).toContain("Confirm critical access");
      expect(markup).toContain("disabled");
    },
  );
});
