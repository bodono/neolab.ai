import { expect, test, type Page } from "@playwright/test";

interface ShellFixture {
  readonly name: string;
  readonly width: number;
  readonly rosterColumns: number;
  readonly sidebarAlongsideWorkspace: boolean;
  readonly twoColumnCommandDesk: boolean;
  readonly scrollableStatusStrip: boolean;
}

const FIXTURES: readonly ShellFixture[] = [
  {
    name: "wide-desktop",
    width: 1500,
    rosterColumns: 5,
    sidebarAlongsideWorkspace: true,
    twoColumnCommandDesk: true,
    scrollableStatusStrip: false,
  },
  {
    name: "compact-desktop",
    width: 1000,
    rosterColumns: 4,
    sidebarAlongsideWorkspace: true,
    twoColumnCommandDesk: false,
    scrollableStatusStrip: false,
  },
  {
    name: "tablet",
    width: 760,
    rosterColumns: 3,
    sidebarAlongsideWorkspace: false,
    twoColumnCommandDesk: false,
    scrollableStatusStrip: true,
  },
  {
    name: "narrow",
    width: 540,
    rosterColumns: 1,
    sidebarAlongsideWorkspace: false,
    twoColumnCommandDesk: false,
    scrollableStatusStrip: true,
  },
] as const;

async function launch(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Mario Amodeo/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
  await expect(page.getByRole("heading", { name: "Mario Amodeo" })).toBeVisible();
}

for (const fixture of FIXTURES) {
  test(`responsive shell honours the ${fixture.name} contract`, async ({
    page,
  }, testInfo) => {
    await launch(page, fixture.width);
    const geometry = await page.evaluate(() => {
      const roster = [
        ...document.querySelectorAll<HTMLElement>(".researcher-slot-card"),
      ].map((element) => element.getBoundingClientRect());
      const rosterStrip = document
        .querySelector<HTMLElement>(".researcher-strip-cards")!
        .getBoundingClientRect();
      const workspace = document
        .querySelector<HTMLElement>(".game-console-main")!
        .getBoundingClientRect();
      const sidebar = document
        .querySelector<HTMLElement>(".game-sidebar")!
        .getBoundingClientRect();
      const advisory = document
        .querySelector<HTMLElement>(".advisory-board")!
        .getBoundingClientRect();
      const feed = document
        .querySelector<HTMLElement>(".feed-panel-prominent")!
        .getBoundingClientRect();
      const statusStrip = document.querySelector<HTMLElement>(".command-status-strip")!;
      return {
        roster: roster.map(({ top, left, right }) => ({ top, left, right })),
        rosterStrip: {
          left: rosterStrip.left,
          right: rosterStrip.right,
        },
        workspace: {
          top: workspace.top,
          left: workspace.left,
          right: workspace.right,
        },
        sidebar: {
          top: sidebar.top,
          right: sidebar.right,
          bottom: sidebar.bottom,
        },
        advisory: {
          top: advisory.top,
          right: advisory.right,
          bottom: advisory.bottom,
        },
        feed: {
          top: feed.top,
          left: feed.left,
        },
        statusStripScrolls: statusStrip.scrollWidth > statusStrip.clientWidth,
        statusCardCount: statusStrip.querySelectorAll("article").length,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        shellWidth: document.querySelector(".game-shell")!.getBoundingClientRect().width,
      };
    });

    const visibleRosterColumns = geometry.roster.filter(
      (card) =>
        card.left >= geometry.rosterStrip.left - 1 &&
        card.right <= geometry.rosterStrip.right + 1,
    ).length;
    expect(visibleRosterColumns).toBe(fixture.rosterColumns);
    expect(geometry.horizontalOverflow).toBe(false);
    expect(geometry.shellWidth).toBeLessThanOrEqual(1500);
    expect(geometry.statusCardCount).toBe(6);
    expect(geometry.statusStripScrolls).toBe(fixture.scrollableStatusStrip);
    if (fixture.sidebarAlongsideWorkspace) {
      expect(Math.abs(geometry.workspace.top - geometry.sidebar.top)).toBeLessThan(2);
      expect(geometry.sidebar.right).toBeLessThanOrEqual(geometry.workspace.left);
    } else {
      expect(geometry.workspace.top).toBeGreaterThanOrEqual(geometry.sidebar.bottom);
    }
    if (fixture.twoColumnCommandDesk) {
      expect(Math.abs(geometry.advisory.top - geometry.feed.top)).toBeLessThan(2);
      expect(geometry.advisory.right).toBeLessThanOrEqual(geometry.feed.left);
    } else {
      expect(geometry.feed.top).toBeGreaterThanOrEqual(geometry.advisory.bottom);
    }

    // Geometry and overflow are cross-engine contracts and run everywhere.
    // Pixel baselines stay Chromium-only so font rasterisation does not create
    // three noisy visual archives for the same layout, and local-only for the
    // same reason one platform up: these baselines are authored on macOS, and
    // Linux rasterises the same fonts differently enough to exceed the diff
    // ratio on every run. Committing a second platform's archive would double
    // the baselines for no extra layout coverage, so CI enforces the geometry
    // contract and leaves the visual check to the machine that owns the images.
    if (testInfo.project.name === "chromium" && process.env["CI"] === undefined) {
      await expect(page).toHaveScreenshot(`dashboard-${fixture.name}.png`, {
        animations: "disabled",
        caret: "hide",
        fullPage: false,
        maxDiffPixelRatio: 0.08,
        threshold: 0.3,
      });
    }
  });
}
