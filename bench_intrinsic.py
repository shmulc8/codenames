import os
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

"""Intrinsic Hebrew word-similarity benchmark for the registered encoders.

This intentionally evaluates bare words only. It makes exactly one ``embed``
call per encoder for the dataset's unique words, then compares cosine similarity
with the human SimLex ratings using Spearman correlation.
"""

import argparse
import csv
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
from scipy.stats import spearmanr

from exp_encoders import make_exp_encoder


DEFAULT_DATA = Path(__file__).with_name("data") / "simlex_he.tsv"


@dataclass(frozen=True)
class SimilarityPair:
    word1: str
    word2: str
    score: float


class WordEncoder(Protocol):
    model_id: str

    def embed(self, words: list[str]) -> np.ndarray: ...


@dataclass
class Result:
    encoder: str
    pairs_scored: int | None = None
    pairs_total: int | None = None
    rho: float | None = None
    error: str | None = None


def load_pairs(path: Path) -> list[SimilarityPair]:
    """Load exactly the checked-in three-column TSV format."""
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.reader(handle, delimiter="\t")
        if next(reader, None) != ["word1", "word2", "score"]:
            raise ValueError(f"{path}: expected header word1<TAB>word2<TAB>score")
        pairs: list[SimilarityPair] = []
        for line_number, row in enumerate(reader, start=2):
            if len(row) != 3 or not row[0] or not row[1]:
                raise ValueError(f"{path}:{line_number}: expected three non-empty columns")
            try:
                score = float(row[2])
            except ValueError as exc:
                raise ValueError(f"{path}:{line_number}: score is not a float: {row[2]!r}") from exc
            if not np.isfinite(score):
                raise ValueError(f"{path}:{line_number}: score must be finite")
            pairs.append(SimilarityPair(row[0], row[1], score))
    if not pairs:
        raise ValueError(f"{path}: no similarity pairs")
    return pairs


def unique_words(pairs: list[SimilarityPair]) -> list[str]:
    return list(dict.fromkeys(word for pair in pairs for word in (pair.word1, pair.word2)))


def score_encoder(name: str, encoder: WordEncoder, pairs: list[SimilarityPair]) -> Result:
    """Embed every unique word once and correlate cosine against human scores."""
    words = unique_words(pairs)
    vectors = np.asarray(encoder.embed(words), dtype=np.float32)
    if vectors.ndim != 2 or vectors.shape[0] != len(words):
        raise ValueError(f"embed returned shape {vectors.shape}; expected ({len(words)}, dim)")
    if np.isinf(vectors).any():
        raise ValueError("embed returned infinite vector values")

    vector_by_word = dict(zip(words, vectors, strict=True))
    human_scores: list[float] = []
    model_scores: list[float] = []
    for pair in pairs:
        # An encoder that elects not to return a word is considered out of vocabulary.
        if pair.word1 not in vector_by_word or pair.word2 not in vector_by_word:
            continue
        v1 = vector_by_word[pair.word1]
        v2 = vector_by_word[pair.word2]
        # Treat all-NaN rows as OOV
        if np.isnan(v1).all() or np.isnan(v2).all():
            continue
        human_scores.append(pair.score)
        # Encoder vectors are documented as L2-normalized, so this is cosine similarity.
        model_scores.append(float(np.dot(v1, v2)))

    rho = float("nan")
    if len(model_scores) >= 2:
        rho = float(spearmanr(model_scores, human_scores).statistic)
    return Result(name, len(model_scores), len(pairs), rho)


class FakeEncoder:
    """Deterministic normalized vectors used only by --selftest."""

    model_id = "selftest-fixed-random"

    def embed(self, words: list[str]) -> np.ndarray:
        rng = np.random.default_rng(20260714)
        vectors = rng.standard_normal((len(words), 16)).astype(np.float32)
        vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
        return vectors


def format_result(result: Result) -> tuple[str, str, str, str]:
    if result.error:
        return result.encoder, "ERROR", "-", result.error
    assert result.pairs_scored is not None and result.pairs_total is not None
    coverage = result.pairs_scored / result.pairs_total if result.pairs_total else 0.0
    rho = "nan" if result.rho is None or np.isnan(result.rho) else f"{result.rho:.4f}"
    return result.encoder, str(result.pairs_scored), f"{coverage:.1%}", rho


def print_table(results: list[Result]) -> None:
    headers = ("encoder", "pairs_scored", "coverage", "spearman_rho")
    rows = [format_result(result) for result in results]
    widths = [max(len(header), *(len(row[i]) for row in rows)) for i, header in enumerate(headers)]
    print("  ".join(header.ljust(widths[i]) for i, header in enumerate(headers)))
    print("  ".join("-" * width for width in widths))
    for row in rows:
        print("  ".join(value.ljust(widths[i]) for i, value in enumerate(row)))


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare Hebrew word encoders on SimLex similarity.")
    parser.add_argument("--encoders", default="fasttext", help="comma-separated probe.py encoder keys")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA, help="TSV with word1, word2, score columns")
    parser.add_argument("--selftest", action="store_true", help="run with a deterministic fake encoder; never load a model")
    args = parser.parse_args()

    pairs = load_pairs(args.data)
    if args.selftest:
        results = [score_encoder("selftest", FakeEncoder(), pairs)]
    else:
        keys = [key.strip() for key in args.encoders.split(",") if key.strip()]
        if not keys:
            parser.error("--encoders must contain at least one encoder key")
        results = []
        for key in keys:
            try:
                encoder = make_exp_encoder(key)
                results.append(score_encoder(key, encoder, pairs))
            except Exception as exc:  # Keep a multi-encoder comparison useful when one model fails.
                results.append(Result(key, error=f"{type(exc).__name__}: {exc}"))

    print(f"data: {args.data} ({len(pairs)} pairs)")
    print_table(results)
    print("Higher spearman_rho is better.")


if __name__ == "__main__":
    main()
