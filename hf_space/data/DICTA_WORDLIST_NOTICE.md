# Dicta wordlist roots in `word2root.json`

Part of the root lexicon `word2root.json` comes from the `root` column of the
**Dicta Unvocalized Hebrew Wordlist**, [dicta-il/wordlist](https://huggingface.co/datasets/dicta-il/wordlist)
v1.1.4 (`wordlist-v1.1.4.parquet`), by [Dicta: The Israel Center for Text Analysis](https://dicta.org.il/).

- **Use:** for each word the engine looks up (the board deck, every clue vocabulary, and their
  lemmas) its wordlist roots are added to the Wiktionary roots; existing entries are kept.
  Roots are stored with non-final letter forms. See `merge_root_sources.py`.
- **License:** **CC BY-NC 4.0** (Attribution–NonCommercial 4.0 International). The derived
  root entries are redistributed under the same terms, for non-commercial use only.
  Attribution: *Dicta – The Israel Center for Text Analysis, dicta-il/wordlist v1.1.4.*

The same merge adds LLM-assigned roots for ~2k engine words neither lexicon covers (98% top-1
agreement with a 300-word hand-checked calibration set); words the model marked unsure were
left out.
