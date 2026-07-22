#!/usr/bin/env python3
"""Evaluate the live geometry spymaster with an external LLM referee.

The script deliberately reads credentials only from its process environment.
It never writes credentials, prompts, or model responses to the repository.

Example:
  OPENROUTER_API_KEY="..." FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin \\
    .venv/bin/python -m research.novita_eval --provider openrouter --model tencent/hy3:free
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import time
import urllib.error
import urllib.request
from statistics import mean

from codenames import app, probe

PROVIDERS = {
    "novita": ("https://api.novita.ai/openai/v1/chat/completions", "NOVITA_API_KEY", "tencent/hy3"),
    "openrouter": (
        "https://openrouter.ai/api/v1/chat/completions",
        "OPENROUTER_API_KEY",
        "tencent/hy3:free",
    ),
}
SYSTEM = (
    "אתה שחקן זהיר ומנוסה במשחק שם קוד בעברית. "
    "דרג את כל מילות הלוח לפי הקשר שלהן לרמז בלבד. "
    "אל תשתמש בצבעי הקלפים או במידע שאינו הרמז והמילים."
)


def external_ranking(
    api_url: str,
    api_key: str,
    model: str,
    board: probe.Board,
    clue: str,
    disable_reasoning: bool = False,
) -> list[str]:
    """Return a complete board-word ranking from a fixed, trusted provider endpoint."""
    user = (
        f"רמז: {clue}\n"
        f"מילות הלוח: {', '.join(board.words)}\n\n"
        'החזר JSON חוקי בלבד בצורה {"ranking":[...]}: כל 25 מילות הלוח, '
        "כל אחת בדיוק פעם אחת, מהקשורה ביותר לרמז עד הפחות קשורה."
    )
    request_data = {
        "model": model,
        "temperature": 0,
        "max_tokens": 8192,
        "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}],
    }
    if disable_reasoning:
        request_data["reasoning"] = {"enabled": False}
    payload = json.dumps(request_data).encode("utf-8")
    request = urllib.request.Request(
        api_url,
        data=payload,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = json.load(response)
    except urllib.error.HTTPError as exc:
        # Never include response bodies: providers can echo request contents in errors.
        raise RuntimeError(f"External LLM request failed with HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError("External LLM request failed due to a network error") from exc

    text = body["choices"][0]["message"].get("content")
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("External LLM returned no final ranking")
    try:
        items = json.loads(re.sub(r"^```(?:json)?\\s*|\\s*```$", "", text.strip())).get(
            "ranking", []
        )
    except (json.JSONDecodeError, AttributeError):
        items = re.split(r"[,\n]", text)
    ranked, seen = [], set()
    for item in items:
        word = probe._match_board(str(item), board.words)
        if word and word not in seen:
            ranked.append(word)
            seen.add(word)
    # The suffix is not treated as a successful model answer; it only gives metrics a
    # deterministic shape while `complete` records whether the answer was usable.
    return ranked + [word for word in board.words if word not in seen]


def live_clue(board: probe.Board, risk: str) -> dict:
    """Execute the geometry branch's shortlist, analysis, and ordering exactly."""
    profile = app.RISK_PROFILES[risk]
    vocabulary, embeddings, lemmas, frequencies = app.geo_assets()
    kwargs = {key: profile[key] for key in app._CAND_KEYS}
    candidates = probe.encoder_clue_candidates(
        app.get_enc(app.GEO_ENC),
        board,
        vocabulary,
        embeddings,
        vocab_lemmas=lemmas,
        vocab_freq=frequencies,
        lam_f=0.14,
        n=10,
        **kwargs,
    )
    options = [
        app._analyze_clue(
            board,
            candidate["word"],
            candidate["intended"],
            candidate["count"],
            candidate["score"],
            None,
            keep_rel=profile["keep"],
            max_count=profile["m"],
        )
        for candidate in candidates
    ]
    if risk == "bold":
        key = lambda option: (option["no_clue"], -option["count"], -option["safe"], option["score"])
    else:
        key = lambda option: (
            option["no_clue"],
            option["risky"],
            -option["safe"],
            -option["count"],
            -option["score"],
        )
    return min(options, key=key)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--boards", type=int, default=15)
    parser.add_argument("--seed", type=int, default=142)
    parser.add_argument("--risk", choices=app.RISK_PROFILES, default="balanced")
    parser.add_argument("--provider", choices=PROVIDERS, default="novita")
    parser.add_argument("--model", default=None)
    parser.add_argument("--out", default="data/novita_eval_results.json")
    args = parser.parse_args()
    api_url, key_name, default_model = PROVIDERS[args.provider]
    model = args.model or default_model
    api_key = os.environ.get(key_name)
    if not api_key:
        parser.error(f"{key_name} is required (set it in the environment; do not put it in a file)")

    rows = []
    for number in range(args.boards):
        board = probe.sample_board(random.Random(args.seed + number))
        option = live_clue(board, args.risk)
        ranking = external_ranking(api_url, api_key, model, board, option["word"])
        returned = len(set(ranking) & set(board.words))
        count = option["count"]
        picks = ranking[:count]
        safe_run = 0
        for word in ranking:
            if board.role[word] != "my":
                break
            safe_run += 1
        rows.append(
            {
                "clue": option["word"],
                "claimed": count,
                "intended": option["intended"],
                "recovered": len(set(picks) & set(option["intended"])),
                "safe_run": safe_run,
                "safe_turn": all(board.role[word] == "my" for word in picks),
                "assassin_in_picks": board.assassin in picks,
                "complete_ranking": returned == len(board.words),
            }
        )
        print(
            f"{number + 1:>2}/{args.boards}: {option['word']}·{count} "
            f"safe={safe_run} recovered={rows[-1]['recovered']}/{count} "
            f"complete={rows[-1]['complete_ranking']}",
            flush=True,
        )
        time.sleep(0.1)

    summary = {
        "provider": args.provider,
        "model": model,
        "boards": args.boards,
        "seed": args.seed,
        "risk": args.risk,
        "mean_claimed_words": round(mean(row["claimed"] for row in rows), 3),
        "mean_safe_words": round(mean(row["safe_run"] for row in rows), 3),
        "mean_recovered_words": round(mean(row["recovered"] for row in rows), 3),
        "target_recovery": round(
            mean(row["recovered"] / max(1, row["claimed"]) for row in rows), 3
        ),
        "safe_turn_rate": round(mean(row["safe_turn"] for row in rows), 3),
        "assassin_pick_rate": round(mean(row["assassin_in_picks"] for row in rows), 3),
        "complete_ranking_rate": round(mean(row["complete_ranking"] for row in rows), 3),
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump({"summary": summary, "rows": rows}, handle, ensure_ascii=False, indent=2)
    print("\n" + json.dumps(summary, ensure_ascii=False, indent=2))
    print(f"saved → {args.out}")


if __name__ == "__main__":
    main()
