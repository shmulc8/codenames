"""Validate a guesser against real human feedback.

A benchmark's recovery numbers are only meaningful if its guesser tracks human judgment.
This replays every real 👍/👎 clue through a guesser and checks that the guesser rates
the 👍 clues higher than the 👎 ones — i.e. that it would have "seen" what the humans saw.

Reports, per verdict group: mean guesser-recovery (intended words in the guesser's
top-`count`) and enemy-leak rate (an opponent/assassin word in the top-`count`), plus a
separation score (AUC of recovery ranking 👍 above 👎). A guesser that can't separate the
groups (AUC ≈ 0.5) is not trustworthy as a benchmark oracle.

  HF_HUB_OFFLINE=1 FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin \\
    .venv/bin/python -m research.bench_guesser --guesser ensemble
"""

from __future__ import annotations

import argparse
import json
from statistics import mean

from codenames import probe
from codenames.guesser import make_guesser

ENEMY = {"opp", "assassin"}


def load_feedback() -> list[dict]:
    try:
        from huggingface_hub import hf_hub_download

        path = hf_hub_download(
            "shmulc/codenames-feedback", "data/feedback.jsonl", repo_type="dataset"
        )
    except Exception:
        path = "feedback/feedback.jsonl"
    rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]
    out = []
    for r in rows:
        if r.get("verdict") not in ("up", "down"):
            continue
        c = (r.get("comment") or "").lower()
        if "ignore" in c or "(test" in c or c.strip() == "test":
            continue
        board = r.get("board") or {}
        if not board.get("words") or not board.get("roles"):
            continue
        intended = r.get("intended") or (r.get("option") or {}).get("intended")
        if not intended:
            continue
        out.append(r)
    return out


def board_of(row: dict) -> probe.Board:
    b = row["board"]
    revealed = set(row.get("revealed") or [])
    words = [w for w in b["words"] if w not in revealed]
    return probe.Board(words=words, role={w: b["roles"][w] for w in words})


def auc(pos: list[float], neg: list[float]) -> float:
    """Probability a random 👍 score outranks a random 👎 score (ties = 0.5)."""
    if not pos or not neg:
        return float("nan")
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--guesser", default="ensemble")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    rows = load_feedback()
    g = make_guesser(args.guesser)
    print(f"guesser: {g.model_id}   feedback clues: {len(rows)}")

    stats = {"up": [], "down": []}
    leaks = {"up": [], "down": []}
    for r in rows:
        board = board_of(r)
        intended = [w for w in (r.get("intended") or r["option"]["intended"]) if w in board.words]
        count = r.get("count") or len(intended)
        order = g.rank(board, r["clue"])
        topk = order[:count]
        rec = mean([1.0 if w in topk else 0.0 for w in intended]) if intended else 0.0
        leak = any(board.role.get(w) in ENEMY for w in topk)
        stats[r["verdict"]].append(rec)
        leaks[r["verdict"]].append(1.0 if leak else 0.0)
        if args.verbose:
            print(
                f"  {r['verdict']:4s} {r['clue']:8s} rec={rec:.2f} leak={int(leak)} "
                f"top{count}={topk}  intended={intended}"
            )

    print(f"\n{'group':6s} {'n':>3s} {'mean_recovery':>14s} {'enemy_leak_rate':>16s}")
    for v in ("up", "down"):
        s, l = stats[v], leaks[v]
        print(
            f"{v:6s} {len(s):>3d} {mean(s) if s else float('nan'):>14.3f} "
            f"{mean(l) if l else float('nan'):>16.3f}"
        )
    print(f"\nseparation AUC (recovery, 👍 over 👎): {auc(stats['up'], stats['down']):.3f}")
    print(
        f"separation AUC (safety,   👍 over 👎): "
        f"{auc([1 - x for x in leaks['up']], [1 - x for x in leaks['down']]):.3f}"
    )
    print("(0.5 = no better than chance; higher = the guesser tracks human judgment)")


if __name__ == "__main__":
    main()
