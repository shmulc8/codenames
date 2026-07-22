import type { Role } from '../../types/api';

export const BOARD_COLUMNS = 5;
export const CARD_WIDTH = 140;
export const CARD_HEIGHT = 92;
export const CARD_GAP = 10;
export const BOARD_PADDING = 12;
export const BOARD_WIDTH =
  BOARD_PADDING * 2 + BOARD_COLUMNS * CARD_WIDTH + (BOARD_COLUMNS - 1) * CARD_GAP;
export const BOARD_HEIGHT =
  BOARD_PADDING * 2 + BOARD_COLUMNS * CARD_HEIGHT + (BOARD_COLUMNS - 1) * CARD_GAP;

export const roleLabel: Record<Role, string> = {
  red: 'אדום',
  blue: 'כחול',
  neutral: 'ניטרלי',
  assassin: 'מתנקש',
};

export const roles: Role[] = ['red', 'blue', 'neutral', 'assassin'];
