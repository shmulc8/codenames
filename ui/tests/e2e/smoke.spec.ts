import { expect, test } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

test('loads the RTL shell and switches between the game tabs', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('stub-photo')).toBeVisible();

  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);

  await expect(page.getByTestId('tab-clue')).toBeVisible();
  await expect(page.getByTestId('tab-check')).toBeVisible();
  await expect(page.getByTestId('stub-board')).toBeVisible();
  await expect(page.getByTestId('stub-clue')).toBeVisible();
  await expect(page.getByTestId('stub-map')).toBeVisible();
  await expect(page.getByTestId('stub-log')).toBeVisible();

  await page.getByTestId('tab-check').click();
  await expect(page.getByTestId('stub-check')).toBeVisible();

  await page.getByTestId('tab-clue').click();
  await expect(page.getByTestId('stub-clue')).toBeVisible();
});

test('dev store hook exposes lifecycle changes and canonical selectors', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async (board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    const store = window.__store;
    store.getState().setBoard(board.words, board.roles);
    store.getState().toggleLifecycle(board.words[0]);

    const modulePath = '/src/state/store.ts';
    const storeModule = (await import(/* @vite-ignore */ modulePath)) as typeof import('../../src/state/store');
    const state = store.getState();

    return {
      lifecycle: state.tiles[0]?.lifecycle,
      live: storeModule.liveBoard(state),
      full: storeModule.fullBoard(state),
      selectedColor: storeModule.selectedColor(state),
    };
  }, fixtureBoard);

  expect(result.lifecycle).toBe('chosen');
  expect(result.live.words).toHaveLength(24);
  expect(result.live.words).not.toContain(fixtureBoard.words[0]);
  expect(result.full.words).toHaveLength(25);
  expect(result.selectedColor).toBeNull();
});

test('store enforces one-color clusters and surfaces the canonical toast', async ({ page }) => {
  await page.goto('/');

  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    const store = window.__store;
    store.getState().setBoard(board.words, board.roles);
    store.getState().toggleSelected(board.words[0]);
    store.getState().toggleSelected(board.words[9]);
  }, fixtureBoard);

  await expect(page.getByTestId('toast')).toContainText(
    'אפשר לבחור רק קלפים בצבע אחד',
  );

  const state = await page.evaluate(() => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    const store = window.__store;
    const beforeSwitch = {
      selected: store.getState().selected,
      target: store.getState().target,
    };
    store.getState().setTarget('blue');
    return {
      beforeSwitch,
      selected: store.getState().selected,
      target: store.getState().target,
    };
  });

  expect(state.beforeSwitch.selected).toEqual([fixtureBoard.words[0]]);
  expect(state.beforeSwitch.target).toBe('red');
  expect(state.selected).toEqual([]);
  expect(state.target).toBe('blue');
});

test('API boundary and MSW keep relative wire roles out of app responses', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async (board) => {
    const modulePath = '/src/api/client.ts';
    const client = (await import(/* @vite-ignore */ modulePath)) as typeof import('../../src/api/client');
    const deal = await client.getDeal();
    const clue = await client.postSpymaster(board, 'red', [board.words[0]], 'balanced');
    const check = await client.postCheck(board, 'red', 'בדיקה');
    const space = await client.postSpace(board, 'red', 'טבע');
    await client.postFeedback({
      uid: 'smoke-user',
      verdict: 'outcome',
      mode: 'outcome',
      target: 'red',
      clue: 'טבע',
      board,
      revealed: [{ word: board.words[9], chosenBy: 'blue' }],
    });

    return {
      dealRoles: Object.values(deal.roles),
      clueRoles: clue.options[0]?.read.map((entry) => entry.role),
      checkRoles: check.read.map((entry) => entry.role),
      spaceRoles: Object.values(space.roles),
      spymasterRequest: window.__lastSpymasterReq,
      checkRequest: window.__lastCheckReq,
      spaceRequest: window.__lastSpaceReq,
      feedbackRequest: window.__lastFeedback,
    };
  }, fixtureBoard);

  for (const roles of [
    result.dealRoles,
    result.clueRoles,
    result.checkRoles,
    result.spaceRoles,
  ]) {
    expect(roles).not.toContain('my');
    expect(roles).not.toContain('opp');
  }

  expect(result.spymasterRequest?.roles[fixtureBoard.words[0]]).toBe('my');
  expect(result.spymasterRequest?.roles[fixtureBoard.words[9]]).toBe('opp');
  expect(result.checkRequest?.roles[fixtureBoard.words[0]]).toBe('my');
  expect(result.spaceRequest?.roles[fixtureBoard.words[9]]).toBe('opp');
  expect(
    (result.feedbackRequest?.revealed as Array<{ chosenBy: string }> | undefined)?.[0]
      ?.chosenBy,
  ).toBe('opp');
});
