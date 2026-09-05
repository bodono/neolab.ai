import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyLeaderPortraitFavicon } from "./leader-favicon.tsx";
import { PixelPortrait } from "../features/portraits/pixel-portrait.tsx";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("leader favicon", () => {
  let mount: HTMLDivElement;
  let root: Root;
  let favicon: HTMLLinkElement;

  beforeEach(() => {
    favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.type = "image/svg+xml";
    favicon.href = "/favicon.svg";
    favicon.dataset["neolabFavicon"] = "";
    document.head.append(favicon);
    mount = document.createElement("div");
    document.body.append(mount);
    root = createRoot(mount);
  });

  afterEach(() => {
    act(() => root.unmount());
    mount.remove();
    favicon.remove();
  });

  it("uses the selected leader portrait and restores the neutral icon", () => {
    act(() =>
      root.render(
        <PixelPortrait
          className="leader-header-portrait"
          subjectId="base:leader.thomas-hassabi"
          name="Dennis Hassabi"
        />,
      ),
    );

    const portrait = mount.querySelector<SVGSVGElement>("svg");
    expect(portrait).not.toBeNull();

    const restore = applyLeaderPortraitFavicon(portrait!, document);
    expect(favicon.href).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(favicon.href)).toContain("#f0c7a6");
    expect(decodeURIComponent(favicon.href)).not.toContain("Dennis Hassabi");

    restore();
    expect(favicon.href).toBe(new URL("/favicon.svg", window.location.href).href);
  });
});
