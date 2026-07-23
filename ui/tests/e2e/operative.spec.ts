import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

const DESKTOP = { width: 1320, height: 900 } as const;

async function installBoard(page: Page): Promise<void> {
  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);
}

async function openDesktopBoard(page: Page): Promise<void> {
  await page.setViewportSize(DESKTOP);
  await page.goto('/');
  await installBoard(page);
}

async function enterOperative(page: Page): Promise<void> {
  await page.getByTestId('mode-operative').click();
  await expect(page.getByTestId('mode-operative')).toHaveAttribute('aria-pressed', 'true');
}

test.describe('desktop operative mode', () => {
  test('keeps hidden roles private while serving a guess ranking', async ({ page }) => {
    await openDesktopBoard(page);
    await enterOperative(page);

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

  test('drops clue-focus selection and refuses to re-select in operative mode', async ({
    page,
  }) => {
    await openDesktopBoard(page);

    // As spymaster, a team card can be picked into a clue focus (aria-pressed).
    await page.getByTestId('tile-0').click();
    await expect(page.getByTestId('tile-0')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-testid^="tile-"][aria-pressed="true"]')).toHaveCount(1);

    // Entering operative clears the focus so the guesser starts from a clean, blind board.
    await enterOperative(page);
    await expect(page.locator('[data-testid^="tile-"][aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('.board-tile.is-selected')).toHaveCount(0);

    // The guesser must not be able to trigger clue-focus selection (its team-only toast would
    // otherwise leak whether the tapped card is a team card).
    await page.getByTestId('tile-0').click();
    await expect(page.getByTestId('tile-0')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByTestId('toast')).toHaveCount(0);
  });

  test('hides the intended-target highlight in operative and restores it on return', async ({
    page,
  }) => {
    await openDesktopBoard(page);

    // Generate a real clue so the board carries intended-target highlights.
    await page.getByTestId('btn-get-clue').click();
    await expect(page.getByTestId('clue-result')).toBeVisible();
    await expect(page.locator('.board-tile.is-clue-target')).toHaveCount(2);

    // Operative mode suppresses the highlight even though the clue result is still in the store.
    await enterOperative(page);
    await expect(page.locator('.board-tile.is-clue-target')).toHaveCount(0);

    // Returning to spymaster brings the same highlight back — proof the clue result survived.
    await page.getByTestId('mode-spymaster').click();
    await expect(page.getByTestId('mode-spymaster')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.board-tile.is-clue-target')).toHaveCount(2);
  });

  test('reveals a card in operative mode and rebuilds the guess from live words only', async ({
    page,
  }) => {
    await openDesktopBoard(page);
    await enterOperative(page);

    // Reveal the first card via the marking flow. Its true role must surface once chosen,
    // while every other role — and the team counters — stay hidden.
    await page.getByTestId('btn-mark-revealed').click();
    await page.getByTestId('tile-0').click();

    const firstTile = page.getByTestId('tile-0');
    await expect(firstTile).toHaveAttribute('data-lifecycle', 'chosen');
    await expect(firstTile).toHaveAttribute('data-role', 'red');
    await expect(firstTile).toHaveAccessibleName(`${fixtureBoard.words[0]}, אדום, נחשף`);
    await expect(page.getByTestId('tile-9')).toHaveAttribute('data-role', 'neutral');
    await expect(page.locator('.board__remaining')).toHaveCount(0);

    // The guess request must be rebuilt from live words only — the revealed card is gone.
    await page.getByTestId('operative-clue-input').fill('חיות');
    await page.getByTestId('btn-operative').click();
    await expect(page.getByTestId('operative-result')).toBeVisible();

    const request = await page.evaluate(() => window.__lastOperativeReq);
    expect(request?.words).toHaveLength(24);
    expect(request?.words).not.toContain(fixtureBoard.words[0]);
    expect(request?.roles).not.toHaveProperty(fixtureBoard.words[0]);
  });

  test('mirrors board privacy on the semantic map and suppresses danger + attraction hints', async ({
    page,
  }) => {
    await openDesktopBoard(page);
    await enterOperative(page);

    const map = page.getByTestId('stub-map');
    await expect(map).toHaveAttribute('data-mode', 'operative');

    const dots = page.locator('[data-testid^="map-dot-"]');
    await expect(dots).toHaveCount(25);
    await expect(page.locator('[data-testid^="map-dot-"][data-role="neutral"]')).toHaveCount(25);
    await expect(page.locator('[data-testid^="map-danger-"]')).toHaveCount(0);
    await expect(page.getByTestId('map-hint-node')).toHaveCount(0);
    await expect(page.getByTestId('map-legend')).toContainText('צבעי הקלפים נשארים מוסתרים');

    // Switching back to spymaster re-exposes the true roles (the assassin dot regains its color),
    // confirming the map hides roles by mode rather than losing them.
    await page.getByTestId('mode-spymaster').click();
    await expect(map).toHaveAttribute('data-mode', 'spymaster');
    await expect(page.locator('[data-testid^="map-dot-"][data-role="assassin"]')).toHaveCount(1);
    await expect(page.locator('[data-testid^="map-dot-"][data-role="neutral"]')).toHaveCount(7);
  });
});
