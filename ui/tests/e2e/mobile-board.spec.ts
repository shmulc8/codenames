import { expect, test } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';
import { dispatchPointer, mountMobileBoard, setFixtureBoard } from '../support/mobile-board';

test.describe('mobile pan and zoom board', () => {
  test('renders all 25 tiles on a fit-to-screen canvas with canonical roles', async ({ page }) => {
    await mountMobileBoard(page);
    await setFixtureBoard(page);

    const canvas = page.getByTestId('board-canvas');
    await expect(canvas.getByTestId(/^tile-\d+$/)).toHaveCount(25);
    await expect(page.getByTestId('minimap')).toBeVisible();
    await expect(page.getByTestId('btn-fit-board')).toBeVisible();
    const minimapPlacement = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('.mobile-board__viewport');
      const minimap = document.querySelector<HTMLElement>('[data-testid="minimap"]');
      if (!viewport || !minimap) throw new Error('Board overview controls were not rendered');
      const viewportRect = viewport.getBoundingClientRect();
      const minimapRect = minimap.getBoundingClientRect();
      return {
        minimapTop: minimapRect.top,
        viewportBottom: viewportRect.bottom,
      };
    });
    expect(minimapPlacement.minimapTop).toBeGreaterThanOrEqual(minimapPlacement.viewportBottom);

    for (let index = 0; index < fixtureBoard.words.length; index += 1) {
      const word = fixtureBoard.words[index];
      const tile = canvas.getByTestId(`tile-${index}`);
      await expect(tile).toHaveAttribute('data-word', word);
      await expect(tile).toHaveAttribute('data-role', fixtureBoard.roles[word]);
      await expect(tile).toHaveAttribute('data-lifecycle', 'inPlay');
    }

    await expect(canvas.locator('[data-board-transform]')).toHaveAttribute('data-at-fit', 'true');
  });

  test('treats a small pointer movement as a tap and opens the action sheet', async ({ page }) => {
    await mountMobileBoard(page);
    await setFixtureBoard(page);

    await dispatchPointer(page, 'tile-0', 'pointerdown', {
      clientX: 80,
      clientY: 240,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-0', 'pointermove', {
      clientX: 86,
      clientY: 244,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-0', 'pointerup', {
      clientX: 86,
      clientY: 244,
      pointerId: 1,
    });

    const sheet = page.getByTestId('sheet-mark-revealed');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(fixtureBoard.words[0]);
    await expect(sheet).toContainText('אדום');
  });

  test('a large pointer movement pans without opening the action sheet and fit resets it', async ({
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
    await expect(page.getByTestId('sheet-mark-revealed')).toHaveCount(0);

    await page.getByTestId('btn-fit-board').click();
    await expect(layer).toHaveAttribute('data-at-fit', 'true');
    await expect(layer).toHaveAttribute('style', initialTransform ?? '');
  });

  test('switches between the visual board and a readable card list', async ({ page }) => {
    await mountMobileBoard(page);

    await expect(page.getByTestId('loading-spinner')).toBeVisible();
    await expect(page.getByTestId('board-view-visual')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('board-card-list')).toHaveCount(0);

    await setFixtureBoard(page);
    await expect(page.getByTestId('loading-spinner')).toHaveCount(0);
    await page.getByTestId('board-view-list').click();

    await expect(page.getByTestId('board-card-list')).toBeVisible();
    await expect(page.getByTestId('board-view-list')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('minimap')).toHaveCount(0);
    await expect(page.getByTestId('board-list-item-0')).toContainText(fixtureBoard.words[0]);
    await expect(page.getByTestId('board-list-item-0')).toContainText('אדום');

    await page.getByTestId('board-list-item-0').click();
    await expect(page.getByTestId('sheet-mark-revealed')).toBeVisible();
    await page.getByRole('button', { name: 'ביטול' }).click();

    await page.getByTestId('board-view-visual').click();
    await expect(page.getByTestId('board-card-list')).toHaveCount(0);
    await expect(page.getByTestId('minimap')).toBeVisible();
  });

  test('pinches between fit and one-card scale and double-tap toggles point zoom', async ({
    page,
  }) => {
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

    await page.getByTestId('btn-fit-board').click();
    await expect(layer).toHaveAttribute('style', fitTransform ?? '');
    for (let tap = 0; tap < 2; tap += 1) {
      await dispatchPointer(page, 'tile-2', 'pointerdown', {
        clientX: 210,
        clientY: 300,
        pointerId: 1,
      });
      await dispatchPointer(page, 'tile-2', 'pointerup', {
        clientX: 210,
        clientY: 300,
        pointerId: 1,
      });
    }
    await expect(layer).toHaveAttribute('data-at-fit', 'false');
    for (let tap = 0; tap < 2; tap += 1) {
      await dispatchPointer(page, 'tile-2', 'pointerdown', {
        clientX: 210,
        clientY: 300,
        pointerId: 1,
      });
      await dispatchPointer(page, 'tile-2', 'pointerup', {
        clientX: 210,
        clientY: 300,
        pointerId: 1,
      });
    }
    await expect(layer).toHaveAttribute('data-at-fit', 'true');
  });

  test('snaps rubber-band pan immediately when reduced motion is preferred', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mountMobileBoard(page);
    await setFixtureBoard(page);
    const layer = page.locator('[data-board-transform]');
    const fitTransform = await layer.getAttribute('style');

    await dispatchPointer(page, 'tile-0', 'pointerdown', {
      clientX: 90,
      clientY: 260,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-0', 'pointermove', {
      clientX: 150,
      clientY: 300,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-0', 'pointerup', {
      clientX: 150,
      clientY: 300,
      pointerId: 1,
    });

    await expect(layer).toHaveAttribute('style', fitTransform ?? '');
    await expect(page.getByTestId('sheet-mark-revealed')).toHaveCount(0);
  });

  test('marks and restores a tile, defaulting chosenBy to its own role', async ({ page }) => {
    await mountMobileBoard(page);
    await setFixtureBoard(page);

    await dispatchPointer(page, 'tile-9', 'pointerdown', {
      clientX: 130,
      clientY: 280,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-9', 'pointerup', {
      clientX: 130,
      clientY: 280,
      pointerId: 1,
    });
    await expect(page.getByTestId('sheet-chosenby-blue')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('btn-mark-chosen').click();

    await expect(page.getByTestId('tile-9')).toHaveAttribute('data-lifecycle', 'chosen');
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().tiles[9]))
      .toMatchObject({
        lifecycle: 'chosen',
        chosenBy: 'blue',
      });

    await dispatchPointer(page, 'tile-9', 'pointerdown', {
      clientX: 80,
      clientY: 250,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-9', 'pointerup', { clientX: 80, clientY: 250, pointerId: 1 });
    await expect(page.getByTestId('btn-mark-chosen')).toHaveText('החזר למשחק');
    await page.getByTestId('btn-mark-chosen').click();
    await expect(page.getByTestId('tile-9')).toHaveAttribute('data-lifecycle', 'inPlay');
  });

  test('routes clue selection through the store and surfaces cluster errors as a toast', async ({
    page,
  }) => {
    await mountMobileBoard(page);
    await setFixtureBoard(page);

    await dispatchPointer(page, 'tile-0', 'pointerdown', {
      clientX: 80,
      clientY: 250,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-0', 'pointerup', { clientX: 80, clientY: 250, pointerId: 1 });
    await page.getByText('הוסיפו לרמז').click();
    await page.getByText('ביטול', { exact: true }).click();

    await dispatchPointer(page, 'tile-9', 'pointerdown', {
      clientX: 80,
      clientY: 250,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-9', 'pointerup', { clientX: 80, clientY: 250, pointerId: 1 });
    await page.getByText('הוסיפו לרמז').click();
    await expect(page.getByTestId('toast')).toContainText('אפשר לבחור רק קלפים בצבע אחד');
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().selected))
      .toEqual([fixtureBoard.words[0]]);
  });

  test('shows the store-driven game-over banner when the assassin is revealed', async ({
    page,
  }) => {
    await mountMobileBoard(page);
    await setFixtureBoard(page);

    await dispatchPointer(page, 'tile-24', 'pointerdown', {
      clientX: 80,
      clientY: 250,
      pointerId: 1,
    });
    await dispatchPointer(page, 'tile-24', 'pointerup', {
      clientX: 80,
      clientY: 250,
      pointerId: 1,
    });
    await page.getByTestId('btn-mark-chosen').click();

    await expect(page.getByText('המתנקש נחשף — סוף משחק', { exact: true })).toBeVisible();
    await expect(page.getByTestId('tile-24')).toHaveAttribute('data-lifecycle', 'chosen');
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
