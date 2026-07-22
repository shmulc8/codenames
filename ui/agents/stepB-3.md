# Agent: stepB-3 — Check-my-word + semantic map

Worktree `wt-stepB-3`, branch `stepB-3`, from `main` after `phase-a-done`. Time budget: **2h15m**. Read `agents/00-orchestration.md` + `agents/01-CONTRACTS.md` first. You own `src/features/check/**`, `src/features/map/**`, `tests/e2e/check.spec.ts`, `tests/e2e/map.spec.ts`. Replace the `CheckPanel` and `SemanticMap` stubs only. First step: `npm install` and `export PW_PORT=5176` for every dev/test run (CONTRACTS §5). Develop against the mock board via `window.__store` (don't depend on stepB-1's UI); spawn your tester (FEATURE=check+map, SPECS=check.spec.ts,map.spec.ts) early.

Framing (locked product decision): there is no "guesser" persona. Check-mode is the spymaster **privately sanity-checking a word before saying it aloud**. All copy is first-person: input label "המילה שאני שוקל", button "בדוק את הרמז", results framed as "אילו מילים זה עלול למשוך?".

## Part 1 — CheckPanel (`src/features/check/`) — build `agents/design/screens/desktop-2c-check-word.png`

1. `check-input` (Hebrew text input) + `btn-check` → `postCheck(liveBoard(state), store.target, clue)` → render `check-result`. Loading + `ApiError` toast. Check-mode inherits `store.target` (the team you're testing the word _for_, so "בטוח ל-N" is meaningful); surface a small read-only target indicator with the team `RoleIcon`, and let the same `target-color` control (shared store) switch it. Team-agnostic — no `myColor`.
2. **Illegal clue** (`illegal: true`) → `check-illegal` red banner: "המילה הזו לא חוקית — היא מילה מהלוח או חולקת שורש עם אחת מהן" — still render the read list below (it's informative).
3. **Ranked list** (`check-ranked-list`, rows `ranked-row-{word}`): all live words from `read`, best-first: rank, word, `RoleIcon`, bar of `conf*100` with numeric `sim-score-{word}`, header labeled "ציון קרבה (0–100)". Row hover → `setHoverWord` (board + map highlight). Use this copy: "המספרים מסמנים אילו מילים אחרות עלולות להתבלבל עם הרמז שלך".
4. **Verdict summary**: "בטוח ל-{safe} מילים" chip; `first_danger` line ("הסכנה הראשונה: {word} ({role})"); assassin line with rank: warn strongly (red) if `assassin.rank < safe + 2`.
5. Mount `FeedbackControls` with `mode="check"` and a synthetic `ClueOption` built from the CheckResponse (word=clue, count=safe, intended=first `safe` words of read, read, safe, note='') — a graded human idea is high-value training signal.
6. After a successful check, call `store.setCheckedClue(clue)` (already in the core store, CONTRACTS §3) — that's how the map learns what to plot in check mode.

## Part 2 — SemanticMap (`src/features/map/`) — headline feature, don't skimp

Prop-less (CONTRACTS §6): reads the store. `activeTab==='clue'` → clue = current option's `word`, targets = its `intended`; `activeTab==='check'` → clue = `checkedClue`, targets = `[]`.

1. On board/clue change call `postSpace(liveBoard(state), store.target, clue ?? undefined)`; render SVG (`semantic-map`, viewBox square, ~480px) — match the look of `agents/design/semantic-map-reference.svg` and `agents/design/screens/mobile-3e-map.png` (dark navy field, faint grid, glowing hint node; see DESIGN.md §9): every live word a dot `map-dot-{word}` colored+iconed by its **absolute role** straight from `--cn-<role>-*` (red/blue/neutral-cream/assassin — **no `myColor`**; tiny `RoleIcon` shape as the dot glyph itself for colorblind safety), positioned from `coords` ([-1,1]→viewBox). Per DESIGN.md §9: filled dot = a target of this clue, hollow ring = on-board-but-not-a-target. Chosen/out-of-play words are simply absent (liveBoard excludes them).
2. **Hint node** (`map-hint-node`): `clue_xy` with glow halo + label. No clue → render dots only with a hint-less legend.
3. **Lines** from hint to each target word; label hint, targets, and the 5 nearest dots by default; all others label-on-hover.
4. **Hover/tap a dot** → tooltip with word + similarity score (compute closeness client-side from coords distance to hint, normalized 0–100 across dots — labeled "קרבה משוערת"; when the read list is available for the same clue, prefer its `conf*100`). Hover also calls `setHoverWord`; and when `store.hoverWord` is set elsewhere, ring that dot (bidirectional link). Click pins the tooltip.
5. **Danger treatment** (`map-danger-{word}`): non-my dots closer to the hint than the farthest target get a pulsing warning ring; assassin dot always gets a distinct heavy ring.
6. `map-legend`: one line — "קרוב למרכז = קרוב לרמז" + role key with icons.
7. Debounce requests (400ms) and cache by (words,clue) so tab-switching doesn't refetch.

## Tester must cover

check: legal word renders ranked list with labeled scores; board-word input renders `check-illegal`; safe/danger summary correct vs mock fixture. map: dots for all live words with correct roles; hint node + lines when clue given; hover shows label+score; hovering a dot sets `window.__store` hoverWord; danger ring on the mock's close assassin; a chosen word's dot disappears after `toggleLifecycle`.

## Cuttable if behind

click-to-pin, pulsing animation (keep static ring), 5-nearest auto-labels (label targets only), map cache. NOT cuttable: check flow incl. illegal state, ranked list with labeled 0–100 scale, map dots-with-roles + hint + hover readout + danger marking.

## Sync & done

SYNC B at 2:00. Done = typecheck clean, both specs green, testids per CONTRACTS §7.
