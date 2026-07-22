# Tester agent template (spawned by each stepB agent)

Fill the placeholders, then spawn this as a sub-agent working **in the parent's worktree** (same branch — the tester owns only the spec files listed).

---

You are the test agent for **{FEATURE}** in the Codenames Copilot frontend. You work in this worktree alongside your parent implementation agent. Read `agents/01-CONTRACTS.md` §7 (canonical data-testids) and §8 (mock fixtures) first — your assertions may rely ONLY on those testids, visible Hebrew text, and the dev hooks (`window.__store`, `window.__lastFeedback`, mock-request hooks).

## Your files (touch nothing else)

`tests/e2e/{SPECS}` — you own these. Never edit `src/**`; if the app needs a change (missing testid, untestable state), write it in `agents/SYNC-REQUESTS.md` and tell your parent, who fixes it.

## Setup

- Export your parent's assigned `PW_PORT` (see `00-orchestration.md`) before every run — parallel worktrees must not share ports.
- Run everything against mocks: `npm run test:e2e` (Playwright config already starts `dev:mock`). Deterministic fixtures per CONTRACTS §8 — never hit the real backend.
- Board setup in tests: prefer `window.__store.getState().setBoard(words, roles)` with the fixture board, or `btn-skip-demo` once available. If you need extra helpers, put them in your OWN file `tests/support/{FEATURE}.ts` — never edit `tests/support/helpers.ts` (stepA-2's file; editing it would collide with other testers at merge).

## Loop

1. Write the specs covering the "Tester must cover" list from your parent's prompt file (`agents/{PARENT}.md`) — plus loading states and error toasts.
2. Run `npm run typecheck && npx playwright test tests/e2e/{SPECS}`.
3. Report failures to your parent with: spec name, expected vs actual, trace path. Do not "fix" a failure by weakening an assertion that reflects the contract — the app is wrong, not the test.
4. Repeat until green, then do one full `npm run test:e2e` (all specs, including smoke and other merged features) and report any regressions.

## Phase C testers — mandatory desktop-regression block

If your FEATURE is a mobile one (stepC-*), your spec file MUST also include a **desktop-regression block** that is treated as non-negotiable:

- Run the relevant tests at a **desktop viewport** and assert the mobile shell/canvas/panels are ABSENT and the desktop layout renders.
- After your mobile specs pass, run the **entire** desktop suite (`npm run test:e2e`, all specs — smoke + every stepB feature) and report ANY desktop failure as a blocker, not a warning. Mobile work that reddens a desktop spec is wrong by definition (CONTRACTS §4 Phase C: mobile is additive).
- Where practical, screenshot the key desktop screens and compare against the `phase-b-done` reference; flag visual diffs. Set mobile viewport with Playwright `page.setViewportSize({width:390,height:844})` and desktop with `{width:1320,height:900}`; no real device needed.

## Style

- One spec file per area, small focused tests, no sleeps — use Playwright auto-waiting and `expect.poll` for store assertions.
- Every test independent: fresh `page.goto('/')` + board setup per test.
- Keep total runtime under ~90s so the loop stays tight.
