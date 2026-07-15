# ConceptNet Numberbatch Hebrew vectors

`numberbatch_he_vocab.json` and `numberbatch_he.npy` are derived from the
Hebrew (`/c/he/`) portion of ConceptNet Numberbatch version 19.08.

Source and acquisition

- Canonical multilingual release: <https://conceptnet.s3.amazonaws.com/downloads/2019/numberbatch/numberbatch-19.08.txt.gz>
- This repository uses the efficient pre-extracted Hebrew subset:
  <https://zenodo.org/records/4911598/files/numberbatch-19.08-he.zip?download=1>
- Zenodo describes this subset as rows filtered from Numberbatch by language;
  it additionally excludes terms for which Python `str.isalpha()` is false.
  The builder downloads that 9.8 MB zip to a temporary directory, reads its
  word2vec-binary member, and deletes the temporary archive. It does not store
  or decompress the full multilingual dump.

The vocabulary JSON contains bare ConceptNet surface terms in source row order.
Multiword terms retain underscores, matching ConceptNet surface notation. The
NumPy array is float32 and L2-normalized; each row matches the same-index JSON
term.

License

ConceptNet Numberbatch is licensed under Creative Commons Attribution-
ShareAlike 4.0 International (CC BY-SA 4.0). The source's suggested notice is:

> This data contains semantic vectors from ConceptNet Numberbatch, by Luminoso
> Technologies, Inc. You may redistribute or modify the data under the terms of
> the CC-By-SA 4.0 license.

Citation

Robyn Speer, Joshua Chin, and Catherine Havasi. 2017. “ConceptNet 5.5: An Open
Multilingual Graph of General Knowledge.” Proceedings of AAAI 31.
