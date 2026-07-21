#!/usr/bin/env python3
"""Build an offline Hebrew clue-ambiguity lexicon with the OpenAI API.

The generated file is static metadata. The serving app never calls the API.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "ambiguity_he_openai.json"
URL = "https://api.openai.com/v1/chat/completions"


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


def main() -> int:
    load_dotenv()
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY is not configured", file=sys.stderr)
        return 2

    entries = {}
    batches = 10
    words_per_batch = 20
    model = os.environ.get("OPENAI_AMBIGUITY_MODEL", "gpt-4o-mini")

    for b in range(1, batches + 1):
        print(f"Requesting batch {b}/{batches}...")
        prompt = f"""Create a Hebrew lexical ambiguity warning lexicon for a word-association game.
Return ONLY JSON: {{"entries":[{{"word":"עלה","ambiguity":0.95,"senses":["leaf","rose/ascended"]}}]}}

Generate {words_per_batch} common or culturally recognizable Hebrew clue words. Prioritize words
with two or more common, genuinely different meanings, including examples like
עלה, פרח, כותרת, קרן, ראש, שער, קנה, עין, כף, מטבע, מחנה. Include short English
glosses for the senses so the metadata is auditable. ambiguity is 0.0 to 1.0:
0.9+ means strongly polysemous and 0.7-0.89 means materially ambiguous.
Avoid morphological variants that merely duplicate another entry.

Exclude any words already generated: {list(entries.keys())}
This is batch {b}; maximize lexical diversity and focus on different ambiguous words."""
        body = {
            "model": model,
            "temperature": 0.5,
            "messages": [
                {"role": "system", "content": "Return conservative machine-readable lexical metadata."},
                {"role": "user", "content": prompt},
            ],
            "response_format": {"type": "json_object"},
        }

        request = urllib.request.Request(
            URL,
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            method="POST",
        )

        success = False
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=90) as response:
                    payload = json.load(response)
                content = payload["choices"][0]["message"]["content"]
                rows = json.loads(content).get("entries", [])

                accepted = 0
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    word = str(row.get("word", "")).strip()
                    senses = row.get("senses")
                    try:
                        score = round(float(row.get("ambiguity")), 3)
                    except (TypeError, ValueError):
                        continue
                    if (not word or "\n" in word or "\t" in word or not isinstance(senses, list)
                            or len(senses) < 2 or not 0.0 <= score <= 1.0):
                        continue
                    if word in entries:
                        continue
                    entries[word] = {"ambiguity": score, "senses": [str(s)[:80] for s in senses[:5]]}
                    accepted += 1

                print(f"Batch {b} complete: accepted {accepted} new entries (total: {len(entries)})")
                success = True
                break
            except Exception as exc:
                print(f"Attempt {attempt + 1} failed for batch {b}: {exc}", file=sys.stderr)
                time.sleep(2 ** attempt)

        if not success:
            print(f"Failed to generate batch {b} after retries", file=sys.stderr)
            return 1

    document = {
        "source": "openai_generated",
        "model": model,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "entries": entries,
    }
    OUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(entries)} ambiguity entries to {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
