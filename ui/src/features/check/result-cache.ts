import type { ReadEntry } from '../../types/api';

const checkedReads = new Map<string, ReadEntry[]>();

export function rememberCheckResult(clue: string, read: ReadEntry[]): void {
  checkedReads.set(clue, read);
}

export function getRememberedCheckResult(clue: string | null): ReadEntry[] | null {
  if (!clue) return null;
  return checkedReads.get(clue) ?? null;
}
