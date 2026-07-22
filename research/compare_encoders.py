"""Which embedding gives the best Codenames clues? Each encoder plays spymaster
(tiered scoring); the DictaLM guesser ranks the board for that clue. We score by
how well the LLM recovers the encoder's intended targets and avoids the assassin."""

import os

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
import collections
import random
import time

import numpy as np

from probe import (
    LLM_FAST,
    HebrewLLM,
    encoder_rank,
    encoder_spymaster,
    llm_guess_ranking,
    load_clue_vocab,
    make_encoder,
    recovery_at_k,
    sample_board,
    spearman,
)

KEYS = ["fasttext", "neodictabert", "embeddinggemma", "qwen3-embed"]
vocab = load_clue_vocab(3000, min_len=3)[300:]
encs, emb = {}, {}
for k in KEYS:
    t = time.time()
    encs[k] = make_encoder(k)
    emb[k] = encs[k].embed(vocab)
    print(f"loaded {k:14s} {time.time() - t:5.1f}s", flush=True)
llm = HebrewLLM(LLM_FAST)
print("llm loaded", flush=True)

boards = [sample_board(random.Random(s)) for s in [1, 2, 3, 4, 5, 6]]
agg = collections.defaultdict(list)
for i, b in enumerate(boards):
    for k in KEYS:
        c = encoder_spymaster(encs[k], b, vocab, emb[k])
        enc_order, _ = encoder_rank(encs[k], b, c.word)
        llm_order = llm_guess_ranking(llm, b, c.word)
        agg[k].append(
            (
                recovery_at_k(llm_order, c.intended, c.count),
                spearman(enc_order, llm_order),
                llm_order.index(b.assassin),
                c.word,
                tuple(c.intended),
            )
        )
    print(f"board {i} done", flush=True)

print("\n=== Encoder -> LLM : which embedding's clues does the LLM best recover? ===", flush=True)
rows = []
for k in KEYS:
    rec = np.mean([x[0] for x in agg[k]])
    rho = np.mean([x[1] for x in agg[k]])
    ar = np.mean([x[2] for x in agg[k]])
    rows.append((k, rec, rho, ar))
    print(
        f"{k:14s} llm_recovery={rec:.2f}  spearman={rho:+.3f}  assassin_rank={ar:.1f}/25",
        flush=True,
    )
    for x in agg[k][:2]:
        print(f"     clue={x[3]!r:12} intended={list(x[4])}", flush=True)
best = max(rows, key=lambda r: (r[1], r[2], r[3]))
print(f"\nBEST by LLM recovery: {best[0]}", flush=True)
