# Agent: stepC-4 — Mobile clue + map tabs (responsive re-layout)

Worktree `wt-stepC-4`, branch `stepC-4`, from `main` after `phase-b-done`. Time budget: **2h**. Read `agents/00-orchestration.md` (Phase C) + `agents/01-CONTRACTS.md` (§3, §4 Phase C, §6, §7) + `agents/design/DESIGN.md` §5 (mobile-3d/3e), §8 (feedback), §9 (map) first. You own `src/mobile/panels/**` and `tests/e2e/mobile-panels.spec.ts` (via your tester). **Team-agnostic — the target-team control and same-color clusters work exactly as on desktop (CONTRACTS §1–§3); no `myColor`.**

**FIRST TASK: desktop-regression baseline.** `npm install`, `export PW_PORT=5181`, run the FULL `npm run test:e2e` green before writing mobile code. You never edit a desktop feature file — you **reuse `CluePanel`, `CheckPanel`, `SemanticMap`, `FeedbackControls`, `SessionLog` as-is** inside mobile-friendly wrappers.

## Build (screens: `mobile-3d-clue.png`, `mobile-3e-map.png`)

1. **Mobile clue tab** (`src/mobile/panels/MobileCluePanel.tsx`): a single-column, scrollable re-layout that mounts the existing `CluePanel` (stepB-2) — target-team control, risk dial, request buttons, result card, carousel, warnings, `FeedbackControls`. Only CSS/container changes for a 390px width; **no behavior changes, no forked logic.** Inline feedback follows DESIGN.md §8 (quiet "עזר?" 👍/👎 line inside the clue card, expands in place — never a modal).
2. **Mobile check tab**: same wrapper approach around `CheckPanel` (stepB-3) — the check tab in the bottom nav (`tab-check`).
3. **Mobile map tab** (`tab-map`, screen `mobile-3e`): mounts `SemanticMap` (stepB-3) full-bleed on its own tab (map and board share space via tabs, never side-by-side on mobile — DESIGN.md §9). Keep the legend line "קרוב למרכז = קרוב לרמז" and the danger rings. Bidirectional dot↔tile highlight still works via `store.hoverWord`.
4. **Session log** on mobile: `SessionLog` (stepB-4) as a slide-up/collapsible sheet reachable from the clue tab, not a permanent side panel.
5. The clue/map/check tabs are hosted by stepC-1's `MobileShell` tab bar; you provide the panel components it renders. Coordinate the component names via `SYNC-REQUESTS.md` if stepC-1 hasn't merged yet; until then mount them behind `?mobile=1` in your own dev.

## Desktop-regression duty (biggest concern)

You reuse desktop components without editing them — so desktop must be byte-identical in behavior. Before every checkpoint + merge: run the FULL desktop suite and confirm the desktop clue panel, check panel, and map are unchanged. Any desktop diff = stop and fix (most likely a shared-CSS leak — scope all mobile CSS under a `.mobile` root).

## Tester (FEATURE=mobile-panels, SPECS=mobile-panels.spec.ts)

At mobile viewport with a fixture board via `window.__store`: clue tab renders target control + get-clue and produces option 0; risk/target changes still post correctly (reuse the same `window.__lastSpymasterReq` assertions); map tab renders dots for all live words with roles + hint node; check tab renders the ranked list. **Mandatory desktop-regression block: full desktop suite stays green; desktop clue/check/map specs unchanged.**

## Cuttable if behind

mobile session-log sheet (keep it reachable via the log-toggle), map click-to-pin on mobile. NOT cuttable: mobile clue tab (reusing CluePanel), mobile map tab, no desktop behavior change, desktop-regression spec.

## Sync & done

SYNC C (re-run FULL desktop suite). You merge LAST in Phase C; then the integrator tags `phase-c-done` after the full suite + desktop screenshot diff pass. Done = typecheck clean, `mobile-panels.spec.ts` green, desktop suite still green, testids per CONTRACTS §7.
