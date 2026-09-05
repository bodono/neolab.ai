import { expect, test } from "@playwright/test";

import { enterSeededLab } from "./helpers/campaign-opening.ts";

// The deployment smoke drives the same opening against the live site, but only
// after a tag. Running the shared helper here, against the CI dev server, means
// a campaign change that breaks the opening fails a push rather than a release.
test("a seeded campaign run opens and advances a week", async ({ page }) => {
  await page.goto("/");
  await enterSeededLab(page, { seed: "0123456789abcdef0123456789abcdef" });
  await page.getByRole("button", { name: "Step one week" }).click();
  await expect(page.getByText("WEEK 2", { exact: true })).toBeVisible();
});
