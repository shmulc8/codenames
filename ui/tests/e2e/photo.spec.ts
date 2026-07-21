import { expect, test, type Browser, type Page } from '@playwright/test';

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

async function openPageWithDelayedOcrWorker(browser: Browser): Promise<{
  page: Page;
  releaseWorker: () => void;
}> {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    const testWindow = window as Window & { __ocrRecognizeResolutions: number };
    testWindow.__ocrRecognizeResolutions = 0;
    window.Worker = class extends NativeWorker {
      constructor(scriptURL: string | URL, options?: WorkerOptions) {
        super(scriptURL, options);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          const message = event.data as { action?: string; status?: string };
          if (message.action === 'recognize' && message.status === 'resolve') {
            testWindow.__ocrRecognizeResolutions += 1;
          }
        });
      }
    };
  });

  let releaseWorker = () => {};
  const workerGate = new Promise<void>((resolve) => {
    releaseWorker = resolve;
  });
  let trainedDataRequestStarted = false;
  await context.route('**/heb.traineddata.gz', async (route) => {
    trainedDataRequestStarted = true;
    await workerGate;
    await route.continue();
  });

  const page = await context.newPage();
  await page.goto('/');
  await expect.poll(() => trainedDataRequestStarted).toBe(true);
  return { page, releaseWorker };
}

async function openPageWithDelayedKeyImage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    const NativeImage = window.Image;
    const nativeGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    const pendingLoads: Array<() => void> = [];
    const testWindow = window as Window & {
      __keyImageLoads: number;
      __keyImageReleases: number;
      __keySamples: number;
      __releaseKeyImage: () => void;
    };
    testWindow.__keyImageLoads = 0;
    testWindow.__keyImageReleases = 0;
    testWindow.__keySamples = 0;
    testWindow.__releaseKeyImage = () => {
      pendingLoads.splice(0).forEach((release) => release());
    };

    window.Image = function DelayedImage(width?: number, height?: number) {
      const image = width === undefined
        ? new NativeImage()
        : height === undefined
          ? new NativeImage(width)
          : new NativeImage(width, height);
      image.addEventListener('load', (event) => {
        event.stopImmediatePropagation();
        testWindow.__keyImageLoads += 1;
        const onload = image.onload;
        if (onload) {
          pendingLoads.push(() => {
            testWindow.__keyImageReleases += 1;
            onload.call(image, new Event('load'));
          });
        }
      }, { capture: true, once: true });
      return image;
    } as typeof Image;

    CanvasRenderingContext2D.prototype.getImageData = function (...args) {
      const data = Reflect.apply(nativeGetImageData, this, args) as ImageData;
      testWindow.__keySamples += 1;
      return data;
    };
  });

  const page = await context.newPage();
  await page.goto('/');
  return page;
}

test.describe('PhotoSetup', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('starts in the RTL manual correction flow with all canonical controls', async ({ page }) => {
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('setup-screen')).toBeVisible();
    await expect(page.getByRole('button', { name: 'הזנה ידנית' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('אין מצלמה במחשב?')).toBeVisible();
    await expect(page.locator('.photo-setup__modes svg')).toHaveCount(3);

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
    await expect(page.locator('.photo-setup__word-mirror')).toHaveCount(0);

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

  test('loads random boards into the editor and allows rerolling before confirmation', async ({ page }) => {
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

    await expect(page.getByTestId('setup-screen')).toBeVisible();
    await expect(page.getByTestId('board-grid')).toHaveCount(0);
    await expect(page.getByTestId('ocr-cell-0')).toHaveValue(fixtureBoard.words[0]);
    await expect(page.getByTestId('key-cell-0')).toHaveAttribute('aria-label', /תפקיד אדום/);
    await expect(page.getByTestId('key-cell-24')).toHaveAttribute(
      'aria-label',
      /תפקיד מתנקש/,
    );
    await expect(page.getByTestId('btn-skip-demo')).toContainText('הגרילו שוב');
    await expect(page.locator('.photo-setup__word-mirror')).toHaveCount(25);

    await page.getByTestId('btn-skip-demo').click();
    await expect(page.getByTestId('setup-screen')).toBeVisible();
    await page.getByTestId('btn-confirm-board').click();
    await expect(page.getByTestId('board-grid')).toBeVisible();
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

    await expect(page.getByRole('button', { name: 'מתמונה' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.getByText(/מזהה את מילות הלוח|הזיהוי הושלם|הזיהוי לא זמין כרגע/),
    ).toBeVisible();
    await expect(page.getByTestId('ocr-grid')).toBeVisible();
  });

  test('manual skip preserves corrections when an in-flight OCR result arrives late', async ({ browser }) => {
    const { page, releaseWorker } = await openPageWithDelayedOcrWorker(browser);
    const onePixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );

    await page.getByTestId('photo-input-board').setInputFiles({
      name: 'board.png',
      mimeType: 'image/png',
      buffer: onePixelPng,
    });
    await expect(page.getByText(/מזהה את מילות הלוח/)).toBeVisible();

    await page.getByText('דלגו על צילום הלוח — הקלידו ידנית', { exact: true }).click();
    await page.getByTestId('ocr-cell-0').fill('בדיקה');
    releaseWorker();

    await expect.poll(() => page.evaluate(() => (
      window as Window & { __ocrRecognizeResolutions?: number }
    ).__ocrRecognizeResolutions ?? 0), { timeout: 20_000 }).toBe(1);
    await expect(page.getByTestId('ocr-cell-0')).toHaveValue('בדיקה');
    await expect(page.getByText('מנוע הזיהוי מוכן', { exact: true })).toBeVisible();
    await expect(page.getByTestId('toast')).toHaveCount(0);

    await page.context().close();
  });

  test('manual key assignment survives a late key-card classification', async ({ browser }) => {
    const page = await openPageWithDelayedKeyImage(browser);
    const redKeyCard = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#b04548"/></svg>',
    );

    await page.getByTestId('photo-input-key').setInputFiles({
      name: 'red-key-card.svg',
      mimeType: 'image/svg+xml',
      buffer: redKeyCard,
    });
    await expect.poll(() => page.evaluate(() => (
      window as Window & { __keyImageLoads?: number }
    ).__keyImageLoads ?? 0)).toBe(1);
    await expect(page.getByText('מזהה צבעים…', { exact: true })).toBeVisible();

    await page.getByText('דלגו על צילום המפתח — סמנו ידנית', { exact: true }).click();
    await page.getByTestId('key-cell-0').click();
    await expect(page.getByTestId('key-cell-0')).toHaveAttribute('aria-label', /תפקיד מתנקש/);

    await page.evaluate(() => {
      const release = (window as Window & { __releaseKeyImage?: () => void })
        .__releaseKeyImage;
      if (!release) throw new Error('Key image gate was not installed');
      release();
    });

    await expect.poll(() => page.evaluate(() => (
      window as Window & { __keySamples?: number }
    ).__keySamples ?? 0)).toBe(25);
    const roleLabels = await page.getByTestId(/^key-cell-\d+$/).evaluateAll((cells) =>
      cells.map((cell) => cell.getAttribute('aria-label')),
    );
    expect(roleLabels[0]).toContain('תפקיד מתנקש');
    expect(roleLabels.slice(1)).toHaveLength(24);
    expect(roleLabels.slice(1).every((label) => label?.includes('תפקיד ניטרלי'))).toBe(true);
    await expect(page.getByTestId('toast')).toHaveCount(0);
    await expect(page.getByText('הצבעים ייכנסו לרשת ויישארו ניתנים לתיקון', { exact: true })).toBeVisible();
    await expect(page.getByAltText('תצוגה מקדימה של כרטיס המפתח')).toBeVisible();

    const counters = await page.evaluate(() => {
      const current = window as Window & {
        __keyImageReleases?: number;
        __keySamples?: number;
      };
      return {
        released: current.__keyImageReleases ?? 0,
        samples: current.__keySamples ?? 0,
      };
    });
    expect(counters).toEqual({ released: 1, samples: 25 });

    await page.context().close();
  });
});
