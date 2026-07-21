# Agent: stepB-2 — Clue generation panel

Worktree `wt-stepB-2`, branch `stepB-2`, from `main` after `phase-a-done`. Time budget: **2h15m**. Read `agents/00-orchestration.md` + `agents/01-CONTRACTS.md` first. You own `src/features/clue/**` and `tests/e2e/clue.spec.ts` (via your tester). Replace the `CluePanel` stub only; consume the store and `src/api/client.ts` as-is.

Until stepB-1's demo path lands on its branch, develop by driving `window.__store.getState().setBoard(...)` with the mock fixture board (your tester does the same — tests must NOT depend on stepB-1's UI).

First step: `npm install` and `export PW_PORT=5175` for every dev/test run (CONTRACTS §5). Spawn your tester (FEATURE=clue, SPECS=clue.spec.ts) once the happy path renders; iterate until green.

Build the clue column of `agents/design/screens/desktop-3a-main.png`. **Team-agnostic (CONTRACTS §1–§3, DESIGN.md §1): a clue is always for ONE team color.** No `myColor`.

## Build

0. **Target-team control** (`target-color`, opts `target-red`/`target-blue`): a segmented control bound to `store.target` / `setTarget`, labels אדום/כחול with the role `RoleIcon` on each. It sits atop the request row and answers "רמז עבור איזו קבוצה?". Selecting a same-color cluster on the board auto-sets `target` to that color (store does this); this control is how the user picks a color for **auto-cluster** when nothing is selected, and switching it clears the current selection (store rule). Show the selected-cluster chips ("נבחרו: X קלפים בצבע {color}") next to it — same-color only, per DESIGN.md.
1. **Request row**: `btn-get-clue` ("קבל רמז לקלפים שבחרתי", disabled when selection empty) and an equal-weight `btn-auto-cluster` ("מצא לי את הצירוף הכי טוב") that sends **no focus** — the engine auto-picks the best cluster **of `store.target`**. Both call `postSpymaster(liveBoard(state), store.target, focus?, risk)` → `setClueResult` (`focus = store.selected` for the focused button, omitted for auto-cluster). Loading state on buttons + `loading-spinner`; `ApiError` → toast.
2. **Risk dial** (`risk-dial`, options `risk-{cautious|balanced|bold}`): three-way segmented control bound to `store.risk`, labels זהיר/מאוזן/נועז, with an inline plain-language tooltip: "זהיר = רק רמזים בטוחים · מאוזן = כיסוי בטוח · נועז = מקסימום מילים". Place it INSIDE this panel next to the buttons (it only affects clue generation).
3. **Result card** (`clue-result`) for `options[optionIndex]`: big `clue-word`, `clue-count` ("מספר: N"), intended words as chips (hovering a chip sets `hoverWord` → highlights the board tile), `clue-reason` text, and a mini ranked bar list from `option.read` top-8 (word, `RoleIcon`, conf×100 bar) labeled "ציון קרבה 0–100".
4. **Warnings**: if `option.risky` → `warning-banner` (yellow) with `option.note` + the leak words as chips (hover-link them too). If `option.no_clue` → `no-clue-state`: the note + guidance "נסה רמת 'נועז' או בחר מילים אחרות". If response has top-level `error` → same empty state. Always show assassin proximity line when `option.assassin.sim != null`: "המתנקש ({word}) במקום {rank+1} בדירוג".
5. **Options carousel**: `btn-prev-option`/`btn-next-option` cycle `optionIndex` over `options`; `option-counter` shows "אפשרות {i+1} מתוך {options.length}" — it's a position counter, never render it as if it were a score.
6. **Use this clue**: `btn-use-clue` ("אני משתמש ברמז הזה") → `store.useCurrentClue()`; shows a confirmation state. This is what arms outcome-feedback capture (stepB-4) — call the store action, nothing else.
7. **Staleness**: when `store.clue.stale` is true render an overlay on the result: "הלוח השתנה — הרמז חושב על לוח ישן" + a regenerate button re-running the last request (same focus/risk).
8. Mount `FeedbackControls` (stub until stepB-4 merges) under the result card: `<FeedbackControls option={current} mode="suggest" risk={risk} />`.

## Tester must cover

auto-cluster + focused requests hit the mock and render option 0; risky option shows `warning-banner`; no_clue option shows `no-clue-state`; carousel cycles and counter updates; risk dial changes the posted `risk` and auto-cluster omits `focus`; the target-color control changes `store.target`, and switching it clears the selection; the posted board roles are wire-mapped for the target (assert via `window.__lastSpymasterReq` — the target color's words read as `my`, the other team as `opp`, per CONTRACTS §8); use-clue pushes to `window.__store` log (with its `target`); stale overlay appears after `toggleLifecycle`.

## Cuttable if behind

mini ranked list in result card (keep warnings), hover-linking chips, regenerate-on-stale (keep the stale overlay itself). NOT cuttable: target-team control, both request buttons, risk dial, carousel, warnings/no-clue states, use-clue.

## Sync & done

SYNC B at 2:00. Done = typecheck clean, `clue.spec.ts` green, all testids from CONTRACTS §7 present.
