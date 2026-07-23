import { expect, test } from '@playwright/test';

import { fixtureWords } from '../../src/mocks/fixtures/board';
import {
  DESKTOP,
  correctBoardWords,
  defectiveCells,
  expectStepBadgeActive,
  installFailingBoardRecognizer,
  installRecognizers,
  openCapture,
  pickGallery,
  readTiles,
  releaseOcr,
  roleSequence,
} from '../support/mobile-capture';

const VALID_ROLES = [...roleSequence];

async function advanceToKeyReview(page: import('@playwright/test').Page): Promise<void> {
  await installRecognizers(page, { cells: defectiveCells(), roles: VALID_ROLES });
  await openCapture(page);
  await pickGallery(page);
  await expect(page.getByTestId('review-grid')).toBeVisible();
  await correctBoardWords(page);
  await page.getByTestId('btn-use-photo').click();
  await expect(page.getByTestId('camera-view')).toBeVisible();
  await pickGallery(page);
  await expect(page.getByTestId('review-grid')).toBeVisible();
}

test.describe('mobile capture flow', () => {
  test('camera step mounts the viewfinder and capture controls (or gallery fallback)', async ({
    page,
  }) => {
    await installRecognizers(page, { cells: defectiveCells(), roles: VALID_ROLES });
    await openCapture(page);

    await expect(page.getByTestId('camera-view')).toBeVisible();
    await expect(page.getByTestId('viewfinder')).toBeVisible();
    await expect(page.getByTestId('btn-gallery')).toBeVisible();
    await expect(page.getByTestId('btn-shutter')).toBeVisible();
    await expect(page.getByTestId('btn-flip')).toBeVisible();
    await expect(page.getByText('יישרו את הלוח בתוך המסגרת')).toBeVisible();
    await expectStepBadgeActive(page, 1);
  });

  test('gallery upload → correct words → capture key card → confirm calls setBoard', async ({
    page,
  }) => {
    await installRecognizers(page, { cells: defectiveCells(), roles: VALID_ROLES });
    await openCapture(page);

    // Step 1: words review.
    await pickGallery(page);
    await expect(page.getByTestId('review-grid')).toBeVisible();
    await expect(page.getByTestId(/^review-cell-\d+$/)).toHaveCount(25);
    await expect(page.getByTestId('review-cell-0')).toHaveValue(fixtureWords[0]);

    // Low-confidence OCR word is flagged amber for correction.
    await expect(page.getByTestId('review-cell-10')).toHaveClass(/is-low-confidence/);

    // An empty recognized word blocks continuing until corrected.
    await expect(page.getByTestId('btn-use-photo')).toBeDisabled();
    await correctBoardWords(page);
    await expect(page.getByTestId('btn-use-photo')).toBeEnabled();

    // Advance to step 2 (key card capture).
    await page.getByTestId('btn-use-photo').click();
    await expect(page.getByTestId('camera-view')).toBeVisible();
    await expectStepBadgeActive(page, 2);

    // Step 2: role review from the classified key card.
    await pickGallery(page);
    await expect(page.getByTestId('review-grid')).toBeVisible();
    await expect(page.getByTestId('review-cell-0')).toHaveAttribute('data-role', 'red');
    await expect(page.getByTestId('btn-use-photo')).toBeEnabled();

    await page.getByTestId('btn-use-photo').click();

    const tiles = await readTiles(page);
    expect(tiles).toHaveLength(25);
    expect(tiles.map((tile) => tile.word)).toEqual([...fixtureWords]);
    expect(tiles.map((tile) => tile.role)).toEqual(VALID_ROLES);
  });

  test('role grid cycles on tap and blocks confirm until the key is 9·8·7·1', async ({ page }) => {
    await advanceToKeyReview(page);

    const capture = page.locator('.cn-capture');
    const cell = page.getByTestId('review-cell-0');
    await expect(cell).toHaveAttribute('data-role', 'red');
    await expect(page.getByTestId('btn-use-photo')).toBeEnabled();

    // red → blue → neutral leaves the distribution invalid.
    await cell.click();
    await expect(cell).toHaveAttribute('data-role', 'blue');
    await cell.click();
    await expect(cell).toHaveAttribute('data-role', 'neutral');
    await expect(page.getByTestId('btn-use-photo')).toBeDisabled();
    await expect(capture.getByText('חלוקת המפתח עדיין לא 9·8·7·1')).toBeVisible();

    // neutral → assassin → red restores a valid key.
    await cell.click();
    await expect(cell).toHaveAttribute('data-role', 'assassin');
    await cell.click();
    await expect(cell).toHaveAttribute('data-role', 'red');
    await expect(page.getByTestId('btn-use-photo')).toBeEnabled();

    // Rotating a valid key preserves the counts, so it stays confirmable.
    await capture.getByRole('button', { name: 'סובב את המפתח' }).click();
    await expect(page.getByTestId('btn-use-photo')).toBeEnabled();
  });

  test('retake returns from review to the live camera', async ({ page }) => {
    await installRecognizers(page, { cells: defectiveCells(), roles: VALID_ROLES });
    await openCapture(page);
    await pickGallery(page);
    await expect(page.getByTestId('review-grid')).toBeVisible();

    await page.getByTestId('btn-retake').click();
    await expect(page.getByTestId('camera-view')).toBeVisible();
    await expect(page.getByTestId('review-grid')).toHaveCount(0);
    await expectStepBadgeActive(page, 1);
  });

  test('shows a loading spinner while OCR runs and reveals the grid when it resolves', async ({
    page,
  }) => {
    await installRecognizers(page, {
      cells: defectiveCells(),
      roles: VALID_ROLES,
      gateBoard: true,
    });
    await openCapture(page);
    await pickGallery(page);

    await expect(page.locator('.cn-capture').getByTestId('loading-spinner')).toBeVisible();
    await expect(page.getByTestId('review-grid')).toHaveCount(0);

    await releaseOcr(page);
    await expect(page.getByTestId('review-grid')).toBeVisible();
  });

  test('an OCR failure surfaces a Hebrew toast and keeps the camera usable', async ({ page }) => {
    await installFailingBoardRecognizer(page);
    await openCapture(page);
    await pickGallery(page);

    await expect(page.getByTestId('toast')).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('הזיהוי נכשל');
    await expect(page.getByTestId('camera-view')).toBeVisible();
  });

  test('desktop regression: capture UI is absent and desktop board-input is unchanged', async ({
    page,
  }) => {
    await openCapture(page, DESKTOP);

    await expect(page.getByTestId('camera-view')).toHaveCount(0);
    await expect(page.getByTestId('review-grid')).toHaveCount(0);
    await expect(page.getByTestId('btn-shutter')).toHaveCount(0);

    // desktop-4a board-input renders exactly as before.
    await expect(page.getByTestId('setup-screen')).toBeVisible();
    await expect(page.getByTestId('photo-input-board')).toHaveAttribute('type', 'file');
    await expect(page.getByTestId('ocr-grid')).toBeVisible();
    await expect(page.getByTestId(/^ocr-cell-\d+$/)).toHaveCount(25);
  });
});
