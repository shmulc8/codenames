import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';
import { openMobileShell } from '../support/mobile-shell';

const GAME_VIEWPORTS = [
  { width: 700, height: 375 },
  { width: 700, height: 390 },
  { width: 764, height: 430 },
] as const;

async function installBoard(page: Page): Promise<void> {
  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);
}

async function expectDocumentBounded(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => {
      const root = document.scrollingElement;
      if (!root) throw new Error('Document scrolling element is unavailable');
      return {
        vertical: root.scrollHeight <= root.clientHeight + 1,
        horizontal: root.scrollWidth <= root.clientWidth + 1,
      };
    }),
  ).toEqual({ vertical: true, horizontal: true });
}

test.describe('bounded mobile game layout', () => {
  test.use({ hasTouch: true });

  for (const viewport of GAME_VIEWPORTS) {
    test(`keeps the document and gamebar inside ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await openMobileShell(page, viewport);
      await installBoard(page);
      await expectDocumentBounded(page);

      const geometry = await page.getByTestId('mobile-gamebar').evaluate((bar) => {
        const barRect = bar.getBoundingClientRect();
        const modeRect = bar
          .querySelector<HTMLElement>('.mobile-shell__mode')
          ?.getBoundingClientRect();
        const actionRect = bar
          .querySelector<HTMLElement>('.mobile-shell__gamebar-actions')
          ?.getBoundingClientRect();
        if (!modeRect || !actionRect) throw new Error('Gamebar controls are unavailable');
        return {
          scrollWidth: bar.scrollWidth,
          clientWidth: bar.clientWidth,
          modeInside:
            modeRect.left >= barRect.left - 1 &&
            modeRect.right <= barRect.right + 1 &&
            modeRect.bottom <= barRect.bottom + 1,
          actionsInside:
            actionRect.left >= barRect.left - 1 &&
            actionRect.right <= barRect.right + 1 &&
            actionRect.bottom <= barRect.bottom + 1,
        };
      });

      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
      expect(geometry.modeInside).toBe(true);
      expect(geometry.actionsInside).toBe(true);
    });
  }

  test('clue, check, and card-list overflow stays in bounded internal scrollers', async ({
    page,
  }) => {
    await openMobileShell(page, { width: 700, height: 375 });
    await installBoard(page);

    await page.getByTestId('tab-clue').click();
    await page.getByTestId('btn-get-clue').click();
    await expect(page.getByTestId('clue-result')).toBeVisible();
    const clueScroll = page.getByTestId('mobile-clue-scroll');
    await expect
      .poll(() =>
        clueScroll.evaluate((element) => ({
          overflowY: getComputedStyle(element).overflowY,
          scrollable: element.scrollHeight > element.clientHeight,
        })),
      )
      .toEqual({ overflowY: 'auto', scrollable: true });
    await page.getByRole('button', { name: 'סגירת חלון הרמז' }).click();

    await page.getByTestId('tab-check').click();
    await page.getByTestId('check-input').fill('טבעות');
    await page.getByTestId('btn-check').click();
    await expect(page.getByTestId('check-result')).toBeVisible();
    await expect
      .poll(() =>
        page.locator('.mobile-check').evaluate((element) => ({
          overflowY: getComputedStyle(element).overflowY,
          scrollable: element.scrollHeight > element.clientHeight,
        })),
      )
      .toEqual({ overflowY: 'auto', scrollable: true });

    await page.getByTestId('tab-board').click();
    await page.getByTestId('board-view-list').click();
    await expect(page.getByTestId('board-card-list')).toBeVisible();
    await expect
      .poll(() =>
        page.getByTestId('board-card-list').evaluate((element) => ({
          overflowY: getComputedStyle(element).overflowY,
          scrollable: element.scrollHeight > element.clientHeight,
        })),
      )
      .toEqual({ overflowY: 'auto', scrollable: true });

    await expectDocumentBounded(page);
  });

  test('operative form and internally scrolling result share two visible columns', async ({
    page,
  }) => {
    await openMobileShell(page, { width: 700, height: 390 });
    await installBoard(page);
    await page.getByTestId('mobile-mode-operative').click();

    const form = page.locator('.mobile-operative .operative-form');
    await page.getByTestId('operative-clue-input').fill('חיות');
    await page.getByTestId('operative-count-increment').click();
    await page.getByTestId('btn-operative').click();
    const result = page.getByTestId('operative-result');
    await expect(result).toBeVisible();
    await expect(result.getByRole('heading', { name: /רמז: חיות/ })).toBeFocused();

    const columns = await Promise.all([
      form.boundingBox(),
      result.boundingBox(),
      page.locator('.mobile-operative').boundingBox(),
    ]);
    const [formBox, resultBox, panelBox] = columns;
    expect(formBox).not.toBeNull();
    expect(resultBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    if (!formBox || !resultBox || !panelBox) throw new Error('Operative geometry is unavailable');

    expect(Math.abs(formBox.x - resultBox.x)).toBeGreaterThan(100);
    expect(formBox.y).toBeGreaterThanOrEqual(panelBox.y - 1);
    expect(resultBox.y).toBeGreaterThanOrEqual(panelBox.y - 1);
    expect(
      formBox.x + formBox.width <= resultBox.x + 1 ||
        resultBox.x + resultBox.width <= formBox.x + 1,
    ).toBe(true);
    expect(
      await result.evaluate((element) => ({
        overflowY: getComputedStyle(element).overflowY,
        scrollable: element.scrollHeight > element.clientHeight,
      })),
    ).toEqual({ overflowY: 'auto', scrollable: true });
    await expectDocumentBounded(page);
  });
});
