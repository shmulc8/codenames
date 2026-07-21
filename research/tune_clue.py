"""Tune the risk profiles against the trustworthy benchmark (the REAL serving path).

Random-searches the scoring/count knobs of each RISK_PROFILE by running the exact
`app.serve_clue` path over seeded boards and scoring the served clue with the validated
guesser (`bench_clue.score_board`). Each profile optimises an objective matching its intent
— all three punish the assassin hard, but weight clean turns vs coverage differently:

    objective = gained - 4·assassin_rate - w_safe·(1 - safe_turn_rate)

Guesser rankings are cached per (board, clue), so most of the search is candidate
generation. Prints the best profile per risk with its metrics and writes them for promotion.

  HF_HUB_OFFLINE=1 FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin EMBED_ONLY=1 \\
    .venv/bin/python -m research.tune_clue --boards 24 --configs 40 --out data/tuned_profiles.json
"""
from __future__ import annotations

import argparse
import json
import random

import app
import probe
from research import bench_clue
from guesser import make_guesser

GRID = {
    "m": [2, 3, 4],
    "lam_a": [1.8, 2.5, 3.0, 3.5],
    "lam_opp": [0.7, 0.9, 1.3],
    "lam_neu": [0.4, 0.6, 0.7],
    "safe_margin": [0.0, 0.02, 0.05, 0.08],
    "keep": [0.45, 0.55, 0.68],
}
W_SAFE = {"cautious": 1.5, "balanced": 0.7, "bold": 0.3}
W_ASSASSIN = 4.0


class CachedGuesser:
    """Wraps a guesser so identical (board, clue) rankings are computed once across the search."""

    def __init__(self, inner):
        self.inner = inner
        self.model_id = inner.model_id
        self._cache: dict[tuple, list[str]] = {}

    def rank(self, board, clue):
        key = (tuple(board.words), clue)
        if key not in self._cache:
            self._cache[key] = self.inner.rank(board, clue)
        return self._cache[key]


def sample_config(rng: random.Random) -> dict:
    return {k: rng.choice(v) for k, v in GRID.items()}


def evaluate(profile: dict, risk: str, boards: list, guesser) -> dict:
    rows = [bench_clue.score_board(b, risk, guesser, profile=profile) for b in boards]
    return bench_clue.aggregate(rows, len(boards))


def objective(summary: dict, risk: str) -> float:
    return (summary["gained"] - W_ASSASSIN * summary["assassin"]
            - W_SAFE[risk] * (1 - summary["safe_turn"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--boards", type=int, default=24)
    ap.add_argument("--configs", type=int, default=40)
    ap.add_argument("--seed", type=int, default=142)
    ap.add_argument("--search-seed", type=int, default=7)
    ap.add_argument("--guesser", default="ensemble")
    ap.add_argument("--out", default="data/tuned_profiles.json")
    args = ap.parse_args()

    boards = [probe.sample_board(random.Random(args.seed + i)) for i in range(args.boards)]
    guesser = CachedGuesser(make_guesser(args.guesser))
    rng = random.Random(args.search_seed)
    configs = [sample_config(rng) for _ in range(args.configs)]
    # always include the current shipped profiles as reference points
    configs = list(app.RISK_PROFILES.values()) + configs

    print(f"guesser: {guesser.model_id}  boards: {args.boards}  configs: {len(configs)}\n")
    out = {}
    for risk in ("cautious", "balanced", "bold"):
        baseline = evaluate(app.RISK_PROFILES[risk], risk, boards, guesser)
        best_cfg, best_sum, best_obj = None, None, -1e9
        for i, cfg in enumerate(configs):
            summ = evaluate(cfg, risk, boards, guesser)
            obj = objective(summ, risk)
            if obj > best_obj:
                best_obj, best_cfg, best_sum = obj, cfg, summ
            print(f"  [{risk}] {i + 1:>2}/{len(configs)} obj={obj:+.3f} "
                  f"gained={summ['gained']:.2f} safe={summ['safe_turn']:.2f} "
                  f"asn={summ['assassin']:.2f} m={cfg['m']} sm={cfg['safe_margin']}", flush=True)
        out[risk] = {"profile": best_cfg, "metrics": best_sum, "objective": round(best_obj, 4),
                     "baseline_metrics": baseline, "baseline_objective": round(objective(baseline, risk), 4)}
        b = out[risk]
        print(f"\n== {risk} BEST obj={b['objective']} (baseline {b['baseline_objective']}) ==")
        print(f"   profile: {best_cfg}")
        print(f"   gained {best_sum['gained']:.2f} (base {baseline['gained']:.2f})  "
              f"safe {best_sum['safe_turn']:.2f} (base {baseline['safe_turn']:.2f})  "
              f"asn {best_sum['assassin']:.2f}  over_claim {best_sum['over_claim']:.2f} "
              f"(base {baseline['over_claim']:.2f})\n")

    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print(f"saved → {args.out}")


if __name__ == "__main__":
    main()
