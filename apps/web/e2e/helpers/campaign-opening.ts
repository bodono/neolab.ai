import { expect, type Page } from "@playwright/test";

/**
 * The opening every new run now shares: pick a leader, enter the lab, and
 * acknowledge the Chapter 01 garage milestone that sits over the clock
 * controls. This lived inline in two specs and drifted when the campaign
 * landed — the deployment smoke kept clicking the clock beneath the dialog and
 * only failed after a tag. One definition, exercised in CI, keeps them honest.
 */
export async function enterSeededLab(
  page: Page,
  options: { readonly seed?: string } = {},
): Promise<void> {
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Stan Altmann/ }).click();
  if (options.seed !== undefined) {
    await page.getByLabel("Run seed").fill(options.seed);
  }
  await page.getByRole("button", { name: "Enter the lab" }).click();
  await expect(page.getByRole("heading", { name: "Stan Altmann" })).toBeVisible();

  const garageOpening = page.getByRole("dialog", {
    name: "So, you decided to start a neolab.",
  });
  await expect(garageOpening).toBeVisible();
  await page.getByRole("button", { name: "Open the garage" }).click();
  await expect(garageOpening).toBeHidden();
  await expect(page.getByText("WEEK 1", { exact: true })).toBeVisible();
}
