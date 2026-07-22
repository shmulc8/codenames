import { expect, test, type Page } from '@playwright/test';

import { fixtureBoard } from '../../src/mocks/fixtures/board';

// The mode switch is the one piece of NEW state logic the operative feature adds to the
// store, and it is asymmetric: entering `operative` scrubs every spymaster-only derived
// value (so a stale selection / checked word / hover link can't leak a hidden role), while
// leaving it is a deliberate no-op. These assertions pin that reducer directly through the
// dev store hook — the same seam installBoard() uses — so the contract is verified without
// depending on how any panel happens to render it.

// A recognizable, type-valid clue result. `setMode` should keep `current` (and the rest of
// the clue slice) intact and only rewind `optionIndex`, so a marker on `current` proves it
// survived the switch.
const SEEDED_CLUE = {
  current: { engine: 'seed-sentinel', options: [] },
  optionIndex: 2,
  stale: true,
  used: null,
};

async function seedSpymasterState(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(
    ({ board, clue }) => {
      const store = window.__store;
      if (!store) throw new Error('The dev store hook was not installed');
      const { setBoard, toggleSelected, setHoverWord, setCheckedClue, setActiveTab } =
        store.getState();

      setBoard(board.words, board.roles);
      // words[0] and words[1] are both red in the fixture — a valid same-color pair.
      toggleSelected(board.words[0]);
      toggleSelected(board.words[1]);
      setHoverWord(board.words[2]);
      setCheckedClue(board.words[4]);
      setActiveTab('check');
      store.setState({ clue: clue });
    },
    { board: fixtureBoard, clue: SEEDED_CLUE },
  );
}

test.describe('operative mode — store reducer', () => {
  test('entering operative scrubs spymaster-only state but preserves the clue result', async ({
    page,
  }) => {
    await seedSpymasterState(page);

    const snapshot = await page.evaluate(() => {
      const store = window.__store;
      if (!store) throw new Error('The dev store hook was not installed');
      const before = store.getState().selected.length;
      store.getState().setMode('operative');
      const after = store.getState();
      return {
        selectedBefore: before,
        mode: after.mode,
        selected: after.selected,
        hoverWord: after.hoverWord,
        checkedClue: after.checkedClue,
        activeTab: after.activeTab,
        optionIndex: after.clue.optionIndex,
        clueEngine: after.clue.current?.engine ?? null,
        clueStale: after.clue.stale,
      };
    });

    // Guard: the pre-state really did hold spymaster-only values, so the clears below mean something.
    expect(snapshot.selectedBefore).toBe(2);

    expect(snapshot.mode).toBe('operative');
    expect(snapshot.selected).toEqual([]);
    expect(snapshot.hoverWord).toBeNull();
    expect(snapshot.checkedClue).toBeNull();
    expect(snapshot.activeTab).toBe('clue');
    // The clue result itself is kept (so returning to spymaster restores it) — only the
    // carousel position rewinds to the first option.
    expect(snapshot.optionIndex).toBe(0);
    expect(snapshot.clueEngine).toBe('seed-sentinel');
    expect(snapshot.clueStale).toBe(true);
  });

  test('leaving operative is a no-op that preserves in-progress spymaster state', async ({
    page,
  }) => {
    await seedSpymasterState(page);

    const snapshot = await page.evaluate(() => {
      const store = window.__store;
      if (!store) throw new Error('The dev store hook was not installed');
      store.getState().setMode('spymaster');
      const after = store.getState();
      return {
        mode: after.mode,
        selected: after.selected,
        hoverWord: after.hoverWord,
        checkedClue: after.checkedClue,
        activeTab: after.activeTab,
        optionIndex: after.clue.optionIndex,
        clueEngine: after.clue.current?.engine ?? null,
      };
    });

    expect(snapshot.mode).toBe('spymaster');
    expect(snapshot.selected).toEqual([fixtureBoard.words[0], fixtureBoard.words[1]]);
    expect(snapshot.hoverWord).toBe(fixtureBoard.words[2]);
    expect(snapshot.checkedClue).toBe(fixtureBoard.words[4]);
    expect(snapshot.activeTab).toBe('check');
    expect(snapshot.optionIndex).toBe(2);
    expect(snapshot.clueEngine).toBe('seed-sentinel');
  });

  test('the scrub does not reverse when switching back to spymaster', async ({ page }) => {
    await seedSpymasterState(page);

    const snapshot = await page.evaluate(() => {
      const store = window.__store;
      if (!store) throw new Error('The dev store hook was not installed');
      store.getState().setMode('operative');
      store.getState().setMode('spymaster');
      const after = store.getState();
      return {
        mode: after.mode,
        selected: after.selected,
        checkedClue: after.checkedClue,
        hoverWord: after.hoverWord,
      };
    });

    // Round-tripping keeps the values cleared: nothing secretly restores a spymaster selection.
    expect(snapshot.mode).toBe('spymaster');
    expect(snapshot.selected).toEqual([]);
    expect(snapshot.checkedClue).toBeNull();
    expect(snapshot.hoverWord).toBeNull();
  });
});
