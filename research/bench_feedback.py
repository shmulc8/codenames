"""Clue-quality benchmark against the real user-feedback set.

Reconstructs each 👍/👎 spymaster board from the feedback log and measures the *current* engine:
  - legality: does it ever serve an illegal clue? (must be 0)
  - safety:   safe-run length of the served clue (team words before the first enemy word)
  - learning: for 👎 rows, would the engine still serve the disliked clue? is that clue now
              flagged illegal (i.e. would have been prevented)?
  - retention: for 👍 rows, is the liked clue still in the served shortlist?

Reads the feedback from the HF dataset (falls back to the local log). Run: python -m research.bench_feedback
"""
import os, json, collections
os.environ.setdefault("FASTTEXT_COMPRESSED", "data/cc.he.300.fp16.bin")
import numpy as np
import probe
from probe import Board

# risk profiles mirror app.RISK_PROFILES (generation knobs only)
RISK = {
    "cautious": dict(m=2, lam_a=3.0, lam_opp=1.5, lam_neu=0.5, safe_margin=0.05),
    "balanced": dict(m=3, lam_a=2.0, lam_opp=1.0, lam_neu=0.3, safe_margin=0.02),
    "bold":     dict(m=4, lam_a=1.5, lam_opp=0.7, lam_neu=0.2, safe_margin=0.0),
}
_ROLE_FIX = {"team": "my"}          # legacy feedback rows used "team" for the team role


def load_feedback():
    try:
        from huggingface_hub import hf_hub_download
        p = hf_hub_download("shmulc/codenames-feedback", "data/feedback.jsonl", repo_type="dataset")
    except Exception:
        p = os.path.join("feedback", "feedback.jsonl")
    return [json.loads(l) for l in open(p, encoding="utf-8") if l.strip()]


def board_of(row) -> Board:
    """Reconstruct the board the engine actually saw: revealed cards are excluded (the app
    drops them from analysis) and the legacy "team" role is normalised to "my"."""
    b = row["board"]
    revealed = set(row.get("revealed") or [])
    words = [w for w in b["words"] if w not in revealed]
    role = {w: _ROLE_FIX.get(b["roles"].get(w), b["roles"].get(w)) for w in words}
    return Board(words=words, role=role)


def safe_run(enc, board, clue) -> int:
    order, _ = probe.encoder_rank(enc, board, clue)
    n = 0
    for w in order:
        if board.role.get(w) == "my":
            n += 1
        else:
            break
    return n


def main() -> int:
    rows = [r for r in load_feedback()
            if r.get("mode") == "spymaster" and r.get("board", {}).get("words")
            and not any(t in (r.get("comment") or "").lower() for t in ("ignore", "test"))]
    up = [r for r in rows if r.get("verdict") == "up"]
    down = [r for r in rows if r.get("verdict") == "down"]
    print(f"feedback spymaster rows (test rows excluded): {len(rows)}  ({len(up)} 👍 / {len(down)} 👎)\n")

    enc = probe.make_encoder("fasttext")
    vocab, counts = probe.clue_vocab_band(20000, lo=300, hi=80000)
    emb = enc.embed(vocab)
    lems = list(vocab)                                   # content-band entries are already lemmas
    freq = probe.freq_scores(counts, lo=1500, hi=40000)

    def serve(board, risk, focus=None):
        prof = RISK.get(risk, RISK["balanced"])
        tgt = [w for w in (focus or []) if w in board.my] or None   # honour the user's pinned targets
        return probe.encoder_clue_candidates(enc, board, vocab, emb, vocab_lemmas=lems,
                                             vocab_freq=freq, lam_f=0.05, n=5, targets=tgt, **prof)

    our_illegal = 0
    safe_runs, safe_ge_count = [], 0
    down_reproduced = down_prevented = down_in_top5 = 0
    up_retained = 0

    for r in rows:
        board = board_of(r)
        if not board.my:
            continue
        cands = serve(board, r.get("risk") or "balanced", r.get("focus"))
        if not cands:
            continue
        words = [c["word"] for c in cands]
        top = cands[0]
        sr = safe_run(enc, board, top["word"])
        safe_runs.append(sr)
        safe_ge_count += int(sr >= max(1, top["count"]))
        if probe.shares_lemma(top["word"], board, enc=enc):
            our_illegal += 1
        hc = (r.get("clue") or "").strip()
        if r.get("verdict") == "down":
            if hc == top["word"]:
                down_reproduced += 1
            if hc in words:
                down_in_top5 += 1
            if probe.shares_lemma(hc, board, enc=enc):
                down_prevented += 1
        elif r.get("verdict") == "up":
            if hc in words:
                up_retained += 1

    print("engine health")
    print(f"  served-clue legality:        {len(safe_runs) - our_illegal}/{len(safe_runs)} legal"
          f"  ({'OK' if our_illegal == 0 else str(our_illegal) + ' ILLEGAL'})")
    print(f"  mean safe-run of served clue: {np.mean(safe_runs):.2f} team words before first enemy")
    print(f"  served clue safe for its own count (safe_run >= count): {safe_ge_count}/{len(safe_runs)}")
    print("\nlearning from 👎")
    print(f"  disliked clue now flagged illegal (would be prevented): {down_prevented}/{len(down)}")
    print(f"  engine still serves the disliked clue as top pick:      {down_reproduced}/{len(down)}")
    print(f"  disliked clue still anywhere in top-5:                  {down_in_top5}/{len(down)}")
    print("\nretention of 👍")
    print(f"  liked clue still in top-5 shortlist: {up_retained}/{len(up)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
