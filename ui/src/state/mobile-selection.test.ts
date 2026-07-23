import { describe, expect, it } from 'vitest';

import { mobileClueFocusTeam, useAppStore, type TileState } from './store';

const tiles: TileState[] = [
  { word: 'אדום א', role: 'red', lifecycle: 'inPlay' },
  { word: 'אדום ב', role: 'red', lifecycle: 'inPlay' },
  { word: 'כחול א', role: 'blue', lifecycle: 'inPlay' },
  { word: 'כחול ב', role: 'blue', lifecycle: 'inPlay' },
  { word: 'ניטרלי', role: 'neutral', lifecycle: 'inPlay' },
  { word: 'מתנקש', role: 'assassin', lifecycle: 'inPlay' },
  { word: 'נבחר', role: 'red', lifecycle: 'chosen', chosenBy: 'blue' },
];

function selectMobileWords(mobileSelection: string[]) {
  return mobileClueFocusTeam({
    ...useAppStore.getState(),
    tiles,
    mobileSelection,
  });
}

describe('mobileClueFocusTeam', () => {
  it('returns null for an empty mobile selection', () => {
    expect(selectMobileWords([])).toBeNull();
  });

  it('returns red when every selected tile is an in-play red card', () => {
    expect(selectMobileWords(['אדום א', 'אדום ב'])).toBe('red');
  });

  it('returns blue when every selected tile is an in-play blue card', () => {
    expect(selectMobileWords(['כחול א', 'כחול ב'])).toBe('blue');
  });

  it.each([
    { selection: ['אדום א', 'כחול א'], reason: 'mixed teams' },
    { selection: ['אדום א', 'ניטרלי'], reason: 'a neutral card' },
    { selection: ['כחול א', 'מתנקש'], reason: 'the assassin' },
    { selection: ['אדום א', 'נבחר'], reason: 'a chosen card' },
    { selection: ['אדום א', 'לא קיים'], reason: 'an unknown word' },
  ])('returns null when the selection contains $reason', ({ selection }) => {
    expect(selectMobileWords(selection)).toBeNull();
  });
});
