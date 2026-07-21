import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';
import type { ClueOption, Role } from '../../src/types/api';

const cleanOption: ClueOption = {
  word: 'טבע',
  count: 2,
  intended: [fixtureBoard.words[0], fixtureBoard.words[1]],
  score: 0.91,
  reason: 'הרמז מחבר היטב בין מילות המטרה.',
  read: fixtureBoard.words.map((word, index) => ({
    word,
    role: fixtureBoard.roles[word],
    sim: 0.9 - index * 0.02,
    conf: 0.95 - index * 0.02,
  })),
  leak: [],
  safe: 2,
  assassin: { word: fixtureBoard.words[24], rank: 24, sim: 0.2 },
  no_clue: false,
  risky: false,
  note: '',
};

const riskyOption: ClueOption = {
  ...cleanOption,
  word: 'מסע',
  score: 0.64,
  reason: 'קשר רחב יותר, עם סיכון.',
  leak: [cleanOption.read[9]],
  safe: 1,
  risky: true,
  note: 'זהירות: הרמז עלול למשוך מילה מסוכנת.',
};

const options = [cleanOption, riskyOption];

async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate((board) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setBoard(board.words, board.roles);
  }, fixtureBoard);
  await expect(page.getByTestId('session-log')).toBeVisible();
}

async function installClue(page: Page): Promise<void> {
  await page.evaluate((clueOptions) => {
    if (!window.__store) throw new Error('The dev store hook was not installed');
    window.__store.getState().setClueResult({
      options: clueOptions,
      picked: 0,
      clue: clueOptions[0].word,
      count: clueOptions[0].count,
      intended: clueOptions[0].intended,
      reason: clueOptions[0].reason,
      read: clueOptions[0].read,
      leak: clueOptions[0].leak,
      assassin: clueOptions[0].assassin,
      no_clue: false,
      risky: false,
      safe: clueOptions[0].safe,
      note: '',
    });
  }, options);
}

async function mountFeedbackHarness(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const reactPath = '/@id/react';
    const reactDomPath = '/@id/react-dom/client';
    const feedbackPath = '/src/features/feedback/index.tsx';
    const storePath = '/src/state/store.ts';
    const [React, ReactDom, feedbackModule, storeModule] = await Promise.all([
      import(reactPath),
      import(reactDomPath),
      import(feedbackPath),
      import(storePath),
    ]);

    const rootElement = document.createElement('div');
    rootElement.id = 'feedback-test-root';
    document.body.append(rootElement);
    const createElement =
      React.createElement ??
      (React.default as { createElement?: typeof React.createElement } | undefined)?.createElement;
    if (!createElement) throw new Error('React createElement was not available');

    function Harness() {
      const option = storeModule.useAppStore(
        (state: { clue: { current: { options: ClueOption[] } | null; optionIndex: number } }) =>
          state.clue.current?.options[state.clue.optionIndex] ?? null,
      );
      const risk = storeModule.useAppStore((state: { risk: string }) => state.risk);
      return option
        ? createElement(feedbackModule.FeedbackControls, {
            option,
            mode: 'suggest',
            risk,
          })
        : null;
    }

    const createRoot =
      ReactDom.createRoot ??
      (ReactDom.default as { createRoot?: typeof ReactDom.createRoot } | undefined)?.createRoot;
    if (!createRoot) throw new Error('React createRoot was not available');
    createRoot(rootElement).render(createElement(Harness));
  });

  await expect(feedbackHarness(page).getByTestId('btn-like')).toBeVisible();
}

function feedbackHarness(page: Page) {
  return page.locator('#feedback-test-root');
}

async function setupFeedback(page: Page): Promise<void> {
  await openGame(page);
  await installClue(page);
  await mountFeedbackHarness(page);
}

function expectedWireRole(role: Role, target: 'red' | 'blue'): string {
  if (role === target) return 'my';
  if (role === 'red' || role === 'blue') return 'opp';
  return role;
}

test.describe('instant feedback', () => {
  test('👍 sends the complete wire payload and keeps its uid across reloads', async ({ page }) => {
    await setupFeedback(page);
    const feedback = feedbackHarness(page);
    await page.evaluate((board) => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().toggleLifecycle(board.words[9]);
      window.__store.getState().toggleSelected(board.words[0]);
    }, fixtureBoard);
    await page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input.url;
        if (!url.endsWith('/api/feedback')) return originalFetch(input, init);

        return new Promise((resolve, reject) => {
          window.addEventListener(
            'feedback-test:release-request',
            () => {
              originalFetch(input, init).then(resolve, reject);
            },
            { once: true },
          );
        });
      };
    });

    await feedback.getByTestId('btn-like').click();
    await expect(feedback.getByTestId('loading-spinner')).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new Event('feedback-test:release-request'));
    });
    await expect(feedback.getByTestId('feedback-sent')).toContainText(
      'תודה! זה עוזר לאמן את המודל',
    );
    await expect(feedback.getByTestId('feedback-comment')).toBeVisible();
    await expect(feedback.getByTestId('btn-like')).toBeDisabled();
    await expect(feedback.getByTestId('btn-dislike')).toBeDisabled();

    const firstPayload = await expect
      .poll(() => page.evaluate(() => window.__lastFeedback))
      .not.toBeUndefined()
      .then(() => page.evaluate(() => window.__lastFeedback));

    expect(firstPayload?.verdict).toBe('up');
    expect(firstPayload?.mode).toBe('suggest');
    expect(firstPayload?.target).toBe('red');
    expect(firstPayload?.risk).toBe('balanced');
    expect(firstPayload?.clue).toBe(cleanOption.word);
    expect(firstPayload?.count).toBe(cleanOption.count);
    expect(firstPayload?.intended).toEqual(cleanOption.intended);
    expect(firstPayload?.focus).toEqual([fixtureBoard.words[0]]);
    expect(firstPayload?.uid).toBeTruthy();
    expect(firstPayload?.board.words).toEqual(fixtureBoard.words);
    expect(Object.keys(firstPayload?.board.roles ?? {})).toHaveLength(25);
    for (const word of fixtureBoard.words) {
      expect(firstPayload?.board.roles[word]).toBe(
        expectedWireRole(fixtureBoard.roles[word], 'red'),
      );
    }
    expect(firstPayload?.revealed).toEqual([
      { word: fixtureBoard.words[9], chosenBy: 'opp' },
    ]);
    expect(firstPayload?.option).toMatchObject({
      word: cleanOption.word,
      count: cleanOption.count,
      intended: cleanOption.intended,
      score: cleanOption.score,
    });

    const firstUid = firstPayload?.uid;
    await page.reload();
    await page.evaluate((board) => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().setBoard(board.words, board.roles);
    }, fixtureBoard);
    await installClue(page);
    await mountFeedbackHarness(page);
    await feedback.getByTestId('btn-like').click();
    await expect(feedback.getByTestId('feedback-sent')).toBeVisible();

    const secondUid = await expect
      .poll(() => page.evaluate(() => window.__lastFeedback?.uid))
      .toBe(firstUid)
      .then(() => page.evaluate(() => window.__lastFeedback?.uid));
    expect(secondUid).toBe(firstUid);
  });

  test('👎 requires a reason and includes the selected why tag', async ({ page }) => {
    await setupFeedback(page);
    const feedback = feedbackHarness(page);

    await feedback.getByTestId('btn-dislike').click();
    await expect(feedback.getByTestId('feedback-why')).toBeVisible();
    await expect(feedback.getByText('מה לא עבד? בחרו סיבה')).toBeVisible();
    expect(await page.evaluate(() => window.__lastFeedback)).toBeUndefined();

    await feedback.getByRole('button', { name: 'מסוכן', exact: true }).click();
    await expect(feedback.getByTestId('feedback-sent')).toBeVisible();
    await expect(feedback.getByTestId('feedback-comment')).toBeVisible();

    await expect
      .poll(() => page.evaluate(() => window.__lastFeedback))
      .toMatchObject({
        verdict: 'down',
        why: 'risky',
        target: 'red',
        clue: cleanOption.word,
      });
  });

  test('changing the store option resets the widget state', async ({ page }) => {
    await setupFeedback(page);
    const feedback = feedbackHarness(page);

    await feedback.getByTestId('btn-like').click();
    await expect(feedback.getByTestId('feedback-sent')).toBeVisible();
    await expect(feedback.getByTestId('btn-like')).toBeDisabled();

    await page.evaluate(() => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().setOptionIndex(1);
    });

    await expect(feedback.getByTestId('btn-like')).toBeEnabled();
    await expect(feedback.getByTestId('btn-dislike')).toBeEnabled();
    await expect(feedback.getByTestId('feedback-sent')).toBeHidden();
    await expect(feedback.getByTestId('feedback-comment')).toBeHidden();

    await feedback.getByTestId('btn-like').click();
    await expect
      .poll(() => page.evaluate(() => window.__lastFeedback?.clue))
      .toBe(riskyOption.word);
  });

  test('a failed request stays silent and is retried from the queue', async ({ page }) => {
    await setupFeedback(page);
    const feedback = feedbackHarness(page);
    await page.clock.install();
    await page.evaluate(() => {
      window.__failFeedbackOnce = true;
    });

    await feedback.getByTestId('btn-like').click();
    await expect(feedback.getByTestId('feedback-sent')).toBeVisible();
    await expect(page.getByTestId('toast')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.__failFeedbackOnce)).toBe(false);

    await page.evaluate(() => {
      window.__lastFeedback = undefined;
    });
    await page.clock.fastForward(30_000);

    await expect
      .poll(() => page.evaluate(() => window.__lastFeedback))
      .toMatchObject({ verdict: 'up', clue: cleanOption.word });
    await expect(page.getByTestId('toast')).toBeHidden();
  });
});

test.describe('outcome feedback and session log', () => {
  test('restoring a reveal clears the active outcome and log until it is revealed again', async ({
    page,
  }) => {
    await openGame(page);
    await installClue(page);
    await page.clock.install();

    await page.evaluate(() => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().useCurrentClue();
    });

    const tileWord = fixtureBoard.words[0];
    const lifecycleButton = page.getByTestId('btn-lifecycle-0');
    const outcome = page.getByTestId('log-entry-0').getByLabel('תוצאת הרמז');

    await lifecycleButton.click();
    await expect(page.getByTestId('tile-0')).toHaveAttribute('data-lifecycle', 'chosen');
    await expect(outcome).toContainText(tileWord);

    await lifecycleButton.click();
    await expect(page.getByTestId('tile-0')).toHaveAttribute('data-lifecycle', 'inPlay');
    await expect(outcome).toContainText('ממתין לקלפים שייחשפו');

    const restoredState = await page.evaluate(() => {
      const state = window.__store?.getState();
      return {
        used: state?.clue.used?.revealedAfter,
        logged: state?.log[0]?.revealedAfter,
      };
    });
    expect(restoredState).toEqual({ used: [], logged: [] });

    await page.clock.fastForward(5_001);
    expect(await page.evaluate(() => window.__lastFeedback)).toBeUndefined();

    await lifecycleButton.click();
    await expect(page.getByTestId('tile-0')).toHaveAttribute('data-lifecycle', 'chosen');
    expect(
      await page.evaluate(() => window.__store?.getState().clue.used?.revealedAfter),
    ).toEqual([{ word: tileWord, chosenBy: 'red' }]);

    await page.clock.fastForward(5_001);
    await expect
      .poll(() => page.evaluate(() => window.__lastFeedback))
      .toMatchObject({
        verdict: 'outcome',
        revealed: [{ word: tileWord, chosenBy: 'my' }],
      });
  });

  test('debounces both reveals into one outcome payload and renders them in the log', async ({
    page,
  }) => {
    await openGame(page);
    await expect(page.getByText('עוד לא ניתנו רמזים במשחק הזה')).toBeVisible();
    await installClue(page);

    await page.evaluate((board) => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      const store = window.__store.getState();
      store.useCurrentClue();
      window.__store.getState().toggleLifecycle(board.words[0]);
      window.__store.getState().toggleLifecycle(board.words[9]);
    }, fixtureBoard);

    const entry = page.getByTestId('log-entry-0');
    await expect(entry).toBeVisible();
    await expect(entry).toContainText(cleanOption.word);
    await expect(entry).toContainText(String(cleanOption.count));
    await expect(entry).toContainText(fixtureBoard.words[0]);
    await expect(entry).toContainText(fixtureBoard.words[1]);
    await expect(entry).toContainText(fixtureBoard.words[9]);

    await expect
      .poll(() => page.evaluate(() => window.__lastFeedback), { timeout: 8_000 })
      .toMatchObject({
        verdict: 'outcome',
        mode: 'outcome',
        target: 'red',
        risk: 'balanced',
        clue: cleanOption.word,
        count: cleanOption.count,
        intended: cleanOption.intended,
        revealed: [
          { word: fixtureBoard.words[0], chosenBy: 'my' },
          { word: fixtureBoard.words[9], chosenBy: 'opp' },
        ],
      });
    await expect
      .poll(() =>
        page.evaluate(() => window.__store?.getState().clue.used?.outcomeSent),
      )
      .toBe(true);
  });

  test('shows newest clues first, repeat marker, empty state, and collapse behavior', async ({
    page,
  }) => {
    await openGame(page);
    await expect(page.getByText('עוד לא ניתנו רמזים במשחק הזה')).toBeVisible();
    await installClue(page);

    await page.evaluate(() => {
      if (!window.__store) throw new Error('The dev store hook was not installed');
      window.__store.getState().useCurrentClue();
      window.__store.getState().setOptionIndex(1);
      window.__store.getState().useCurrentClue();
    });

    await expect(page.getByTestId('log-entry-0')).toContainText(riskyOption.word);
    await expect(page.getByTestId('log-entry-0')).toContainText(
      'כבר השתמשת ברמז הזה',
    );
    await expect(page.getByTestId('log-entry-1')).toContainText(cleanOption.word);

    await page.getByTestId('log-toggle').click();
    await expect(page.getByTestId('log-entry-0')).toBeHidden();
    await expect(page.getByTestId('log-toggle')).toHaveAttribute('aria-expanded', 'false');
    await page.getByTestId('log-toggle').click();
    await expect(page.getByTestId('log-entry-0')).toBeVisible();
    await expect(page.getByTestId('log-toggle')).toHaveAttribute('aria-expanded', 'true');
  });
});
