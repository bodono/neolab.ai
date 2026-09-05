import { expect, test, type Locator } from "@playwright/test";

async function expectMilestoneDialogToBeOpaque(dialog: Locator): Promise<void> {
  const appearance = await dialog.evaluate((element) => {
    const dialogStyle = getComputedStyle(element);
    const action = element.querySelector("footer button");
    const actionStyle = action === null ? null : getComputedStyle(action);
    return {
      backgroundColor: dialogStyle.backgroundColor,
      backgroundImage: dialogStyle.backgroundImage,
      borderTopColor: dialogStyle.borderTopColor,
      color: dialogStyle.color,
      actionBackgroundColor: actionStyle?.backgroundColor ?? "",
    };
  });

  expect(appearance.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(appearance.backgroundColor).not.toBe("transparent");
  expect(appearance.backgroundImage).not.toBe("none");
  expect(appearance.color).not.toBe(appearance.backgroundColor);
  expect(appearance.borderTopColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(appearance.actionBackgroundColor).not.toBe("rgba(0, 0, 0, 0)");
}

test("title and leader selection launch a paused lab", async ({ page, browserName }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /neolab\.ai/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tutorial" })).toHaveCount(0);
  // Match the shape, not the number. A tagged build stamps its own tag here,
  // so pinning a literal would need editing at every release.
  await expect(page.getByLabel("Application version")).toContainText(
    /Neolab\.ai v\d+\.\d+\.\d+/,
  );
  await expect(page.getByLabel("Application version")).toContainText(
    "© 2026 Brendan O'Donoghue",
  );
  const creatorHomepageLinks = page.getByRole("link", {
    name: "Brendan O'Donoghue",
  });
  await expect(creatorHomepageLinks).toHaveCount(2);
  await expect(creatorHomepageLinks.nth(0)).toHaveAttribute(
    "href",
    "https://bodono.github.io/",
  );
  await expect(creatorHomepageLinks.nth(1)).toHaveAttribute(
    "href",
    "https://bodono.github.io/",
  );
  await page.getByRole("button", { name: "Start muted" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your lab leader" }),
  ).toBeVisible();
  await expect(page.locator(".dossier-biography")).toBeVisible();
  await expect(page.locator(".leader-traits article")).toHaveCount(3);
  await page.getByRole("radio", { name: /Stan Altmann/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
  await expect(page.getByRole("heading", { name: "Stan Altmann" })).toBeVisible();
  const garageOpening = page.getByRole("dialog", {
    name: "So, you decided to start a neolab.",
  });
  await expect(garageOpening).toBeVisible();
  await expect(garageOpening).toContainText("GPU procurement");
  await expectMilestoneDialogToBeOpaque(garageOpening);
  await page.getByRole("button", { name: "Open the garage" }).click();
  // Assert the title attribute rather than the text. When the label is wider
  // than its viewport the component renders a second aria-hidden copy to
  // marquee it, so textContent contains the track name twice. Whether that
  // happens depends on font metrics, which differ by engine and platform: the
  // same assertion passes on Chromium and fails on Firefox under Linux. The
  // title attribute is the single canonical label either way, and it carries
  // the "Loading · " prefix, so this still waits for the track to be ready.
  const nowPlaying = page.locator(".audio-now-playing");
  await expect(nowPlaying).toHaveAttribute("title", "ALL SOUND MUTED");
  await page.getByRole("button", { name: "Unmute all game audio" }).click();
  // Headless Firefox on a CI runner has no audio device, so its AudioContext
  // never leaves the loading state: the label sat at "Loading · …" through 58
  // polls across thirty seconds. Chromium and WebKit clear it on the same
  // machine, and Firefox clears it locally, so this is the runner rather than
  // the player. Assert the selected track there and the decoded state
  // everywhere the platform can actually reach it.
  const stalledWithoutAudioDevice =
    browserName === "firefox" && process.env["CI"] !== undefined;
  await expect(nowPlaying).toHaveAttribute(
    "title",
    stalledWithoutAudioDevice
      ? /The Gradients Are Flowing$/
      : "The Gradients Are Flowing",
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Next soundtrack track" }).click();
  await expect(nowPlaying).not.toHaveAttribute("title", "The Gradients Are Flowing");
  await expect(page.locator(".audio-now-playing")).not.toBeEmpty();
  await expect(page.getByRole("button", { name: "Pause game" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Pause game" }).locator(".pause-glyph i"),
  ).toHaveCount(2);
  const ambientActivity = page.locator(".lab-ambient-activity");
  const ambientBus = ambientActivity.locator(".ambient-bus").first();
  await expect(ambientActivity).toHaveAttribute("data-paused", "true");
  expect(
    await ambientBus.evaluate(
      (element) => getComputedStyle(element, "::after").animationPlayState,
    ),
  ).toBe("paused");
  await page.getByRole("button", { name: "1x", exact: true }).click();
  await expect(ambientActivity).toHaveAttribute("data-paused", "false");
  expect(
    await ambientBus.evaluate(
      (element) => getComputedStyle(element, "::after").animationPlayState,
    ),
  ).toBe("running");
  await page.getByRole("button", { name: "How to play" }).click();
  const liveBriefing = page.getByRole("dialog", { name: /Build the lab/ });
  await expect(liveBriefing).toBeVisible();
  await expect(ambientActivity).toHaveAttribute("data-paused", "true");
  await page.getByRole("button", { name: "Close briefing" }).click();
  await expect(liveBriefing).toBeHidden();
  await expect(ambientActivity).toHaveAttribute("data-paused", "false");
  await expect(page.getByRole("button", { name: "How to play" })).toBeFocused();
  await page.getByRole("button", { name: "Pause game" }).click();
  await expect(ambientActivity).toHaveAttribute("data-paused", "true");
  await expect(
    page.getByRole("heading", {
      name: "So, you decided to start a neolab.",
    }),
  ).toBeVisible();
  await expect(page.getByText("Order the first GPU block")).toBeVisible();
  const status = page.getByRole("region", { name: "Current lab status" });
  await expect(status).toContainText("Cash");
  await expect(status).toContainText("Fleet");
  await expect(status).not.toContainText("Aura");

  await expect(
    page.getByRole("button", { name: "Facilities & campus", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Models & deployment", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "GPUs & compute", exact: true }).click();
  await expect(page.getByRole("button", { name: "Buy or sell GPUs" })).toBeVisible();

  const exit = page.getByRole("button", { name: "Quit / new game" });
  await exit.click();
  const exitDialog = page.getByRole("dialog", {
    name: "Return to the title screen?",
  });
  await expect(exitDialog).toBeVisible();
  await page.getByRole("button", { name: "Keep playing" }).click();
  await expect(exitDialog).toBeHidden();
  await expect(exit).toBeFocused();

  await exit.click();
  await page.getByRole("button", { name: "Save & return to title" }).click();
  await expect(page.getByRole("heading", { name: /neolab\.ai/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
});

test("the first delivered GPU block reveals model training", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
  await page.getByRole("button", { name: "Open the garage" }).click();
  await page.getByRole("button", { name: "GPUs & compute", exact: true }).click();
  await page.getByRole("button", { name: "Buy or sell GPUs" }).click();

  const procurement = page.getByRole("dialog", { name: "Buy & sell GPUs" });
  await procurement
    .getByRole("button", { name: /^Buy ·/ })
    .first()
    .click();
  await procurement.getByRole("button", { name: "Close GPU procurement" }).click();

  for (let week = 0; week < 12; week += 1) {
    await page.getByRole("button", { name: "Step one week" }).click();
    if (await page.getByRole("dialog", { name: "The garage is thinking." }).isVisible()) {
      break;
    }
  }

  const clusterOpening = page.getByRole("dialog", {
    name: "The garage is thinking.",
  });
  await expect(clusterOpening).toBeVisible();
  await expect(clusterOpening).toContainText("Model training");
  await page.getByRole("button", { name: "Continue building" }).click();
  await expect(
    page.getByRole("button", { name: "Models & deployment", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Facilities & campus", exact: true }),
  ).toHaveCount(0);
});

test("status shortcuts mirror navigation selected in the sidebar", async ({ page }) => {
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();

  const allocate = page.getByRole("button", { name: "Allocate", exact: true });
  const expand = page.getByRole("button", { name: "Expand", exact: true });
  const models = page.getByRole("button", { name: "Models", exact: true });
  const recruit = page.getByRole("button", { name: "Recruit", exact: true });
  const financeDetails = page.getByRole("button", { name: "Details", exact: true });
  const financeBreakdown = page.getByRole("button", {
    name: "Breakdown",
    exact: true,
  });

  await page.getByRole("button", { name: "GPUs & compute", exact: true }).click();
  await expect(allocate).toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Facilities & campus", exact: true }).click();
  await expect(expand).toHaveAttribute("aria-current", "page");
  await expect(allocate).not.toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Models & deployment", exact: true }).click();
  await expect(models).toHaveAttribute("aria-current", "page");
  await expect(expand).not.toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "People", exact: true }).click();
  await expect(recruit).toHaveAttribute("aria-current", "page");
  await expect(models).not.toHaveAttribute("aria-current", "page");

  await page.getByRole("button", { name: "Finances & score", exact: true }).click();
  await expect(financeDetails).toHaveAttribute("aria-current", "page");
  await expect(financeBreakdown).toHaveAttribute("aria-current", "page");
  await expect(recruit).not.toHaveAttribute("aria-current", "page");

  expect(
    await financeBreakdown.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).not.toBe("rgba(0, 0, 0, 0)");
});

test("dark model action cards keep training and launch in one workspace", async ({
  page,
}) => {
  await page.goto("/?scenario=endgame");
  await page.getByRole("button", { name: "Models & deployment", exact: true }).click();
  await page.getByRole("button", { name: "Use dark mode" }).click();

  const train = page.locator(".model-command-card.training");
  const release = page.locator(".model-command-card.release");
  await expect(page.getByRole("tablist", { name: "Model tasks" })).toHaveCount(0);
  await expect(train).toContainText("Train next model");
  await expect(train).toContainText("READY");
  await expect(release).toContainText("Prepare & launch current model");
  await expect(release).toContainText("LIVE");
  await expect(page.getByRole("heading", { name: /Train a successor to/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /launch path/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Launch configuration" })).toBeVisible();

  const orderedPanels = await page
    .locator(
      ".model-workspace-command, .model-workflow-panel, .model-lifecycle-guide, .model-mode-custody",
    )
    .evaluateAll((panels) =>
      panels
        .map((panel) => ({
          className: panel.getAttribute("class") ?? "",
          top: panel.getBoundingClientRect().top,
        }))
        .sort((a, b) => a.top - b.top),
    );
  expect(orderedPanels[0]?.className).toContain("model-workspace-command");
  expect(orderedPanels[1]?.className).toContain("model-workflow-panel");
  expect(orderedPanels[2]?.className).toContain("model-lifecycle-guide");
  expect(orderedPanels.at(-1)?.className).toContain("model-mode-custody");

  const surfaces = await page.locator(".model-command-card").evaluateAll((tabs) =>
    tabs.map((tab) => ({
      background: getComputedStyle(tab).backgroundColor,
      border: getComputedStyle(tab).borderColor,
      accent: getComputedStyle(tab).borderTopColor,
      shadow: getComputedStyle(tab).boxShadow,
    })),
  );
  expect(surfaces[0]?.accent).not.toBe(surfaces[1]?.accent);
  expect(surfaces[0]?.background).not.toBe("rgba(0, 0, 0, 0)");
  expect(surfaces[0]?.border).not.toBe("rgba(0, 0, 0, 0)");
  expect(surfaces[1]?.shadow).not.toBe("none");

  await release.getByRole("button", { name: "View launch status" }).click();
  await expect(page.getByRole("heading", { name: /launch path/ })).toBeInViewport();
});

test("the colour theme is explicit and persists locally", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const darkMode = page.getByRole("button", { name: "Use dark mode" });
  await expect(darkMode).toBeVisible();
  await darkMode.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Use light mode" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("neolab.ai-colour-theme-v1")),
  ).toBe("dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
  const garageOpening = page.getByRole("dialog", {
    name: "So, you decided to start a neolab.",
  });
  await expect(garageOpening).toBeVisible();
  await expectMilestoneDialogToBeOpaque(garageOpening);
  await page.getByRole("button", { name: "Open the garage" }).click();
  await page.getByRole("button", { name: "Use light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("the hidden tutorial introduction remains usable on a narrow screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?show-hidden-tutorial");
  await page.getByRole("button", { name: "Tutorial" }).click();

  const briefing = page.getByRole("dialog", {
    name: "Welcome to Neolab.ai",
  });
  await expect(briefing).toBeVisible();
  await expect(briefing).toContainText("Train a model");
  await expect(briefing).toContainText("Evaluate its safety");
  const layout = await briefing.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewportWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBe(layout.clientWidth);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  await expect(page.getByRole("button", { name: "Begin tutorial" })).toBeVisible();
});

test("local high-score boards are reachable and explicitly local-only", async ({
  page,
}) => {
  await page.setViewportSize({ width: 560, height: 900 });
  await page.goto("/");
  await page.getByRole("button", { name: "Local high scores" }).click();
  await expect(page.getByRole("heading", { name: "High scores" })).toBeVisible();
  await expect(page.getByText("LOCAL RECORDS // NO NETWORK SUBMISSION")).toBeVisible();
  await expect(page.getByRole("button", { name: /Winning runs/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: /All finished runs/ }).click();
  await expect(page.getByRole("button", { name: /All finished runs/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "Return to title" }).click();
  await expect(page.getByRole("heading", { name: /neolab\.ai/i })).toBeVisible();
});

test("diagnostics require consent, remain local, and CSP blocks remote connections", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByText("Privacy, diagnostics & feedback").click();
  const diagnostics = page.getByLabel("Keep a local diagnostic notebook");
  await expect(diagnostics).not.toBeChecked();
  await expect(page.getByRole("button", { name: /Export 0 records/ })).toBeDisabled();
  await diagnostics.check();
  await expect(page.getByRole("button", { name: /Export 1 records/ })).toBeEnabled();
  expect(
    await page.evaluate(() => localStorage.getItem("neolab.ai-diagnostics-consent-v1")),
  ).toBe("true");

  const connection = await page.evaluate(async () => {
    try {
      await fetch("https://example.invalid/neolab-csp-probe");
      return "allowed";
    } catch {
      return "blocked";
    }
  });
  expect(connection).toBe("blocked");
});
