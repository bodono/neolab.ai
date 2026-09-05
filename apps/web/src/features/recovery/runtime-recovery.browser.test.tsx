import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadBrowserCompiledContent } from "@neolab/content/browser";
import { seed128, type NewGameConfig } from "@neolab/sim/public";

import { BrowserGameRuntime } from "../../runtime/index.ts";
import type { AnimationFrameScheduler } from "../../runtime/index.ts";
import { ApplicationErrorBoundary, CampusErrorBoundary } from "./runtime-recovery.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const content = loadBrowserCompiledContent();
const inertScheduler: AnimationFrameScheduler = {
  now: () => 0,
  requestFrame: () => 1,
  cancelFrame: () => undefined,
};

function firstId<T>(record: Readonly<Record<string, T>>): string {
  const id = Object.keys(record)[0];
  if (id === undefined) throw new Error("Required content is missing");
  return id;
}

function config(): NewGameConfig {
  return {
    seed: seed128("0123456789abcdef0123456789abcdef"),
    difficultyId: firstId(content.difficulties) as NewGameConfig["difficultyId"],
    leaderId: firstId(content.leaders) as NewGameConfig["leaderId"],
    mandateId: firstId(content.mandates) as NewGameConfig["mandateId"],
  };
}

function BrokenPresentation({ message }: { readonly message: string }): never {
  throw new Error(message);
}

describe("runtime recovery boundaries in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;
  let runtime: BrowserGameRuntime;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
    runtime = BrowserGameRuntime.createNew(config(), content, {
      scheduler: inertScheduler,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    runtime.dispose();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("replaces an application crash with a safe, keyboard-focused recovery surface", async () => {
    const secret = "raw-exception-text-must-stay-private";
    let downloadedDiagnostic: Blob | undefined;
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      if (blob instanceof Blob) downloadedDiagnostic = blob;
      return "blob:neolab-crash-diagnostic";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    act(() =>
      root.render(
        <ApplicationErrorBoundary runtime={runtime}>
          <BrokenPresentation message={secret} />
        </ApplicationErrorBoundary>,
      ),
    );

    const fault = runtime.getSnapshot().fault;
    expect(fault).toMatchObject({
      kind: "presentation",
      scope: "application-shell",
      code: "presentation-render-failed",
      tick: 0,
    });
    expect(runtime.getClock()).toMatchObject({
      paused: true,
      pauseReason: "runtime-fault",
    });
    expect(mount.textContent).toContain("Export emergency save");
    expect(mount.textContent).toContain("Download crash diagnostic");
    expect(mount.textContent).toContain("Report crash on GitHub");
    expect(mount.textContent).toContain("Reload Neolab.ai");
    const feedback = mount.querySelector<HTMLAnchorElement>(".runtime-recovery-feedback");
    expect(feedback?.href).toContain(
      "github.com/bodono/neolab.ai-feeback/issues/new?template=feedback.md&title=%5BCrash%5D",
    );
    expect(feedback?.href).toContain("runtime-fault%3A1");
    expect(mount.textContent).not.toContain(secret);
    expect(document.activeElement?.textContent).toContain(
      "operations console encountered an internal fault",
    );

    const diagnosticButton = [...mount.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Download crash diagnostic",
    );
    expect(diagnosticButton).toBeDefined();
    act(() => diagnosticButton?.click());
    expect(downloadedDiagnostic).toBeDefined();
    const diagnosticText = await downloadedDiagnostic?.text();
    expect(diagnosticText).toContain(secret);
    expect(diagnosticText).not.toContain('"canonicalState"');
    expect(mount.textContent).not.toContain(secret);
  });

  it("isolates the campus renderer with its own fault scope", () => {
    act(() =>
      root.render(
        <CampusErrorBoundary runtime={runtime}>
          <BrokenPresentation message="campus renderer details" />
        </CampusErrorBoundary>,
      ),
    );

    expect(runtime.getSnapshot().fault).toMatchObject({
      kind: "presentation",
      scope: "campus-renderer",
      tick: 0,
    });
    expect(mount.querySelector(".runtime-recovery-inline")).not.toBeNull();
    expect(mount.textContent).not.toContain("campus renderer details");
  });
});
