"""Compare two sets of risk profiles on HELD-OUT boards (a different seed than tuning used).

The tuner picks profiles that win on its own board sample; this checks the winners still
win on fresh boards and reports every metric side by side, so a gain isn't just overfitting.
Point `--profiles` at tune_clue's output; omit it to re-measure the shipped profiles.

  HF_HUB_OFFLINE=1 FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin EMBED_ONLY=1 \\
    .venv/bin/python -m research.validate_profiles --profiles data/tuned_profiles.json \\
      --boards 40 --seed 900 --guesser ensemble
"""

from __future__ import annotations

import argparse
import json
import random

import app
import probe
from guesser import make_guesser
from research import bench_clue

METRICS = ["served_rate", "gained", "recovery", "safe_turn", "assassin", "over_claim", "mean_count"]


def measure(profile, risk, boards, guesser):
    rows = [bench_clue.score_board(b, risk, guesser, profile=profile) for b in boards]
    return bench_clue.aggregate(rows, len(boards))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profiles", default=None, help="tune_clue output json; default = shipped")
    ap.add_argument("--boards", type=int, default=40)
    ap.add_argument("--seed", type=int, default=900)
    ap.add_argument("--guesser", default="ensemble")
    args = ap.parse_args()

    candidate = None
    if args.profiles:
        with open(args.profiles, encoding="utf-8") as fh:
            candidate = {r: v["profile"] for r, v in json.load(fh).items()}

    boards = [probe.sample_board(random.Random(args.seed + i)) for i in range(args.boards)]
    guesser = make_guesser(args.guesser)
    print(f"guesser: {guesser.model_id}  held-out boards: {args.boards} (seed {args.seed})\n")

    for risk in ("cautious", "balanced", "bold"):
        base = measure(app.RISK_PROFILES[risk], risk, boards, guesser)
        print(f"=== {risk} ===")
        header = f"{'':10s}" + "".join(f"{m:>12s}" for m in METRICS)
        print(header)
        print(f"{'shipped':10s}" + "".join(f"{base[m]:>12.3f}" for m in METRICS))
        if candidate and risk in candidate:
            cand = measure(candidate[risk], risk, boards, guesser)
            print(f"{'tuned':10s}" + "".join(f"{cand[m]:>12.3f}" for m in METRICS))
            print(f"{'Δ':10s}" + "".join(f"{cand[m] - base[m]:>+12.3f}" for m in METRICS))
            print(f"   tuned profile: {candidate[risk]}")
        print()


if __name__ == "__main__":
    main()
