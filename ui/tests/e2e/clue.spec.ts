import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

async function setupFixtureBoard(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1320, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('setup-screen')).toBeVisible();

  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);

  await expect(page.getByTestId('target-color')).toBeVisible();
}

async function installClueResponseGate(page: Page): Promise<void> {
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    let releaseResponse!: () => void;
    let markResponseReady!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const responseReady = new Promise<void>((resolve) => {
      markResponseReady = resolve;
    });

    const testWindow = window as Window & {
      __clueResponseGate?: {
        release: () => void;
        ready: Promise<void>;
      };
    };
    testWindow.__clueResponseGate = {
      release: releaseResponse,
      ready: responseReady,
    };

    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      const requestUrl =
        typeof args[0] === 'string'
          ? args[0]
          : args[0] instanceof URL
            ? args[0].toString()
            : args[0].url;

      if (requestUrl.includes('/api/coach/spymaster')) {
        markResponseReady();
        await responseGate;
      }

      return response;
    };
  });
}

async function waitForClueResponse(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const testWindow = window as Window & {
      __clueResponseGate?: { ready: Promise<void> };
    };
    await testWindow.__clueResponseGate?.ready;
  });
}

async function releaseClueResponse(page: Page): Promise<void> {
  await page.evaluate(() => {
    const testWindow = window as Window & {
      __clueResponseGate?: { release: () => void };
    };
    testWindow.__clueResponseGate?.release();
  });
}

async function requestAutoClue(page: Page): Promise<void> {
  await page.getByTestId('btn-get-clue').click();
  await expect(page.getByTestId('clue-result')).toBeVisible();
  await expect(page.getByTestId('clue-word')).toHaveText('טבע');
}

test('auto-cluster renders option 0, posts no focus, and exposes loading state', async ({
  page,
}) => {
  await setupFixtureBoard(page);

  // With no cards selected the single action button offers the "find best combination" flow.
  await expect(page.getByTestId('btn-get-clue')).toBeEnabled();
  await expect(page.getByTestId('btn-get-clue')).toHaveText('מצא לי את הצירוף הכי טוב');
  await expect(page.getByTestId('target-red')).toHaveAttribute('aria-pressed', 'true');

  await installClueResponseGate(page);
  await page.getByTestId('btn-get-clue').click();
  try {
    await waitForClueResponse(page);
    await expect(
      page.getByTestId('btn-get-clue').getByTestId('loading-spinner'),
    ).toBeVisible();
    await expect(page.getByTestId('btn-get-clue')).toBeDisabled();
    await expect(page.getByTestId('risk-balanced')).toBeDisabled();
  } finally {
    await releaseClueResponse(page);
  }

  await expect(page.getByTestId('clue-result')).toBeVisible();
  await expect(page.getByTestId('clue-word')).toHaveText('טבע');
  await expect(page.getByTestId('clue-count')).toHaveText('מספר: 2');
  await expect(page.getByTestId('clue-reason')).toContainText(
    'הרמז מחבר היטב בין מילות המטרה',
  );
  await expect(page.getByTestId('option-counter')).toHaveText('אפשרות 1 מתוך 2');
  await expect(page.getByText(/המתנקש \(נחש\) במקום \d+ בדירוג/)).toBeVisible();

  const request = await page.evaluate(() => window.__lastSpymasterReq);
  expect(request?.focus).toBeUndefined();
  expect(request?.risk).toBe('balanced');

  const selected = await page.evaluate(() => window.__store?.getState().selected);
  expect(selected).toEqual(fixtureBoard.words.slice(0, 2));
  await expect(page.getByTestId('tile-0')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('tile-1')).toHaveAttribute('aria-pressed', 'true');
});

test('focused request posts the selected cluster and keyboard-selected risk', async ({
  page,
}) => {
  await setupFixtureBoard(page);

  await page.evaluate((words) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().toggleSelected(words[0]);
    window.__store.getState().toggleSelected(words[1]);
  }, fixtureBoard.words);

  await expect(page.getByText('נבחרו: 2 קלפים בצבע אדום')).toBeVisible();
  await expect(page.getByTestId('btn-get-clue')).toBeEnabled();

  await page.getByTestId('risk-bold').focus();
  await expect(page.getByTestId('risk-bold')).toBeFocused();
  await page.getByTestId('risk-bold').press('Space');
  await expect(page.getByTestId('risk-bold')).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('btn-get-clue').click();
  await expect(
    page.getByTestId('btn-get-clue').getByTestId('loading-spinner'),
  ).toBeVisible();
  await expect(page.getByTestId('clue-word')).toHaveText('טבע');

  const request = await page.evaluate(() => window.__lastSpymasterReq);
  expect(request?.focus).toEqual(fixtureBoard.words.slice(0, 2));
  expect(request?.risk).toBe('bold');
});

test('carousel wraps between the two best options and renders the risky state', async ({
  page,
}) => {
  await setupFixtureBoard(page);
  await requestAutoClue(page);

  const controlPositions = await page.evaluate(() => {
    const nextButton = document.querySelector<HTMLElement>('[data-testid="btn-next-option"]');
    const nextLabel = document.querySelector<HTMLElement>('[data-testid="next-option-label"]');
    const previousButton = document.querySelector<HTMLElement>('[data-testid="btn-prev-option"]');
    const previousLabel = document.querySelector<HTMLElement>('[data-testid="prev-option-label"]');
    const nextChevron = nextButton?.querySelector<HTMLElement>('.clue-carousel__chevron');
    const previousChevron = previousButton?.querySelector<HTMLElement>('.clue-carousel__chevron');
    if (!nextLabel || !previousLabel || !nextChevron || !previousChevron) {
      throw new Error('Carousel controls were not rendered');
    }
    return {
      nextChevron: nextChevron.getBoundingClientRect().x,
      nextLabel: nextLabel.getBoundingClientRect().x,
      previousChevron: previousChevron.getBoundingClientRect().x,
      previousLabel: previousLabel.getBoundingClientRect().x,
    };
  });
  expect(controlPositions.nextChevron).toBeGreaterThan(controlPositions.nextLabel);
  expect(controlPositions.previousLabel).toBeGreaterThan(
    controlPositions.previousChevron,
  );

  // Only the two strongest options are shown; wrapping backwards lands on the risky one.
  await expect(page.getByTestId('option-counter')).toHaveText('אפשרות 1 מתוך 2');
  await page.getByTestId('btn-prev-option').click();
  await expect(page.getByTestId('option-counter')).toHaveText('אפשרות 2 מתוך 2');
  await expect(page.getByTestId('clue-word')).toHaveText('מסע');
  await expect(page.getByTestId('warning-banner')).toContainText(
    'זהירות: הרמז עלול למשוך מילה מסוכנת.',
  );
  await expect(page.getByTestId('warning-banner')).toContainText('נחש');

  await page.getByTestId('btn-next-option').click();
  await expect(page.getByTestId('option-counter')).toHaveText('אפשרות 1 מתוך 2');
  await expect(page.getByTestId('clue-word')).toHaveText('טבע');
});

test('renders the no-clue state when the engine has no safe clue', async ({ page }) => {
  await setupFixtureBoard(page);
  // The cautious profile is the mock's deterministic "no safe clue" path.
  await page.getByTestId('risk-cautious').click();
  await page.getByTestId('btn-get-clue').click();

  await expect(page.getByTestId('no-clue-state')).toContainText(
    'לא נמצא רמז בטוח. נסו אשכול אחר או רמת סיכון אחרת.',
  );
  await expect(page.getByTestId('no-clue-state')).toContainText(
    "נסה רמת 'שובב' או בחר מילים אחרות",
  );
  // With a single refusal option there is nothing to cycle through.
  await expect(page.getByTestId('option-counter')).toHaveCount(0);
});

test('target switch clears selection and blue-target requests use my/opp wire roles', async ({
  page,
}) => {
  await setupFixtureBoard(page);

  await page.evaluate((word) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().toggleSelected(word);
  }, fixtureBoard.words[0]);

  await expect(page.getByText('נבחרו: 1 קלפים בצבע אדום')).toBeVisible();
  await page.getByTestId('target-blue').focus();
  await expect(page.getByTestId('target-blue')).toBeFocused();
  await expect(page.getByTestId('target-blue')).toHaveCSS('outline-offset', '-3px');
  await page.getByTestId('target-blue').press('Enter');
  await expect(page.getByTestId('target-blue')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('לא נבחרו קלפים — אפשר לתת למנוע לבחור צירוף.')).toBeVisible();

  const switchedState = await page.evaluate(() => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    const { selected, target } = window.__store.getState();
    return { selected, target };
  });
  expect(switchedState).toEqual({ selected: [], target: 'blue' });

  await requestAutoClue(page);

  const request = await page.evaluate(() => window.__lastSpymasterReq);
  expect(request?.focus).toBeUndefined();
  expect(request?.roles[fixtureBoard.words[9]]).toBe('my');
  expect(request?.roles[fixtureBoard.words[0]]).toBe('opp');
  expect(request?.roles[fixtureBoard.words[17]]).toBe('neutral');
  expect(request?.roles[fixtureBoard.words[24]]).toBe('assassin');
});

test('using a clue records its target in the store log and confirms usage', async ({
  page,
}) => {
  await setupFixtureBoard(page);
  await page.getByTestId('target-blue').click();
  await requestAutoClue(page);

  await page.getByTestId('btn-use-clue').click();
  await expect(page.getByTestId('btn-use-clue')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('btn-use-clue')).toHaveAccessibleName(
    'הרמז סומן לשימוש',
  );

  const result = await page.evaluate(() => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    const state = window.__store.getState();
    return {
      usedTarget: state.clue.used?.target,
      usedClue: state.clue.used?.clue,
      logLength: state.log.length,
      logTarget: state.log[0]?.target,
    };
  });

  expect(result).toEqual({
    usedTarget: 'blue',
    usedClue: 'טבע',
    logLength: 1,
    logTarget: 'blue',
  });
});

test('lifecycle changes display the stale-result overlay', async ({ page }) => {
  await setupFixtureBoard(page);
  await requestAutoClue(page);

  await page.evaluate((word) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().toggleLifecycle(word);
  }, fixtureBoard.words[0]);

  await expect(
    page.getByText('הלוח השתנה — הרמז חושב על לוח ישן'),
  ).toBeVisible();
  await expect(page.getByText('כדאי לחשב שוב לפני שמשתמשים בו.')).toBeVisible();
  await expect(page.getByText('חשבו שוב')).toBeVisible();
  await expect(page.getByTestId('btn-use-clue')).toBeDisabled();
});

test('a clue response is immediately stale when the live board changes in flight', async ({
  page,
}) => {
  await setupFixtureBoard(page);
  await installClueResponseGate(page);

  await page.getByTestId('btn-get-clue').click();
  try {
    await waitForClueResponse(page);

    const heldRequest = await page.evaluate(() => window.__lastSpymasterReq);
    expect(heldRequest?.words).toContain(fixtureBoard.words[0]);

    await page.getByTestId('btn-lifecycle-0').click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          if (!window.__store) {
            throw new Error('The dev store hook was not installed');
          }
          return window.__store.getState().tiles[0]?.lifecycle;
        }),
      )
      .toBe('chosen');
  } finally {
    await releaseClueResponse(page);
  }

  await expect(page.getByTestId('clue-word')).toHaveText('טבע');
  await expect(
    page.getByText('הלוח השתנה — הרמז חושב על לוח ישן'),
  ).toBeVisible();
  await expect(page.getByTestId('btn-use-clue')).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => {
        if (!window.__store) {
          throw new Error('The dev store hook was not installed');
        }
        return window.__store.getState().clue.stale;
      }),
    )
    .toBe(true);

  await page.getByText('חשבו שוב').click();
  await expect(
    page.getByText('הלוח השתנה — הרמז חושב על לוח ישן'),
  ).toHaveCount(0);
  await expect(page.getByTestId('btn-use-clue')).toBeEnabled();

  const regeneratedRequest = await page.evaluate(() => window.__lastSpymasterReq);
  expect(regeneratedRequest?.words).not.toContain(fixtureBoard.words[0]);
});

test.describe('backend error handling', () => {
  test.use({ serviceWorkers: 'block' });

  test('surfaces the backend message in the canonical toast', async ({ page }) => {
    await page.route('**/api/coach/spymaster', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'בדיקת כשל מהשרת' }),
      });
    });

    await setupFixtureBoard(page);
    await page.getByTestId('btn-get-clue').click();

    await expect(page.getByTestId('toast')).toBeVisible();
    await expect(page.getByTestId('toast')).toContainText('בדיקת כשל מהשרת');
    await expect(page.getByTestId('loading-spinner')).toHaveCount(0);
  });
});
