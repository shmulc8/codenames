import { expect, test, type Locator, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';
import { MOBILE_LANDSCAPE, openMobileShell } from '../support/mobile-shell';

async function installBoard(page: Page): Promise<void> {
  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);
}

async function bootMobileOperative(page: Page): Promise<void> {
  await openMobileShell(page, MOBILE_LANDSCAPE);
  await installBoard(page);
  await page.getByTestId('mobile-mode-operative').click();
  await expect(page.getByTestId('stub-operative')).toBeVisible();
}

async function expectTouchTarget(control: Locator): Promise<void> {
  const box = await control.boundingBox();
  expect(box?.height).toBeGreaterThanOrEqual(44);
  expect(box?.width).toBeGreaterThanOrEqual(44);
}

test.describe('mobile operative mode', () => {
  test.use({ hasTouch: true });

  test('switches modes with the correct navigation and touch-sized controls', async ({ page }) => {
    await openMobileShell(page, MOBILE_LANDSCAPE);
    await installBoard(page);

    // Measure touch targets once the game bar has settled (avoids a mid-layout sub-pixel read).
    await expect(page.getByTestId('mobile-gamebar')).toBeVisible();
    await expectTouchTarget(page.getByTestId('mobile-mode-spymaster'));
    await expectTouchTarget(page.getByTestId('mobile-mode-operative'));
    await expectTouchTarget(page.getByTestId('mobile-edit-board'));
    await expectTouchTarget(page.getByRole('link', { name: 'איך זה עובד' }));

    await expect(page.getByTestId('mobile-mode-spymaster')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tabbar').getByRole('tab')).toHaveCount(4);
    await expect(page.getByTestId('tab-board')).toHaveAttribute('aria-selected', 'true');

    await page.getByTestId('mobile-mode-operative').click();
    await expect(page.getByTestId('mobile-mode-operative')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tab-operative')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('stub-operative')).toBeVisible();
    await expect(page.getByTestId('tabbar').getByRole('tab')).toHaveCount(3);
    await expect(page.getByTestId('tab-clue')).toHaveCount(0);
    await expect(page.getByTestId('tab-check')).toHaveCount(0);

    // Returning to spymaster lands on the board (the clue lives in a modal now, not a tab panel).
    await page.getByTestId('mobile-mode-spymaster').click();
    await expect(page.getByTestId('mobile-mode-spymaster')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tab-board')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tabbar').getByRole('tab')).toHaveCount(4);
  });

  test('enforces count bounds and renders the complete operative response', async ({ page }) => {
    await bootMobileOperative(page);

    const clueInput = page.getByTestId('operative-clue-input');
    const decrement = page.getByTestId('operative-count-decrement');
    const increment = page.getByTestId('operative-count-increment');
    const submit = page.getByTestId('btn-operative');

    await expect(page.getByTestId('operative-count-value')).toHaveText('1');
    await expect(decrement).toBeDisabled();
    await expect(submit).toBeDisabled();

    for (let count = 1; count < 9; count += 1) await increment.click();
    await expect(page.getByTestId('operative-count-value')).toHaveText('9');
    await expect(increment).toBeDisabled();

    await page.evaluate(() => {
      const realFetch = window.fetch.bind(window);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.assign(window, { __releaseOperativeRequest: release });
      window.fetch = async (input, init) => {
        if (String(input).includes('/api/coach/operative')) await gate;
        return realFetch(input, init);
      };
    });

    await clueInput.fill('  חיות  ');
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(clueInput).toBeDisabled();
    await expect(page.getByTestId('operative-count')).toHaveAttribute('disabled', '');
    await expect(submit).toBeDisabled();
    await expect(submit.getByTestId('loading-spinner')).toBeVisible();

    await page.evaluate(() => {
      const release = (window as Window & { __releaseOperativeRequest?: () => void })
        .__releaseOperativeRequest;
      if (!release) throw new Error('The operative request gate was not installed');
      release();
    });

    await expect(page.getByTestId('operative-result')).toBeVisible();
    await expect(page.getByTestId('operative-result-clue')).toHaveText('חיות');
    await expect(page.getByTestId('operative-picks-list').locator('li')).toHaveCount(9);
    await expect(page.getByTestId('operative-ranking-list').locator('li')).toHaveCount(25);
    await expect(page.getByRole('meter')).toHaveCount(25);
    await expect(page.getByRole('meter').first()).toHaveAttribute('aria-valuenow', '95');
    await expect(page.getByTestId('operative-agreement')).toContainText('9');

    const request = await page.evaluate(() => window.__lastOperativeReq);
    expect(request).toMatchObject({
      clue: 'חיות',
      count: 9,
      vocab_mode: 'curated',
    });
    expect(request?.words).toEqual(fixtureBoard.words);
    expect(request?.roles[fixtureBoard.words[0]]).toBe('my');
    expect(request?.roles[fixtureBoard.words[9]]).toBe('opp');
    expect(request?.roles[fixtureBoard.words[17]]).toBe('neutral');
    expect(request?.roles[fixtureBoard.words[24]]).toBe('assassin');
  });

  test('keeps every unrevealed role private across board, list, and map', async ({ page }) => {
    await bootMobileOperative(page);
    await page.getByTestId('tab-board').click();

    const tiles = page.getByTestId(/^tile-\d+$/);
    await expect(tiles).toHaveCount(25);
    await expect(page.locator('[data-mobile-tile][data-role="neutral"]')).toHaveCount(25);
    await expect(page.locator('[data-mobile-tile] .mobile-board-tile__role')).toHaveCount(0);
    await expect(page.getByTestId('tile-0')).toHaveAccessibleName('אריה');
    await expect(page.getByTestId('tile-9')).toHaveAccessibleName('ים');
    await expect(page.getByTestId('tile-24')).toHaveAccessibleName('נחש');

    await page.getByTestId('board-view-list').click();
    const cardList = page.getByTestId('board-card-list');
    await expect(cardList.getByRole('button')).toHaveCount(25);
    await expect(cardList.getByText('צבע מוסתר')).toHaveCount(25);
    await expect(cardList.locator('.cn-role-icon')).toHaveCount(0);
    await expect(cardList.locator('.role-red, .role-blue, .role-assassin')).toHaveCount(0);

    await page.getByTestId('tab-map').click();
    await expect(page.getByTestId('semantic-map').getByRole('button')).toHaveCount(25);
    await expect(page.locator('[data-testid^="map-dot-"][data-role="neutral"]')).toHaveCount(25);
    await expect(page.locator('[data-testid^="map-danger-"]')).toHaveCount(0);
    await expect(page.getByTestId('map-hint-node')).toHaveCount(0);

    await page.getByTestId('map-legend-toggle').click();
    const legend = page.getByTestId('map-legend');
    await expect(legend).toContainText('צבעי הקלפים נשארים מוסתרים');
    await expect(legend).not.toContainText(/אדום|כחול|מתנקש/);
    await expect(legend.locator('.cn-role-icon')).toHaveCount(0);
  });

  test('reveals and restores a card consistently and only ranks live words', async ({ page }) => {
    await bootMobileOperative(page);
    await page.getByTestId('tab-board').click();

    // Tap selects (roles stay hidden in the selection), then the reveal action eliminates it.
    const firstTile = page.getByTestId('tile-0');
    await firstTile.click();
    await expect(firstTile).toHaveAccessibleName('אריה, נבחר');
    await page.getByTestId('board-action-eliminate').click();

    await expect(firstTile).toHaveAttribute('data-lifecycle', 'chosen');
    await expect(firstTile).toHaveAttribute('data-role', 'red');
    await expect(firstTile).toHaveAccessibleName('אריה, אדום, נחשף');

    await page.getByTestId('tab-map').click();
    await expect(page.getByTestId('map-dot-אריה')).toHaveCount(0);
    await expect(page.getByTestId('semantic-map').getByRole('button')).toHaveCount(24);
    await expect(page.locator('[data-testid^="map-dot-"][data-role="neutral"]')).toHaveCount(24);

    await page.getByTestId('tab-operative').click();
    await page.getByTestId('operative-clue-input').fill('חיות');
    await page.getByTestId('btn-operative').click();
    await expect(page.getByTestId('operative-result')).toBeVisible();
    await expect(page.getByTestId('operative-pick-0')).toContainText('ירח');

    const request = await page.evaluate(() => window.__lastOperativeReq);
    expect(request?.words).toHaveLength(24);
    expect(request?.words).not.toContain('אריה');
    expect(request?.roles).not.toHaveProperty('אריה');

    // Tapping an eliminated card restores it directly (no drawer), team-agnostic.
    await page.getByTestId('tab-board').click();
    await firstTile.click();
    await expect(firstTile).toHaveAttribute('data-lifecycle', 'inPlay');
    await expect(firstTile).toHaveAttribute('data-role', 'neutral');
    await expect(firstTile).toHaveAccessibleName('אריה');
    await expect(page.getByTestId('toast')).toContainText('הקלף הוחזר למשחק');
  });

  test('removes a stale recommendation on failure and lets the user retry', async ({ page }) => {
    await bootMobileOperative(page);
    const clueInput = page.getByTestId('operative-clue-input');
    const submit = page.getByTestId('btn-operative');

    await clueInput.fill('חיות');
    await submit.click();
    await expect(page.getByTestId('operative-result-clue')).toHaveText('חיות');

    await page.evaluate(() => {
      const realFetch = window.fetch.bind(window);
      let failNext = true;
      window.fetch = async (input, init) => {
        if (failNext && String(input).includes('/api/coach/operative')) {
          failNext = false;
          return new Response(JSON.stringify({ error: 'לא הצלחנו לנתח את הרמז' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return realFetch(input, init);
      };
    });

    await clueInput.fill('תקלה');
    await submit.click();
    await expect(page.getByTestId('operative-error')).toContainText('לא הצלחנו לנתח את הרמז');
    await expect(page.getByTestId('toast')).toContainText('לא הצלחנו לנתח את הרמז');
    await expect(page.getByTestId('operative-result')).toHaveCount(0);
    await expect(clueInput).toBeEnabled();
    await expect(submit).toBeEnabled();

    await submit.click();
    await expect(page.getByTestId('operative-error')).toHaveCount(0);
    await expect(page.getByTestId('operative-result-clue')).toHaveText('תקלה');
  });

  test('clears spymaster selections before exposing the operative board', async ({ page }) => {
    await openMobileShell(page, MOBILE_LANDSCAPE);
    await installBoard(page);

    // Spymaster builds a board working-set (two same-team cards).
    await page.getByTestId('tile-0').click();
    await page.getByTestId('tile-1').click();
    await expect(page.locator('[data-mobile-tile][aria-pressed="true"]')).toHaveCount(2);

    // Switching to operative must scrub that selection and expose a fully blind board.
    await page.getByTestId('mobile-mode-operative').click();
    await page.getByTestId('tab-board').click();
    await expect(page.locator('[data-mobile-tile][aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('[data-mobile-tile].is-selected')).toHaveCount(0);
    await expect(page.locator('[data-mobile-tile][data-role="neutral"]')).toHaveCount(25);
    expect(await page.evaluate(() => window.__store?.getState().mobileSelection)).toEqual([]);

    await page.getByTestId('tab-map').click();
    await expect(page.getByTestId('map-hint-node')).toHaveCount(0);
    await expect(page.locator('[data-testid^="map-dot-"][data-target="true"]')).toHaveCount(0);
  });

  test('does not surface a completed operative request after switching modes', async ({ page }) => {
    await bootMobileOperative(page);
    await page.evaluate(() => {
      const realFetch = window.fetch.bind(window);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.assign(window, { __releaseOperativeRequest: release });
      window.fetch = async (input, init) => {
        if (!String(input).includes('/api/coach/operative')) return realFetch(input, init);
        await gate;
        const response = await realFetch(input, init);
        Object.assign(window, { __operativeRequestCompleted: true });
        return response;
      };
    });

    await page.getByTestId('operative-clue-input').fill('חיות');
    await page.getByTestId('btn-operative').click();
    await expect(page.getByTestId('btn-operative').getByTestId('loading-spinner')).toBeVisible();

    await page.getByTestId('mobile-mode-spymaster').click();
    await expect(page.getByTestId('stub-operative')).toHaveCount(0);
    await expect(page.getByTestId('board-canvas')).toBeVisible();

    await page.evaluate(() => {
      const release = (window as Window & { __releaseOperativeRequest?: () => void })
        .__releaseOperativeRequest;
      if (!release) throw new Error('The operative request gate was not installed');
      release();
    });
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(
            (window as Window & { __operativeRequestCompleted?: boolean })
              .__operativeRequestCompleted,
          ),
        ),
      )
      .toBe(true);

    await page.getByTestId('mobile-mode-operative').click();
    await expect(page.getByTestId('operative-clue-input')).toHaveValue('');
    await expect(page.getByRole('region', { name: 'לפני קבלת הצעת ניחוש' })).toBeVisible();
    await expect(page.getByTestId('operative-result')).toHaveCount(0);
  });

  test('preserves operative mode and board privacy through edit and resume', async ({ page }) => {
    await bootMobileOperative(page);

    await expect(page.getByRole('link', { name: 'איך זה עובד' })).toHaveAttribute(
      'href',
      '/methods',
    );
    await page.getByTestId('mobile-edit-board').click();
    await expect(page.getByTestId('mobile-home')).toBeVisible();
    await expect(page.getByTestId('mobile-gamebar')).toHaveCount(0);
    await expect(page.getByTestId('btn-resume')).toBeVisible();

    await page.getByTestId('btn-resume').click();
    await expect(page.getByTestId('mobile-mode-operative')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('stub-operative')).toBeVisible();

    await page.getByTestId('tab-board').click();
    await expect(page.getByTestId(/^tile-\d+$/)).toHaveCount(25);
    await expect(page.locator('[data-mobile-tile][data-role="neutral"]')).toHaveCount(25);
  });
});
