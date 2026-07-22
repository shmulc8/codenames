import { expect, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

export async function mountMobileBoard(page: Page): Promise<void> {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?mobile=1');
  await page.addScriptTag({
    type: 'module',
    content: "void import('/tests/harnesses/mobile-board.tsx')",
  });
  await page.waitForFunction(
    () =>
      Boolean(
        (window as Window & { __mobileBoardReady?: boolean })
          .__mobileBoardReady,
      ),
  );
}

export async function setFixtureBoard(page: Page): Promise<void> {
  await page.evaluate(({ words, roles }) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(words, roles);
  }, fixtureBoard);
  await expect(page.getByTestId('board-canvas')).toBeVisible();
}

export async function dispatchPointer(
  page: Page,
  testId: string,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  init: Pick<PointerEventInit, 'clientX' | 'clientY' | 'pointerId'>,
): Promise<void> {
  await page.getByTestId(testId).dispatchEvent(type, {
    ...init,
    bubbles: true,
    isPrimary: init.pointerId === 1,
    pointerType: 'touch',
  });
}
