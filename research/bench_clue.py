"""The clue-quality benchmark: the production spymaster, judged by a validated guesser.

For each seeded board and risk profile it takes the *exact* clue the app would serve
(`app.serve_clue`, the same code path as /api/coach/spymaster) and hands it to a guesser
(see `guesser.py`) to model what a teammate would actually pick. From the guesser's board
ranking it measures the things that decide whether a clue is good:

  served_rate      fraction of boards the engine gives a clue (vs an honest refusal)
  gained           team words won this turn = leading run of team words in the guesser's
                   ranking, capped at the claimed count — the cooperative payoff
  recovery         intended words landing in the guesser's top-`count`
  safe_turn_rate   no enemy word in the guesser's top-`count` (a clean turn)
  assassin_rate    the assassin in the guesser's top-`count` (catastrophic)
  over_claim       claimed count minus words the guesser actually recovers (calibration)
  legal_rate       served clue passes the shoresh/lemma legality gate (sanity tripwire)

Every metric is a mean ± standard error over the boards. The guesser is pluggable and its
fidelity to humans is measured separately (`bench_guesser.py`); the offline ensemble is the
default fast signal, the external LLM (`--guesser llm:...`) the promotion gate.

  HF_HUB_OFFLINE=1 FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin EMBED_ONLY=1 \\
    .venv/bin/python -m research.bench_clue --boards 40 --guesser ensemble
"""

from __future__ import annotations

import argparse
import json
import math
import random

from codenames import app, probe
from codenames.guesser import make_guesser

ENEMY = {"opp", "assassin"}


def _leading_team_run(order: list[str], board: probe.Board) -> int:
    """Team words a guesser reaches from the top before hitting any non-team word."""
    run = 0
    for w in order:
        if board.role[w] != "my":
            break
        run += 1
    return run


def score_board(board: probe.Board, risk: str, guesser, profile=None) -> dict:
    options, _ = app.serve_clue(board, risk, profile=profile)
    top = options[0] if options else None
    if top is None or top["no_clue"]:
        return {"served": 0.0}
    clue, count = top["word"], top["count"]
    intended = [w for w in top["intended"] if w in board.words]
    order = guesser.rank(board, clue)
    picks = order[:count]
    recovered = sum(1 for w in intended if w in picks)
    safe_run = _leading_team_run(order, board)
    legal = not probe.shares_lemma(clue, board, enc=app.get_enc(app.GEO_ENC))
    return {
        "served": 1.0,
        "clue": clue,
        "count": count,
        "intended": intended,
        "gained": float(min(safe_run, count)),
        "recovery": recovered / count if count else 0.0,
        "safe_turn": 1.0 if all(board.role[w] == "my" for w in picks) else 0.0,
        "assassin": 1.0 if board.assassin in picks else 0.0,
        "over_claim": float(count - recovered),
        "legal": 1.0 if legal else 0.0,
    }


def _mean_se(xs: list[float]) -> tuple[float, float]:
    if not xs:
        return float("nan"), float("nan")
    m = sum(xs) / len(xs)
    if len(xs) < 2:
        return m, 0.0
    var = sum((x - m) ** 2 for x in xs) / (len(xs) - 1)
    return m, math.sqrt(var / len(xs))


def aggregate(rows: list[dict], n_boards: int) -> dict:
    served = [r for r in rows if r.get("served")]
    agg = {"boards": n_boards, "served_rate": len(served) / n_boards if n_boards else 0.0}
    for key in ("gained", "recovery", "safe_turn", "assassin", "over_claim", "legal"):
        m, se = _mean_se([r[key] for r in served])
        agg[key] = round(m, 4)
        agg[key + "_se"] = round(se, 4)
    agg["mean_count"] = round(_mean_se([r["count"] for r in served])[0], 3)
    return agg


def run(risk: str, n_boards: int, seed: int, guesser, verbose: bool) -> dict:
    rows = []
    for i in range(n_boards):
        board = probe.sample_board(random.Random(seed + i))
        r = score_board(board, risk, guesser)
        rows.append(r)
        if verbose and r.get("served"):
            print(
                f"  [{risk}] {i + 1:>2}/{n_boards} {r['clue']}·{r['count']} "
                f"gained={r['gained']:.0f} rec={r['recovery']:.2f} "
                f"safe={int(r['safe_turn'])} asn={int(r['assassin'])}",
                flush=True,
            )
        elif verbose:
            print(f"  [{risk}] {i + 1:>2}/{n_boards} — refused", flush=True)
    return {"summary": aggregate(rows, n_boards), "rows": rows}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--boards", type=int, default=40)
    ap.add_argument("--seed", type=int, default=142)
    ap.add_argument("--risk", default="all", help="cautious|balanced|bold|all")
    ap.add_argument("--guesser", default="ensemble")
    ap.add_argument("--out", default=None)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    guesser = make_guesser(args.guesser)
    risks = ["cautious", "balanced", "bold"] if args.risk == "all" else [args.risk]
    print(f"guesser: {guesser.model_id}   boards: {args.boards}   seed: {args.seed}\n")

    results = {}
    for risk in risks:
        results[risk] = run(risk, args.boards, args.seed, guesser, args.verbose)

    cols = [
        "served_rate",
        "gained",
        "recovery",
        "safe_turn",
        "assassin",
        "over_claim",
        "mean_count",
        "legal",
    ]
    print(f"\n{'risk':9s} " + " ".join(f"{c:>11s}" for c in cols))
    for risk in risks:
        s = results[risk]["summary"]

        def cell(c):
            if c in ("served_rate", "mean_count"):
                return f"{s[c]:>11.3f}"
            return f"{s[c]:.3f}±{s[c + '_se']:.2f}"

        print(f"{risk:9s} " + " ".join(f"{cell(c):>11s}" for c in cols))
    print("\ngained = team words won/turn (higher better) · assassin = catastrophic (lower better)")

    if args.out:
        payload = {
            "guesser": guesser.model_id,
            "boards": args.boards,
            "seed": args.seed,
            "results": {r: results[r]["summary"] for r in risks},
            "rows": {r: results[r]["rows"] for r in risks},
        }
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
        print(f"saved → {args.out}")


if __name__ == "__main__":
    main()
