"""Evaluate the spymaster engine using the v1 LLM judge.

FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin \\
OPENAI_API_KEY="sk-..." \\
  .venv/bin/python -m research.eval [--boards 1] [--hints 3] [--seed 42] \\
                                     [--risk balanced] [--model gpt-4o] \\
                                     [--out data/eval_results.json]
"""

import argparse
import json
import os
import random
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import openai

sys.path.insert(0, str(Path(__file__).parent.parent))
import probe
from app import serve_clue


@dataclass(frozen=True)
class HintEntry:
    hint: str
    count: int
    intended: list[str]
    engine_score: float


@dataclass(frozen=True)
class WordLink:
    word: str
    category: str  # active | opponent | neutral | assassin
    strength: str  # strong | moderate | weak
    reason: str


@dataclass(frozen=True)
class EvalResult:
    hint: str
    score: float | None
    reason: str
    connected_active: list[WordLink]
    missed_active: list[WordLink]
    dangerous_links: list[WordLink]
    count_claimed: int | None
    count_verified: int | None
    assassin_risk: str
    opponent_risk: str
    neutral_risk: str
    raw: Any


@dataclass(frozen=True)
class BoardResult:
    board_number: int
    seed: int
    red_words: list[str]
    blue_words: list[str]
    neutral_words: list[str]
    assassin: str
    red_results: list[EvalResult]
    blue_results: list[EvalResult]


def flip_board(b: probe.Board) -> probe.Board:
    swap = {"my": "opp", "opp": "my"}
    return probe.Board(words=b.words, role={w: swap.get(r, r) for w, r in b.role.items()})


def load_prompt(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def top_hints(board: probe.Board, risk: str, n: int, min_count: int = 1) -> list[HintEntry]:
    options, _ = serve_clue(board, risk=risk)
    valid = [o for o in options if not o.get("no_clue", False) and o.get("count", 1) >= min_count]
    return [
        HintEntry(
            hint=o["word"],
            count=o["count"],
            intended=o.get("intended", []),
            engine_score=o.get("score", 0.0),
        )
        for o in valid[:n]
    ]


def build_payload(
    hints: list[HintEntry],
    active_team: str,
    my_words: list[str],
    opp_words: list[str],
    neutral_words: list[str],
    assassin: str,
) -> dict:
    return {
        "hints": [{"hint": h.hint, "count": h.count} for h in hints],
        "active-team": active_team,
        "active-team-words": [{"word": w} for w in my_words],
        "opponent-words": [{"word": w} for w in opp_words],
        "neutral-words": [{"word": w} for w in neutral_words],
        "assassin-word": {"word": assassin},
    }


def call_judge(client: openai.OpenAI, model: str, prompt: str, payload: dict) -> Any:
    response = client.chat.completions.create(
        model=model,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": prompt},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
    )
    return json.loads(response.choices[0].message.content)


def safe_call_judge(
    client: openai.OpenAI, model: str, prompt: str, payload: dict, label: str
) -> Any:
    try:
        return call_judge(client, model, prompt, payload)
    except Exception as exc:
        print(f"  [WARNING] {label} call failed: {exc}")
        return {"error": str(exc)}


def _parse_word_links(entries: list[dict], category: str) -> list[WordLink]:
    out = []
    for e in entries or []:
        if not isinstance(e, dict):
            continue
        out.append(WordLink(
            word=e.get("word", ""),
            category=e.get("category", category),
            strength=e.get("strength", "weak"),
            reason=e.get("reason", ""),
        ))
    return out


def parse_single(raw: dict, hint_word: str) -> EvalResult:
    if not isinstance(raw, dict):
        return EvalResult(
            hint=hint_word, score=None, reason=str(raw),
            connected_active=[], missed_active=[], dangerous_links=[],
            count_claimed=None, count_verified=None,
            assassin_risk="none", opponent_risk="none", neutral_risk="none", raw=raw,
        )

    score = raw.get("score")
    reason = raw.get("reason", "")

    connected_active = _parse_word_links(raw.get("connected-active-words", []), "active")
    missed_active = _parse_word_links(raw.get("missed-active-words", []), "active")
    dangerous_links = _parse_word_links(raw.get("links-to-unrelated-words", []), "unknown")

    assassin_risk = raw.get("assassin-risk", "none")
    opponent_risk = raw.get("opponent-risk", "none")
    neutral_risk = raw.get("neutral-risk", "none")

    count_claimed = raw.get("count-claimed")
    count_verified = raw.get("count-verified")

    return EvalResult(
        hint=raw.get("hint", hint_word),
        score=float(score) if score is not None else None,
        reason=reason,
        connected_active=connected_active,
        missed_active=missed_active,
        dangerous_links=dangerous_links,
        count_claimed=count_claimed,
        count_verified=count_verified,
        assassin_risk=assassin_risk,
        opponent_risk=opponent_risk,
        neutral_risk=neutral_risk,
        raw=raw,
    )


def parse_response(raw: Any, hints: list[HintEntry]) -> list[EvalResult]:
    if not isinstance(raw, dict):
        return [
            EvalResult(hint=h.hint, score=None, reason=str(raw),
                       connected_active=[], missed_active=[], dangerous_links=[],
                       count_claimed=None, count_verified=None,
                       assassin_risk="none", opponent_risk="none", neutral_risk="none", raw=raw)
            for h in hints
        ]

    results_list = raw.get("results")
    if results_list is None:
        results_list = [raw]

    out: list[EvalResult] = []
    for i, h in enumerate(hints):
        if i < len(results_list):
            out.append(parse_single(results_list[i], h.hint))
        else:
            out.append(EvalResult(
                hint=h.hint, score=None, reason="missing",
                connected_active=[], missed_active=[], dangerous_links=[],
                count_claimed=None, count_verified=None,
                assassin_risk="none", opponent_risk="none", neutral_risk="none", raw=None,
            ))
    return out


def evaluate_team(
    client: openai.OpenAI,
    model: str,
    prompt: str,
    hints: list[HintEntry],
    active_team: str,
    my_words: list[str],
    opp_words: list[str],
    neutral_words: list[str],
    assassin: str,
) -> list[EvalResult]:
    payload = build_payload(hints, active_team, my_words, opp_words, neutral_words, assassin)
    raw = safe_call_judge(client, model, prompt, payload, f"eval/{active_team}")
    return parse_response(raw, hints)


def _risk_icon(level: str) -> str:
    return {"none": "·", "weak": "~", "moderate": "!", "strong": "!!"}.get(level, "?")


def print_result(h: HintEntry, r: EvalResult) -> None:
    score_str = f"{r.score:.2f}" if r.score is not None else "n/a"
    count_str = ""
    if r.count_claimed is not None and r.count_verified is not None:
        mismatch = " ⚠" if r.count_claimed != r.count_verified else ""
        count_str = f"  claimed={r.count_claimed} verified={r.count_verified}{mismatch}"

    connected_words = [f"{w.word}({w.strength[0]})" for w in r.connected_active]
    missed_words = [f"{w.word}" for w in r.missed_active]
    dangerous = [f"{w.word}:{w.category[0]}({w.strength[0]})" for w in r.dangerous_links]

    print(f"\n  {r.hint}·{h.count}  score={score_str}{count_str}")
    if connected_words:
        print(f"  ✓ connected: {', '.join(connected_words)}")
    if missed_words:
        print(f"  ✗ missed:    {', '.join(missed_words)}")
    if dangerous:
        print(f"  ⚠ risk:      {', '.join(dangerous)}")
    risk = f"assassin={_risk_icon(r.assassin_risk)} opp={_risk_icon(r.opponent_risk)} neutral={_risk_icon(r.neutral_risk)}"
    print(f"  {risk}  \"{r.reason[:120]}\"")


def result_to_dict(h: HintEntry, r: EvalResult) -> dict:
    return {
        "hint": r.hint,
        "count": h.count,
        "intended": h.intended,
        "engine_score": h.engine_score,
        "judge_score": r.score,
        "count_claimed": r.count_claimed,
        "count_verified": r.count_verified,
        "connected_active": [{"word": w.word, "strength": w.strength} for w in r.connected_active],
        "missed_active": [{"word": w.word, "strength": w.strength} for w in r.missed_active],
        "dangerous_links": [{"word": w.word, "category": w.category, "strength": w.strength} for w in r.dangerous_links],
        "assassin_risk": r.assassin_risk,
        "opponent_risk": r.opponent_risk,
        "neutral_risk": r.neutral_risk,
        "reason": r.reason,
    }


def run(
    boards: int,
    hints_per_team: int,
    seed: int,
    risk: str,
    model: str,
    out: str,
    prompt: str,
    min_count: int = 1,
) -> None:
    client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    rng = random.Random(seed)
    all_boards: list[dict] = []

    for board_num in range(1, boards + 1):
        board = probe.sample_board(rng)
        flipped = flip_board(board)

        red_words = board.my
        blue_words = flipped.my
        neutral_words = [w for w in board.words if board.role[w] == "neutral"]
        assassin_word = board.assassin

        red_hints = top_hints(board, risk, hints_per_team, min_count=min_count)
        blue_hints = top_hints(flipped, risk, hints_per_team, min_count=min_count)

        print(f"\n{'═' * 2} Board #{board_num} {'═' * 44}")
        print(f"RED ({len(red_words)}): {' '.join(red_words)}")
        print(f"BLUE ({len(blue_words)}): {' '.join(blue_words)}")
        print(f"assassin: {assassin_word}")

        red_results = evaluate_team(
            client, model, prompt,
            red_hints, "red", red_words, blue_words, neutral_words, assassin_word,
        )
        blue_results = evaluate_team(
            client, model, prompt,
            blue_hints, "blue", blue_words, red_words, neutral_words, assassin_word,
        )

        print("\n--- RED ---")
        for h, r in zip(red_hints, red_results):
            print_result(h, r)

        print("\n--- BLUE ---")
        for h, r in zip(blue_hints, blue_results):
            print_result(h, r)

        all_boards.append({
            "board_number": board_num,
            "seed": seed + board_num - 1,
            "red_words": red_words,
            "blue_words": blue_words,
            "neutral_words": neutral_words,
            "assassin": assassin_word,
            "red": [result_to_dict(h, r) for h, r in zip(red_hints, red_results)],
            "blue": [result_to_dict(h, r) for h, r in zip(blue_hints, blue_results)],
        })

    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps({"model": model, "risk": risk, "boards": all_boards}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\nResults saved to {out_path}")


def _load_dotenv() -> None:
    """Populate os.environ from a repo-root .env (never overrides an existing var)."""
    path = Path(__file__).resolve().parents[1] / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    _load_dotenv()
    parser = argparse.ArgumentParser(description="Evaluate the spymaster engine with the v1 LLM judge.")
    parser.add_argument("--boards", type=int, default=1)
    parser.add_argument("--hints", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--risk", default="balanced")
    parser.add_argument("--model", default="gpt-5.6-terra")
    parser.add_argument("--out", default="data/eval_results.json")
    parser.add_argument("--min-count", type=int, default=1)
    args = parser.parse_args()

    prompt = load_prompt(Path(__file__).parent.parent / "docs" / "v1-eval-prompt.md")

    run(
        boards=args.boards,
        hints_per_team=args.hints,
        seed=args.seed,
        risk=args.risk,
        model=args.model,
        out=args.out,
        prompt=prompt,
        min_count=args.min_count,
    )


if __name__ == "__main__":
    main()
