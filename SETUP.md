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

## 2. The one big file you must download (NOT in this zip — ~6.7 GB)

The fastText Hebrew vectors power the whole geometry engine:

```bash
cd data
curl -O https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.he.300.bin.gz
gunzip cc.he.300.bin.gz        # → data/cc.he.300.bin
cd ..
```

Everything else under `data/` (the 573-word deck, the frequency list, and the
pre-built clue vocabularies) is already included.

## 3. Run

```bash
python app.py                  # serves http://127.0.0.1:7860
```

- **`/`** — the co-pilot (`copilot.html`): spymaster *and* guesser, both seats.
- **`/game`** — the older cross-model alignment-probe map.

## Notes

- **Default = fastText geometry.** No LLM, no network — fully offline once
  `data/cc.he.300.bin` is in place.
- **Optional encoders** (NeoDictaBERT / EmbeddingGemma / Qwen3-Embedding) are
  downloaded from HuggingFace on first use — only if you select them.
- **Optional local LLM** spymaster/guesser (DictaLM 3.0) needs Apple Silicon +
  `mlx-lm`; it is not required and the geometry engine matches/beats it here.
- `transformers` is pinned `<5` — NeoDictaBERT returns NaN embeddings on 5.x.
- The probe notebook (`notebooks/probe.ipynb`) reproduces the encoder↔LLM alignment bench.
