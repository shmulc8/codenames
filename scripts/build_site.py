"""Bake the deck + clue-vocab embeddings of two encoders into the game template,
producing the self-contained codenames_latent_space.html (the shared Artifact).

Two engines are baked so the page can play *cross-encoder* (spymaster in one
geometry, operative in another) — a same-engine pairing is trivial cooperation,
not a real test. Locally, app.py adds DictaLM + the remaining encoders."""

import os

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import base64
import json

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

from codenames.probe import DECK, load_clue_vocab, make_encoder

HERE = ROOT
BAKE = ["blend_0.7_0.3", "embeddinggemma"]  # different geometries -> non-trivial play
N_CLUE = 1500

deck = list(DECK)
clue = load_clue_vocab(N_CLUE, min_len=3)


def quant(M):
    M = M.astype(np.float32)
    s = float(np.abs(M).max()) or 1.0
    return np.ascontiguousarray(np.clip(np.round(M / s * 127), -127, 127).astype(np.int8))


engines = {}
for key in BAKE:
    print(f"embedding deck + {len(clue)} clue words with {key} ...")
    enc = make_encoder(key)
    Dq = quant(enc.embed(deck))
    Cq = quant(enc.embed(clue))
    engines[key] = dict(
        dim=int(Dq.shape[1]),
        deck_b64=base64.b64encode(Dq.tobytes()).decode(),
        clue_b64=base64.b64encode(Cq.tobytes()).decode(),
    )

data = dict(words=deck, clue_words=clue, engines=engines)

tpl = open(os.path.join(HERE, "latent_space.template.html"), encoding="utf-8").read()
html = tpl.replace("__DATA__", json.dumps(data, ensure_ascii=False))
out = os.path.join(HERE, "codenames_latent_space.html")
open(out, "w", encoding="utf-8").write(html)
print(
    f"wrote {out}  ({len(html) / 1e6:.2f} MB, engines={BAKE}, {len(deck)} deck, {len(clue)} clue)"
)
