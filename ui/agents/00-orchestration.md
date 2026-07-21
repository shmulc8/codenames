# Orchestration — Codenames Copilot Frontend (4-hour multi-agent build)

Read this first. Then every agent reads `01-CONTRACTS.md` before writing any code.

## What we're building

A Hebrew, RTL, **desktop-first for Phases A/B, then mobile in Phase C** React frontend for the Codenames spymaster copilot. The AI backend already exists and is reached **only via HTTP** at `https://shmulc-hebrew-codenames-copilot.hf.space` (Flask, endpoints documented in CONTRACTS). No backend work. Must-haves, in priority order:

0. **Team-agnostic model (read CONTRACTS §1–§3 + DESIGN.md §1 first).** The app is an analyzer of the board in front of you — it **never asks "which team are you on."** Every tile carries its REAL key-card color (`red|blue|neutral|assassin`); there is NO `myColor`/"mine/opponent". A clue is always requested *for one team color* (`store.target`), selecting a same-color cluster. The engine's `my|opp` wire vocabulary lives ONLY inside `src/api/client.ts` (CONTRACTS §1 mapping).
1. **Photo input** — photograph the 5×5 word board (OCR + manual correction) and the key/layout card (color detection → red/blue/neutral/assassin + tap-to-correct). This is non-negotiable.
2. **Get a clue** — pick the target team + a same-color cluster (or let the engine auto-pick), risk dial, browse up to 10 options, reasoning + danger warnings.
3. **Check my word** — spymaster privately tests a hint word they thought of (there is NO guesser mode in this app).
4. **Semantic map** — interactive 2D map: hint at center, all board words as color-coded dots, hover for word+score, danger highlighting.
5. **Likes/feedback** — 👍/👎 on clues + automatic outcome feedback when cards are marked chosen; sent to `/api/feedback` for training.
6. **Board lifecycle** — mark cards chosen/out-of-play (with who claimed them); engine requests always use only live words.

**Phase C (mobile) — in scope, built AFTER A+B (see roster + timeline).** The full mobile app from DESIGN.md §5–§7 (camera capture flow, pan/zoom board canvas, tap-vs-pan gestures, mark-revealed bottom sheet, bottom-tab nav, landscape rail). Phase C's overriding constraint: **it must not regress any desktop screen** — every StepC agent re-runs the full desktop e2e suite and visually checks the PC screens before merging (see each StepC prompt).

Cut from scope (do NOT build): guesser/operative screen, real-board skeuomorphic portrait skin (ui-changes.md Change 5), `/game`, engine/model pickers, secrecy PIN.

## Repo & worktree setup (human runs this once, before agents start)

```bash
mkdir codenames-copilot && cd codenames-copilot && git init -b main
cp -r <this>/agents ./agents
git add -A && git commit -m "agents prompts + contracts"
# NOTE: the agents/ folder is the ONLY context agents need — the prompts are self-contained
# (all product decisions from the UX docs are distilled into them), and agents/design/ carries
# the visual language: DESIGN.md (the current approved design), nocturne-tokens.css (base
# design system, used as-is), tokens.css (app --cn-* role tokens), the two reference SVGs,
# screens/*.png (all 14 screens), and simple-html/*. Re-synced from the top-level design/ folder.
# Rationale/history lives in old-design/ui-changes.md + missing-ui-gaps.md (Changes 1–7): copy
# these in too now that mobile (Changes 6–7) is IN scope for Phase C — they are the mobile spec's
# source. Only Change 5 (real-board portrait skin) stays cut. CONTRACTS + prompts + DESIGN.md are
# the truth for behavior/looks; the old-design docs are rationale.
git branch stepA-1 && git branch stepA-2
git worktree add ../wt-a1 stepA-1
git worktree add ../wt-a2 stepA-2
```

After Phase A merges (see below):

```bash
for b in stepB-1 stepB-2 stepB-3 stepB-4; do git branch $b main; git worktree add ../wt-$b $b; done
```

After Phase B merges to main (`phase-b-done`), create the Phase C (mobile) worktrees:

```bash
for b in stepC-1 stepC-2 stepC-3 stepC-4; do git branch $b main; git worktree add ../wt-$b $b; done
```

**Worktrees do NOT share `node_modules`** — every worktree runs its own `npm install` as its first step (Playwright browser binaries are cached globally, so `npx playwright install chromium` downloads only once).

**Port assignment (prevents dev-server/Playwright collisions between parallel agents):** every agent exports `PW_PORT` before any `npm run dev*` or `npm run test:e2e` — the Vite/Playwright config reads it (CONTRACTS §5). stepA-2: 5173 · stepB-1: 5174 · stepB-2: 5175 · stepB-3: 5176 · stepB-4: 5177 · stepC-1: 5178 · stepC-2: 5179 · stepC-3: 5180 · stepC-4: 5181 · main integration: 5173.

If using a remote (recommended so agents can sync): create an empty remote, `git remote add origin …`, and every agent pushes its branch at each checkpoint. If fully local, "push" below means "commit on your branch" and other agents merge from the local branch name.

## Timeline (Phases A+B ≈ 4 hours; Phase C is a follow-on block)

| Time | What |
|---|---|
| 0:00–0:45 | **Phase A** — stepA-1 and stepA-2 run in parallel |
| 0:20 | SYNC A: stepA-1 pushes checkpoint commit `scaffold-ready`; stepA-2 merges it in |
| 0:45–1:00 | Merge stepA-1 → main, then stepA-2 → main. `npm install && npm run dev` + smoke Playwright test must pass on main. Tag `phase-a-done`. Create the 4 stepB worktrees. |
| 1:00–3:15 | **Phase B** — stepB-1..4 run in parallel; each spawns its tester agent (see `tester-template.md`) as soon as it has a first working screen |
| 2:00 | SYNC B: every stepB agent pushes a checkpoint commit, and merges `main` (nothing should have changed) — this is a health check that each branch still builds |
| 3:15–3:45 | Merge to main **in order**: B-1, B-2, B-3, B-4. After each merge run `npm run typecheck && npm run test:e2e`. Fix before merging the next. After the last merge, the integrator writes `tests/e2e/integration.spec.ts` (owned by main only — no branch touches it): one full-flow test crossing all features: demo board → pick target team + select 2 same-color words → get clue → like it → use it → mark 2 tiles chosen → assert stale overlay, outcome feedback in `window.__lastFeedback`, log entry with reveals, and the chosen words gone from the map. |
| 3:45–4:00 | Full run on main against the **real** backend (mocks off): deal a board via 📷 photos, get a clue, check a word, like it, mark cards chosen. **Hit `/api/health` first** — the HF Space may be asleep and the first request slow; wake it before the demo. Tag `phase-b-done`. This is the desktop baseline Phase C must never regress — capture desktop screenshots here as the regression reference. |

If an agent falls behind, it cuts its own "nice-to-have" list (each stepB prompt marks what's cuttable) — never the contract interfaces.

### Phase C — mobile (follow-on, after `phase-b-done`)

| Time | What |
|---|---|
| C+0:00 | Create the 4 stepC worktrees from `main`. stepC-1..4 run in parallel; each spawns its tester. |
| C+0:00 (each agent, FIRST task) | Establish the **desktop regression baseline**: run the full `npm run test:e2e` on a fresh checkout and confirm green + visually spot-check the desktop screens. Nothing mobile starts until desktop is green on your branch. |
| C+mid | SYNC C: every stepC agent pushes a checkpoint and merges `main`; re-run the FULL desktop suite (not just mobile specs) — desktop staying green is the health check. |
| C+end | Merge to main **in order**: C-1, C-2, C-3, C-4. **After each merge, run the complete e2e suite — desktop specs included — and diff desktop screenshots against the `phase-b-done` reference. A desktop regression blocks the merge; fix before proceeding.** Then tag `phase-c-done`. |

**Phase C's non-negotiable:** mobile work is additive and responsive-scoped — it must not alter desktop layout, behavior, or the shared store/contracts. If a mobile need requires a shared-file change, it goes through `SYNC-REQUESTS.md` like any other, and the desktop suite must still pass. Regression testing the PC screens is StepC's single biggest concern — do it early, often, and before every merge.

## Sync rules (all agents)

- `01-CONTRACTS.md` is law: file ownership, types, store shape, testids. **Never edit a file you don't own.** If you need a change in someone else's file, write the request in `agents/SYNC-REQUESTS.md` (append-only, one line per request: `[from]→[to]: what & why`) and continue with a local workaround.
- `src/types/api.ts` is copied **verbatim** from CONTRACTS by both Phase A agents (identical bytes ⇒ no merge conflict). Nobody ever edits it.
- Commit early, commit often, push at every checkpoint. Merge conflicts on a file you don't own: take **their** version.
- Everything must be automation-testable: every interactive element gets its canonical `data-testid` from CONTRACTS. Tests run against MSW mocks (`VITE_USE_MOCKS=1`) so they're deterministic and never depend on the HF Space being awake.

## Agent roster

| Agent | Prompt file | Branch/worktree | Owns | Primary screens |
|---|---|---|---|---|
| stepA-1 | `stepA-1.md` | stepA-1 / wt-a1 | scaffold, package.json, vite config+proxy, API client, app shell, feature stubs | shell of `desktop-3a-main` |
| stepA-2 | `stepA-2.md` | stepA-2 / wt-a2 | Zustand store, theme/base components, MSW mocks+fixtures, Playwright setup, smoke test | (design system for all) |
| stepB-1 | `stepB-1.md` | stepB-1 / wt-stepB-1 | photo capture + OCR + key-card colors, board grid, tile lifecycle | `desktop-4a-board-input`, `desktop-1d-card-states`, board of `desktop-3a-main` |
| stepB-2 | `stepB-2.md` | stepB-2 / wt-stepB-2 | clue generation panel, target-team + risk dial, options carousel, warnings | clue column of `desktop-3a-main` |
| stepB-3 | `stepB-3.md` | stepB-3 / wt-stepB-3 | check-my-word mode, semantic map | `desktop-2c-check-word`, map panel of `desktop-3a-main` |
| stepB-4 | `stepB-4.md` | stepB-4 / wt-stepB-4 | likes/feedback, outcome capture, session log | `feedback-4e`, log panel of `desktop-3a-main` |
| stepC-1 | `stepC-1.md` | stepC-1 / wt-stepC-1 | mobile app shell: bottom-tab nav, home/entry, landscape side-rail, responsive breakpoints | `mobile-1b-home`, `mobile-3f-landscape` |
| stepC-2 | `stepC-2.md` | stepC-2 / wt-stepC-2 | mobile board: pan/zoom canvas, tap-vs-pan gestures, mark-revealed bottom sheet | `mobile-3b-board`, `mobile-3c-mark-revealed`, `mobile-4d-gestures` |
| stepC-3 | `stepC-3.md` | stepC-3 / wt-stepC-3 | mobile camera capture flow (board + key card), review/correction | `mobile-4b-camera`, `mobile-4c-review` |
| stepC-4 | `stepC-4.md` | stepC-4 / wt-stepC-4 | mobile clue + map tabs (responsive re-layout of stepB panels) | `mobile-3d-clue`, `mobile-3e-map` |
| tester-* | `tester-template.md` | inside parent's worktree | that feature's `tests/e2e/*.spec.ts` | — |

Each stepB **and stepC** agent **must** spawn its tester sub-agent (prompt = `tester-template.md` with placeholders filled) and iterate until that tester reports green. A feature is not done until its e2e spec passes. **stepC testers additionally own a desktop-regression check** — they run the full desktop suite and fail loudly on any desktop regression (see `tester-template.md` Phase-C note).

Every one of the 14 screens in `agents/design/screens/` is owned above; the "Primary screens" column is the map. Desktop screens ship in Phases A/B; mobile screens in Phase C.
