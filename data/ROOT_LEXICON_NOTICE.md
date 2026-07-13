# Hebrew root lexicon — `word2root.json`

`word2root.json` maps Hebrew surface words to their triliteral root(s) (שורש). It powers
the shared-root half of the Codenames clue-legality check (see `morph.roots` / `probe`).

- **Entries:** ~97,000 surface words → root set(s).
- **Coverage:** ~71% of the deck and ~63% of the clue vocabulary. Out-of-lexicon words fall
  back to the coarse `morph.root_sig` heuristic, and the fastText transparency gate guards
  both sources, so uncovered words degrade safely rather than misfiring.

## Source & license

Derived from the **Hebrew Wiktionary** extract published by **[kaikki.org](https://kaikki.org/dictionary/Hebrew/)**
(machine-readable Wiktionary via [wiktextract](https://github.com/tatuylonen/wiktextract)).

Wiktionary content is dual-licensed **CC BY-SA 3.0** and **GFDL 1.3**. This derived dataset is
redistributed under the same terms (share-alike). Attribution: *Wiktionary contributors,
via kaikki.org.*

## Regenerating

Run `build_root_lexicon.py` (see its header for the one-line download of the source JSONL).
The source `kaikki_hebrew.jsonl` (~53 MB) is intentionally **not** vendored — only the
distilled `word2root.json` is.
