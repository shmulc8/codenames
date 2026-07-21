#!/usr/bin/env python3
"""Build a curated Hebrew clue vocabulary with OpenAI, then validate locally.

OpenAI proposes words and metadata; the repository's corpus, blocklist, deck,
and runtime board-specific legality checks remain authoritative.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import random
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "content_master_v2_30000.json"
BLOCKLIST = ROOT / "data" / "blocklist_he.txt"
DECK = ROOT / "data" / "yaeldau_hebrew.json"
OUTPUT = ROOT / "data" / "clue_vocab_openai.json"
URL = "https://api.openai.com/v1/chat/completions"
CATEGORIES = (
    "nature and animals", "food and cooking", "places and geography",
    "science and technology", "history and culture", "sports and games",
    "home and objects", "professions and society", "emotions and ideas",
    "music film and literature", "body and health", "travel and transport",
)


def load_dotenv() -> None:
    path = ROOT / ".env"
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def request_batch(api_key: str, model: str, category: str, n: int,
                  existing: list[str], shortlist: list[str]) -> list[dict]:
    prompt = f"""Build a high-quality Hebrew Codenames clue vocabulary.
Select {n} candidate words for the category: {category} from this locally
validated shortlist, and you may add up to 8 genuinely strong model ideas that
are not on the shortlist. Mark each row with origin="shortlist" or
origin="model_idea".
Shortlist: {shortlist}
Return ONLY JSON with this shape:
{{"entries":[{{"word":"יער","pos":"NOUN","category":"nature","origin":"shortlist","familiarity":0.92,
"ambiguity":0.15,"translation_risk":0.05,"flags":[]}}]}}

Rules:
- Use one natural modern Hebrew word; do not return inflected phrases or transliteration.
- Use only NOUN, ADJ, or PROPN. Do not return verbs, function words, slang, profanity, or obscure inflections.
- Prefer familiar, playable clue words with broad cultural coverage.
- ambiguity is 0.0-1.0 and flags must include "ambiguous" when the word has multiple common unrelated senses.
- translation_risk is 0.0-1.0 and flags must include "translation_sensitive" when the Hebrew word is a misleading
  one-to-many translation or its common meaning depends strongly on context.
- flags may contain only: ambiguous, translation_sensitive, proper_name, loanword.
- familiarity is 0.0-1.0. Do not include any already proposed word.
Already proposed words: {existing[-120:]}
"""
    body = {
        "model": model,
        "temperature": 0.7,
        "messages": [
            {"role": "system", "content": "Return conservative machine-readable Hebrew lexical metadata."},
            {"role": "user", "content": prompt},
        ],
        "response_format": {"type": "json_object"},
    }
    # Pass the secret through curl's stdin config, never as a process argument.
    config = "\n".join([
        "url = " + json.dumps(URL),
        "silent",
        "show-error",
        "max-time = 90",
        "header = " + json.dumps(f"Authorization: Bearer {api_key}"),
        "header = " + json.dumps("Content-Type: application/json"),
        "data-binary = " + json.dumps(json.dumps(body, ensure_ascii=False)),
        "",
    ])
    result = subprocess.run(["curl", "--config", "-"], input=config,
                            check=True, capture_output=True, text=True, timeout=120)
    payload = json.loads(result.stdout)
    if "error" in payload:
        raise RuntimeError(payload["error"].get("type", "api_error"))
    return json.loads(payload["choices"][0]["message"]["content"]).get("entries", [])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batches", type=int, default=12)
    parser.add_argument("--per-batch", type=int, default=20)
    parser.add_argument("--model", default=os.environ.get("OPENAI_CLUE_MODEL", "gpt-4o-mini"))
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()
    load_dotenv()
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY is not configured", file=sys.stderr)
        return 2

    source = {row[0]: {"count": row[1], "pos": row[2]} for row in json.loads(SOURCE.read_text(encoding="utf-8"))
              if isinstance(row, list) and len(row) == 3}
    blocked = {line.strip() for line in BLOCKLIST.read_text(encoding="utf-8").splitlines()
               if line.strip() and not line.lstrip().startswith("#")}
    deck = set(json.loads(DECK.read_text(encoding="utf-8")))
    entries: dict[str, dict] = {}
    if OUTPUT.exists():
        try:
            previous = json.loads(OUTPUT.read_text(encoding="utf-8"))
            entries.update(previous.get("entries", {}))
        except (OSError, ValueError, json.JSONDecodeError):
            pass
    allowed_flags = {"ambiguous", "translation_sensitive", "proper_name", "loanword"}
    eligible = [word for word, meta in source.items()
                if meta["count"] >= 300 and meta["pos"] in {"NOUN", "ADJ", "PROPN"}
                and word not in blocked and word not in deck and " " not in word]
    rng = random.Random(20260721)
    for batch in range(args.batches):
        category = CATEGORIES[batch % len(CATEGORIES)]
        pool = [word for word in eligible if word not in entries]
        if not pool:
            print(f"batch {batch + 1}/{args.batches}: eligible pool exhausted, stopping", flush=True)
            break
        shortlist = rng.sample(pool, min(120, len(pool)))
        for attempt in range(args.retries + 1):
            try:
                rows = request_batch(api_key, args.model, category, args.per_batch,
                                     list(entries), shortlist)
                accepted = 0
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    word = str(row.get("word", "")).strip()
                    meta = source.get(word)
                    flags = set(row.get("flags") or [])
                    origin = str(row.get("origin", "shortlist")).strip()
                    try:
                        familiarity = float(row.get("familiarity"))
                        ambiguity = float(row.get("ambiguity"))
                        translation_risk = float(row.get("translation_risk"))
                    except (TypeError, ValueError):
                        continue
                    if (not word or word in entries or word in blocked or word in deck
                            or not re.fullmatch(r"[א-ת]{2,}", word)
                            or origin not in {"shortlist", "model_idea"}
                            or (meta is None and origin != "model_idea")
                            or (meta is not None and meta["pos"] not in {"NOUN", "ADJ", "PROPN"})
                            or (meta is None and familiarity < 0.75)
                            or not all(0.0 <= x <= 1.0 for x in (familiarity, ambiguity, translation_risk))
                            or not flags.issubset(allowed_flags)):
                        continue
                    if meta is None:
                        meta = {"count": 0, "pos": str(row.get("pos", "NOUN"))}
                    if meta["pos"] not in {"NOUN", "ADJ", "PROPN"}:
                        continue
                    entries[word] = {
                        "count": meta["count"], "pos": meta["pos"], "category": category,
                        "familiarity": round(familiarity, 3), "ambiguity": round(ambiguity, 3),
                        "translation_risk": round(translation_risk, 3), "flags": sorted(flags),
                        "origin": origin, "in_corpus": word in source,
                        "source": "openai_curated", "model": args.model,
                    }
                    accepted += 1
                print(f"batch {batch + 1}/{args.batches}: accepted {accepted} (total {len(entries)})", flush=True)
                break
            except (urllib.error.HTTPError, urllib.error.URLError, http.client.RemoteDisconnected,
                    TimeoutError, OSError, KeyError, ValueError, json.JSONDecodeError) as exc:
                if attempt >= args.retries:
                    print(f"batch {batch + 1} failed: {type(exc).__name__}", file=sys.stderr)
                    return 1
                time.sleep(2 ** attempt)
        document = {"source": "openai_curated", "model": args.model,
                    "generated_at": datetime.now(timezone.utc).isoformat(), "entries": entries}
        OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    document = {"source": "openai_curated", "model": args.model,
                "generated_at": datetime.now(timezone.utc).isoformat(), "entries": entries}
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(entries)} validated clue candidates to {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
