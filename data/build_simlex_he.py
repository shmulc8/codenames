#!/usr/bin/env python3
"""Fetch and normalize the Hebrew SimLex-999 similarity benchmark.

Source (downloaded verbatim):
https://raw.githubusercontent.com/nmrksic/attract-repel/master/evaluation/simlex-hebrew.txt

The source is the Hebrew SimLex-999 dataset distributed with the Attract-Repel
project (Mrksic et al., 2017).  It is a tab-separated, three-column file with
the header ``word 1, word 2, score``.  This script validates that layout and
writes the repository's compact ``word1, word2, score`` TSV schema.

Run from the repository root (or any directory):

    python data/build_simlex_he.py
"""

from __future__ import annotations

import csv
import io
import urllib.request
from pathlib import Path

SOURCE_URL = (
    "https://raw.githubusercontent.com/nmrksic/attract-repel/master/evaluation/simlex-hebrew.txt"
)
OUTPUT_PATH = Path(__file__).with_name("simlex_he.tsv")


def fetch_rows() -> list[tuple[str, str, float]]:
    """Download the trusted, fixed benchmark URL and validate its TSV rows."""
    request = urllib.request.Request(
        SOURCE_URL, headers={"User-Agent": "codenames-simlex-fetch/1.0"}
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        text = response.read().decode("utf-8")

    reader = csv.reader(io.StringIO(text), delimiter="\t")
    header = next(reader, None)
    if header != ["word 1", "word 2", "score"]:
        raise ValueError(f"Unexpected source header: {header!r}")

    rows: list[tuple[str, str, float]] = []
    for line_number, row in enumerate(reader, start=2):
        if len(row) != 3 or not row[0].strip() or not row[1].strip():
            raise ValueError(f"Malformed row {line_number}: {row!r}")
        try:
            score = float(row[2])
        except ValueError as exc:
            raise ValueError(f"Invalid score on row {line_number}: {row[2]!r}") from exc
        rows.append((row[0], row[1], score))
    if len(rows) != 999:
        raise ValueError(f"Expected 999 Hebrew SimLex rows, got {len(rows)}")
    return rows


def main() -> None:
    rows = fetch_rows()
    with OUTPUT_PATH.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(("word1", "word2", "score"))
        writer.writerows((word1, word2, f"{score:g}") for word1, word2, score in rows)
    print(f"wrote {OUTPUT_PATH} with {len(rows)} pairs from {SOURCE_URL}")


if __name__ == "__main__":
    main()
