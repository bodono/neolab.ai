import { expect, test, type Locator, type Page } from "@playwright/test";

async function enterNewLab(page: Page): Promise<void> {
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Stan Altmann/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
}

async function openTrainingDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Models & deployment", exact: true }).click();
  await page.getByRole("button", { name: "Configure first training run" }).click();
}

async function expectDialogFitsVisualViewport(dialog: Locator): Promise<void> {
  const metrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      top: rect.top,
      bottom: rect.bottom,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      viewportTop: window.visualViewport?.offsetTop ?? 0,
      viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      documentOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      applicationVersionDisplay: getComputedStyle(
        document.querySelector(".application-version")!,
      ).display,
    };
  });
  expect(metrics.top).toBeGreaterThanOrEqual(metrics.viewportTop - 1);
  expect(metrics.bottom).toBeLessThanOrEqual(
    metrics.viewportTop + metrics.viewportHeight + 1,
  );
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
  expect(metrics.documentOverflow).toBe("hidden");
  expect(metrics.bodyOverflow).toBe("hidden");
  expect(metrics.applicationVersionDisplay).toBe("none");
}

test("long training controls stay visible and reversible across viewport classes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await enterNewLab(page);
  await openTrainingDialog(page);

  const dialog = page.getByRole("dialog", {
    name: "Authorise a new model generation",
  });
  await expect(dialog).toBeVisible();
  await expectDialogFitsVisualViewport(dialog);

  for (const viewport of [
    { width: 1024, height: 600 },
    { width: 768, height: 640 },
    { width: 390, height: 600 },
  ]) {
    await page.setViewportSize(viewport);
    await expectDialogFitsVisualViewport(dialog);
  }

  await dialog.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await dialog.evaluate((element) => element.scrollTo({ top: 0 }));
  await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBe(0);

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(
    await page.evaluate(() => ({
      documentOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      applicationVersionDisplay: getComputedStyle(
        document.querySelector(".application-version")!,
      ).display,
    })),
  ).toEqual({
    documentOverflow: "",
    bodyOverflow: "",
    applicationVersionDisplay: "block",
  });
});

test("the lab toolbar help label stays centred at iPad width", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await enterNewLab(page);

  const helpButton = page.getByRole("button", { name: "How to play", exact: true });
  const metrics = await helpButton.evaluate((element) => {
    const buttonRect = element.getBoundingClientRect();
    const textRange = document.createRange();
    textRange.selectNodeContents(element);
    const textRect = textRange.getBoundingClientRect();
    return {
      buttonWidth: buttonRect.width,
      centreOffset:
        (textRect.left + textRect.right) / 2 - (buttonRect.left + buttonRect.right) / 2,
      flexShrink: getComputedStyle(element).flexShrink,
    };
  });

  expect(metrics.buttonWidth).toBeGreaterThan(72);
  expect(Math.abs(metrics.centreOffset)).toBeLessThanOrEqual(0.5);
  expect(metrics.flexShrink).toBe("0");
});

test("a decimal frontier capability stays inside its dossier badge at iPad width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?scenario=endgame");
  await page.getByRole("button", { name: "Safety & evaluations", exact: true }).click();

  const capabilityBadge = page.locator(".model-dossier-identity > strong");
  await expect(capabilityBadge).toBeVisible();
  await capabilityBadge.evaluate((element) => {
    // Exercise the four-character score that exposed the fixed-width badge bug.
    element.textContent = "87.9";
  });

  const metrics = await capabilityBadge.evaluate((element) => {
    const badge = element.getBoundingClientRect();
    const parent = element.parentElement!.getBoundingClientRect();
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      badgeLeft: badge.left,
      badgeRight: badge.right,
      parentLeft: parent.left,
      parentRight: parent.right,
    };
  });

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.badgeLeft).toBeGreaterThanOrEqual(metrics.parentLeft);
  expect(metrics.badgeRight).toBeLessThanOrEqual(metrics.parentRight);
});
