# Hebrew clue ambiguity metadata

`build_ambiguity_openai.py` can generate optional, provenance-labeled metadata
for words with multiple common meanings. The serving app never calls OpenAI at
runtime. It always has a small built-in fallback for `עלה` and `פרח`, and merges
the generated file when `data/ambiguity_he_openai.json` exists.

Ambiguity is a warning signal, not a legality decision: the clue can still be
legal, but cautious and balanced profiles deprioritize it.
