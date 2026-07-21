import { expect, test } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

test('complete spymaster flow stays synchronized across every desktop slice', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('btn-skip-demo').click();
  await expect(page.getByTestId('board-grid')).toBeVisible();

  await page.getByTestId('target-red').click();
  await page.getByTestId('tile-0').click();
  await page.getByTestId('tile-1').click();
  await expect(page.getByText('נבחרו: 2 קלפים בצבע אדום')).toBeVisible();

  await page.getByTestId('btn-get-clue').click();
  await expect(page.getByTestId('clue-word')).toHaveText('טבע');

  const clueResult = page.getByTestId('clue-result');
  await clueResult.getByTestId('btn-like').click();
  await expect(clueResult.getByTestId('feedback-sent')).toBeVisible();

  await page.evaluate(() => {
    window.__lastFeedback = undefined;
  });
  await page.getByTestId('btn-use-clue').click();
  await expect(page.getByTestId('btn-use-clue')).toHaveText('הרמז סומן לשימוש');

  await page.getByTestId('btn-lifecycle-0').click();
  await page.getByTestId('btn-lifecycle-1').click();

  await expect(page.getByTestId('tile-0')).toHaveAttribute(
    'data-lifecycle',
    'chosen',
  );
  await expect(page.getByTestId('tile-1')).toHaveAttribute(
    'data-lifecycle',
    'chosen',
  );
  await expect(
    page.getByText('הלוח השתנה — הרמז חושב על לוח ישן'),
  ).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => window.__lastFeedback), { timeout: 8_000 })
    .toMatchObject({
      verdict: 'outcome',
      mode: 'outcome',
      target: 'red',
      clue: 'טבע',
      revealed: [
        { word: fixtureBoard.words[0], chosenBy: 'my' },
        { word: fixtureBoard.words[1], chosenBy: 'my' },
      ],
    });

  const logEntry = page.getByTestId('log-entry-0');
  await expect(logEntry).toContainText('טבע');
  await expect(logEntry).toContainText(fixtureBoard.words[0]);
  await expect(logEntry).toContainText(fixtureBoard.words[1]);

  await expect(page.getByTestId(`map-dot-${fixtureBoard.words[0]}`)).toHaveCount(0);
  await expect(page.getByTestId(`map-dot-${fixtureBoard.words[1]}`)).toHaveCount(0);
});
