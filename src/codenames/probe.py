"""Hebrew Codenames as a probe for cross-model semantic alignment.

The game is a measurement instrument: a one-word clue transduces a *target set*
into a *guess*. We put two semantic systems on that channel —
  - modern Hebrew ENCODERS (the geometry: cosine over word embeddings), and
  - a Hebrew LLM (the intent: clue-giving / guessing in natural language) —
and read off where their notions of "what this clue points at" agree and diverge.

NOTE on what this measures (Koyyalagunta et al. 2021, critiquing Kim et al. 2019):
agreement between a clue-giver and a guesser that share an embedding is trivially
high; cross-system agreement measures *cooperation / alignment*, NOT clue quality.
So our headline number is an alignment score — with the LLM standing in as the
"human-like intent" reference (Kumar et al. 2021: distributional cosine
systematically under-predicts human word association). The divergences are the finding.

Two directions:
  LLM -> Encoder : LLM gives a clue + names its targets; does the encoder's
                   nearest-neighbour guess recover them?     (intent recovery)
  Encoder -> LLM : encoder picks the best-scoring clue; does the LLM rank its
                   intended targets on top?                  (geometry legibility)

Headline scalar: per clue, Spearman rho between the encoder's cosine ordering of
the 25 board words and the LLM's ordering, averaged over rounds.
"""

from __future__ import annotations

import json
import os
import random
import re
from dataclasses import dataclass, field

import numpy as np

from . import DATA_DIR, morph
from .deck_he import DECK

DATA = DATA_DIR

# --------------------------------------------------------------------------- #
# The bench
# --------------------------------------------------------------------------- #

ENCODERS = {
    # Static subword vectors — the literature-recommended baseline for Hebrew
    # (morphology/OOV); often competitive with contextual encoders for bare-word
    # association. Handles OOV via subwords.
    "fasttext": dict(kind="fasttext", path=os.path.join(DATA, "cc.he.300.fp16.bin")),
    # Concatenated L2-normalized blend of fastText and ConceptNet Numberbatch.
    "blend_0.5_0.5": dict(kind="blend", w_ft=0.5, w_nb=0.5),
    "blend_0.7_0.3": dict(kind="blend", w_ft=0.7, w_nb=0.3),
    # Hebrew-native, newest Dicta encoder (needs transformers<5).
    "neodictabert": dict(kind="st", model_id="dicta-il/neodictabert-bilingual-embed"),
    # 2025 multilingual SOTA-small.
    "embeddinggemma": dict(kind="st", model_id="google/embeddinggemma-300m"),
    "qwen3-embed": dict(kind="st", model_id="Qwen/Qwen3-Embedding-0.6B"),
}

# DictaLM 3.0 (2026-05) via MLX. Swap to the 12B for the quality run.
LLM_FAST = "ssdataanalysis/DictaLM-3.0-1.7B-Instruct-mlx-8Bit"
LLM_BIG = "ssdataanalysis/DictaLM-3.0-Nemotron-12B-Instruct-mlx-8Bit"

# Standard Codenames split: 25 words, 9 / 8 / 7 / 1.
N_BOARD, N_MY, N_OPP, N_NEUTRAL, N_ASSASSIN = 25, 9, 8, 7, 1


# --------------------------------------------------------------------------- #
# Encoders
# --------------------------------------------------------------------------- #


def _device():
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


class Encoder:
    """Embeds bare Hebrew words to L2-normalised vectors (cosine == dot).

    Loads via sentence-transformers when possible; otherwise a raw AutoModel
    with mean pooling over the last hidden state.
    """

    def __init__(self, model_id: str):
        self.model_id = model_id
        self._st = None
        self._tok = self._model = None
        dev = _device()
        try:
            from sentence_transformers import SentenceTransformer

            self._st = SentenceTransformer(model_id, device=dev, trust_remote_code=True)
        except Exception:
            from transformers import AutoModel, AutoTokenizer

            self._tok = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True)
            self._model = AutoModel.from_pretrained(model_id, trust_remote_code=True).to(dev).eval()
            self._dev = dev

    def embed(self, words) -> np.ndarray:
        words = list(words)
        if self._st is not None:
            V = self._st.encode(
                words, normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False
            )
            return np.nan_to_num(V, nan=0.0, posinf=0.0, neginf=0.0)
        import torch

        out = []
        with torch.no_grad():
            for i in range(0, len(words), 64):
                batch = words[i : i + 64]
                enc = self._tok(batch, padding=True, truncation=True, return_tensors="pt").to(
                    self._dev
                )
                hs = self._model(**enc).last_hidden_state
                mask = enc["attention_mask"].unsqueeze(-1).float()
                mean = (hs * mask).sum(1) / mask.sum(1).clamp(min=1e-9)
                mean = torch.nn.functional.normalize(mean, p=2, dim=1)
                out.append(mean.cpu().numpy())
        return np.nan_to_num(np.vstack(out), nan=0.0, posinf=0.0, neginf=0.0)


class FastTextEncoder:
    """Static fastText subword vectors (OOV-safe). L2-normalised."""

    def __init__(self, path: str):
        import fasttext

        self.model_id = os.path.basename(path)
        self._m = fasttext.load_model(path)

    def embed(self, words) -> np.ndarray:
        words = list(words)
        if not words:
            return np.zeros((0, self._m.get_dimension()), np.float32)
        V = np.stack([self._m.get_word_vector(w) for w in words]).astype(np.float32)
        V /= np.linalg.norm(V, axis=1, keepdims=True) + 1e-9
        return V


class CompressedFastTextEncoder:
    """A compress-fasttext model (pruned vocab/ngrams + fp16). Same geometry as the full
    cc.he.300.bin (validated loss-free) at ~20x smaller — keeps subword OOV. L2-normalised."""

    def __init__(self, path: str):
        import compress_fasttext

        self.model_id = os.path.basename(path)
        self._m = compress_fasttext.models.CompressedFastTextKeyedVectors.load(path)

    def embed(self, words) -> np.ndarray:
        words = list(words)
        if not words:
            return np.zeros((0, self._m.vector_size), np.float32)
        V = np.stack([self._m[w] for w in words]).astype(np.float32)
        V /= np.linalg.norm(V, axis=1, keepdims=True) + 1e-9
        return V


def make_encoder(key: str):
    if key == "numberbatch" or key.startswith("blend_"):
        from .exp_encoders import make_exp_encoder

        return make_exp_encoder(key)
    cfg = ENCODERS[key]
    if cfg["kind"] == "fasttext":
        # The compressed fp16 model (geometrically loss-free vs the full cc.he.300.bin, ~250 MB
        # incl. its .vectors.npy sidecar) is the standard model everywhere — the full 7 GB model
        # is not required. FASTTEXT_COMPRESSED can point at a different compressed model; a full
        # .bin can still be loaded explicitly via cfg["path"] + FastTextEncoder if one is present.
        comp = os.environ.get("FASTTEXT_COMPRESSED", cfg["path"])
        if comp.endswith(".bin") and "fp16" not in comp and os.path.exists(comp):
            return FastTextEncoder(comp)
        return CompressedFastTextEncoder(comp)
    return Encoder(cfg["model_id"])


# --------------------------------------------------------------------------- #
# Clue vocabulary (large, frequency-filtered — clues are NOT drawn from the deck)
# --------------------------------------------------------------------------- #

_HEB_LETTERS = re.compile(r"[א-ת]+$")  # letters incl. final forms, no niqqud/punct


def load_clue_vocab(n: int = 12000, min_len: int = 2, max_len: int = 12, path: str | None = None):
    """Top-n Hebrew words from a frequency list (FrequencyWords `word count` format).

    The only filters are validity, not tuning: pure Hebrew letters (no digits/punct)
    and a sane length. No stopword list / frequency-band skip — broadly-similar common
    words are suppressed by the per-clue mean-centering in `encoder_spymaster`, not by
    hand-maintained lists."""
    path = path or os.path.join(DATA, "he_freq_50k.txt")
    out, seen = [], set()
    with open(path, encoding="utf-8") as f:
        for line in f:
            w = line.split(" ")[0].strip()
            if w in seen or not (min_len <= len(w) <= max_len) or not _HEB_LETTERS.match(w):
                continue
            seen.add(w)
            out.append(w)
            if len(out) >= n:
                break
    return out


def load_clue_vocab_content(n: int = 1500, source_n: int = 6000, cache: str | None = None):
    """A clue vocabulary of **content-word lemmas**: take the frequency list, keep only
    content POS (noun/adj/verb/proper — drops prepositions, pronouns, conjunctions, adverbs
    via DictaBERT-morph), reduce each to its lemma and de-duplicate (so בתי/בבית/בית collapse
    to בית). Principled clue-quality filter — no stopword list. Cached to disk (computed once)."""
    cache = cache or os.path.join(DATA, f"clue_vocab_content_{n}.json")
    if os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            return json.load(f)
    raw = load_clue_vocab(source_n, min_len=2)
    parts = morph.pos(raw)
    lems = morph.lemmas(raw)
    out, seen = [], set()
    for _w, p, lem in zip(raw, parts, lems, strict=False):
        if p not in morph.CONTENT_POS or not _HEB_LETTERS.match(lem) or len(lem) < 2:
            continue
        if lem in seen:
            continue
        seen.add(lem)
        out.append(lem)  # the lemma is the clue word
        if len(out) >= n:
            break
    with open(cache, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    return out


# --------------------------------------------------------------------------- #
# DETECT-style frequency (Koyyalagunta et al. 2021): a clue should be a *mid*-frequency
# word — neither obscure (rare → bad clue) nor over-common (generic / conversational →
# bad clue). We apply it twice: at vocab-build time (keep only the mid band) and as a
# soft term in the scoring function. Replaces the old "take the most frequent content
# words" pool, whose top is dominated by dialogue verbs (רוצה / יודע / חושב).
# --------------------------------------------------------------------------- #

_FREQ: dict[str, int] | None = None


def load_freqs(path: str | None = None) -> dict[str, int]:
    """Surface-form -> corpus count from the frequency list (loaded once)."""
    global _FREQ
    if _FREQ is None:
        path = path or os.path.join(DATA, "he_freq_50k.txt")
        d: dict[str, int] = {}
        with open(path, encoding="utf-8") as f:
            for line in f:
                p = line.split()
                if len(p) >= 2 and _HEB_LETTERS.match(p[0]):
                    d.setdefault(p[0], int(p[1]))
        _FREQ = d
    return _FREQ


def content_lemma_master(source_n: int = 14000, cache: str | None = None):
    """All content-word lemmas within the top `source_n` of the frequency list, each as
    [lemma, count, pos], sorted by count desc. The DictaBERT POS+lemma pass runs once and
    is cached; clue-vocab bands (by frequency and/or POS) are sliced from this cheaply."""
    cache = cache or os.path.join(DATA, f"content_master_v2_{source_n}.json")
    if os.path.exists(cache):
        return json.load(open(cache, encoding="utf-8"))
    raw, cnt = [], {}
    with open(os.path.join(DATA, "he_freq_50k.txt"), encoding="utf-8") as f:
        for line in f:
            p = line.split()
            if len(p) >= 2 and _HEB_LETTERS.match(p[0]) and 2 <= len(p[0]) <= 12:
                if p[0] not in cnt:
                    raw.append(p[0])
                    cnt[p[0]] = int(p[1])
            if len(raw) >= source_n:
                break
    parts = morph.pos(raw)
    lems = morph.lemmas(raw)
    best: dict[str, tuple[int, str]] = {}
    for w, p, lem in zip(raw, parts, lems, strict=False):
        if p not in morph.CONTENT_POS or not _HEB_LETTERS.match(lem) or len(lem) < 2:
            continue
        c = cnt[w]
        if c > best.get(lem, (0, ""))[0]:
            best[lem] = (c, p)
    data = sorted(([lem, c, p] for lem, (c, p) in best.items()), key=lambda r: -r[1])
    json.dump(data, open(cache, "w", encoding="utf-8"), ensure_ascii=False)
    return data


_BLOCKLIST: set[str] | None = None


def load_blocklist() -> set[str]:
    global _BLOCKLIST
    if _BLOCKLIST is None:
        block = set()
        path = os.path.join(DATA, "blocklist_he.txt")
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    w = line.strip()
                    if w and not w.startswith("#"):
                        block.add(w)
        _BLOCKLIST = block
    return _BLOCKLIST


def is_malformed(word: str) -> bool:
    # 1. Reject words with 3 or more of the same character in a row
    for i in range(len(word) - 2):
        if word[i] == word[i + 1] == word[i + 2]:
            return True

    # 2. Reject words with final letters (ך, ם, ן, ף, ץ) in middle positions (non-final)
    finals = set("ךםןףץ")
    for i in range(len(word) - 1):
        if word[i] in finals:
            return True

    # 3. Reject words with non-final letters (כ, מ, נ, פ, צ) at the end of the word
    non_finals = set("כמנפצ")
    if word[-1] in non_finals:
        return True

    return False


def clue_vocab_band(
    n: int = 1800,
    lo: int = 200,
    hi: int = 60000,
    pos: set[str] | None = None,
    source_n: int = 14000,
    min_len: int = 3,
    mode: str | None = None,
    filter_malformed: bool = True,
    filter_blocklist: bool = True,
):
    """Clue vocab from a frequency BAND of content lemmas: drop over-common conversational
    words (count > hi) and obscure words (count < lo). `pos` optionally restricts the part
    of speech (e.g. {'NOUN','ADJ'} — nouns/adjectives make cleaner clues than verbs and
    avoid the subtitle proper-name noise). `min_len` drops 1–2 letter tokens, which in the
    frequency list are mostly fragments / mislabeled function words (עו, תר, מה) rather than
    real clue words. Returns (words, counts)."""
    if mode is not None:
        source_n = 30000
        if mode == "conservative":
            pos = {"NOUN", "ADJ"}
            lo, hi = 1000, 80000
        elif mode == "broad":
            pos = {"NOUN", "ADJ", "PROPN"}
            lo, hi = 300, 100000
        elif mode == "experimental":
            pos = {"NOUN", "ADJ", "PROPN", "VERB"}
            lo, hi = 100, 150000
        else:
            raise ValueError(f"Unknown vocabulary mode: {mode}")

    data = content_lemma_master(source_n)
    block = load_blocklist() if filter_blocklist else set()

    band = []
    for w, c, p in data:
        if not (lo <= c <= hi):
            continue
        if len(w) < min_len:
            continue
        if pos is not None and p not in pos:
            continue
        if filter_blocklist and w in block:
            continue
        if filter_malformed and is_malformed(w):
            continue
        band.append((w, c))
        if len(band) >= n:
            break

    return [w for w, _ in band], np.array([c for _, c in band], dtype=np.float32)


def freq_scores(counts, lo: float = 200.0, hi: float = 60000.0, margin: float = 2.0) -> np.ndarray:
    """DETECT-FREQ preference in [0,1]: ~1 inside the mid-frequency band [lo, hi], with a
    soft log-linear decay over `margin` log-units for words that are too rare or too common.
    `counts` is an array of corpus counts aligned to a clue vocabulary."""
    c = np.asarray(counts, dtype=np.float64)
    x = np.log(np.clip(c, 1.0, None))
    lo_l, hi_l = np.log(lo), np.log(hi)
    below = np.clip(1.0 - (lo_l - x) / margin, 0.0, 1.0)
    above = np.clip(1.0 - (x - hi_l) / margin, 0.0, 1.0)
    s = np.where(x < lo_l, below, np.where(x > hi_l, above, 1.0))
    return np.where(c <= 0, 0.0, s).astype(np.float32)


# The assassin costs the game outright, an opponent word only a turn, so the listener-danger
# term weighs probability mass on the assassin more than on a rival word.
_SOFT_ASSASSIN_WEIGHT = 2.0


def _board_softmax(sim: np.ndarray, tau: float) -> np.ndarray:
    """Row-wise softmax of board similarities: L0(word | clue), a literal-listener
    distribution over the 25 board words for each candidate clue (rows). `tau` is the
    temperature (lower = peakier). Invariant to the per-clue mean-centring of `sim`, since a
    per-row shift cancels in the softmax."""
    z = sim / max(tau, 1e-6)
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)


def _listener_danger(
    adj: np.ndarray, is_as: np.ndarray, is_opp: np.ndarray, tau: float
) -> np.ndarray:
    """Probability mass a literal listener puts on danger words, per candidate clue: the
    softmax share landing on the assassin (weighted) plus the share on opponent words. Unlike
    the hinge penalties (which read absolute centred similarity), this is scale-invariant and
    accounts for board competition — a clue near the assassin is safe if team/neutral words
    draw more of the listener's mass, and risky if they don't."""
    L0 = _board_softmax(adj, tau)
    as_mass = L0[:, is_as].sum(1) if is_as.any() else 0.0
    opp_mass = L0[:, is_opp].sum(1) if is_opp.any() else 0.0
    return _SOFT_ASSASSIN_WEIGHT * as_mass + opp_mass


# --------------------------------------------------------------------------- #
# Board
# --------------------------------------------------------------------------- #


@dataclass
class Board:
    words: list[str]
    role: dict[str, str]  # word -> my | opp | neutral | assassin

    def of(self, r: str) -> list[str]:
        return [w for w in self.words if self.role[w] == r]

    @property
    def my(self):
        return self.of("my")

    @property
    def assassin(self):
        a = self.of("assassin")
        return a[0] if a else ""  # tolerate a board the user marked without an assassin

    @property
    def avoid(self):
        return [w for w in self.words if self.role[w] != "my"]


def sample_board(rng: random.Random) -> Board:
    words = rng.sample(DECK, N_BOARD)
    roles = ["my"] * N_MY + ["opp"] * N_OPP + ["neutral"] * N_NEUTRAL + ["assassin"] * N_ASSASSIN
    rng.shuffle(roles)
    return Board(words=words, role=dict(zip(words, roles, strict=False)))


# --------------------------------------------------------------------------- #
# Encoder spymaster + ranking
# --------------------------------------------------------------------------- #


def encoder_rank(enc, board: Board, clue: str):
    """Rank all board words by cosine to the clue. Returns (ordered_words, sims_dict)."""
    W = enc.embed(board.words)
    c = enc.embed([clue])[0]
    sims = W @ c
    order = np.argsort(-sims)
    return [board.words[i] for i in order], {
        board.words[i]: float(sims[i]) for i in range(len(board.words))
    }


def cohesion_keep(enc, words, floor: float = 0.24, pin=frozenset(), mode: str = "any"):
    """Greedy intra-cluster cohesion filter. Keep the head (strongest) word, then keep each
    later word only if it coheres (cosine >= floor) with the already-kept set — or is pinned.
    Enforces that a clue names a *cluster*: every counted word must cohere with the others,
    not merely with the clue. Catches a passenger like radio→milk that the clue↔word
    similarity alone lets through (milk is close-ish to 'radio' but far from voice/journalist).
    `words` must be in similarity order (strongest first).

    `mode` sets what "coheres with the kept set" means:
      "any"  — link to *any* kept word (handles transitive a→b→c chains, but a noise pair can
               attach to each other via one borderline link, e.g. food→{beauty,freedom}),
      "head" — link to the *head* (strongest) word (kills noise sub-clusters, but can drop a
               legitimate chain tail that relates to a sibling more than to the head)."""
    if len(words) <= 1:
        return list(words)
    V = enc.embed(list(words))
    V = V / (np.linalg.norm(V, axis=1, keepdims=True) + 1e-9)
    S = V @ V.T
    kept = [0]
    for i in range(1, len(words)):
        link = S[i, 0] if mode == "head" else max(S[i, j] for j in kept)
        if words[i] in pin or link >= floor:
            kept.append(i)
    return [words[i] for i in kept]


def served_count(
    read,
    keep_rel: float = 0.66,
    pin=frozenset(),
    enc=None,
    cohesion_floor: float | None = None,
    cohesion_mode: str = "any",
    cliff: float = 0.5,
):
    """The words a clue should *claim* and light up, from a board reading.

    `read` = list of {word, role, sim} ordered by sim desc (an encoder's reading of the clue).
    Two stages:
      1. Walk the *safe run* (team words reached before any enemy word) and keep each next word
         while it stays strong: above `keep_rel`× the top target AND no sharp cliff (< cliff× the
         previous kept word). A pinned word is always kept. This adapts the count to how many
         words are genuinely clustered — a tight trio stays 3, "1 strong + noise tail" shrinks.
      2. Cohesion trim (when `enc` + `cohesion_floor` given): drop any kept word that doesn't
         cohere with the rest of the cluster (see `cohesion_keep`).
    Returns the kept word list (the served `intended`)."""
    safe = []
    for r in read:
        if r["role"] == "my":
            safe.append(r["word"])
        else:
            break
    if not safe:
        return []
    simmap = {r["word"]: r["sim"] for r in read}
    top = simmap[safe[0]]
    kept = [safe[0]]
    prev = top
    for w in safe[1:]:
        s = simmap[w]
        if w in pin:
            kept.append(w)
            prev = s
            continue
        if s < top * keep_rel or s < prev * cliff:
            break
        kept.append(w)
        prev = s
    if enc is not None and cohesion_floor is not None and len(kept) > 1:
        kept = cohesion_keep(enc, kept, floor=cohesion_floor, pin=pin, mode=cohesion_mode)
    return kept


@dataclass
class Clue:
    word: str
    count: int
    intended: list[str]
    margin: float  # the scoring-function value g(c, I)
    assassin_sim: float = field(default=float("nan"))
    reason: str = ""  # one-line rationale (hybrid / LLM picks)


def encoder_spymaster(
    enc,
    board: Board,
    clue_vocab,
    clue_emb=None,
    vocab_lemmas=None,
    lam_opp: float = 1.0,
    lam_neu: float = 0.3,
    lam_a: float = 2.0,
    lam_f: float = 0.0,
    vocab_freq=None,
    m: int = 2,
    lam_soft: float = 0.0,
    soft_tau: float = 0.1,
) -> Clue:
    """Pick the clue maximising a tiered Codenames scoring function:
        g(c) = sum_{top-m team} s'(c,b)
               - lam_a   * max(0, s'(c, assassin))     # the black card — avoid hardest
               - lam_opp * max(0, max_opp  s'(c,r))    # rival team — avoid strongly
               - lam_neu * max(0, max_neut s'(c,r))    # bystanders — avoid mildly
               + lam_f   * FREQ(c)                      # DETECT-FREQ: prefer mid-frequency
               - lam_soft * P_danger(c)                 # listener mass on assassin+opp words
    where s'(c,w) = cos(c,w) - mean_b cos(c,b) is the similarity centred per clue over
    the 25 board words (anisotropy / DETECT-style correction so broadly-similar common
    words don't win). P_danger(c) is the softmax share (temperature `soft_tau`) a literal
    listener puts on danger words — a board-competition-aware complement to the absolute
    hinge penalties (see `_listener_danger`); set lam_soft=0 to disable. Clues come from
    `clue_vocab`, never the board (no shared surface form). Pass precomputed `clue_emb`
    (aligned with clue_vocab) to skip re-embedding, and `vocab_freq` (FREQ scores in [0,1]
    aligned with clue_vocab) to enable the FREQ term.
    """
    bw, B, cand, keep, C = _legal_candidates(enc, board, clue_vocab, clue_emb, vocab_lemmas)
    adj = C @ B.T  # (V, 25) cosine to every board word
    adj = adj - adj.mean(1, keepdims=True)  # centre per clue over the board

    roles = np.array([board.role[w] for w in bw])
    is_my, is_opp = roles == "my", roles == "opp"
    is_neu, is_as = roles == "neutral", roles == "assassin"

    def tier_max(mask):
        return np.clip(adj[:, mask].max(1), 0, None) if mask.any() else np.zeros(len(cand))

    adj_my = adj[:, is_my]
    m = min(m, adj_my.shape[1])
    sorted_my = np.sort(adj_my, axis=1)[:, ::-1]
    if m >= 2:
        top_my = sorted_my[:, :m].mean(1) + 1.0 * sorted_my[:, m - 1]
    elif m == 1:
        top_my = sorted_my[:, 0]
    else:
        top_my = np.full(len(cand), -99.0, dtype=np.float32)
    g = top_my - lam_a * tier_max(is_as) - lam_opp * tier_max(is_opp) - lam_neu * tier_max(is_neu)
    if vocab_freq is not None and lam_f:
        g = g + lam_f * np.asarray(vocab_freq, dtype=np.float32)[keep]
    if lam_soft:
        g = g - lam_soft * _listener_danger(adj, is_as, is_opp, soft_tau)

    bi = int(np.nanargmax(g))
    my_words = [w for w, mm in zip(bw, is_my, strict=False) if mm]
    order = np.argsort(-adj_my[bi])[:m]
    return Clue(
        word=cand[bi],
        count=m,
        intended=[my_words[j] for j in order],
        margin=float(g[bi]),
        assassin_sim=float(adj[bi, is_as][0]) if is_as.any() else float("nan"),
    )


def encoder_clue_candidates(
    enc,
    board: Board,
    clue_vocab,
    clue_emb=None,
    vocab_lemmas=None,
    n: int = 10,
    targets: list[str] | None = None,
    lam_opp: float = 1.0,
    lam_neu: float = 0.3,
    lam_a: float = 2.0,
    lam_f: float = 0.0,
    vocab_freq=None,
    m: int = 2,
    safe_margin: float = 0.0,
    lam_soft: float = 0.0,
    soft_tau: float = 0.1,
    lam_div: float = 0.0,
):
    """Top-n legal clue candidates, each with the team words it *safely* connects.

    A team word counts toward a clue only if it is safe — its mean-centred similarity to the
    clue beats every enemy/neutral/assassin word by `safe_margin`. The team term is the sum of
    the top-m safe words, so the score credits only words a guesser would reach before any danger
    word (a stretched m-th word an opponent outranks no longer inflates it), and the returned
    `intended`/`count` are exactly those safe words. Larger `safe_margin` = more conservative
    (the risk dial). `targets` forces a clue for a chosen team subset (the "clue for these words"
    path): there all targets are scored, and safety only informs the tiered penalties.

    `lam_soft` adds a listener-competition penalty: the score drops by lam_soft times the
    softmax share (temperature `soft_tau`) a literal listener would put on the assassin
    (weighted) and opponent words (see `_listener_danger`). It complements the absolute hinge
    penalties with a scale-invariant, whole-board view; set lam_soft=0 to disable.

    `lam_div` diversifies the returned shortlist (MMR-style): when >0 and not a fixed-target
    request, candidates are picked greedily by `score - lam_div * max_jaccard(intended, already
    picked)`, so near-duplicate clues for the same target pair don't crowd out other legal
    combinations. lam_div=0 restores the plain top-n-by-score behaviour."""
    bw, B, cand, keep, C = _legal_candidates(enc, board, clue_vocab, clue_emb, vocab_lemmas)
    adj = C @ B.T
    adj = adj - adj.mean(1, keepdims=True)
    roles = np.array([board.role[w] for w in bw])
    is_my = roles == "my"
    is_opp, is_neu, is_as = roles == "opp", roles == "neutral", roles == "assassin"

    def tmax(mask):
        return np.clip(adj[:, mask].max(1), 0, None) if mask.any() else np.zeros(len(cand))

    enemy_ceiling = adj[:, ~is_my].max(1) if (~is_my).any() else np.full(len(cand), -1e9)
    fixed = bool(targets)
    my_words = (
        [w for w in targets if w in bw]
        if fixed
        else [w for w, mm in zip(bw, is_my, strict=False) if mm]
    )
    my_cols = [bw.index(w) for w in my_words]
    adj_my = adj[:, my_cols] if my_cols else np.zeros((len(cand), 0), np.float32)
    safe = adj_my > (enemy_ceiling[:, None] + safe_margin)  # beats every enemy word by margin
    if fixed:
        g_team = adj_my.sum(1)  # honour the user's chosen targets
    else:  # mean + minimum of the top-k *safe* team words (k <= m)
        safe_counts = safe.sum(1)
        sorted_safe = np.sort(np.where(safe, adj_my, -9.0), 1)[:, ::-1]
        g_team = np.zeros(len(cand), dtype=np.float32)
        for k_val in range(1, m + 1):
            mask = (safe_counts == k_val) if k_val < m else (safe_counts >= k_val)
            if not mask.any():
                continue
            if k_val >= 2:
                g_team[mask] = (
                    sorted_safe[mask, :k_val].mean(1) + 1.0 * sorted_safe[mask, k_val - 1]
                )
            else:
                g_team[mask] = sorted_safe[mask, 0] - 0.5
        g_team[safe_counts == 0] = -99.0
    g = g_team - lam_a * tmax(is_as) - lam_opp * tmax(is_opp) - lam_neu * tmax(is_neu)
    if vocab_freq is not None and lam_f:
        g = g + lam_f * np.asarray(vocab_freq, dtype=np.float32)[keep]
    if lam_soft:
        g = g - lam_soft * _listener_danger(adj, is_as, is_opp, soft_tau)

    def intended_of(bi) -> list[str]:
        if fixed:
            return my_words
        order = [j for j in np.argsort(-adj_my[bi]) if safe[bi, j]][:m]
        if not order and adj_my.shape[1]:
            order = [int(np.argmax(adj_my[bi]))]  # nothing clears the bar: best single word
        return [my_words[j] for j in order]

    ranked = list(np.argsort(-g))
    if lam_div and not fixed:
        # MMR: from a pool of the strongest candidates, greedily pick the n that trade off score
        # against overlap with the target sets already chosen, so the shortlist spans distinct
        # team-word combinations instead of collapsing onto one tight pair.
        pool = ranked[: max(n * 20, 200)]
        pool_sets = {bi: frozenset(intended_of(bi)) for bi in pool}
        selected, chosen_sets, remaining = [], [], list(pool)
        while len(selected) < n and remaining:
            best_bi, best_val = remaining[0], -1e18
            for bi in remaining:
                s = pool_sets[bi]
                ov = max((len(s & t) / len(s | t) for t in chosen_sets if (s | t)), default=0.0)
                val = float(g[bi]) - lam_div * ov
                if val > best_val:
                    best_val, best_bi = val, bi
            selected.append(best_bi)
            chosen_sets.append(pool_sets[best_bi])
            remaining.remove(best_bi)
    else:
        selected = ranked[:n]

    out = []
    for bi in selected:
        tg = intended_of(bi)
        out.append({"word": cand[int(bi)], "intended": tg, "count": len(tg), "score": float(g[bi])})
    return out


# --------------------------------------------------------------------------- #
# Hebrew LLM (DictaLM 3.0 via MLX)
# --------------------------------------------------------------------------- #


class HebrewLLM:
    def __init__(self, model_id: str = LLM_FAST):
        from mlx_lm import load

        self.model_id = model_id
        self.model, self.tok = load(model_id)

    def chat(self, system: str, user: str, max_tokens: int = 256) -> str:
        from mlx_lm import generate

        msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
        prompt = self.tok.apply_chat_template(msgs, add_generation_prompt=True)
        try:
            return generate(
                self.model, self.tok, prompt=prompt, max_tokens=max_tokens, verbose=False
            )
        except TypeError:
            return generate(self.model, self.tok, prompt, max_tokens=max_tokens, verbose=False)


_SPY_SYS = (
    "אתה רב מרגלים במשחק 'שם קוד' בעברית. אתה רואה את מילות הצוות שלך, מילות היריב, "
    "מילים ניטרליות, ומילת המתנקש שאסור בשום אופן לרמוז עליה. תן רמז של מילה אחת "
    "(לא אחת מהמילים על הלוח) שמקשרת כמה שיותר ממילות הצוות שלך, ורחוקה מהשאר ובמיוחד מהמתנקש."
)
_SPY_FMT = (
    "ענה בדיוק בפורמט הזה ובלי שום טקסט נוסף:\n"
    "רמז: <מילה אחת>\n"
    "מספר: <כמה מילים>\n"
    "מילים: <המילים מהצוות שלך שהרמז מתאר, מופרדות בפסיק>"
)


def llm_spymaster(llm: HebrewLLM, board: Board) -> Clue | None:
    def block(label, ws):
        return f"{label}: " + ", ".join(ws)

    user = (
        block("הצוות שלי", board.my)
        + "\n"
        + block("היריב", board.of("opp"))
        + "\n"
        + block("ניטרלי", board.of("neutral"))
        + "\n"
        + f"המתנקש (אסור!): {board.assassin}\n\n"
        + _SPY_FMT
    )
    txt = llm.chat(_SPY_SYS, user, max_tokens=120)
    clue = _grab(r"רמז:\s*([^\n,]+)", txt)
    cnt = _grab(r"מספר:\s*(\d+)", txt)
    words_line = _grab(r"מילים:\s*(.+)", txt)
    if not clue:
        return None
    clue = clue.strip().split()[0]
    if shares_lemma(clue, board):  # illegal: clue is a board word or a form of one
        return None
    intended = []
    if words_line:
        for tok in re.split(r"[,־\-/]| ו", words_line):
            w = _match_board(tok, board.my)
            if w and w not in intended:
                intended.append(w)
    return Clue(
        word=clue,
        count=int(cnt) if cnt else len(intended) or 2,
        intended=intended,
        margin=float("nan"),
    )


_PICK_SYS = (
    "אתה רב מרגלים במשחק 'שם קוד'. קיבלת רשימת רמזים מועמדים, כל אחד עם מילות הצוות שהוא מתאר. "
    "בחר את הרמז הטוב, הבטוח והטבעי ביותר — שמקשר כמה שיותר ממילות הצוות בלי לרמוז על המתנקש או על היריב. "
    "ענה בפורמט הזה בלבד:\nרמז: <המילה מהרשימה>\nמספר: <כמה מילים>\nסיבה: <משפט קצר אחד מדוע זה הרמז הטוב ביותר>"
)


def llm_pick_clue(llm: HebrewLLM, board: Board, candidates) -> Clue:
    """Hybrid spymaster: the LLM picks the best clue out of a geometry-vetted shortlist."""
    lines = "\n".join(
        f"{i + 1}. {c['word']}  →  {', '.join(c['intended'])}" for i, c in enumerate(candidates)
    )
    user = (
        f"הצוות שלי: {', '.join(board.my)}\nהמתנקש (אסור!): {board.assassin}\n\n"
        f"מועמדים:\n{lines}\n\nבחר רמז אחד מהרשימה."
    )
    txt = llm.chat(_PICK_SYS, user, max_tokens=120)
    word = _grab(r"רמז:\s*([^\n,]+)", txt)
    cnt = _grab(r"מספר:\s*(\d+)", txt)
    reason = _grab(r"סיבה:\s*(.+)", txt) or ""
    chosen = None
    if word:
        word = word.strip().split()[0]
        for c in candidates:
            if c["word"] == word or word in c["word"] or c["word"] in word:
                chosen = c
                break
    chosen = chosen or candidates[0]
    return Clue(
        word=chosen["word"],
        count=int(cnt) if cnt else chosen["count"],
        intended=chosen["intended"],
        margin=chosen.get("score", float("nan")),
        reason=reason,
    )


_GUESS_SYS = (
    "אתה שחקן במשחק 'שם קוד' בעברית. קיבלת רמז של מילה אחת ורשימת מילים על הלוח. "
    "דרג את כל מילות הלוח מהקשורה ביותר לרמז ועד הפחות קשורה."
)


def llm_guess_ranking(llm: HebrewLLM, board: Board, clue: str) -> list[str]:
    """Full ranking of the 25 board words by the LLM, given the clue."""
    user = (
        f"הרמז: {clue}\n"
        f"מילות הלוח: {', '.join(board.words)}\n\n"
        "החזר את כל מילות הלוח מסודרות מהקשורה ביותר לרמז עד הפחות קשורה, "
        "מופרדות בפסיק, בלי מספור ובלי טקסט נוסף."
    )
    txt = llm.chat(_GUESS_SYS, user, max_tokens=400)
    ranked, seen = [], set()
    for tok in re.split(r"[,\n־]| ו", txt):
        w = _match_board(tok, board.words)
        if w and w not in seen:
            ranked.append(w)
            seen.add(w)
    for w in board.words:  # append any the model dropped
        if w not in seen:
            ranked.append(w)
    return ranked


# --------------------------------------------------------------------------- #
# Legality (Codenames clue rules)
# --------------------------------------------------------------------------- #
# A clue is illegal iff it is a board word / an inflection of one (same lemma), OR it shares a
# root with a board word AND is semantically transparent to it (clue↔word cosine >= THETA).
# Root sharing is decided by the Wiktionary lexicon (morph.roots); words the lexicon does not
# cover fall back to the coarse root_sig heuristic. The cosine gate keeps opaque etymological
# cognates legal (מלחמה next to לחם) and neutralises both root_sig's false positives (אש/ראש)
# and lexicon homograph noise. Encoders return L2-normalised vectors, so a clue↔board dot
# product is exactly the cosine the gate needs; THETA was calibrated on fastText.

ROOT_TRANSPARENCY_THETA = 0.30


def forbidden_lemmas(board: Board, lemmas=None) -> set[str]:
    """The board words plus their lemmas — a clue equal to any of these is illegal. Pass
    precomputed `lemmas` (aligned with board.words) to avoid re-lemmatising the board."""
    lems = morph.lemmas(board.words) if lemmas is None else lemmas
    return set(board.words) | set(lems)


def _root_conflict(sig: str, board_sigs) -> bool:
    """Coarse shoresh-signature collision, used only as the fallback when the lexicon does not
    cover one of the words. Equal signatures always conflict; for roots of 3+ letters,
    containment in either direction also conflicts (כלב/כלבלב, ספר/ספרון). For 2-letter
    skeletons only exact equality counts, so short unrelated roots don't collide (אש vs ראש)."""
    if not sig:
        return False
    for bs in board_sigs:
        if sig == bs:
            return True
        if min(len(sig), len(bs)) >= 3 and (bs in sig or sig in bs):
            return True
    return False


def _board_root_signals(board: Board, lemmas=None):
    """Per board word, the pair (lexicon root set, root_sig fallback string). The root set
    unions the word's and its lemma's lexicon roots; the sig backs the OOV fallback compare.
    Pass precomputed `lemmas` (aligned with board.words) to avoid re-lemmatising the board."""
    lems = morph.lemmas(board.words) if lemmas is None else lemmas
    return [
        (morph.roots(w) | morph.roots(lem), morph.root_sig(lem))
        for w, lem in zip(board.words, lems, strict=False)
    ]


def _normalize_root(r: str) -> str:
    if len(r) == 3:
        if r[-1] in ("ה", "י", "ו"):
            return r[:-1]
        if r[-1] == r[-2]:
            return r[:-1]
    return r


def _shares_root(cand_roots, cand_sig, board_roots, board_sig) -> bool:
    """Shared-root test for one (clue, board word) pair: authoritative lexicon-set intersection
    when both sides are covered, else the coarse root_sig conflict.
    Weak/geminate roots are normalized to prevent false negatives from lexicographical mismatches."""
    if cand_roots and board_roots:
        cand_norm = {_normalize_root(r) for r in cand_roots}
        board_norm = {_normalize_root(r) for r in board_roots}
        return bool(cand_norm & board_norm)
    return _root_conflict(cand_sig, {board_sig} if len(board_sig) >= 2 else set())


def legal_vocab_mask(
    clue_vocab, vocab_lemmas, board, cos, theta: float = ROOT_TRANSPARENCY_THETA
) -> list[bool]:
    """Per-candidate legality over a whole clue vocabulary. `cos` is the (V, n_board) clue↔board
    cosine matrix (= C @ B.T for L2-normalised encoders). A candidate is illegal if it (or its
    lemma) is a board word/lemma, or if it shares a root with a board word it is transparent to
    (cosine >= theta). Root work runs only for candidates transparent to some board word."""
    board_lems = morph.lemmas(board.words)  # lemmatise the board once
    forbidden = forbidden_lemmas(board, board_lems)
    signals = _board_root_signals(board, board_lems)
    hotmask = cos >= theta  # (V, n_board) transparent pairs
    out = []
    for i, (c, clem) in enumerate(zip(clue_vocab, vocab_lemmas, strict=False)):
        if c in forbidden or clem in forbidden:
            out.append(False)
            continue
        hot = np.flatnonzero(hotmask[i])  # board words this clue is transparent to
        if hot.size == 0:
            out.append(True)
            continue
        crs = morph.roots(c) | morph.roots(clem)
        csig = morph.root_sig(clem)
        out.append(not any(_shares_root(crs, csig, *signals[j]) for j in hot))
    return out


_LEGAL_KEEP_CACHE: dict = {}  # (encoder, vocab size, board words) -> legal keep indices
_LEGAL_KEEP_CACHE_MAX = 64


def _legal_candidates(enc, board: Board, clue_vocab, clue_emb=None, vocab_lemmas=None):
    """Embed the vocab + board, drop illegal clues (composite root + cosine gate), and return
    (board_words, B, kept_candidates, keep_indices, C_kept). Encoders return L2-normalised
    vectors, so C @ B.T is the cosine used by both the legality gate and the scorer.

    Legality depends only on the board words (given a fixed vocab + encoder), so the kept-index
    set is cached per board — repeated risk/focus toggles on one board skip the lemma+mask pass."""
    bw = board.words
    Cfull = enc.embed(clue_vocab) if clue_emb is None else clue_emb
    B = enc.embed(bw)
    key = (getattr(enc, "model_id", ""), len(clue_vocab), tuple(bw))
    keep = _LEGAL_KEEP_CACHE.get(key)
    if keep is None:
        if vocab_lemmas is None:
            vocab_lemmas = morph.lemmas(clue_vocab)
        mask = legal_vocab_mask(clue_vocab, vocab_lemmas, board, Cfull @ B.T)
        keep = [i for i, k in enumerate(mask) if k]
        if len(_LEGAL_KEEP_CACHE) >= _LEGAL_KEEP_CACHE_MAX:
            _LEGAL_KEEP_CACHE.clear()
        _LEGAL_KEEP_CACHE[key] = keep
    cand = [clue_vocab[i] for i in keep]
    return bw, B, cand, keep, Cfull[keep]


def shares_lemma(clue: str, board: Board, enc=None, theta: float = ROOT_TRANSPARENCY_THETA) -> bool:
    """Single-clue legality (the coach 'is my clue legal?' check). Illegal if the clue/its lemma
    is a board word/lemma, or it shares a root with a board word it is transparent to. Without an
    encoder the transparency gate cannot run, so any shared root is treated as illegal (strict)."""
    board_lems = morph.lemmas(board.words)  # lemmatise the board once
    forbidden = forbidden_lemmas(board, board_lems)
    lem = morph.lemma(clue)
    if clue in forbidden or lem in forbidden:
        return True
    crs = morph.roots(clue) | morph.roots(lem)
    csig = morph.root_sig(lem)
    shared = [
        j
        for j, sig in enumerate(_board_root_signals(board, board_lems))
        if _shares_root(crs, csig, *sig)
    ]
    if not shared:
        return False
    if enc is None:
        return True
    cvec = enc.embed([clue])[0]
    return bool((enc.embed([board.words[j] for j in shared]) @ cvec >= theta).any())


_ROOT_SYS = (
    "אתה מומחה למורפולוגיה של העברית. ההכרעה מורפולוגית בלבד — לפי שורש משותף או צורה "
    "נטויה/נגזרת — ולא לפי קשר במשמעות. רמז פסול רק אם יש לו אותו שורש כמו מילת לוח, או שהוא "
    "נטייה/נגזרת שלה. דוגמאות לפסול: 'תוכנית' ליד 'תוכנה', 'ספרייה' ליד 'ספר', 'רכב' ליד 'רכבת', "
    "'כלבה' ליד 'כלב'. "
    "דוגמאות לתקין (קשר משמעות בלבד, שורש שונה): 'אורות' ליד 'אש', 'עיתון' ליד 'ספר'. "
    "החזר אך ורק את מספרי המועמדים הפסולים מופרדים בפסיק, או את המילה 'אין' אם כולם תקינים."
)


def llm_root_conflicts(llm: HebrewLLM, candidate_words, board_words) -> set[str]:
    """Shoresh/derivative gate: ask the Hebrew LLM which candidates share a root with a
    board word — real morphological knowledge for the case lemma equality cannot catch."""
    cw = list(candidate_words)
    if not cw:
        return set()
    lines = "\n".join(f"{i + 1}. {w}" for i, w in enumerate(cw))
    user = f"מילות הלוח: {', '.join(board_words)}\n\nמועמדים:\n{lines}\n\nאילו מועמדים פסולים?"
    txt = llm.chat(_ROOT_SYS, user, max_tokens=80)
    bad = set()
    for m in re.findall(r"\d+", txt):
        i = int(m) - 1
        if 0 <= i < len(cw):
            bad.add(cw[i])
    return bad


# --------------------------------------------------------------------------- #
# Parsing helpers
# --------------------------------------------------------------------------- #


def _grab(pat: str, text: str):
    m = re.search(pat, text)
    return m.group(1).strip() if m else None


def _match_board(token: str, candidates: list[str]):
    """Map a noisy LLM token to a board word: exact, then substring either way."""
    t = re.sub(r"[^֐-׿]", "", token).strip()
    if not t:
        return None
    if t in candidates:
        return t
    for c in candidates:
        if t == c.replace(" ", ""):
            return c
    for c in candidates:
        if (t in c) or (c in t):
            return c
    return None


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #


def spearman(order_a: list[str], order_b: list[str]) -> float:
    """Spearman rho between two orderings of the same item set."""
    from scipy.stats import spearmanr

    rank_a = {w: i for i, w in enumerate(order_a)}
    rank_b = {w: i for i, w in enumerate(order_b)}
    items = list(order_a)
    rho, _ = spearmanr([rank_a[w] for w in items], [rank_b[w] for w in items])
    return float(rho)


def recovery_at_k(order: list[str], intended: list[str], k: int) -> float:
    if not intended:
        return float("nan")
    return len(set(order[:k]) & set(intended)) / len(intended)
