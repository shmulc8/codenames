"""12B oracle: does the LLM-free (geometry) spymaster hold up against a DictaLM spymaster,
judged by a *strong* model (DictaLM-3.0 12B) as a stand-in for a human rater?

Memory-light by design: the geometry clues come from the already-running co-pilot server
(so we don't load a second fastText), and this process loads ONLY the 12B — to both
generate the LLM clues and judge both sides on the same boards.

    # with app.py running on :7860
    HF_HUB_OFFLINE=1 .venv/bin/python -m research.oracle --n 12
"""

import os

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import argparse
import json
import random
import urllib.request
from statistics import mean

import probe
from research import bench

SERVER = "http://127.0.0.1:7860"


def geo_clue(board):
    body = json.dumps({"words": board.words, "roles": board.role, "engine": "geometry"}).encode()
    req = urllib.request.Request(
        SERVER + "/api/coach/spymaster", body, {"Content-Type": "application/json"}
    )
    r = json.load(urllib.request.urlopen(req, timeout=120))
    return probe.Clue(word=r["clue"], count=r["count"], intended=r["intended"], margin=0.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=12)
    ap.add_argument("--seed", type=int, default=21)
    args = ap.parse_args()

    print("loading 12B judge (DictaLM-3.0-Nemotron-12B) ...", flush=True)
    llm = probe.HebrewLLM(probe.LLM_BIG)
    boards = [probe.sample_board(random.Random(args.seed + i)) for i in range(args.n)]

    rows = []
    for i, b in enumerate(boards):
        g = geo_clue(b)  # LLM-free clue, from the live server
        l = probe.llm_spymaster(llm, b)  # 12B clue
        gj = bench.judge(llm, b, g)  # 12B judges the geometry clue
        lj = bench.judge(llm, b, l) if l else None  # 12B judges its own clue
        rows.append(
            {
                "geo": g.word,
                "geo_count": g.count,
                "geo_intended": g.intended,
                "geo_j": gj,
                "llm": (l.word if l else None),
                "llm_j": lj,
            }
        )
        print(
            f"[{i + 1}/{args.n}] geometry: {g.word}({g.count}) j={gj}  |  "
            f"llm: {l.word if l else '—'} j={lj}",
            flush=True,
        )

    gj = [r["geo_j"] for r in rows if r["geo_j"] is not None]
    lj = [r["llm_j"] for r in rows if r["llm_j"] is not None]
    wins = sum(
        1
        for r in rows
        if r["geo_j"] is not None and r["llm_j"] is not None and r["geo_j"] >= r["llm_j"]
    )
    both = sum(1 for r in rows if r["geo_j"] is not None and r["llm_j"] is not None)
    print(f"\n{'=' * 60}\n12B ORACLE  (n={args.n}, judge=DictaLM-3.0-12B)\n{'=' * 60}")
    print(f"geometry (NO LLM):  judge {mean(gj):.2f}   (n={len(gj)})")
    print(f"llm (DictaLM 12B):  judge {mean(lj):.2f}   (n={len(lj)})")
    print(f"geometry >= llm on {wins}/{both} boards")
    json.dump(
        {
            "args": vars(args),
            "rows": rows,
            "geometry_judge": round(mean(gj), 2) if gj else None,
            "llm_judge": round(mean(lj), 2) if lj else None,
            "geometry_ge_llm": f"{wins}/{both}",
        },
        open("bench_oracle.json", "w", encoding="utf-8"),
        ensure_ascii=False,
        indent=2,
    )
    print("saved → bench_oracle.json")


if __name__ == "__main__":
    main()
