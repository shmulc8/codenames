#!/usr/bin/env python3
"""Curate a Hebrew Codenames clue vocabulary from a candidate pool using OpenAI.

Each candidate is a real Hebrew word. OpenAI judges whether it is a good, familiar,
playable clue word and assigns lightweight metadata; it never invents words. The
blocklist, deck, and Hebrew-script checks remain authoritative locally, so every
kept word is a real, single, non-deck Hebrew token regardless of model output.

Requests run concurrently and progress is saved incrementally, so the run is
resumable: re-running skips words already decided.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BLOCKLIST = ROOT / "data" / "blocklist_he.txt"
DECK = ROOT / "data" / "yaeldau_hebrew.json"
URL = "https://api.openai.com/v1/chat/completions"
ALLOWED_FLAGS = {"ambiguous", "translation_sensitive", "proper_name", "loanword"}
ALLOWED_POS = {"NOUN", "ADJ", "PROPN"}
CATEGORIES = (
    "nature_animals",
    "food_cooking",
    "places_geography",
    "science_tech",
    "history_culture",
    "sports_games",
    "home_objects",
    "professions_society",
    "emotions_ideas",
    "arts_media",
    "body_health",
    "travel_transport",
    "general",
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


def build_prompt(batch: list[dict]) -> str:
    items = [
        {"i": idx, "w": r["word"], "c": r["count"], "p": r.get("pos") or "?"}
        for idx, r in enumerate(batch)
    ]
    return (
        "You are an expert in modern Hebrew and the party game Codenames. From the numbered words below, "
        "return ONLY the ones that are GOOD spymaster CLUE words and OMIT the rest.\n"
        "A good clue word is a single, familiar modern-Hebrew word in BASE (lemma) form that most "
        "adult native speakers know and can link to several ideas. This INCLUDES concrete nouns, common "
        "descriptive adjectives (colors, sizes, qualities, materials), AND well-known proper nouns "
        "(countries, cities, places, famous people or brands) — keep good adjectives and proper nouns too, "
        "not only nouns. OMIT: inflected/prefixed/construct "
        "forms (e.g. words carrying ־ב/ה/ו/כ/ל/מ/ש prefixes, or a plural/possessive whose lemma is the real "
        "word), verbs, function words, pronouns, abbreviations, acronyms, fragments, numerals, "
        "rare/archaic/hyper-technical words, obscure transliterations, and vulgar/offensive words. "
        "Be strict about non-words: reject letter fragments, truncated/partial words, and acronyms — "
        "every kept word must be a complete, independently meaningful Hebrew lemma. Double-check the "
        "part of speech: if a word is actually a verb (past/present/future or imperative), OMIT it even "
        "if it superficially looks like a noun. "
        "When unsure a word is widely known, OMIT it.\n"
        'Each input item is {"i":index,"w":word,"c":corpus_frequency,"p":pos} (p "?" means infer it; higher c hints more familiar).\n'
        "Refer to each kept word ONLY by its integer index i — never retype the Hebrew.\n"
        'Return compact JSON ONLY: {"k":[{"i":0,"p":"NOUN","c":"general","a":0.1,"fl":[]}]}\n'
        "i = the index of a word you KEEP (required). p = part of speech NOUN/ADJ/PROPN. c = category, one of "
        + json.dumps(list(CATEGORIES))
        + ". a = ambiguity 0.0-1.0. fl = flags, subset of "
        + json.dumps(sorted(ALLOWED_FLAGS))
        + ' (include "ambiguous" if a>=0.5, "translation_sensitive" if the common meaning is context-dependent, '
        '"proper_name" for PROPN, "loanword" for borrowings). p is REQUIRED for every kept word; c, a, fl may be omitted when unremarkable.\n'
        "Words: " + json.dumps(items, ensure_ascii=False)
    )


def classify(api_key: str, model: str, batch: list[dict], retries: int) -> list[dict] | None:
    body = {
        "model": model,
        "max_completion_tokens": min(6000, 400 + len(batch) * 90),
        "messages": [
            {"role": "system", "content": "Return only compact machine-readable JSON — no prose."},
            {"role": "user", "content": build_prompt(batch)},
        ],
        "response_format": {"type": "json_object"},
    }
    config = "\n".join(
        [
            "url = " + json.dumps(URL),
            "silent",
            "show-error",
            "max-time = 120",
            "header = " + json.dumps(f"Authorization: Bearer {api_key}"),
            "header = " + json.dumps("Content-Type: application/json"),
            "data-binary = " + json.dumps(json.dumps(body, ensure_ascii=False)),
            "",
        ]
    )
    for attempt in range(retries + 1):
        try:
            result = subprocess.run(
                ["curl", "--config", "-"], input=config, capture_output=True, text=True, timeout=140
            )
            if result.returncode != 0:
                raise RuntimeError(f"curl exit {result.returncode}: {result.stderr[:150]}")
            payload = json.loads(result.stdout)
            if "error" in payload:
                raise RuntimeError(payload["error"].get("message", "api_error"))
            content = payload["choices"][0]["message"]["content"]
            return json.loads(content).get("k", [])
        except (
            subprocess.SubprocessError,
            OSError,
            ValueError,
            KeyError,
            RuntimeError,
            json.JSONDecodeError,
        ):
            if attempt >= retries:
                return None
            time.sleep(2**attempt + 0.5 * attempt)
    return None


def clamp01(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, min(1.0, number))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, help="JSON list of [word, count, pos|null]")
    parser.add_argument("--output", required=True, help="curated JSON document to write/resume")
    parser.add_argument("--batch-size", type=int, default=30)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--model", default=os.environ.get("OPENAI_CLUE_MODEL", "gpt-4o-mini"))
    parser.add_argument("--retries", type=int, default=3)
    args = parser.parse_args()

    load_dotenv()
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY is not configured", flush=True)
        return 2

    rows = json.loads(Path(args.input).read_text(encoding="utf-8"))
    candidates = {}
    for row in rows:
        word, count = str(row[0]).strip(), row[1]
        pos = row[2] if len(row) > 2 else None
        if not re.fullmatch(r"[א-ת]{3,}", word):
            continue  # two-letter tokens are almost always fragments/abbreviations, not clue words
        candidates[word] = {"word": word, "count": count, "pos": pos}

    blocked = {
        l.strip()
        for l in BLOCKLIST.read_text(encoding="utf-8").splitlines()
        if l.strip() and not l.lstrip().startswith("#")
    }
    deck = set(json.loads(DECK.read_text(encoding="utf-8")))
    candidates = {w: r for w, r in candidates.items() if w not in blocked and w not in deck}

    output_path = Path(args.output)
    entries: dict[str, dict] = {}
    decided: set[str] = set()
    if output_path.exists():
        try:
            prior = json.loads(output_path.read_text(encoding="utf-8"))
            entries = prior.get("entries", {})
            decided = set(prior.get("decided", [])) | set(entries)
        except (OSError, ValueError, json.JSONDecodeError):
            pass

    pending = [r for w, r in candidates.items() if w not in decided]
    batches = [pending[i : i + args.batch_size] for i in range(0, len(pending), args.batch_size)]
    print(
        f"candidates={len(candidates)} already_decided={len(decided)} "
        f"pending={len(pending)} batches={len(batches)} model={args.model}",
        flush=True,
    )
    if not batches:
        print("nothing to do", flush=True)
        return 0

    lock = threading.Lock()
    stats = {"done": 0, "failed": 0}

    def save() -> None:
        document = {
            "source": "openai_curated",
            "model": args.model,
            "generated_at": datetime.now(UTC).isoformat(),
            "entry_count": len(entries),
            "decided": sorted(decided),
            "entries": entries,
        }
        tmp = output_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp.replace(output_path)

    def handle(batch: list[dict]):
        rows = classify(api_key, args.model, batch, args.retries)
        with lock:
            stats["done"] += 1
            for r in batch:
                decided.add(r["word"])
            if rows is None:
                stats["failed"] += 1
                # leave these words un-decided so a rerun retries them
                for r in batch:
                    decided.discard(r["word"])
            else:
                for obj in rows:
                    if not isinstance(obj, dict):
                        continue
                    idx = obj.get("i")
                    if isinstance(idx, bool):
                        continue
                    if isinstance(idx, float) and idx.is_integer():
                        idx = int(idx)
                    if not isinstance(idx, int) or not (0 <= idx < len(batch)):
                        continue
                    src = batch[idx]
                    word = src["word"]
                    if word in entries:
                        continue
                    pos = src["pos"] or str(obj.get("p", "")).strip().upper()
                    if pos not in ALLOWED_POS:
                        continue
                    amb = clamp01(obj.get("a"))
                    amb = 0.1 if amb is None else amb
                    fam = clamp01(obj.get("f"))
                    fam = 0.75 if fam is None else fam
                    trisk = clamp01(obj.get("t"))
                    trisk = 0.05 if trisk is None else trisk
                    flags = {f for f in (obj.get("fl") or []) if f in ALLOWED_FLAGS}
                    if pos == "PROPN":
                        flags.add("proper_name")
                    flags = sorted(flags)
                    category = obj.get("c") if obj.get("c") in CATEGORIES else "general"
                    entries[word] = {
                        "count": src["count"],
                        "pos": pos,
                        "category": category,
                        "familiarity": round(fam, 3),
                        "ambiguity": round(amb, 3),
                        "translation_risk": round(trisk, 3),
                        "flags": flags,
                        "origin": "openai_curated",
                        "in_corpus": src["pos"] is not None,
                        "source": "openai_curated",
                        "model": args.model,
                    }
            if stats["done"] % 10 == 0 or stats["done"] == len(batches):
                save()
                print(
                    f"progress {stats['done']}/{len(batches)} batches "
                    f"kept={len(entries)} failed_batches={stats['failed']}",
                    flush=True,
                )

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(handle, b) for b in batches]
        for fut in as_completed(futures):
            fut.result()

    save()
    print(
        f"DONE: kept {len(entries)} clue words -> {output_path} (failed_batches={stats['failed']})",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
