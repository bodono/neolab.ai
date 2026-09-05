import { expect, test } from "@playwright/test";

test("hidden title tutorial opens a controlled guided run", async ({ page }) => {
  await page.goto("/?show-hidden-tutorial");
  await page.getByRole("button", { name: "Tutorial", exact: true }).click();

  const introduction = page.getByRole("dialog", { name: "Welcome to Neolab.ai" });
  await expect(introduction).toContainText("Train a model");
  await expect(introduction).toContainText("Evaluate its safety");
  await expect(introduction).toContainText("Prepare and launch it");
  await expect(introduction).toContainText("Allocate GPUs to serving");
  await expect(introduction).toContainText("Recruit and assign a researcher");
  await expect(introduction).toContainText("Buy the lab's first GPUs");
  await expect(introduction).toContainText("Raise the lab's first funding round");
  await expect(introduction).toContainText("Build the Server Rack");
  await expect(page.getByRole("button", { name: "Pause game" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Begin tutorial" }).click();
  const guide = page.locator(".tutorial-guide");
  await expect(guide).toContainText("OBJECTIVE 1 OF 9");
  await expect(guide).toContainText("Buy your first GPUs");
  await expect(page.locator('[data-tutorial-target="nav-compute"]')).toHaveClass(
    /tutorial-focus/,
  );

  await guide.getByRole("button", { name: "Show me" }).click();
  await expect(page.getByRole("heading", { name: "GPU fleet command" })).toBeVisible();
  await expect(page.locator('[data-tutorial-target="open-gpu-procurement"]')).toHaveClass(
    /tutorial-focus/,
  );
});

test("hidden tutorial guidance remains usable at phone and tablet viewports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto("/?show-hidden-tutorial");
  await page.getByRole("button", { name: "Tutorial", exact: true }).click();
  await page.getByRole("button", { name: "Begin tutorial" }).click();

  const guide = page.locator(".tutorial-guide");
  for (const viewport of [
    { width: 390, height: 667 },
    { width: 1024, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(guide).toBeVisible();
    await expect(guide).toBeInViewport();
    await expect(page.locator("html")).toHaveJSProperty(
      "scrollWidth",
      await page.locator("html").evaluate((element) => element.clientWidth),
    );
  }
});
