#!/usr/bin/env python3
"""Optuna-based hyperparameter optimization for the Hebrew Codenames spymaster.

Tunes scoring, count-trim, and cohesion parameters against the LLM-guesser
recovery benchmark. Runs N_BOARDS boards per trial, maximising a composite
objective:  0.5 * recovery + 0.3 * safe_rate + 0.2 * (assassin_rank / 25)

Usage:
    PYTHONPATH=. FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin HF_HUB_OFFLINE=1 \
        .venv/bin/python -m research.optuna_tune --trials 60 --boards 15
"""

import os
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import argparse
import collections
import json
import random
import time
import numpy as np
import optuna

from exp_encoders import make_exp_encoder
import probe
from probe import (
    clue_vocab_band, freq_scores, sample_board,
    encoder_rank, llm_guess_ranking,
    spearman, recovery_at_k,
    HebrewLLM, LLM_FAST, Board, Clue,
    _legal_candidates,
)

# ---------------------------------------------------------------------------
# Globals: loaded once, reused across all trials
# ---------------------------------------------------------------------------
ENC = None
VOCAB = None
EMB = None
FREQ = None
LLM = None
BOARDS = None
BLOCK = None


def load_once(n_boards: int, seed: int):
    global ENC, VOCAB, EMB, FREQ, LLM, BOARDS, BLOCK

    print("Loading encoder: blend_0.7_0.3 …", flush=True)
    ENC = make_exp_encoder("blend_0.7_0.3")

    print("Loading blocklist …", flush=True)
    BLOCK = set()
    bp = os.path.join("data", "blocklist_he.txt")
    if os.path.exists(bp):
        with open(bp, encoding="utf-8") as f:
            for line in f:
                w = line.strip()
                if w and not w.startswith("#"):
                    BLOCK.add(w)

    print("Loading clue vocabulary …", flush=True)
    raw, counts = clue_vocab_band(20000, lo=1000, hi=80000,
                                  pos={"NOUN", "ADJ"}, source_n=30000)
    VOCAB = [w for w in raw if w not in BLOCK]
    FREQ = freq_scores(np.array([counts[raw.index(w)] for w in VOCAB]),
                       lo=1500, hi=40000)
    EMB = ENC.embed(VOCAB)
    print(f"  Vocab size: {len(VOCAB)}", flush=True)

    print("Loading LLM guesser …", flush=True)
    LLM = HebrewLLM(LLM_FAST)

    print(f"Generating {n_boards} boards (seed={seed}) …", flush=True)
    BOARDS = [sample_board(random.Random(seed + i)) for i in range(n_boards)]
    print("Setup done.\n", flush=True)


# ---------------------------------------------------------------------------
# Custom spymaster with tuneable α and 1-word penalty
# ---------------------------------------------------------------------------

def tuned_spymaster(enc, board, clue_vocab, clue_emb, vocab_freq,
                    m, lam_a, lam_opp, lam_neu, lam_f, alpha, penalty_1):
    """encoder_spymaster with tuneable min-max alpha and 1-word penalty."""
    bw, B, cand, keep, C = _legal_candidates(enc, board, clue_vocab, clue_emb, None)
    adj = C @ B.T
    adj = adj - adj.mean(1, keepdims=True)

    roles = np.array([board.role[w] for w in bw])
    is_my, is_opp_m = roles == "my", roles == "opp"
    is_neu, is_as = roles == "neutral", roles == "assassin"

    def tmax(mask):
        return np.clip(adj[:, mask].max(1), 0, None) if mask.any() else np.zeros(len(cand))

    adj_my = adj[:, is_my]
    m_eff = min(m, adj_my.shape[1])
    sorted_my = np.sort(adj_my, axis=1)[:, ::-1]

    if m_eff >= 2:
        top_my = sorted_my[:, :m_eff].mean(1) + alpha * sorted_my[:, m_eff - 1]
    elif m_eff == 1:
        top_my = sorted_my[:, 0] + penalty_1
    else:
        top_my = np.full(len(cand), -99.0, dtype=np.float32)

    g = top_my - lam_a * tmax(is_as) - lam_opp * tmax(is_opp_m) - lam_neu * tmax(is_neu)
    if vocab_freq is not None and lam_f:
        g = g + lam_f * np.asarray(vocab_freq, dtype=np.float32)[keep]

    bi = int(np.nanargmax(g))
    my_words = [w for w, mm in zip(bw, is_my) if mm]
    order = np.argsort(-adj_my[bi])[:m_eff]
    return Clue(word=cand[bi], count=m_eff,
                intended=[my_words[j] for j in order], margin=float(g[bi]),
                assassin_sim=float(adj[bi, is_as][0]) if is_as.any() else float("nan"))


# ---------------------------------------------------------------------------
# Objective
# ---------------------------------------------------------------------------

def objective(trial: optuna.Trial) -> float:
    # --- Suggest hyperparameters ---
    m       = trial.suggest_int("m", 2, 4)
    lam_a   = trial.suggest_float("lam_a", 1.0, 4.0)
    lam_opp = trial.suggest_float("lam_opp", 0.3, 2.0)
    lam_neu = trial.suggest_float("lam_neu", 0.1, 0.8)
    lam_f   = trial.suggest_float("lam_f", 0.0, 0.15)
    alpha   = trial.suggest_float("alpha", 0.0, 3.0)
    pen_1   = trial.suggest_float("penalty_1", -1.0, 0.0)

    # Count-trim / cohesion (used for served_count if we were to wire it, but
    # the benchmark uses encoder_spymaster which returns the raw intended list)
    # So we tune the scoring params only.

    recoveries = []
    safe_flags = []
    assassin_ranks = []
    spearman_rhos = []

    for board in BOARDS:
        c = tuned_spymaster(ENC, board, VOCAB, EMB, FREQ,
                            m=m, lam_a=lam_a, lam_opp=lam_opp, lam_neu=lam_neu,
                            lam_f=lam_f, alpha=alpha, penalty_1=pen_1)
        if c is None or not c.word:
            recoveries.append(0.0)
            safe_flags.append(0)
            assassin_ranks.append(0)
            continue

        enc_order, _ = encoder_rank(ENC, board, c.word)
        llm_order = llm_guess_ranking(LLM, board, c.word)

        rec = recovery_at_k(llm_order, c.intended, c.count)
        rho = spearman(enc_order, llm_order)
        a_idx = llm_order.index(board.assassin)
        safe = 1 if a_idx >= c.count else 0

        recoveries.append(rec)
        safe_flags.append(safe)
        assassin_ranks.append(a_idx)
        spearman_rhos.append(rho)

    mean_rec = np.mean(recoveries)
    mean_safe = np.mean(safe_flags)
    mean_a_rank = np.mean(assassin_ranks) / 25.0  # normalise to [0, 1]
    mean_rho = np.mean(spearman_rhos) if spearman_rhos else 0.0

    # Composite: recovery is king, but safety is non-negotiable
    score = 0.45 * mean_rec + 0.30 * mean_safe + 0.15 * mean_a_rank + 0.10 * mean_rho

    trial.set_user_attr("recovery", float(mean_rec))
    trial.set_user_attr("safe_rate", float(mean_safe))
    trial.set_user_attr("assassin_rank", float(np.mean(assassin_ranks)))
    trial.set_user_attr("spearman", float(mean_rho))

    return score


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--trials", type=int, default=60)
    parser.add_argument("--boards", type=int, default=15)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    load_once(args.boards, args.seed)

    study = optuna.create_study(
        direction="maximize",
        study_name="codenames_spymaster",
        sampler=optuna.samplers.TPESampler(seed=args.seed),
    )
    study.optimize(objective, n_trials=args.trials, show_progress_bar=True)

    print("\n" + "=" * 70)
    print("BEST TRIAL")
    print("=" * 70)
    best = study.best_trial
    print(f"  Composite score: {best.value:.4f}")
    print(f"  Recovery:        {best.user_attrs['recovery']:.2%}")
    print(f"  Safe rate:       {best.user_attrs['safe_rate']:.2%}")
    print(f"  Assassin rank:   {best.user_attrs['assassin_rank']:.1f}/25")
    print(f"  Spearman ρ:      {best.user_attrs['spearman']:+.3f}")
    print(f"\n  Best params:")
    for k, v in best.params.items():
        print(f"    {k:12s} = {v}")

    # Save all trials to JSON
    out_path = os.path.join("data", "optuna_results.json")
    trials_data = []
    for t in study.trials:
        trials_data.append({
            "number": t.number,
            "value": t.value,
            "params": t.params,
            "user_attrs": t.user_attrs,
        })
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"best": best.params, "best_value": best.value,
                   "best_attrs": best.user_attrs, "trials": trials_data},
                  f, ensure_ascii=False, indent=2)
    print(f"\nAll trials saved to {out_path}")


if __name__ == "__main__":
    main()
