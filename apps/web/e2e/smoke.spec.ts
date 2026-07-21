import { expect, test } from "@playwright/test";

test("boot placeholder renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Neolab.ai" })).toBeVisible();
});
