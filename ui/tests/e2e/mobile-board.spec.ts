import { expect, test } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';
import { dispatchPointer, mountMobileBoard, setFixtureBoard } from '../support/mobile-board';

test.describe('mobile pan and zoom board', () => {
  test('renders all 25 tiles inside a width-and-height fitted canvas', async ({ page }) => {
    await mountMobileBoard(page);
    await setFixtureBoard(page);

    const canvas = page.getByTestId('board-canvas');
    await expect(canvas.getByTestId(/^tile-\d+$/)).toHaveCount(25);
    await expect(page.getByTestId('minimap')).toHaveCount(0);
    await expect(page.getByTestId('btn-fit-board')).toBeVisible();

    for (let index = 0; index < fixtureBoard.words.length; index += 1) {
      const word = fixtureBoard.words[index];
      const tile = canvas.getByTestId(`tile-${index}`);
      await expect(tile).toHaveAttribute('data-word', word);
      await expect(tile).toHaveAttribute('data-role', fixtureBoard.roles[word]);
      await expect(tile).toHaveAttribute('data-lifecycle', 'inPlay');
    }

    await expect(canvas.locator('[data-board-transform]')).toHaveAttribute('data-at-fit', 'true');
    expect(
      await page.evaluate(() => {
        const viewport = document.querySelector<HTMLElement>('.mobile-board__viewport');
        const tiles = [...document.querySelectorAll<HTMLElement>('[data-mobile-tile="true"]')];
        if (!viewport || tiles.length === 0) return false;
        const viewportRect = viewport.getBoundingClientRect();
        return tiles.every((tile) => {
          const tileRect = tile.getBoundingClientRect();
          return (
            tileRect.left >= viewportRect.left - 1 &&
            tileRect.right <= viewportRect.right + 1 &&
            tileRect.top >= viewportRect.top - 1 &&
            tileRect.bottom <= viewportRect.bottom + 1
          );
        });
      }),
    ).toBe(true);
  });

  test('selects immediately with a native tile click and never opens the removed drawer', async ({
    page,
  }) => {
    await mountMobileBoard(page);
    await setFixtureBoard(page);

    const tile = page.getByTestId('tile-0');
    await tile.click();

    await expect(tile).toHaveAttribute('aria-pressed', 'true');
    await expect(tile.locator('.mobile-board-tile__badge')).toHaveText('1');
    await expect(page.getByTestId('mobile-board-action-bar')).toBeVisible();
    await expect(page.getByTestId('sheet-mark-revealed')).toHaveCount(0);

    await tile.click();
    await expect(tile).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('mobile-board-action-bar')).toHaveCount(0);
  });

  test('pans past the tap threshold without selecting and fit restores both axes', async ({
    page,
  }) => {
    await mountMobileBoard(page);
    await setFixtureBoard(page);

    const layer = page.locator('[data-board-transform]');
    const initialTransform = await layer.getAttribute('style');
    await dispatchPointer(page, 'tile-0', 'pointerdown', {
      clientX: 90,
      clientY: 260,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-0', 'pointermove', {
      clientX: 156,
      clientY: 302,
      pointerId: 1,
    });

    await expect.poll(() => layer.getAttribute('style')).not.toBe(initialTransform);
    await dispatchPointer(page, 'tile-0', 'pointerup', {
      clientX: 156,
      clientY: 302,
      pointerId: 1,
    });
    await expect(page.getByTestId('tile-0')).toHaveAttribute('aria-pressed', 'false');

    await page.getByTestId('btn-fit-board').click();
    await expect(layer).toHaveAttribute('data-at-fit', 'true');
    await expect(layer).toHaveAttribute('style', initialTransform ?? '');
  });

  test('switches to a readable list that uses the same bulk selection', async ({ page }) => {
    await mountMobileBoard(page);

    await expect(page.getByTestId('loading-spinner')).toBeVisible();
    await expect(page.getByTestId('board-view-visual')).toHaveAttribute('aria-pressed', 'true');
    await setFixtureBoard(page);

    await page.getByTestId('board-view-list').click();
    const firstItem = page.getByTestId('board-list-item-0');
    await expect(page.getByTestId('board-card-list')).toBeVisible();
    await expect(page.getByTestId('board-view-list')).toHaveAttribute('aria-pressed', 'true');
    await expect(firstItem).toContainText(fixtureBoard.words[0]);
    await expect(firstItem).toContainText('אדום');

    await firstItem.click();
    await expect(firstItem).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-selection-count')).toHaveText('1');

    await page.getByTestId('board-view-visual').click();
    await expect(page.getByTestId('tile-0')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('minimap')).toHaveCount(0);
  });

  test('keeps pinch zoom and restores fit with the explicit control', async ({ page }) => {
    await mountMobileBoard(page);
    await setFixtureBoard(page);
    const layer = page.locator('[data-board-transform]');
    const fitTransform = await layer.getAttribute('style');

    await dispatchPointer(page, 'tile-0', 'pointerdown', {
      clientX: 120,
      clientY: 260,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-1', 'pointerdown', {
      clientX: 240,
      clientY: 260,
      pointerId: 2,
    });
    await dispatchPointer(page, 'tile-0', 'pointermove', {
      clientX: 70,
      clientY: 260,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-1', 'pointermove', {
      clientX: 300,
      clientY: 260,
      pointerId: 2,
    });
    await expect(layer).toHaveAttribute('data-at-fit', 'false');
    await dispatchPointer(page, 'tile-0', 'pointerup', { clientX: 70, clientY: 260, pointerId: 1 });
    await dispatchPointer(page, 'tile-1', 'pointerup', {
      clientX: 300,
      clientY: 260,
      pointerId: 2,
    });

    await expect(page.locator('[data-mobile-tile][aria-pressed="true"]')).toHaveCount(0);
    await page.getByTestId('btn-fit-board').click();
    await expect(layer).toHaveAttribute('data-at-fit', 'true');
    await expect(layer).toHaveAttribute('style', fitTransform ?? '');
  });

  test('bulk reveals, restores by tapping, and reports assassin game over', async ({ page }) => {
    await mountMobileBoard(page);
    await setFixtureBoard(page);

    const blueTile = page.getByTestId('tile-9');
    await blueTile.click();
    await page.getByTestId('board-action-eliminate').click();
    await expect(blueTile).toHaveAttribute('data-lifecycle', 'chosen');

    await blueTile.click();
    await expect(blueTile).toHaveAttribute('data-lifecycle', 'inPlay');
    await expect(page.getByTestId('toast')).toContainText('הקלף הוחזר למשחק');

    const assassin = page.getByTestId('tile-24');
    await assassin.click();
    await page.getByTestId('board-action-eliminate').click();
    await expect(page.getByText('המתנקש נחשף — סוף משחק', { exact: true })).toBeVisible();
    await expect(assassin).toHaveAttribute('data-lifecycle', 'chosen');
  });
});

test.describe('desktop regression', () => {
  test('never mounts the mobile canvas and keeps the desktop board', async ({ page }) => {
    await page.setViewportSize({ width: 1320, height: 900 });
    await page.goto('/?mobile=1');
    await page.getByTestId('btn-random-board').click();
    await page.getByTestId('btn-confirm-board').click();

    await expect(page.getByTestId('board-canvas')).toHaveCount(0);
    await expect(page.getByTestId('board-grid')).toBeVisible();
    await expect(page.getByTestId(/^tile-\d+$/)).toHaveCount(25);
  });
});
