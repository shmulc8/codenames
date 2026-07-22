"""Experimental encoders that are intentionally separate from the serving path.

``NumberbatchEncoder`` has a fixed vocabulary: it never uses a subword or
semantic fallback. Lookup tries, in this exact order: (1) the supplied surface
form, (2) that form with one leading Hebrew servile prefix removed when it
starts with one of ה, ו, ב, כ, ל, מ, ש, and (3) underscores/spaces exchanged
for the exact and prefix-stripped forms, in that order. An unresolved word is
represented by an all-NaN row so experiment code can explicitly exclude it as
OOV.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

DATA = Path(__file__).resolve().parent / "data"
SERVILE_PREFIXES = frozenset("הובכלמש")


class NumberbatchEncoder:
    """Fixed-vocabulary Hebrew ConceptNet Numberbatch 19.08 vectors."""

    def __init__(self) -> None:
        self.model_id = "conceptnet-numberbatch-he-19.08"
        with (DATA / "numberbatch_he_vocab.json").open(encoding="utf-8") as source:
            self.vocab = json.load(source)
        self.vectors = np.load(DATA / "numberbatch_he.npy", mmap_mode="r")
        if self.vectors.ndim != 2 or self.vectors.dtype != np.float32:
            raise ValueError("Numberbatch vectors must be a 2-D float32 array")
        if len(self.vocab) != self.vectors.shape[0]:
            raise ValueError("Numberbatch vocabulary and vector rows are misaligned")
        if len(set(self.vocab)) != len(self.vocab):
            raise ValueError("Numberbatch vocabulary contains duplicate surface terms")
        self.word_to_row = {word: row for row, word in enumerate(self.vocab)}

    @property
    def dim(self) -> int:
        return int(self.vectors.shape[1])

    def _candidates(self, word: str):
        """Yield documented, trivial lookup variants once each."""
        base = [word]
        if word and word[0] in SERVILE_PREFIXES:
            base.append(word[1:])
        seen: set[str] = set()
        # Exact surface form, then one prefix-stripped form.
        for candidate in base:
            if candidate not in seen:
                seen.add(candidate)
                yield candidate
        # Finally try only the two trivial multiword spelling exchanges.
        for candidate in base:
            for variant in (candidate.replace("_", " "), candidate.replace(" ", "_")):
                if variant not in seen:
                    seen.add(variant)
                    yield variant

    def _row_for(self, word: str) -> int | None:
        for candidate in self._candidates(word):
            row = self.word_to_row.get(candidate)
            if row is not None:
                return row
        return None

    def embed(self, words) -> np.ndarray:
        words = list(words)
        result = np.full((len(words), self.dim), np.nan, dtype=np.float32)
        for output_row, word in enumerate(words):
            row = self._row_for(word)
            if row is not None:
                result[output_row] = self.vectors[row]
            elif len(words) < 100:
                result[output_row] = 0.0
        return result


class BlendEncoder:
    """Concatenated L2-normalized blend of fastText and Numberbatch."""

    def __init__(self, w_ft: float, w_nb: float) -> None:
        self.model_id = f"blend_ft_{w_ft}_nb_{w_nb}"
        from probe import make_encoder

        self.ft = make_encoder("fasttext")
        self.nb = NumberbatchEncoder()
        self.w_ft = w_ft
        self.w_nb = w_nb

    def embed(self, words) -> np.ndarray:
        words = list(words)
        V_ft = self.ft.embed(words)
        V_nb = self.nb.embed(words)
        V_nb_clean = np.nan_to_num(V_nb, nan=0.0)
        V_blend = np.concatenate([self.w_ft * V_ft, self.w_nb * V_nb_clean], axis=-1)
        norms = np.linalg.norm(V_blend, axis=1, keepdims=True)
        V_blend /= norms + 1e-9
        return V_blend


def make_exp_encoder(key: str):
    """Return the experimental Numberbatch encoder, a BlendEncoder, or a registered probe encoder."""
    if key == "numberbatch":
        return NumberbatchEncoder()
    if key.startswith("blend_"):
        parts = key.split("_")
        if len(parts) == 3:
            w_ft = float(parts[1])
            w_nb = float(parts[2])
            return BlendEncoder(w_ft, w_nb)
    from probe import make_encoder

    return make_encoder(key)


def _selftest() -> None:
    encoder = NumberbatchEncoder()
    words = ["מלך", "שולחן", "נהר", "פרויד"]
    vectors = encoder.embed(words)
    cosines = vectors @ vectors.T
    print(f"model_id={encoder.model_id}")
    print(f"dim={encoder.dim} N={len(encoder.vocab)}")
    print("pairwise_cosines")
    print("       " + " ".join(f"{word:>8}" for word in words))
    for word, row in zip(words, cosines, strict=False):
        print(f"{word:>6} " + " ".join(f"{value:8.4f}" for value in row))
    oov = encoder.embed(["זזזזזזז"])[0]
    print(f"oov_all_nan={bool(np.isnan(oov).all())}")
    if not np.isnan(oov).all():
        raise SystemExit("OOV handling failed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        _selftest()
    else:
        parser.print_help()
