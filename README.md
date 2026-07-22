# Hebrew Codenames — a cross-model semantic-alignment probe

Codenames is a semantic-similarity problem wearing a board game. We use it as a
**measurement instrument**: a one-word clue transduces a *target set* into a
*guess*. By putting a Hebrew **encoder** and a Hebrew **LLM** on opposite ends of
that channel, we measure where their notions of "what this clue points at" agree
and — more interestingly — where they diverge.

- **Encoders** (the geometry): cosine over Hebrew word embeddings.
- **LLM** (the intent): DictaLM 3.0 giving clues / ranking guesses in natural Hebrew.

> **What it really measures.** Cross-system agreement is *cooperation / alignment*,
> not clue *quality* (Koyyalagunta et al. 2021, critiquing Kim et al. 2019). The LLM
> stands in as the human-like intent reference (Kumar et al. 2021: distributional
> cosine under-predicts human association). The divergences are the finding.

## The bench (latest, June 2026)

| role | model | notes |
|------|-------|-------|
| encoder | `fasttext cc.he.300` | static subword baseline — competitive with BERT for bare-word association; drives the interactive map |
| encoder | `dicta-il/neodictabert-bilingual-embed` | newest Hebrew-native encoder (Dicta) |
| encoder | `google/embeddinggemma-300m` | 2025 multilingual SOTA-small |
| encoder | `Qwen/Qwen3-Embedding-0.6B` | 2025 multilingual SOTA-small |
| LLM | `DictaLM-3.0-1.7B-Instruct` (mlx-8bit) | fast default, runs end-to-end |
| LLM | `DictaLM-3.0-Nemotron-12B-Instruct` (mlx-8bit) | quality run (~13GB), set `LLM_MODEL = LLM_BIG` |

DictaLM 3.0 (released 2026-05) runs locally via **MLX** (Apple-Silicon native).
Board = the real **573-word שם-קוד deck** (from `yaeldau/code-names`); clues are
drawn from a frequency-filtered Hebrew vocabulary, **never the board**.

## Clue scoring

`g(c) = Σ_{top-m team} s'(c,b) − 2.0·max(0,s'(c,assassin)) − 1.0·max(0,maxₒₚₚ s') − 0.3·max(0,maxₙₑᵤₜ s')`

where `s'(c,w) = cos(c,w) − meanₚ cos(c,b)` is centred **per clue** over the 25 board
words — an anisotropy / DETECT-style correction so broadly-similar common words don't
win. Avoidance is **tiered**: assassin ≫ rival team ≫ bystanders. The legal-clue rule
(no board word or shared surface form; one word) is enforced for both the encoder and
the LLM spymaster. See [[codenames-clue-rules]] — full *shoresh* matching is still TODO.

## What the probe measures

- **Direction A — LLM → Encoder (intent recovery):** LLM spymaster *names its targets*;
  each encoder guesses by nearest-neighbour. `recovery@k`.
- **Direction B — Encoder → LLM (geometry legibility):** encoder picks the clue; the LLM
  ranks the board. **Headline ρ** = Spearman(encoder order, LLM order), averaged.
- **Bonus (no LLM):** encoder↔encoder agreement.

## Run

**The probe (notebook):**
```bash
.venv/bin/python -m jupyter lab notebooks/probe.ipynb
```
Knobs: `N_BOARDS`, `ENCODER_KEYS`, `LLM_MODEL` (`LLM_FAST`/`LLM_BIG`). → `results.json`.

**The interactive map (local, with live DictaLM spymaster/guesser):**
```bash
make serve                                    # http://127.0.0.1:7860
# or: HF_HUB_OFFLINE=1 .venv/bin/python -m codenames.app
```
Shuffle a board, switch grouping (your team / free pick), read live geometry clue
suggestions, and have **DictaLM** play spymaster or guesser. A static, shareable build
(`codenames_latent_space.html`, no LLM) is produced by `scripts/build_site.py`.

## Files

The engine is the importable `codenames` package under `src/` (`pip install -e .`); everything
else — data, docs, research, the UI, the deploy bundle — sits alongside it.

- `src/codenames/` — the engine package:
  - `probe.py` — encoders (incl. fastText), MLX LLM wrapper, board sampling, tiered spymaster, guesser, metrics, rule enforcement.
  - `app.py` — local Flask server serving the map + DictaLM spymaster/guesser endpoints (`python -m codenames.app`).
  - `morph.py` — DictaBERT lemmatizer + shared-root clue legality.
  - `deck_he.py` — the 573-word שם-קוד deck loader.
  - `exp_encoders.py` — Numberbatch / blend encoders. `guesser.py` — LLM/ensemble guesser (research).
- `docs/engine-improvement-plan.md` — measured roadmap for improving the engine.
- `tests/` — fast regression tests for legality and scoring invariants.
- `notebooks/probe.ipynb` — the minimal probe driver.
- `research/` — offline benchmarks, tuning, and external-evaluator runners; see `research/README.md`.
- `latent_space.template.html` + `scripts/build_site.py` — the interactive map (template + data baker).
- `codenames_latent_space.html` — self-contained built site (also the shared Artifact).
- `data/` — runtime assets, derived vocabularies, and source-data build scripts.
- `hf_space/` — Hugging Face Space deploy bundle. Its engine `.py` / HTML and the `webapp/` build
  are **generated** (git-ignored); only its own `Dockerfile`, `requirements.txt`, `README`, and the
  prod-curated `data/` subset are committed. `make deploy` regenerates and uploads it.

Generated benchmark snapshots are intentionally ignored; rerun the matching evaluator when a fresh result is needed.

## Development

The `codenames` package under `src/` is the single source of truth for engine code; the `hf_space/`
bundle is generated from it at deploy time (see `scripts/deploy.py`) so nothing is maintained in two
places. `make install` sets up the venv and `pip install -e .`.

```bash
make install       # create .venv and install dependencies
make check         # ruff lint + format check + legality regression (the local gate)
make lint          # ruff check
make format        # ruff auto-format
make typecheck     # mypy (advisory — known baseline, not a gate)
make deploy-dry    # assemble the deploy bundle without uploading
make deploy        # sync + build UI + legality gate + upload to the Space + verify
```

Frontend (`ui/`): `npm run typecheck`, `npm run lint` (eslint), `npm run format` (prettier),
`npm run build`. CI (`.github/workflows/ci.yml`) runs the Python and frontend gates on every push
and PR; the legality regression runs at deploy time (it needs the 237 MB fastText model, which is
not in git). Install the git hooks with `pre-commit install`.

## Caveats

- Single-word embedding isn't what these encoders were optimised for; compare **ranks**,
  not raw cosine (NeoDictaBERT is tight; the multilingual ones run hot/diffuse).
- The 1.7B LLM is the fast wiring model and gives weak/occasionally-illegal clues
  (illegal ones are rejected) — use the 12B for anything you'd report.
- *Shoresh* (shared-root) clues that don't share a surface substring are not yet
  filtered — a known gap.
