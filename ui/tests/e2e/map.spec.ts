import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';
import type { ReadEntry, SpymasterResponse } from '../../src/types/api';

const clueWord = 'טבע';
const intended = [fixtureBoard.words[0], fixtureBoard.words[1]];
const clueRead: ReadEntry[] = fixtureBoard.words.map((word, index) => ({
  word,
  role: fixtureBoard.roles[word],
  sim: 0.82 - index * 0.01,
  conf: 0.91 - index * 0.01,
}));
const clueResult: SpymasterResponse = {
  options: [
    {
      word: clueWord,
      count: intended.length,
      intended,
      score: 0.9,
      reason: 'רמז בדיקה למפה',
      read: clueRead,
      leak: [],
      safe: intended.length,
      assassin: { word: 'נחש', rank: 9, sim: 0.58 },
      no_clue: false,
      risky: false,
      note: '',
    },
  ],
};

async function setBoard(page: Page, withClue = false): Promise<void> {
  await page.setViewportSize({ width: 1320, height: 900 });
  await page.goto('/');
  await page.evaluate(
    ({ board, result }) => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().setBoard(board.words, board.roles);
      if (result) window.__store.getState().setClueResult(result);
    },
    { board: fixtureBoard, result: withClue ? clueResult : null },
  );
}

async function waitForMap(page: Page): Promise<void> {
  await expect(page.getByTestId('semantic-map')).toBeVisible();
  await expect(page.getByTestId(`map-dot-${fixtureBoard.words[0]}`)).toBeVisible();
}

test.describe('semantic map', () => {
  test('renders every live word with its absolute role and the complete legend', async ({
    page,
  }) => {
    await setBoard(page, true);
    await waitForMap(page);

    await expect(page.getByTestId('semantic-map').getByRole('button')).toHaveCount(25);
    await expect(page.getByTestId('map-dot-אריה')).toHaveAccessibleName(
      'אריה, אדום, קרבה 91',
    );
    await expect(page.getByTestId('map-dot-ים')).toHaveAccessibleName(
      'ים, כחול, קרבה 82',
    );
    await expect(page.getByTestId('map-dot-כדור')).toHaveAccessibleName(
      'כדור, ניטרלי, קרבה 74',
    );
    await expect(page.getByTestId('map-dot-נחש')).toHaveAccessibleName(
      'נחש, מתנקש, קרבה 67',
    );

    const legend = page.getByTestId('map-legend');
    await expect(legend).toContainText('קרוב למרכז = קרוב לרמז');
    for (const role of ['אדום', 'כחול', 'ניטרלי', 'מתנקש']) {
      await expect(legend).toContainText(role);
    }
  });

  test('renders a hint node and one connection for each intended target', async ({
    page,
  }) => {
    await setBoard(page, true);
    await waitForMap(page);

    await expect(page.getByTestId('map-hint-node')).toContainText(clueWord);
    await expect(page.getByText(`הרמז: ${clueWord}`)).toBeVisible();
    await expect(page.getByTestId('semantic-map').locator('line')).toHaveCount(2);

    const request = await page.evaluate(() => window.__lastSpaceReq);
    expect(request?.clue).toBe(clueWord);
    expect(request?.words).toEqual(fixtureBoard.words);
  });

  test('without a clue it renders dots only and explains the hint-less state', async ({
    page,
  }) => {
    await setBoard(page);
    await waitForMap(page);

    await expect(page.getByTestId('map-hint-node')).toHaveCount(0);
    await expect(page.getByTestId('semantic-map').locator('line')).toHaveCount(0);
    await expect(page.getByText('ללא רמז פעיל')).toBeVisible();
    await expect(
      page.getByText('בחרו רמז או בדקו מילה כדי לראות את מרכז המשיכה'),
    ).toBeVisible();
    expect((await page.evaluate(() => window.__lastSpaceReq))?.clue).toBeUndefined();
  });

  test('hover shows a scored readout, updates hoverWord, and clears on exit', async ({
    page,
  }) => {
    await setBoard(page, true);
    await waitForMap(page);

    const dot = page.getByTestId('map-dot-אריה');
    await dot.hover();
    await expect(page.getByText('קרבה משוערת · 91')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().hoverWord ?? null))
      .toBe('אריה');

    await page.getByTestId('map-legend').hover();
    await expect(page.getByText('קרבה משוערת · 91')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().hoverWord ?? null))
      .toBeNull();
  });

  test('supports keyboard pinning and clearing on a map dot', async ({ page }) => {
    await setBoard(page, true);
    await waitForMap(page);

    const dot = page.getByTestId('map-dot-אריה');
    await dot.focus();
    await dot.press('Enter');
    await expect(dot).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('קרבה משוערת · 91')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().hoverWord ?? null))
      .toBe('אריה');

    await dot.press('Escape');
    await expect(dot).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().hoverWord ?? null))
      .toBeNull();
  });

  test('always marks the assassin with the canonical danger ring', async ({ page }) => {
    await setBoard(page, true);
    await waitForMap(page);

    await expect(page.getByTestId('map-danger-נחש')).toBeVisible();
    await expect(page.getByTestId('map-dot-נחש')).toHaveAccessibleName(
      /מתנקש/,
    );
  });

  test('removes a chosen word and refreshes the live-board request', async ({
    page,
  }) => {
    await setBoard(page, true);
    await waitForMap(page);
    await expect(page.getByTestId('map-dot-אריה')).toBeVisible();

    await page.evaluate(() => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().toggleLifecycle('אריה');
    });

    await expect(page.getByTestId('map-dot-אריה')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => window.__lastSpaceReq?.words.length ?? 0))
      .toBe(24);
    expect((await page.evaluate(() => window.__lastSpaceReq))?.words).not.toContain(
      'אריה',
    );
  });

  test('check-mode success supplies the checked clue and remembered score to the map', async ({
    page,
  }) => {
    await setBoard(page);
    await page.getByTestId('tab-check').click();
    await page.getByTestId('check-input').fill('טבעות');
    await page.getByTestId('btn-check').click();
    await expect(page.getByTestId('check-result')).toBeVisible();

    await expect(page.getByTestId('map-hint-node')).toContainText('טבעות');
    await expect(page.getByTestId('map-dot-אריה')).toHaveAccessibleName(
      'אריה, אדום, קרבה 95',
    );
    await expect(page.getByTestId('semantic-map').locator('line')).toHaveCount(0);
    expect((await page.evaluate(() => window.__lastSpaceReq))?.clue).toBe('טבעות');
  });

  test('shows loading while debouncing and surfaces backend errors as a toast', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1320, height: 900 });
    await page.goto('/');
    await page.evaluate((board) => {
      const fetchWithMocks = window.fetch;
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.endsWith('/api/space')) {
          return new Response(JSON.stringify({ error: 'טעינת המפה נכשלה' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return fetchWithMocks(input, init);
      };
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().setBoard(
        board.words,
        board.roles,
      );
    }, fixtureBoard);

    await expect(page.getByText('ממקמים את מילות הלוח…')).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('טעינת המפה נכשלה');
    await expect(page.getByText('ממקמים את מילות הלוח…')).toHaveCount(0);
    await expect(page.getByTestId('map-dot-אריה')).toHaveCount(0);
  });
});
