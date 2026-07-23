import { beforeEach, describe, expect, it } from 'vitest';

import { mobileClueFocusTeam, useAppStore } from './store';
import type { ClueOption, Role } from '../types/api';

const words = ['אדום', 'אדום שני', 'כחול', 'ניטרלי', 'מתנקש'];
const roles: Record<string, Role> = {
  אדום: 'red',
  'אדום שני': 'red',
  כחול: 'blue',
  ניטרלי: 'neutral',
  מתנקש: 'assassin',
};

function dealBoard(): void {
  useAppStore.getState().setBoard(words, roles);
}

const clueOption: ClueOption = {
  word: 'קבוצה',
  count: 2,
  intended: ['אדום', 'אדום שני'],
  score: 0.9,
  reason: '',
  read: [],
  leak: [],
  safe: 2,
  assassin: { word: 'מתנקש', rank: 5 },
  no_clue: false,
  risky: false,
  note: '',
};

function startUsedClue(): void {
  useAppStore.getState().setClueResult({ options: [clueOption] });
  useAppStore.getState().useCurrentClue();
}

function primeMobileState(): void {
  useAppStore.getState().toggleMobileSelection('אדום');
  useAppStore.getState().eliminateMobileSelection();
  useAppStore.getState().toggleMobileSelection('כחול');
  useAppStore.getState().openMobileClue();
}

beforeEach(() => {
  useAppStore.getState().resetGame();
  dealBoard();
});

describe('toggleMobileSelection', () => {
  it('adds in-play cards of every role without mutating the prior selection', () => {
    const initialSelection = useAppStore.getState().mobileSelection;

    useAppStore.getState().toggleMobileSelection('אדום');
    useAppStore.getState().toggleMobileSelection('כחול');
    useAppStore.getState().toggleMobileSelection('ניטרלי');
    useAppStore.getState().toggleMobileSelection('מתנקש');

    expect(initialSelection).toEqual([]);
    expect(useAppStore.getState().mobileSelection).toEqual(['אדום', 'כחול', 'ניטרלי', 'מתנקש']);
    expect(useAppStore.getState().mobileSelection).not.toBe(initialSelection);
  });

  it('ignores chosen and unknown cards when adding', () => {
    useAppStore.getState().toggleLifecycle('אדום');

    useAppStore.getState().toggleMobileSelection('אדום');
    useAppStore.getState().toggleMobileSelection('לא קיים');

    expect(useAppStore.getState().mobileSelection).toEqual([]);
  });

  it('always removes an already selected word', () => {
    useAppStore.getState().toggleMobileSelection('אדום');
    useAppStore.setState((state) => ({
      tiles: state.tiles.map((tile) =>
        tile.word === 'אדום' ? { ...tile, lifecycle: 'chosen' as const } : tile,
      ),
    }));

    useAppStore.getState().toggleMobileSelection('אדום');

    expect(useAppStore.getState().mobileSelection).toEqual([]);
  });

  it('clears the entire working selection', () => {
    useAppStore.getState().toggleMobileSelection('אדום');
    useAppStore.getState().toggleMobileSelection('כחול');

    useAppStore.getState().clearMobileSelection();

    expect(useAppStore.getState().mobileSelection).toEqual([]);
  });
});

describe('desktop selection regression guard', () => {
  it('still rejects adding a card from the other team', () => {
    useAppStore.getState().toggleSelected('אדום');
    useAppStore.getState().toggleSelected('כחול');

    expect(useAppStore.getState().selected).toEqual(['אדום']);
  });
});

describe('eliminateMobileSelection', () => {
  it('eliminates the whole batch atomically and updates the used clue log once', () => {
    startUsedClue();
    useAppStore.getState().toggleMobileSelection('אדום');
    useAppStore.getState().toggleMobileSelection('ניטרלי');
    const priorTiles = useAppStore.getState().tiles;
    let notifications = 0;
    const unsubscribe = useAppStore.subscribe(() => {
      notifications += 1;
    });

    useAppStore.getState().eliminateMobileSelection();
    unsubscribe();

    const state = useAppStore.getState();
    expect(notifications).toBe(1);
    expect(priorTiles.find((tile) => tile.word === 'אדום')).toEqual({
      word: 'אדום',
      role: 'red',
      lifecycle: 'inPlay',
    });
    expect(state.tiles.filter((tile) => tile.word === 'אדום' || tile.word === 'ניטרלי')).toEqual([
      { word: 'אדום', role: 'red', lifecycle: 'chosen', chosenBy: 'red' },
      { word: 'ניטרלי', role: 'neutral', lifecycle: 'chosen', chosenBy: 'neutral' },
    ]);
    expect(state.mobileSelection).toEqual([]);
    expect(state.lastElimination).toEqual({
      words: ['אדום', 'ניטרלי'],
      previous: [
        { word: 'אדום', lifecycle: 'inPlay' },
        { word: 'ניטרלי', lifecycle: 'inPlay' },
      ],
    });
    expect(state.clue.stale).toBe(true);
    expect(state.clue.used?.revealedAfter).toEqual([
      { word: 'אדום', chosenBy: 'red' },
      { word: 'ניטרלי', chosenBy: 'neutral' },
    ]);
    expect(state.log).toHaveLength(1);
    expect(state.log[0]).toBe(state.clue.used);
  });

  it('eliminates every selected card even when the batch contains the assassin', () => {
    useAppStore.getState().toggleMobileSelection('אדום');
    useAppStore.getState().toggleMobileSelection('מתנקש');

    useAppStore.getState().eliminateMobileSelection();

    expect(
      useAppStore.getState().tiles.filter((tile) => tile.word === 'אדום' || tile.word === 'מתנקש'),
    ).toEqual([
      { word: 'אדום', role: 'red', lifecycle: 'chosen', chosenBy: 'red' },
      { word: 'מתנקש', role: 'assassin', lifecycle: 'chosen', chosenBy: 'assassin' },
    ]);
    expect(useAppStore.getState().lastElimination?.words).toEqual(['אדום', 'מתנקש']);
  });
});

describe('undoLastElimination', () => {
  it('restores the exact tile pre-state and removes only the batch bookkeeping', () => {
    useAppStore.getState().toggleLifecycle('כחול', 'neutral');
    startUsedClue();
    useAppStore.setState((state) => ({
      tiles: state.tiles.map((tile) =>
        tile.word === 'אדום' ? { ...tile, chosenBy: 'blue' as const } : tile,
      ),
    }));
    const bookkeepingBefore = useAppStore.getState().clue.used?.revealedAfter;
    useAppStore.getState().toggleMobileSelection('אדום');
    useAppStore.getState().toggleMobileSelection('ניטרלי');
    useAppStore.getState().eliminateMobileSelection();

    useAppStore.getState().undoLastElimination();

    const state = useAppStore.getState();
    expect(state.tiles.find((tile) => tile.word === 'אדום')).toEqual({
      word: 'אדום',
      role: 'red',
      lifecycle: 'inPlay',
      chosenBy: 'blue',
    });
    expect(state.tiles.find((tile) => tile.word === 'ניטרלי')).toEqual({
      word: 'ניטרלי',
      role: 'neutral',
      lifecycle: 'inPlay',
    });
    expect(state.clue.used?.revealedAfter).toEqual(bookkeepingBefore);
    expect(state.log).toHaveLength(1);
    expect(state.log[0]).toBe(state.clue.used);
    expect(state.lastElimination).toBeNull();
  });

  it('is a no-op when there is no elimination to undo', () => {
    const before = useAppStore.getState();

    useAppStore.getState().undoLastElimination();

    expect(useAppStore.getState()).toBe(before);
  });
});

describe('mobile clue modal bridge', () => {
  it('copies a valid same-team working set into the existing clue focus', () => {
    useAppStore.getState().toggleMobileSelection('אדום');
    useAppStore.getState().toggleMobileSelection('אדום שני');
    const workingSelection = useAppStore.getState().mobileSelection;

    expect(mobileClueFocusTeam(useAppStore.getState())).toBe('red');
    useAppStore.getState().openMobileClue();

    const state = useAppStore.getState();
    expect(state.selected).toEqual(['אדום', 'אדום שני']);
    expect(state.selected).not.toBe(workingSelection);
    expect(state.target).toBe('red');
    expect(state.clueModalOpen).toBe(true);

    useAppStore.getState().closeMobileClue();
    expect(useAppStore.getState().clueModalOpen).toBe(false);
  });

  it.each([
    { selection: ['אדום', 'כחול'], reason: 'mixed teams' },
    { selection: ['אדום', 'ניטרלי'], reason: 'a neutral card' },
  ])('does nothing for a selection containing $reason', ({ selection }) => {
    useAppStore.getState().toggleSelected('כחול');
    for (const word of selection) useAppStore.getState().toggleMobileSelection(word);
    const before = useAppStore.getState();

    expect(mobileClueFocusTeam(before)).toBeNull();
    useAppStore.getState().openMobileClue();

    expect(useAppStore.getState()).toBe(before);
    expect(useAppStore.getState().selected).toEqual(['כחול']);
    expect(useAppStore.getState().target).toBe('blue');
    expect(useAppStore.getState().clueModalOpen).toBe(false);
  });
});

describe('mobile state resets', () => {
  function expectMobileStateCleared(): void {
    const state = useAppStore.getState();
    expect(state.mobileSelection).toEqual([]);
    expect(state.clueModalOpen).toBe(false);
    expect(state.lastElimination).toBeNull();
  }

  it('clears mobile state when setting a board', () => {
    primeMobileState();

    useAppStore.getState().setBoard(words, roles);

    expectMobileStateCleared();
  });

  it('clears mobile state when resetting the game', () => {
    primeMobileState();

    useAppStore.getState().resetGame();

    expectMobileStateCleared();
  });

  it('clears mobile state when editing the board', () => {
    primeMobileState();

    useAppStore.getState().editBoard();

    expectMobileStateCleared();
  });

  it('clears mobile state when entering operative mode', () => {
    primeMobileState();

    useAppStore.getState().setMode('operative');

    expectMobileStateCleared();
  });

  it('clears mobile state when returning to spymaster mode', () => {
    useAppStore.getState().setMode('operative');
    primeMobileState();

    useAppStore.getState().setMode('spymaster');

    expectMobileStateCleared();
  });
});
