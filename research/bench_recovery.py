#!/usr/bin/env python3
"""Benchmark Hebrew Codenames clue recovery using a local guesser LLM.

Parametrizes encoders and boards to evaluate LLM-guesser recovery, Spearman correlation,
assassin avoidance, and safe-rate.

Run from the repository root:
    FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin HF_HUB_OFFLINE=1 .venv/bin/python -m research.bench_recovery --encoders fasttext,numberbatch --boards 15
"""

import os

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import argparse
import collections
import random
import time

import numpy as np

from codenames.exp_encoders import make_exp_encoder
from codenames.probe import (
    LLM_FAST,
    HebrewLLM,
    clue_vocab_band,
    encoder_rank,
    encoder_spymaster,
    llm_guess_ranking,
    recovery_at_k,
    sample_board,
    spearman,
)


def main():
    parser = argparse.ArgumentParser(description="Benchmark encoder clue recovery via LLM guesser.")
    parser.add_argument(
        "--encoders",
        default="fasttext",
        help="comma-separated experimental or registered encoder keys",
    )
    parser.add_argument(
        "--boards", type=int, default=15, help="number of random boards to evaluate"
    )
    parser.add_argument("--seed", type=int, default=42, help="random seed for board sampling")
    parser.add_argument(
        "--vocab",
        choices=["baseline", "extended", "conservative", "broad", "experimental"],
        default="baseline",
        help="vocabulary set to use",
    )
    args = parser.parse_args()

    encoder_keys = [k.strip() for k in args.encoders.split(",") if k.strip()]
    if not encoder_keys:
        parser.error("At least one encoder must be specified.")

    print(f"Loading clue vocabulary ({args.vocab})...")
    block = set()
    blocklist_path = os.path.join("data", "blocklist_he.txt")
    if os.path.exists(blocklist_path):
        with open(blocklist_path, encoding="utf-8") as f:
            for line in f:
                w = line.strip()
                if w and not w.startswith("#"):
                    block.add(w)

    if args.vocab == "conservative":
        raw_vocab, counts = clue_vocab_band(20000, mode="conservative")
    elif args.vocab == "broad":
        raw_vocab, counts = clue_vocab_band(20000, mode="broad")
    elif args.vocab == "experimental":
        raw_vocab, counts = clue_vocab_band(20000, mode="experimental")
    elif args.vocab == "baseline":
        raw_vocab, counts = clue_vocab_band(
            20000, lo=300, hi=80000, pos={"NOUN", "ADJ"}, source_n=30000
        )
    else:  # extended
        raw_vocab, counts = clue_vocab_band(
            20000, lo=100, hi=150000, pos={"NOUN", "ADJ", "PROPN"}, source_n=30000
        )

    vocab = [w for w in raw_vocab if w not in block]
    print(f"Loaded {len(vocab)} words.")

    encoders = {}
    embeddings = {}
    for key in encoder_keys:
        t0 = time.time()
        print(f"Loading encoder: {key}...", flush=True)
        enc = make_exp_encoder(key)
        encoders[key] = enc
        embeddings[key] = enc.embed(vocab)
        print(f"Loaded {key} in {time.time() - t0:.1f}s", flush=True)

    print("Loading Hebrew LLM...", flush=True)
    llm = HebrewLLM(LLM_FAST)
    print("LLM loaded.", flush=True)

    print(f"Generating {args.boards} boards with seed={args.seed}...", flush=True)
    # Generate boards using deterministic sequential seeds starting from args.seed
    boards = [sample_board(random.Random(args.seed + i)) for i in range(args.boards)]

    agg = collections.defaultdict(list)

    for i, board in enumerate(boards):
        print(f"\n--- Board {i + 1}/{args.boards} ---", flush=True)
        print(f"Team words (my): {board.my}", flush=True)
        print(f"Assassin: {board.assassin}", flush=True)

        for key in encoder_keys:
            enc = encoders[key]
            emb = embeddings[key]
            # Spymaster clue candidate selection
            c = encoder_spymaster(enc, board, vocab, emb)
            if c is None or not c.word:
                print(f"  {key:14s} -> No clue generated.")
                continue

            # Check legality
            enc_order, _ = encoder_rank(enc, board, c.word)
            llm_order = llm_guess_ranking(llm, board, c.word)

            rec = recovery_at_k(llm_order, c.intended, c.count)
            rho = spearman(enc_order, llm_order)
            assassin_idx = llm_order.index(board.assassin)
            safe = 1 if assassin_idx >= c.count else 0

            agg[key].append(
                {
                    "clue": c.word,
                    "intended": c.intended,
                    "recovery": rec,
                    "spearman": rho,
                    "assassin_rank": assassin_idx,
                    "safe": safe,
                }
            )

            print(
                f"  {key:14s} -> clue={c.word!r:12} intended={list(c.intended)} rec={rec:.2f} safe={safe}",
                flush=True,
            )

    print("\n" + "=" * 60, flush=True)
    print("=== SUMMARY METRICS ===", flush=True)
    print("=" * 60, flush=True)
    headers = ("encoder", "recovery", "spearman_rho", "assassin_rank", "safe_rate")
    print(
        f"{headers[0]:14s}  {headers[1]:8s}  {headers[2]:12s}  {headers[3]:13s}  {headers[4]:9s}",
        flush=True,
    )
    print(f"{'-' * 14}  {'-' * 8}  {'-' * 12}  {'-' * 13}  {'-' * 9}", flush=True)

    for key in encoder_keys:
        results = agg[key]
        if not results:
            print(f"{key:14s}  no data", flush=True)
            continue
        mean_rec = np.mean([r["recovery"] for r in results])
        mean_rho = np.mean([r["spearman"] for r in results])
        mean_assassin = np.mean([r["assassin_rank"] for r in results])
        mean_safe = np.mean([r["safe"] for r in results])
        print(
            f"{key:14s}  {mean_rec:8.2%}  {mean_rho:+12.3f}  {mean_assassin:13.1f}/25  {mean_safe:9.1%}",
            flush=True,
        )


if __name__ == "__main__":
    main()
