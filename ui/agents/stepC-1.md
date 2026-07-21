# Agent: stepC-1 — Mobile app shell: bottom-tab nav, home, landscape rail

Worktree `wt-stepC-1`, branch `stepC-1`, from `main` after `phase-b-done`. Time budget: **2h**. Read `agents/00-orchestration.md` (Phase C section) + `agents/01-CONTRACTS.md` (§4 Phase C ownership, §7 mobile testids) + `agents/design/DESIGN.md` §2, §5 (mobile), §7 first. You own `src/mobile/shell/**` and `tests/e2e/mobile-shell.spec.ts` (via your tester). **Team-agnostic model applies unchanged (CONTRACTS §1–§3) — no `myColor`.**

**FIRST TASK (before any mobile code): establish the desktop-regression baseline.** `npm install`, `export PW_PORT=5178`, run the FULL `npm run test:e2e` and confirm green; note the desktop screens render. Phase C's prime directive: **do not regress desktop.** You never edit a desktop file — you only add `src/mobile/**`.

## Build (match the referenced screens)

1. **Responsive layout hook** `src/mobile/shell/useLayout.ts`: returns `'mobile' | 'desktop'` from a `matchMedia('(max-width: 700px)')` + `pointer:coarse` check; SSR-safe, updates on resize. This is the ONLY switch between shells.
2. **MobileShell** (`src/mobile/shell/MobileShell.tsx`, `data-testid="mobile-shell"`): the mobile frame — dark app bg (`--cn-app-bg`), a fixed **bottom tab bar** (`tabbar`) with four tabs `tab-board` לוח / `tab-clue` רמז / `tab-check` בדיקה / `tab-map` מפה (44px+ hit targets, `--cn-panel` bg, active tab uses accent). Tabs drive which panel shows; wire `tab-clue`/`tab-check` to `store.activeTab`. `board` shows the mobile board (stepC-2's component when merged — until then a placeholder), `map` shows `SemanticMap`. Renders the setup/home flow when `store.screen==='setup'`.
3. **MobileHome** (`mobile-home`, screen `agents/design/screens/mobile-1b-home.png`): camera-first entry — big "צלמו את הלוח" primary (`btn-shoot`, routes to stepC-3 capture when merged; placeholder until then), plus `btn-random` (אקראי → `getDeal()`→`setBoard`) and `btn-resume` (resume in-progress game, shown only when `store.tiles.length===25`).
4. **Landscape side-rail** (`mobile-3f-landscape.png`): under `(orientation: landscape)` the bottom tab bar rotates to a **side rail** (camera-app style) — same testids, re-flowed with CSS only. Honor `prefers-reduced-motion`.
5. **Integration point (via `SYNC-REQUESTS.md`):** request the one-line delegation in `src/screens/MainScreen.tsx` — `useLayout()==='mobile' ? <MobileShell/> : <existing desktop layout>`. Provide the exact diff in your request; the integrator applies it at merge. Until then, mount MobileShell behind a `?mobile=1` query flag in your own dev so you can build/test without touching MainScreen.

## Desktop-regression duty (your biggest concern)

At every checkpoint and before merge: run the FULL desktop suite (`npm run test:e2e`, all specs) and confirm the desktop screens are visually unchanged vs the `phase-b-done` reference. Any desktop diff = stop and fix. Your tester owns an explicit desktop-regression spec (see tester note).

## Tester (spawn early: FEATURE=mobile-shell, SPECS=mobile-shell.spec.ts)

At mobile viewport: tabbar renders four tabs and switches panels; home shows shoot/random/resume; random deals a board and enters game; landscape moves nav to the rail. **Plus the mandatory desktop-regression block: at desktop viewport the desktop layout still renders (no `mobile-shell`), and the full desktop suite stays green.**

## Cuttable if behind

landscape rail (keep bottom bar, let it wrap), resume button. NOT cuttable: `useLayout`, MobileShell + tabbar, MobileHome, desktop-regression spec.

## Sync & done

SYNC C checkpoint (re-run FULL desktop suite). You merge FIRST in Phase C. Done = typecheck clean, `mobile-shell.spec.ts` green, desktop suite still green, testids per CONTRACTS §7.
