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
