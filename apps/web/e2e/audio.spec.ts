import { expect, test } from "@playwright/test";

test("all soundtrack assets decode and the accessible controls persist", async ({
  browserName,
  page,
}) => {
  // Firefox can take longer than the ordinary slow-test budget to decode the
  // complete soundtrack while the all-engine suite is exercising the rest of
  // the UI in parallel. Keep the exhaustive cross-engine check, but give the
  // browser enough time to finish under contention.
  test.setTimeout(180_000);
  await page.goto("/?campaign=classic");
  await page.getByRole("button", { name: "Start with sound" }).click();
  await page.getByRole("radio", { name: /Mario Amodeo/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();

  const audioButton = page.locator(".audio-toggle");
  await expect(audioButton).toHaveAccessibleName(
    /Mute all game audio|Audio unavailable/,
    {
      timeout: 15_000,
    },
  );
  const playbackAvailable =
    (await audioButton.getAttribute("aria-label")) === "Mute all game audio";
  if (browserName === "chromium") expect(playbackAvailable).toBe(true);
  const box = await audioButton.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  if (playbackAvailable) {
    await expect(audioButton).toHaveAttribute("aria-pressed", "false");
    await audioButton.click();
    await expect(audioButton).toBeFocused();
    await expect(audioButton).toHaveAccessibleName("Unmute all game audio");
  } else {
    await expect(audioButton).toBeDisabled();
    await expect(audioButton).toHaveAttribute("aria-pressed", "false");
  }
  await expect(page.getByRole("button", { name: "Pause game" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByRole("button", { name: "Sound settings" }).click();
  await page.getByRole("slider", { name: "Music volume" }).fill("23");
  await page.getByRole("checkbox", { name: "Mute event cues" }).check();
  await page.reload();
  await page.getByRole("button", { name: "Start muted" }).click();
  await page.getByRole("radio", { name: /Mario Amodeo/ }).click();
  await page.getByRole("button", { name: "Enter the lab" }).click();
  await page.getByRole("button", { name: "Sound settings" }).click();
  await expect(page.getByRole("slider", { name: "Music volume" })).toHaveValue("23");
  await expect(page.getByRole("checkbox", { name: "Mute event cues" })).toBeChecked();

  const decodeResults = await page.evaluate(async () => {
    const assets = (
      window as Window & {
        __NEOLAB_AUDIO_TEST_ASSETS__?: readonly { id: string; url: string }[];
      }
    ).__NEOLAB_AUDIO_TEST_ASSETS__;
    if (assets === undefined) throw new Error("Development audio catalogue unavailable");
    const context = new AudioContext();
    const results: { id: string; duration: number }[] = [];
    for (const asset of assets) {
      const response = await fetch(asset.url);
      if (!response.ok)
        throw new Error(`${asset.id} returned ${String(response.status)}`);
      const decoded = await context.decodeAudioData(await response.arrayBuffer());
      results.push({ id: asset.id, duration: decoded.duration });
    }
    await context.close();
    return results;
  });
  expect(decodeResults.length).toBeGreaterThanOrEqual(29);
  expect(decodeResults).toHaveLength(new Set(decodeResults.map((r) => r.id)).size);
  expect(decodeResults.every((asset) => asset.duration > 0)).toBe(true);
});
