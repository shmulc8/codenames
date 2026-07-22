import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

async function installBoard(page: Page): Promise<void> {
  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);
}

test.describe('operative mode parity', () => {
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

  test('mobile exposes the same mode, board privacy, help, and board replacement path', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 700, height: 390 });
    await page.goto('/');
    await installBoard(page);

    await expect(page.getByTestId('mobile-gamebar')).toBeVisible();
    await expect(page.getByTestId('mobile-edit-board')).toBeVisible();
    await expect(page.getByRole('link', { name: 'איך זה עובד' })).toHaveAttribute(
      'href',
      '/methods',
    );

    await page.getByTestId('mobile-mode-operative').click();
    await expect(page.getByTestId('mobile-mode-operative')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('tab-operative')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('tabbar').getByRole('tab')).toHaveCount(3);

    await page.getByTestId('operative-clue-input').fill('חיות');
    await page.getByTestId('btn-operative').click();
    await expect(page.getByTestId('operative-result')).toBeVisible();

    await page.getByTestId('tab-board').click();
    const firstTile = page.getByTestId('tile-0');
    await expect(firstTile).toHaveAttribute('data-role', 'neutral');
    await expect(firstTile).toHaveAccessibleName(fixtureBoard.words[0]);
    await expect(firstTile.locator('.mobile-board-tile__role')).toHaveCount(0);
    await expect(
      page.getByTestId('minimap').locator('.role-red, .role-blue, .role-assassin'),
    ).toHaveCount(0);

    await firstTile.click();
    const revealSheet = page.getByTestId('sheet-mark-revealed');
    await expect(revealSheet).toContainText('הצבע ייחשף לאחר הסימון');
    await expect(revealSheet.locator('fieldset')).toHaveCount(0);
    await expect(revealSheet.getByTestId('btn-mark-chosen')).toHaveText('חשפו את הקלף');
    await revealSheet.getByRole('button', { name: 'ביטול' }).click();

    await page.getByTestId('tab-map').click();
    await expect(page.getByTestId(`map-dot-${fixtureBoard.words[0]}`)).toHaveAttribute(
      'data-role',
      'neutral',
    );
    await expect(page.getByTestId('map-legend')).toContainText('צבעי הקלפים נשארים מוסתרים');
    await expect(page.getByTestId('map-legend')).not.toContainText('מתנקש');

    await page.getByTestId('mobile-edit-board').click();
    await expect(page.getByTestId('mobile-home')).toBeVisible();
    await expect(page.getByTestId('btn-resume')).toBeVisible();
  });
});
