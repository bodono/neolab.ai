import { expect, test, type Page } from "@playwright/test";

async function openSetupWithKeyboard(page: Page): Promise<void> {
  await page.goto("/?campaign=classic");
  const start = page.getByRole("button", { name: "Start muted" });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Choose your lab leader" }),
  ).toBeVisible();
}

async function launchLab(page: Page): Promise<void> {
  await openSetupWithKeyboard(page);
  await page.getByRole("radio", { name: /Mario Amodeo/ }).click();
  const launch = page.getByRole("button", { name: /Enter the lab/ });
  await launch.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Mario Amodeo" })).toBeVisible();
}

test("leader selection is a complete keyboard radio workflow", async ({
  browserName,
  page,
}) => {
  await openSetupWithKeyboard(page);
  const leaders = page
    .getByRole("radiogroup", { name: "Lab leaders" })
    .getByRole("radio");
  const count = await leaders.count();
  expect(count).toBeGreaterThanOrEqual(4);

  await leaders.first().focus();
  await expect(leaders.first()).toHaveAttribute("aria-checked", "true");
  for (let index = 1; index < count; index += 1) {
    await page.keyboard.press("ArrowRight");
    await expect(leaders.nth(index)).toBeFocused();
    await expect(leaders.nth(index)).toHaveAttribute("aria-checked", "true");
    await expect(leaders.nth(index)).toHaveAttribute(
      "aria-describedby",
      /leader-summary/,
    );
  }

  await page.keyboard.press("Home");
  await expect(leaders.first()).toBeFocused();
  await page.keyboard.press("End");
  await expect(leaders.last()).toBeFocused();
  const mandates = page.locator(".mandate-card");
  if (browserName === "webkit") {
    // WebKit follows the host's "full keyboard access" preference when deciding
    // whether Tab visits buttons. Direct focus still verifies that the control is
    // keyboard-focusable and activatable instead of encoding a machine setting.
    await mandates.first().focus();
  } else {
    for (
      let guard = 0;
      guard < 6 && (await page.locator(".mandate-card:focus").count()) === 0;
      guard += 1
    ) {
      await page.keyboard.press("Tab");
    }
  }
  await expect(page.locator(".mandate-card:focus")).toHaveCount(1);
  await page.keyboard.press(" ");
  await expect(page.locator(".mandate-card:focus")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("allocation sliders expose physical GPU values and work without a pointer", async ({
  page,
}) => {
  await launchLab(page);
  await page.getByRole("button", { name: "GPUs & compute", exact: true }).click();
  const serving = page.getByRole("slider", {
    name: "Customer serving compute ceiling",
  });
  const capability = page.getByRole("slider", {
    name: "Capability research share of available R&D compute",
  });

  await expect(serving).toHaveAttribute(
    "aria-valuetext",
    /\d+% of the GPU fleet, [\d,]+ physical GPUs per week at most/,
  );
  await expect(capability).toHaveAttribute(
    "aria-valuetext",
    /\d+% broad capability research and \d+% safety research/,
  );
  await expect(serving).toHaveAccessibleDescription(/GPU fleet generation mix:.*Kepler/i);
  await expect(serving).toHaveAccessibleDescription(
    /Serving unavailable.*Launch a managed model first/i,
  );
  await expect(serving).toHaveAttribute("max", "10000");

  const servingBefore = Number(await serving.inputValue());
  await serving.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(serving).toBeFocused();
  await expect(serving).toHaveValue(String(Math.max(0, servingBefore - 1)));
  await expect(page.locator(".consequence-line")).not.toBeEmpty();

  const capabilityBefore = Number(await capability.inputValue());
  await capability.focus();
  await page.keyboard.press("ArrowRight");
  await expect(capability).toBeFocused();
  await expect(capability).toHaveValue(String(capabilityBefore + 100));
});

test("modals trap focus, make the dashboard inert, and restore the trigger", async ({
  page,
}) => {
  await launchLab(page);
  const fundraising = page.getByRole("button", { name: "Fundraise" });
  await fundraising.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Fundraising" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(page.locator(".identity-header")).toHaveJSProperty("inert", true);

  const focusable = dialog.locator(
    "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
  );
  await focusable.last().focus();
  await page.keyboard.press("Tab");
  await expect(focusable.first()).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(fundraising).toBeFocused();
  await expect(page.locator(".identity-header")).toHaveJSProperty("inert", false);

  await page.getByRole("button", { name: "Models & deployment" }).click();
  const train = page.getByRole("button", {
    name: "Configure first training run",
  });
  await train.focus();
  await page.keyboard.press("Enter");
  const trainingDialog = page.getByRole("dialog", {
    name: "Authorise a new model generation",
  });
  await expect(trainingDialog).toBeVisible();
  await expect(trainingDialog).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trainingDialog).toBeHidden();
  await expect(train).toBeFocused();
});

test("resource state and uncertainty remain understandable without colour", async ({
  page,
}) => {
  await launchLab(page);
  const status = page.getByRole("region", { name: "Current lab status" });
  const finance = status.locator("article").filter({ hasText: "Cash" });
  await expect(finance).toHaveClass(/healthy|warning|critical/);
  await expect(finance).toContainText(/runway/i);
  await expect(status).toContainText("Current AI");
  await expect(status).toContainText("No model");
  await page.getByRole("button", { name: "GPUs & compute", exact: true }).click();
  await expect(page.locator(".allocation-legend")).toContainText("Serving");
  await expect(page.locator(".allocation-legend")).toContainText("Capabilities");
  await expect(page.locator(".allocation-legend")).toContainText("Safety");
});

test("the dashboard fits the minimum-laptop 200-percent-zoom equivalent", async ({
  page,
}) => {
  // Browser zoom halves the CSS viewport. 640×450 is the layout viewport produced by
  // a 1280×900 minimum laptop at 200% zoom.
  await page.setViewportSize({ width: 640, height: 450 });
  await openSetupWithKeyboard(page);
  const setupOverflow = await page.evaluate(() => {
    const biography = document.querySelector<HTMLElement>(".dossier-biography p")!;
    biography.textContent = `${biography.textContent ?? ""} ${"Long translated biographical copy remains readable. ".repeat(12)}`;
    return document.documentElement.scrollWidth > window.innerWidth;
  });
  expect(setupOverflow).toBe(false);
  await page.getByRole("radio", { name: /Mario Amodeo/ }).click();
  const launch = page.getByRole("button", { name: /Enter the lab/ });
  await launch.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Mario Amodeo" })).toBeVisible();
  const geometry = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
    bodyWidth: document.body.getBoundingClientRect().width,
    viewportWidth: window.innerWidth,
  }));
  expect(geometry.horizontalOverflow).toBe(false);
  expect(geometry.bodyWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  await expect(page.getByRole("button", { name: "Pause game" })).toBeVisible();
  await page.getByRole("button", { name: "GPUs & compute", exact: true }).click();
  await expect(
    page.getByRole("slider", { name: "Customer serving compute ceiling" }),
  ).toBeVisible();
});

test("reduced motion suppresses nonessential campus animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await launchLab(page);
  await page.getByRole("button", { name: "Facilities & campus", exact: true }).click();
  await expect(page.locator(".campus-map-staff").first()).toBeAttached();
  const motion = await page.evaluate(() => {
    const walkers = document.querySelectorAll(".campus-map-staff");
    const walker = getComputedStyle(walkers[0]!);
    const secondWalker = getComputedStyle(walkers[1]!);
    const button = getComputedStyle(document.querySelector("button")!);
    return {
      walkerDuration: walker.animationDuration,
      walkerIterations: walker.animationIterationCount,
      secondWalkerDuration: secondWalker.animationDuration,
      transitionDuration: button.transitionDuration,
    };
  });
  expect(Number.parseFloat(motion.walkerDuration)).toBeLessThanOrEqual(0.001);
  expect(motion.walkerIterations).toBe("1");
  expect(Number.parseFloat(motion.secondWalkerDuration)).toBeLessThanOrEqual(0.001);
  expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.001);
});

test("accessible labels and descriptions never expose canonical hidden truth", async ({
  page,
}) => {
  await launchLab(page);
  const projections: string[] = [];
  for (const section of [
    "Facilities & campus",
    "Research",
    "Models & deployment",
    "People",
    "World & rivals",
    "Finances & score",
    "Bonuses & penalties",
  ]) {
    await page.getByRole("button", { name: section }).click();
    projections.push(
      await page.evaluate(() => {
        const values: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let current = walker.nextNode();
        while (current !== null) {
          if (
            current instanceof HTMLElement &&
            current.closest("[aria-hidden='true']") === null
          ) {
            for (const attribute of [
              "aria-label",
              "aria-valuetext",
              "aria-description",
              "title",
              "alt",
            ]) {
              const value = current.getAttribute(attribute);
              if (value !== null) values.push(value);
            }
          }
          current = walker.nextNode();
        }
        values.push(document.body.innerText);
        return values.join("\n");
      }),
    );
  }
  const screenReaderProjection = projections.join("\n");
  expect(screenReaderProjection).not.toMatch(
    /hiddenSafety|trueAlignment|deceptiveCapability|trueSeverity|trueCapability|hiddenInternalCandour/i,
  );
  expect(screenReaderProjection).not.toMatch(/\b(?:base|run):[a-z0-9]/i);
});
