import type { Role, TeamColor } from '../types/api';
import type { TileState } from './store';

export interface MobileElimination {
  words: string[];
  previous: Array<{
    word: string;
    lifecycle: 'inPlay' | 'chosen';
    chosenBy?: Role;
  }>;
}

export function computeClueFocusTeam(tiles: TileState[], selection: string[]): TeamColor | null {
  if (selection.length === 0) return null;

  let team: TeamColor | null = null;

  for (const word of selection) {
    const tile = tiles.find((candidate) => candidate.word === word);
    if (!tile || tile.lifecycle !== 'inPlay' || (tile.role !== 'red' && tile.role !== 'blue')) {
      return null;
    }

    if (team !== null && tile.role !== team) return null;
    team = tile.role;
  }

  return team;
}

// When a selection mixes colors (so `computeClueFocusTeam` is null), the team with strictly
// more in-play cards in the selection — the natural "keep only these" recovery target. Null on
// a tie or when neither team is represented, so the caller keeps the plain disabled state.
export function computeMajorityClueTeam(tiles: TileState[], selection: string[]): TeamColor | null {
  let red = 0;
  let blue = 0;
  for (const word of selection) {
    const tile = tiles.find((candidate) => candidate.word === word);
    if (!tile || tile.lifecycle !== 'inPlay') continue;
    if (tile.role === 'red') red += 1;
    else if (tile.role === 'blue') blue += 1;
  }
  if (red === blue) return null;
  return red > blue ? 'red' : 'blue';
}

export function computeEliminationBatch(
  tiles: TileState[],
  selection: string[],
): MobileElimination | null {
  const seen = new Set<string>();
  const previous: MobileElimination['previous'] = [];

  for (const word of selection) {
    if (seen.has(word)) continue;
    seen.add(word);

    const tile = tiles.find((candidate) => candidate.word === word);
    if (!tile || tile.lifecycle !== 'inPlay') continue;

    previous.push({
      word,
      lifecycle: tile.lifecycle,
      ...(tile.chosenBy === undefined ? {} : { chosenBy: tile.chosenBy }),
    });
  }

  if (previous.length === 0) return null;

  return {
    words: previous.map(({ word }) => word),
    previous,
  };
}
