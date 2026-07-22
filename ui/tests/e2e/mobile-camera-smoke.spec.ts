import { expect, test } from '@playwright/test';

import { fixtureWords } from '../../src/mocks/fixtures/board';
import { installRecognizers } from '../support/mobile-capture';

test('captures a fake-camera frame and sends it to board review', async ({ page }) => {
  await installRecognizers(page, {
    cells: fixtureWords.map((word) => ({ word, confidence: 92 })),
    roles: [],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('btn-shoot').click();

  await expect(page.getByTestId('camera-view')).toBeVisible();
  await expect(page.getByTestId('viewfinder')).toBeVisible();
  await expect(page.getByTestId('btn-shutter')).toBeVisible();
  await expect
    .poll(() =>
      page.locator('video').evaluate((video: HTMLVideoElement) =>
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
        && video.videoWidth > 0
        && video.videoHeight > 0,
      ),
    )
    .toBe(true);

  await page.getByTestId('btn-shutter').click();

  await expect(page.getByTestId('review-grid')).toBeVisible();
  await expect(page.getByTestId(/^review-cell-\d+$/)).toHaveCount(25);
});
