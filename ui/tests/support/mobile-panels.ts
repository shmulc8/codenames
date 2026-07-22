import { expect, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
export const DESKTOP_VIEWPORT = { width: 1320, height: 900 } as const;

/**
 * Boots the app behind `/?mobile=1` and swaps the desktop root for the mobile
 * panels host. The dev-only mount lives entirely in stepC-4's owned tree so no
 * desktop file is touched — the integrator wires the real `useLayout()`
 * delegation into MainScreen at merge time (see agents/SYNC-REQUESTS.md).
 */
export async function mountMobilePanels(page: Page): Promise<void> {
  await page.setViewportSize({ ...MOBILE_VIEWPORT });
  await page.goto('/?mobile=1');
  await page.evaluate(async () => {
    const modulePath = '/src/mobile/panels/devMount.tsx';
    await import(/* @vite-ignore */ modulePath);
  });
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
  await page.getByTestId('btn-auto-cluster').click();
  await expect(page.getByTestId('clue-result')).toBeVisible();
  await expect(page.getByTestId('clue-word')).toHaveText('טבע');
}
