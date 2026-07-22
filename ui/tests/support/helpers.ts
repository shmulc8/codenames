import { expect, type Locator, type Page } from '@playwright/test';

export async function setupDemoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('btn-random-board').click();
  await page.getByTestId('btn-confirm-board').click();
  await expect(page.getByTestId('board-grid')).toBeVisible();
}

export function tile(page: Page, index: number): Locator {
  return page.getByTestId(`tile-${index}`);
}

export async function expectToast(page: Page, message?: string | RegExp): Promise<void> {
  const toast = page.getByTestId('toast');
  await expect(toast).toBeVisible();
  if (message !== undefined) await expect(toast).toContainText(message);
}
