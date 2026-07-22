# Agent: stepB-1 — Photo capture, OCR, key card, board grid, lifecycle

Worktree `wt-stepB-1`, branch `stepB-1`, branched from `main` after `phase-a-done`. Time budget: **2h15m**. Read `agents/00-orchestration.md` + `agents/01-CONTRACTS.md` first. You own `src/features/photo/**`, `src/features/board/**`, `tests/e2e/photo.spec.ts`, `tests/e2e/board.spec.ts` (tests written by your tester). Photo input is the product's #1 must-have — your feature gates everyone's demo.

First step: `npm install` (worktrees don't share node_modules) and `export PW_PORT=5174` for every dev/test run (CONTRACTS §5). Spawn your tester agent (fill `agents/tester-template.md` with FEATURE=board+photo, SPECS=photo.spec.ts,board.spec.ts) as soon as the board grid renders; iterate with it until green.

## Part 1 — PhotoSetup / board input (`src/features/photo/`)

Replace the stub. **Match `agents/design/screens/desktop-4a-board-input.png` and DESIGN.md §6.1.** On desktop there is no camera, so the screen is a segmented input-mode control **הזנה ידנית / מתמונה / אקראי** (manual / from-photo / random) — **manual entry is the default on PC**, with the explicit note "אין מצלמה במחשב? זו הסיבה שהזנה ידנית היא ברירת המחדל". Photo upload (drag-drop / file browse, for a board photo taken on a phone) is the secondary path; the mobile live-camera capture flow is Phase C (stepC-3), not here. The manual path is a 5×5 word grid where each cell also carries a role chip set from the key card, validated to 9·8·7·1. The OCR/photo path below feeds the same correction grids, so a total OCR failure still leaves a usable typing grid.

Flow (single screen, `data-testid="setup-screen"`, testids per CONTRACTS §7):

1. **Board photo**: `<input type="file" accept="image/*" capture="environment" data-testid="photo-input-board">` (on desktop this is a file picker — photos AirDropped/synced from a phone work fine). On selection show the image, run **Tesseract.js** (`lang: 'heb'`) on it. Note: the Hebrew traineddata (~10MB) downloads from CDN on first use — start warming the Tesseract worker on setup-screen mount so the user never waits for it, and surface a small "טוען מנוע זיהוי…" indicator until ready. Practical accuracy tricks (budget ~30 min on OCR, then move on): downscale to ≤1600px, grayscale + contrast via canvas before recognize; use word-level boxes from the result, cluster into 5 rows by y-center then sort each row **right-to-left** by x (RTL board), take best 25; strip non-Hebrew chars.
2. **Correction grid** (`ocr-grid`, cells `ocr-cell-{i}`): 5×5 text inputs prefilled with OCR output (blank where missing). Low-confidence cells (<60) get a warning outline. User edits freely. This grid is the real contract — OCR is just prefill, so a total OCR failure still leaves a usable typing grid. Validate before continue: 25 non-empty unique words.
3. **Key-card photo** (`photo-input-key`): draw to canvas, sample a 5×5 grid of average colors from the central region (assume card roughly fills the frame; sample a small patch at each cell center), classify each patch to nearest of {red, blue, neutral=beige/cream, assassin=black} by hue/lightness distance → the tile's **absolute `role`** directly. **Team-agnostic: do NOT ask "which color do you play" — there is no `myColor`.** The board simply records the real key-card colors; which team a clue is _for_ is chosen later in the clue panel (`store.target`).
4. **Key correction grid** (`key-grid`, `key-cell-{i}`): 5×5 cells colored by the classification (red/blue/neutral/assassin from `--cn-*` tokens), each showing `RoleIcon`; tap cycles red→blue→neutral→assassin. Show live counts — a valid key is 9/8/7/1 across the two teams (one team 9, the other 8, 7 neutral, 1 assassin; render as "9·8·7·1 מפתח תקין" per DESIGN.md); warn if the distribution is off, don't block. Add a "סובב ↻" button that rotates the whole grid 90° — the physical key card sits in its stand in any of 4 orientations, and one tap beats re-tapping 25 cells.
5. **Confirm** (`btn-confirm-board`): zip words+roles positionally (cell i ↔ cell i), call `store.setBoard(words, roles)`.
6. **Demo path** (`btn-skip-demo`): fetches `getDeal()` and calls `setBoard` — this is the path all other agents' tests use, so build it FIRST (15 min), commit, push, and note it in `agents/SYNC-REQUESTS.md` so others can merge your branch early if they need it. Both photo steps also individually skippable (skip board photo → empty typing grid; skip key photo → all-neutral grid for manual tapping).

Testability: OCR can't run on CI photos deterministically — photo specs test the flow with typed input + the demo path; add one non-blocking smoke that Tesseract loads.

## Part 2 — BoardGrid (`src/features/board/`)

1. 5×5 grid (`board-grid`), tiles `tile-{i}` with `data-word`, `data-role` (`red|blue|neutral|assassin`), `data-lifecycle` attributes. Tile look per `agents/design/DESIGN.md` §4 card anatomy + `agents/design/screens/desktop-1d-card-states.png` and `simple-html/card-states.html` (read them first): cream card with paper-shading gradient, punch-hole dot, faint mirrored word above a white label strip with the word in bold black; identity = colored border/edge tint in the REAL key-card color via the `role-red`/`role-blue`/`role-neutral`/`role-assassin` classes (each straight from its `--cn-<role>-*` tokens — **no `myColor` remap**) + `RoleIcon` top-right (RTL-leading). Pure CSS — no image assets.
2. **Click behavior**: in-play tile click ⇒ `toggleSelected(word)` — the store accepts only `red|blue` tiles and enforces **one-color clusters** (a word of a different color than the current selection is rejected with the store's Toast "אפשר לבחור רק קלפים בצבע אחד"; neutral/assassin tiles show "אפשר לבחור רק קלפים של קבוצה"). You just call `toggleSelected`; the store owns the rules (CONTRACTS §3). A separate dedicated mini-button on each tile, `btn-lifecycle-{i}` ("סמן כנחשף" / "החזר למשחק"), toggles lifecycle: marks chosen (defaulting `chosenBy` to tile role, per store), click again un-chooses. Never the same click target as selection.
3. **Chosen visual state**: 40% opacity + line-through + corner chip (`chip-chosenby-{i}`) with the claiming team's `RoleIcon`; assassin-chosen additionally shows a full-black tile + a board-level banner "המתנקש נחשף — סוף משחק" (non-blocking).
4. Numbered badges (1,2,3…) top-right on selected tiles showing selection order.
5. Hover: `setHoverWord(word)` on enter, null on leave; tile gets a highlight ring when `hoverWord === word` (this powers map↔board linking — stepB-3 consumes it).
6. `btn-reset-game` → `resetGame()` with a confirm.
7. Per-team remaining counters derived from tiles — small and low-prominence; the role/color legend itself is NOT a permanent element but a small "מקרא" button opening a popover (locked v2 design decision).

## Cuttable if behind (in this order)

key-card auto color detection (keep tap-to-assign), OCR image preprocessing, selection-order badges, remaining counters. NOT cuttable: typing grid, key tap-assign, demo path, lifecycle toggle + visuals.

## Sync & done

Push `btn-skip-demo` early (see above). SYNC B checkpoint at 2:00. Done = typecheck clean, your two specs green via your tester, demo path → full board renders → tiles toggle lifecycle and the store reflects it (assert via `window.__store`).
