#!/usr/bin/env python3
"""Generate a labeled supplemental Hebrew association dataset with OpenAI.

This deliberately does not overwrite ``assoc_he.tsv``.  The existing file is a
translated WordSim-353 relatedness set; this output is model-generated and must
remain a separate, synthetic evaluation/training candidate pool until reviewed.

Examples:
    python data/extend_assoc_openai.py --batches 1 --pairs 20
    python data/extend_assoc_openai.py --batches 20 --pairs 40

The API key is read from OPENAI_API_KEY or a local .env file.  It is never
printed, serialized, or included in generated records.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "assoc_he.tsv"
DEFAULT_OUTPUT = ROOT / "data" / "assoc_he_openai.jsonl"
API_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = os.environ.get("OPENAI_ASSOC_MODEL", "gpt-4o-mini")

CATEGORIES = (
    "technology",
    "science",
    "nature",
    "places",
    "food",
    "body",
    "emotion",
    "society",
    "work",
    "culture",
    "history",
    "sports",
    "home",
    "travel",
    "abstract ideas",
    "everyday actions",
)


def load_dotenv(path: Path) -> None:
    """Load only simple KEY=VALUE lines; never echo values."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def existing_pairs() -> set[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    with SOURCE.open(encoding="utf-8") as fh:
        next(fh, None)
        for line in fh:
            cols = line.rstrip("\n").split("\t")
            if len(cols) >= 2:
                a, b = cols[:2]
                pairs.add(tuple(sorted((a.strip(), b.strip()))))
    return pairs


def request_json(api_key: str, model: str, category: str, n: int, batch: int) -> list[dict]:
    prompt = f"""Generate {n} candidate Hebrew word-association pairs for a research dataset.

Category for this batch: {category}.
Return ONLY a JSON object with this exact shape:
{{"pairs":[{{"word1":"...","word2":"...","score":8.2,"relation":"..."}}]}}

Rules:
- Both words must be natural modern Hebrew, written in Hebrew script where possible.
- A word may be a short natural phrase (at most 4 whitespace-separated tokens), but prefer one word.
- The pair should represent human-style association or relatedness, not merely a shared root.
- Include a mix of strong, medium, and weak-but-plausible associations; score is 0.0 to 10.0.
- relation must be one of: thematic, functional, causal, cultural, situational, taxonomic, contrastive.
- Do not include explanations, duplicates, English transliterations, or board-game instructions.
- Do not repeat these category words as a fixed template; vary vocabulary broadly.

This is batch {batch}; maximize lexical diversity and avoid obvious pairs from common beginner lists."""
    body = {
        "model": model,
        "temperature": 0.8,
        "messages": [
            {
                "role": "system",
                "content": "You produce conservative machine-readable Hebrew lexical data.",
            },
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as response:
        payload = json.load(response)
    content = payload["choices"][0]["message"]["content"]
    parsed = json.loads(content)
    pairs = parsed.get("pairs")
    if not isinstance(pairs, list):
        raise ValueError("response did not contain a pairs list")
    return pairs


def clean_pairs(
    rows: list[dict], seen: set[tuple[str, str]], category: str, model: str, batch: int
) -> list[dict]:
    output = []
    now = datetime.now(UTC).isoformat()
    allowed_relations = {
        "thematic",
        "functional",
        "causal",
        "cultural",
        "situational",
        "taxonomic",
        "contrastive",
    }
    for row in rows:
        if not isinstance(row, dict):
            continue
        a = str(row.get("word1", "")).strip()
        b = str(row.get("word2", "")).strip()
        if not a or not b or a == b or "\t" in a or "\t" in b or "\n" in a or "\n" in b:
            continue
        if len(a.split()) > 4 or len(b.split()) > 4:
            continue
        key = tuple(sorted((a, b)))
        if key in seen:
            continue
        try:
            score = round(float(row.get("score")), 2)
        except (TypeError, ValueError):
            continue
        if not 0.0 <= score <= 10.0:
            continue
        relation = str(row.get("relation", "")).strip().lower()
        if relation not in allowed_relations:
            continue
        seen.add(key)
        output.append(
            {
                "word1": a,
                "word2": b,
                "score": score,
                "relation": relation,
                "source": "openai_generated",
                "category": category,
                "model": model,
                "batch": batch,
                "generated_at": now,
            }
        )
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batches", type=int, default=20)
    parser.add_argument("--pairs", type=int, default=40, help="requested pairs per API call")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--seed", type=int, default=20260721)
    parser.add_argument("--max-retries", type=int, default=4)
    args = parser.parse_args()
    if args.batches < 1 or args.pairs < 1:
        parser.error("--batches and --pairs must be positive")

    load_dotenv(ROOT / ".env")
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY is not configured", file=sys.stderr)
        return 2

    seen = existing_pairs()
    if args.output.exists():
        for line in args.output.read_text(encoding="utf-8").splitlines():
            try:
                row = json.loads(line)
                seen.add(tuple(sorted((row["word1"], row["word2"]))))
            except (ValueError, KeyError, json.JSONDecodeError):
                continue

    rng = random.Random(args.seed)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    total = 0
    with args.output.open("a", encoding="utf-8") as out:
        for batch in range(1, args.batches + 1):
            category = CATEGORIES[(batch - 1) % len(CATEGORIES)]
            # Rotate categories after the first cycle so repeated runs remain broad.
            if batch > len(CATEGORIES):
                category = rng.choice(CATEGORIES)
            for attempt in range(args.max_retries + 1):
                try:
                    rows = request_json(api_key, args.model, category, args.pairs, batch)
                    accepted = clean_pairs(rows, seen, category, args.model, batch)
                    for row in accepted:
                        out.write(json.dumps(row, ensure_ascii=False) + "\n")
                    out.flush()
                    total += len(accepted)
                    print(
                        f"batch {batch}/{args.batches}: accepted {len(accepted)} ({total} total)",
                        flush=True,
                    )
                    break
                except (
                    urllib.error.HTTPError,
                    urllib.error.URLError,
                    TimeoutError,
                    ValueError,
                    KeyError,
                    json.JSONDecodeError,
                ) as exc:
                    if attempt >= args.max_retries:
                        print(
                            f"batch {batch} failed after retries: {type(exc).__name__}",
                            file=sys.stderr,
                        )
                        return 1
                    delay = min(60, 2**attempt)
                    print(f"batch {batch} retry {attempt + 1}/{args.max_retries}", file=sys.stderr)
                    time.sleep(delay)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
