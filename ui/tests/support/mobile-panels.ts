import { expect, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

export const MOBILE_VIEWPORT = { width: 700, height: 390 } as const;
export const DESKTOP_VIEWPORT = { width: 1320, height: 900 } as const;

export async function mountMobilePanels(page: Page): Promise<void> {
  await page.setViewportSize({ ...MOBILE_VIEWPORT });
  await page.goto('/');
  await expect(page.getByTestId('mobile-shell')).toBeVisible();
  await page.getByTestId('tab-clue').click();
  await expect(page.getByTestId('tabbar')).toBeVisible();
}

export async function setFixtureBoard(page: Page): Promise<void> {
  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);
}

export async function openMobileTab(
  page: Page,
  tab: 'board' | 'clue' | 'check' | 'map',
): Promise<void> {
  await page.getByTestId(`tab-${tab}`).click();
}

export async function requestAutoClue(page: Page): Promise<void> {
  await page.getByTestId('btn-get-clue').click();
  await expect(page.getByTestId('clue-result')).toBeVisible();
  await expect(page.getByTestId('clue-word')).toHaveText('טבע');
}
