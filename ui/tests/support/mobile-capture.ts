import { expect, type Page } from '@playwright/test';

import { fixtureRoles, fixtureWords } from '../../src/mocks/fixtures/board';

export const MOBILE = { width: 700, height: 390 } as const;
export const DESKTOP = { width: 1320, height: 900 } as const;

// A minimal valid 1x1 PNG — the stubbed recognizers ignore its content, but the
// capture flow still needs a real image File to build a preview URL from.
export const ONE_PX_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export interface StubCell {
  word: string;
  confidence: number;
}

export const roleSequence = fixtureWords.map((word) => fixtureRoles[word]);

/**
 * OCR + colour classification are non-deterministic system boundaries, so the
 * capture flow reads optional overrides from `window.__captureRecognizers`.
 * Tests inject deterministic recognizers here (mock at the boundary).
 */
export async function installRecognizers(
  page: Page,
  opts: { cells: StubCell[]; roles: string[]; gateBoard?: boolean },
): Promise<void> {
  await page.addInitScript((data) => {
    const scope = window as unknown as {
      __ocrGate?: Promise<void>;
      __releaseOcr?: () => void;
      __captureRecognizers?: unknown;
    };
    let release = (): void => {};
    scope.__ocrGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    scope.__releaseOcr = release;
    scope.__captureRecognizers = {
      recognizeBoard: async () => {
        if (data.gateBoard) await scope.__ocrGate;
        return data.cells;
      },
      classifyKeyCard: async () => data.roles,
    };
  }, opts);
}

export async function installFailingBoardRecognizer(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __captureRecognizers?: unknown }).__captureRecognizers = {
      recognizeBoard: async () => {
        throw new Error('הזיהוי נכשל');
      },
      classifyKeyCard: async () => Array.from({ length: 25 }, () => 'neutral'),
    };
  });
}

/** Navigate to the mobile capture entry and trigger its self-mount. */
export async function openCapture(
  page: Page,
  viewport: { width: number; height: number } = MOBILE,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto('/?mobile=1');
  await page.evaluate(() => import('/tests/harnesses/mobile-capture.tsx'));
}

export async function pickGallery(page: Page, buffer = ONE_PX_PNG): Promise<void> {
  await page
    .getByTestId('btn-gallery')
    .locator('input[type="file"]')
    .setInputFiles({
      name: 'capture.png',
      mimeType: 'image/png',
      buffer: Buffer.from(buffer, 'base64'),
    });
}

export async function releaseOcr(page: Page): Promise<void> {
  await page.evaluate(() => {
    const release = (window as unknown as { __releaseOcr?: () => void }).__releaseOcr;
    if (!release) throw new Error('OCR gate was not installed');
    release();
  });
}

/** Read the current board tiles from the shared dev store hook. */
export async function readTiles(
  page: Page,
): Promise<Array<{ word: string; role: string }>> {
  return page.evaluate(() => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    return window.__store
      .getState()
      .tiles.map((tile) => ({ word: tile.word, role: tile.role }));
  });
}

/** Board words with two OCR defects to correct: one amber, one empty. */
export function defectiveCells(): StubCell[] {
  return fixtureWords.map((word, index) => {
    if (index === 10) return { word: 'מכ', confidence: 40 };
    if (index === 24) return { word: '', confidence: 0 };
    return { word, confidence: 92 };
  });
}

export async function correctBoardWords(page: Page): Promise<void> {
  await page.getByTestId('review-cell-10').fill(fixtureWords[10]);
  await page.getByTestId('review-cell-24').fill(fixtureWords[24]);
}

export async function expectStepBadgeActive(page: Page, step: 1 | 2): Promise<void> {
  await expect(page.getByTestId(`capture-step-${step}`)).toHaveAttribute(
    'aria-current',
    'step',
  );
}
