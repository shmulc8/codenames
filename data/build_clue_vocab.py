#!/usr/bin/env python3
"""Materialize the broad reusable Hebrew clue pool.

This is the board-independent candidate pool. Board-specific legality (board-word,
lemma, root, and transparency checks) is still applied by probe.py at runtime.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "content_master_v2_30000.json"
BLOCKLIST = ROOT / "data" / "blocklist_he.txt"
OUTPUT = ROOT / "data" / "clue_vocab_broad.json"


def main() -> int:
    rows = json.loads(SOURCE.read_text(encoding="utf-8"))
    blocked = {
        line.strip()
        for line in BLOCKLIST.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    words = []
    for row in rows:
        if len(row) != 3:
            continue
        word, count, pos = row
        if (
            100 <= count <= 150000
            and len(word) >= 3
            and pos in {"NOUN", "ADJ", "PROPN"}
            and word not in blocked
        ):
            words.append([word, count, pos])
    document = {
        "source": "content_master_v2_30000.json",
        "filters": {
            "min_count": 100,
            "max_count": 150000,
            "pos": ["NOUN", "ADJ", "PROPN"],
            "min_len": 3,
            "blocklist": "blocklist_he.txt",
        },
        "board_specific_legality": "applied at runtime by probe.py",
        "words": words,
    }
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(words)} reusable clue candidates to {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
