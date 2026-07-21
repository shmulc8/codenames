import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

async function fillWords(page: Page, words = fixtureBoard.words): Promise<void> {
  for (let index = 0; index < 25; index += 1) {
    await page.getByTestId(`ocr-cell-${index}`).fill(words[index]);
  }
}

async function cycleKeyCell(page: Page, index: number, times: number): Promise<void> {
  for (let click = 0; click < times; click += 1) {
    await page.getByTestId(`key-cell-${index}`).click();
  }
}

test.describe('PhotoSetup', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('starts in the RTL manual correction flow with all canonical controls', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('setup-screen')).toBeVisible();
    await expect(page.getByText('הזנה ידנית', { exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('אין מצלמה במחשב?')).toBeVisible();

    await expect(page.getByTestId('ocr-grid')).toBeVisible();
    await expect(page.getByTestId(/^ocr-cell-\d+$/)).toHaveCount(25);
    await expect(page.getByTestId('key-grid')).toHaveCount(0);
    await expect(page.getByTestId(/^key-cell-\d+$/)).toHaveCount(25);

    await expect(page.getByTestId('photo-input-board')).toHaveAttribute('type', 'file');
    await expect(page.getByTestId('photo-input-board')).toHaveAttribute('accept', 'image/*');
    await expect(page.getByTestId('photo-input-board')).toHaveAttribute(
      'capture',
      'environment',
    );
    await expect(page.getByTestId('photo-input-key')).toHaveAttribute('type', 'file');
    await expect(page.getByTestId('photo-input-key')).toHaveAttribute('accept', 'image/*');
    await expect(page.getByTestId('btn-confirm-board')).toBeEnabled();

    await expect(
      page.getByText(/טוען מנוע זיהוי|מנוע הזיהוי מוכן|הזיהוי לא זמין כרגע/),
    ).toBeVisible();
  });

  test('Tab and Enter move directly between word inputs while arrow keys change roles', async ({ page }) => {
    const first = page.getByTestId('ocr-cell-0');
    const second = page.getByTestId('ocr-cell-1');
    const third = page.getByTestId('ocr-cell-2');

    await first.focus();
    await first.fill('נמל');
    await page.keyboard.press('Tab');
    await expect(second).toBeFocused();

    await second.fill('פורים');
    await page.keyboard.press('Enter');
    await expect(third).toBeFocused();

    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('key-cell-2')).toHaveAttribute(
      'aria-label',
      /תפקיד מתנקש/,
    );
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('key-cell-2')).toHaveAttribute(
      'aria-label',
      /תפקיד ניטרלי/,
    );
  });

  test('validates all 25 words, uniqueness, and focuses the offending cell', async ({ page }) => {
    await page.getByTestId('btn-confirm-board').click();
    await expect(page.getByText('צריך למלא את כל 25 המילים לפני שממשיכים')).toBeVisible();
    await expect(page.getByTestId('ocr-cell-0')).toBeFocused();

    await fillWords(page);
    await page.getByTestId('ocr-cell-24').fill(fixtureBoard.words[0]);
    await page.getByTestId('btn-confirm-board').click();
    await expect(page.getByText('כל מילה צריכה להופיע פעם אחת בלבד')).toBeVisible();
    await expect(page.getByTestId('ocr-cell-24')).toBeFocused();

    await page.getByTestId('ocr-cell-24').fill(fixtureBoard.words[24]);
    await page.getByTestId('btn-confirm-board').click();
    await expect(page.getByTestId('board-grid')).toBeVisible();

    const result = await page.evaluate(() => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      const state = window.__store.getState();
      return { screen: state.screen, words: state.tiles.map((tile) => tile.word) };
    });
    expect(result).toEqual({ screen: 'game', words: fixtureBoard.words });
  });

  test('supports manual key assignment and accepts the valid 9·8·7·1 distribution', async ({ page }) => {
    await fillWords(page);

    // All cells begin neutral. neutral -> assassin -> red.
    for (let index = 0; index < 9; index += 1) {
      await cycleKeyCell(page, index, 2);
    }
    // neutral -> assassin -> red -> blue.
    for (let index = 9; index < 17; index += 1) {
      await cycleKeyCell(page, index, 3);
    }
    await cycleKeyCell(page, 24, 1);

    await expect(page.getByText('9·8·7·1 מפתח תקין')).toBeVisible();
    await page.getByTestId('btn-confirm-board').click();
    await expect(page.getByTestId('board-grid')).toBeVisible();

    const roles = await page.evaluate(() => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      return window.__store.getState().tiles.map((tile) => tile.role);
    });
    expect(roles).toEqual([
      ...Array.from({ length: 9 }, () => 'red'),
      ...Array.from({ length: 8 }, () => 'blue'),
      ...Array.from({ length: 7 }, () => 'neutral'),
      'assassin',
    ]);
  });

  test('rotates the key clockwise and permits an intentionally incomplete key', async ({ page }) => {
    await fillWords(page);
    await cycleKeyCell(page, 0, 1);
    await page.getByText('סובב ↻', { exact: true }).click();

    await expect(page.getByText('חלוקת המפתח עדיין לא 9·8·7·1')).toBeVisible();
    await page.getByTestId('btn-confirm-board').click();

    const result = await page.evaluate(() => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      const tiles = window.__store.getState().tiles;
      return { first: tiles[0]?.role, fifth: tiles[4]?.role };
    });
    expect(result).toEqual({ first: 'neutral', fifth: 'assassin' });
  });

  test('shows deterministic loading and success states for the demo board', async ({ page }) => {
    await page.evaluate(() => {
      const realFetch = window.fetch.bind(window);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.assign(window, { __releaseDealForTest: release });
      window.fetch = async (input, init) => {
        if (String(input).includes('/api/deal')) await gate;
        return realFetch(input, init);
      };
    });

    await page.getByTestId('btn-skip-demo').click();
    await expect(page.getByTestId('btn-skip-demo')).toBeDisabled();
    await expect(page.getByText('טוען לוח…', { exact: true })).toBeVisible();
    await page.evaluate(() => {
      const release = (window as Window & { __releaseDealForTest?: () => void })
        .__releaseDealForTest;
      if (!release) throw new Error('Deal gate was not installed');
      release();
    });

    await expect(page.getByTestId('board-grid')).toBeVisible();
    await expect(page.getByTestId(/^tile-\d+$/)).toHaveCount(25);
    await expect(page.getByTestId('tile-0')).toHaveAttribute('data-word', fixtureBoard.words[0]);
    await expect(page.getByTestId('tile-0')).toHaveAttribute('data-role', 'red');
    await expect(page.getByTestId('tile-24')).toHaveAttribute('data-role', 'assassin');
  });

  test('surfaces a backend error and restores the demo control', async ({ page }) => {
    await page.evaluate(() => {
      window.fetch = async (input) => {
        if (String(input).includes('/api/deal')) {
          return new Response(JSON.stringify({ error: 'לא הצלחנו לטעון לוח אקראי' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        throw new Error(`Unexpected fetch in deal error test: ${String(input)}`);
      };
    });

    await page.getByTestId('btn-skip-demo').click();
    await expect(page.getByTestId('toast')).toContainText('לא הצלחנו לטעון לוח אקראי');
    await expect(page.getByTestId('btn-skip-demo')).toBeEnabled();
    await expect(page.getByTestId('setup-screen')).toBeVisible();
  });

  test('starts OCR from a board image without making recognition deterministic', async ({ page }) => {
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    await page.getByTestId('photo-input-board').setInputFiles({
      name: 'board.png',
      mimeType: 'image/png',
      buffer: onePixelPng,
    });

    await expect(page.getByText('מתמונה', { exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.getByText(/מזהה את מילות הלוח|הזיהוי הושלם|הזיהוי לא זמין כרגע/),
    ).toBeVisible();
    await expect(page.getByTestId('ocr-grid')).toBeVisible();
  });
});
