# UI Changes Plan — Hebrew Codenames Copilot

Source: `missing-ui-gaps.md` + live testing of https://huggingface.co/spaces/shmulc/hebrew-codenames-copilot

This file tracks concrete, actionable UI changes. The first part is organized per screenshot frame (what to change on that specific screen). The second part is a running log of larger feature/scope changes, added one section per request.

> **Verification note (2026-07-16):** an Opus review pass read the Space's actual public source (`app.py`, `methods.html`) rather than only screenshots. It found that two items below were asking to build features that already exist (reveal/mark-guessed, and auto-clustering via empty selection) and corrected the "10/2" mislabel. Corrections are marked inline. Full review available on request.

---

## Per-frame change plan

### Frame: `page-1.jpeg` — Spymaster view, board + clue selection

1. **CORRECTED — this is a discoverability fix, not a new feature.** The "🃏 חשיפה" (reveal) action already marks a word as guessed and the backend already excludes it from future engine scoring. What's actually needed: (a) rename/relabel the button so its function is obvious ("סמן כנחשף" / mark as revealed, rather than the generic "reveal"), (b) confirm and, if missing, add a distinct visual state for revealed tiles (grayed out + checkmark) so the board visibly reflects it, (c) reconcile this with the bottom-right per-role visibility checkboxes (הצוות שלי/היריב/ניטרלי/מתנקש), which may overlap with reveal state and need to be designed together, not separately.
2. **CORRECTED — also a discoverability fix, not a new feature.** Leaving the word-selection field empty already triggers the engine to auto-pick the best cluster from the whole board (confirmed in the page-1 copy: "או השאר ריק והעוזר יבחר את הקבוצה הטובה ביותר בעצמו"). What's needed: make this an explicit, visible choice — e.g. a clearly labeled second button "מצא לי את הצירוף הכי טוב" (find me the best cluster) that triggers the existing empty-selection behavior directly, instead of requiring the user to intuit that *not* selecting anything is itself a deliberate mode.
3. Add a shape/icon/pattern on top of the color coding for team tiles (mine/opponent/neutral/assassin), not just hue, so the board is readable without color vision.
4. Move the numbered selection badges from top-left to top-right of each tile to match RTL reading order.
5. Regroup the toolbar: cluster the risk dial (זהיר/מאוזן/נועז) directly next to or inside the clue-generation panel, since it only affects that action — separate it visually from board-management actions (new board, edit, clear selection, reveal).
6. Add an inline tooltip/info icon on the risk dial itself — **keep it plain-language** ("cautious = safety-first, balanced = safe coverage, bold = maximum reach"), not the underlying engineering parameters, so it doesn't require a trip to the `/methods` page for a casual player.
7. **CORRECTED — split into two separate fixes, not one.** The earlier version of this item conflated two different numbers. "10/1" and "10/2" (next to "אפשרויות אחרת") are an option-position counter ("option N of 10 alternates"), not a confidence score — label it as such, e.g. "אפשרות 1 מתוך 10". The actual similarity/confidence values are the "100/83/67…" bars in the guesser ranked list — those need the "ציון קרבה" (similarity score) legend instead.
8. Add a visible "no safe clue found" empty state with guidance (e.g. "נסה רמה 'נועז' או בחר מילים אחרות" — try Bold risk or pick different words) instead of leaving this state undesigned.
9. Add a lightweight session log panel (collapsible) listing clues given so far this game, so repeats/contradictions are visible without memory. (Unverified whether this already exists client-side — the backend logging is append-only and not obviously replayed to the UI, but the full frontend source wasn't read; confirm before building.)
10. Add a turn indicator and remaining-word counters that update as tiles get marked claimed (depends on #1).

### Frame: `page-2.jpeg` — "אני המנחש" (guesser) ranked-recommendation view

See the dedicated **Change 1** section below — this entire frame's audience/purpose is being redefined, not just patched. Cosmetic items that apply regardless of that redefinition:
1. Label the ranking bar numbers ("100," "83," "67"...) with what scale they're on (0-100 similarity score) directly in the panel header, not just implied by an external label.
2. Explain the small teal underline bars on board tiles — either add a one-line legend or remove them if they're redundant with the ranked list.
3. Explain the numbered badges ("1," "2") on tiles with an inline label at the badge itself, not just distant caption text.

### Frame: `page-3.jpeg` — Spymaster view with generated clue + warning callout

1. The yellow warning banner ("⚠️ הזהרה: 'טיול' (ניטרלי) קרוב לרמז...") is a good pattern — extend it to always show, collapsed by default, so the user can check *all* near-miss words for a generated clue, not just the single closest one surfaced automatically.
2. Make the reasoning text (small chat-style bubble: "הכי קרוב למילים... ורחוק מהמתנקש...") visually connect to the specific tiles it references — e.g. hover/tap a word in the reasoning text to highlight the matching tile, since right now it's a disconnected paragraph.
3. The feedback input ("ספרו לנו עוד (לא חובה)") appears only after a thumbs up/down — make this connection clearer (e.g. it only expands once a thumb is pressed) so it doesn't read as a second, unrelated free-text box.
4. Same accessibility fix as frame 1: add non-color indicators to the tile borders (currently pink/teal/black outlines only) used to mark selected/team words.

---

## Change 1 — Retire the "guesser" framing; make it a private word-tester for the spymaster

**Requested by Matanel, 2026-07-16.** Goal: don't delete the "test a word and see closest matches" functionality — keep it — but stop framing/building it as a tool for the *other* players (guessers) to use mid-game. It should exist only to let the spymaster privately sanity-check a hint word they're considering, before saying it out loud.

### Current state (as tested on the live site, confirmed against source)

There are actually **two separate places** this capability already exists, which is itself part of the problem:

- A top-level persona tab, "אני המנחש" (I am the guesser), which is a full separate screen (`page-2.jpeg`): enter a clue + number, get a ranked list of board words plus a semantic map. The board here deliberately hides team colors — correct behavior *if* a real guesser were using it, but that's exactly the audience being removed. Confirmed: this is backed by its own endpoint, `/api/coach/operative`.
- A smaller toggle already embedded inside the Spymaster panel itself (`page-1.jpeg`): "תן לי רמז" (give me a clue) / "בדוק לי רמז" (check my clue) — this is much closer to what's wanted. **Confirmed via source: this is a genuinely separate, dedicated endpoint (`/api/coach/check`, described in the source as "test before you play"), not a repackaged version of the guesser screen.** This directly validates the plan below — the capability to promote already exists as its own thing and doesn't need to be built or extracted from the guesser view.

### Recommended changes

1. **Remove "אני המנחש" from the top-level persona switcher.** The primary navigation should no longer present "spymaster" and "guesser" as two peer modes/roles. There is only one persona using this app: the person coming up with hints.
2. **Promote the existing "בדוק לי רמז" (check my clue) toggle into the main, obvious action it deserves**, not a secondary toggle buried under "תן לי רמז." Consider making it a always-visible split: "קבל רמז" (get a clue) vs. "בדוק מילה שחשבתי עליה" (check a word I thought of) as two equally-weighted tabs within the single Spymaster screen.
3. **Unlock full board colors in check-mode — confirmed safe, not a new leak.** The spymaster screen (where "בדוק לי רמז" already lives) already shows the full color key on both page-1 and page-3; only the separate guesser screen hides it. So making colors visible in check-mode adds nothing beyond what's already exposed by being in the spymaster screen at all — it does not need to be sequenced after the shared-screen secrecy fix (item above in `missing-ui-gaps.md`); the two are independent. One dependency worth flagging instead: retiring the guesser view removes the *only* color-safe screen in the app, which is fine only because the product owner has explicitly decided real guessers won't use this tool.
4. **Reuse the ranked-list + reasoning + warning-banner components** from the current guesser screen and clue-result view (the "⚠️ הזהרה" pattern from `page-3.jpeg`) inside this merged check-mode, rather than maintaining two separate result UIs.
5. **Rewrite all copy from second-person "what should you guess" framing to first-person self-check framing:**
   - "הרמז שקיבלת" (the clue you received) → "המילה שאני שוקל" (the word I'm considering)
   - "מה כדאי לנחש?" (what should I guess?) → "אילו מילים זה עלול למשוך?" (which words might this pull in?) or "בדוק את הרמז" (check the clue)
   - "ההמלצות שלי" in the current guesser screen actually already reads spymaster-appropriate; keep that framing, just move it into the merged view.
6. **Decide what happens to the underlying "guesser" capability, don't just hide it:** confirm whether real guessers ever need this tool at all (e.g. a teammate wanting to double check a clue mid-turn on their own phone). If not, delete the route entirely rather than leaving dead code; if a light version might still be useful later, keep it feature-flagged off rather than reachable from primary nav.
7. **Update the numbered-badge / ranking legend copy** (currently "המספרים מסמנים את סדר הניחוש המומלץ" — the numbers indicate recommended guessing order) to spymaster-facing language, e.g. "המספרים מסמנים אילו מילים אחרות עלולות להתבלבל עם הרמז שלך" (the numbers indicate which other words might get confused with your clue).

### Relationship to the auto-clustering fix (per-frame plan, page-1 item 2)

These two requests were kept as separate items across the doc — "let it pick the words on its own" (auto-clustering) landed in the per-frame plan, while this guesser-retirement lives here as Change 1. On review that split holds up: auto-clustering is about the *clue-generation* flow (with or without a manual word selection), while Change 1 is about *who the app is for* (retiring a whole persona/screen). They interact — both live inside the same merged Spymaster screen once Change 1 ships — but they're genuinely different fixes and an implementer should treat them as two separate tickets, not one.

### Open question for Matanel

Should the merged "check a word" mode require the word to *not* already be on the board (since real clues can't be board words), the same way the clue-generation flow already validates this? Worth confirming before implementation.

---

## Change 2 — Build a high-conversion feedback loop for training-data collection

**Requested by Matanel, 2026-07-16.** The `/api/feedback` endpoint already sends the board, the clue, and the words that were actually revealed/guessed back to the server — this is training data for the underlying model, and the owner considers growing this dataset a top priority, more important than the feedback UI's current framing (a thumbs up/down + optional comment) suggests. The goal of this change is to maximize both the *volume* and the *quality* of feedback captured, not just patch the current widget.

### Problem with the current flow

From the screenshots, feedback (thumbs up/down + optional free text) is solicited immediately after a clue is generated — before the clue has actually been spoken aloud and before teammates have guessed anything. At that point the user can only react to whether the suggestion *looks* right, not whether it *worked*. The real ground-truth signal — which words the team actually picked in response to the clue, in what order, and whether any were wrong/opponent/assassin — only exists after a round is played out in the physical game. Right now nothing connects that later, more valuable signal back to the clue that prompted it.

### Recommended changes

1. **Turn the reveal action into the feedback mechanism, not a separate step.** When the user marks cards as revealed via "חשיפה" (see Change 1's corrected item 1 in the per-frame plan) after actually giving a clue and watching their team guess, that action already contains the real outcome: clue → cards revealed → correct/wrong/neutral/assassin. Auto-bundle this as a feedback payload the moment reveals happen, instead of requiring a manual thumbs up/down click in addition to marking cards revealed. This turns something the user is doing anyway (tracking the physical game) into free data collection, which will produce far more volume than an optional reaction button ever will.
2. **Keep the instant thumbs up/down, but reframe it as "did this feel right," separate from outcome feedback.** It's still useful as a fast gut-check signal at generation time — keep it, just don't treat it as the primary data-collection mechanism, and don't let it block or duplicate the reveal-based signal from #1.
3. **Capture near-miss and rejection cases, not just accepted clues.** If the user asks for another option ("אפשרות אחרת"), asks the engine to check a word that came back with a warning, or generates a clue they never end up using, that's a real negative/borderline example worth logging — not just successful clues. Right now it's unclear whether skipped/rejected suggestions are captured at all.
4. **Add a lightweight end-of-round or end-of-game summary/export.** Rather than only streaming single events, let the user see (and optionally edit/confirm) a compact per-round log — clue given, words revealed, outcome — before it's finalized as a training example. This also doubles as the "clue history" feature already requested elsewhere in this doc, so build them together: the same underlying log serves both the in-app history view and the training-data export.
5. **Wire feedback collection into every flow that generates or checks a word, not just the primary "give me a clue" button.** This includes the "בדוק לי רמז" (check my clue) flow being promoted in Change 1 — a user manually testing a word they thought of and seeing it flagged as risky (or not) is a particularly high-value signal, since it reflects a real human idea being graded, not just the engine grading itself.
6. **Flag the board-origin dependency.** All feedback collected today is necessarily tied to randomly generated boards (per the "no photo-import" gap in `missing-ui-gaps.md`), not real physical games. Once photo import ships, feedback tied to real boards will be substantially higher-value training data than what's collectible today — worth keeping in mind when prioritizing this against the photo-import gap, since they compound each other.

---

## Change 3 — De-emphasize the team-count legend; drop the live counter

**Requested by Matanel, 2026-07-16.** Decision: drop the numeric counts from the "שלי 9 / יריב 8 / ניטרלי 7 / מתנקש 1" legend entirely, and reduce the legend's overall visual prominence — it shouldn't be a focal element of the screen.

This also resolves the open "team-count legend may not reflect live game state" item flagged in `missing-ui-gaps.md` — that item was about whether the numbers update correctly as cards get revealed; removing the numbers makes the question moot rather than something to verify or fix.

### Recommended changes

1. **Remove the numeric counts** (9/8/7/1) from the legend entirely — keep only the color-to-role mapping (mine/opponent/neutral/assassin) as a static reference, with no live-updating state to maintain.
2. **Reduce visual weight:** smaller size, lower contrast, and/or move it out of the primary toolbar area it currently shares with board-management actions (see the existing "toolbar overload" item in `missing-ui-gaps.md`) — it should read as a passive legend a user glances at once, not an active data readout competing for attention with the clue-generation flow.
3. **Consider collapsing it behind a small icon/expand affordance** rather than always-on, so it's available on demand without taking permanent screen space — especially relevant given the mobile-compatibility gap, where every pixel of persistent chrome matters more.

---

## Change 4 — A first-class "chosen / out-of-play" card state on the board

**Requested by Matanel, 2026-07-19.** Goal: give the board an obvious, at-a-glance visual language for cards that have already been chosen during the game and are therefore no longer in play, so the human and the engine are provably reasoning over the same shrinking set of live words. See the matching gap in `missing-ui-gaps.md` ("No intuitive 'this card is already out of play' state").

### What already exists (don't rebuild)

The mark-as-guessed *action* and the backend *exclusion* already work: "🃏 חשיפה" flips a card and revealed cards are dropped from candidate scoring on the next clue (confirmed in `app.py`). Change 4 is **not** about adding that capability — it's about making the resulting board *state* legible. It builds directly on the reveal-relabel fix (per-frame page-1 item 1) and must be reconciled with the per-role visibility checkboxes (הצוות שלי/היריב/ניטרלי/מתנקש) so the app has one board-state model, not three overlapping ones.

### Data model — establish this first

Give every tile an explicit lifecycle state instead of the current implicit "revealed or not":

- `inPlay` — default. The word is live; the engine considers it.
- `chosen` — the word has been guessed/claimed in the physical game and is out of play. This is what Change 4 makes visible. Store *who claimed it* alongside: `chosenBy ∈ { mine, opponent, neutral, assassin }`, because "spent by my team" vs "spent by the opponent" carry very different meaning at a glance (and the assassin, if ever hit, ends the game — that tile deserves its own terminal treatment).

`chosen` is orthogonal to the existing `selected` (currently-highlighted for a clue) and to the `chosenBy`/team-color key. A tile can be `inPlay` + team=`opponent`, or `chosen` + `chosenBy=opponent`. Keep the three axes (lifecycle, team identity, current selection) as separate fields so the rendering layer can compose them rather than fight over one overloaded class.

### Visual specification

The `chosen` state must be readable in under a second and must never be confusable with an in-play tile. Compose these, don't pick just one:

1. **Dim + desaturate the whole tile** to ~40% opacity and drop it visually "into the background" (remove or flatten its shadow/elevation) so live tiles clearly sit in front. This is the primary cue.
2. **Strike or cross the word text** (single line-through, or a subtle diagonal band across the tile). This survives grayscale/colorblind viewing — it does not rely on the desaturation reading as "off."
3. **A small corner chip showing who claimed it** — a colored dot/label in the RTL-leading (top-right) corner: e.g. teal="שלי", red="יריב", gray="ניטרלי", black skull/✖="מתנקש". This is the "ideally show which team claimed each spent card" requirement. Use the same non-color redundancy (icon/shape) the accessibility fix already mandates, so the chip works without hue.
4. **A subtle ✓ (or ✖ for assassin) overlay** centered or in the opposite corner, reinforcing "done" independent of both color and strike-through.
5. **Assassin-specific terminal state:** if a `chosen` tile is `chosenBy=assassin`, don't just dim it — render a distinct "game over" treatment (full black tile, skull, and a board-level banner), since that event is decisive.

Contrast target: a `chosen` tile and an `inPlay` tile of the same team color must be distinguishable in grayscale and at a 2-second glance from ~50cm (phone) — test both, since the app already ships a mobile disclaimer.

### Interaction

1. **Toggle, don't one-way.** Tapping a card cycles/【toggles】 its lifecycle: `inPlay → chosen` and back (mis-taps happen; the physical game gets corrected). The reveal-relabel work (page-1 item 1) covers the entry point; Change 4 requires that un-choosing is equally reachable.
2. **On entering `chosen`, prompt for `chosenBy` when it isn't inferable.** Fast path: if the tile's team is already known to the spymaster view (colors are shown there), default `chosenBy` to that team so it's one tap. If ambiguous, show a tiny 4-way picker (my/opp/neutral/assassin). Never block the board on this — default to the tile's own color and let the user correct.
3. **Immediately re-run / invalidate the current clue suggestion.** The moment a card becomes `chosen`, the engine's live-word set changed, so any displayed clue is now stale. Either auto-refresh the suggestion or visibly mark it "based on an older board — regenerate," so the human is never acting on a hint computed against words that are already gone. This closes the trust gap that is the whole reason for Change 4.
4. **Keep a running "X words left" per team**, derived from lifecycle state (ties into per-frame page-1 item 10). Once counts are computed from `chosen`, this is nearly free.

### Board-level affordances

1. **A live/spent filter or fade toggle.** Default: show spent cards dimmed in place (preserves the physical board's spatial layout so the human can map screen↔table). Optional toggle: fully hide spent cards to declutter. Persist the choice in `localStorage`.
2. **A one-tap "reset board" / "new game" clears all lifecycle state** back to `inPlay` — make sure the existing 🎲 "לוח חדש" path also resets `chosen`/`chosenBy`, or spent state leaks across games.
3. **Reconcile with the per-role visibility checkboxes.** Those checkboxes control *what the viewer is allowed to see* (a secrecy/visibility layer); `chosen` controls *what is still in play* (a game-state layer). Keep them as two independent controls but make sure they compose cleanly — e.g. a `chosen` opponent card should still honor the "hide opponent colors" checkbox for its corner chip while still reading as spent via the color-independent strike/✓.

### Engine / backend

The exclusion already happens server-side; Change 4 mostly needs the client to *send and render* per-card lifecycle. Confirm the request that fetches a clue carries the full `chosen` set (not just a count) and the `chosenBy` breakdown, so future work (e.g. "avoid clues near words the opponent already spent" vs "already-safe words") can use it. Also feed this straight into Change 2's feedback loop: the sequence of `chosen` events *is* the ground-truth outcome signal that change wants to capture — build the two on the same lifecycle log rather than duplicating state.

### Build order

1. Introduce the lifecycle data model (`inPlay` / `chosen` + `chosenBy`) and migrate the existing implicit "revealed" flag onto it.
2. Ship the visual `chosen` state (dim + strike + corner chip + ✓, plus the assassin terminal case).
3. Wire the toggle interaction + stale-clue invalidation.
4. Add the board-level filter toggle and "words left" counters.
5. Reconcile with the per-role checkboxes and the reveal-relabel copy; connect the lifecycle log to Change 2.

---

## Change 5 — Desktop "real board" skin (make the PC board look like the physical game)

**Requested by Matanel, 2026-07-19.** Reference photo: `real-board-reference.jpeg` (a physical 5×5 Codenames board in a black tray on a marble surface). Goal: on PC, render the board as a high-fidelity recreation of the real tabletop game rather than an abstract web grid — and let users who prefer the current compact/phone-like layout switch back with one toggle. This is a desktop-only skin; the compact view stays the default on mobile (see the separate phone idea, still pending approval, not specced here).

### Why desktop only

Desktop has the screen real estate to carry full-size, richly illustrated tiles at readable dimensions; the phone does not (see the mobile-compatibility gap in `missing-ui-gaps.md`). So this skin is offered on PC as the default *there*, with an escape hatch, and is not forced onto small screens.

### Exactly how it should look (derived from `real-board-reference.jpeg`)

**The tray / frame.**
- A dark, near-black tray with a subtle matte, slightly 3D-printed texture (visible layer striations in the photo) frames the whole board. Each of the 25 cells is a recessed slot with soft inner shadow, so tiles read as physically dropped into the frame rather than floating on a page.
- Rounded outer corners; a thin raised lip between cells. Cells are a consistent square-ish aspect (roughly 4:3 landscape per tile, matching the photo).
- Background behind the tray: a light, cool marble/neutral surface (not pure white) so the black frame pops. Keep it very subtle — texture, not a loud photo.

**In-play word tiles (unrevealed).** Match the physical word card exactly:
- Cream / tan card stock with a faint diagonal-stripe watermark and a faint agency logo mark in the top-right corner.
- A small circular "punch hole" near the top-center edge.
- The word printed **twice**: once large and mirrored/upside-down across the upper portion in faint tan-on-tan (as on the real card), and once crisply in a **white rectangular label box in the lower third**, bold black uppercase, well-kerned (e.g. `TICK`, `IVORY`, `BERLIN`). The white label box is the primary readable element.
- Very slight per-tile rotation/offset (±1–2°) is optional to feel physical, but keep it subtle enough that the grid still scans cleanly.

**Revealed / chosen tiles = illustrated agent portraits.** This is the key skeuomorphic payoff and it ties directly into Change 4's `chosen` state — a revealed tile swaps the cream word card for a full-bleed character portrait, tinted by allegiance, exactly like the physical identity tiles in the photo:
- **My team / one team → blue agents:** cool blue-tinted character portraits against a barred-window / holding-cell background (the suave dark-haired man, the white-haired woman in red sunglasses, etc.).
- **Opponent → red agents:** warm red/orange-tinted portraits against a corridor/hallway background (the bald man in sunglasses, the woman in red).
- **Neutral bystander → beige civilians:** desaturated khaki/beige-tinted ordinary people against a suburban wooden-fence backyard (the shocked man, the worried woman).
- **Assassin → the darkest, most ominous portrait** (not present in this photo). Give it a distinctly menacing treatment plus the board-level "game over" banner from Change 4.
- These portraits sit flush in the tray slot, replacing the word card, so "revealed" is unmistakable and *which team claimed it* is legible from the art tint alone — the physical game's own solution to Change 4's "who claimed this spent card" requirement. Keep the color-independent redundancy (a small role icon / ✓, per the accessibility fix) layered on top for colorblind users, since art tint alone still fails WCAG 1.4.1.
- Asset note: this needs an illustrated portrait set (or a licensed/importable one). If bespoke art isn't available, fall back to a stylized tinted silhouette + role badge that preserves the blue/red/beige/black language; flag the asset dependency as the main cost of this change.

**Selection & clue overlays** (must survive the richer skin): the current numbered badges, the teal underline/heat bars, and the "selected for this clue" highlight all still render *on top of* the skinned tiles. Move numbered badges to the RTL-leading top-right corner (per the existing accessibility item) and give them enough contrast to read against both cream cards and dark portrait art.

### The toggle (required)

- Provide a clearly labeled board-style switch, e.g. **"תצוגת לוח אמיתי / תצוגה קומפקטית"** (real-board view / compact view), placed near the board controls — not buried in a settings menu.
- **Real-board view** = this skin, default on desktop. **Compact view** = the current flat web grid (denser, lighter-weight, faster, better for small windows).
- Persist the choice in `localStorage` so it survives reloads, and respect it independently per device (a user on a small laptop window may prefer compact even on "PC").
- The toggle is purely presentational: it must not change game state, lifecycle (`chosen`/`inPlay` from Change 4), the semantic map, or any engine behavior — only how tiles are drawn. Both views read from the same board-state model.
- Consider honoring `prefers-reduced-motion` / low-power by defaulting the heavy skin off, and offering a "reduce texture" sub-option if the marble/tray textures prove distracting.

### Build order

1. Abstract the tile renderer so a single board-state model can be drawn by two skins (compact vs. real-board) — this is the real work; the visuals are CSS/asset layers on top.
2. Ship the in-play cream word-card skin + tray frame (no new art needed — it's CSS + the mirrored/label typography).
3. Add the illustrated agent-portrait tiles for the `chosen` state (asset-dependent; wire to Change 4's lifecycle), with the colorblind-safe role badge layered on.
4. Add the persisted desktop toggle and the reduced-motion/reduced-texture fallbacks.
5. Verify overlays (badges, heat bars, selection, warnings) render correctly on both skins.

### Dependencies / cross-references

- **Change 4** (`chosen`/out-of-play state): the revealed-tile portraits *are* the visual for `chosen` on this skin — build them together, one lifecycle model, two renderings.
- **Accessibility (color-only encoding):** art tint is not sufficient alone; keep icon/shape/✓ redundancy on both skins.
- **Mobile gap:** this skin is desktop-default only; the phone approach is a separate, still-unapproved idea (summarized to Matanel, not yet in this doc).

---

## Change 6 — Mobile "real board" via pan-and-zoom canvas (no tiny cards)

**Requested by Matanel, 2026-07-19 (approved after review).** Goal: bring the Change 5 real-board look to phones *without* shrinking 25 illustrated tiles to an unreadable size. Instead of fitting the whole board into a phone's width, treat the skinned board as a pan-and-zoom canvas — like a map — so cards stay full-fidelity and the user moves around the board rather than everything getting tiny.

### Core idea

Render the same real-board skin from Change 5 (tray, cream word cards, illustrated agent portraits for `chosen` tiles), but on mobile present it inside a **pan/zoom viewport**:

- **Loads zoomed-to-fit:** on open, the board is scaled so the whole tray and its styling are visible at a glance — the user sees the recognizable physical board immediately, even though individual words may be small at this zoom.
- **Drag to pan, pinch to zoom:** cards are never permanently shrunk. To read a card, the user zooms/pans to it and sees it at full real size. This trades "see everything small at once" for "see everything full-size by moving," which matches how people actually read a physical board — one area at a time.
- **Tap-to-focus:** tapping a tile pops it (optionally with its row) into a large, readable overlay/lightbox — word, team, revealed state, any warning — so the most common actions ("what does this card say," "what team is it," "mark it chosen") never require manual zooming.
- **Snap-back affordance:** a small "fit board" button (and/or a minimap thumbnail) returns to the zoomed-to-fit overview from any zoom level, so the user can't get lost.

### Behavior details

1. **Momentum + bounds:** panning has inertia and is clamped to the tray edges (with a soft rubber-band) so the board can't be flung off-screen. Double-tap toggles between fit-to-screen and a comfortable read-zoom centered on the tapped point.
2. **Zoom limits:** min zoom = whole tray fits width; max zoom = a single card fills most of the screen. Don't allow zooming past legibility in either direction.
3. **Tap vs. pan disambiguation:** a quick tap = focus/select that tile; a drag = pan. Use a small movement threshold so a slightly-imperfect tap still focuses rather than accidentally panning.
4. **Focus overlay is the action surface on mobile:** since tiles are the pan target, put the per-card actions (mark chosen / set `chosenBy` / see warning) in the tap-to-focus overlay rather than relying on tiny in-tile controls. This dovetails with Change 4's lifecycle interactions — the overlay is where a phone user toggles `inPlay ↔ chosen`.
5. **Persist view state:** remember last zoom/pan and the fit-vs-zoom preference in `localStorage` within a session so a reload doesn't reset the user to the far-out overview mid-game.
6. **Respect the compact toggle:** the Change 5 real-board ↔ compact switch still applies on mobile. Compact view stays the lighter default some users prefer; this pan/zoom canvas is what "real board" means *on a phone*. Real-board is desktop-default (Change 5) but opt-in on mobile, since the marble/tray textures and portrait art are heavier to render on a phone.

### Accessibility & performance

- **Keep the color-independent redundancy** (role icon / ✓ / strike-through from Change 4 and the accessibility fix) legible at read-zoom — art tint alone still isn't sufficient.
- **Honor `prefers-reduced-motion`:** disable pan inertia and zoom animation, snap instead of animate.
- **Render cost:** at fit zoom the portraits can be drawn from low-res thumbnails and swapped to full-res only as the user zooms in, so the whole board isn't rendering 25 full illustrations at once on a phone GPU.
- **No keyboard trap / screen-reader path:** provide a non-gesture fallback (a simple scrollable list or the compact view) for users who can't perform pinch/drag, so the board is never *only* reachable by gesture.

### Build order

1. Wrap the Change 5 skinned board in a pan/zoom viewport component (fit-to-screen default, clamped pan, bounded zoom).
2. Add tap-to-focus overlay carrying the per-card info + Change 4 lifecycle actions.
3. Add the "fit board" snap-back control and optional minimap.
4. Wire tap-vs-pan disambiguation, momentum, double-tap zoom, and `localStorage` view persistence.
5. Add reduced-motion, thumbnail-then-full-res loading, and the non-gesture fallback.

### Dependencies / cross-references

- **Change 5** (desktop real-board skin): Change 6 reuses that exact skin/asset set — build 5 first, then 6 wraps it for phones. Don't fork the visuals.
- **Change 4** (`chosen` lifecycle): the tap-to-focus overlay is where mobile users drive the lifecycle toggle and see `chosenBy`.
- **Mobile-compatibility gap** (`missing-ui-gaps.md`): this is the concrete answer to "the wide board is compromised on small screens" — panning replaces shrinking.

---

## Change 7 — Make the semantic map a first-class "what's closest to the hint" view

**Requested by Matanel, 2026-07-19.** Reference screenshot: the "המרחב הסמנטי" (the semantic space) panel — a dark map with the hint "קדמי" as a glowing blue node at center, lines out to "מסך" and "עתיד", a hollow "מפה" ring nearby, and scattered teal/red/gray dots. Goal: this map is *not* being removed and *not* being shrunk — it's a headline feature per `CLAUDE.md` ("show me a semantic grid... which other words have high odds of being chosen and their chance"). This change specs it as the core, fully-interactive "which board words are closest to the hint" visualization. Corrects the earlier "underused / maybe shrink it" note in `missing-ui-gaps.md`.

### What it must show (every board word, not just 2-3)

- **The hint at the center**, as the glowing focal node (as in the screenshot — "קדמי", blue halo). Subtitle stays: the hint sits at the center of your words.
- **Every remaining board word as a dot**, color-coded by team using the same language as the board (teal = mine, red = opponent, gray = neutral, black = assassin). Today most dots are unlabeled and inert — that's the gap. They should all be meaningful.
- **Position encodes semantic closeness to the hint:** radial distance from the center = distance from the hint (closer dot = more semantically related). Make this mapping explicit in a one-line legend ("קרוב למרכז = קרוב לרמז") so the spatial layout is readable, not decorative.
- **Lines from the hint to its intended target words** (as the screenshot draws to מסך / עתיד): these are the words the clue is *for*. Line length/opacity can reinforce closeness. Distinguish "targets of this clue" (lined) from "everything else on the board" (unlined dots) clearly.
- **Danger proximity is the highest-value signal:** any opponent, neutral, or — critically — assassin dot that sits close to the hint is exactly what loses games. Give near-miss enemy/assassin dots a visible warning treatment (ring, pulse, or pull them into a "too close" zone), and tie this to the existing "⚠️ הזהרה" warning banner (page-3) so the map and the banner tell the same story.

### Interactivity (the main build)

1. **Hover/tap any dot → reveal its word + similarity score.** Right now dots are anonymous. On hover/tap, show the word label and a numeric closeness-to-hint score (reuse the 0-100 similarity scale being labeled elsewhere — page-2 cosmetic item 1). This is what turns the scatter from decoration into a tool.
2. **Dot ↔ board-tile linking (both directions).** Hovering a dot highlights the matching tile on the board; hovering/selecting a board tile highlights its dot on the map. This is the map-side of the same "connect reasoning to tiles" fix already requested for the reasoning text (page-3 item 2) — build them on one shared highlight mechanism.
3. **Label smartly to avoid clutter:** by default label only the hint, the lined target words, and the N nearest dots; reveal the rest on hover. The "מפה" hollow-ring style in the screenshot is a good "candidate but not selected / not a target" affordance — formalize it: hollow ring = on the board but not a target of this clue, filled dot = target.
4. **Click a dot to pin its label + score** so the user can compare several words without losing the readout on mouse-out.
5. **Respect lifecycle (Change 4):** `chosen`/out-of-play words drop off the map (or render dimmed and pushed to the edge), since the whole point is reasoning over *remaining* live words — the map's dot set should match the board's live set.

### Layout / responsive

- Keep it prominent on desktop (it earns its space once interactive) — do **not** shrink it, reversing the earlier note.
- On mobile it competes for space with the pan/zoom board (Change 6): make it a collapsible/expandable panel or a swipe-between tab (board ↔ semantic map) rather than cramming both on one phone screen at once.
- Presentation-only: like the board skins, the map reads from the same engine output; it must not change game state or scoring.

### Build order

1. Plot *all* live board words as team-colored dots positioned by similarity-to-hint (not just the 2-3 currently labeled), with the radial-distance legend.
2. Add hover/tap → word + similarity score, and the filled-vs-hollow target/non-target distinction.
3. Add bidirectional dot ↔ board-tile highlighting (shared with page-3 reasoning-text fix).
4. Add danger-proximity warnings for near enemy/assassin dots, wired to the existing warning banner.
5. Add click-to-pin, lifecycle-aware dot set (Change 4), and the mobile collapse/tab behavior (Change 6).

### Dependencies / cross-references

- **`CLAUDE.md`:** this is the "semantic grid + odds of being chosen" feature named in the project brief — treat as core, not polish.
- **Page-2 cosmetic item 1** (label the 0-100 similarity scale): the map reuses that same score in its dot readouts.
- **Page-3 item 2** (connect reasoning text to tiles): same highlight mechanism, extended to map dots.
- **Change 4** (`chosen` lifecycle): the map's dot set follows the live-word set.
- **Change 6** (mobile pan/zoom board): on phones, map and board share space via tabs/collapse, not side-by-side.

---

*(Additional change sections will be appended below as they're requested.)*
