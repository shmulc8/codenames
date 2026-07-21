# Agent: stepC-2 — Mobile board: pan/zoom canvas, gestures, mark-revealed sheet

Worktree `wt-stepC-2`, branch `stepC-2`, from `main` after `phase-b-done`. Time budget: **2h15m**. Read `agents/00-orchestration.md` (Phase C) + `agents/01-CONTRACTS.md` (§3 store, §4 Phase C, §7 mobile) + `agents/design/DESIGN.md` §3–§4, §7 (gestures) first. You own `src/mobile/board/**` and `tests/e2e/mobile-board.spec.ts` (via your tester). **Team-agnostic — tiles are red/blue/neutral/assassin, no `myColor`.** Consume the store as-is (lifecycle actions already exist).

**FIRST TASK: desktop-regression baseline.** `npm install`, `export PW_PORT=5179`, run the FULL `npm run test:e2e` green before writing mobile code. You never edit a desktop file.

## Build (screens: `mobile-3b-board.png`, `mobile-3c-mark-revealed.png`, `mobile-4d-gestures.png`)

1. **Pan/zoom canvas** (`src/mobile/board/PanZoomCanvas.tsx`, `data-testid="board-canvas"`, bg `--cn-board-void`): renders the same 25 tiles (reuse the cream-card tile look — import the tile renderer if stepB-1 exported it, else replicate the CSS from `simple-html/card-states.html`) inside a transform layer. Loads **zoomed-to-fit** (whole board visible). Cards are never permanently shrunk; the user pans/zooms to read them. Tiles keep `tile-{i}` + `data-word`/`data-role`/`data-lifecycle`.
2. **Gestures via Pointer Events (no library), per DESIGN.md §7:** drag = pan (momentum, clamped to board bounds with soft rubber-band); two-finger pinch = zoom (min = fit width, max = one card fills screen); double-tap = zoom-to-point, again = fit. **Tap-vs-pan disambiguation: a pointer that moves < ~10px is a TAP, not a pan** — so a slightly-imperfect tap still selects. `btn-fit-board` returns to fit; optional `minimap` thumbnail. Honor `prefers-reduced-motion` (snap, no inertia) and provide a non-gesture fallback (a simple scrollable compact list) so the board is never gesture-only.
3. **Tap-to-focus → mark-revealed bottom sheet** (`sheet-mark-revealed`, screen `mobile-3c`): tapping a tile opens a bottom sheet showing the word, its role (`RoleIcon` + color), a "מי לקח?" 4-way `sheet-chosenby-{red|blue|neutral|assassin}` (defaults to the tile's own color), and `btn-mark-chosen` "סמנו כנחשפה" → `store.toggleLifecycle(word, chosenBy)`. Re-opening a chosen tile offers "החזר למשחק". This sheet is the mobile lifecycle surface — desktop's per-tile `btn-lifecycle` is unchanged and untouched.
4. **Selection on mobile**: tapping while in the clue tab context still routes team-word selection through `store.toggleSelected` (store enforces same-color clusters + toasts) — keep the focus sheet's primary action context-aware (select vs mark), or expose both actions in the sheet. Assassin-chosen shows the board-level "המתנקש נחשף — סוף משחק" banner (store-driven, same as desktop).

## Desktop-regression duty (biggest concern)

The pan/zoom board is mobile-only and must never mount on desktop (guard with `useLayout`/viewport). At every checkpoint + before merge: run the FULL desktop suite and confirm the desktop board (stepB-1) is visually and behaviorally unchanged. Any desktop diff = stop and fix.

## Tester (FEATURE=mobile-board, SPECS=mobile-board.spec.ts)

At mobile viewport, driving `window.__store` for board setup: tiles render on the canvas with correct roles; a synthetic small-move pointer = tap opens the sheet, a large-move drag pans (assert transform changed, sheet did NOT open); `btn-fit-board` resets; marking chosen via the sheet flips `window.__store` lifecycle + defaults `chosenBy` to tile role; assassin banner appears. **Mandatory desktop-regression block: at desktop viewport `board-canvas` is absent and the full desktop suite stays green.** (Gesture tests: dispatch Pointer Events with controlled coordinates — no real touch needed.)

## Cuttable if behind

minimap, momentum/inertia (keep clamped pan), double-tap zoom (keep pinch + fit button). NOT cuttable: fit-to-load canvas, tap-vs-pan threshold, mark-revealed sheet, non-gesture fallback, desktop-regression spec.

## Sync & done

SYNC C (re-run FULL desktop suite). Merge order: after stepC-1. Done = typecheck clean, `mobile-board.spec.ts` green, desktop suite still green, testids per CONTRACTS §7.
