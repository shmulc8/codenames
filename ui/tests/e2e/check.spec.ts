import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

async function openCheckPanel(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);
  await page.getByTestId('tab-check').click();
  await expect(page.getByTestId('check-input')).toBeVisible();
}

async function submitCheck(page: Page, clue: string): Promise<void> {
  await page.getByTestId('check-input').fill(clue);
  await page.getByTestId('btn-check').click();
  await expect(page.getByTestId('check-result')).toBeVisible();
}

test.describe('check my word', () => {
  test('a legal clue renders the complete ranked read and exact safety verdict', async ({
    page,
  }) => {
    await openCheckPanel(page);
    await submitCheck(page, 'טבעות');

    await expect(page.getByTestId('check-illegal')).toHaveCount(0);
    await expect(page.getByText('בטוח ל-9 מילים')).toBeVisible();
    await expect(page.getByText(/הסכנה הראשונה:/)).toContainText('נחש');
    await expect(page.getByText(/המתנקש: נחש/)).toContainText('מקום 10');
    await expect(page.getByText('אילו מילים זה עלול למשוך?')).toBeVisible();
    await expect(page.getByText('ציון קרבה (0–100)')).toBeVisible();
    await expect(
      page.getByText(
        'המספרים מסמנים אילו מילים אחרות עלולות להתבלבל עם הרמז שלך',
      ),
    ).toBeVisible();

    const rankedList = page.getByTestId('check-ranked-list');
    await expect(rankedList.getByTestId(/^ranked-row-/)).toHaveCount(25);
    await expect(page.getByTestId('ranked-row-אריה')).toContainText('1');
    await expect(page.getByTestId('sim-score-אריה')).toHaveText('95');
    await expect(page.getByTestId('ranked-row-נחש')).toContainText('10');
    await expect(page.getByTestId('sim-score-נחש')).toHaveText('84');

    const request = await page.evaluate(() => window.__lastCheckReq);
    expect(request?.clue).toBe('טבעות');
    expect(request?.words).toEqual(fixtureBoard.words);
    expect(request?.roles['אריה']).toBe('my');
    expect(request?.roles['ים']).toBe('opp');

    await expect
      .poll(() =>
        page.evaluate(() => window.__store?.getState().checkedClue ?? null),
      )
      .toBe('טבעות');
  });

  test('a board word remains informative but is clearly marked illegal', async ({
    page,
  }) => {
    await openCheckPanel(page);
    await submitCheck(page, 'אריה');

    const banner = page.getByTestId('check-illegal');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      'המילה הזו לא חוקית — היא מילה מהלוח או חולקת שורש עם אחת מהן',
    );
    await expect(page.getByTestId('check-ranked-list')).toBeVisible();
    await expect(page.getByTestId('ranked-row-אריה')).toBeVisible();
    await expect(page.getByText('בטוח ל-9 מילים')).toBeVisible();
  });

  test('target switching changes the request perspective and safety summary', async ({
    page,
  }) => {
    await openCheckPanel(page);

    await expect(page.getByTestId('target-red')).toBeChecked();
    await page.getByText('הקבוצה הכחולה').click();
    await expect(page.getByTestId('target-blue')).toBeChecked();
    await submitCheck(page, 'מסע');

    await expect(page.getByText('בטוח ל-8 מילים')).toBeVisible();
    const request = await page.evaluate(() => window.__lastCheckReq);
    expect(request?.roles['אריה']).toBe('opp');
    expect(request?.roles['ים']).toBe('my');
  });

  test('empty input shows validation without issuing a request', async ({ page }) => {
    await openCheckPanel(page);
    await page.getByTestId('check-input').fill('   ');
    await page.getByTestId('btn-check').click();

    await expect(page.getByText('כתבו מילה שתרצו לבדוק')).toBeVisible();
    await expect(page.getByTestId('check-input')).toHaveAttribute('aria-invalid', 'true');
    expect(await page.evaluate(() => window.__lastCheckReq)).toBeUndefined();
  });

  test('submission exposes loading and disables mutable controls', async ({ page }) => {
    await openCheckPanel(page);
    await page.getByTestId('check-input').fill('טבעות');
    await page.getByTestId('btn-check').click();

    await expect(
      page.getByTestId('btn-check').getByTestId('loading-spinner'),
    ).toBeVisible();
    await expect(page.getByTestId('btn-check')).toBeDisabled();
    await expect(page.getByTestId('check-input')).toBeDisabled();
    await expect(page.getByTestId('target-red')).toBeDisabled();
    await expect(page.getByTestId('check-result')).toBeVisible();
    await expect(
      page.getByTestId('btn-check').getByTestId('loading-spinner'),
    ).toHaveCount(0);
  });

  test('hovering a ranked row synchronizes hoverWord and clears it on exit', async ({
    page,
  }) => {
    await openCheckPanel(page);
    await submitCheck(page, 'טבעות');

    const row = page.getByTestId('ranked-row-נחש');
    await row.hover();
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().hoverWord ?? null))
      .toBe('נחש');

    await page.getByTestId('check-input').hover();
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().hoverWord ?? null))
      .toBeNull();
  });

  test('a backend failure produces a Hebrew error toast and no result', async ({
    page,
  }) => {
    await openCheckPanel(page);
    await page.evaluate(() => {
      const fetchWithMocks = window.fetch;
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.endsWith('/api/coach/check')) {
          return new Response(JSON.stringify({ error: 'בדיקת הרמז נכשלה' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return fetchWithMocks(input, init);
      };
    });
    await page.getByTestId('check-input').fill('טבעות');
    await page.getByTestId('btn-check').click();

    await expect(page.getByTestId('toast')).toContainText('בדיקת הרמז נכשלה');
    await expect(page.getByTestId('check-result')).toHaveCount(0);
    await expect(
      page.getByTestId('btn-check').getByTestId('loading-spinner'),
    ).toHaveCount(0);
    await expect(page.getByTestId('btn-check')).toBeEnabled();
  });

  test('a failed replacement check clears the prior result and semantic hint', async ({
    page,
  }) => {
    await openCheckPanel(page);
    await submitCheck(page, 'טבע');

    await expect(page.getByTestId('semantic-map')).toHaveAttribute(
      'aria-label',
      'מפה סמנטית עבור הרמז טבע',
    );

    await page.evaluate(() => {
      const fetchWithMocks = window.fetch;
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url.endsWith('/api/coach/check')) {
          return new Response(JSON.stringify({ error: 'בדיקה זמנית נכשלה' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return fetchWithMocks(input, init);
      };
    });

    await page.getByTestId('check-input').fill('חדש');
    await page.getByTestId('btn-check').click();

    await expect(page.getByTestId('toast')).toContainText('בדיקה זמנית נכשלה');
    await expect(page.getByTestId('check-result')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() => window.__store?.getState().checkedClue ?? null),
      )
      .toBeNull();
    await expect(page.getByTestId('semantic-map')).not.toHaveAttribute(
      'aria-label',
      'מפה סמנטית עבור הרמז טבע',
    );
    await expect(page.getByTestId('map-hint-node')).toHaveCount(0);
  });
});
