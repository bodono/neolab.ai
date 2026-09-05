import { expect, test } from "@playwright/test";

test("the two GDD art treatments can be compared in the real dashboard shell", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto("/?fixture=art-direction");
  await expect(
    page.getByRole("heading", { name: "A · Restrained corporate" }),
  ).toBeVisible();
  await expect(page.locator(".art-crop")).toHaveCount(11);
  await expect(page.locator(".art-crop").first()).toHaveCSS(
    "background-image",
    /treatment-a-corporate/,
  );

  await page.getByRole("button", { name: "B · Colourful arcade" }).click();
  await expect(page.getByRole("heading", { name: "B · Colourful arcade" })).toBeVisible();
  await expect(page.locator(".art-crop").first()).toHaveCSS(
    "background-image",
    /treatment-b-arcade/,
  );
  await page.getByText("View the complete uncropped treatment sheet").click();
  const fullSheet = page.getByRole("img", {
    name: "B · Colourful arcade complete art test sheet",
  });
  await expect(fullSheet).toBeVisible();
  await expect
    .poll(() => fullSheet.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1774);

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
  ).toBe(false);
});
