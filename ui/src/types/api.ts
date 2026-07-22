// CANONICAL — copied verbatim from agents/01-CONTRACTS.md §2. Never edit.
// App is TEAM-AGNOSTIC: Role is the absolute key-card color everywhere in state/UI.
export type Role = 'red' | 'blue' | 'neutral' | 'assassin';
export type TeamColor = 'red' | 'blue';           // a selectable team (clue is always for one)
// WIRE ONLY — used exclusively inside src/api/client.ts when talking to the engine.
export type WireRole = 'my' | 'opp' | 'neutral' | 'assassin';
export type Risk = 'cautious' | 'balanced' | 'bold';
export type Lifecycle = 'inPlay' | 'chosen';

export interface BoardPayload {        // app-space, ABSOLUTE colors (client maps to wire per request target)
  words: string[];
  roles: Record<string, Role>;
}

export interface ReadEntry {
  word: string;
  role: Role;
  sim: number;   // cosine, ~[-1..1]
  conf: number;  // min-max normalized 0..1 — render as 0-100 score
}

export interface AssassinInfo {
  word: string | null;
  rank: number;        // -1 if absent
  sim?: number | null;
}

export interface ClueOption {
  word: string;
  count: number;
  intended: string[];
  score: number;
  reason: string;
  read: ReadEntry[];   // all live words, best-first — the operative-eye ranking
  leak: ReadEntry[];   // non-team words ranking at/above the weakest target
  safe: number;        // team words a guesser reaches before any non-team word
  assassin: AssassinInfo;
  no_clue: boolean;
  risky: boolean;
  note: string;        // Hebrew warning/refusal text ('' if none)
}

export interface SpymasterResponse {
  engine?: string;
  options: ClueOption[];
  picked?: number;
  clue?: string;
  count?: number;
  intended?: string[];
  reason?: string;
  read?: ReadEntry[];
  leak?: ReadEntry[];
  assassin?: AssassinInfo;
  no_clue?: boolean;
  risky?: boolean;
  safe?: number;
  note?: string;
  error?: string;
}

export interface CheckResponse {
  clue: string;
  illegal: boolean;    // board word / shared root — must not be given as a hint
  read: ReadEntry[];
  safe: number;
  first_danger: ReadEntry | null;
  assassin: { word: string | null; rank: number };
}

export interface SpaceResponse {
  coords: Record<string, [number, number]>;
  roles: Record<string, Role>;
  clue: string | null;
  clue_xy: [number, number] | null;
}

export interface DealResponse {
  words: string[];
  roles: Record<string, Role>;
}

export interface RevealedEntry {
  word: string;
  chosenBy: Role;   // absolute color of the team that claimed the card (red|blue|neutral|assassin)
}

// --- Extensions for restored features (vocab-mode dial + guesser/operative mode). ---
// Additive and wire-compatible; the canonical types above are unchanged.
export type VocabMode = 'conservative' | 'broad' | 'experimental' | 'curated';

export interface OperativeRankEntry {
  word: string;
  sim: number;   // cosine, ~[-1..1]
  conf: number;  // 0..1 — render as 0-100
  rank: number;
}

export interface OperativeResponse {
  engine?: string;
  clue: string;
  count: number;
  ranking: OperativeRankEntry[];  // every board word, best guess first (roles hidden)
  picks: string[];                // top `count` words — the recommended guess order
  geo_order?: string[];
  agreement: number | null;       // how many of the top picks a 2nd opinion agrees on
  agree_with: string | null;
  error?: string;
}

export interface FeedbackPayload {
  uid: string;                       // random id persisted in localStorage 'cn-uid'
  verdict: 'up' | 'down' | 'outcome';
  comment?: string;
  mode: 'suggest' | 'check' | 'outcome';
  target: TeamColor;                 // which team the clue was for — client uses it to wire-map board.roles + revealed.chosenBy
  risk?: Risk;
  why?: string;                      // structured 👎 tag: opposite|vague|wrong|risky|overreach
  clue: string;
  count?: number;
  intended?: string[];
  focus?: string[];
  board: BoardPayload;               // FULL board (all 25), not just live words
  revealed?: RevealedEntry[];
  option?: ClueOption | null;
}
