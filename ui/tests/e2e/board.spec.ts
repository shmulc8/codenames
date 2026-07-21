import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

async function setupDemoBoard(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('btn-skip-demo').click();
  await page.getByTestId('btn-confirm-board').click();
  await expect(page.getByTestId('board-grid')).toBeVisible();
}

async function readBoardState(page: Page) {
  return page.evaluate(() => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    const state = window.__store.getState();
    return {
      screen: state.screen,
      selected: state.selected,
      target: state.target,
      hoverWord: state.hoverWord,
      tiles: state.tiles,
    };
  });
}

test.describe('BoardGrid', () => {
  test('renders all absolute roles with canonical attributes and game counters', async ({ page }) => {
    await setupDemoBoard(page);

    await expect(page.getByTestId(/^tile-\d+$/)).toHaveCount(25);
    for (let index = 0; index < 25; index += 1) {
      const word = fixtureBoard.words[index];
      await expect(page.getByTestId(`tile-${index}`)).toHaveAttribute('data-word', word);
      await expect(page.getByTestId(`tile-${index}`)).toHaveAttribute(
        'data-role',
        fixtureBoard.roles[word],
      );
      await expect(page.getByTestId(`tile-${index}`)).toHaveAttribute(
        'data-lifecycle',
        'inPlay',
      );
      await expect(page.getByTestId(`btn-lifecycle-${index}`)).toBeVisible();
    }

    await expect(page.getByText(/אדום\s*9/)).toBeVisible();
    await expect(page.getByText(/כחול\s*8/)).toBeVisible();
    const board = page.getByTestId('stub-board');
    await board.getByText('מקרא', { exact: true }).click();
    await expect(board.getByText('מתנקש', { exact: true })).toBeVisible();
    await expect(board.getByText('ניטרלי', { exact: true })).toBeVisible();
  });

  test('selects one team color, preserves order, and exposes keyboard focus', async ({ page }) => {
    await setupDemoBoard(page);

    await page.getByTestId('tile-0').click();
    await page.getByTestId('tile-1').click();
    await expect(page.getByTestId('tile-0')).toContainText('1');
    await expect(page.getByTestId('tile-1')).toContainText('2');

    let state = await readBoardState(page);
    expect(state.selected).toEqual([fixtureBoard.words[0], fixtureBoard.words[1]]);
    expect(state.target).toBe('red');

    await page.getByTestId('tile-0').press('Enter');
    state = await readBoardState(page);
    expect(state.selected).toEqual([fixtureBoard.words[1]]);
    await expect(page.getByTestId('tile-0')).toBeFocused();
  });

  test('rejects cross-color and non-team selections with the contract messages', async ({ page }) => {
    await setupDemoBoard(page);

    await page.getByTestId('tile-0').click();
    await page.getByTestId('tile-9').click();
    await expect(page.getByTestId('toast')).toContainText(
      'אפשר לבחור רק קלפים בצבע אחד',
    );
    expect((await readBoardState(page)).selected).toEqual([fixtureBoard.words[0]]);

    await page.getByTestId('tile-17').click();
    await expect(page.getByTestId('toast')).toContainText(
      'אפשר לבחור רק קלפים של קבוצה',
    );
    expect((await readBoardState(page)).selected).toEqual([fixtureBoard.words[0]]);
  });

  test('synchronizes hover state for board-to-map linking', async ({ page }) => {
    await setupDemoBoard(page);

    await page.getByTestId('tile-3').hover();
    await expect.poll(async () => (await readBoardState(page)).hoverWord).toBe(
      fixtureBoard.words[3],
    );
    await page.getByTestId('btn-reset-game').hover();
    await expect.poll(async () => (await readBoardState(page)).hoverWord).toBeNull();
  });

  test('marks and restores a chosen tile independently from selection', async ({ page }) => {
    await setupDemoBoard(page);

    await page.getByTestId('tile-0').click();
    await page.getByTestId('btn-lifecycle-0').click();
    await expect(page.getByTestId('tile-0')).toHaveAttribute('data-lifecycle', 'chosen');
    await expect(page.getByTestId('chip-chosenby-0')).toBeVisible();

    let state = await readBoardState(page);
    expect(state.selected).toEqual([]);
    expect(state.tiles[0]).toMatchObject({
      word: fixtureBoard.words[0],
      role: 'red',
      lifecycle: 'chosen',
      chosenBy: 'red',
    });

    await page.getByTestId('btn-lifecycle-0').press('Enter');
    await expect(page.getByTestId('btn-lifecycle-0')).toBeFocused();
    await expect(page.getByTestId('tile-0')).toHaveAttribute('data-lifecycle', 'inPlay');
    await expect(page.getByTestId('chip-chosenby-0')).toHaveCount(0);
    state = await readBoardState(page);
    expect(state.tiles[0]).toEqual({
      word: fixtureBoard.words[0],
      role: 'red',
      lifecycle: 'inPlay',
    });
  });

  test('announces the assassin and updates the remaining team counters', async ({ page }) => {
    await setupDemoBoard(page);

    await page.getByTestId('btn-lifecycle-0').click();
    await expect(page.getByText(/אדום\s*8/)).toBeVisible();
    await page.getByTestId('btn-lifecycle-24').click();
    await expect(page.getByTestId('tile-24')).toHaveAttribute('data-lifecycle', 'chosen');
    await expect(page.getByTestId('chip-chosenby-24')).toBeVisible();
    await expect(page.getByText('המתנקש נחשף — סוף משחק', { exact: true })).toBeVisible();
  });

  test('replaces the board in place without confirmation or navigating to setup', async ({ page }) => {
    await setupDemoBoard(page);

    await page.getByTestId('btn-lifecycle-0').click();
    await page.getByTestId('btn-reset-game').click();
    await expect(page.getByTestId('board-grid')).toBeVisible();
    await expect(page.getByTestId('setup-screen')).toHaveCount(0);
    await expect(page.getByTestId('tile-0')).toHaveAttribute('data-lifecycle', 'inPlay');
    expect((await readBoardState(page)).screen).toBe('game');
  });
});
