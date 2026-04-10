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

test("two players on the same realm can see each other", async ({ browser }) => {
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const firstPage = await firstContext.newPage();
  const secondPage = await secondContext.newPage();

  const firstNickname = `hero-a-${Date.now()}`;
  const secondNickname = `hero-b-${Date.now()}`;

  await firstPage.goto("/");
  await firstPage.getByTestId("nickname-input").fill(firstNickname);
  await firstPage.getByTestId("realm-select").selectOption("alpha");
  await firstPage.getByTestId("connect-button").click();
  await firstPage.getByTestId("create-character-button").click();
  await expect(firstPage.getByTestId("game-hud")).toBeVisible({ timeout: 20000 });

  await secondPage.goto("/");
  await secondPage.getByTestId("nickname-input").fill(secondNickname);
  await secondPage.getByTestId("realm-select").selectOption("alpha");
  await secondPage.getByTestId("connect-button").click();
  await secondPage.getByTestId("create-character-button").click();
  await expect(secondPage.getByTestId("game-hud")).toBeVisible({ timeout: 20000 });

  await firstPage.waitForFunction(() => {
    const state = window.__VILLAGES_TEST_STATE__;
    return Boolean(state && state.visibleEntityIds.length >= 3);
  });
  await secondPage.waitForFunction(() => {
    const state = window.__VILLAGES_TEST_STATE__;
    return Boolean(state && state.visibleEntityIds.length >= 3);
  });

  await firstContext.close();
  await secondContext.close();
});
