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
  VocabMode,
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
  mode: 'spymaster' | 'operative';
  activeTab: 'clue' | 'check';
  tiles: TileState[];
  selected: string[];
  hoverWord: string | null;
  risk: Risk;
  vocabMode: VocabMode;
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
  selectSuggested(words: string[], target: TeamColor): void;
  clearSelected(): void;
  setRisk(risk: Risk): void;
  setVocabMode(mode: VocabMode): void;
  setMode(mode: 'spymaster' | 'operative'): void;
  setTarget(color: TeamColor): void;
  setActiveTab(tab: 'clue' | 'check'): void;
  setCheckedClue(word: string | null): void;
  setHoverWord(word: string | null): void;
  toggleLifecycle(word: string, chosenBy?: Role): void;
  setClueResult(result: SpymasterResponse | null, stale?: boolean): void;
  setOptionIndex(index: number): void;
  useCurrentClue(): void;
  editBoard(): void;
  resetGame(): void;
}

type StateValues = Omit<
  AppState,
  | 'setBoard'
  | 'toggleSelected'
  | 'selectSuggested'
  | 'clearSelected'
  | 'setRisk'
  | 'setVocabMode'
  | 'setMode'
  | 'setTarget'
  | 'setActiveTab'
  | 'setCheckedClue'
  | 'setHoverWord'
  | 'toggleLifecycle'
  | 'setClueResult'
  | 'setOptionIndex'
  | 'useCurrentClue'
  | 'editBoard'
  | 'resetGame'
>;

const initialValues = (): StateValues => ({
  screen: 'setup',
  mode: 'spymaster',
  activeTab: 'clue',
  tiles: [],
  selected: [],
  hoverWord: null,
  risk: 'balanced',
  vocabMode: 'curated',
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

    // Picking the first card of the other team implicitly flips the target; that must
    // invalidate any on-screen clue (it was generated for the previous team).
    const flips = state.selected.length === 0 && tile.role !== state.target;
    set({
      selected: [...state.selected, word],
      target: flips ? tile.role : state.target,
      ...(flips
        ? {
            checkedClue: null,
            clue: { ...state.clue, current: null, optionIndex: 0, stale: false },
          }
        : {}),
    });
  },

  // Accept only live cards of the requested team. The engine response is external input,
  // so it must not be able to mark an opponent, neutral card, or an old card as selected.
  selectSuggested: (words, target) => {
    const state = get();
    const selectable = new Set(
      state.tiles
        .filter((tile) => tile.lifecycle === 'inPlay' && tile.role === target)
        .map((tile) => tile.word),
    );
    const selected = [...new Set(words)].filter((word) => selectable.has(word));

    set({ selected, target });
  },

  clearSelected: () => set({ selected: [] }),
  setRisk: (risk) => set({ risk }),
  setVocabMode: (vocabMode) => set({ vocabMode }),
  setMode: (mode) => set({ mode }),
  // Changing the team invalidates any clue on screen: it was generated for the old team,
  // so keeping it would mislabel the session log / feedback (see the cross-tab target bug).
  setTarget: (target) =>
    set((state) => ({
      target,
      selected: [],
      checkedClue: null,
      clue: { ...state.clue, current: null, optionIndex: 0, stale: false },
    })),
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
    set((state) => {
      const picked = current?.picked ?? 0;
      const optionIndex =
        current && picked >= 0 && picked < current.options.length ? picked : 0;

      return { clue: { ...state.clue, current, optionIndex, stale } };
    }),

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
      // Seed with cards already marked revealed so the natural reveal-then-mark-used
      // order still attributes the outcome (otherwise pre-heart reveals are lost).
      revealedAfter: state.tiles
        .filter((tile) => tile.lifecycle === 'chosen')
        .map((tile) => ({ word: tile.word, chosenBy: tile.chosenBy ?? tile.role })),
      outcomeSent: false,
    };

    set({
      clue: { ...state.clue, used },
      log: [...state.log, used],
    });
  },

  // Return to the setup screen for an in-game correction WITHOUT wiping the board — PhotoSetup
  // pre-fills its fields from the current tiles so a misread word/role can be fixed.
  editBoard: () => set({ screen: 'setup' }),

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
