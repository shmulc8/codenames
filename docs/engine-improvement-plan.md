# Hebrew Codenames Engine — Improvement Plan (handoff)

You are improving a Hebrew Codenames **spymaster** (clue-giving) engine. Goal: give
*better clues*. This plan is self-contained; execute it phase by phase, **measuring
every change** on an association-aware metric before keeping it.

---

## 0. Repo & current architecture (orient first)

Repo: `/Users/shmulc/Stuff/tmp/latent-space/codenames` (Python, `.venv/` present).

**Serving path (DO NOT churn until a winner is promoted — see §4):**
- `src/codenames/probe.py` — encoders + clue scoring (the engine).
- `src/codenames/app.py` — server, risk profiles, vocab assembly.
- `src/codenames/deck_he.py`, `src/codenames/morph.py` — board deck, Hebrew morphology/roots.
- `hf_space/` — generated deploy bundle (synced from `src/codenames/` by `scripts/deploy.py`).

**Encoder interface (duck-typed):** a class with
`embed(self, words: list[str]) -> np.ndarray` returning `(N, dim)` **float32, L2-normalized**
(dot product == cosine), and a `.model_id: str` attribute. Registry: `probe.ENCODERS`
dict + `probe.make_encoder(key)`.

**Clue scoring** (`probe.encoder_clue_candidates` / `encoder_spymaster`), objective:
```
g(c) = Σ_top-m team s'(c,b)  − λ_a·max(0,s'(c,assassin)) − λ_opp·max(0,max_opp s')
       − λ_neu·max(0,max_neut s') + λ_f·FREQ(c)
s'(c,w) = cos(c,w) − mean_b cos(c,b)          # DETECT mean-centering
```
plus a `safe_margin` gate (team word must beat the best enemy sim by a margin) and a
`cohesion` count-trim. Three `RISK_PROFILES` (cautious/balanced/bold) in `src/codenames/app.py`.
**The engine already implements the standard competitive toolkit** (margin score,
tiered assassin≫opp>neutral penalties, FREQ band, safety gate, risk dial). Do not
re-derive these; build on them.

**Legality (shoresh / shared-root):** `morph.roots()` + `data/word2root.json` (Wiktionary
lexicon) + a **fastText cosine gate θ=0.30** (`probe.ROOT_TRANSPARENCY_THETA`). Regression:
`python tests/test_legality.py` (encoder-independent; must stay green).

**Vocabulary:** `probe.clue_vocab_band(n, lo, hi, pos, source_n)` slices
`data/content_master_v2_30000.json` (rows `[lemma, count, pos]`). `src/codenames/app.py` builds the
live vocab with `pos={"NOUN","ADJ"}` → ~5,260 lemmas. **Proper nouns are currently EXCLUDED.**

**Eval harnesses:**
- `research/compare_encoders.py` — LLM-guesser **recovery** across encoders (the association-aware
  signal). Loads `HebrewLLM(LLM_FAST)` (1.7B DictaLM via MLX). Uses `sample_board`,
  `encoder_spymaster`, `llm_guess_ranking`, `recovery_at_k`, `spearman`.
- `research/bench.py` — synthetic boards, per-clue legal/safe/recovery + optional 12B judge.
  Run LLM-free: `HF_HUB_OFFLINE=1 .venv/bin/python -m research.bench --n 15 --no-judge --configs geom`.
- `research/bench_feedback.py` — consistency vs real 👍/👎 (dataset `shmulc/codenames-feedback`,
  fallback `feedback/feedback.jsonl`). Currently ~1 row.
- `research/oracle.py` — hits live server `:7860`, judges geometry vs LLM clue with 12B.
- `research/bench_intrinsic.py` — **NEW, already built** — SimLex-999 Spearman (see §1/§2).

**Data conventions:** `DATA = <repo>/data`; plain JSON loaded once (`lru_cache`/global);
expensive derived files disk-cached with params in the name; one-off `data/build_*.py` +
`data/*_NOTICE.md` for externally-sourced data (see `data/build_root_lexicon.py`). Files
needed at runtime must also be copied into `hf_space/data/`.

**Models:** `probe.HebrewLLM(probe.LLM_FAST)` = 1.7B, `probe.LLM_BIG` = 12B DictaLM (MLX,
Apple Silicon). fastText model at runtime via `FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin`.

---

## 1. Guiding principle — measure ASSOCIATION, not similarity

Codenames rewards **association** (פרויד→פסיכולוגיה, crown→king), NOT taxonomic
**similarity** (מכונית≈אוטו). SimLex-999 deliberately measures similarity and *penalizes*
association — so **SimLex ρ is a SECONDARY sanity tripwire only, never the optimization
target.** Optimizing it could make clues worse.

**Primary metric (in this priority):**
1. **Hebrew association gold set** (Phase A — build it first; the operator chose this).
2. **LLM-guesser recovery** on real boards (`compare_encoders.py` style).
3. **Agreement with real 👍/👎 feedback** (`bench_feedback.py`) — ground truth, tiebreaker.

**Every phase's gate:** a change is kept only if it improves the association metric
(recovery / gold-set correlation) **without regressing** `test_legality.py`, safe-rate,
or assassin-avoidance.

**Circularity guard:** Numberbatch and any ConceptNet-retrofit embedding are ConceptNet-
derived. **Do NOT judge them with a gold set built from ConceptNet edges** — use human/LLM/
game-derived association data for those, or exclude them from a ConceptNet-derived slice.

---

## 2. Already done / in-flight (verify, don't blindly redo)

- **`bench_intrinsic.py`** + **`data/simlex_he.tsv`** (Hebrew SimLex-999, 999 pairs,
  Apache-2.0, `data/build_simlex_he.py`, `data/SIMLEX_HE_NOTICE.md`). Baseline recorded:
  **fastText SimLex ρ = 0.389** (100% coverage). This is the SECONDARY tripwire.
  Run: `FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin HF_HUB_OFFLINE=1 .venv/bin/python -m research.bench_intrinsic --encoders fasttext`
- **Numberbatch Hebrew + `exp_encoders.py`** — DONE and selftest-verified:
  `data/numberbatch_he.npy`, `data/numberbatch_he_vocab.json`, `data/build_numberbatch_he.py`,
  `data/NUMBERBATCH_NOTICE.md`, `exp_encoders.py` (`NumberbatchEncoder` + `make_exp_encoder(key)`).
  `dim=300`, **N=19,556 Hebrew terms** (thin — much smaller than fastText's subword coverage).
  NumberbatchEncoder returns **all-NaN rows for OOV** (fixed vocab, no subword fallback).
  **CAVEAT from selftest: פרויד (Freud) is OOV in Numberbatch.** So its thin vocab can't
  represent many proper-noun / named-entity associations — which is (a) a strong argument for
  **blending** (fastText backstops OOV), and (b) confirms the Phase-D vocab/PROPN work is
  embedding-agnostic and must not rely on Numberbatch coverage. Expect low overall coverage on
  the assoc/recovery sets; report it, don't hide it.

**Experimental discipline:** all new encoders live behind `exp_encoders.make_exp_encoder(key)`
(returns experimental encoders, else delegates to `probe.make_encoder`). **Keep the serving
path untouched** until §4 promotion. Eval harnesses import `make_exp_encoder`, not `make_encoder`.

---

## 3. Phases (implement → measure → keep only if it wins)

### Phase A — Association gold set + recovery harness  *(measurement foundation; do first)*
1. **Build `data/assoc_he.tsv`** (`word1 \t word2 \t score`, human-grounded relatedness):
   - Translate the **WordSim-353 *relatedness* subset** (WordSim-Rel, ~252 pairs; Agirre et al.
     2009) to Hebrew; keep the English human relatedness scores. Have the operator spot-check
     translations (polysemy risk). Add `data/build_assoc_he.py` + `data/ASSOC_HE_NOTICE.md`.
   - Optionally augment with a small hand-curated Hebrew association list (operator-reviewed).
   - Note honestly: true Hebrew free-association norms don't exist publicly (Rubinstein 2005
     unavailable; SWOW has no Hebrew) — this is the pragmatic substitute.
2. **Extend `bench_intrinsic.py`** (or add `bench_assoc.py`) to score encoders on `assoc_he.tsv`
   too, and to **treat all-NaN rows as OOV** (skip those pairs; report true coverage) so fixed-
   vocab encoders (Numberbatch) are measured fairly. Switch its import to `make_exp_encoder`.
3. **Add `bench_recovery.py`** — parametrize `compare_encoders.py`: `--encoders a,b,c`,
   `--boards N`, using `make_exp_encoder`. Report per encoder: LLM recovery@count, spearman
   (enc vs LLM ranking), mean assassin rank, safe-rate. **This is the primary metric.**
4. **Lock baselines:** run `bench_recovery.py --encoders fasttext` and `bench_feedback.py`;
   record fastText's recovery / safe / assassin numbers. Everything below is compared to these.

### Phase B — ConceptNet Numberbatch encoder  *(cross-lingual, association-native)*
- Ensure `data/numberbatch_he.*` + `NumberbatchEncoder` exist (Phase-2 verify or rebuild:
  stream-filter `numberbatch-19.08.txt.gz` keeping `^/c/he/` lines, never storing the full
  ~9GB; L2-normalize; NaN for OOV; small prefix-strip fallback for {ה,ו,ב,כ,ל,מ,ש}).
- Measure `--encoders fasttext,numberbatch` on Phase-A recovery + assoc gold (NOT SimLex as
  the judge — Numberbatch may score low on SimLex yet high on recovery; that's the thesis).
- Sanity: nearest neighbors of פרויד should include פסיכולוגיה-type words.

### Phase C — Embedding blends
- Add `BlendEncoder` to `exp_encoders.py`: L2-normalize each space, then either concatenate
  (weighted) or average per-word cosines across {fastText, Numberbatch, optionally
  `dicta-il/neodictabert-bilingual-embed`}. Define OOV policy (fall back to available spaces).
- Grid a few blend weights; measure on recovery. (Literature: concatenation beats any single
  space — Kim et al. 2019, Burke.)

### Phase D — Vocabulary extension  *(operator chose: proper nouns + wider band)*
- Build an alternate vocab (experiment-only helper, don't edit `src/codenames/app.py` yet):
  add a **frequency-gated PROPN slice** (from `content_master_v2_30000.json` where pos=PROPN)
  **and widen the band** (raise `hi`, lower `lo`). Apply the offensive-word blocklist
  (`data/blocklist_he.txt`). Keep verbs out.
- Measure recovery with the extended vocab vs the current NOUN/ADJ vocab. Watch: proper nouns
  have thinner root-lexicon + embedding coverage (legality may need the cosine-gate fallback).

### Phase E — Retrofitting / embedding specialization  *(data-free finetuning)*
- Attract-Repel / counter-fitting or ConceptNet-retrofit of the fastText He vectors using
  lexical relations (Hebrew WordNet where usable, ConceptNet-He edges, and the shoresh lexicon
  for "same-root → don't over-associate" repel constraints). Ref: Mrkšić TACL 2017
  (`github.com/nmrksic/attract-repel`, arXiv 1706.00374). Output a new static vector file;
  wrap as an `exp_encoders` encoder; measure on recovery. (Circularity guard: if retrofit uses
  ConceptNet, don't judge it on a ConceptNet-derived gold set.)

### Phase F — MT candidate-expansion (Hebrew-verified)  *(operator wants translation tried)*
- Pipeline: translate the 25 board words He→En → mine rich English association resources
  (English Numberbatch / ConceptNet / WordNet / an English LLM) for candidate *concepts* →
  back-translate candidates to Hebrew → **re-score + shoresh-legality-check natively in Hebrew**
  with the existing engine. English boosts recall; **Hebrew stays authoritative** for scoring
  and legality. Do NOT do round-trip MT of the final clue (breaks polysemy + legality).
- Measure whether expanded candidates raise recovery without hurting legality/safety.

### Phase G — Self-play distillation → learned scoring weights  *(gated; only if headroom remains)*
- Use the 12B DictaLM judge + self-play to synthesize `(board, clue, recovery)` data, then
  **learn the scoring λ's / margin** (learning-to-rank) instead of the 3 hand-tuned risk
  profiles. Partly circular (optimizes toward the judge) — real 👍/👎 stays ground truth.
- **LLM clue-generator finetuning stays PARKED** — no Hebrew gameplay dataset exists; the
  unblocker is scaling the 👍/👎 feedback collection, not modeling.

---

## 4. Promotion / integration (only after a phase wins its gate)
1. Register the winning encoder in `probe.ENCODERS` + a new `kind` branch in
   `probe.make_encoder` (and vocab change in `src/codenames/app.py` if Phase D wins).
2. **If the winner replaces fastText as the legality/spymaster encoder, RECALIBRATE θ**
(`ROOT_TRANSPARENCY_THETA`, calibrated on fastText cosines) and update `tests/test_legality.py`'s
   measured cosines.
3. `scripts/deploy.py` auto-syncs the serving code from `src/codenames/`; new **runtime data**
   must still be added to `hf_space/data/` by hand (it is deliberately not auto-synced).
4. Run `tests/test_legality.py` (green), `bench_feedback.py`, `bench_recovery.py` on the promoted
   config. Deploy via `make deploy`.

---

## 5. Constraints (repeat)
- New/experimental code in `exp_encoders.py` + `research/`; **do not edit the serving path**
  (`src/codenames/{probe,app,deck_he,morph}.py`) until §4.
- Never fabricate datasets — if a download fails, say so.
- L2-normalize every encoder's output; NaN (not zero) for OOV.
- Keep `tests/test_legality.py` green.
- Any LLM/agent coding sub-work should use a strong model (operator's codex config uses
  `gpt-5.6-terra`).

## 6. Reference literature (methods)
- Koyyalagunta et al., JAIR 2021 — DETECT/FREQ/graph: arXiv 2105.05885 (`github.com/divyakoyy/codenames`).
- Numberbatch — Speer, Chin, Havasi 2017: `github.com/commonsense/conceptnet-numberbatch` (CC BY-SA 4.0).
- Attract-Repel — Mrkšić et al., TACL 2017: arXiv 1706.00374 (`github.com/nmrksic/attract-repel`, Apache-2.0).
- Gullesnuffs (Monte-Carlo EV bot), thomasahle/codenames, Kim et al. AIIDE-19, Jaramillo AIIDE-20.
- NeoDictaBERT-bilingual-embed: `huggingface.co/dicta-il/neodictabert-bilingual-embed`.
- salt-nlp/codenames (Cultural Codes, ACL 2023) — English-only, NO license → not reusable.
