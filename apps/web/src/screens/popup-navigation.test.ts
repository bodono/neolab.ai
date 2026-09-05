import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./game-shell.tsx", import.meta.url), "utf8");

describe("popup navigation", () => {
  it("keeps paper decisions on the page that opened the popup", () => {
    const start = source.indexOf("if (unacknowledgedPlayerPaper !== undefined)");
    const end = source.indexOf("const pendingResearchDirection", start);
    const paperDiscoveryOverlay = source.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(paperDiscoveryOverlay).toContain("onAcknowledge={markAcknowledged}");
    expect(paperDiscoveryOverlay).toContain("onPublicationChosen={markAcknowledged}");
    expect(paperDiscoveryOverlay).not.toContain("navigateSection(");
    expect(paperDiscoveryOverlay).not.toContain("revealAttentionPanel(");
  });
});
