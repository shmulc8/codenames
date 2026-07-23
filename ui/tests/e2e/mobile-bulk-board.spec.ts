import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';
import { MOBILE_LANDSCAPE, openMobileShell } from '../support/mobile-shell';

async function openSeededBoard(page: Page): Promise<void> {
  await openMobileShell(page, MOBILE_LANDSCAPE);
  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);
  await expect(page.getByTestId('board-canvas')).toBeVisible();
}

test.describe('mobile bulk board actions', () => {
  test.use({ hasTouch: true });

  test('toggles multiple selections and gates clue generation by a legal team focus', async ({
    page,
  }) => {
    await openSeededBoard(page);

    const firstRed = page.getByTestId('tile-0');
    const secondRed = page.getByTestId('tile-1');
    await firstRed.click();
    await expect(page.getByTestId('mobile-board-action-bar')).toBeVisible();
    await expect(page.getByTestId('board-selection-count')).toHaveText('1');
    await expect(firstRed).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-action-clue')).toBeEnabled();

    await secondRed.click();
    await expect(page.getByTestId('board-selection-count')).toHaveText('2');
    await expect(firstRed.locator('.mobile-board-tile__badge')).toHaveText('1');
    await expect(secondRed.locator('.mobile-board-tile__badge')).toHaveText('2');

    await firstRed.click();
    await expect(page.getByTestId('board-selection-count')).toHaveText('1');
    await expect(firstRed).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('board-selection-clear').click();
    await page.getByTestId('tile-17').click();
    await expect(page.getByTestId('board-action-clue')).toBeDisabled();
    await expect(page.getByTestId('board-clue-unavailable')).toHaveText('בחרו קלפים מאותה קבוצה');

    await page.getByTestId('board-selection-clear').click();
    await firstRed.click();
    await page.getByTestId('tile-9').click();
    await expect(page.getByTestId('board-action-clue')).toBeDisabled();
    await expect(page.getByTestId('board-clue-unavailable')).toBeVisible();

    await page.getByTestId('board-selection-clear').click();
    await firstRed.click();
    await secondRed.click();
    await expect(page.getByTestId('board-action-clue')).toBeEnabled();
    await page.getByTestId('board-action-clue').click();

    expect(
      await page.evaluate(() => {
        const state = window.__store?.getState();
        return {
          clueModalOpen: state?.clueModalOpen,
          selected: state?.selected,
          target: state?.target,
        };
      }),
    ).toEqual({
      clueModalOpen: true,
      selected: [fixtureBoard.words[0], fixtureBoard.words[1]],
      target: 'red',
    });
  });

  test('eliminates a batch, undoes it, and directly restores an eliminated tile', async ({
    page,
  }) => {
    await openSeededBoard(page);

    const redTile = page.getByTestId('tile-0');
    const blueTile = page.getByTestId('tile-9');
    await redTile.click();
    await blueTile.click();
    await expect(page.getByTestId('board-selection-count')).toHaveText('2');
    await page.getByTestId('board-action-eliminate').click();

    await expect(redTile).toHaveAttribute('data-lifecycle', 'chosen');
    await expect(blueTile).toHaveAttribute('data-lifecycle', 'chosen');
    await expect(page.getByTestId('mobile-board-action-bar')).toHaveCount(0);
    await expect(page.getByTestId('board-undo-snackbar')).toBeVisible();
    expect(await page.evaluate(() => window.__store?.getState().mobileSelection)).toEqual([]);

    await page.getByTestId('board-action-undo').click();
    await expect(redTile).toHaveAttribute('data-lifecycle', 'inPlay');
    await expect(blueTile).toHaveAttribute('data-lifecycle', 'inPlay');
    await expect(page.getByTestId('board-undo-snackbar')).toHaveCount(0);

    await redTile.click();
    await page.getByTestId('board-action-eliminate').click();
    await expect(redTile).toHaveAttribute('data-lifecycle', 'chosen');
    await redTile.click();
    await expect(redTile).toHaveAttribute('data-lifecycle', 'inPlay');
    await expect(redTile).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('toast')).toContainText('הקלף הוחזר למשחק');
    expect(await page.evaluate(() => window.__store?.getState().mobileSelection)).toEqual([]);
  });

  test('keeps operative selection private and exposes only the reveal action', async ({ page }) => {
    await openSeededBoard(page);
    await page.evaluate(() => window.__store?.getState().setMode('operative'));

    const tile = page.getByTestId('tile-0');
    await expect(tile).toHaveAttribute('data-role', 'neutral');
    await tile.click();

    const actionBar = page.getByTestId('mobile-board-action-bar');
    await expect(actionBar).toBeVisible();
    await expect(actionBar.getByTestId('board-action-clue')).toHaveCount(0);
    await expect(actionBar.getByTestId('board-action-eliminate')).toBeVisible();
    await expect(page.getByTestId('board-clue-unavailable')).toHaveCount(0);
    await expect(tile).toHaveAccessibleName('אריה, נבחר');
    await expect(actionBar).not.toContainText(/אדום|כחול|ניטרלי|מתנקש/);
  });

  test('suppresses touch-drag and pointer-cancel clicks but allows keyboard Enter', async ({
    page,
  }) => {
    await openSeededBoard(page);
    const layer = page.locator('[data-board-transform]');
    const initialTransform = await layer.getAttribute('style');

    await page.evaluate(() => {
      const tile = document.querySelector<HTMLElement>('[data-testid="tile-0"]');
      if (!tile) throw new Error('Missing first mobile tile');
      const rect = tile.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const pointer = (type: string, clientX: number, clientY: number): void => {
        tile.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            clientX,
            clientY,
            isPrimary: true,
            pointerId: 7,
            pointerType: 'touch',
          }),
        );
      };

      pointer('pointerdown', x, y);
      pointer('pointermove', x + 64, y + 36);
    });
    await expect.poll(() => layer.getAttribute('style')).not.toBe(initialTransform);

    await page.evaluate(() => {
      const tile = document.querySelector<HTMLElement>('[data-testid="tile-0"]');
      if (!tile) throw new Error('Missing first mobile tile');
      const rect = tile.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      tile.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          clientX: x + 64,
          clientY: y + 36,
          isPrimary: true,
          pointerId: 7,
          pointerType: 'touch',
        }),
      );
      tile.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });

    await expect(page.getByTestId('tile-0')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => window.__store?.getState().mobileSelection)).toEqual([]);

    await page.evaluate(() => {
      const tile = document.querySelector<HTMLElement>('[data-testid="tile-1"]');
      if (!tile) throw new Error('Missing second mobile tile');
      const rect = tile.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      tile.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          clientX: x,
          clientY: y,
          isPrimary: true,
          pointerId: 8,
          pointerType: 'touch',
        }),
      );
      tile.dispatchEvent(
        new PointerEvent('pointercancel', {
          bubbles: true,
          clientX: x,
          clientY: y,
          isPrimary: true,
          pointerId: 8,
          pointerType: 'touch',
        }),
      );
      tile.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    await expect(page.getByTestId('tile-1')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('tile-0').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('tile-0')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.__store?.getState().mobileSelection)).toEqual([
      fixtureBoard.words[0],
    ]);
  });
});
