# Agent: stepC-3 — Mobile camera capture flow (board + key card)

Worktree `wt-stepC-3`, branch `stepC-3`, from `main` after `phase-b-done`. Time budget: **2h15m**. Read `agents/00-orchestration.md` (Phase C) + `agents/01-CONTRACTS.md` (§4 Phase C, §7 mobile) + `agents/design/DESIGN.md` §6.2 first. You own `src/mobile/capture/**` and `tests/e2e/mobile-capture.spec.ts` (via your tester). **Team-agnostic — the key card classifies to red/blue/neutral/assassin; NO "which color do you play" question (CONTRACTS §1).**

**FIRST TASK: desktop-regression baseline.** `npm install`, `export PW_PORT=5180`, run the FULL `npm run test:e2e` green before writing mobile code. You never edit a desktop file — reuse stepB-1's OCR + color-classify logic by importing it (request an `export` via `SYNC-REQUESTS.md` if it isn't already exported; do NOT copy-paste or edit stepB-1's files).

## Build — two-step capture (screens: `mobile-4b-camera.png`, `mobile-4c-review.png`)

1. **Live camera** (`camera-view`): `getUserMedia({video:{facingMode:'environment'}})` into a `<video>`; a board-shaped **viewfinder** (`viewfinder`) with corner ticks + copy "יישרו את הלוח בתוך המסגרת"; an auto edge-detect chip "זוהה לוח 5×5" (best-effort — non-blocking); a two-step indicator `capture-step-1`/`capture-step-2` (words → key card). Bottom bar: `btn-gallery` (upload from library instead of shooting — reuses the same review path), `btn-shutter`, `btn-flip` (front/back). Top: close · flash. Graceful fallback when camera permission is denied → straight to gallery upload.
2. **Review + correction** (`review-grid`, cells `review-cell-{0..24}`, screen `mobile-4c`): the captured frame with the detected 5×5 grid overlaid; run stepB-1's Tesseract(heb) OCR; recognized words prefilled, **low-confidence words flagged amber** for inline edit ("מכ_נאי?" → editable). Actions: `btn-use-photo` "השתמשו בתמונה הזו" (primary) · `btn-retake` "צלמו שוב" · gallery pick. Validate 25 non-empty unique words before continue.
3. **Step 2 — key card**: same capture→review for the key card; classify each of the 25 patches to `red|blue|neutral|assassin` (reuse stepB-1's classifier) → editable role grid with `RoleIcon`, tap cycles red→blue→neutral→assassin, live `9·8·7·1` validity check, "סובב ↻" rotate. On confirm, zip words+roles positionally → `store.setBoard(words, roles)`.
4. **Reuse, don't fork:** the OCR warm-up, preprocessing, word-clustering (right-to-left rows), and color classifier all come from stepB-1. This screen is the mobile capture UX around that shared logic. Feedback tied to a real photographed board is the highest-value training data (DESIGN.md §6) — prioritize a clean capture→confirm path over camera polish.

## Testability

Camera + OCR aren't deterministic in CI. Test the flow with the **gallery/upload path** feeding a fixture image (or a stubbed OCR result) + typed corrections + the role grid, ending in `store.setBoard`. One non-blocking smoke asserts the camera view mounts (or falls back to gallery when `getUserMedia` is unavailable in the test browser).

## Desktop-regression duty (biggest concern)

This flow is mobile-only; desktop board input (stepB-1 `desktop-4a`) is untouched. Before every checkpoint + merge: run the FULL desktop suite and confirm desktop capture/board-input is unchanged.

## Tester (FEATURE=mobile-capture, SPECS=mobile-capture.spec.ts)

Gallery-upload path renders the review grid; low-confidence cells are editable; correcting to 25 unique words + a valid key grid enables `btn-use-photo`; confirm calls `store.setBoard` (assert `window.__store` has 25 tiles with roles). **Mandatory desktop-regression block: full desktop suite stays green; desktop `desktop-4a` board-input unchanged.**

## Cuttable if behind

auto edge-detect chip, flash/flip controls, minimap of confidence. NOT cuttable: two-step capture→review, gallery fallback, OCR-prefilled editable grid, key-card role grid + 9·8·7·1 check, setBoard, desktop-regression spec.

## Sync & done

SYNC C (re-run FULL desktop suite). Merge order: after stepC-2. Done = typecheck clean, `mobile-capture.spec.ts` green, desktop suite still green, testids per CONTRACTS §7.
