import { expect, test } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';
import { MOBILE_LANDSCAPE, MOBILE_PORTRAIT, openMobileShell } from '../support/mobile-shell';

test.describe('mobile app shell', () => {
  test.use({ hasTouch: true });

  test('requires landscape before setup or gameplay is available', async ({ page }) => {
    await openMobileShell(page, MOBILE_PORTRAIT);

    await expect(page.getByTestId('mobile-landscape-prompt')).toBeVisible();
    await expect(page.getByTestId('mobile-home')).toBeHidden();
    await expect(page.getByTestId('tabbar')).toBeHidden();

    await page.setViewportSize(MOBILE_LANDSCAPE);
    await expect(page.getByTestId('mobile-landscape-prompt')).toBeHidden();
    await expect(page.getByTestId('mobile-home')).toBeVisible();
    await expect(page.getByTestId('tabbar')).toBeVisible();
  });

  test('shows the camera-first home and four accessible navigation tabs', async ({ page }) => {
    await openMobileShell(page);

    await expect(page.getByTestId('mobile-home')).toBeVisible();
    await expect(page.getByTestId('btn-shoot')).toContainText('צלמו את הלוח');
    await expect(page.getByTestId('btn-random')).toContainText('אקראי');
    await expect(page.getByTestId('btn-resume')).toHaveCount(0);

    const tabs = page.getByTestId('tabbar').getByRole('tab');
    await expect(tabs).toHaveCount(4);
    await expect(page.getByTestId('tab-board')).toContainText('לוח');
    await expect(page.getByTestId('tab-clue')).toContainText('רמז');
    await expect(page.getByTestId('tab-check')).toContainText('בדיקה');
    await expect(page.getByTestId('tab-map')).toContainText('מפה');

    for (const tab of await tabs.all()) {
      const box = await tab.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      expect(box?.width).toBeGreaterThanOrEqual(44);
    }
  });

  test('switches game panels while keeping board and map out of desktop tab state', async ({
    page,
  }) => {
    await openMobileShell(page);
    await page.evaluate((board) => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().setBoard(board.words, board.roles);
    }, fixtureBoard);

    await expect(page.getByTestId('mobile-home')).toHaveCount(0);
    await expect(page.getByTestId('board-canvas')).toBeVisible();
    await expect(page.getByTestId('tile-0')).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const viewport = document.querySelector<HTMLElement>('.mobile-board__viewport');
          const tile = document.querySelector<HTMLElement>('[data-testid="tile-0"]');
          if (!viewport || !tile) return false;
          const viewportRect = viewport.getBoundingClientRect();
          const tileRect = tile.getBoundingClientRect();
          return tileRect.top >= viewportRect.top && tileRect.bottom <= viewportRect.bottom;
        }),
      )
      .toBe(true);
    const boardGeometry = await page.evaluate(() => {
      const viewport = document.querySelector<HTMLElement>('.mobile-board__viewport');
      if (!viewport) throw new Error('Mobile board geometry is unavailable');
      const viewportRect = viewport.getBoundingClientRect();
      return {
        viewportHeight: viewportRect.height,
        viewportWidth: viewportRect.width,
      };
    });
    expect(boardGeometry.viewportHeight).toBeGreaterThanOrEqual(224);
    expect(boardGeometry.viewportHeight).toBeLessThanOrEqual(321);
    expect(boardGeometry.viewportWidth / boardGeometry.viewportHeight).toBeGreaterThan(2);

    await page.getByTestId('tab-clue').click();
    await expect(page.getByTestId('stub-clue')).toBeVisible();
    await expect(page.getByTestId('tab-clue')).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.evaluate(() => window.__store?.getState().activeTab)).toBe('clue');

    await page.getByTestId('tab-check').click();
    await expect(page.getByTestId('stub-check')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().activeTab))
      .toBe('check');

    await page.getByTestId('tab-map').click();
    await expect(page.getByTestId('semantic-map')).toBeVisible();
    expect(await page.evaluate(() => window.__store?.getState().activeTab)).toBe('check');

    await page.getByTestId('tab-board').click();
    await expect(page.getByTestId('board-canvas')).toBeVisible();
    expect(await page.evaluate(() => window.__store?.getState().activeTab)).toBe('check');
  });

  test('deals a random board with loading feedback and enters the game', async ({ page }) => {
    await openMobileShell(page);
    await page.evaluate(() => {
      const realFetch = window.fetch.bind(window);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.assign(window, { __releaseMobileDeal: release });
      window.fetch = async (input, init) => {
        if (String(input).includes('/api/deal')) await gate;
        return realFetch(input, init);
      };
    });

    await page.getByTestId('btn-random').click();
    await expect(page.getByTestId('btn-random').getByTestId('loading-spinner')).toBeVisible();
    await expect(page.getByTestId('btn-random')).toBeDisabled();

    await page.evaluate(() => {
      const release = (window as Window & { __releaseMobileDeal?: () => void }).__releaseMobileDeal;
      if (!release) throw new Error('The deal gate was not installed');
      release();
    });

    await expect(page.getByTestId('board-canvas')).toBeVisible();
    await expect(page.getByTestId('loading-spinner')).toHaveCount(0);
    expect(
      await page.evaluate(() => {
        const state = window.__store?.getState();
        return { screen: state?.screen, tiles: state?.tiles.length };
      }),
    ).toEqual({ screen: 'game', tiles: 25 });
  });

  test('shows resume only for an existing board and surfaces random-board errors', async ({
    page,
  }) => {
    await openMobileShell(page);
    await page.evaluate(() => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        if (String(input).includes('/api/deal')) {
          return new Response(JSON.stringify({ error: 'לוח אקראי לא זמין' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return realFetch(input, init);
      };
    });

    await page.getByTestId('btn-random').click();
    await expect(page.getByTestId('toast')).toContainText('לוח אקראי לא זמין');
    await expect(page.getByTestId('loading-spinner')).toHaveCount(0);
    await expect(page.getByTestId('mobile-home')).toBeVisible();

    await page.evaluate((board) => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().setBoard(board.words, board.roles);
      window.__store.setState({ screen: 'setup' });
    }, fixtureBoard);
    await expect(page.getByTestId('btn-resume')).toBeVisible();
  });

  test('moves the same navigation to a landscape side rail with reduced motion', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openMobileShell(page, { width: 700, height: 390 });

    const rail = page.getByTestId('tabbar');
    const box = await rail.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(610);
    expect(box?.width).toBeLessThanOrEqual(90);
    expect(box?.height).toBeGreaterThanOrEqual(380);
    await expect(rail.getByRole('tab')).toHaveCount(4);
    await expect(page.getByTestId('tab-board')).toHaveCSS('transition-duration', '0s');
  });
});

test.describe('coarse-pointer tablet', () => {
  test.use({
    hasTouch: true,
    viewport: { width: 1024, height: 768 },
  });

  test('keeps the mobile board available above the phone breakpoint', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((board) => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().setBoard(board.words, board.roles);
    }, fixtureBoard);

    await expect(page.getByTestId('mobile-shell')).toBeVisible();
    await expect(page.getByTestId('board-canvas')).toBeVisible();
    await expect(page.getByTestId(/^tile-\d+$/)).toHaveCount(25);
  });
});

test.describe('desktop regression', () => {
  test('keeps the mobile shell absent and the desktop layout mounted', async ({ page }) => {
    await page.setViewportSize({ width: 1320, height: 900 });
    await page.goto('/');

    await expect(page.getByTestId('mobile-shell')).toHaveCount(0);
    await page.evaluate((board) => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().setBoard(board.words, board.roles);
    }, fixtureBoard);
    await expect(page.locator('.main-screen')).toBeVisible();
    await expect(page.getByTestId('board-grid')).toBeVisible();

    await page.setViewportSize(MOBILE_PORTRAIT);
    await expect(page.getByTestId('mobile-shell')).toBeVisible();
    await expect(page.getByTestId('mobile-landscape-prompt')).toBeVisible();
    await expect(page.getByTestId('board-canvas')).toBeHidden();
    await expect(page.getByTestId('board-grid')).toHaveCount(0);

    await page.setViewportSize(MOBILE_LANDSCAPE);
    await expect(page.getByTestId('board-canvas')).toBeVisible();

    await page.setViewportSize({ width: 1320, height: 900 });
    await expect(page.getByTestId('mobile-shell')).toHaveCount(0);
    await expect(page.locator('.main-screen')).toBeVisible();
    await expect(page.getByTestId('board-grid')).toBeVisible();
  });
});
