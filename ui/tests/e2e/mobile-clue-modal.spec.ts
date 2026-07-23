import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';
import { MOBILE_LANDSCAPE, openMobileShell } from '../support/mobile-shell';

async function installBoard(page: Page): Promise<void> {
  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);
}

test.describe('mobile clue modal', () => {
  test.use({ hasTouch: true });

  test('the clue tab opens an accessible focus-trapped dialog and Escape restores focus', async ({
    page,
  }) => {
    await openMobileShell(page, MOBILE_LANDSCAPE);
    await installBoard(page);

    const trigger = page.getByTestId('tab-clue');
    await trigger.click();

    const modal = page.getByTestId('mobile-clue-modal');
    const close = page.getByRole('button', { name: 'סגירת חלון הרמז' });
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(modal).toHaveAccessibleName('יצירת רמז');
    await expect(close).toBeFocused();
    await expect(page.locator('.mobile-shell__background')).toHaveAttribute('aria-hidden', 'true');
    expect(
      await page.locator('.mobile-shell__background').evaluate((element) => {
        return (element as HTMLElement & { inert: boolean }).inert;
      }),
    ).toBe(true);

    await close.press('Shift+Tab');
    await expect(modal.locator(':focus')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator('.mobile-shell__background')).not.toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  test('a same-team board focus opens once, auto-generates, scrolls to the result, and can be used', async ({
    page,
  }) => {
    await openMobileShell(page, MOBILE_LANDSCAPE);
    await installBoard(page);

    await page.getByTestId('tab-board').focus();
    await page.evaluate((words) => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      const store = window.__store.getState();
      store.toggleMobileSelection(words[0]);
      store.toggleMobileSelection(words[1]);
      store.openMobileClue();
    }, fixtureBoard.words);

    const modal = page.getByTestId('mobile-clue-modal');
    await expect(modal).toBeVisible();
    await expect(modal.getByTestId('btn-get-clue').getByTestId('loading-spinner')).toBeVisible();
    await expect(modal.getByTestId('clue-word')).toHaveText('טבע');

    expect((await page.evaluate(() => window.__lastSpymasterReq))?.focus).toEqual(
      fixtureBoard.words.slice(0, 2),
    );
    await expect
      .poll(() =>
        page.evaluate(() => {
          const scroller = document.querySelector<HTMLElement>(
            '[data-testid="mobile-clue-scroll"]',
          );
          const result = document.querySelector<HTMLElement>('[data-testid="clue-result"]');
          if (!scroller || !result) return false;
          const scrollerRect = scroller.getBoundingClientRect();
          const resultRect = result.getBoundingClientRect();
          return resultRect.top >= scrollerRect.top - 1 && resultRect.top < scrollerRect.bottom;
        }),
      )
      .toBe(true);

    await modal.getByTestId('btn-use-clue').click();
    await expect(modal.getByTestId('btn-use-clue')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => window.__store?.getState().log.length)).toBe(1);
  });

  test('the clue tab keeps manual controls available and generates only after the user asks', async ({
    page,
  }) => {
    await openMobileShell(page, MOBILE_LANDSCAPE);
    await installBoard(page);

    await page.getByTestId('tab-clue').click();
    const modal = page.getByTestId('mobile-clue-modal');
    await expect(modal.getByTestId('btn-get-clue')).toHaveText('מצא לי את הצירוף הכי טוב');
    expect(await page.evaluate(() => window.__lastSpymasterReq)).toBeUndefined();

    await modal.getByTestId('btn-get-clue').click();
    await expect(modal.getByTestId('clue-word')).toHaveText('טבע');
    expect((await page.evaluate(() => window.__lastSpymasterReq))?.focus).toBeUndefined();
  });
});
