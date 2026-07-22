# Setup — Hebrew Codenames Co-pilot

A local-first co-pilot for the Hebrew word game **שם קוד** (Codenames): it gives
spymaster clues and ranks guesser picks using fastText word vectors + geometry —
no LLM and no API required.

## 1. Python environment

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 2. The fastText model (~250 MB, NOT in this repo)

The geometry engine runs on a **compressed** fastText Hebrew model (`cc.he.300.fp16.bin`
plus its `.vectors.npy` sidecar) — geometrically loss-free vs the original 7 GB model, at
~1/25th the size. Pull both files from the deployed Space into `data/`:

```bash
.venv/bin/python - <<'PY'
from huggingface_hub import hf_hub_download
for f in ("data/cc.he.300.fp16.bin", "data/cc.he.300.fp16.bin.vectors.npy"):
    hf_hub_download("shmulc/hebrew-codenames-copilot", f, repo_type="space", local_dir=".")
PY
```

(The full 7 GB `cc.he.300.bin` from fastText is **not** required. If you already have one,
point `FASTTEXT_COMPRESSED` at a compressed build or drop the full `.bin` in `data/` — the
engine loads a full model only when handed one explicitly.)

Everything else under `data/` (the 573-word deck, the frequency list, and the
pre-built clue vocabularies) is already included.

## 3. Run

```bash
make serve                     # serves http://127.0.0.1:7860
```

- **`/`** — the co-pilot (`copilot.html`): spymaster *and* guesser, both seats.
- **`/game`** — the older cross-model alignment-probe map.

## Notes

- **Default = fastText geometry.** No LLM, no network — fully offline once
  `data/cc.he.300.fp16.bin` is in place.
- **Optional encoders** (NeoDictaBERT / EmbeddingGemma / Qwen3-Embedding) are
  downloaded from HuggingFace on first use — only if you select them.
- **Optional local LLM** spymaster/guesser (DictaLM 3.0) needs Apple Silicon +
  `mlx-lm`; it is not required and the geometry engine matches/beats it here.
- `transformers` is pinned `<5` — NeoDictaBERT returns NaN embeddings on 5.x.
- The probe notebook (`notebooks/probe.ipynb`) reproduces the encoder↔LLM alignment bench.
- `make test` runs the fast legality regression; `make build-site` rebuilds the static map.
