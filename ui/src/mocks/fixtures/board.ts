import type { BoardPayload, Role } from '../../types/api';

export const fixtureWords = [
  'אריה',
  'ירח',
  'ספר',
  'גשר',
  'מלך',
  'יער',
  'רכבת',
  'כוכב',
  'דבש',
  'ים',
  'מפתח',
  'הר',
  'רופא',
  'מגדל',
  'סוס',
  'שלג',
  'נשר',
  'כדור',
  'חלון',
  'ענן',
  'שעון',
  'לחם',
  'כיסא',
  'זהב',
  'נחש',
] as const;

const roleSequence: Role[] = [
  'red',
  'red',
  'red',
  'red',
  'red',
  'red',
  'red',
  'red',
  'red',
  'blue',
  'blue',
  'blue',
  'blue',
  'blue',
  'blue',
  'blue',
  'blue',
  'neutral',
  'neutral',
  'neutral',
  'neutral',
  'neutral',
  'neutral',
  'neutral',
  'assassin',
];

export const fixtureRoles: Record<string, Role> = Object.fromEntries(
  fixtureWords.map((word, index) => [word, roleSequence[index]]),
);

export const fixtureBoard: BoardPayload = {
  words: [...fixtureWords],
  roles: fixtureRoles,
};

// Upper-case aliases make the shared fixture convenient in both application and test code.
export const FIXTURE_WORDS = fixtureWords;
export const FIXTURE_ROLES = fixtureRoles;
export const FIXTURE_BOARD = fixtureBoard;

