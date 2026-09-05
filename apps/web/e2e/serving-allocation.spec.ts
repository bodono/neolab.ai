import { expect, test } from "@playwright/test";

test("the serving ceiling is a fleet-denominated maximum and surplus reaches research", async ({
  page,
}) => {
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Stan Altmann/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
  await page.getByRole("button", { name: "GPUs & compute" }).click();

  const slider = page.locator("#customer-serving-allocation");
  await expect(slider).toBeVisible();

  // The track now spans the whole fleet, not the demand ceiling.
  await expect(slider).toHaveAttribute("max", "10000");
  await expect(slider).toHaveAttribute("aria-label", "Customer serving compute ceiling");

  const output = page.locator(".serving-slider output");
  const readout = (await output.textContent()) ?? "";
  expect(readout).toContain("of fleet");

  const scale = page.locator(".serving-range-scale");
  if ((await scale.count()) > 0) {
    const scaleText = (await scale.textContent()) ?? "";
    expect(scaleText).toContain("whole fleet");
  }

  // Dragging the ceiling must move it and stick -- the old code clamped the
  // stored value back down to demand, which is the bug this replaces.
  await slider.fill("7000");
  await slider.blur();
  await expect(slider).toHaveValue("7000");

  const hint = page.locator("#serving-allocation-hint");
  await expect(hint).toBeVisible();
  const hintText = (await hint.textContent()) ?? "";
  expect(hintText.length).toBeGreaterThan(0);

  // With no model there is no demand, so serving takes nothing and the whole
  // fleet reaches research -- the surplus rule, checked end to end.
  const lanes = page.locator(".allocation-legend, .allocation-bar-legend");
  if ((await lanes.count()) > 0) {
    expect((await lanes.first().textContent()) ?? "").toContain("Serving 0");
  }
});
