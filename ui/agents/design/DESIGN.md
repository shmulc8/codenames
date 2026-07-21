# Codenames Copilot — Design Handoff (agents copy)

Hebrew Codenames (שם-קוד) **Spymaster copilot**. This is the design context for every agent — it lives inside `agents/design/` so the agents folder stays self-contained. The extract that ships with the build is this doc + `tokens.css` + `nocturne-tokens.css` + `screens/*.png` + `simple-html/*` + the two reference SVGs, all in this folder.

> **Precedence:** `agents/01-CONTRACTS.md` wins on *behavior, types, store shape, and testids*; this file wins on *looks*. On any conflict, CONTRACTS is law.
>
> **Rationale/requirements source:** the full change history lives in `old-design/ui-changes.md` + `old-design/missing-ui-gaps.md` (Changes 1–7) and the game rules in `skills/codenames-hebrew/SKILL.md`. Those are the *requirements/rationale*; this doc is the distilled *design decisions*. Note: some items in those docs (real-board skeuomorphic skin — Change 5) remain out of scope for this build; the team-agnostic reframing (below) and the mobile flows (Changes 6–7) are IN scope — desktop-first for Phases A/B, mobile in Phase C.

---

## 1. The one principle: it's a team-agnostic game analyzer

The app **never asks "which team are you on."** It is not a per-team assistant — it is an analyzer of the board in front of you.

- The board carries the real key-card colors: **red / blue / neutral / assassin**. Not "mine / opponent".
- To get a clue you select a **cluster of same-color cards**; the app reasons about that cluster. You may **not** mix two colors in one clue request (a clue is always for one team's words).
- There is a single persona: the person coming up with a hint. The old "אני המנחש / I'm the guesser" top-level mode is **gone** (retired per Change 1).
- Everything that used to read "your words / the enemy" is reframed to color language ("צירוף אדום · 2 קלפים", "9·8·7·1 מפתח תקין").

**Implication for devs:** no `myTeam` state anywhere. The clue endpoint takes *a set of selected card ids that share a color* + risk level. Board state is one model (below), not "my board vs their board".

---

## 2. Design system — Nocturne (bound)

Dark, quiet, compact. Blue-grey ground, Inter (+ Noto Sans Hebrew for RTL), 8px radii, a single blurple accent used as **line + glow, never a flood**. Outlined primary buttons, `:focus-visible` accent ring. Load the real stylesheet in production:

```html
<link rel="stylesheet" href="_ds/nocturne-.../styles.css">
```

In this build the base design-system classes (`.btn/.seg/.card/.tag/.dialog/.input/.table/.elev-*`) come from `nocturne-tokens.css` (stepA-2 imports it as-is). `tokens.css` in this folder is the **app-token layer**: it mirrors the Nocturne core values **plus** the app-only `--cn-*` tokens (role colors keyed to the REAL key-card colors red/blue/neutral/assassin, cream card, semantic-map, dark chrome). stepA-2 imports **both** files. Take every value from a token; don't invent hues outside this set.

RTL throughout (`dir="rtl"`). Hebrew is the product language — keep the technical labels (fastText/LLM) out of the consumer surface.

---

## 3. Board state model (build this first)

Every tile has three **independent** axes — compose them, don't overload one field:

| Axis | Values | Meaning |
|---|---|---|
| `role` | `red \| blue \| neutral \| assassin` | identity from the key card (the color) |
| `lifecycle` | `inPlay \| chosen` | `chosen` = guessed in the physical game, out of play. Store `chosenBy` (`red\|blue\|neutral\|assassin`) — who claimed it |
| `selection` | `none \| selected(order:n)` | currently highlighted for the clue being built |

- `chosen` must be a **first-class visual state** (dim + strike + who-took chip + ✓), not just backend exclusion. Assassin-chosen = terminal "game over" treatment.
- Tapping a card **toggles** `inPlay ↔ chosen` (mis-taps get corrected). On entering `chosen`, default `chosenBy` to the tile's own role (one tap), let the user correct with a 4-way picker.
- The moment a card becomes `chosen`, any shown clue is **stale** — auto-refresh or visibly mark "based on an older board — regenerate".
- "New board" (🎲) must reset all lifecycle back to `inPlay`.
- The sequence of `chosen` events **is** the ground-truth feedback signal (see §8).

See `simple-html/card-states.html` for every state rendered, and `screens/desktop-1d-card-states.png`.

---

## 4. The card & board

**Cream in-play card** (mirrors the physical card): cream face, punch-hole top-center, role icon+shape top-left, faint upside-down word on the upper half, crisp **white label strip** at the bottom. Full box-shadow recipe is in `tokens.css` (swap ring + tint per role).

**Revealed/chosen card**: tinted agent tile (role gradient), struck word, ✓ (or ✗ for assassin) top-right, role shape top-left. The tint *is* the "who claimed it" cue — but keep the shape/✓ so it survives colorblind/grayscale.

**Grid**: `display:grid; grid-template-columns:repeat(5,1fr); gap` inside a recessed well. Never inline flow. Tiles are landscape (~1.5:1). See `simple-html/board-grid.html`.

**Accessibility — color + shape, always.** Red ◆ · Blue ● · Neutral − · Assassin ☠. Color alone is a WCAG 1.4.1 failure; the assassin is the highest-stakes tile to misread. Numbered clue badges sit **top-right** (RTL-leading corner).

---

## 5. Screens

Desktop cards are ~1320px; mobile is a 390×844 app. PNGs in `screens/`.

### Desktop
- **`desktop-3a-main.png`** — main spymaster screen. Board (cream cards) + right control column: `קבל רמז / בדוק מילה שלי` tabs, selected-cluster chips (same-color only), risk dial (`זהיר/מאוזן/נועז`) grouped *with* the clue action, proposed-clue card with reasoning + near-miss warning + inline feedback, collapsible clue history, live role legend (no live counts — Change 3), semantic map panel.
- **`desktop-2c-check-word.png`** — "בדוק מילה שלי": private pre-say sanity check. Type a word + number, see which board words it might pull in (0–100 closeness bars). Board shows closeness rings.
- **`desktop-4a-board-input.png`** — **board input**. Segmented `הזנה ידנית / מתמונה / אקראי`. Manual entry is the default on PC (no camera): a 5×5 word grid where each cell has a role chip you set from your key card, with a `9·8·7·1` key validity check. A photo drop-zone (drag/browse) is offered alongside for board + key-card images. Explicit note: "אין מצלמה במחשב? זו הסיבה שהזנה ידנית היא ברירת המחדל".
- **`desktop-1d-card-states.png`** — the card-state reference sheet (updated to cream cards; the old dark-tile sheet was stale and is retired).

### Mobile (app with a bottom tab bar: לוח / רמז / בדיקה / מפה)
- **`mobile-1b-home.png`** — home / entry. Camera-first ("צלמו את הלוח"), plus random board and resume.
- **`mobile-3b-board.png`** — board tab: **pan/zoom canvas** (cards stay full-size, you move the board; a "fit" button + minimap). See §7 for gestures.
- **`mobile-3c-mark-revealed.png`** — tap a card → **bottom sheet**: word, role, "who took it?" 4-way (defaults to the card's color), "סמנו כנחשפה". This is the mobile lifecycle-toggle surface.
- **`mobile-3d-clue.png`** — clue tab: full proposed clue, reasoning, near-miss warning, history; inline feedback (§8).
- **`mobile-3e-map.png`** — semantic map tab (§6).
- **`mobile-3f-landscape.png`** — landscape: tab bar rotates to a side rail (camera-app style).
- **`mobile-4b-camera.png`** / **`mobile-4c-review.png`** — capture flow (§6.2).
- **`mobile-4d-gestures.png`** — the gesture spec (§7).

---

## 6. Getting the real board in

The product premise: the on-screen board **is** the physical board on the table. Two entry paths, by device.

### 6.1 Desktop — no camera, so manual is default
`desktop-4a-board-input.png`. Manual 5×5 word entry + per-cell role assignment from the key card, validated to `9/8/7/1`. Photo **upload** (drag-drop / file browse) is the secondary path — for a board photo taken on a phone and moved to the PC — with a separate slot for the key-card photo. Auto-detect words/colors from the image, always user-correctable.

### 6.2 Mobile — full capture flow
1. **Capture** (`mobile-4b-camera.png`): live camera, a board-shaped viewfinder frame with corner ticks ("יישרו את הלוח בתוך המסגרת"), auto edge-detect chip ("זוהה לוח 5×5"), a two-step indicator (words → key card). Bottom bar: **gallery thumbnail** (upload instead of shoot) · **shutter** · **flip camera**. Top: close · flash.
2. **Review** (`mobile-4c-review.png`): the captured frame with the detected 5×5 grid overlaid and recognized words; low-confidence words flagged amber for inline correction ("מכ_נאי?" → editable). Actions: **השתמשו בתמונה הזו** (primary) · **צלמו שוב** (retake/discard) · **מהגלריה** (pick instead). Then step 2 captures the key card.

Feedback tied to a **real photographed board** is higher-value training data than random boards — prioritize this path.

---

## 7. Mobile gestures — tap vs pan (the disambiguation)

`mobile-4d-gestures.png`. The board (and map) is a pan/zoom canvas, so "select a card" and "move the board" must not collide.

| Gesture | Action |
|---|---|
| **Short tap** on a card | opens the card's action sheet (§5 mobile-3c) |
| **Drag** | pans the board |
| **Two-finger pinch** | zoom |
| **Double-tap** | zoom to point · again = fit-to-screen |

**Disambiguation rule:** a touch that moves **less than ~10px** still counts as a tap (not a pan) — so a slightly-imperfect tap selects the card instead of nudging the board. Panning has momentum, is clamped to the board edges (soft rubber-band), and a "fit board" button always returns to the overview. Same rules apply to the **map** tab. Honor `prefers-reduced-motion` (snap, don't animate) and provide a non-gesture fallback (the compact list / compact board) so the board is never *only* reachable by gesture.

---

## 8. Feedback loop (subtle, non-modal)

`screens/feedback-4e.png`. Feedback is a top-priority training signal but must never interrupt flow.

- **Instant gut-check** lives as one quiet line **inside the clue card**: "עזר?" + 👍/👎. No modal.
- Pressing 👍/👎 **expands inline** (same card, no popup): quick reason chips (`רחוק מדי · מסוכן · מילה על הלוח · כללי מדי`) + an optional free-text field. Dismissible.
- On save, the controls are replaced by a quiet inline confirmation ("נשמר — תודה, זה משפר את המודל") that fades.
- **The real signal is auto-captured**: when the user marks cards `chosen` after actually playing the clue, that sequence (clue → which cards revealed → correct/wrong/neutral/assassin) is bundled as a feedback payload with no extra click. Also log rejections/near-misses (asked for another option, checked a word that came back risky, generated-but-unused clues). Wire feedback into the "בדוק מילה שלי" flow too — a human idea being graded is high-value.

---

## 9. Semantic map (headline feature — do not shrink)

`mobile-3e-map.png` + the map panel in `desktop-3a-main.png`; reference art in `semantic-map-reference.svg` (this folder).

- Hint = glowing central node. **Every remaining live board word** is a dot, team-colored (with shape redundancy). Radial distance = semantic closeness to the hint (state the legend: "קרוב למרכז = קרוב לרמז").
- **Filled dot = a target of this clue; hollow ring = on the board but not a target.** Lines run from the hint to its targets.
- **Danger proximity is the top signal:** enemy/neutral/assassin dots near the hint get a warning ring, tied to the same amber warning banner as the clue.
- Interactive: hover/tap a dot → word + 0–100 closeness score; **bidirectional dot ↔ board-tile highlight**; click to pin. `chosen` words drop off (map = live set).
- Mobile shares space with the board via tabs (not side-by-side).

---

## 10. What changed in this pass (audit results)

- **Team-agnostic** everywhere — removed the `myTeam` concept, "you are red/blue" tags, "your words left" copy. Reframed to color/cluster language.
- **Stale `1d` fixed** — rebuilt from the retired dark-tile theme to the current cream-card state sheet.
- **Desktop board input added** — manual entry (default) + photo upload; explains the no-camera reality.
- **Mobile capture flow added** — camera framing + auto-detect, review with retake/discard/gallery/correction.
- **Gesture spec added** — tap-vs-pan disambiguation, gesture dictionary, the <10px tap threshold.
- **Subtle feedback added** — inline, non-modal, three states + the auto-capture note.

## 11. Still open (next tickets)
- Key-card capture screen (capture flow step 2).
- Assassin "game over" board-level banner state.
- Open-legend expanded state.
- Shared-device secrecy (blur-until-confirmed / per-device) — see `missing-ui-gaps.md`.
- "No safe clue found" empty state exists in `1d`; wire it to the real engine `no_clue` result.

---

## 12. File manifest

```
agents/design/
├── DESIGN.md                   ← this file (looks); CONTRACTS wins on behavior
├── nocturne-tokens.css         ← base design system + component classes (.btn/.seg/.card…)
├── tokens.css                  ← app --cn-* tokens: role colors, cream card, map, chrome
├── semantic-map-reference.svg  ← map look reference (§9)
├── board-layout-reference.svg  ← tile-anatomy/color reference (§4)
├── simple-html/
│   ├── card-states.html    ← every card state, self-contained
│   └── board-grid.html     ← 5×5 grid skeleton
└── screens/
    ├── desktop-3a-main.png
    ├── desktop-2c-check-word.png
    ├── desktop-4a-board-input.png
    ├── desktop-1d-card-states.png
    ├── feedback-4e.png
    ├── mobile-1b-home.png
    ├── mobile-3b-board.png
    ├── mobile-3c-mark-revealed.png
    ├── mobile-3d-clue.png
    ├── mobile-3e-map.png
    ├── mobile-3f-landscape.png
    ├── mobile-4b-camera.png
    ├── mobile-4c-review.png
    └── mobile-4d-gestures.png
```

Requirements & rationale: `old-design/ui-changes.md`, `old-design/missing-ui-gaps.md` (Changes 1–7), game rules in `skills/codenames-hebrew/SKILL.md`. Behavior/types/store/testids: `agents/01-CONTRACTS.md` (authoritative).
