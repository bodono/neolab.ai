import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadBrowserCompiledContent } from "@neolab/content/browser";
import { seed128, type GameCommand, type NewGameConfig } from "@neolab/sim/public";

import type { AnimationFrameScheduler } from "../../runtime/index.ts";
import { BrowserGameRuntime } from "../../runtime/index.ts";
import { formatProcurementMoney, ProcurementDialog } from "./procurement-dialog.tsx";

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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set?.bind(input);
  if (setter === undefined) throw new Error("HTML input value setter is unavailable");
  act(() => {
    setter(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("GPU procurement quantities in Chromium", () => {
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
  });

  afterEach(() => {
    act(() => root.unmount());
    runtime.dispose();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("formats procurement cash in M, B, T, and Q notation", () => {
    expect(formatProcurementMoney(0.9)).toBe("$0.9M");
    expect(formatProcurementMoney(425)).toBe("$425M");
    expect(formatProcurementMoney(25_000)).toBe("$25B");
    expect(formatProcurementMoney(4_200)).toBe("$4.2B");
    expect(formatProcurementMoney(1_100_000)).toBe("$1.1T");
    expect(formatProcurementMoney(1_100_000_000)).toBe("$1.1Q");
  });

  it("allows the default 1 to be cleared and replaced before validating", () => {
    const view = runtime.getSnapshot().gameView;
    const generationId = view.compute.unlockedGenerationIds[0];
    if (generationId === undefined) throw new Error("No GPU generation is unlocked");
    const validate = vi.spyOn(runtime, "validate");

    act(() =>
      root.render(
        <ProcurementDialog
          content={content}
          runtime={runtime}
          view={view}
          onClose={vi.fn()}
        />,
      ),
    );

    const row = mount.querySelector<HTMLElement>(".procurement-row");
    const input = row?.querySelector<HTMLInputElement>('input[type="number"]');
    const actions = [...(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    if (input === undefined || input === null) {
      throw new Error("GPU quantity input is missing");
    }

    expect(mount.querySelector(".procurement-sellable-total")?.textContent).toMatch(
      /0 GPUs sellable now/,
    );
    const help = mount.querySelector<HTMLDetailsElement>(
      ".procurement-capacity-footer .mechanic-help",
    );
    expect(help?.open).toBe(false);
    act(() => help?.querySelector("summary")?.click());
    expect(help?.open).toBe(true);
    expect(help?.textContent).toContain(
      "GPUs reserved by active or queued work cannot be sold",
    );
    expect(mount.textContent).not.toContain(
      "Purchases go into any free datacentre space",
    );
    expect(row?.querySelector(".procurement-row-availability")?.textContent).toMatch(
      /Owned 0 · sellable now 0/,
    );
    expect(input.value).toBe("1");
    setInputValue(input, "");
    expect(input.value).toBe("");
    expect(actions).toHaveLength(2);
    expect(actions.every((button) => button.disabled)).toBe(true);

    validate.mockClear();
    const replacementUnits = Math.min(30, Number(input.max));
    setInputValue(input, String(replacementUnits));
    expect(input.value).toBe(String(replacementUnits));
    expect(
      validate.mock.calls.some(([command]: [GameCommand]) => {
        return (
          command.kind === "buy-gpus" &&
          command.generationId === generationId &&
          command.thousandUnits === replacementUnits
        );
      }),
    ).toBe(true);

    setInputValue(input, "");
    act(() => {
      input.focus();
      input.blur();
    });
    expect(input.value).toBe("1");
  });

  it("allows Basilica-scale transactions instead of stopping at 999,000 GPUs", () => {
    const view = runtime.getSnapshot().gameView;
    const generationId = view.compute.unlockedGenerationIds[0];
    if (generationId === undefined) throw new Error("No GPU generation is unlocked");
    const basilicaView = {
      ...view,
      compute: {
        ...view.compute,
        totalOwnedPhysicalGpus: 0,
        sellablePhysicalGpus: 0,
        pendingDeliveries: [],
        generationMix: view.compute.generationMix.map((generation) => ({
          ...generation,
          physicalGpus: 0,
          ownedPhysicalGpus: 0,
          sellablePhysicalGpus: 0,
          onlinePhysicalGpus: 0,
        })),
      },
      facilities: {
        ...view.facilities,
        capacity: {
          ...view.facilities.capacity,
          supportedOwnedGpuCount: 2_500_000,
        },
      },
    };
    const validate = vi.spyOn(runtime, "validate");

    act(() =>
      root.render(
        <ProcurementDialog
          content={content}
          runtime={runtime}
          view={basilicaView}
          onClose={vi.fn()}
        />,
      ),
    );

    const row = mount.querySelector<HTMLElement>(".procurement-row");
    const input = row?.querySelector<HTMLInputElement>('input[type="number"]');
    if (input === undefined || input === null) {
      throw new Error("GPU quantity input is missing");
    }

    expect(input.max).toBe("2500");
    setInputValue(input, "1700");
    expect(input.value).toBe("1700");
    expect(row?.querySelector<HTMLButtonElement>("button.primary")?.textContent).toMatch(
      /Buy · \$1\.5B/,
    );
    expect(
      validate.mock.calls.some(([command]: [GameCommand]) => {
        return command.kind === "buy-gpus" && command.thousandUnits === 1700;
      }),
    ).toBe(true);
  });
});
