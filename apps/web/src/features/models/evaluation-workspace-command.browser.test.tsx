import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../styles/game.css";
import { EvaluationWorkspaceCommand } from "./models-workspace.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("EvaluationWorkspaceCommand in Chromium", () => {
  let root: Root;
  let mount: HTMLDivElement;

  beforeEach(() => {
    document.body.innerHTML = "<div id='mount'></div>";
    mount = document.querySelector<HTMLDivElement>("#mount")!;
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
  });

  it("presents one safety workspace and opens evaluation commissioning", () => {
    const onRunEvaluations = vi.fn();

    act(() =>
      root.render(
        <EvaluationWorkspaceCommand
          activeProjectCount={0}
          modelName="Aquarius-7"
          modelSummary="Tier 7 · capability 90"
          onRunEvaluations={onRunEvaluations}
          safetyCaseScore={62}
          warningCount={1}
        />,
      ),
    );

    expect(mount.querySelector("[role='tablist']")).toBeNull();
    expect(mount.textContent).toContain("Safety & evaluations");
    expect(mount.textContent).toContain("1 open warning");
    expect(mount.textContent).toContain("READY TO COMMISSION");

    const buttons = [...mount.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons).toHaveLength(1);
    const runButton = buttons[0];
    expect(runButton?.closest(".panel-heading")).not.toBeNull();
    expect(
      getComputedStyle(mount.querySelector<HTMLElement>(".evaluation-workspace-command")!)
        .order,
    ).toBe("-1");
    act(() => runButton?.click());
    expect(onRunEvaluations).toHaveBeenCalledOnce();
  });
});
