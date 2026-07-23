import type { Role } from '../../types/api';

export const ROLE_CYCLE: Role[] = ['red', 'blue', 'neutral', 'assassin'];

export const EMPTY_WORDS = (): string[] => Array.from({ length: 25 }, () => '');
export const EMPTY_CONFIDENCE = (): number[] => Array.from({ length: 25 }, () => 100);
export const EMPTY_ROLES = (): Role[] => Array.from({ length: 25 }, () => 'neutral');

export function roleCounts(roles: Role[]): Record<Role, number> {
  return roles.reduce<Record<Role, number>>(
    (counts, role) => ({ ...counts, [role]: counts[role] + 1 }),
    { red: 0, blue: 0, neutral: 0, assassin: 0 },
  );
}

// A legal Codenames key card is 9/8 for the two teams (either order), 7
// neutrals and exactly 1 assassin.
export function isValidKey(roles: Role[]): boolean {
  const counts = roleCounts(roles);
  const [larger, smaller] = [counts.red, counts.blue].sort((left, right) => right - left);
  return larger === 9 && smaller === 8 && counts.neutral === 7 && counts.assassin === 1;
}

export function nextRole(role: Role): Role {
  const index = ROLE_CYCLE.indexOf(role);
  return ROLE_CYCLE[(index + 1) % ROLE_CYCLE.length];
}

export function normalizedWords(words: string[]): string[] {
  return words.map((word) => word.trim());
}

export function wordsComplete(words: string[]): boolean {
  const normalized = normalizedWords(words);
  return (
    normalized.length === 25 &&
    normalized.every((word) => word.length > 0) &&
    new Set(normalized).size === 25
  );
}
