"""Benchmark Hebrew Codenames clue quality.

Turns "the clues are bad" into numbers. For each spymaster configuration it measures:
  - ambition / efficiency: the target size m and how many team words the clue *delivers*,
  - cooperative recovery + safety: a CROSS-engine guesser (NeoDictaBERT — different from the
    fastText geometry) ranks the board for the clue; we count intended team words picked
    before any opponent/neutral/assassin mistake (Koyyalagunta: cross-engine = honest),
  - legality rate (shared-lemma, DictaBERT), and
  - a DictaLM 1-5 relevance judge.

The configs isolate the DETECT-style levers (Koyyalagunta et al. 2021):
  - vocab `content` (most-frequent content lemmas, dialogue-contaminated) vs `band`
    (mid-frequency band of the same list — FREQ applied at vocab-build time),
  - the soft FREQ scoring term (`lam_f`), and
  - target size m.

  HF_HUB_OFFLINE=1 .venv/bin/python -m research.bench --n 15
      [--model 1.7b|12b] [--no-judge] [--configs geom,band] [--out bench_results.json]
"""

import os

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import argparse
import json
import random
import re
from statistics import mean

import probe

SPY_ENC = (
    "fasttext"  # the spymaster geometry (Hebrew word-similarity champion: 100% on a triplet probe)
)
GUESS_ENC = "embeddinggemma"  # cross-engine guesser: competent at Hebrew words (92% triplet) AND independent
# of fastText. NeoDictaBERT is a *sentence* embedder, weak on isolated words
# (71% triplet, unfixed by whitening) — a noisy judge, so not the guesser.

CONFIGS = [
    dict(name="geom·content·m3", engine="geometry", vocab="content", m=3),  # baseline
    dict(name="geom·band·m3", engine="geometry", vocab="band", m=3),  # vocab fix
    dict(name="geom·band·freq", engine="geometry", vocab="band", m=3, lam_f=0.15),  # + soft FREQ
    dict(name="hybrid·band", engine="hybrid", vocab="band", m=3, lam_f=0.15),  # + LLM pick
    dict(name="llm", engine="llm", vocab=None, m=None),  # pure LLM
]

_JUDGE_SYS = (
    "אתה שופט מומחה למשחק 'שם קוד'. דרג את איכות הרמז מ-1 (גרוע או לא רלוונטי) עד 5 (מצוין). "
    "רמז טוב הוא מילה אחת טבעית, שקשורה היטב למילות הצוות המכוונות, מקשרת כמה שיותר מהן, "
    "ורחוקה ממילות היריב ובמיוחד מהמתנקש. החזר אך ורק: 'ציון: <מספר בין 1 ל-5>'."
)


def judge(llm, board, clue):
    user = (
        f"מילות הצוות: {', '.join(board.my)}\n"
        f"היריב: {', '.join(board.of('opp'))}\nניטרלי: {', '.join(board.of('neutral'))}\n"
        f"מתנקש: {board.assassin}\n\n"
        f"רמז: {clue.word} ({clue.count}) שמכוון אל: {', '.join(clue.intended)}\n\nדרג:"
    )
    m = re.search(r"[1-5]", llm.chat(_JUDGE_SYS, user, max_tokens=16))
    return int(m.group()) if m else None


def spymaster(cfg, board, A):
    if cfg["engine"] == "llm":
        return probe.llm_spymaster(A["llm"], board)
    words, emb, lems, fz = A["vocab"][cfg["vocab"]]
    lam_f = cfg.get("lam_f", 0.0)
    if cfg["engine"] == "geometry":
        return probe.encoder_spymaster(
            A["enc"], board, words, emb, vocab_lemmas=lems, lam_f=lam_f, vocab_freq=fz, m=cfg["m"]
        )
    cands = probe.encoder_clue_candidates(
        A["enc"], board, words, emb, vocab_lemmas=lems, n=10, lam_f=lam_f, vocab_freq=fz, m=cfg["m"]
    )
    return probe.llm_pick_clue(A["llm"], board, cands)


def evaluate(clue, board, A, do_judge):
    if clue is None:
        return None
    order, _ = probe.encoder_rank(A["guess"], board, clue.word)
    picks = order[: max(1, clue.count)]
    intended_hit = len(set(picks) & set(clue.intended))
    mistakes = [w for w in picks if board.role[w] != "my"]
    return {
        "clue": clue.word,
        "count": clue.count,
        "intended": clue.intended,
        "legal": not probe.shares_lemma(clue.word, board),
        "intended_hit": intended_hit,
        "recovery": intended_hit / max(1, clue.count),
        "safe": len(mistakes) == 0,
        "assassin_hit": board.assassin in picks,
        "judge": judge(A["llm"], board, clue) if do_judge else None,
    }


from exp_encoders import make_exp_encoder


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=15)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--model", choices=["1.7b", "12b"], default="1.7b")
    ap.add_argument("--no-judge", action="store_true")
    ap.add_argument(
        "--configs", default="", help="comma-separated substrings; keep matching configs"
    )
    ap.add_argument("--out", default="bench_results.json")
    ap.add_argument(
        "--trim",
        action="store_true",
        help="compare count-trim strategies (raw vs keep_rel vs cohesion) instead of engine configs",
    )
    ap.add_argument(
        "--floor", type=float, default=0.24, help="cohesion floor for the --trim comparison"
    )
    ap.add_argument(
        "--keep", type=float, default=0.45, help="keep_rel for the --trim comparison (bold=0.45)"
    )
    ap.add_argument(
        "--gen-m", type=int, default=3, help="target size m for clue generation in --trim mode"
    )
    ap.add_argument(
        "--spy-enc",
        default="fasttext",
        help="experimental or registered encoder key for the spymaster",
    )
    args = ap.parse_args()
    do_judge = not args.no_judge and not args.trim  # trim comparison is geometry-only, no LLM judge
    mid = probe.LLM_BIG if args.model == "12b" else probe.LLM_FAST

    cfgs = CONFIGS
    if args.configs:
        keys = [k.strip() for k in args.configs.split(",") if k.strip()]
        cfgs = [c for c in CONFIGS if any(k in c["name"] for k in keys)]
    need_llm = do_judge or (not args.trim and any(c["engine"] in ("llm", "hybrid") for c in cfgs))
    need_geo = args.trim or any(c["engine"] != "llm" for c in cfgs)

    print(
        f"loading … spymaster={args.spy_enc} guesser={GUESS_ENC} llm={args.model if need_llm else 'off'}"
    )
    enc = make_exp_encoder(args.spy_enc) if need_geo else None
    guess = probe.make_encoder(GUESS_ENC)
    llm = probe.HebrewLLM(mid) if need_llm else None

    A = {"enc": enc, "guess": guess, "llm": llm, "vocab": {}}
    if need_geo:
        freqs = probe.load_freqs()
        if any(c.get("vocab") == "content" for c in cfgs):
            content = probe.load_clue_vocab_content(1500)
            cc = [freqs.get(w, 0) for w in content]
            A["vocab"]["content"] = (content, enc.embed(content), content, probe.freq_scores(cc))
        if args.trim or any(c.get("vocab") == "band" for c in cfgs):
            bw, bc = probe.clue_vocab_band(1800, lo=300, hi=80000, pos={"NOUN", "ADJ"})
            A["vocab"]["band"] = (bw, enc.embed(bw), bw, probe.freq_scores(bc, lo=1500, hi=40000))
        print("vocab: " + "  ".join(f"{k}={len(v[0])}" for k, v in A["vocab"].items()))

    boards = [probe.sample_board(random.Random(args.seed + i)) for i in range(args.n)]

    if args.trim:
        trim_report(A, boards, args)
        return

    results, samples = {}, {}
    for cfg in cfgs:
        rows = []
        for bi, board in enumerate(boards):
            ev = evaluate(spymaster(cfg, board, A), board, A, do_judge)
            if ev:
                rows.append(ev)
            print(
                f"  [{cfg['name']:22}] board {bi + 1}/{args.n}: "
                f"{ev['clue'] if ev else '—'} ({ev['count'] if ev else '-'})",
                flush=True,
            )
        results[cfg["name"]] = agg(rows)
        samples[cfg["name"]] = [
            (r["clue"], r["count"], r["intended"], r["intended_hit"]) for r in rows[:6]
        ]

    report(results, samples, args)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(
            {"args": vars(args), "results": results, "samples": samples},
            f,
            ensure_ascii=False,
            indent=2,
        )
    print(f"\nsaved → {args.out}")


def trim_report(A, boards, args):
    """Compare count-trim strategies on identical generated clues. For each board the geometry
    proposes one clue (m=`gen-m`); we then claim its words three ways and score each with the
    cross-engine guesser:
      raw       — claim the top-m team words (no trim),
      keep_rel  — the relative count-trim (strong-vs-top + cliff),
      cohesion  — keep_rel then drop words that don't cohere with the cluster (floor=`floor`).
    Reports count, the 1-word-clue rate (weak/trivial in Codenames — lower is better), delivered
    team words, guesser recovery, and safety. Cohesion should raise recovery/safety by shedding
    passenger words, ideally without spiking the 1-word rate."""
    words, emb, lems, fz = A["vocab"]["band"]
    enc, guess = A["enc"], A["guess"]
    floor, keep = args.floor, args.keep
    # raw/keep_rel/cohesion trim the SAME single-best clue (isolates the trim). coh+order is the
    # production path: cohesion over a 10-clue shortlist, then the live ordering that demotes a
    # lonely 1-word clue below any 2+ clue — so a collapsed top clue is replaced, not served.
    VARIANTS = ["raw", "keep_rel", "cohesion", "coh+order"]
    acc = {v: [] for v in VARIANTS}
    ex = []

    def read_of(clue_word):
        _, sims = probe.encoder_rank(enc, board, clue_word)
        r = [{"word": w, "role": board.role[w], "sim": sims[w]} for w in board.words]
        r.sort(key=lambda x: -x["sim"])
        return r

    def score(clue_word, intended):  # cross-engine guesser eval
        gorder, _ = probe.encoder_rank(guess, board, clue_word)
        count = max(1, len(intended))
        picks = gorder[:count]
        hit = len(set(picks) & set(intended))
        return dict(
            count=count,
            one=count == 1,
            delivered=hit,
            recovery=hit / count,
            safe=all(board.role[w] == "my" for w in picks),
            assassin=board.assassin in picks,
        )

    for bi, board in enumerate(boards):
        clue = probe.encoder_spymaster(
            enc, board, words, emb, vocab_lemmas=lems, lam_f=0.15, vocab_freq=fz, m=args.gen_m
        )
        if clue is None:
            continue
        read = read_of(clue.word)
        kr = probe.served_count(read, keep_rel=keep)
        if not kr:  # no safe run = refusal in every variant
            continue
        served = {
            "raw": clue.intended,
            "keep_rel": kr,
            "cohesion": probe.served_count(read, keep_rel=keep, enc=enc, cohesion_floor=floor),
        }
        # production: cohesion over the shortlist, then live ordering (refusals last, 2+ before 1-word, coverage)
        cands = probe.encoder_clue_candidates(
            enc, board, words, emb, vocab_lemmas=lems, vocab_freq=fz, lam_f=0.15, n=10, m=args.gen_m
        )
        analyzed = [
            (
                c["word"],
                probe.served_count(
                    read_of(c["word"]), keep_rel=keep, enc=enc, cohesion_floor=floor
                ),
            )
            for c in cands
        ]
        analyzed.sort(key=lambda t: (0 if t[1] else 1, 0 if len(t[1]) >= 2 else 1, -len(t[1])))
        served["coh+order"] = analyzed[0][1] or [analyzed[0][0]]
        pick_word = analyzed[0][0]

        row = {"clue": clue.word}
        for v in VARIANTS:
            cw = pick_word if v == "coh+order" else clue.word
            acc[v].append(score(cw, served[v]))
            row[v] = f"{max(1, len(served[v]))}·{'/'.join(served[v])}" + (
                f"={pick_word}" if v == "coh+order" else ""
            )
        if len(ex) < 8:
            ex.append(row)
        print(
            f"  board {bi + 1}/{len(boards)}: {clue.word}  raw={len(served['raw'])} "
            f"keep={len(served['keep_rel'])} coh={len(served['cohesion'])} "
            f"prod={pick_word}·{len(served['coh+order'])}",
            flush=True,
        )

    print(
        f"\n{'=' * 86}\nTRIM COMPARISON  (n={len(acc['raw'])} clues, gen m={args.gen_m}, "
        f"keep_rel={keep}, cohesion floor={floor}, guesser={GUESS_ENC})\n{'=' * 86}"
    )
    cols = ["count", "1word%", "delivered", "recovery", "safe%", "assassin%"]
    print(f"{'trim':12} " + " ".join(f"{c:>10}" for c in cols))
    for v in VARIANTS:
        rows = acc[v]
        if not rows:
            print(f"{v:12}  (no results)")
            continue
        print(
            f"{v:12} "
            f"{mean(r['count'] for r in rows):>10.2f} "
            f"{round(100 * mean(r['one'] for r in rows)):>10} "
            f"{mean(r['delivered'] for r in rows):>10.2f} "
            f"{mean(r['recovery'] for r in rows):>10.3f} "
            f"{round(100 * mean(r['safe'] for r in rows)):>10} "
            f"{round(100 * mean(r['assassin'] for r in rows)):>10}"
        )
    print("\nsample (clue: raw → keep_rel → cohesion):")
    for r in ex:
        print(f"  {r['raw']}   →   {r['keep_rel']}   →   {r['cohesion']}")
    out = {"args": vars(args), "trim": {v: agg_trim(acc[v]) for v in VARIANTS}}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\nsaved → {args.out}")


def agg_trim(rows):
    if not rows:
        return {"n": 0}
    return {
        "n": len(rows),
        "count": round(mean(r["count"] for r in rows), 2),
        "one_word_pct": round(100 * mean(r["one"] for r in rows)),
        "delivered": round(mean(r["delivered"] for r in rows), 2),
        "recovery": round(mean(r["recovery"] for r in rows), 3),
        "safe_pct": round(100 * mean(r["safe"] for r in rows)),
        "assassin_pct": round(100 * mean(r["assassin"] for r in rows)),
    }


def agg(rows):
    if not rows:
        return {"n": 0}
    j = [r["judge"] for r in rows if r["judge"] is not None]
    return {
        "n": len(rows),
        "count": round(mean(r["count"] for r in rows), 2),
        "delivered": round(mean(r["intended_hit"] for r in rows), 2),
        "recovery": round(mean(r["recovery"] for r in rows), 3),
        "legal%": round(100 * mean(r["legal"] for r in rows)),
        "safe%": round(100 * mean(r["safe"] for r in rows)),
        "assassin%": round(100 * mean(r["assassin_hit"] for r in rows)),
        "judge": round(mean(j), 2) if j else None,
    }


def report(results, samples, args):
    print(
        f"\n{'=' * 92}\nBENCHMARK  (n={args.n} boards, guesser={GUESS_ENC}, llm={args.model})\n{'=' * 92}"
    )
    cols = ["count", "delivered", "recovery", "legal%", "safe%", "assassin%", "judge"]
    print(f"{'config':24} " + " ".join(f"{c:>10}" for c in cols))
    for name, r in results.items():
        if not r.get("n"):
            print(f"{name:24}  (no results)")
            continue
        print(f"{name:24} " + " ".join(f"{str(r.get(c, '')):>10}" for c in cols))
    print("\nsample clues (clue·count → intended [#recovered by guesser]):")
    for name, s in samples.items():
        ex = "  ".join(f"{w}·{c}→{'/'.join(it)}[{h}]" for w, c, it, h in s[:4])
        print(f"  {name:24} {ex}")


if __name__ == "__main__":
    main()
