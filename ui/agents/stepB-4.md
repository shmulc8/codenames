# Agent: stepB-4 — Likes/feedback pipeline + session log

Worktree `wt-stepB-4`, branch `stepB-4`, from `main` after `phase-a-done`. Time budget: **2h15m**. Read `agents/00-orchestration.md` + `agents/01-CONTRACTS.md` first. You own `src/features/feedback/**`, `src/features/log/**`, `tests/e2e/feedback.spec.ts`. Replace the `FeedbackControls` and `SessionLog` stubs only. First step: `npm install` and `export PW_PORT=5177` for every dev/test run (CONTRACTS §5). Develop via `window.__store` + mock board; spawn your tester (FEATURE=feedback, SPECS=feedback.spec.ts) early.

Purpose (locked product decision): feedback rows are **training data** — maximize volume and quality. Two signal types: instant gut-check (👍/👎 at generation time) and, more valuable, **outcome feedback** derived automatically from what the team actually revealed after a clue was used. `/api/feedback` never fails the caller; treat it as fire-and-forget with a silent retry.

## Part 1 — FeedbackControls (`src/features/feedback/`)

Props: `{ option: ClueOption; mode: 'suggest' | 'check'; risk: Risk }` (frozen).

1. **uid**: helper `getUid()` — random id persisted in `localStorage['cn-uid']`.
2. `btn-like` 👍 / `btn-dislike` 👎. On click POST `FeedbackPayload`: `{uid, verdict, mode, target: store.target, risk, clue: option.word, count, intended, focus: store.selected, board: fullBoard(state), revealed: currentRevealed(), option}` where `currentRevealed()` maps chosen tiles to `RevealedEntry[]` (each `chosenBy` an absolute color). `target` is required (CONTRACTS §2) — the API client uses it to wire-map `board.roles` + `revealed[].chosenBy` before sending; you just pass the absolute-color data. On 👎 first show `feedback-why` — five tag chips: הפוך/מעורפל/שגוי/מסוכן/מוגזם → `why: opposite|vague|wrong|risky|overreach`. After either verdict, reveal optional `feedback-comment` textarea + send ("ספרו לנו עוד — לא חובה"). Show `feedback-sent` ("תודה! זה עוזר לאמן את המודל") and lock the buttons for this option.
3. Reset the widget's local state whenever `option.word` changes (each carousel option gets its own verdict).
4. **Send-queue** `src/features/feedback/queue.ts`: wraps `postFeedback` — on failure keep in an in-memory queue and retry every 30s; never toast an error (feedback must never interrupt play).

## Part 2 — Outcome capture (the automatic, high-value signal)

5. A non-rendering `<OutcomeReporter/>` component in `src/features/feedback/`; mount it inside your own `SessionLog` (always rendered in the game screen), so it lives regardless of which tab is active. Subscribe to the store: when `clue.used` exists and its `revealedAfter` grows, debounce 5s, then send `{verdict: 'outcome', mode: 'outcome', uid, target/clue/count/intended/option/risk from the UsedClue, board: usedClue.board, revealed: revealedAfter}` and mark `outcomeSent` (re-send updated rows if more reveals arrive before a new clue is used — last write wins server-side, each is a full row). Also flush when a new clue is used or board resets.

## Part 3 — SessionLog (`src/features/log/`)

6. Collapsible panel (`session-log`, toggle `log-toggle` "יומן רמזים"), listing `store.log` entries (`log-entry-{i}`): clue word + count, its team (`entry.target` `RoleIcon`), risk, time, intended chips, and its outcome so far (revealedAfter rendered as word+`RoleIcon`, green when `chosenBy === entry.target` — the clue's own team claimed the card — amber/red when a non-target/assassin card was hit). Newest first. Empty state: "עוד לא ניתנו רמזים במשחק הזה". Match `agents/design/screens/feedback-4e.png` for the inline-feedback styling.
7. Log entries make repeats visible — if the user requests a clue that equals a logged clue word, show a small inline "כבר השתמשת ברמז הזה" marker (read-only check inside the log render; do not touch stepB-2's files).

## Tester must cover

👍 sends payload (assert `window.__lastFeedback`: verdict, `target`, uid stable across reloads, full 25-word board with roles wire-mapped for the target, option attached); 👎 requires a why-tag and includes it; widget resets per option (drive `setOptionIndex` via `window.__store`); outcome: use-clue then `toggleLifecycle` two tiles → after debounce `__lastFeedback` has `verdict:'outcome'` and both `RevealedEntry`s; log shows the used clue with its reveals; queue retries after a mocked 500 (set the `window.__failFeedbackOnce` hook — built into the mock handlers, CONTRACTS §8).

## Cuttable if behind

repeat-clue marker, comment textarea (keep why-tags), retry queue (keep fire-and-forget). NOT cuttable: like/dislike with full payload, outcome capture, session log list.

## Sync & done

SYNC B at 2:00. You merge LAST (after B-1..B-3). Done = typecheck clean, `feedback.spec.ts` green, testids per CONTRACTS §7.
