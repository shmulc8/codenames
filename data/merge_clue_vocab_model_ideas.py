#!/usr/bin/env python3
"""Merge previously generated OpenAI association words into the curated clue pool.

Association-derived additions are explicitly marked for review; this script does
not invent ambiguity or translation scores for them.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CURATED = ROOT / "data" / "clue_vocab_openai.json"
ASSOC = ROOT / "data" / "assoc_he_openai.jsonl"
SOURCE = ROOT / "data" / "content_master_v2_30000.json"
BLOCKLIST = ROOT / "data" / "blocklist_he.txt"
DECK = ROOT / "data" / "yaeldau_hebrew.json"


def main() -> int:
    document = (
        json.loads(CURATED.read_text(encoding="utf-8")) if CURATED.exists() else {"entries": {}}
    )
    entries = document.setdefault("entries", {})
    for meta in entries.values():
        meta.setdefault("origin", "openai_curated")
        meta.setdefault("review_required", False)
    source = {
        r[0]: {"count": r[1], "pos": r[2]}
        for r in json.loads(SOURCE.read_text(encoding="utf-8"))
        if isinstance(r, list) and len(r) == 3
    }
    blocked = {
        l.strip()
        for l in BLOCKLIST.read_text(encoding="utf-8").splitlines()
        if l.strip() and not l.lstrip().startswith("#")
    }
    deck = set(json.loads(DECK.read_text(encoding="utf-8")))
    added = 0
    for line in ASSOC.read_text(encoding="utf-8").splitlines():
        row = json.loads(line)
        for word_key in ("word1", "word2"):
            word = str(row.get(word_key, "")).strip()
            if (
                word in entries
                or word in blocked
                or word in deck
                or not re.fullmatch(r"[א-ת]{2,}", word)
            ):
                continue
            meta = source.get(word)
            entries[word] = {
                "count": meta["count"] if meta else 0,
                "pos": meta["pos"] if meta else "NOUN",
                "category": row.get("category", "association"),
                "familiarity": None,
                "ambiguity": None,
                "translation_risk": None,
                "flags": [],
                "origin": "association_model_idea",
                "in_corpus": meta is not None,
                "review_required": True,
                "source": "openai_generated_association",
                "model": row.get("model", "unknown"),
            }
            added += 1
    document["generated_at"] = document.get("generated_at")
    document["entry_count"] = len(entries)
    CURATED.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"added {added} association model ideas; total curated entries: {len(entries)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
