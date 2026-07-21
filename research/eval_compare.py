"""
FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin \\
OPENAI_API_KEY="sk-..." \\
  .venv/bin/python -m research.eval_compare [--boards 1] [--hints 3] [--seed 42] \\
                                              [--risk balanced] [--model gpt-4o] \\
                                              [--out data/eval_compare_results.json]
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
    score: float


@dataclass(frozen=True)
class EvalResult:
    score: float | None
    reason: str
    assassin_risk: str
    opponent_risk: str
    neutral_risk: str
    raw: Any


@dataclass(frozen=True)
class HintComparison:
    hint: str
    count: int
    intended: list[str]
    original: EvalResult
    v1: EvalResult
    delta: float | None


@dataclass(frozen=True)
class TeamResult:
    hints: list[HintEntry]
    original_eval_response: Any
    v1_eval_response: Any
    per_hint_comparison: list[HintComparison]


@dataclass(frozen=True)
class BoardResult:
    board_number: int
    seed: int
    red_words: list[str]
    blue_words: list[str]
    neutral_words: list[str]
    assassin: str
    red_team: TeamResult
    blue_team: TeamResult


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
            score=o.get("score", 0.0),
        )
        for o in valid[:n]
    ]


def build_original_payload(
    hints: list[HintEntry],
    active_team: str,
    my_words: list[str],
    opp_words: list[str],
    neutral_words: list[str],
    assassin: str,
) -> dict:
    red_words = my_words if active_team == "red" else opp_words
    blue_words = opp_words if active_team == "red" else my_words
    return {
        "hints": [{"hint": h.hint, "count": h.count} for h in hints],
        "active-team": active_team,
        "red-words": [{"word": w} for w in red_words],
        "blue-words": [{"word": w} for w in blue_words],
        "neutral-words": [{"word": w} for w in neutral_words],
        "assassin-word": {"word": assassin},
    }


def build_v1_payload(
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


def call_openai(client: openai.OpenAI, model: str, system: str, payload: dict) -> Any:
    response = client.chat.completions.create(
        model=model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
    )
    return json.loads(response.choices[0].message.content)


def safe_call_openai(
    client: openai.OpenAI, model: str, system: str, payload: dict, label: str
) -> Any:
    try:
        return call_openai(client, model, system, payload)
    except Exception as exc:
        print(f"  [WARNING] {label} call failed: {exc}")
        return {"error": str(exc)}


def _risk_key(d: dict, *keys: str) -> str:
    for k in keys:
        if k in d:
            return d[k]
    return "none"


def extract_single_result(raw: Any, hint_word: str) -> EvalResult:
    if not isinstance(raw, dict):
        return EvalResult(score=None, reason=str(raw), assassin_risk="none", opponent_risk="none", neutral_risk="none", raw=raw)

    score = raw.get("score")
    reason = raw.get("reason", "")

    risk_summary = raw.get("risk-summary", raw)
    assassin_risk = _risk_key(risk_summary, "assassin-risk", "assassin_risk")
    opponent_risk = _risk_key(risk_summary, "opponent-risk", "opponent_risk")
    neutral_risk = _risk_key(risk_summary, "neutral-risk", "neutral_risk")

    return EvalResult(
        score=float(score) if score is not None else None,
        reason=reason,
        assassin_risk=assassin_risk,
        opponent_risk=opponent_risk,
        neutral_risk=neutral_risk,
        raw=raw,
    )


def parse_multi_response(raw: Any, hints: list[HintEntry]) -> list[EvalResult]:
    if not isinstance(raw, dict):
        return [EvalResult(score=None, reason=str(raw), assassin_risk="none", opponent_risk="none", neutral_risk="none", raw=raw)] * len(hints)

    results_list = raw.get("results") or raw.get("hints")
    if results_list is None:
        results_list = raw if isinstance(raw, list) else [raw]

    out: list[EvalResult] = []
    for i, h in enumerate(hints):
        if i < len(results_list):
            out.append(extract_single_result(results_list[i], h.hint))
        else:
            out.append(EvalResult(score=None, reason="missing", assassin_risk="none", opponent_risk="none", neutral_risk="none", raw=None))
    return out


def build_comparisons(
    hints: list[HintEntry],
    orig_results: list[EvalResult],
    v1_results: list[EvalResult],
) -> list[HintComparison]:
    comparisons = []
    for h, orig, v1 in zip(hints, orig_results, v1_results):
        delta = None
        if orig.score is not None and v1.score is not None:
            delta = round(v1.score - orig.score, 4)
        comparisons.append(HintComparison(hint=h.hint, count=h.count, intended=h.intended, original=orig, v1=v1, delta=delta))
    return comparisons


def evaluate_team(
    client: openai.OpenAI,
    model: str,
    original_prompt: str,
    v1_prompt: str,
    hints: list[HintEntry],
    active_team: str,
    my_words: list[str],
    opp_words: list[str],
    neutral_words: list[str],
    assassin: str,
) -> TeamResult:
    orig_payload = build_original_payload(hints, active_team, my_words, opp_words, neutral_words, assassin)
    v1_payload = build_v1_payload(hints, active_team, my_words, opp_words, neutral_words, assassin)

    orig_raw = safe_call_openai(client, model, original_prompt, orig_payload, f"original-eval/{active_team}")
    v1_raw = safe_call_openai(client, model, v1_prompt, v1_payload, f"v1-eval/{active_team}")

    orig_results = parse_multi_response(orig_raw, hints)
    v1_results = parse_multi_response(v1_raw, hints)
    comparisons = build_comparisons(hints, orig_results, v1_results)

    return TeamResult(
        hints=hints,
        original_eval_response=orig_raw,
        v1_eval_response=v1_raw,
        per_hint_comparison=comparisons,
    )


def print_board_header(board_num: int, red_words: list[str], blue_words: list[str]) -> None:
    print(f"\n{'═' * 2} Board #{board_num} {'═' * 44}")
    print(f"RED team ({len(red_words)} words): {' '.join(red_words)}")
    print(f"BLUE team ({len(blue_words)} words): {' '.join(blue_words)}")


def _risk_display(assassin: str, opponent: str, neutral: str) -> str:
    return f"assassin={assassin}  opp={opponent}  neutral={neutral}"


def print_hint_comparison(c: HintComparison) -> None:
    print(f"\n  Hint: {c.hint}  count={c.count}  intended=[{', '.join(c.intended)}]")

    orig_score_str = f"{c.original.score:.2f}" if c.original.score is not None else "n/a"
    v1_score_str = f"{c.v1.score:.2f}" if c.v1.score is not None else "n/a"

    print(f"  ┌─ original-eval ──── score={orig_score_str}")
    print(f"  │  \"{c.original.reason[:120]}\"")
    print(f"  │  risk: {_risk_display(c.original.assassin_risk, c.original.opponent_risk, c.original.neutral_risk)}")
    print(f"  └─ v1-eval ────────── score={v1_score_str}")
    print(f"     \"{c.v1.reason[:120]}\"")
    print(f"     risk: {_risk_display(c.v1.assassin_risk, c.v1.opponent_risk, c.v1.neutral_risk)}")

    if c.delta is not None:
        direction = "v1 scored higher" if c.delta > 0 else ("v1 scored lower" if c.delta < 0 else "tied")
        print(f"  Δ score: {c.delta:+.4f}  ({direction})")


def print_team_section(label: str, team_result: TeamResult) -> None:
    print(f"\n--- {label} ---")
    for c in team_result.per_hint_comparison:
        print_hint_comparison(c)


def board_result_to_dict(r: BoardResult) -> dict:
    def hint_entry_to_dict(h: HintEntry) -> dict:
        return {"hint": h.hint, "count": h.count, "intended": h.intended, "score": h.score}

    def eval_result_to_dict(e: EvalResult) -> dict:
        return {
            "score": e.score,
            "reason": e.reason,
            "assassin_risk": e.assassin_risk,
            "opponent_risk": e.opponent_risk,
            "neutral_risk": e.neutral_risk,
        }

    def comparison_to_dict(c: HintComparison) -> dict:
        return {
            "hint": c.hint,
            "count": c.count,
            "intended": c.intended,
            "original_score": c.original.score,
            "v1_score": c.v1.score,
            "delta": c.delta,
        }

    def team_to_dict(t: TeamResult) -> dict:
        return {
            "hints": [hint_entry_to_dict(h) for h in t.hints],
            "original_eval_response": t.original_eval_response,
            "v1_eval_response": t.v1_eval_response,
            "per_hint_comparison": [comparison_to_dict(c) for c in t.per_hint_comparison],
        }

    return {
        "board_number": r.board_number,
        "seed": r.seed,
        "red_words": r.red_words,
        "blue_words": r.blue_words,
        "neutral_words": r.neutral_words,
        "assassin": r.assassin,
        "teams": {
            "red": team_to_dict(r.red_team),
            "blue": team_to_dict(r.blue_team),
        },
    }


def run(
    boards: int,
    hints: int,
    seed: int,
    risk: str,
    model: str,
    out: str,
    original_prompt: str,
    v1_prompt: str,
    min_count: int = 1,
) -> None:
    api_key = os.environ["OPENAI_API_KEY"]
    client = openai.OpenAI(api_key=api_key)

    rng = random.Random(seed)
    all_results: list[BoardResult] = []

    for board_num in range(1, boards + 1):
        board = probe.sample_board(rng)
        flipped = flip_board(board)

        red_words = board.my
        blue_words = flipped.my
        neutral_words = [w for w in board.words if board.role[w] == "neutral"]
        assassin_word = board.assassin

        red_hints = top_hints(board, risk, hints, min_count=min_count)
        blue_hints = top_hints(flipped, risk, hints, min_count=min_count)

        print_board_header(board_num, red_words, blue_words)

        red_result = evaluate_team(
            client, model, original_prompt, v1_prompt,
            red_hints, "red",
            red_words, blue_words, neutral_words, assassin_word,
        )
        blue_result = evaluate_team(
            client, model, original_prompt, v1_prompt,
            blue_hints, "blue",
            blue_words, red_words, neutral_words, assassin_word,
        )

        print_team_section("RED team hints", red_result)
        print_team_section("BLUE team hints", blue_result)

        all_results.append(BoardResult(
            board_number=board_num,
            seed=seed + board_num - 1,
            red_words=red_words,
            blue_words=blue_words,
            neutral_words=neutral_words,
            assassin=assassin_word,
            red_team=red_result,
            blue_team=blue_result,
        ))

    out_path = Path(out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"boards": [board_result_to_dict(r) for r in all_results]}
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nResults saved to {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare two eval prompts on sampled Codenames boards.")
    parser.add_argument("--boards", type=int, default=1)
    parser.add_argument("--hints", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--risk", default="balanced")
    parser.add_argument("--model", default="gpt-4o")
    parser.add_argument("--out", default="data/eval_compare_results.json")
    parser.add_argument("--min-count", type=int, default=1)
    args = parser.parse_args()

    docs = Path(__file__).parent.parent / "docs"
    original_prompt = load_prompt(docs / "original-eval.md")
    v1_prompt = load_prompt(docs / "v1-eval-prompt.md")

    run(
        boards=args.boards,
        hints=args.hints,
        seed=args.seed,
        risk=args.risk,
        model=args.model,
        out=args.out,
        original_prompt=original_prompt,
        v1_prompt=v1_prompt,
        min_count=args.min_count,
    )


if __name__ == "__main__":
    main()
