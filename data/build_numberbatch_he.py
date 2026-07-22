"""Build Hebrew ConceptNet Numberbatch 19.08 artifacts.

This fetches Zenodo's pre-extracted Hebrew subset, rather than downloading the
20.8-GB multilingual source. Zenodo documents that it was made from the
canonical Numberbatch 19.08 release by selecting the ``/c/he/`` rows and then
dropping terms for which Python ``str.isalpha()`` is false. Its compact
9.8-MB LZMA zip is downloaded into a temporary file and discarded afterwards;
the full multilingual dump is never written locally or decompressed.

Sources:
  Canonical Numberbatch release:
  https://conceptnet.s3.amazonaws.com/downloads/2019/numberbatch/numberbatch-19.08.txt.gz

  Hebrew subset used here:
  https://zenodo.org/records/4911598/files/numberbatch-19.08-he.zip?download=1

Run from the repository root:

    python3 data/build_numberbatch_he.py

It writes two row-aligned files next to this script:

* ``numberbatch_he_vocab.json``: bare ConceptNet surface terms. Multiword
  terms retain ConceptNet's underscores (for example, ``בית_ספר``), rather
  than being converted to spaces.
* ``numberbatch_he.npy``: float32, L2-normalized vectors in the same order.

See NUMBERBATCH_NOTICE.md for source attribution and licensing.
"""

from __future__ import annotations

import io
import json
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

CANONICAL_SOURCE_URL = (
    "https://conceptnet.s3.amazonaws.com/downloads/2019/numberbatch/numberbatch-19.08.txt.gz"
)
HEBREW_SUBSET_URL = "https://zenodo.org/records/4911598/files/numberbatch-19.08-he.zip?download=1"
ZIP_MEMBER = "numberbatch-19.08-he.bin"
HERE = Path(__file__).resolve().parent
VOCAB_PATH = HERE / "numberbatch_he_vocab.json"
VECTORS_PATH = HERE / "numberbatch_he.npy"


def _read_word(stream: io.BufferedReader) -> str:
    """Read one word2vec-binary token, allowing only a newline separator."""
    token = bytearray()
    while True:
        byte = stream.read(1)
        if not byte:
            raise EOFError("unexpected end of Numberbatch binary")
        if byte == b" ":
            return token.decode("utf-8")
        if byte != b"\n":
            token.extend(byte)


def load_word2vec_binary(stream: io.BufferedReader) -> tuple[list[str], np.ndarray]:
    """Load the small, fixed-format Numberbatch subset without gensim."""
    header = stream.readline().decode("ascii").strip().split()
    if len(header) != 2:
        raise ValueError(f"invalid word2vec header: {header!r}")
    count, dim = map(int, header)
    words: list[str] = []
    vectors = np.empty((count, dim), dtype=np.float32)
    vector_bytes = 4 * dim
    for row in range(count):
        words.append(_read_word(stream))
        raw = stream.read(vector_bytes)
        if len(raw) != vector_bytes:
            raise EOFError(f"truncated vector at row {row}")
        vectors[row] = np.frombuffer(raw, dtype="<f4", count=dim)
    if len(set(words)) != len(words):
        raise ValueError("Numberbatch Hebrew subset contains duplicate surface terms")
    return words, vectors


def download_subset(destination: Path) -> None:
    """Fetch the fixed, allowlisted source URL; no caller-controlled URL is used."""
    request = urllib.request.Request(
        HEBREW_SUBSET_URL, headers={"User-Agent": "codenames-numberbatch-builder/1"}
    )
    with urllib.request.urlopen(request, timeout=60) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def build() -> tuple[int, int]:
    with tempfile.TemporaryDirectory(prefix="numberbatch-he-") as tmpdir:
        archive_path = Path(tmpdir) / "numberbatch-19.08-he.zip"
        download_subset(archive_path)
        with zipfile.ZipFile(archive_path) as archive:
            if archive.namelist() != [ZIP_MEMBER]:
                raise ValueError(f"unexpected archive members: {archive.namelist()!r}")
            with archive.open(ZIP_MEMBER) as source:
                words, vectors = load_word2vec_binary(source)

    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    if np.any(~np.isfinite(norms)) or np.any(norms == 0):
        raise ValueError("Numberbatch contains a non-finite or zero vector")
    vectors /= norms
    if not np.allclose(np.linalg.norm(vectors, axis=1), 1.0, atol=2e-6):
        raise ValueError("vector normalization failed")

    with VOCAB_PATH.open("w", encoding="utf-8") as output:
        json.dump(words, output, ensure_ascii=False)
        output.write("\n")
    np.save(VECTORS_PATH, vectors)
    return len(words), vectors.shape[1]


def print_nearest_neighbors(
    words: list[str], vectors: np.ndarray, queries: tuple[str, ...]
) -> None:
    """Print cosine nearest neighbors for a small, source-vocabulary sanity check."""
    word_to_row = {word: row for row, word in enumerate(words)}
    for query in queries:
        row = word_to_row.get(query)
        if row is None:
            print(f"nearest {query}: OOV (no exact Numberbatch Hebrew surface term)")
            continue
        similarities = vectors @ vectors[row]
        similarities[row] = -np.inf
        nearest = np.argpartition(-similarities, 5)[:5]
        nearest = nearest[np.argsort(-similarities[nearest])]
        print(
            "nearest "
            + query
            + ": "
            + ", ".join(f"{words[index]} ({similarities[index]:.4f})" for index in nearest)
        )


if __name__ == "__main__":
    n_words, dim = build()
    print(f"wrote {VOCAB_PATH.name} and {VECTORS_PATH.name}: N={n_words}, dim={dim}")
    with VOCAB_PATH.open(encoding="utf-8") as source:
        vocab = json.load(source)
    normalized_vectors = np.load(VECTORS_PATH)
    print_nearest_neighbors(vocab, normalized_vectors, ("מלך", "פרויד", "רופא"))
