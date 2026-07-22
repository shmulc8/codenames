"""Teammate stand-in for benchmarking clue quality.

A *guesser* ranks the 25 board words by how strongly each relates to a clue — the
signal that decides whether a clue "worked" (the intended team words come out on top,
enemy words stay down). Benchmarks are only as trustworthy as their guesser, so this
module offers two backends and a way to validate either against real human feedback:

- `EnsembleGuesser` — offline, deterministic. Averages hubness-corrected, z-scored
  cosine over several encoders that are architecturally independent of the fastText +
  Numberbatch spymaster geometry (so the engine is never graded by its own embedding).
  Raw cosine in these spaces is anisotropic — a few "hub" words sit close to everything;
  each board word's mean similarity to a reference clue set is subtracted to correct it.
- `LLMGuesser` — an external instruction-following LLM (OpenRouter/Novita) ranks the
  board. Stronger, more human-like, but needs an API key and costs a call per clue.

`make_guesser(spec)` builds either from a string spec. `Guesser.rank(board, clue)`
returns board words best-first; `rank_scores` also returns the per-word score.
"""

from __future__ import annotations

import functools
import os

import numpy as np

import probe

# fastText is the only strong Hebrew associator on hand; qwen3-embed is architecturally
# independent of the spymaster geometry and dilutes the circularity of sharing fastText.
# This pair separates real 👍/👎 feedback best of the offline options (see bench_guesser.py);
# the external LLM guesser stays the promotion gate. Numberbatch is excluded — its thin
# vocab is mostly OOV on real boards, so it ranks near-randomly.
DEFAULT_ENCODERS = ("fasttext", "qwen3-embed")
_N_REF = 1000


@functools.lru_cache(maxsize=1)
def _ref_words(n: int = _N_REF) -> tuple[str, ...]:
    """A fixed pool of ordinary Hebrew content words used only to estimate per-word
    hubness (how close a board word sits to words in general). Skips the very top of the
    frequency list where function-ish words distort the estimate."""
    return tuple(probe.load_clue_vocab(3000, min_len=3)[300 : 300 + n])


class EnsembleGuesser:
    def __init__(self, encoder_keys=DEFAULT_ENCODERS, n_ref: int = _N_REF):
        self.encoder_keys = list(encoder_keys)
        self._encs = [probe.make_encoder(k) for k in self.encoder_keys]
        self._ref = list(_ref_words(n_ref))
        self._refcache: dict[int, np.ndarray] = {}
        self.model_id = "ensemble:" + "+".join(self.encoder_keys)

    def _ref_matrix(self, i: int, enc) -> np.ndarray:
        if i not in self._refcache:
            self._refcache[i] = enc.embed(self._ref)
        return self._refcache[i]

    def _z_scores(self, i: int, enc, words: list[str], clue: str) -> np.ndarray:
        M = enc.embed(list(words) + [clue])
        B, c = M[:-1], M[-1]
        mu = np.nanmean(B @ self._ref_matrix(i, enc).T, axis=1)  # per-word hubness offset
        s = (B @ c) - mu  # hubness-corrected similarity
        finite = s[np.isfinite(s)]  # OOV words → NaN
        m, sd = (finite.mean(), finite.std()) if finite.size else (0.0, 1.0)
        return (s - m) / (sd + 1e-9)  # z-score → comparable across encoders

    def rank_scores(self, board: probe.Board, clue: str) -> tuple[list[str], dict[str, float]]:
        words = board.words
        z = np.array([self._z_scores(i, e, words, clue) for i, e in enumerate(self._encs)])
        agg = np.nanmean(z, axis=0)  # a word OOV in one encoder still ranks via the other
        agg = np.where(
            np.isfinite(agg), agg, agg[np.isfinite(agg)].min() if np.isfinite(agg).any() else 0.0
        )
        order = [words[i] for i in np.argsort(-agg)]
        return order, {w: float(agg[j]) for j, w in enumerate(words)}

    def rank(self, board: probe.Board, clue: str) -> list[str]:
        return self.rank_scores(board, clue)[0]


_LLM_SYS = (
    "אתה שחקן מנוסה במשחק שם קוד בעברית. דרג את כל מילות הלוח לפי הקשר שלהן לרמז בלבד, "
    "מהקרובה ביותר לפחות. אל תשתמש במידע שאינו הרמז והמילים."
)
_PROVIDERS = {
    "openrouter": ("https://openrouter.ai/api/v1/chat/completions", "OPENROUTER_API_KEY"),
    "novita": ("https://api.novita.ai/openai/v1/chat/completions", "NOVITA_API_KEY"),
    "openai": ("https://api.openai.com/v1/chat/completions", "OPENAI_API_KEY"),
}


def _load_dotenv() -> None:
    """Populate os.environ from a repo-root .env (never overrides an existing var)."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


class LLMGuesser:
    """External LLM guesser. spec: 'llm:openai:gpt-5.6-terra' | 'llm:openrouter:google/gemini-2.5-flash'."""

    def __init__(self, provider: str = "openrouter", model: str = "google/gemini-2.5-flash"):
        if provider not in _PROVIDERS:
            raise ValueError(f"unknown provider {provider!r}; pick from {list(_PROVIDERS)}")
        self.provider = provider
        self.url, self._key_env = _PROVIDERS[provider]
        self.api_key = os.environ.get(self._key_env, "")
        if not self.api_key:
            _load_dotenv()
            self.api_key = os.environ.get(self._key_env, "")
        if not self.api_key:
            raise RuntimeError(f"{self._key_env} not set — cannot use the external LLM guesser")
        self.model = model
        self.model_id = f"llm:{provider}:{model}"

    def rank(self, board: probe.Board, clue: str) -> list[str]:
        import json
        import re
        import time
        import urllib.request

        user = (
            f"הרמז: {clue}\nמילות הלוח: {', '.join(board.words)}\n\n"
            "החזר את כל מילות הלוח מסודרות מהקשורה ביותר לרמז עד הפחות קשורה, "
            "מופרדות בפסיק, בלי מספור ובלי טקסט נוסף."
        )
        body_dict = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": _LLM_SYS},
                {"role": "user", "content": user},
            ],
        }
        if self.provider == "openai":
            # gpt-5.x reasoning models reject a custom temperature and rename the token cap;
            # a generous completion budget keeps hidden reasoning from truncating the answer.
            body_dict["max_completion_tokens"] = 4000
        else:
            body_dict["temperature"] = 0
        body = json.dumps(body_dict).encode()
        txt, last_err = None, None
        for attempt in range(3):
            try:
                req = urllib.request.Request(
                    self.url,
                    data=body,
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                )
                with urllib.request.urlopen(req, timeout=90) as resp:
                    txt = json.loads(resp.read())["choices"][0]["message"]["content"]
                break
            except Exception as err:  # network/parse — retry with backoff
                last_err = err
                if attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
        if txt is None:
            raise RuntimeError(f"LLM guesser call failed after retries: {last_err}")
        ranked, seen = [], set()
        for tok in re.split(r"[,\n־]| ו", txt):
            w = probe._match_board(tok, board.words)
            if w and w not in seen:
                ranked.append(w)
                seen.add(w)
        for w in board.words:  # append any the model dropped
            if w not in seen:
                ranked.append(w)
        return ranked

    def rank_scores(self, board: probe.Board, clue: str):
        order = self.rank(board, clue)
        n = len(order)
        return order, {w: float(n - i) for i, w in enumerate(order)}


def make_guesser(spec: str = "ensemble"):
    """`ensemble` (default) | `ensemble:qwen3-embed,embeddinggemma` |
    `llm:openrouter:google/gemini-2.5-flash`."""
    if spec.startswith("llm:"):
        parts = spec.split(":", 2)
        provider = parts[1] if len(parts) > 1 and parts[1] else "openrouter"
        default_model = {"openai": "gpt-5.6-terra"}.get(provider, "google/gemini-2.5-flash")
        model = parts[2] if len(parts) > 2 and parts[2] else default_model
        return LLMGuesser(provider, model)
    if spec == "ensemble":
        return EnsembleGuesser()
    if spec.startswith("ensemble:"):
        keys = tuple(k for k in spec.split(":", 1)[1].split(",") if k)
        return EnsembleGuesser(keys)
    raise ValueError(f"unknown guesser spec {spec!r}")
