# CONTRACTS — shared law for all agents

Everything here is fixed. Do not renegotiate mid-build. Requests for changes go in `agents/SYNC-REQUESTS.md`.

## 1. Backend API (already deployed — HTTP only)

Base URL: `https://shmulc-hebrew-codenames-copilot.hf.space`. In dev, Vite proxies `/api/*` there (see §5), so client code always calls relative `/api/...`. The deployed Space is embed-only (geometry engine); never send `engine`/`model` fields.

**Critical convention 1 — live words only: the backend has no concept of "chosen" cards in coach requests. The client sends ONLY live (in-play) words + their roles in every `/api/*` board payload.** Chosen cards are excluded client-side and reported only inside `/api/feedback.revealed`.

**Critical convention 2 — wire roles vs app roles (this is the team-agnostic redesign's load-bearing rule). The app is team-agnostic: its board state stores the REAL key-card colors `red|blue|neutral|assassin` and never a "mine/opponent" abstraction. The deployed engine, however, reasons relative to ONE target team per request — its wire vocabulary is `my|opp|neutral|assassin` (`WireRole`).** Every coach/space/feedback request is _for one team color at a time_, so the API client (`src/api/client.ts`, stepA-1 — the ONLY place this mapping lives) takes a `target: TeamColor` and maps outgoing roles: `target → 'my'`, the other team color → `'opp'`, `neutral/assassin` unchanged; and maps role-bearing responses back to absolute colors with the same `target`. Nothing else in the app ever uses `'my'/'opp'`.

> **stepA-1 must verify the wire vocabulary against a live `/api/deal` at the very start of Phase A.** The `my|opp|neutral|assassin` tokens are inferred from the legacy Space UI's role controls (הצוות שלי/היריב/ניטרלי/מתנקש); if the live JSON uses different tokens, fix ONLY the mapping table in `client.ts` — no other file changes, because the rest of the app is absolute-color and mapping is isolated.

| Endpoint               | Method | Request body (wire)                                                                                                                                                                    | Response                                                                                                                                                                         |
| ---------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/health`          | GET    | —                                                                                                                                                                                      | `{ok, models, encoders, geo}`                                                                                                                                                    |
| `/api/deal`            | GET    | —                                                                                                                                                                                      | `{words: string[25], roles: {[word]: WireRole}}` (dev helper: random board; client maps `my→red, opp→blue` on ingest)                                                            |
| `/api/coach/spymaster` | POST   | `{words, roles, focus?: string[], risk?: Risk}` — roles already wire-mapped for the requested `target`; `focus` omitted/empty ⇒ engine auto-picks the best cluster of the target color | `SpymasterResponse` (top-level fields mirror `options[picked]`; role-bearing fields wire → client maps to absolute). May be `{error, no_clue: true, options: []}` with HTTP 200. |
| `/api/coach/check`     | POST   | `{words, roles, clue: string}` — roles wire-mapped for `target`                                                                                                                        | `CheckResponse`                                                                                                                                                                  |
| `/api/space`           | POST   | `{words, roles, clue?: string, whiten?: boolean}` — roles wire-mapped for `target`                                                                                                     | `{coords: {[word]: [x,y]}, roles, clue, clue_xy}` — coords normalized to [-1,1]; `roles` wire → client maps back to absolute                                                     |
| `/api/feedback`        | POST   | `FeedbackPayload` (its `board.roles` + `revealed[].chosenBy` wire-mapped for the clue's `target`)                                                                                      | `{ok: true}` — never fails                                                                                                                                                       |

`/api/coach/operative` exists but is **not used** (guesser mode is out of scope).

Errors: server returns JSON `{error: "..."}` (Hebrew) with 4xx/500. API client must surface these as a typed `ApiError` and the UI must show a toast — never a hang.

## 2. `src/types/api.ts` — copy VERBATIM (both stepA agents create it, identical bytes)

```ts
// CANONICAL — copied verbatim from agents/01-CONTRACTS.md §2. Never edit.
// App is TEAM-AGNOSTIC: Role is the absolute key-card color everywhere in state/UI.
export type Role = 'red' | 'blue' | 'neutral' | 'assassin';
export type TeamColor = 'red' | 'blue'; // a selectable team (clue is always for one)
// WIRE ONLY — used exclusively inside src/api/client.ts when talking to the engine.
export type WireRole = 'my' | 'opp' | 'neutral' | 'assassin';
export type Risk = 'cautious' | 'balanced' | 'bold';
export type Lifecycle = 'inPlay' | 'chosen';

export interface BoardPayload {
  // app-space, ABSOLUTE colors (client maps to wire per request target)
  words: string[];
  roles: Record<string, Role>;
}

export interface ReadEntry {
  word: string;
  role: Role;
  sim: number; // cosine, ~[-1..1]
  conf: number; // min-max normalized 0..1 — render as 0-100 score
}

export interface AssassinInfo {
  word: string | null;
  rank: number; // -1 if absent
  sim?: number | null;
}

export interface ClueOption {
  word: string;
  count: number;
  intended: string[];
  score: number;
  reason: string;
  read: ReadEntry[]; // all live words, best-first — the operative-eye ranking
  leak: ReadEntry[]; // non-team words ranking at/above the weakest target
  safe: number; // team words a guesser reaches before any non-team word
  assassin: AssassinInfo;
  no_clue: boolean;
  risky: boolean;
  note: string; // Hebrew warning/refusal text ('' if none)
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
  illegal: boolean; // board word / shared root — must not be given as a hint
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
  chosenBy: Role; // absolute color of the team that claimed the card (red|blue|neutral|assassin)
}

export interface FeedbackPayload {
  uid: string; // random id persisted in localStorage 'cn-uid'
  verdict: 'up' | 'down' | 'outcome';
  comment?: string;
  mode: 'suggest' | 'check' | 'outcome';
  target: TeamColor; // which team the clue was for — client uses it to wire-map board.roles + revealed.chosenBy
  risk?: Risk;
  why?: string; // structured 👎 tag: opposite|vague|wrong|risky|overreach
  clue: string;
  count?: number;
  intended?: string[];
  focus?: string[];
  board: BoardPayload; // FULL board (all 25), not just live words
  revealed?: RevealedEntry[];
  option?: ClueOption | null;
}
```

## 3. Zustand store — `src/state/store.ts` (implemented by stepA-2; stepB agents consume, and may add fields ONLY inside their designated slice file)

```ts
export interface TileState {
  word: string;
  role: Role;             // absolute key-card color red|blue|neutral|assassin
  lifecycle: Lifecycle;
  chosenBy?: Role;
}

export interface UsedClue {
  ts: number;
  clue: string;
  count: number;
  intended: string[];
  risk: Risk;
  target: TeamColor;            // team the clue was for — flows into outcome feedback + log
  option: ClueOption;
  board: BoardPayload;          // full-board snapshot at time of clue
  revealedAfter: RevealedEntry[]; // cards chosen after this clue, before the next
  outcomeSent: boolean;
}

// Initial values: screen 'setup', activeTab 'clue', tiles [], selected [], hoverWord null,
// risk 'balanced', target 'red', checkedClue null, clue {current:null, optionIndex:0, stale:false, used:null}, log [].
export interface AppState {
  screen: 'setup' | 'game';
  activeTab: 'clue' | 'check';  // which panel is active (drives what the map shows)
  tiles: TileState[];           // 25 once setup completes
  selected: string[];           // focus words for clue generation — MUST all share one color (the target)
  hoverWord: string | null;     // shared board↔map highlight
  risk: Risk;
  target: TeamColor;            // which team the current clue/check/map is FOR (red|blue). NO "mine": team-agnostic.
                                // Auto-set to a selected word's color; the target control switches it when selection is empty.
  checkedClue: string | null;   // last word tested in check-mode
  clue: {
    current: SpymasterResponse | null;
    optionIndex: number;
    stale: boolean;             // board changed since this clue was fetched
    used: UsedClue | null;      // the clue the user declared "I'm using this"
  };
  log: UsedClue[];

  // actions (stepA-2 implements all of these)
  setBoard(words: string[], roles: Record<string, Role>): void; // → screen 'game', all inPlay
  toggleSelected(word: string): void;   // only red|blue tiles; a word whose color ≠ current selection's color is
                                        // rejected (Toast "אפשר לבחור רק קלפים בצבע אחד") unless selection is empty,
                                        // in which case it sets target to that word's color. Empties → target unchanged.
  clearSelected(): void;
  setRisk(r: Risk): void;
  setTarget(c: TeamColor): void;        // switching target CLEARS selection (a cluster can't span colors)
  setActiveTab(t: 'clue' | 'check'): void;
  setCheckedClue(w: string | null): void;
  setHoverWord(w: string | null): void;
  toggleLifecycle(word: string, chosenBy?: Role): void; // inPlay↔chosen; marks clue.stale=true; appends to clue.used.revealedAfter when a used clue is active
  setClueResult(r: SpymasterResponse | null): void;     // resets optionIndex=0, stale=false
  setOptionIndex(i: number): void;
  useCurrentClue(): void;       // snapshots current option (+ target) → clue.used + push to log
  resetGame(): void;
}

// Selectors (exported from store.ts):
export const liveBoard = (s: AppState): BoardPayload => ({
  words: s.tiles.filter(t => t.lifecycle === 'inPlay').map(t => t.word),
  roles: Object.fromEntries(s.tiles.filter(t => t.lifecycle === 'inPlay').map(t => [t.word, t.role])),
});
export const fullBoard = (s: AppState): BoardPayload => /* all 25 */;
// selectedColor: the shared color of the current selection, or null when empty.
export const selectedColor = (s: AppState): TeamColor | null =>
  s.selected.length ? (s.tiles.find(t => t.word === s.selected[0])!.role as TeamColor) : null;
```

> **UsedClue must also carry `target: TeamColor`** (append it to the `UsedClue` interface above) so outcome-feedback and the log know which team the clue was for. `useCurrentClue` records `s.target`.

## 4. File ownership matrix (create/edit ONLY inside what you own)

| Path                                                                                                   | Owner                                                                                             |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `package.json`, lockfile, `vite.config.ts`, `tsconfig*.json`, `index.html`, `.gitignore`               | **stepA-1**                                                                                       |
| `src/main.tsx`, `src/App.tsx`, `src/screens/**`                                                        | **stepA-1**                                                                                       |
| `src/api/**` (typed client, one function per endpoint, `ApiError`)                                     | **stepA-1**                                                                                       |
| `src/types/api.ts`                                                                                     | verbatim §2 — created by both A agents, edited by nobody                                          |
| `src/state/**`                                                                                         | **stepA-2** (stepB agents: only your own `src/state/slices/<feature>.ts` if you need extra state) |
| `src/theme/**`, `src/components/**` (Button, Panel, Toast, Tooltip, RoleIcon)                          | **stepA-2**                                                                                       |
| `src/mocks/**` (MSW handlers + fixtures)                                                               | **stepA-2** (stepB agents may APPEND new fixture files `src/mocks/fixtures/<feature>-*.ts` only)  |
| `playwright.config.ts`, `tests/support/**`, `tests/e2e/smoke.spec.ts`                                  | **stepA-2**                                                                                       |
| `src/features/board/**`, `src/features/photo/**`, `tests/e2e/board.spec.ts`, `tests/e2e/photo.spec.ts` | **stepB-1** (+ its tester)                                                                        |
| `src/features/clue/**`, `tests/e2e/clue.spec.ts`                                                       | **stepB-2** (+ its tester)                                                                        |
| `src/features/check/**`, `src/features/map/**`, `tests/e2e/check.spec.ts`, `tests/e2e/map.spec.ts`     | **stepB-3** (+ its tester)                                                                        |
| `src/features/feedback/**`, `src/features/log/**`, `tests/e2e/feedback.spec.ts`                        | **stepB-4** (+ its tester)                                                                        |
| `agents/SYNC-REQUESTS.md`                                                                              | append-only, everyone (union-merged via `.gitattributes` — appends never conflict)                |
| `tests/support/<feature>.ts` (e.g. `tests/support/clue.ts`)                                            | that feature's tester — never edit `tests/support/helpers.ts` (stepA-2's)                         |

**Phase C (mobile) ownership — additive, desktop-safe.** stepC agents create only NEW files under `src/mobile/**` and their own specs; they do NOT edit any desktop feature file, the store, or the API client. Two integration points are allowed and go through `SYNC-REQUESTS.md` (integrator applies at merge, guarded by the desktop suite staying green): (a) a single delegation line in `src/screens/MainScreen.tsx` that renders `<MobileShell/>` when the responsive `useLayout()` hook reports mobile, else the existing desktop layout; (b) `export`-only additions to reuse stepB utilities (OCR/classify from photo, `CluePanel`, `SemanticMap`) without changing their behavior.

| Path                                                        | Owner                  |
| ----------------------------------------------------------- | ---------------------- |
| `src/mobile/shell/**`, `tests/e2e/mobile-shell.spec.ts`     | **stepC-1** (+ tester) |
| `src/mobile/board/**`, `tests/e2e/mobile-board.spec.ts`     | **stepC-2** (+ tester) |
| `src/mobile/capture/**`, `tests/e2e/mobile-capture.spec.ts` | **stepC-3** (+ tester) |
| `src/mobile/panels/**`, `tests/e2e/mobile-panels.spec.ts`   | **stepC-4** (+ tester) |

**Lockfile rule**: stepB/stepC agents run `npm install` but must NOT commit lockfile/package.json changes (`git checkout -- package-lock.json` before committing if npm rewrote it). Only stepA-1 ever commits dependency files. stepC needs no new runtime deps — pan/zoom + gestures are hand-rolled (Pointer Events), no library.

stepA-1 creates each `src/features/<name>/index.tsx` as a stub exporting a placeholder component with the correct name and props (§6). stepB agents replace their stub's internals; the stub's exported name/props are frozen.

## 5. Build & config conventions

- Vite + React 18 + TypeScript strict. npm (not pnpm/yarn).
- `vite.config.ts` dev proxy: `'/api': { target: 'https://shmulc-hebrew-codenames-copilot.hf.space', changeOrigin: true, secure: true }`.
- Env: `VITE_USE_MOCKS` — when `'1'`, `src/main.tsx` starts the MSW worker before render. All Playwright runs use mocks. `VITE_API_BASE` (default `''`) prefixes API calls for prod builds.
- Scripts in package.json: `dev`, `build`, `preview`, `typecheck` (`tsc --noEmit`), `test:e2e` (`playwright test`), `dev:mock` (`VITE_USE_MOCKS=1 vite`).
- **Ports**: parallel worktrees must not collide. `playwright.config.ts` reads `const port = Number(process.env.PW_PORT ?? 5173)` and uses it for both `baseURL` and `webServer.command` (`npm run dev:mock -- --port ${port} --strictPort`), `reuseExistingServer: false`. Each agent's assigned `PW_PORT` is in `00-orchestration.md`; export it before every dev/test run.
- Dependencies (stepA-1 installs ALL of these up front; nobody else touches package.json): `react`, `react-dom`, `zustand`, `tesseract.js`; dev: `typescript`, `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom`, `@playwright/test`, `msw`.
- UI language: Hebrew, `dir="rtl"` on `<html>`. Styling: **two base stylesheets, both copied into `src/theme/` by stepA-2 and imported globally** — `agents/design/nocturne-tokens.css` (the design-system base: `.btn/.seg/.card/.tag/.dialog/.input/.table/.elev-*` classes — use them, don't reinvent) **and** `agents/design/tokens.css` (the app `--cn-*` tokens: role colors, cream card, semantic map, dark chrome). Plus feature CSS files — **no Tailwind/UI framework**. Fonts: load **Noto Sans Hebrew** first in the body stack (`"Noto Sans Hebrew","Inter",system-ui`). Visual language: `agents/design/DESIGN.md` — read it before building any visible UI.
- **Team-agnostic role colors (locked design decision — see DESIGN.md §1, §4 and `tokens.css` `--cn-*`): tiles carry the REAL key-card color directly — `red|blue|neutral|assassin` — there is NO "mine/opponent" and NO `myColor`.** Each role renders from its own `--cn-<role>-*` ramp: red `--cn-red-*`, blue `--cn-blue-*`, neutral cream `--cn-neutral-*`, assassin `--cn-assassin-*`. Non-color redundancy is mandatory (WCAG 1.4.1): shapes **red ◆ · blue ● · neutral − · assassin ☠** via `RoleIcon` (stepA-2, driven by `tokens.css` `--cn-*-shape`); every color-coded element includes it. `store.target` (`red|blue`) selects which team a clue/check/map request is _for_ — it never recolors the board.

## 6. Frozen component interfaces (stubs by stepA-1)

```ts
// src/features/photo/index.tsx
export function PhotoSetup(): JSX.Element; // full setup flow; calls store.setBoard() when confirmed.
// Team-agnostic: does NOT ask "which color do you play".
// src/features/board/index.tsx
export function BoardGrid(): JSX.Element; // reads store; renders 25 tiles by absolute color
// src/features/clue/index.tsx
export function CluePanel(): JSX.Element;
// src/features/check/index.tsx
export function CheckPanel(): JSX.Element;
// src/features/map/index.tsx — prop-less: reads the store itself.
// activeTab==='clue' → clue = clue.current?.options[optionIndex]?.word, targets = that option's intended.
// activeTab==='check' → clue = checkedClue, targets = [].
// Requests /api/space for store.target; dots colored by each word's ABSOLUTE role.
export function SemanticMap(): JSX.Element;
// src/features/feedback/index.tsx
export function FeedbackControls(props: {
  option: ClueOption;
  mode: 'suggest' | 'check';
  risk: Risk;
}): JSX.Element;
// src/features/log/index.tsx
export function SessionLog(): JSX.Element;
```

`src/screens/MainScreen.tsx` (stepA-1) composes them: `screen==='setup'` → `PhotoSetup`; else board center, tabs `קבל רמז`/`בדוק מילה` (bound to `store.activeTab`) switching CluePanel/CheckPanel, prop-less SemanticMap below, SessionLog collapsible side panel (always rendered in game screen). MainScreen passes no props — everything reads the store.

## 7. Canonical data-testids (tests may rely ONLY on these + visible text)

Setup/photo: `setup-screen`, `photo-input-board`, `photo-input-key`, `ocr-grid`, `ocr-cell-{0..24}`, `key-grid`, `key-cell-{0..24}`, `btn-confirm-board`, `btn-skip-demo` (loads `/api/deal` board — demo/dev path).
Board: `board-grid`, `tile-{0..24}`, tile attrs: `data-word`, `data-role` (`red|blue|neutral|assassin`), `data-lifecycle`; `btn-lifecycle-{0..24}` (mark/unmark chosen), `chip-chosenby-{0..24}` (claiming-team chip on chosen tiles), `btn-reset-game`.
Clue: `tab-clue`, `tab-check`, `target-color`, `target-red`, `target-blue` (which team this clue is for — segmented control bound to `store.target`), `risk-dial`, `risk-{cautious|balanced|bold}`, `btn-get-clue`, `btn-auto-cluster`, `clue-result`, `clue-word`, `clue-count`, `clue-reason`, `warning-banner`, `no-clue-state`, `btn-next-option`, `btn-prev-option`, `option-counter`, `btn-use-clue`.
Check: `check-input`, `btn-check`, `check-result`, `check-illegal`, `check-ranked-list`, `ranked-row-{word}`, `sim-score-{word}`.
Map: `semantic-map`, `map-dot-{word}`, `map-hint-node`, `map-danger-{word}`, `map-legend`.
Feedback/log: `btn-like`, `btn-dislike`, `feedback-why`, `feedback-comment`, `feedback-sent`, `session-log`, `log-entry-{i}`, `log-toggle`.
Shared: `toast`, `loading-spinner`.
Mobile (Phase C — new testids, never rename a desktop one): `mobile-shell`, `tabbar`, `tab-{board|clue|check|map}` (bottom nav), `mobile-home`, `btn-shoot`, `btn-random`, `btn-resume`; `board-canvas`, `btn-fit-board`, `minimap`, `sheet-mark-revealed`, `sheet-chosenby-{red|blue|neutral|assassin}`, `btn-mark-chosen`; `camera-view`, `viewfinder`, `btn-shutter`, `btn-gallery`, `btn-flip`, `capture-step-{1|2}`, `review-grid`, `review-cell-{0..24}`, `btn-use-photo`, `btn-retake`.

## 8. MSW fixtures (stepA-2 — deterministic, all tests depend on them)

Fixture board: 25 fixed Hebrew words (9 red / 8 blue / 7 neutral / 1 assassin) in `src/mocks/fixtures/board.ts`, in ABSOLUTE colors (the store's shape). Handlers operate in **wire** space (`my|opp|neutral|assassin`) because the client wire-maps before sending — so a spymaster/check/space request arrives with `my/opp`; the `/api/deal` handler _returns_ wire roles (`9 my / 8 opp / 7 neutral / 1 assassin`) and the client maps `my→red, opp→blue` on ingest. Handlers return: a fixed `/api/deal`; a `/api/coach/spymaster` with 3 options — option 0 clean (count 2, note ''), option 1 `risky:true` with a leak + note, option 2 `no_clue:true`; `/api/coach/check` legal by default, and `illegal:true` when the clue IS a board word; `/api/space` with fixed coords for every live word (echo back whatever words were posted, assign deterministic coords); `/api/feedback` → `{ok:true}`.

**Test hooks (mock mode only — MSW browser handlers run in the page, so `window` works):** every POST handler stores its last request body on `window.__lastSpymasterReq`, `__lastCheckReq`, `__lastSpaceReq`, `__lastFeedback`; the feedback handler returns 500 once when `window.__failFeedbackOnce === true` (then clears the flag). Testers rely on these — stepA-2 builds them into `handlers.ts` from the start.
