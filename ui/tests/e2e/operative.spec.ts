import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

async function installBoard(page: Page): Promise<void> {
  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);
}

test.describe('desktop operative mode', () => {
  test('desktop keeps hidden roles private while serving a guess ranking', async ({ page }) => {
    await page.setViewportSize({ width: 1320, height: 900 });
    await page.goto('/');
    await installBoard(page);

    await page.getByTestId('mode-operative').click();
    await expect(page.getByTestId('mode-operative')).toHaveAttribute('aria-pressed', 'true');

    const firstTile = page.getByTestId('tile-0');
    await expect(firstTile).toHaveAttribute('data-role', 'neutral');
    await expect(firstTile).toHaveAccessibleName(fixtureBoard.words[0]);
    await expect(page.locator('.board__remaining')).toHaveCount(0);
    await expect(page.locator('.board__legend')).toHaveCount(0);

    const firstDot = page.getByTestId(`map-dot-${fixtureBoard.words[0]}`);
    await expect(firstDot).toHaveAttribute('data-role', 'neutral');
    await expect(page.getByTestId('map-legend')).toContainText('צבעי הקלפים נשארים מוסתרים');
    await expect(page.getByTestId('map-legend')).not.toContainText('מתנקש');

    await page.getByTestId('operative-clue-input').fill('חיות');
    await page.getByTestId('operative-count-increment').click();
    await page.getByTestId('btn-operative').click();

    await expect(page.getByTestId('operative-result')).toBeVisible();
    await expect(page.getByTestId('operative-result-clue')).toHaveText('חיות');
    await expect(page.getByTestId('operative-picks-list').locator('li')).toHaveCount(2);
    expect((await page.evaluate(() => window.__lastOperativeReq))?.count).toBe(2);
  });
});
