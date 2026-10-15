"""Merge extra root sources into word2root.json (data/ and hf_space/data/).

    PYTHONPATH=src FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin \
      python data/merge_root_sources.py WORDLIST_ROOTS.json HAIKU_A.json [HAIKU_B.json ...]

Result per word = Wiktionary roots (the existing file) ∪ Dicta wordlist roots ∪ model-assigned
roots. Additions are limited to the words the engine looks up on its hot path — the deck and
every clue vocabulary, plus their DictaBERT lemmas — so the file stays small; every existing
entry is kept.

Sources:
- WORDLIST_ROOTS.json: {surface word: [roots]} distilled from the `root` column of
  dicta-il/wordlist v1.1.4 (CC BY-NC 4.0, see DICTA_WORDLIST_NOTICE.md).
- HAIKU_*.json: {"roots": {word: [roots]}, "unsure": [...]} — roots assigned by an LLM for words
  neither lexicon covers (98% top-1 agreement on a 300-word gold calibration). Words it marked
  unsure are skipped.
Roots are stored with non-final letter forms, like the existing entries.
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))

from codenames import morph, probe  # noqa: E402
from codenames.deck_he import DECK  # noqa: E402

FINALS = str.maketrans("ךםןףץ", "כמנפצ")


def engine_words() -> list[str]:
    words: list[str] = list(DECK)
    for data_dir in (os.path.join(ROOT, "data"), os.path.join(ROOT, "hf_space", "data")):
        with open(os.path.join(data_dir, "clue_vocab_openai.json"), encoding="utf-8") as f:
            words += list(json.load(f)["entries"])
        probe.DATA = data_dir  # clue_vocab_band reads the master list + blocklist from probe.DATA
        probe._BLOCKLIST = None
        for mode in ("conservative", "broad", "experimental"):
            words += probe.clue_vocab_band(20000, mode=mode)[0]
    words = list(dict.fromkeys(words))
    lems = morph.lemmas(words)
    return list(dict.fromkeys(words + lems))


def main(argv: list[str]) -> int:
    wordlist_path, haiku_paths = argv[0], argv[1:]
    with open(wordlist_path, encoding="utf-8") as f:
        dicta = json.load(f)
    model: dict[str, list[str]] = {}
    for p in haiku_paths:
        with open(p, encoding="utf-8") as f:
            doc = json.load(f)
        unsure = set(doc.get("unsure", []))
        for w, rs in doc["roots"].items():
            if w not in unsure and rs:
                model[w] = rs

    words = engine_words()
    print(f"engine words: {len(words)}")
    for out in (
        os.path.join(ROOT, "data", "word2root.json"),
        os.path.join(ROOT, "hf_space", "data", "word2root.json"),
    ):
        with open(out, encoding="utf-8") as f:
            lex = json.load(f)
        before, added_words, widened = len(lex), 0, 0
        for w in words:
            extra = {r.translate(FINALS) for r in dicta.get(w, []) + model.get(w, []) if r}
            if not extra:
                continue
            cur = set(lex.get(w, []))
            merged = cur | extra
            if merged != cur:
                added_words += not cur
                widened += bool(cur)
                lex[w] = sorted(merged)
        with open(out, "w", encoding="utf-8") as f:
            json.dump(lex, f, ensure_ascii=False)
        print(f"{out}: {before} → {len(lex)} entries (+{added_words} new, {widened} widened)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
