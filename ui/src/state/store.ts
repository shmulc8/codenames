import { create } from 'zustand';

import type {
  BoardPayload,
  ClueOption,
  Lifecycle,
  RevealedEntry,
  Risk,
  Role,
  SpymasterResponse,
  TeamColor,
} from '../types/api';

export interface TileState {
  word: string;
  role: Role;
  lifecycle: Lifecycle;
  chosenBy?: Role;
}

export interface UsedClue {
  ts: number;
  clue: string;
  count: number;
  intended: string[];
  risk: Risk;
  target: TeamColor;
  option: ClueOption;
  board: BoardPayload;
  revealedAfter: RevealedEntry[];
  outcomeSent: boolean;
}

export interface AppState {
  screen: 'setup' | 'game';
  activeTab: 'clue' | 'check';
  tiles: TileState[];
  selected: string[];
  hoverWord: string | null;
  risk: Risk;
  target: TeamColor;
  checkedClue: string | null;
  clue: {
    current: SpymasterResponse | null;
    optionIndex: number;
    stale: boolean;
    used: UsedClue | null;
  };
  log: UsedClue[];

  setBoard(words: string[], roles: Record<string, Role>): void;
  toggleSelected(word: string): void;
  clearSelected(): void;
  setRisk(risk: Risk): void;
  setTarget(color: TeamColor): void;
  setActiveTab(tab: 'clue' | 'check'): void;
  setCheckedClue(word: string | null): void;
  setHoverWord(word: string | null): void;
  toggleLifecycle(word: string, chosenBy?: Role): void;
  setClueResult(result: SpymasterResponse | null, stale?: boolean): void;
  setOptionIndex(index: number): void;
  useCurrentClue(): void;
  resetGame(): void;
}

type StateValues = Omit<
  AppState,
  | 'setBoard'
  | 'toggleSelected'
  | 'clearSelected'
  | 'setRisk'
  | 'setTarget'
  | 'setActiveTab'
  | 'setCheckedClue'
  | 'setHoverWord'
  | 'toggleLifecycle'
  | 'setClueResult'
  | 'setOptionIndex'
  | 'useCurrentClue'
  | 'resetGame'
>;

const initialValues = (): StateValues => ({
  screen: 'setup',
  activeTab: 'clue',
  tiles: [],
  selected: [],
  hoverWord: null,
  risk: 'balanced',
  target: 'red',
  checkedClue: null,
  clue: {
    current: null,
    optionIndex: 0,
    stale: false,
    used: null,
  },
  log: [],
});

function showSelectionError(): void {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(
    new CustomEvent('cn:toast', {
      detail: { message: 'אפשר לבחור רק קלפים בצבע אחד' },
    }),
  );
}

export const fullBoard = (state: AppState): BoardPayload => ({
  words: state.tiles.map((tile) => tile.word),
  roles: Object.fromEntries(state.tiles.map((tile) => [tile.word, tile.role])),
});

export const liveBoard = (state: AppState): BoardPayload => {
  const liveTiles = state.tiles.filter((tile) => tile.lifecycle === 'inPlay');

  return {
    words: liveTiles.map((tile) => tile.word),
    roles: Object.fromEntries(liveTiles.map((tile) => [tile.word, tile.role])),
  };
};

export const boardsMatch = (
  left: BoardPayload,
  right: BoardPayload,
): boolean =>
  left.words.length === right.words.length &&
  left.words.every(
    (word, index) =>
      word === right.words[index] && left.roles[word] === right.roles[word],
  );

export const selectedColor = (state: AppState): TeamColor | null => {
  if (state.selected.length === 0) return null;

  const role = state.tiles.find((tile) => tile.word === state.selected[0])?.role;
  return role === 'red' || role === 'blue' ? role : null;
};

export const useAppStore = create<AppState>((set, get) => ({
  ...initialValues(),

  setBoard: (words, roles) => {
    set({
      screen: 'game',
      tiles: words.map((word) => ({
        word,
        role: roles[word] ?? 'neutral',
        lifecycle: 'inPlay',
      })),
      selected: [],
      hoverWord: null,
      checkedClue: null,
      clue: {
        current: null,
        optionIndex: 0,
        stale: false,
        used: null,
      },
      log: [],
    });
  },

  toggleSelected: (word) => {
    const state = get();
    const tile = state.tiles.find((candidate) => candidate.word === word);
    if (!tile || tile.lifecycle !== 'inPlay') return;
    if (tile.role !== 'red' && tile.role !== 'blue') return;

    if (state.selected.includes(word)) {
      set({ selected: state.selected.filter((selectedWord) => selectedWord !== word) });
      return;
    }

    const color = selectedColor(state);
    if (color !== null && color !== tile.role) {
      showSelectionError();
      return;
    }

    set({
      selected: [...state.selected, word],
      target: state.selected.length === 0 ? tile.role : state.target,
    });
  },

  clearSelected: () => set({ selected: [] }),
  setRisk: (risk) => set({ risk }),
  setTarget: (target) => set({ target, selected: [] }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setCheckedClue: (checkedClue) => set({ checkedClue }),
  setHoverWord: (hoverWord) => set({ hoverWord }),

  toggleLifecycle: (word, requestedChosenBy) => {
    const state = get();
    const tile = state.tiles.find((candidate) => candidate.word === word);
    if (!tile) return;

    const isBeingChosen = tile.lifecycle === 'inPlay';
    const chosenBy = requestedChosenBy ?? tile.role;
    let used = state.clue.used;
    let log = state.log;

    if (used) {
      const revealedAfter = isBeingChosen
        ? used.revealedAfter.some((reveal) => reveal.word === word)
          ? used.revealedAfter
          : [...used.revealedAfter, { word, chosenBy }]
        : used.revealedAfter.filter((reveal) => reveal.word !== word);

      used = {
        ...used,
        revealedAfter,
      };
      log = log.map((entry) => (entry.ts === used?.ts ? used : entry));
    }

    set({
      tiles: state.tiles.map((candidate) =>
        candidate.word === word
          ? isBeingChosen
            ? { ...candidate, lifecycle: 'chosen', chosenBy }
            : { word: candidate.word, role: candidate.role, lifecycle: 'inPlay' }
          : candidate,
      ),
      selected: isBeingChosen
        ? state.selected.filter((selectedWord) => selectedWord !== word)
        : state.selected,
      clue: { ...state.clue, stale: true, used },
      log,
    });
  },

  setClueResult: (current, stale = false) =>
    set((state) => ({
      clue: { ...state.clue, current, optionIndex: 0, stale },
    })),

  setOptionIndex: (optionIndex) =>
    set((state) => ({ clue: { ...state.clue, optionIndex } })),

  useCurrentClue: () => {
    const state = get();
    const option = state.clue.current?.options[state.clue.optionIndex];
    if (!option) return;

    const used: UsedClue = {
      ts: Date.now(),
      clue: option.word,
      count: option.count,
      intended: [...option.intended],
      risk: state.risk,
      target: state.target,
      option,
      board: fullBoard(state),
      revealedAfter: [],
      outcomeSent: false,
    };

    set({
      clue: { ...state.clue, used },
      log: [...state.log, used],
    });
  },

  resetGame: () => set(initialValues()),
}));

declare global {
  interface Window {
    __store?: typeof useAppStore;
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  window.__store = useAppStore;
}
