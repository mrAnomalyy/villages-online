import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __VILLAGES_TEST_STATE__?: {
      loadingComplete: boolean;
      loadedChunkIds: string[];
      visibleEntityIds: string[];
      playerPosition: { x: number; y: number; z: number } | null;
    };
    __VILLAGES_TEST_CONTROLS__?: {
      move: (direction: { x: number; z: number }) => void;
      jump: () => void;
    };
  }
}

test("guest can create a character and enter a realm", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nickname-input").fill(`hero-${Date.now()}`);
  await page.getByTestId("realm-select").selectOption("alpha");
  await page.getByTestId("connect-button").click();

  await expect(page.getByTestId("character-create-screen")).toBeVisible();
  await page.getByTestId("body-female").click();
  await page.getByTestId("create-character-button").click();

  await expect(page.getByTestId("loading-screen")).toBeVisible();
  await expect(page.getByTestId("game-hud")).toBeVisible({ timeout: 20000 });

  await page.waitForFunction(() => Boolean(window.__VILLAGES_TEST_CONTROLS__?.move));
  await page.evaluate(() => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      window.__VILLAGES_TEST_CONTROLS__?.move({ x: 0, z: 1 });
      if (Date.now() - startedAt > 1200) {
        window.clearInterval(interval);
      }
    }, 100);
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.__VILLAGES_TEST_CONTROLS__?.move({ x: 0, z: 0 });
    window.__VILLAGES_TEST_CONTROLS__?.jump();
  });
  await page.waitForTimeout(1000);

  const testState = await page.evaluate(() => window.__VILLAGES_TEST_STATE__);
  expect(testState?.loadingComplete).toBe(true);
  expect(testState?.loadedChunkIds.length).toBeGreaterThan(0);
  expect(testState?.visibleEntityIds.length).toBeGreaterThan(0);
  expect(testState?.playerPosition?.z ?? 0).toBeGreaterThan(8);
});
