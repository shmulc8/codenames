# Codenames Copilot — UX/UI Revamp Plan (v2 — React rewrite)

Hebrew-only (RTL) Codenames copilot. Target: recreate the look of the **physical board game**
(beige word cards, red/blue agents, tan bystanders, black assassin) with an otherwise clean,
minimal UI, an explicit **Setup screen → Play screen** flow (§4.1), a fast **paint** color-assignment
mode, and a **mobile board zoom**.

**v2 decisions (approved):** frontend rewritten in **React + Ant Design + Vite + TypeScript**,
**Lucide icons everywhere (no emojis)**, **all colors centralized in one theme/tokens file**,
**non-standard team counts allowed** (subtle indicator only, never a block), and the
**side-swap feature kept as a first-class control**.

**v2.1 IA principle (approved):** the sidebar contains **only "set it and forget it" settings** —
a user must be able to play an entire session (setup, paint, play, clues, reveal) **with the
sidebar collapsed the whole time**. All per-turn / per-stage controls live in a **stage-aware
action bar** in the main area (§4); the briefing panel becomes results-only.

---

## 0. Flags & contradictions (read first)

Verified by reading `app.py` and `copilot.html`.

1. **Routes:** `/` serves `copilot.html` (app.py:277); `/game` serves the separate ~3 MB
   `codenames_latent_space.html` only if present, else 404 (app.py:287-292); `/methods` serves
   `methods.html`. `/api/deal` is a **GET** (app.py:299); the other APIs are POST.
2. **BIGGEST VISUAL GAP:** the current UI is a **dark neon sci-fi theme** (`--bg:#07080e`,
   cyan/violet/pink gradients, glow shadows). Target is beige/paper/minimal — a total restyle.
   The React rewrite absorbs this: we rebuild the UI, we don't migrate the old CSS.
3. **Team colors mismatch the physical game.** Current "my team" = cyan `#2ee6d6` (labeled
   תכלת), opponent = pink-red `#ff4d6e`. Physical game + requirement = **blue + red**.
4. **"Double-click reveals the team" is only meaningful in operative mode** — in spymaster mode
   all colors are already painted/visible (`cardClass`, copilot.html:479). Resolution: double-click
   = "flip to agent card / mark exposed", which unifies both modes (spymaster: mark guessed;
   operative: uncover the hidden color).
5. **Paint mode and the Setup/Play stage machine are new.** Today: a per-card 4-dot `roleset`
   picker in edit mode (copilot.html:516) and two independent toggles `S.editing`/`S.revealMode` —
   no stages.
6. **NEW (v2): "keep app.py unchanged" holds for the API but not 100 % for serving.** Flask has no
   static folder (`Flask(__name__)`, app.py:36) and serves single files via `send_file`. Serving the
   built React app requires a ~10-line change to app.py (index route → `frontend/dist/index.html`
   + an `/assets/*` static route). API endpoints, request/response shapes, and port (7860,
   app.py:575) stay untouched.
7. **NEW (v2): React rewrite is a real scope increase.** The old `copilot.html` stays servable at
   `/legacy` until the React app reaches feature parity (coach flows, map, feedback), then is removed.
   Parity checklist is in §8 Phase 6.
8. **NEW (v2): a component library styles the chrome, not the board.** AntD gives us sidebar,
   buttons, segmented controls, drawers; the physical word/agent cards are still **custom CSS** —
   no library has a "Codenames card". Expect the card work to be hand-rolled regardless.
9. **Emoji inventory to purge (v2):** 🎲 (deal), 🔄 (swap), ✏️ (edit), 🃏 (reveal), ✕ (clear),
   💻 (pcgate), 🤖 (panel avatar), 🤔 (no-clue), 👍/👎 (feedback), 💬 (reason), ★/↻ (options).
   All become Lucide icons (§3.6) or plain text.
10. **Two fonts are embedded** in copilot.html as base64: **Assistant** and **Rubik**. Both are kept;
    in React they become real `.woff2` files (extracted once from the base64 blobs) so they stay
    offline-capable without bloating the JS bundle.

---

## 1. Current-state audit (`copilot.html`, 905 lines) — the spec for the rewrite

This section is now a **feature inventory to port**, not code to keep.

### Structure (DOM)
- `#pcgate` "best on desktop" banner (copilot.html:344) — **dropped** (real mobile story replaces it).
- `header.bar`: brand + `.seg#mode` (אני רב המרגלים / אני המנחש).
- `.tools`: `#deal`, `#swap` (side), `#edit`, `#reveal`, `#clearsel`, `#risk` (זהיר/מאוזן/נועז),
  methods link.
- `.stage` → `.left` (`#board`, `#hint`, `#legend`+`#counts`, `.mappanel`+`#space` canvas) and
  `.right` (`.panel` briefing → `#brief`).

### State (`const S`, copilot.html:422-431) → becomes the React store shape
`mode` (spymaster|operative), `side` (my|opp), `words[]`, `roles{}`, `editing`, `revealMode`,
`focus:Set`, `revealed:Set`, `risk`, `spyTab` (generate|check), `spyResult/spyIdx`,
`checkResult`, `opResult`, `opClue/opCount/checkClue`, `space/spaceLinks`, `busy/health/error`.

### Behaviors to port (with source refs)
- `deal()` (445): GET `/api/deal` → words+roles; hardcoded demo deck fallback when offline.
- `activeBoard()` (467): unrevealed words; my↔opp swapped when coaching `side==="opp"`.
- `cardClass()` (475): role class for all cards in spymaster, only revealed ones in operative;
  `clickable/focus/intended/danger/revealed` modifiers.
- `genClue()` (804) / `checkClue()` (827) / `guess()` (837): the three coach calls.
- `showSpace()`/`drawSpace()` (527/535): POST `/api/space`, MDS scatter with clue-to-target links.
- `bars()` (612): "how a guesser reads the clue" bar chart. `optNav()` (624): cycle clue options.
- `sendFeedback()` (790): thumbs + reason chips + free text → POST `/api/feedback`.
- Card click today (874-883): revealMode → toggle covered; else spymaster/generate/own-side →
  toggle focus. No dblclick/paint — those are new.

### API contract (verified in app.py — UNCHANGED)
- `GET /api/deal` → `{words, roles}` · `GET /api/health` → `{ok, models, encoders, geo}`
- `POST /api/space` → `{coords{w:[x,y]}, roles, clue, clue_xy}`
- `POST /api/coach/spymaster` → `{options[], picked, shortlist[], clue, count, intended[], reason,
  read[], leak[], assassin{word,rank}, no_clue, risky, safe, note}`
- `POST /api/coach/check` → `{clue, illegal, read[], safe, first_danger, assassin{word,rank}}`
- `POST /api/coach/operative` → `{clue, count, ranking[{word,sim,conf,rank}], picks[], agreement,
  agree_with}`
- `POST /api/feedback` → ack. These become typed interfaces in `src/api/types.ts`.

### What survives the rewrite
All server code; all API shapes; the feature set above; both fonts; RTL-first design; the
semantic-map canvas algorithm (ported as a React component wrapping the same draw code).

### What is deleted
`copilot.html` in its entirety (after parity, via `/legacy` retirement), including its dark-neon
palette, emojis, per-card roleset picker, and the pcgate banner.

---

## 2. Tech stack & library choice

### Component library: **Ant Design (AntD v5)** — chosen over Mantine
AntD wins on both stated criteria, in order. **(a) LLM familiarity:** AntD is among the most-used
React UI libraries in existence, with a decade of stable, highly conventional APIs (`Button`,
`Layout.Sider`, `Segmented`, `Drawer`, `ConfigProvider`) heavily represented in training data —
LLM-generated AntD code is reliably correct on the first pass, whereas Mantine's v6→v7 styling
overhaul makes models mix incompatible API generations. **(b) Hebrew/RTL:** AntD has first-class,
long-mature RTL via `<ConfigProvider direction="rtl" locale={he_IL}>` — every component flips
correctly — and its v5 token theming with `cssVar: true` emits the theme as CSS variables from a
single object, which is exactly the color-centralization requirement (§3.1). Mantine's RTL
(DirectionProvider) works but is younger and less battle-tested. Tradeoff accepted: AntD's bundle
is heavier than Mantine's; acceptable for a desktop-first tool, mitigated by Vite tree-shaking.

### Stack
- **Vite + React 18 + TypeScript** (`npm create vite@latest frontend -- --template react-ts`).
- **antd** (+ `antd/locale/he_IL`), **lucide-react** for all icons, **no other UI deps**.
- State: **plain React — one `GameProvider` with `useReducer`** (the app state is one small object;
  no Redux/Zustand needed, and vanilla Context+reducer is maximally LLM-conventional).
- Styling: AntD tokens for chrome + one `board.css` of custom CSS (cards/flip/zoom) that consumes
  **only** the CSS variables emitted from the theme (§3.1).
- **Dev tooling — `react-grab`** (aidenybai/react-grab, MIT): a **dev-only** overlay for
  agent-assisted UI editing — point at any element in the running app and press ⌘/Ctrl-C to copy
  its file + React component + source context for the coding agent, so UI tweaks land on the exact
  component fast. Added as a `devDependencies` entry, mounted only when `import.meta.env.DEV`
  (dynamic-import in `main.tsx`) so it is **never in the production bundle**. Zero runtime/UX impact.

### Project structure
```
codenames-clean/
├─ app.py                      # API + serves frontend/dist in prod (§7)
├─ copilot.html                # served at /legacy until parity, then deleted
└─ frontend/
   ├─ vite.config.ts           # base:'/', server.proxy: {'/api': 'http://localhost:7860'}
   ├─ index.html
   ├─ public/fonts/            # Assistant + Rubik .woff2 (extracted from copilot.html base64)
   └─ src/
      ├─ main.tsx              # ConfigProvider(direction:"rtl", locale:he_IL, theme, cssVar)
      ├─ App.tsx               # grid shell: Sidebar | Center | Briefing
      ├─ theme/tokens.ts       # ★ THE color/typography source of truth (§3.1)
      ├─ api/client.ts         # typed fetch wrappers for the 6 endpoints
      ├─ api/types.ts          # response interfaces (from §1 contract)
      ├─ state/GameProvider.tsx# useReducer store + actions (port of S, §6)
      ├─ hooks/
      │  ├─ useCardPress.ts    # click vs dblclick (desktop) / tap vs long-press (mobile) §5.2
      │  └─ useBoardZoom.ts    # pinch + button zoom §4
      └─ components/
         ├─ board/  Board.tsx · WordCard.tsx · CountChips.tsx · board.css
         ├─ sidebar/ Sidebar.tsx        # SLIM: title · mode · methods link only (§4)
         ├─ actionbar/ ActionBar.tsx    # stage-aware command strip under the board (§4)
         │    SetupBar.tsx (PaintPalette · deal · word-edit · start)
         │    PlayBarSpymaster.tsx (רמז חדש · RiskToggle · SideSwap · check-input · overflow)
         │    PlayBarOperative.tsx (clue input · count stepper · guess CTA · overflow)
         ├─ briefing/ BriefingPanel.tsx  # RESULTS-ONLY: ClueResult.tsx · CheckResult.tsx
         │            OperativeResult.tsx · ReadBars.tsx · FeedbackRow.tsx
         └─ map/ SemanticMap.tsx        # canvas; ports drawSpace() (copilot.html:535)
```

---

## 3. Visual design system

### 3.1 ★ Centralized color tokens — EXPLICIT REQUIREMENT
**All colors live in exactly one file: `src/theme/tokens.ts`.** Changing the palette later must be
a one-file edit. Mechanism:

```ts
// src/theme/tokens.ts — the ONLY place hex values may appear
export const palette = {
  bg:'#f4f1e8', surface:'#fbfaf5', line:'#e3ddcb', ink:'#2b2a26', muted:'#6f6a5c',
  card:'#e9e4cf', cardEdge:'#d8d2b8', cardLabel:'#faf8ef', cardInk:'#3a3630',
  teamBlue:'#2f6fb0', teamBlueCard:'#3d7cbf',
  teamRed:'#c0392b',  teamRedCard:'#cf4436',
  neutral:'#c9b98f',  neutralCard:'#d8c79a',
  assassin:'#141414', assassinInk:'#f2efe6',
  good:'#3f8f5e', warn:'#c9962f', bad:'#c0392b',
} as const;

export const antdTheme = {           // feeds <ConfigProvider theme=...>
  cssVar: true, hashed: false,       // AntD emits its tokens as CSS variables
  token: { colorPrimary: palette.teamBlue, colorBgLayout: palette.bg,
           colorText: palette.ink, borderRadius: 12,
           fontFamily: 'Assistant, system-ui, sans-serif' },
};
export const cssVars = () =>         // injected once in main.tsx as :root {...}
  Object.entries(palette).map(([k,v]) => `--${k}: ${v};`).join('\n');
```
- AntD chrome is themed through `antdTheme`; the custom `board.css` uses **only `var(--card)`,
  `var(--teamBlue)`, …** — zero literal hex outside `tokens.ts`. One file, two consumers
  (ConfigProvider + CSS variables), satisfying the "one or at most two places" bound with one.
- Lint guard (cheap): a grep in CI/pre-commit for `#[0-9a-fA-F]{3,8}` under `src/` excluding
  `theme/` keeps the rule honest.
- The hex values above are the approved starting point (physical-game-inspired; tune to taste later
  by editing this single file). Dark mode is out of scope for v1 (physical game is light); the
  token file makes adding one later a contained change.

### 3.2 Typography
- Body: **Assistant**; display/clue chips/card words: **Rubik** (or Assistant 800).
- One-time step: extract both fonts' base64 blobs from copilot.html into
  `frontend/public/fonts/*.woff2` + `@font-face` rules in `index.css`. Keeps offline capability.

### 3.3 Word card — CSS-only recreation of the physical card (`WordCard.tsx` + `board.css`)
Anatomy of the real card: rounded beige body, **white label strip** holding the word, the **same
word mirrored upside-down along the top edge**, subtle paper grain.

```css
.card{ position:relative; aspect-ratio:5/3.4; border-radius:10px;
  background:
    repeating-linear-gradient(0deg, rgba(0,0,0,.012) 0 2px, transparent 2px 4px),
    linear-gradient(180deg, color-mix(in srgb, var(--card) 92%, white), var(--card));
  border:1px solid var(--cardEdge);
  box-shadow:0 1px 2px rgba(0,0,0,.10), inset 0 0 0 1px rgba(255,255,255,.4); }
.card .w-top{ position:absolute; top:6%; inset-inline:0; text-align:center;
  transform:rotate(180deg); opacity:.35; font-size:.72em; pointer-events:none; }
.card .w{ background:var(--cardLabel); border:1px solid var(--cardEdge); border-radius:6px;
  padding:.28em .7em; color:var(--cardInk); font-family:Rubik; font-weight:600; }
```
Hebrew renders correctly under `rotate(180deg)` (pure flip of the rendered glyph run).

### 3.4 Agent / role faces
Painted (spymaster/setup) or revealed cards fill with the team color + a faint agent silhouette —
**inline SVG or a Lucide glyph (`VenetianMask` for agents, `Skull` for the assassin), no emojis**:
`.r-my` → `--teamBlueCard` fill; `.r-opp` → `--teamRedCard`; `.r-neutral` → `--neutralCard` tan;
`.r-assassin` → `--assassin` black with `--assassinInk` text. Label strip stays legible per role
(tuned opacity/ink from tokens).

### 3.5 Reveal (flip) animation
`WordCard` renders two stacked faces (`.face-word` / `.face-agent`, `backface-visibility:hidden`);
`revealed` → `transform:rotateY(180deg)`, `.45s` ease. `prefers-reduced-motion` → cross-fade.

### 3.6 Icons — Lucide only (`lucide-react`), zero emojis
| Old emoji | Use | Lucide icon |
|---|---|---|
| 🎲 | לוח חדש (deal) | `Dices` |
| 🔄 | side-swap | `ArrowLeftRight` |
| ✏️ | ערוך לוח | `Pencil` |
| 🃏 | חשיפה (reveal-all) | `Eye` / `EyeOff` |
| ✕ | נקה בחירה | `X` |
| 🤖 | briefing header | `Bot` |
| 🤔 | no-clue state | `CircleHelp` |
| 👍 / 👎 | feedback | `ThumbsUp` / `ThumbsDown` |
| 💬 | clue reason | `MessageSquare` |
| ↻ / ★ | next option / picked | `RefreshCw` / `Star` |
| — | sidebar collapse | `PanelRightClose` / `PanelRightOpen` |
| — | zoom controls | `ZoomIn` / `ZoomOut` / `Maximize` |
| — | play/setup transitions | `Play` / `Settings2` |

**Paint swatches are not emojis either:** each palette button is a rounded square filled with its
token color (`var(--teamBlueCard)` etc.), with a Lucide `Check` overlay when active and a
`Paintbrush` header icon; the assassin swatch gets a small `Skull`. All at `size={16–18}`,
`strokeWidth={1.75}` for the minimal look.

---

## 4. Layout

### 4.0 ★ IA rule (v2.1): sidebar = set-and-forget only
**Acceptance test: a user plays an entire session — deal, paint, start, get clues, swap sides,
reveal — with the sidebar collapsed the whole time.** Every control is classified by frequency:

| Control | Frequency | Home | Reasoning |
|---|---|---|---|
| מצב (רב מרגלים/מנחש) | once per session | **Sidebar** | you pick your role and keep it |
| "איך זה עובד" (methods) | rare | **Sidebar** | reference link |
| רמז חדש | **every turn** | **Action bar (play)** | the core loop; never behind a collapse |
| סיכון (risk) | **per clue** | **Action bar (play)** | today changing risk *immediately regenerates the clue* (copilot.html:852-853) — it's a per-clue dial, not a preference |
| נותן רמז ל: (side-swap) | **per turn** (alternating-coach use) | **Action bar (play)** | see §5.4 — coaching both teams alternately means toggling it every round; fails set-and-forget by definition |
| בדוק רמז (check input) | per clue | **Action bar (play, spymaster)** | part of the clue loop |
| clue input + count (operative) | per clue | **Action bar (play, operative)** | the operative's core loop |
| צביעה (paint palette) | per setup | **Action bar (setup)** | stage action |
| לוח חדש (deal) | per game | **Action bar (setup)** | starts a board; also in play-bar overflow for convenience |
| התחל משחק / ערוך לוח | per stage change | **Action bar** (setup primary / play secondary) | stage transitions |
| חשיפה (reveal-all) | end of game | **Action bar (play, overflow)** | on-demand |
| נקה בחירה | occasional | **Action bar (play, overflow)** | on-demand |

Result: the sidebar is **slim** — and can genuinely stay collapsed to an icon rail by default.

### 4.1 ★ Two top-level screens (Setup screen / Play screen)
`stage` is not just a mode of one layout — it selects between **two distinct full screens**, because
setup and play have genuinely different information needs. `App.tsx` switches on `stage`; both share
the same shell (slim sidebar + RTL grid) but compose the center column differently.

- **SETUP SCREEN** (`stage==='setup'`) — a **focused board-building canvas**. No coach chrome: the
  semantic map and briefing panel are **absent**, so nothing competes with the one job (deal → paint →
  start). Center column: `CountChips` (with the subtle non-standard dot) → `Board` (larger; it's the
  only thing here, so it can grow to ~min(94vw,820px)) → **`SetupBar`** (paint palette + לוח חדש +
  word-edit + a prominent **התחל משחק** primary). This is the "setup screen" — visually calmer, board-
  dominant, no results panels to distract while assigning teams.
- **PLAY SCREEN** (`stage==='play'`) — the coaching workspace described in "App shell" below
  (chips → board → play action bar → map → briefing).

Transition is a screen swap, not an in-place toggle (§5.3): התחל משחק leaves the setup screen for the
play screen; ערוך לוח returns. `AnimatePresence`/CSS cross-fade optional. The sidebar (mode, methods)
is identical on both screens and stays collapsible throughout.

### App shell (desktop, RTL) — the PLAY screen
`App.tsx`: CSS grid `1fr 260px` — under `dir="rtl"` the second column paints on the **right**.
Sidebar is AntD `Layout.Sider collapsible` (RTL-aware; state persisted to `localStorage`;
**default: collapsed icon rail** — expanding is optional, per the acceptance test). Same sidebar on
the setup screen.
- Play center column: `CountChips` → `Board` (max-width ~min(92vw,720px)) → **`ActionBar`** →
  `SemanticMap` → `BriefingPanel` (stacked; ultra-wide may move briefing to a third column later).

### Sidebar (slim, set-and-forget only)
1. **שם קוד** title + collapse toggle (`PanelRightClose`/`PanelRightOpen`).
2. **מצב** — `Segmented`: אני רב המרגלים / אני המנחש.
3. **"איך זה עובד"** link to `/methods` (+ engine/status line from `/api/health`).
Nothing else. No CTAs, no board actions, no risk, no paint, no side-swap.

### Action bar — the single stage-aware command strip (`ActionBar.tsx`)
Sits **directly below the board** (closest to where the eyes/fingers are), full board width,
one row (wraps to two on narrow screens). Contents switch on `stage` × `mode`; the **briefing
panel is results-only** — every input/CTA lives here, so no CTA is duplicated:

- **SETUP** (`SetupBar`): `PaintPalette` swatches inline · לוח חדש (`Dices`) · word-edit toggle
  (`Pencil`) · **התחל משחק** (primary, `Play`).
- **PLAY · spymaster** (`PlayBarSpymaster`): **רמז חדש** (primary; label becomes
  "רמז ל-N המילים שבחרתי" when targets are focused, porting copilot.html:639) ·
  `RiskToggle` (Segmented) · **`SideSwap`** ("נותן רמז ל:" color-chip Segmented, §5.4) ·
  a "בדוק רמז" toggle revealing an inline input+בדוק in the bar (ports the check tab,
  copilot.html:677-679) · overflow menu (`Ellipsis`): חשיפה, נקה בחירה, לוח חדש, ערוך לוח.
- **PLAY · operative** (`PlayBarOperative`): clue input ("הרמז שקיבלת") · count stepper ·
  **"מה כדאי לנחש?"** (primary) · overflow: חשיפה, ערוך לוח.

The `BriefingPanel` (תדריך) below the map renders **outputs only**: clue chip + count badge,
connects/avoids chips, `ReadBars`, option cycling ("אפשרות אחרת" — result navigation, so it stays
with the result), feedback row. Empty state points at the action bar ("בחר מילים ולחץ רמז חדש").

### Mobile (≤560px)
- **The action bar makes the drawer nearly irrelevant:** everything per-turn is already on the
  main surface. The slim sidebar becomes an AntD `Drawer placement="right"` behind a small
  settings icon (`Settings2`) — opened maybe once per session to switch mode.
- Order: chips → board → **action bar (sticky at the bottom of the viewport during play)** →
  map → briefing. Sticky bar keeps רמז חדש / guess CTA under the thumb while the board scrolls.
- **Board zoom (required):** `useBoardZoom` hook on a `#boardViewport` wrapper
  (`overflow:auto; touch-action:pan-x pan-y`) applying `transform:scale(var(--zoom))` (0.6–2.0)
  to an inner scale layer. Controls: `ZoomIn`/`ZoomOut`/`Maximize`(fit) buttons (living at the
  board's corner, not the sidebar) **plus** a two-pointer pinch handler zooming about the pinch
  midpoint.
- Tradeoff (recorded): native browser pinch-zoom is simpler but zooms the whole page and fights
  the sticky bar; we scope zoom to the board container and set the viewport meta
  `user-scalable=no`. Cost: hand-rolled pinch math; fallback is buttons-only if pinch is flaky.
- `#pcgate` banner is gone.

---

## 5. Interaction spec

### 5.1 Paint mode (Setup)
Store: `paint: null | 'my' | 'opp' | 'neutral' | 'assassin'`.
- `PaintPalette`: four color swatches (§3.6) + a clear swatch, living **inline in the setup
  action bar directly under the board** (§4) — one tap away from the cards, sidebar stays
  collapsed. Click selects (re-click deselects); active swatch highlighted; board cursor →
  crosshair; hint: "בחר צבע ואז הקש על מילים".
- With paint active, **tap a card → `roles[w] = paint`**; different color repaints instantly.
- **Counts auto-update** in `CountChips` (derived from `roles` on every render).
- **Non-standard counts are ALLOWED (v2 decision).** No hard block anywhere. The only feedback is a
  **subtle indicator**: `CountChips` shows the live distribution vs the standard 9/8/7/1 and, when
  it differs, a small muted dot + tooltip "לוח לא סטנדרטי (סטנדרט: 9/8/7/1)". "התחל משחק" is
  **always enabled** — the engine only requires ≥1 team word (`/api/coach/spymaster` 400s when
  `board.my` is empty, app.py:411); guard that one case client-side with a gentle inline note,
  not a disabled button.

### 5.2 Click vs double-click (Play) — `useCardPress`
Requirement: single click = select as clue target; double click = reveal (flip).
- **Desktop:** defer single-click ~**220 ms**; an incoming `dblclick` cancels it and reveals.
  Encapsulated in `useCardPress({onPress, onDoublePress})` used by `WordCard`.
- **Mobile:** tap = select; **long-press (~450 ms)** = reveal (pointerdown timer, cancelled by
  pointermove/up — also prevents pinch being misread as a tap).
- `onPress` → toggle `focus` (spymaster/generate, own-side cards only — port of copilot.html:880).
- `onDoublePress` → add to `revealed` + flip; in operative mode this also uncovers the color
  (role classes gate on `revealed` there, as today).

### 5.3 Stage transitions (screen swaps, §4.1)
Store: `stage: 'setup' | 'play'` — drives which **top-level screen** renders (§4.1), not just which
action-bar variant shows.
- **Setup → Play** ("התחל משחק" / `Play` icon): set stage, clear `paint`, lock word editing; the
  setup screen (board-only, no map/briefing) swaps out for the play screen (board + action bar + map
  + briefing). No validation gate (§5.1) beyond the ≥1-team-word note.
- **Play → Setup** ("ערוך לוח"): AntD `Popconfirm` (clears coach results/focus/space), swap back to
  the setup screen.
- First load with no board defaults to the **setup screen**.
- **חשיפה (reveal-all):** Play-only toggle that fills/clears `revealed` for all words (end-of-game
  flip-everything). Per-card reveal is dblclick/long-press.

### 5.4 Side-swap — FIRST-CLASS control, in the PLAY action bar (v2.1 placement)
**Where it belongs, and why:** side-swap's defining use case is coaching **both teams
alternately on one board** — the user toggles it *every round*. That is the exact opposite of
set-and-forget, so under the v2.1 IA rule it cannot live in the sidebar; parking it there would
force the sidebar open every turn and fail the acceptance test. It therefore sits in the
**spymaster play bar, directly beside רמז חדש** — which also *increases* its prominence: it is
now permanently visible next to the primary CTA instead of hidden behind a collapse.
- Control: AntD `Segmented` labeled **"נותן רמז ל:"** with two color-chip options (blue / red,
  chips colored from tokens). Ports `S.side` + `activeBoard()` (copilot.html:467-473): coach
  either team **without repainting** — board colors stay fixed; only card interactivity and the
  engine's my/opp perspective flip. Changing side clears coach results and focus (as today,
  860-861). Tooltip copy: "צבעי הלוח לא משתנים — רק מי מקבל את הרמזים" (distinct from paint).

---

## 6. State architecture (React)

`GameProvider` (`useReducer`) — port of `S` (copilot.html:422-431):

| old `S.*` | new store field | notes |
|---|---|---|
| mode, side, risk | `mode`, `side`, `risk` | unchanged semantics |
| words, roles | `words: string[]`, `roles: Record<string,Role>` | `Role = 'my'\|'opp'\|'neutral'\|'assassin'` |
| editing, revealMode | **replaced by** `stage: 'setup'\|'play'` + `paint` | §5.1/5.3 |
| focus, revealed | `focus: Set<string>`, `revealed: Set<string>` | |
| spyTab, spyResult, spyIdx | `spyTab`, `spyResult`, `spyIdx` | option cycling kept |
| checkResult, opResult, opClue, opCount, checkClue | same names | |
| space, spaceLinks | local to `SemanticMap` (fetched per clue) | |
| busy, health, error | `busy`, `health`, `error` | |
| — | `paint`, `stage`, `sidebarCollapsed`, `zoom` | new |

Actions mirror today's handlers: `DEAL_LOADED`, `SET_MODE`, `SET_SIDE`, `SET_RISK`, `SET_PAINT`,
`PAINT_CARD`, `EDIT_WORD`, `TOGGLE_FOCUS`, `REVEAL_CARD`, `REVEAL_ALL`, `SET_STAGE`,
`SPY_RESULT`, `CHECK_RESULT`, `OP_RESULT`, `NEXT_OPTION`, `CLEAR_SELECTION`, `ERROR`, `BUSY`.
Derived values (counts, activeBoard, remaining) are computed in selectors/`useMemo`, not stored.
`api/client.ts` wraps the six endpoints with the typed shapes from §1; the demo-deck fallback from
`deal()` (copilot.html:452) is kept for offline demos.

---

## 7. Dev & prod serving (Flask + Vite)

- **Dev:** run `python app.py` (API on **:7860**, app.py:575) + `npm run dev` in `frontend/`
  (Vite on :5173) with `server.proxy = { '/api': 'http://localhost:7860' }`. No CORS needed;
  relative `/api/...` calls work in both dev and prod.
- **Prod:** `npm run build` → `frontend/dist/`. Minimal app.py change (~10 lines, API untouched):
  - `/` → `send_file("frontend/dist/index.html")`; `/assets/<path>` → serve from
    `frontend/dist/assets` (or simply `Flask(__name__, static_folder="frontend/dist/assets")`).
  - `/legacy` → `send_file("copilot.html")` during migration; route deleted at parity (Phase 6).
  - `/methods` and `/game` routes unchanged.
- No build tooling touches the Python side; deployment artifact = repo + `frontend/dist`.

---

## 8. Implementation phases (each ends runnable)

### Phase 1 — Scaffold + theme tokens
Vite react-ts app in `frontend/`; install `antd`, `lucide-react` (deps) + `react-grab` (devDep,
DEV-only dynamic import in `main.tsx`); `main.tsx` with
`ConfigProvider direction="rtl" locale={he_IL} theme={antdTheme}`; write `theme/tokens.ts` (§3.1)
+ CSS-var injection + hex-lint grep; extract fonts to `public/fonts` + `@font-face`; dev proxy to
:7860; `api/types.ts` + `api/client.ts`; `/legacy` route added to app.py.
*Runnable:* themed RTL shell loads, `/api/health` renders in a status footer.

### Phase 2 — Card component + Board
`WordCard` (word face: beige + label strip + mirrored `w-top`; agent face per role; flip CSS),
`Board` 5×5 grid, `CountChips`, `GameProvider` skeleton with `DEAL_LOADED`; wire `GET /api/deal`
+ demo fallback.
*Runnable:* dealt board renders as physical cards; a debug toggle flips them.

### Phase 3 — Layout: two screens (slim sidebar + setup screen + play screen)
`App.tsx` switches on `stage` between the **Setup screen** (board-only, `SetupBar`, no map/briefing)
and the **Play screen** grid (§4.1); **slim** `Layout.Sider` shared by both (title, mode, methods
link — default collapsed); `ActionBar` skeleton under the board switching on `stage`×`mode`
(SetupBar / PlayBarSpymaster / PlayBarOperative shells); mobile `Drawer` (settings icon) +
sticky-bottom action bar; `SemanticMap` + `BriefingPanel` placeholders positioned on the play screen.
*Runnable:* both screens render and swap; **the sidebar-collapsed acceptance test (§4.0) is
walkable end-to-end with stub actions**.

### Phase 4 — Stage machine + paint mode + setup screen
`stage`/`paint` in the reducer drives the **screen swap** (§4.1, §5.3); Setup screen finished:
`PaintPalette` token-colored swatches (no emojis), tap-to-paint, לוח חדש, inline word editing, soft
non-standard-count indicator (§5.1), prominent **התחל משחק** (→ play screen); play-screen overflow
gets ערוך לוח (→ back to setup screen, `Popconfirm`) + reveal-all toggle.
*Runnable:* build a board on the focused setup screen, start game, the play screen takes over,
ערוך לוח returns — sidebar collapsed throughout.

### Phase 5 — Coach integration + interactions
Fill the play bars: רמז חדש + `RiskToggle` + `SideSwap` + inline check input (spymaster);
clue input + stepper + guess CTA (operative). Port `genClue`/`checkClue`/`guess` into the store;
`BriefingPanel` renders results only (ClueResult chip+count badge, connects/avoids chips,
`ReadBars`, option cycling, feedback row with Lucide thumbs); `SemanticMap` ports `drawSpace()`
with token colors; `useCardPress` click/dblclick + long-press; side-swap perspective logic
(`activeBoard` port).
*Runnable:* full feature parity with `/legacy` — the parity checklist is §1's behavior list, plus
the §4.0 acceptance test with real actions.

### Phase 6 — Mobile zoom + polish + legacy retirement
`useBoardZoom` (buttons + pinch, §4); viewport meta; reduced-motion fallbacks; empty/error states;
contrast pass on colored card faces; switch `/` to `frontend/dist`, delete `/legacy` + copilot.html.
*Runnable:* production build served by Flask alone.

### Risks
- **Rewrite regressions:** parity is guarded by keeping `/legacy` live until Phase 6's checklist
  passes side-by-side.
- **Pinch vs long-press vs tap** on mobile is the trickiest handler; fallback = buttons-only zoom.
- **Flip inside a scaled container** can blur/clip; test transform composition early (Phase 2 flip
  debug toggle exists for this).
- **AntD bundle size:** acceptable; tree-shake, import icons individually from `lucide-react`.
- **Font extraction** from base64 is one-time but fiddly; verify Hebrew glyph coverage after.
- **app.py touch** (serving only) — keep it to the index/static/legacy routes; API frozen.

---

## 9. Mockup flaws & fixes
- **Per-turn controls buried in the sidebar** (רמז חדש, risk, board actions) → the mockup's
  sidebar fails its own collapsibility: collapse it and the game is unplayable. Fixed by the
  v2.1 rule (§4.0): sidebar = set-and-forget only; everything per-turn moves to the stage-aware
  action bar under the board, and the sidebar can stay collapsed for a whole session.
- **Controls not stage-separated** → `stage` selects between **two dedicated screens** (§4.1): a
  focused **Setup screen** (board + paint + start, no coach chrome) and the **Play screen** (board +
  action bar + map + briefing). Paint/word-edit/indicator exist only on the setup screen; map and
  briefing only on the play screen — the two stages never bleed into each other.
- **Unclear hierarchy** → board-first grid; exactly one primary CTA per stage×mode in the action
  bar; slim sidebar; consistent minimal Lucide iconography instead of mixed emojis.
- **Briefing duplication risk** → strict split: action bar = all inputs/CTAs, `BriefingPanel` =
  results only. No CTA exists twice.
- **No mobile story** → on-demand controls already on the main surface (sticky bottom action
  bar); settings Drawer is a rare, once-per-session visit; board-scoped zoom (buttons + pinch).
- **Team colors wrong for the physical game** → blue/red/tan/black from one token file.
- **Rigid count assumptions** → counts are informative, never blocking (subtle non-standard dot).
- **Side-swap missing from the mockup** → kept as a first-class "נותן רמז ל:" control in the מצב
  section, with inline copy distinguishing it from paint.
- **"Reveal team" ambiguity** → unified flip-to-agent-card; true color-reveal in operative mode.

---

## BRIEF (for approval)

- **React rewrite:** frontend rebuilt as Vite + React 18 + TypeScript in `frontend/`; old
  `copilot.html` stays at `/legacy` until parity, then deleted.
- **Component library: Ant Design** (over Mantine): far larger LLM training-data footprint with
  stable conventional APIs, and first-class RTL (`ConfigProvider direction="rtl"` + `he_IL`);
  v5 `cssVar` theming doubles as our CSS-variable pipeline.
- **Icons: Lucide only, zero emojis** — full replacement map included; paint swatches are
  token-colored squares with a `Check` overlay.
- **Dev tooling: `react-grab`** installed as a DEV-only overlay (point-and-⌘C copies element
  source context to the coding agent) — never in the production bundle.
- **Colors centralized in ONE file** (`src/theme/tokens.ts`) feeding both the AntD theme provider
  and CSS variables; a lint grep bans hex anywhere else.
- **IA rule: sidebar = set-and-forget only** (mode, methods link — that's it; collapsed icon rail
  by default). Acceptance test: an entire session is playable with the sidebar collapsed.
- **Two dedicated screens** (`stage`): a focused **Setup screen** — board-only, no map/briefing, so
  nothing competes with deal → paint → start — swaps to the **Play screen** (board + action bar +
  map + briefing) on התחל משחק; ערוך לוח returns.
- **Stage-aware action bar under the board** is the single home for all per-turn controls:
  SETUP screen = paint palette + לוח חדש + word-edit + התחל משחק; PLAY/spymaster = רמז חדש (primary) +
  risk + side-swap + inline check-clue + overflow (חשיפה, ערוך לוח); PLAY/operative = clue input +
  count + guess CTA. Briefing panel (תדריך) is results-only — no duplicated CTAs.
- **Risk is per-clue, not a preference** (changing it regenerates the clue today) → action bar.
- **Side-swap stays first-class, now beside רמז חדש:** it's toggled every round when coaching both
  teams alternately, so it belongs on the main surface — more visible than in any sidebar.
- **API contract frozen**; app.py gets only a ~10-line serving change; dev = Vite proxy → :7860.
- **Physical-game visuals:** beige card + white label strip + mirrored top word + paper grain,
  blue/red agents, tan bystanders, black assassin; CSS 3D flip; non-standard counts allowed
  (subtle indicator only).
- **Interactions:** desktop click=select / dblclick=reveal (220 ms deferral); mobile tap=select /
  long-press=reveal; board-scoped zoom (pinch + buttons); sticky bottom action bar on mobile.
- **6 phases**, each runnable: scaffold+tokens → card+board → layout (slim sidebar+action bar) →
  stages+paint → coach+interactions → zoom+polish+legacy retirement.
