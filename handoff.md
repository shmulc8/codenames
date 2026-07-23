# Phase C (Mobile) — Handoff

**Date:** 2026-07-22
**Author:** Claude (orchestrator session)
**Branch:** `stepC` @ `30b0e66` in worktree `/Users/matanelgordon/Desktop/Projects/_worktrees/codenames1`
**App root:** `ui/` inside that worktree (all commands below assume cwd = `ui/`)
**Status:** ✅ All 4 mobile features built, code-reviewed, merged, and wired into the real app. Full Playwright suite green: **92 passed** (60 desktop + 32 mobile), `tsc --noEmit` clean.
**NOT done:** not pushed, not merged to `feature/ui`; no real-device/real-backend smoke; no visual screenshot diff. See §9–§11.

---

## 1. What this is

Phase C adds the **mobile (responsive) layer** on top of the already-complete desktop Codenames Hebrew spymaster copilot frontend. It is **purely additive** — every mobile file lives under `src/mobile/**`; desktop code was not modified except a single sanctioned delegation line in `src/screens/MainScreen.tsx` (CONTRACTS §4 integration point).

The app is a **team-agnostic board analyzer** (Hebrew, RTL). Tiles carry their real key-card color (`red|blue|neutral|assassin`); there is NO "mine/opponent" (`myColor`). `store.target` (`red|blue`) selects which team a clue/check/map request is *for*. The `my|opp` wire vocabulary lives ONLY in `src/api/client.ts`. Backend is HTTP-only at `https://shmulc-hebrew-codenames-copilot.hf.space`; all tests run against MSW mocks (`VITE_USE_MOCKS=1`), never the live Space.

The full product spec lives in the repo: `ui/agents/00-orchestration.md`, `ui/agents/01-CONTRACTS.md` (the law: file ownership §4, types §2/§3, testids §7, fixtures §8), the per-agent prompts `ui/agents/stepC-{1..4}.md`, and `ui/agents/design/DESIGN.md` + `ui/agents/design/screens/*.png` (14 screens). **Read those before touching anything.**

---

## 2. Repo / branch / worktree layout

```
/Users/matanelgordon/Desktop/Projects/
  codenames/                     ← MAIN repo, currently on feature/ui @ 634b487 (another session owns it)
  _worktrees/
    codenames1/  [stepC]   @ 30b0e66  ← INTEGRATION worktree (this is where you work). node_modules installed.
    codenames2/  [stepC-2] @ 2a2ea2b  ← individual feature branch (already merged into stepC)
    codenames3/  [stepC-3] @ 8278ba4  ← individual feature branch (already merged into stepC)
    codenames4/  [stepC-4] @ 41ae5db  ← individual feature branch (already merged into stepC)
```

`stepC` was branched from `feature/ui` @ `634b487` (tagged `phase-b-done`) and contains, in order:

```
30b0e66 feat(mobile): integrate Phase C — MainScreen delegates to MobileShell, wire board/panels/capture
c66f665 Merge branch 'stepC-4' into stepC
e9051d9 Merge branch 'stepC-3' into stepC
1ee5738 Merge branch 'stepC-2' into stepC
8278ba4 feat(mobile): stepC-3 camera capture flow — board + key card, reuse OCR/classify
41ae5db feat(mobile): stepC-4 mobile clue/check/map panel wrappers (reuse desktop panels)
2a2ea2b feat(mobile): stepC-2 pan/zoom board — gestures, mark-revealed sheet, non-gesture fallback
00dbcb9 feat(mobile): stepC-1 app shell — useLayout, MobileShell tabbar, MobileHome, landscape rail
634b487 (phase-b-done, feature/ui) Merge origin/feature/ui into feature/ui
```

The `stepC-1` branch commit `00dbcb9` lives inside the `stepC` history (stepC was created off stepC-1 then merged the others). Branches `stepC-1..4` still exist and can be deleted after `stepC` lands.

---

## 3. How it was built (context you need to trust the results)

Four autonomous CLI agents ran in parallel, one per worktree, each given a self-contained prompt (strict TDD, the repo skills `tdd`/`frontend-skill`/`vertical-slice`, exact testids/dev-hooks, desktop-safety rules, "don't stop until green"):

| Feature | Agent CLI | Model / effort | Port | Owns |
|---|---|---|---|---|
| stepC-1 shell | **codex** | `gpt-5.6-sol` / high | 5178 | `src/mobile/shell/**` + `mobile-shell.spec.ts` |
| stepC-2 board | **codex** | `gpt-5.6-sol` / high | 5179 | `src/mobile/board/**` + `mobile-board.spec.ts` |
| stepC-3 capture | **copilot** | `claude-opus-4.8` / xhigh | 5180 | `src/mobile/capture/**` + `mobile-capture.spec.ts` |
| stepC-4 panels | **copilot** | `claude-opus-4.8` / xhigh | 5181 | `src/mobile/panels/**` + `mobile-panels.spec.ts` |

**CRITICAL nuance about the codex agents (C1, C2):** codex ran in its `workspace-write` seatbelt sandbox, which **cannot launch Chromium** (`bootstrap_check_in … Permission denied (1100)`). So C1 and C2 could `tsc`/`build` but **never actually ran their own Playwright specs** — they wrote specs blind. Every bug in §7 below was caught by the orchestrator's independent test runs, NOT by the agents. **Any future e2e verification must be done by copilot (runs Chromium on-host) or by you directly — never rely on codex for browser tests.**

The copilot agents (C3, C4) DO run Chromium on-host and self-verified, but their results were still independently re-run by the orchestrator.

Agents did NOT run git, did NOT modify `package.json`, did NOT spawn sub-agents. The orchestrator committed each branch and did all merging/integration.

---

## 4. What was built — file inventory (src/mobile, 3164 lines total)

### shell (stepC-1) — the mobile frame + responsive switch
- `useLayout.ts` (38) — `'mobile'|'desktop'` from `matchMedia('(max-width:700px)')` OR `pointer:coarse`, SSR-safe via `useSyncExternalStore`. **THE single switch** between desktop and mobile.
- `MobileShell.tsx` (121) — dark frame, fixed bottom `tabbar` with 4 tabs `tab-board/clue/check/map`. `tab-clue`/`tab-check` reflect to `store.activeTab`; `tab-board`/`tab-map` are LOCAL state (deliberately NOT added to the store union, to keep desktop store byte-identical). Renders `MobileHome` when `store.screen==='setup'`, else the active panel. **After integration** it hosts the real `PanZoomCanvas` / `MobileCluePanel` / `MobileCheckPanel` / `MobileMapPanel`, and shows `CaptureFlow` when the home "shoot" button is pressed (`capturing` state).
- `MobileHome.tsx` (124) — camera-first entry: `btn-shoot` (→ `onShoot` opens CaptureFlow), `btn-random` (getDeal→setBoard, with loading + error toast), `btn-resume` (only when `tiles.length===25`).
- `shell.css` (292) — all scoped under `.mobile`. Landscape side-rail via `(orientation: landscape)`; honors `prefers-reduced-motion`.
- `index.ts` (3) — exports `MobileShell`, `MobileHome`, `useLayout`.

### board (stepC-2) — pan/zoom canvas + gestures + mark-revealed sheet
- `PanZoomCanvas.tsx` (119) — `board-canvas`, renders 25 tiles in a transform layer, fit-to-screen on load. **Returns `null` when `!isMobileViewport()` (`max-width:767px`)** — see known-bug §8a.
- `usePanZoom.ts` (268) — hand-rolled Pointer-Events gestures (no lib): pan w/ rubber-band clamp, pinch zoom (fit→one-card), double-tap zoom-to-point, **tap-vs-pan threshold (<10px = tap)**, reduced-motion snap. Well-decomposed into pure helpers.
- `MarkRevealedSheet.tsx` (108) — `sheet-mark-revealed`; word + role, 4-way `sheet-chosenby-{role}` (defaults to tile's own color), `btn-mark-chosen` → `store.toggleLifecycle`. Re-opening a chosen tile → "החזר למשחק". Routes clue selection through `store.toggleSelected`.
- `MobileBoardTile.tsx` (50), `board-model.ts` (20, board geometry constants + role labels), `mobile-board.css` (303), `index.ts` (1, exports `PanZoomCanvas`).
- `TestHarness.tsx` (41) — **TEST-ONLY** (see §9).

### capture (stepC-3) — two-step camera flow (words + key card)
- `CaptureFlow.tsx` (196) — orchestrates camera→review→key-card→`store.setBoard`. Reuses stepB-1's `warmOcrWorker`, `subscribeToOcrProgress`, `rotateRolesClockwise`. Props: `{ onClose }`.
- `CameraView.tsx` (116) — `camera-view`, `viewfinder`, `btn-shutter`/`btn-gallery`/`btn-flip`, getUserMedia w/ graceful gallery fallback.
- `WordReview.tsx` (88) — `review-grid`, `review-cell-{0..24}`, low-confidence amber edit, 25-unique-word validation.
- `KeyReview.tsx` (96) — role grid, tap-cycles role, live 9·8·7·1 validity, rotate.
- `CaptureHeader.tsx` (96), `ReviewFooter.tsx` (53), `ProcessingOverlay.tsx` (19), `useCamera.ts` (82), `keyGrid.ts` (46, pure helpers/validation), `capture.css` (434), `index.tsx` (1, exports `CaptureFlow`).
- `recognizers.ts` (26) — reuse seam: imports stepB-1 `recognizeBoard`/`classifyKeyCard`, overridable via `window.__captureRecognizers` (**test seam in prod** — §9).
- `mount.tsx` (44) — **TEST-ONLY** self-mount (see §9); modified by orchestrator (§7).

### panels (stepC-4) — mobile clue/check/map (reuse desktop panels as-is)
- `MobileCluePanel.tsx` (22) — wraps desktop `CluePanel` + collapsible `SessionLog`. CSS-only re-layout.
- `MobileCheckPanel.tsx` (13) — wraps `CheckPanel`.
- `MobileMapPanel.tsx` (15) — wraps `SemanticMap` full-bleed.
- `panels.css` (187) — all scoped under `.mobile`.
- `index.ts` (4) — exports the three panels + `MobilePanelsHost`.
- `MobilePanelsHost.tsx` (88), `devMount.tsx` (34), `MobileBoardPlaceholder.tsx` (16) — **TEST-ONLY** host (see §9).

### Mobile specs & support (1037 lines)
`tests/e2e/mobile-shell.spec.ts` (177), `mobile-board.spec.ts` (209), `mobile-capture.spec.ts` (175), `mobile-panels.spec.ts` (257); supports `tests/support/mobile-{shell,board,capture,panels}.ts`.

---

## 5. Integration wiring (commit 30b0e66)

The four features were built in isolation behind `/?mobile=1` test harnesses. The integration commit made them the real app:

1. **`src/screens/MainScreen.tsx`** — the OLD `MainScreen` body was renamed to `DesktopMainScreen`; the new `MainScreen` is:
   ```tsx
   export function MainScreen(): JSX.Element {
     return useLayout() === 'mobile' ? <MobileShell /> : <DesktopMainScreen />;
   }
   ```
   This is the ONLY desktop-file change (the sanctioned CONTRACTS §4 point).
2. **`MobileShell.tsx`** — board tab now renders `<PanZoomCanvas/>`; clue/check/map tabs render `<MobileCluePanel/>`/`<MobileCheckPanel/>`/`<MobileMapPanel/>`; `btn-shoot` opens `<CaptureFlow/>` (new `capturing` state).
3. **`MobileHome.tsx`** — `btn-shoot` gained an `onShoot` prop (falls back to the "coming soon" toast when unset).
4. Retired C1's `dev-entry.tsx` injection harness (deleted) and pointed `mobile-shell.spec.ts` + `tests/support/mobile-shell.ts` at the **real app path** (`goto('/')` + viewport), so the spec now exercises the genuine `MainScreen`→`MobileShell` delegation.
5. Fixed C3's `mount.tsx` to detach `#root` and render its own `<Toast/>` (see §7).

**How the two layers separate at runtime:** at ≤700px (or coarse pointer) `MainScreen` renders ONLY `MobileShell` (no desktop DOM); at wider/fine-pointer it renders ONLY `DesktopMainScreen` (no mobile DOM). The desktop-regression tests assert this both ways.

---

## 6. Test suite — current state

Run from `ui/` with `export PW_PORT=5178` (any free port):

- `npm run typecheck` → clean.
- `npx playwright test --retries=2` → **92 passed** (config auto-starts `dev:mock`). Breakdown: desktop specs `board/check/clue/feedback/integration/map/photo/smoke` (60) + mobile `mobile-shell(6)/mobile-board(10)/mobile-capture(7)/mobile-panels(9)` = 32.
- `--retries=2` is REQUIRED because of a **pre-existing desktop flake** (NOT Phase C): `tests/e2e/photo.spec.ts` lines ~318 & ~346 ("in-flight OCR result" pair) time out on first attempt and pass on retry. This is stepB-1's file; do not "fix" it by weakening assertions. It is load-sensitive (worse when multiple agents run).

Each mobile spec includes a **desktop-regression block** (mobile UI absent at 1320×900, desktop layout renders) per the Phase-C non-negotiable "must not regress desktop."

---

## 7. Bugs found & fixed during review (all by the orchestrator, because codex couldn't run browsers)

1. **C1 `mobile-shell.spec.ts` — `toHaveText` vs subtitle.** `btn-shoot` contains a subtitle (`…25 הקלפים שעל השולחן`), so `toHaveText('צלמו את הלוח')` failed. → changed to `toContainText`.
2. **C1 `mobile-shell.spec.ts` — MSW swallowed `page.route`.** A `page.route('**/api/deal', 503)` never fired because the MSW service worker intercepts first, so no error toast appeared. → replaced with a `window.fetch` override (matching the pattern the passing loading-test already used).
3. **C2 `TestHarness` — collapsed canvas height.** The standalone harness gave `board-canvas` ~0 height, so `fitFor()` floored `fitScale` to its `0.1` minimum, making the Y axis pannable and breaking the exact reduced-motion snap-back assertion. → injected a harness style pinning `.mobile-board{height:100vh}` / `.mobile-board__viewport{min-height:78vh}` with `!important` (its own 2-class selector was losing the cascade to the app's `.mobile.mobile-board-harness{height:100svh}`; `svh` collapses in the injected context).
4. **Integration — C1 dev-entry double-mount.** C1's `dev-entry.tsx` removed `#root` and mounted its own shell (a workaround for not being allowed to edit `MainScreen`). Once `MainScreen` properly delegated, this double-mounted `mobile-shell` (strict-mode violations). → deleted `dev-entry.tsx`; spec now uses the real app path.
5. **Integration — C3 capture harness overlaid by shell tabbar.** `mount.tsx` only *appended* the capture overlay without detaching `#root`. Post-wiring, `#root` renders `MobileShell` whose **fixed bottom tabbar** sat on top of the capture flow's bottom controls (`btn-gallery`/step nav) → click timeouts on 3 tests. → made `installMobileCapture()` detach `#root` (matching C2/C4 harnesses).
6. **Follow-on from #5 — lost Toast.** Detaching `#root` removed the app-level `<Toast/>` that CaptureFlow relied on, breaking the OCR-error-toast test. → `mount.tsx` now renders its own `<Toast/>` alongside `CaptureFlow`.

Everything above is committed. None of these were logic bugs in the shipped feature code except #3 (a test-harness sizing bug) — the product code was sound.

---

## 8. KNOWN BUGS / LATENT ISSUES (NOT fixed — investigate)

**a. `PanZoomCanvas` viewport-guard mismatch (most important).** `PanZoomCanvas` returns `null` unless `matchMedia('(max-width:767px)')`. But `useLayout` (which decides whether `MobileShell` mounts at all) returns `'mobile'` for `max-width:700px` **OR `pointer:coarse`**. So a **coarse-pointer device wider than 767px** (e.g. a tablet at 1024px) would mount `MobileShell`, but its **board tab would render empty** (PanZoomCanvas null). Outside the current test matrix (Playwright Desktop Chrome is fine-pointer, only narrow width triggers mobile), so all tests pass. **Fix:** make `PanZoomCanvas` use the same `useLayout()`/breakpoint logic as the shell, or drop its internal guard entirely (the shell already guarantees it only mounts on mobile). **Recheck via copilot** (needs a coarse-pointer / tablet emulation e2e).

**b. Duplicate host pattern / testid overlap.** `MobilePanelsHost` (test-only, stepC-4) defines its own `tabbar` + `tab-board/clue/check/map` testids — the SAME ids as the real `MobileShell`. Not a runtime conflict (they never render on the same page; different spec files), but it's a maintenance trap: someone editing tab behavior must change two places, and a future test that loads both would break under strict mode. Consider making `mobile-panels.spec.ts` mount the real `MobileShell` instead of `MobilePanelsHost`, then delete `MobilePanelsHost`/`devMount`/`MobileBoardPlaceholder`.

**c. `MobileBoardPlaceholder` is now effectively orphaned** — the real shell uses `PanZoomCanvas` for the board tab; the placeholder only survives inside the test-only `MobilePanelsHost`. Remove it when resolving (b).

**d. Real camera path (`getUserMedia`) is untested.** Only the gallery/stubbed-OCR path is covered (camera + OCR are non-deterministic in CI, by design). The live camera capture → OCR → key-card → `setBoard` round trip has never run against a real device. **Recheck manually on a phone**, or via copilot with a fake-media stream (`--use-fake-device-for-media-stream` Chromium flag).

**e. Real backend never exercised.** All tests use MSW mocks. The Phase-C plan calls for a final real-backend smoke (hit `/api/health` first to wake the HF Space, then deal via photos, get a clue, check a word, like it, mark cards). Not done. **Do manually or via copilot.**

**f. No visual screenshot regression.** The plan references diffing desktop screens against a `phase-b-done` reference, but no reference screenshots were ever captured. The binding gate used was "full e2e suite stays green," not pixel diff. If you want visual regression, capture baselines first.

**g. `mount.tsx` detaches `#root`.** Safe today because `mount.tsx` is imported ONLY by `mobile-capture.spec.ts`. But it is production-shipped code that, if ever imported at app runtime, would nuke the app. Consider moving it (and the other harnesses) out of `src/` into `tests/` — see §9.

**h. Pre-existing `photo.spec.ts` flake** (§6) — not Phase C, but you'll see it; handle with `--retries=2`.

---

## 9. Test-only code living in `src/` (decide: relocate or keep)

These are NOT part of the shipped mobile UX — they are e2e harnesses/seams the agents put in `src/` because their specs import them via Vite module URLs. They compile into the app graph but are only referenced by tests. Cleaner would be to move them under `tests/` (and update the spec import paths) so production `src/` has no test scaffolding:

- `src/mobile/board/TestHarness.tsx` — mounts `PanZoomCanvas` standalone; used by `mobile-board.spec.ts`. Contains `window.__mobileBoardReady` seam + the orchestrator's height-pin style (§7.3).
- `src/mobile/capture/mount.tsx` — self-mounts `CaptureFlow`; used by `mobile-capture.spec.ts`. Detaches `#root`, renders own `<Toast/>`. **Real app does NOT use this** (real entry = `MobileShell` `btn-shoot`).
- `src/mobile/panels/{MobilePanelsHost,devMount,MobileBoardPlaceholder}.tsx` — host for `mobile-panels.spec.ts`. See §8b/§8c.
- `src/mobile/capture/recognizers.ts` — `window.__captureRecognizers` override is a **test seam baked into a production code path**. It defaults to the real reused functions, so it's benign, but ideally the override branch is dev/test-gated.

Pre-existing dev hooks (`window.__store`, `window.__lastSpymasterReq`, `window.__lastFeedback`, etc.) are stepA-2's, gated to mock mode — NOT Phase C, leave them.

**Recommendation:** relocating harnesses is a nice-to-have cleanup, not a blocker. If you do it, verify the full suite stays green after each move (copilot).

---

## 10. What remained / not done

- `stepC` is **not pushed** and **not merged** to `feature/ui`. (Left for you / the human — outward-facing action.)
- Branches `stepC-1..4` still exist (delete after merge).
- No real-device camera smoke (§8d), no real-backend smoke (§8e), no visual diff (§8f).
- **SYNC-REQUESTS integration notes were NOT persisted.** Each agent appended a one-line integration request to `ui/agents/SYNC-REQUESTS.md`; the orchestrator reverted those appends before committing (to keep branches clean / avoid union-merge noise) and applied the integration directly in `30b0e66` instead. So the file on `stepC` contains only the original stepB-1 line. The integration those requests asked for is DONE and captured in this handoff + the commit; nothing is lost, but if you expected those lines in the file, that's why they're absent.
- `node_modules` is installed in all four worktrees (orchestrator ran `npm install`); lockfile/package.json unchanged (Phase C added no deps — gestures are hand-rolled).

---

## 11. What to recheck, and by whom (codex vs copilot)

**Use copilot (or run yourself) for anything touching a browser** — codex's sandbox cannot launch Chromium, so it is useless for e2e/visual work here. Codex is fine for pure static/logic review.

| Item | Who | Why |
|---|---|---|
| Fix §8a viewport-guard mismatch + add a coarse-pointer/tablet e2e | **copilot** | needs Chromium w/ device emulation |
| Resolve §8b/§8c duplicate host + orphan placeholder | **copilot** | must re-run e2e after refactor |
| Real camera capture smoke (§8d) | **copilot** (fake-media flag) or **you** (real phone) | non-deterministic media |
| Real backend smoke (§8e) | **you** or **copilot** | live HF Space, wake `/api/health` first |
| Visual screenshot baselines + diff (§8f) | **copilot** | needs rendering |
| Relocate test harnesses out of `src/` (§9) | **copilot** | re-run suite after moving |
| Static review of gesture math (`usePanZoom`), wire-mapping isolation, immutability | **codex or copilot** | no browser needed |
| Full regression before merge | **copilot** | `npx playwright test --retries=2` |

---

## 12. How to run / verify (from `ui/`)

```bash
export PW_PORT=5178
npm install                       # already done in codenames1, safe to re-run
npx playwright install chromium   # cached globally; no-op if present
npm run typecheck                 # tsc --noEmit — must be clean
npx playwright test --retries=2   # full suite; expect 92 passed
# focused:
npx playwright test tests/e2e/mobile-shell.spec.ts
# manual mobile preview in a real browser (resize to <700px or use device toolbar):
npm run dev:mock -- --port 5178 --strictPort   # then open http://127.0.0.1:5178/
```

Board setup inside a spec (mock mode): `await page.goto('/'); await page.evaluate(({words,roles}) => window.__store.getState().setBoard(words, roles), fixtureBoard);` (fixture: `src/mocks/fixtures/board.ts`, 9 red / 8 blue / 7 neutral / 1 assassin).

---

## 13. Hard constraints (unchanged — keep obeying)

- **Team-agnostic**: tiles are absolute `red|blue|neutral|assassin`; no `myColor`; `my|opp` only in `src/api/client.ts`.
- **Additive/desktop-safe**: only new files under `src/mobile/**` + the one `MainScreen` delegation line. Never edit `src/state/**`, `src/api/**`, or another feature's desktop files. Scope ALL mobile CSS under a `.mobile` root. Desktop suite must stay green.
- **Immutability**: new objects/arrays, never mutate store/props; consume store via selectors/actions.
- **Small files / functions** (<800 lines/file, <50 lines/fn, nesting ≤4), explicit error handling with Hebrew toasts (`toast` testid), validate at boundaries.
- **Testids are law** (CONTRACTS §7); never rename a desktop testid; mobile testids are additive.
- **TDD**: red→green→refactor; fix code, not contract-reflecting assertions.
- No new runtime deps; don't commit `package.json`/lockfile changes.

---

## 14. Final goal

A merged, green, genuinely-mobile Phase C: `stepC` verified (typecheck + `--retries=2` full suite green), the §8 known bugs triaged/fixed (at minimum §8a, and §8b/§8c cleanup), the test-only scaffolding either justified or relocated (§9), and — ideally — a real-device camera + real-backend smoke recorded. Then push `stepC` and open a PR into `feature/ui` (human decision). Nothing here should regress a single desktop test.

---

## 15. Continuation — 2026-07-22

Continuation work completed from the green `30b0e66` baseline:

- **Viewport guard fixed (§8a).** `PanZoomCanvas` no longer owns a second, conflicting width guard; `MobileShell`/`useLayout()` is the single mobile mount boundary. A new 1024×768 `hasTouch` Playwright test reproduces the coarse-pointer tablet case and verifies the shell, canvas, and all 25 tiles render.
- **Duplicate panel host removed (§8b/§8c).** `mobile-panels.spec.ts` now drives the real `MainScreen` → `MobileShell` path. Deleted `MobilePanelsHost.tsx`, `devMount.tsx`, and `MobileBoardPlaceholder.tsx`, removed their duplicate tab testids, and trimmed their orphaned CSS.
- **Test scaffolding relocated (§9).** The board and capture self-mounts now live in `tests/harnesses/`; `src/mobile/**` contains no test harness or self-mount module. `window.__captureRecognizers` is honored only in Vite dev/test mode.
- **Real-media browser smoke added (§8d).** A dedicated `chromium-fake-camera` Playwright project launches Chromium with fake-device/fake-permission media flags. The test enters capture through the real mobile home, waits for a live `getUserMedia` frame, presses the real shutter, and verifies the captured frame reaches the 25-cell review grid. This exposed and fixed a real bug: the `<video>` element previously mounted only after stream acquisition, so the stream had no element to attach to.

Final verification from `ui/`:

```text
npm run typecheck                         clean
npm run build                             clean
PW_PORT=5178 npx playwright test --retries=2
94 passed (60 desktop + 34 mobile)
```

No package manifest or lockfile changed, no desktop feature/store/API file changed, and all mobile CSS changes remain under `.mobile`.

Still deferred:

- **Physical-device camera smoke:** fake Chromium media now covers the live browser path, but camera optics, orientation, permissions, and real OCR/classification still need a phone test. Serve the app in a secure context (or USB-forward it to device localhost), open the mobile home, photograph a real 5×5 word board and key card, correct any uncertain cells, and confirm the 25-tile board.
- **Real backend smoke (§8e):** intentionally not attempted because the continuation brief said not to hit the HF Space unless explicitly appropriate. When approved, run without `VITE_USE_MOCKS`, wake `/api/health` first, then deal/capture, request and check a clue, submit feedback, and reveal a card.
- **Visual baseline diff (§8f):** no `phase-b-done` reference images exist, so there is no trustworthy pre-Phase-C pixel baseline to compare against. Functional desktop regression coverage remains green.
