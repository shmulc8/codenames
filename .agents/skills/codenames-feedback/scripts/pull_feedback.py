"""Pull the latest Codenames feedback from the private HF dataset and summarize it.

Run from the repo root: python .claude/skills/codenames-feedback/scripts/pull_feedback.py
Uses the stored HF token automatically (no HF_TOKEN env needed).
"""

import datetime
import json
import os

DATASET = "shmulc/codenames-feedback"


def main() -> int:
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(DATASET, "data/feedback.jsonl", repo_type="dataset", force_download=True)
    rows = [json.loads(l) for l in open(path, encoding="utf-8") if l.strip()]

    local = os.path.join("feedback", "feedback.jsonl")
    n_local = sum(1 for _ in open(local, encoding="utf-8")) if os.path.exists(local) else 0

    up = sum(1 for r in rows if r.get("verdict") == "up")
    down = sum(1 for r in rows if r.get("verdict") == "down")
    ts = [r["ts"] for r in rows if "ts" in r]
    fmt = lambda t: datetime.datetime.fromtimestamp(t).strftime("%Y-%m-%d %H:%M")
    print(
        f"{DATASET}: {len(rows)} rows  |  👍 {up}  👎 {down}"
        + (f"  |  {len(rows) - n_local} new vs local" if n_local else "")
    )
    if ts:
        print(f"span: {fmt(min(ts))} → {fmt(max(ts))}")

    print("\n-- comments (highest-signal rows) --")
    any_c = False
    for r in sorted(rows, key=lambda r: r.get("ts", 0)):
        c = (r.get("comment") or "").strip()
        if not c:
            continue
        any_c = True
        t = datetime.datetime.fromtimestamp(r["ts"]).strftime("%m-%d %H:%M") if "ts" in r else "?"
        v = "👍" if r.get("verdict") == "up" else ("👎" if r.get("verdict") == "down" else "•")
        flag = "  [test/ignore]" if any(x in c.lower() for x in ("ignore", "test")) else ""
        print(
            f"{t} {v} {r.get('clue', '')!r}·{r.get('count')} → {','.join(r.get('intended') or [])}  💬 {c}{flag}"
        )
    if not any_c:
        print("(none)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
