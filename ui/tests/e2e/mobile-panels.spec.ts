import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';
import {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  mountMobilePanels,
  openMobileTab,
  requestAutoClue,
  setFixtureBoard,
} from '../support/mobile-panels';

async function bootMobileGame(page: Page): Promise<void> {
  await mountMobilePanels(page);
  await setFixtureBoard(page);
  await expect(page.getByTestId('target-color')).toBeVisible();
}

test.describe('mobile clue/check/map tabs', () => {
  test('clue tab mounts CluePanel, exposes loading, and produces option 0', async ({
    page,
  }) => {
    await bootMobileGame(page);

    // Single-column re-layout of the reused desktop CluePanel.
    await expect(page.getByTestId('tabbar')).toBeVisible();
    await expect(page.getByTestId('target-color')).toBeVisible();
    await expect(page.getByTestId('btn-get-clue')).toBeVisible();
    await expect(page.getByTestId('btn-get-clue')).toBeDisabled();
    await expect(page.getByTestId('target-red')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByTestId('btn-auto-cluster').click();
    await expect(
      page.getByTestId('btn-auto-cluster').getByTestId('loading-spinner'),
    ).toBeVisible();

    await expect(page.getByTestId('clue-result')).toBeVisible();
    await expect(page.getByTestId('clue-word')).toHaveText('טבע');
    await expect(page.getByTestId('clue-count')).toHaveText('מספר: 2');
    await expect(page.getByTestId('clue-reason')).toContainText(
      'הרמז מחבר היטב בין מילות המטרה',
    );
    await expect(page.getByTestId('option-counter')).toHaveText(
      'אפשרות 1 מתוך 3',
    );

    const request = await page.evaluate(() => window.__lastSpymasterReq);
    expect(request?.focus).toBeUndefined();
    expect(request?.risk).toBe('balanced');

    const selected = await page.evaluate(
      () => window.__store?.getState().selected,
    );
    expect(selected).toEqual(fixtureBoard.words.slice(0, 2));
  });

  test('risk and target changes post correct wire roles from the clue tab', async ({
    page,
  }) => {
    await bootMobileGame(page);

    await page.getByTestId('risk-bold').click();
    await expect(page.getByTestId('risk-bold')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.getByTestId('target-blue').click();
    await expect(page.getByTestId('target-blue')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await requestAutoClue(page);

    const request = await page.evaluate(() => window.__lastSpymasterReq);
    expect(request?.focus).toBeUndefined();
    expect(request?.risk).toBe('bold');
    expect(request?.roles[fixtureBoard.words[9]]).toBe('my');
    expect(request?.roles[fixtureBoard.words[0]]).toBe('opp');
    expect(request?.roles[fixtureBoard.words[17]]).toBe('neutral');
    expect(request?.roles[fixtureBoard.words[24]]).toBe('assassin');
  });

  test('inline feedback expands in place inside the clue card (never a modal)', async ({
    page,
  }) => {
    await bootMobileGame(page);
    await requestAutoClue(page);

    const clueCard = page.getByTestId('clue-result');
    await expect(clueCard.getByTestId('btn-like')).toBeVisible();
    await expect(clueCard.getByTestId('btn-dislike')).toBeVisible();

    await clueCard.getByTestId('btn-dislike').click();
    // Expands within the same card — no dialog role, no modal.
    await expect(clueCard.getByTestId('feedback-why')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await clueCard.getByTestId('feedback-why').getByText('מעורפל').click();
    await expect(clueCard.getByTestId('feedback-sent')).toBeVisible();
  });

  test('session log is reachable from the clue tab and records a used clue', async ({
    page,
  }) => {
    await bootMobileGame(page);
    await requestAutoClue(page);

    await page.getByTestId('btn-use-clue').click();
    await expect(page.getByTestId('btn-use-clue')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await expect(page.getByTestId('session-log')).toBeVisible();
    await expect(page.getByTestId('log-entry-0')).toContainText('טבע');
  });

  test('map tab renders a dot for every live word plus the hint node', async ({
    page,
  }) => {
    await bootMobileGame(page);
    await requestAutoClue(page);

    await openMobileTab(page, 'map');
    await expect(page.getByTestId('semantic-map')).toBeVisible();
    await expect(page.getByTestId('map-dot-אריה')).toBeVisible();

    await expect(page.getByTestId('semantic-map').getByRole('button')).toHaveCount(
      25,
    );
    await expect(page.getByTestId('map-dot-אריה')).toHaveAttribute(
      'data-role',
      'red',
    );
    await expect(page.getByTestId('map-dot-ים')).toHaveAttribute(
      'data-role',
      'blue',
    );
    await expect(page.getByTestId('map-dot-נחש')).toHaveAttribute(
      'data-role',
      'assassin',
    );
    await expect(page.getByTestId('map-hint-node')).toContainText('טבע');
    await expect(page.getByTestId('map-legend')).toContainText(
      'קרוב למרכז = קרוב לרמז',
    );

    await expect
      .poll(() => page.evaluate(() => window.__lastSpaceReq?.clue))
      .toBe('טבע');
    const request = await page.evaluate(() => window.__lastSpaceReq);
    expect(request?.words).toEqual(fixtureBoard.words);
  });

  test('map dot ↔ tile highlight stays bidirectional through store.hoverWord', async ({
    page,
  }) => {
    await bootMobileGame(page);
    await requestAutoClue(page);
    await openMobileTab(page, 'map');
    await expect(page.getByTestId('map-dot-אריה')).toBeVisible();

    await page.getByTestId('map-dot-אריה').hover();
    await expect
      .poll(() => page.evaluate(() => window.__store?.getState().hoverWord))
      .toBe('אריה');
  });

  test('check tab mounts CheckPanel and renders the ranked list', async ({
    page,
  }) => {
    await bootMobileGame(page);

    await openMobileTab(page, 'check');
    await expect(page.getByTestId('check-input')).toBeVisible();

    await page.getByTestId('check-input').fill('טבעות');
    await page.getByTestId('btn-check').click();

    await expect(page.getByTestId('check-result')).toBeVisible();
    await expect(page.getByTestId('check-ranked-list')).toBeVisible();
    await expect(page.getByTestId('ranked-row-אריה')).toBeVisible();
    await expect(page.getByTestId('sim-score-אריה')).toBeVisible();

    const request = await page.evaluate(() => window.__lastCheckReq);
    expect(request?.clue).toBe('טבעות');
  });
});

test.describe('mobile error handling', () => {
  test.use({ serviceWorkers: 'block' });

  test('surfaces a clue backend failure as the canonical toast', async ({
    page,
  }) => {
    await page.route('**/api/coach/spymaster', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'בדיקת כשל מהשרת' }),
      });
    });

    await mountMobilePanels(page);
    await setFixtureBoard(page);
    await expect(page.getByTestId('target-color')).toBeVisible();

    await page.getByTestId('btn-auto-cluster').click();

    await expect(page.getByTestId('toast')).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('בדיקת כשל מהשרת');
    await expect(page.getByTestId('clue-result')).toHaveCount(0);
  });
});

test.describe('desktop regression — mobile panels stay out of the desktop app', () => {
  test('at desktop viewport the mobile host is absent and desktop clue/check/map render', async ({
    page,
  }) => {
    await page.setViewportSize({ ...DESKTOP_VIEWPORT });
    await page.goto('/');
    await expect(page.getByTestId('setup-screen')).toBeVisible();

    await page.evaluate((board) => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().setBoard(board.words, board.roles);
    }, fixtureBoard);

    // No mobile host, tabbar, or mobile-only tabs on desktop.
    await expect(page.locator('#mobile-root')).toHaveCount(0);
    await expect(page.getByTestId('tabbar')).toHaveCount(0);
    await expect(page.getByTestId('tab-map')).toHaveCount(0);
    await expect(page.getByTestId('tab-board')).toHaveCount(0);

    // Desktop clue slice is unchanged.
    await expect(page.getByTestId('tab-clue')).toBeVisible();
    await page.getByTestId('btn-auto-cluster').click();
    await expect(page.getByTestId('clue-result')).toBeVisible();
    await expect(page.getByTestId('clue-word')).toHaveText('טבע');

    // Desktop map slice is unchanged.
    await expect(page.getByTestId('semantic-map')).toBeVisible();
    await expect(page.getByTestId('map-dot-אריה')).toBeVisible();

    // Desktop check slice is unchanged.
    await page.getByTestId('tab-check').click();
    await expect(page.getByTestId('check-input')).toBeVisible();
    await page.getByTestId('check-input').fill('טבעות');
    await page.getByTestId('btn-check').click();
    await expect(page.getByTestId('check-ranked-list')).toBeVisible();
  });
});
