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

async function installCheckResponseGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    let releaseResponse!: () => void;
    let markResponseReady!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const responseReady = new Promise<void>((resolve) => {
      markResponseReady = resolve;
    });

    const testWindow = window as Window & {
      __checkResponseGate?: {
        release: () => void;
        ready: Promise<void>;
      };
    };
    testWindow.__checkResponseGate = {
      release: releaseResponse,
      ready: responseReady,
    };

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const requestUrl =
        typeof args[0] === 'string'
          ? args[0]
          : args[0] instanceof URL
            ? args[0].toString()
            : args[0].url;

      if (requestUrl.includes('/api/coach/check')) {
        markResponseReady();
        await responseGate;
      }

      return response;
    };
  });
}

async function waitForCheckResponse(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const testWindow = window as Window & {
      __checkResponseGate?: { ready: Promise<void> };
    };
    await testWindow.__checkResponseGate?.ready;
  });
}

async function releaseCheckResponse(page: Page): Promise<void> {
  await page.evaluate(() => {
    const testWindow = window as Window & {
      __checkResponseGate?: { release: () => void };
    };
    testWindow.__checkResponseGate?.release();
  });
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

  test('a check response is discarded when the live board changes in flight', async ({
    page,
  }) => {
    await openCheckPanel(page);
    await installCheckResponseGate(page);

    await page.getByTestId('check-input').fill('טבע');
    await page.getByTestId('btn-check').click();
    try {
      await waitForCheckResponse(page);

      const heldRequest = await page.evaluate(() => window.__lastCheckReq);
      expect(heldRequest?.words).toContain(fixtureBoard.words[0]);

      await page.getByTestId('btn-lifecycle-0').click();
      await expect
        .poll(() =>
          page.evaluate(() => window.__store?.getState().tiles[0]?.lifecycle),
        )
        .toBe('chosen');
    } finally {
      await releaseCheckResponse(page);
    }

    await expect(page.getByTestId('toast')).toContainText(
      'הלוח השתנה בזמן הבדיקה — בדקו שוב',
    );
    await expect(page.getByTestId('check-result')).toHaveCount(0);
    await expect(page.getByTestId('ranked-row-אריה')).toHaveCount(0);
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
