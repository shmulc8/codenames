"""Local server for the Hebrew Codenames AI co-pilot.

The co-pilot (served at `/`) is the product: a human plays either seat and the
assistant coaches it — best clue when you're רב המרגלים, best guesses when you're
the מנחש — and *shows its reasoning* (the geometry shortlist, which candidate
DictaLM picked and why, the operative-eye reading of the clue, danger flags).

    .venv/bin/python app.py                      # http://127.0.0.1:7860

The bot-vs-bot research game is still reachable at `/game`.

Default engine is **geometry** — pure fastText embeddings + DictaBERT legality, no
generative LLM in the loop (lighter, instant, fully offline). The clue word comes from
a broad noun/adjective/proper-noun frequency band of the vocabulary, and the rationale is derived from
the geometry itself. DictaLM is optional (engines `hybrid`/`llm`) and loads lazily only
when selected. Encoders and the clue vocabulary load lazily on first use.
"""

import os

# Force the hub online: feedback persistence (the CommitScheduler) pushes via huggingface_hub,
# which HF_HUB_OFFLINE=1 would gag. Models never need the hub at runtime — they load from the
# local cache (local_files_only=True in morph), so nothing here reaches out except feedback.
os.environ["HF_HUB_OFFLINE"] = "0"
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import collections
import hashlib
import json
import random
import re
import shutil
import threading
import time
import unicodedata

import numpy as np
from flask import Flask, abort, jsonify, request, send_file, send_from_directory

from . import PROJECT_ROOT, morph, probe

app = Flask(__name__)
# Every API body is a board (<= 25 short words) plus a few scalars; feedback adds one clue option.
# Anything bigger is rejected (413) before it is parsed.
app.config["MAX_CONTENT_LENGTH"] = 64 * 1024

# Public deploy: embedding-only. No generative LLM is offered (the geometry engine
# is fastText + DictaBERT legality + a NeoDictaBERT second opinion). When set, the
# server ignores any llm/hybrid engine a request might ask for and never advertises
# DictaLM models, so a direct API call can't trip the (uninstalled) LLM path.
EMBED_ONLY = os.environ.get("EMBED_ONLY", "").lower() in ("1", "true", "yes")
# The cross-encoder "second opinion" (NeoDictaBERT) is optional; the lean public deploy
# drops it (SECOND_OPINION=0) so the image needs only fastText + DictaBERT-lex.
SECOND_OPINION = os.environ.get("SECOND_OPINION", "1").lower() not in ("0", "false", "no")

# How daring the spymaster is. Risk = two knobs: how many team words to reach for (m) and
# how hard to avoid enemy/neutral/assassin words (lam_*). Cautious only plays rock-solid
# clues (and refuses more); bold reaches for more words and tolerates a tighter enemy.
RISK_PROFILES = {
    # Scoring weights (m, lam_*, safe_margin) validated on the real serve_clue path — bench_clue.py
    # plus a neutral LLM-guesser eval. balanced and cautious share conservative coverage (m=2,
    # safe_margin=0.05); together with the listener-danger term below this keeps the claimed words to
    # what a strong human-proxy guesser recovers and best avoids the assassin. They differ only in
    # enemy avoidance (cautious uses higher lam_*); bold reaches furthest (m=4). The count-trim `keep`
    # (keep_rel) claims a team word only when its similarity is >= keep · the top target's; keep
    # ordering stays cautious >= balanced >= bold.
    "cautious": dict(m=2, lam_a=3.0, lam_opp=1.3, lam_neu=0.7, keep=0.68, safe_margin=0.05),
    "balanced": dict(m=2, lam_a=2.5, lam_opp=0.9, lam_neu=0.6, keep=0.68, safe_margin=0.05),
    "bold": dict(m=4, lam_a=1.8, lam_opp=0.7, lam_neu=0.4, keep=0.62, safe_margin=0.0),
}
_CAND_KEYS = ("m", "lam_a", "lam_opp", "lam_neu", "safe_margin")
LAM_F = 0.14  # weight on the mid-frequency (DETECT-FREQ) prior in candidate scoring
# Listener-competition (RSA-style) danger term: penalise clues by the softmax share a literal
# guesser would put on the assassin/opponent words (see probe._listener_danger). One global pair
# across risk profiles; SOFT_TAU is the softmax temperature. LAM_SOFT=0 restores hinge-only scoring.
LAM_SOFT = 1.0
SOFT_TAU = 0.10
# Shortlist diversity (MMR): when picking the browsable options, penalise a candidate by how much
# its target set overlaps ones already chosen, so a tight board pair (e.g. חולצה/מכנסיים) can't fill
# the whole shortlist with near-duplicate clues. 0 restores plain top-n-by-score.
LAM_DIV = 0.5

# Cohesion: a counted word must cohere (cosine >= COH_FLOOR) with the cluster's *head* (strongest)
# word, not merely with the clue — so the number reflects a real cluster, not passengers riding
# along on a clue↔word similarity (radio→milk), nor a noise pair chaining to each other
# (food→{beauty,freedom}). Tuned by a production-path sweep (shortlist + 1-word-demoting ordering)
# over fresh boards + the feedback set: floor 0.20 + head mode sheds noise tails while keeping the
# 👍 clusters (ירך·3, עדכון·2), ~doubling guesser safety and holding 1-word clues to ~2%. Head mode
# (vs link-to-any) additionally kills noise sub-clusters — e.g. מחשב riding into sports via שחמט.
COH_FLOOR, COH_MODE = 0.20, "head"

# Optional, fail-soft feedback: 👍/👎 on clues. Rows are appended locally and, if a dataset +
# token are configured, mirrored to a private HF Dataset on a schedule. Nothing here can take
# the co-pilot down — every step is wrapped and the app serves regardless.
FEEDBACK_DIR = os.environ.get("FEEDBACK_DIR", "feedback")
FEEDBACK_DATASET = os.environ.get("FEEDBACK_DATASET")  # e.g. "shmulc/codenames-feedback"
_FB_SALT = os.environ.get(
    "FEEDBACK_SALT", "cn-feedback-v1"
)  # salts the IP hash (coarse anti-evasion signal, never the raw IP)
_fb_lock = threading.Lock()
_fb_scheduler = None


def _init_feedback():
    """Start a CommitScheduler that mirrors the local feedback log to a private HF Dataset.
    Best-effort: any failure leaves feedback as local-only and the app unaffected."""
    global _fb_scheduler
    os.makedirs(FEEDBACK_DIR, exist_ok=True)
    if FEEDBACK_DATASET and os.environ.get("HF_TOKEN"):
        # Space storage is ephemeral: seed the local log from the dataset on boot so the
        # scheduler re-commits the full history instead of overwriting it with only new rows.
        local_fb = os.path.join(FEEDBACK_DIR, "feedback.jsonl")
        if not os.path.exists(local_fb):
            try:
                from huggingface_hub import hf_hub_download

                src = hf_hub_download(
                    FEEDBACK_DATASET,
                    "data/feedback.jsonl",
                    repo_type="dataset",
                    token=os.environ["HF_TOKEN"],
                )
                shutil.copyfile(src, local_fb)
                app.logger.info("seeded local feedback log from dataset")
            except Exception:
                app.logger.info("no existing feedback in dataset to seed — starting fresh")
        try:
            from huggingface_hub import CommitScheduler

            _fb_scheduler = CommitScheduler(
                repo_id=FEEDBACK_DATASET,
                repo_type="dataset",
                folder_path=FEEDBACK_DIR,
                path_in_repo="data",
                every=1,
                private=True,
                token=os.environ["HF_TOKEN"],
                squash_history=True,
            )
            app.logger.info("feedback mirrored to dataset %s", FEEDBACK_DATASET)
        except Exception:
            app.logger.exception("feedback scheduler init failed — logging locally only")


@app.errorhandler(Exception)
def on_error(e):
    """Every error is JSON `{error}` so the UI can show it instead of parsing an HTML page.
    HTTP errors (400 validation, 404, 405, 413, 429) keep their status and message; anything
    else is logged with its traceback and answered as a generic 500."""
    from werkzeug.exceptions import HTTPException

    if isinstance(e, HTTPException):
        if e.code == 413:
            return jsonify(error="הבקשה גדולה מדי"), 413
        return jsonify(error=e.description or e.name), e.code
    app.logger.exception("request failed")
    return jsonify(error="שגיאת שרת"), 500


@app.get("/favicon.ico")
def favicon():
    return ("", 204)


MODELS = [
    {"id": probe.LLM_FAST, "label": "1.7B (מהיר)"},
    {"id": probe.LLM_BIG, "label": "12B (איכותי)"},
]
ENCODER_KEYS = list(probe.ENCODERS.keys())
GEO_ENC = "blend_0.7_0.3"  # Concatenated L2-normalized fastText + Numberbatch blend
XENC = "neodictabert"  # cross-engine second opinion for the operative (no LLM)

_llms: dict = {}
_encs: dict = {}
_clue_vocab: dict[str, list[str]] = {}
_clue_freq: dict[str, np.ndarray] = {}
_clue_lemmas: dict[str, list[str]] = {}
_clue_roots: dict[str, list[set[str]]] = {}  # mode -> per-word lexicon roots (word ∪ lemma)
_clue_emb: dict[str, dict[str, np.ndarray]] = {}  # mode -> encoder -> embedding
_assets_lock = threading.Lock()  # one loader at a time: concurrent first requests share the result

# Clue-vocabulary modes. The UI offers curated (default) and conservative; both are warmed at
# startup. broad/experimental stay reachable for research and load lazily on first use.
VOCAB_MODES = ("curated", "conservative", "broad", "experimental")
ADVERTISED_VOCAB_MODES = ("curated", "conservative")
DEFAULT_VOCAB_MODE = "curated"

_ambiguity_lexicon = None

_DEFAULT_AMBIGUITY = {
    "עלה": {"ambiguity": 0.95, "senses": ["leaf", "rose/ascended"]},
    "פרח": {"ambiguity": 0.95, "senses": ["flower", "flourished/youth"]},
}


def get_llm(mid):
    mid = mid or probe.LLM_FAST
    if mid not in (
        probe.LLM_FAST,
        probe.LLM_BIG,
    ):  # never hand an arbitrary client string to mlx_lm.load
        abort(400, f"unknown model {mid!r}")
    if mid not in _llms:
        app.logger.info("loading LLM %s ...", mid)
        _llms[mid] = probe.HebrewLLM(mid)
    return _llms[mid]


def get_enc(key):
    if key not in _encs:
        with _assets_lock:
            if key not in _encs:
                app.logger.info("loading encoder %s ...", key)
                _encs[key] = probe.make_encoder(key)
    return _encs[key]


def _load_ambiguity_lexicon():
    """Load static ambiguity warnings; never call an external model while serving."""
    global _ambiguity_lexicon
    if _ambiguity_lexicon is None:
        path = os.path.join(probe.DATA, "ambiguity_he_openai.json")
        try:
            with open(path, encoding="utf-8") as f:
                document = json.load(f)
            _ambiguity_lexicon = dict(_DEFAULT_AMBIGUITY)
            if isinstance(document, dict):
                _ambiguity_lexicon.update(document.get("entries", {}))
            curated_path = os.path.join(probe.DATA, "clue_vocab_openai.json")
            if os.path.exists(curated_path):
                with open(curated_path, encoding="utf-8") as f:
                    curated = json.load(f)
                for word, meta in curated.get("entries", {}).items():
                    flags = meta.get("flags", [])
                    if "ambiguous" in flags or "translation_sensitive" in flags:
                        _ambiguity_lexicon[word] = {
                            "ambiguity": float(meta.get("ambiguity") or 0.7),
                            "senses": [],
                            "flags": flags,
                        }
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            _ambiguity_lexicon = dict(_DEFAULT_AMBIGUITY)
    return _ambiguity_lexicon


def _malformed_curated(word: str) -> bool:
    """probe.is_malformed for the curated list (drops truncated tokens such as ארצ, מיצ, מהתנ),
    except that a loanword of 4+ letters may end in a non-final פ, as Hebrew spells them
    (סירופ, קטשופ, טלסקופ, טראמפ). Short ones (סופ, קופ) are usually truncations and stay out."""
    if len(word) >= 4 and word.endswith("פ"):
        return probe.is_malformed(word[:-1] + "ף")
    return probe.is_malformed(word)


def geo_assets(mode: str = DEFAULT_VOCAB_MODE):
    """(vocab, embedding, lemmas, freq_scores) for the geometry spymaster — a mid-frequency
    noun/adjective/etc. band of the clue vocabulary, embedded and FREQ-scored once. The vocab is
    lemmatised so legality catches prefixed forms (e.g. בסיר → סיר) that share a board lemma."""
    if mode in _clue_emb and GEO_ENC in _clue_emb[mode]:
        return _clue_vocab[mode], _clue_emb[mode][GEO_ENC], _clue_lemmas[mode], _clue_freq[mode]
    enc = get_enc(GEO_ENC)
    with _assets_lock:
        return _load_geo_assets(mode, enc)


def _load_geo_assets(mode: str, enc):
    if mode not in _clue_vocab:
        # Load filtered vocab according to the mode
        if mode == "curated":
            curated_vocab = os.path.join(probe.DATA, "clue_vocab_openai.json")
            if os.path.exists(curated_vocab):
                with open(curated_vocab, encoding="utf-8") as f:
                    saved = json.load(f)
                block = probe.load_blocklist()
                rows = [
                    [word, meta["count"], meta["pos"]]
                    for word, meta in saved["entries"].items()
                    if word not in block and not _malformed_curated(word)
                ]
                vocab = [row[0] for row in rows]
                counts = np.asarray([row[1] for row in rows], dtype=np.float32)
                freq = probe.freq_scores(counts, lo=500, hi=50000)
            else:
                # Fallback to broad if curated file is missing
                vocab, counts = probe.clue_vocab_band(20000, mode="broad")
                freq = probe.freq_scores(counts, lo=500, hi=50000)
        else:
            vocab, counts = probe.clue_vocab_band(20000, mode=mode)

            # Calculate freq scores using adjusted floors for the mode
            if mode == "conservative":
                freq = probe.freq_scores(counts, lo=1500, hi=40000)
            elif mode == "broad":
                freq = probe.freq_scores(counts, lo=500, hi=50000)
            elif mode == "experimental":
                freq = probe.freq_scores(counts, lo=200, hi=75000)
            else:
                freq = probe.freq_scores(counts, lo=1000, hi=80000)

        morph.lemmas(vocab)  # one batched pass fills the lemma memo the root lookup falls back on
        _clue_lemmas[mode] = list(vocab)
        _clue_roots[mode] = probe.vocab_root_sets(vocab, _clue_lemmas[mode])
        _clue_freq[mode] = freq
        _clue_vocab[mode] = vocab

        app.logger.info("clue vocab mode %s: %d words", mode, len(vocab))

    if GEO_ENC not in _clue_emb.get(mode, {}):
        _clue_emb.setdefault(mode, {})[GEO_ENC] = enc.embed(_clue_vocab[mode])

    return _clue_vocab[mode], _clue_emb[mode][GEO_ENC], _clue_lemmas[mode], _clue_freq[mode]


def _geo_reason(intended, board: probe.Board, read) -> str:
    """A rationale derived from the geometry itself (no LLM): what the clue connects and
    the nearest non-team word it risks."""
    conn = " · ".join(intended) if intended else "—"
    danger = next((r["word"] for r in read if r["role"] != "my"), None)
    txt = f"הכי קרוב למילים {conn}"
    if board.assassin:
        txt += f", ומרוחק מהמתנקש ({board.assassin})"
    if danger:
        txt += f". הסכנה הקרובה ביותר: {danger}"
    return txt


_VALID_ROLES = {"my", "opp", "neutral", "assassin"}

# --------------------------------------------------------------------------- #
# Request validation — every malformed body is a 400 with a JSON {error}, never a 500.
# --------------------------------------------------------------------------- #

MAX_BOARD = probe.N_BOARD  # 25 cards
MAX_WORD_LEN = 32  # a card is a word or a short phrase
MAX_CLUE_LEN = 24
MAX_COUNT = 9

# A clue is exactly one Hebrew word: letters (final forms included), optionally with a geresh
# (׳ or ASCII ') or gershayim (״ or ASCII ") inside or at the end — ג'ירפה, צה"ל, צ'יפס. Niqqud
# is stripped first. Spaces, maqaf/hyphen (two joined words), digits and Latin letters are
# rejected.
_NIQQUD = re.compile(r"[\u0591-\u05BD\u05BF-\u05C2\u05C4-\u05C7]")  # niqqud/te'amim, not maqaf
_CLUE_RE = re.compile(r"[א-ת](?:[א-ת]|['\u05F3\"\u05F4](?=[א-ת]|$))*")


def _body() -> dict:
    j = request.get_json(silent=True)
    if not isinstance(j, dict):
        abort(400, "גוף הבקשה חייב להיות אובייקט JSON")
    return j


def _clean_word(w) -> str:
    if not isinstance(w, str):
        abort(400, "כל מילה בלוח חייבת להיות מחרוזת")
    w = " ".join(unicodedata.normalize("NFC", w).split())
    if not w:
        abort(400, "מילה ריקה בלוח")
    if len(w) > MAX_WORD_LEN:
        abort(400, f"מילה ארוכה מדי בלוח (עד {MAX_WORD_LEN} תווים)")
    return w


def _str_list(v, name: str, limit: int = MAX_BOARD) -> list[str]:
    if v is None:
        return []
    if not isinstance(v, list) or len(v) > limit:
        abort(400, f"'{name}' חייב להיות רשימה של עד {limit} מילים")
    out = []
    for x in v:
        if isinstance(x, dict):  # the UI's revealed entries are {word, chosenBy}
            x = x.get("word")
        out.append(_clean_word(x))
    return out


def board_from(j) -> probe.Board:
    """Validate and normalise the board of a coach request: `words` is a list of 1–25 unique,
    non-empty strings; `roles` maps every word to my/opp/neutral/assassin (extra keys are
    ignored); at most one assassin. Cards listed in `revealed` are removed server-side, so a
    caller may send the full board and its revealed cards instead of only the live ones."""
    raw = j.get("words")
    if not isinstance(raw, list) or not raw:
        abort(400, "הלוח ריק — 'words' חייב להיות רשימה לא ריקה")
    if len(raw) > MAX_BOARD:
        abort(400, f"יותר מדי מילים בלוח (עד {MAX_BOARD})")
    roles = j.get("roles")
    if not isinstance(roles, dict):
        abort(400, "'roles' חייב להיות מיפוי מילה → תפקיד")
    norm_roles = {}
    for k, v in roles.items():
        if isinstance(k, str):
            norm_roles[" ".join(unicodedata.normalize("NFC", k).split())] = v
    words = [_clean_word(w) for w in raw]
    if len(set(words)) != len(words):
        dup = next(w for w in words if words.count(w) > 1)
        abort(400, f"המילה '{dup}' מופיעה בלוח יותר מפעם אחת")
    revealed = set(_str_list(j.get("revealed"), "revealed"))
    unknown = revealed - set(words)
    if unknown:
        abort(400, f"מילה שנחשפה אינה על הלוח: {sorted(unknown)[0]}")
    words = [w for w in words if w not in revealed]
    if not words:
        abort(400, "לא נשארו מילים חיות בלוח")
    role = {}
    for w in words:
        r = norm_roles.get(w)
        if r not in _VALID_ROLES:  # a missing/typo'd role must not silently hide a word
            abort(400, f"תפקיד חסר או לא חוקי למילה '{w}'")
        role[w] = r
    if sum(r == "assassin" for r in role.values()) > 1:
        abort(400, "בלוח יכול להיות מתנקש אחד לכל היותר")
    return probe.Board(words=words, role=role)


def clue_from(j) -> str:
    """The single-word clue of a check/operative request (see _CLUE_RE for the policy)."""
    c = j.get("clue")
    if not isinstance(c, str):
        abort(400, "חסר רמז ('clue')")
    c = _NIQQUD.sub("", unicodedata.normalize("NFC", c)).strip()
    if not c:
        abort(400, "הרמז ריק")
    if len(c) > MAX_CLUE_LEN:
        abort(400, f"הרמז ארוך מדי (עד {MAX_CLUE_LEN} תווים)")
    if not _CLUE_RE.fullmatch(c):
        abort(400, "הרמז חייב להיות מילה אחת בעברית (בלי רווחים, מקפים, ספרות או אותיות לועזיות)")
    return c


def count_from(j) -> int:
    c = j.get("count", 1)
    if c is None:
        return 1
    if isinstance(c, bool) or not isinstance(c, int) or not 1 <= c <= MAX_COUNT:
        abort(400, f"'count' חייב להיות מספר שלם בין 1 ל-{MAX_COUNT}")
    return c


def vocab_mode_from(j) -> str:
    m = j.get("vocab_mode")
    if m is None:  # legacy alias; ignored unless it names a vocab mode
        m = j.get("mode") if j.get("mode") in VOCAB_MODES else DEFAULT_VOCAB_MODE
    if m not in VOCAB_MODES:
        abort(400, f"vocab_mode לא מוכר: {m!r}")
    return m


def risk_from(j) -> str:
    r = j.get("risk") or "balanced"
    if r not in RISK_PROFILES:
        abort(400, f"risk לא מוכר: {r!r}")
    return r


def _conf(sims: dict) -> dict:
    """Min-max normalise a {word: cosine} map to a 0..1 confidence for bars."""
    vals = list(sims.values())
    lo, hi = min(vals), max(vals)
    span = (hi - lo) or 1.0
    return {w: (s - lo) / span for w, s in sims.items()}


def _read_clue(board: probe.Board, clue: str):
    """How the geometry reads a clue over the 25 board words: ordered words with
    role + cosine + confidence. The operative-eye view that powers the danger panel."""
    order, sims = probe.encoder_rank(get_enc(GEO_ENC), board, clue)
    conf = _conf(sims)
    return [
        {
            "word": w,
            "role": board.role.get(w, "neutral"),
            "sim": round(sims[w], 4),
            "conf": round(conf[w], 4),
        }
        for w in order
    ]


def _whiten_abtt(X: np.ndarray, k: int = 3) -> np.ndarray:
    """All-but-the-top (Mu & Viswanath 2018): mean-center, remove the top-k principal
    directions, re-normalise. On fastText the leading components track a frequency/length
    cone shared by all words; stripping them lets the map show *semantic* spread instead
    (see project memory: latent-space-anisotropy-whitening)."""
    mu = X.mean(0, keepdims=True)
    Xc = X - mu
    k = min(k, min(Xc.shape) - 1)
    if k > 0:
        _, _, Vt = np.linalg.svd(Xc, full_matrices=False)
        comps = Vt[:k]  # (k, d) leading directions
        Xc = Xc - (Xc @ comps.T) @ comps  # project them out
    Xc /= np.linalg.norm(Xc, axis=1, keepdims=True) + 1e-9
    return Xc


def _classical_mds(D: np.ndarray, dim: int = 2) -> np.ndarray:
    """Classical (Torgerson) MDS in pure numpy: double-centre the squared-distance matrix
    B = -0.5 · J·D²·J and take the top-`dim` eigenvectors scaled by √eigenvalue."""
    n = D.shape[0]
    J = np.eye(n) - np.ones((n, n)) / n
    B = -0.5 * J @ (D**2) @ J
    w, V = np.linalg.eigh((B + B.T) / 2)  # symmetric → real eigenpairs
    idx = np.argsort(-w)[:dim]
    L = np.sqrt(np.clip(w[idx], 0.0, None))
    return V[:, idx] * L


# --------------------------------------------------------------------------- #
# Pages
# --------------------------------------------------------------------------- #

# Served assets live at the project root (see codenames/__init__.py), alongside data/ — the
# webapp build and the static HTML — resolved absolutely so serving is cwd-independent.
WEBAPP = os.path.join(PROJECT_ROOT, "webapp")
_COPILOT_HTML = os.path.join(PROJECT_ROOT, "copilot.html")
_METHODS_HTML = os.path.join(PROJECT_ROOT, "methods.html")
_GAME_HTML = os.path.join(PROJECT_ROOT, "codenames_latent_space.html")


@app.get("/")
def index():
    spa = os.path.join(WEBAPP, "index.html")
    return send_file(spa) if os.path.exists(spa) else send_file(_COPILOT_HTML)


@app.get("/assets/<path:asset>")
def spa_assets(asset):
    return send_from_directory(os.path.join(WEBAPP, "assets"), asset)


@app.get("/classic")
def classic():
    return send_file(_COPILOT_HTML)


@app.get("/methods")
@app.get("/methods.html")
def methods():
    return send_file(_METHODS_HTML)


@app.get("/game")
def game():
    if not os.path.exists(_GAME_HTML):
        return ("הדף הזה אינו זמין בגרסה הציבורית.", 404)
    return send_file(_GAME_HTML)


@app.get("/api/health")
def health():
    return jsonify(
        ok=True, models=([] if EMBED_ONLY else MODELS), encoders=ENCODER_KEYS, geo=GEO_ENC
    )


@app.get("/api/deal")
def deal():
    b = probe.sample_board(random.Random())
    return jsonify(words=b.words, roles=b.role)


@app.post("/api/space")
def space():
    """2D latent-space coordinates for the board (+ optional clue) — the picture behind the
    method: a good clue lands at the centre of your words and far from the rest.

    Embeds words and clue together with the geometry encoder (fastText), optionally strips the
    dominant frequency/length cone with all-but-top-k whitening, then projects the cosine-distance
    matrix to 2D with classical MDS (numpy only). Read-only; no engine state touched."""
    j = _body()
    board = board_from(j)
    clue = clue_from(j) if j.get("clue") not in (None, "") else None
    whiten = j.get("whiten", True)
    if not isinstance(whiten, bool):
        abort(400, "'whiten' חייב להיות true/false")

    points = list(board.words) + ([clue] if clue else [])  # <= 26 points (board_from caps at 25)
    if len(points) == 1:  # a single live card: nothing to project, put it at the centre
        return jsonify(
            coords={board.words[0]: [0.0, 0.0]}, roles=board.role, clue=None, clue_xy=None
        )
    X = get_enc(GEO_ENC).embed(points)
    # ABTT removes k=min(3, n-1) principal directions; on <= 4 points that is every centred
    # direction and the map collapses, so small late-game boards are projected unwhitened.
    if whiten and len(points) > 4:
        X = _whiten_abtt(X, k=3)
    sims = np.clip(X @ X.T, -1.0, 1.0)
    D = 1.0 - sims  # cosine distance
    Y = _classical_mds(D, dim=2)

    # normalise into a tidy [-1, 1] box so the client can scale to any canvas.
    # scale by a high percentile (not the max) so a couple of far outliers don't crush the
    # whole cloud into a tiny central blob; the few points beyond are clipped to the edge.
    scale = float(np.percentile(np.abs(Y), 90)) or float(np.abs(Y).max()) or 1.0
    Y = np.clip(Y / scale, -1.0, 1.0)
    coords = {
        w: [round(float(Y[i, 0]), 4), round(float(Y[i, 1]), 4)] for i, w in enumerate(board.words)
    }
    clue_xy = [round(float(Y[-1, 0]), 4), round(float(Y[-1, 1]), 4)] if clue else None
    return jsonify(coords=coords, roles=board.role, clue=clue, clue_xy=clue_xy)


# --------------------------------------------------------------------------- #
# Co-pilot
# --------------------------------------------------------------------------- #


def _analyze_clue(
    board: probe.Board,
    word: str,
    targets,
    count,
    score,
    focus,
    reason: str = "",
    keep_rel: float = 0.66,
    max_count: int | None = None,
) -> dict:
    """Full operative-eye analysis of one candidate clue: how the board reads, the *safe run*
    (team words a guesser reaches before any enemy), what it leaks, assassin proximity, a
    geometry rationale, and an honest no-clue verdict. Each entry in the spymaster `options`
    carries this so the UI can browse alternatives instantly without another round-trip.

    `targets` are the words the candidate was optimised for (focus / best-m); leak & risk are
    judged against them. The *recommended* number and the lit-up words, though, are the full
    safe run, capped by `max_count` when a risk profile sets a maximum claim.

    With `focus` (the user picked the cards to connect) only focused cards are ever claimed: the
    lit-up words are the focused cards inside the safe run — no other team card is substituted —
    and `focus_missing` lists the focused cards this clue can't reach safely."""
    read = _read_clue(board, word)
    target_sims = [r["sim"] for r in read if r["word"] in targets]
    floor = min(target_sims) if target_sims else -1.0
    leak = [r for r in read if r["role"] != "my" and r["sim"] >= floor]
    aw = board.assassin
    arank = next((i for i, r in enumerate(read) if r["word"] == aw), -1)
    asim = next((r["sim"] for r in read if r["word"] == aw), None)
    # safe run = the team words the guesser reaches before any non-team word
    safe_words = []
    for r in read:
        if r["role"] == "my":
            safe_words.append(r["word"])
        else:
            break
    safe = len(safe_words)

    ROLE_HE = {"opp": "של היריב", "neutral": "ניטרלי", "assassin": "המתנקש"}
    # Honest verdict: refuse outright (no_clue) when nothing safe connects the team, or
    # flag a clue as risky (leaky) when an enemy word ranks among/above your targets.
    no_clue, risky, note = False, False, ""
    ambiguity = _load_ambiguity_lexicon().get(word, {})
    ambiguity_score = float(ambiguity.get("ambiguity", 0.0) or 0.0)
    ambiguity_warning = ambiguity_score >= 0.7
    if ambiguity_warning:
        risky = True
        senses = ", ".join(str(s) for s in ambiguity.get("senses", [])[:3])
        flags = ", ".join(str(s) for s in ambiguity.get("flags", [])[:3])
        detail = senses or flags or "multiple plausible readings"
        note = f"⚠ רמז דו־משמעי/תלוי־תרגום: {word} — {detail}"
    if read and read[0]["role"] != "my":
        no_clue = True
        note = f"המילה הכי קרובה לרמז היא '{read[0]['word']}' — לא שלך. אין מילה שמקשרת את הצוות שלך בלי לסכן מילה זרה."
    elif asim is not None and asim >= floor:
        no_clue = True
        note = f"כל רמז שמקרב את המילים שלך מקרב גם את המתנקש ({aw}). מסוכן מדי."
    elif leak:
        risky = True
        e = leak[0]
        note = (
            f"⚠ זהירות: '{e['word']}' ({ROLE_HE.get(e['role'], 'זרה')}) קרובה לרמז כמעט "
            f"כמו המילים שלך — מנחש עלול לבחור בה. בטוח ל-{safe} בלבד."
        )

    focusset = set(focus or [])
    disp_intended = []
    if not no_clue and focus:
        disp_intended = [w for w in safe_words if w in focusset]
    elif not no_clue:
        encoder = get_enc(GEO_ENC)
        cliff_factor = 0.4 if getattr(encoder, "model_id", "").startswith("blend_") else 0.5
        coh_floor = 0.15 if getattr(encoder, "model_id", "").startswith("blend_") else COH_FLOOR
        disp_intended = probe.served_count(
            read,
            keep_rel=keep_rel,
            pin=focusset,
            enc=encoder,
            cohesion_floor=coh_floor,
            cohesion_mode=COH_MODE,
            cliff=cliff_factor,
        )
        if max_count is not None:
            disp_intended = disp_intended[:max_count]
    disp_count = len(disp_intended)
    focus_missing = [w for w in (focus or []) if w not in disp_intended]
    if focus and not no_clue:
        if not disp_intended:
            no_clue = True
            note = "אף אחת מהמילים שבחרת לא בטוחה עם הרמז הזה — מילה זרה קרובה אליו יותר."
        elif focus_missing:
            note = (
                "אין רמז שמחבר בבטחה את כל המילים שבחרת. הרמז הזה בטוח רק ל־"
                f"{' · '.join(disp_intended)}; את {' · '.join(focus_missing)} כדאי לתת בתור אחר."
            )
    elif disp_count == 1 and not no_clue and not note:
        note = "רמז למילה אחת בלבד — לא נמצא רמז בטוח שמחבר שתיים או יותר ממילות הצוות."
    reason = reason or _geo_reason(disp_intended or targets, board, read)
    return {
        "word": word,
        "count": disp_count,
        "intended": disp_intended,
        "score": score,
        "reason": reason,
        "read": read,
        "leak": leak,
        "safe": safe,
        "assassin": {"word": aw, "rank": arank, "sim": asim},
        "ambiguity": {
            "score": ambiguity_score,
            "senses": ambiguity.get("senses", []),
            "flags": ambiguity.get("flags", []),
        },
        "no_clue": no_clue,
        "risky": risky,
        "note": note,
        **({"focus_missing": focus_missing} if focus else {}),
    }


def _risk_order(options: list[dict], risk: str) -> list[int]:
    """Order analyzed geometry options by the risk *policy* (not just the scoring weight):
    refuse-clues always sink last; a single-word clue is a last resort, so any multi-word clue
    outranks it; bold then maximises coverage (count) then safety; cautious and balanced put
    safety first, then coverage. Returns option indices best-first."""

    def single(i: int) -> int:
        return 1 if options[i]["count"] <= 1 else 0

    def key(i: int):
        if risk == "bold":
            # bold maximises coverage (count) then safety
            return (
                1 if options[i]["no_clue"] else 0,
                single(i),
                -options[i]["count"],
                -options[i]["safe"],
                -options[i]["score"],
            )
        # cautious/balanced put safety first, then coverage
        return (
            1 if options[i]["no_clue"] else 0,
            single(i),
            1 if options[i]["risky"] else 0,
            -options[i]["safe"],
            -options[i]["count"],
            -options[i]["score"],
        )

    return sorted(range(len(options)), key=key)


def serve_clue(
    board: probe.Board,
    risk: str = "balanced",
    focus=None,
    profile=None,
    vocab_mode: str = DEFAULT_VOCAB_MODE,
):
    """The geometry engine's clue options for a board, ordered exactly as
    /api/coach/spymaster serves them (best first). Pure — no request context — so the
    endpoint, the benchmarks, and tests all measure the identical served clue.
    `profile` overrides RISK_PROFILES[risk] (for tuning); `risk` still selects the ordering
    policy. Returns (options, shortlist) where options[0] is the recommended clue.

    With `focus`, the profile's claim cap is lifted to the focus size (the user chose exactly
    which cards to connect) and options are ordered by how many focused cards they reach safely,
    then by score; options[0]["focus_missing"] is non-empty when no clue reaches all of them."""
    prof = profile or RISK_PROFILES[risk]
    focus = [w for w in (focus or []) if w in board.my] or None
    vocab, emb, lems, freq = geo_assets(vocab_mode)
    cands = probe.encoder_clue_candidates(
        get_enc(GEO_ENC),
        board,
        vocab,
        emb,
        vocab_lemmas=lems,
        vocab_roots=_clue_roots[vocab_mode],
        vocab_freq=freq,
        lam_f=LAM_F,
        lam_soft=LAM_SOFT,
        soft_tau=SOFT_TAU,
        lam_div=LAM_DIV,
        n=10,
        targets=focus,
        **{k: prof[k] for k in _CAND_KEYS},
    )
    options = [
        _analyze_clue(
            board,
            c["word"],
            c["intended"] or (focus or []),
            c["count"],
            c["score"],
            focus,
            keep_rel=prof["keep"],
            max_count=None if focus else prof["m"],
        )
        for c in cands
    ]
    if focus:
        order = sorted(
            range(len(options)),
            key=lambda i: (
                options[i]["no_clue"],
                -options[i]["count"],
                options[i]["risky"],
                -options[i]["score"],
            ),
        )
    else:
        order = _risk_order(options, risk)
    return [options[i] for i in order], [cands[i] for i in order]


@app.post("/api/coach/spymaster")
def coach_spymaster():
    """Best clue for the marked board + a browsable shortlist, each with its own reasoning.

    `options` is the list the UI cycles through (a "next option" button); `picked` is the
    one to show first. The top-level fields mirror `options[picked]` for convenience."""
    j = _body()
    board = board_from(j)
    vocab_mode = vocab_mode_from(j)
    if not board.my:
        abort(400, "אין בלוח מילים של הצוות שלך")
    engine = "geometry" if EMBED_ONLY else (j.get("engine") or "geometry")
    mid = j.get("model")
    focus = [
        w for w in _str_list(j.get("focus"), "focus") if w in board.my
    ] or None  # optional target subset (team only)
    risk = risk_from(j)
    prof = RISK_PROFILES[risk]
    cand_kw = {k: prof[k] for k in _CAND_KEYS}
    keep_rel = prof["keep"]

    shortlist, picked = [], 0
    if engine == "llm":
        clue = probe.llm_spymaster(get_llm(mid), board)
        if not clue or probe.llm_root_conflicts(get_llm(mid), [clue.word], board.words):
            return jsonify(error="DictaLM לא הצליח להחזיר רמז חוקי, נסה שוב או עבור לגאומטריה")
        options = [
            _analyze_clue(
                board,
                clue.word,
                clue.intended,
                clue.count,
                clue.margin,
                focus,
                reason=clue.reason,
                keep_rel=keep_rel,
                max_count=prof["m"],
            )
        ]
    elif engine == "hybrid":  # geometry proposes a legal shortlist, DictaLM gates + picks first
        vocab, emb, lems, freq = geo_assets(vocab_mode)
        cands = probe.encoder_clue_candidates(
            get_enc(GEO_ENC),
            board,
            vocab,
            emb,
            vocab_lemmas=lems,
            vocab_roots=_clue_roots[vocab_mode],
            vocab_freq=freq,
            lam_f=LAM_F,
            lam_soft=LAM_SOFT,
            soft_tau=SOFT_TAU,
            lam_div=LAM_DIV,
            n=10,
            targets=focus,
            **cand_kw,
        )
        bad = probe.llm_root_conflicts(get_llm(mid), [c["word"] for c in cands], board.words)
        cands = [c for c in cands if c["word"] not in bad] or cands  # keep >=1
        shortlist = cands
        chosen = probe.llm_pick_clue(get_llm(mid), board, cands)
        picked = next((i for i, c in enumerate(cands) if c["word"] == chosen.word), 0)
        options = [
            _analyze_clue(
                board,
                c["word"],
                c["intended"],
                c["count"],
                c["score"],
                focus,
                keep_rel=keep_rel,
                max_count=prof["m"],
            )
            for c in cands
        ]
    else:  # geometry: the same ordered options serve_clue / the benchmark use
        options, shortlist = serve_clue(board, risk, focus, vocab_mode=vocab_mode)
        options, shortlist = options[:10], shortlist[:10]

    if not options:
        return jsonify(error="לא נמצא רמז חוקי ללוח הזה", no_clue=True, options=[]), 200
    top = options[picked]
    return jsonify(
        engine=engine,
        options=options,
        picked=picked,
        shortlist=shortlist,
        clue=top["word"],
        count=top["count"],
        intended=top["intended"],
        reason=top["reason"],
        read=top["read"],
        leak=top["leak"],
        assassin=top["assassin"],
        no_clue=top["no_clue"],
        risky=top["risky"],
        safe=top["safe"],
        note=top["note"],
        **({"focus_missing": top["focus_missing"]} if "focus_missing" in top else {}),
    )


@app.post("/api/coach/check")
def coach_check():
    """Evaluate a clue the human is considering: which words it lights up, how long
    the safe run is, the danger words, and assassin proximity. 'Test before you play.'"""
    j = _body()
    board = board_from(j)
    clue = clue_from(j)
    # Legality (offline, no LLM): a clue is illegal if it is a board word / an inflection of one
    # (DictaBERT lemma), or shares a root (Wiktionary lexicon) with a board word it is transparent
    # to (fastText cosine). The optional DictaLM root-judge adds extra coverage on opt-in.
    illegal = probe.shares_lemma(clue, board, enc=get_enc(GEO_ENC))
    if (
        not illegal and j.get("use_llm") and not EMBED_ONLY
    ):  # embed-only deploy never touches the LLM
        illegal = bool(probe.llm_root_conflicts(get_llm(j.get("model")), [clue], board.words))
    read = _read_clue(board, clue)
    safe = 0  # team words from the top before any non-team word
    for r in read:
        if r["role"] == "my":
            safe += 1
        else:
            break
    first_danger = next((r for r in read if r["role"] != "my"), None)
    assassin_word = board.assassin
    arank = next((i for i, r in enumerate(read) if r["word"] == assassin_word), -1)
    return jsonify(
        clue=clue,
        illegal=illegal,
        read=read,
        safe=safe,
        first_danger=first_danger,
        assassin={"word": assassin_word, "rank": arank},
    )


@app.post("/api/coach/operative")
def coach_operative():
    """Best guesses for a clue + count, with confidence and a geometry second opinion."""
    j = _body()
    board = board_from(j)
    clue = clue_from(j)
    count = count_from(j)
    engine = "geometry" if EMBED_ONLY else (j.get("engine") or "geometry")
    mid = j.get("model")

    _, geo_sims = probe.encoder_rank(get_enc(GEO_ENC), board, clue)
    geo_conf = _conf(geo_sims)
    geo_order = sorted(board.words, key=lambda w: -geo_sims[w])

    agree, agree_with = None, None
    if engine == "geometry":
        order = geo_order
        if SECOND_OPINION:
            try:  # honest second opinion: an independent encoder (no LLM)
                _, x_sims = probe.encoder_rank(get_enc(XENC), board, clue)
                x_order = sorted(board.words, key=lambda w: -x_sims[w])
                agree = len(set(order[:count]) & set(x_order[:count]))
                agree_with = "NeoDictaBERT"
            except Exception:
                app.logger.exception("cross-encoder second opinion failed")
    else:
        order = probe.llm_guess_ranking(get_llm(mid), board, clue)
        agree = len(set(order[:count]) & set(geo_order[:count]))
        agree_with = "גאומטריה"

    ranking = [
        {"word": w, "sim": round(geo_sims[w], 4), "conf": round(geo_conf[w], 4), "rank": i}
        for i, w in enumerate(order)
    ]
    picks = order[:count]
    return jsonify(
        engine=engine,
        clue=clue,
        count=count,
        ranking=ranking,
        picks=picks,
        geo_order=geo_order,
        agreement=agree,
        agree_with=agree_with,
    )


# Feedback limits: field caps keep one row small, and a per-client sliding window stops a single
# client from flooding the log (and the dataset mirror behind it).
FB_RATE, FB_WINDOW = 20, 60.0  # at most 20 rows per client per minute
FB_OPTION_MAX = 24 * 1024  # serialized size cap for the attached clue option
_FB_VERDICTS = {"up", "down", "outcome"}
_fb_hits: dict[str, collections.deque] = {}


def _fb_rate_ok(key: str) -> bool:
    now = time.time()
    with _fb_lock:
        if len(_fb_hits) > 10_000:  # drop idle clients so the table stays bounded
            for k in [k for k, d in _fb_hits.items() if not d or now - d[-1] > FB_WINDOW]:
                del _fb_hits[k]
        q = _fb_hits.setdefault(key, collections.deque())
        while q and now - q[0] > FB_WINDOW:
            q.popleft()
        if len(q) >= FB_RATE:
            return False
        q.append(now)
        return True


def _opt_str(j, key: str, limit: int):
    v = j.get(key)
    if v is None:
        return None
    if not isinstance(v, str):
        abort(400, f"'{key}' חייב להיות מחרוזת")
    return v[:limit]


def _fb_board(v):
    if v is None:
        return None
    if not isinstance(v, dict):
        abort(400, "'board' חייב להיות אובייקט {words, roles}")
    words = _str_list(v.get("words"), "board.words")
    roles = v.get("roles") or {}
    if not isinstance(roles, dict) or len(roles) > MAX_BOARD:
        abort(400, "'board.roles' חייב להיות מיפוי של עד 25 מילים")
    clean_roles = {}
    for k, r in roles.items():
        if not isinstance(r, str) or r not in _VALID_ROLES | {"red", "blue", "team"}:
            abort(400, "'board.roles' מכיל תפקיד לא חוקי")
        clean_roles[_clean_word(k)] = r
    return {"words": words, "roles": clean_roles}


def _fb_revealed(v):
    if v is None:
        return None
    if not isinstance(v, list) or len(v) > MAX_BOARD:
        abort(400, "'revealed' חייב להיות רשימה של עד 25 קלפים")
    out = []
    for x in v:
        if isinstance(x, str):
            out.append(_clean_word(x))
        elif isinstance(x, dict):
            by = x.get("chosenBy")
            if by is not None and (not isinstance(by, str) or len(by) > 16):
                abort(400, "'revealed.chosenBy' לא חוקי")
            out.append({"word": _clean_word(x.get("word")), "chosenBy": by})
        else:
            abort(400, "'revealed' מכיל ערך לא חוקי")
    return out


@app.post("/api/feedback")
def feedback():
    """Record a 👍/👎 (and optional comment) on a clue. Stores the full board + clue option so
    every row is reproducible/debuggable, plus an anonymous client id and a salted IP hash for
    spam cleanup. Append-only; a valid row is never refused for storage reasons (a failed write
    is logged), but malformed rows get a 400 and a flooding client a 429."""
    j = _body()
    xff = request.headers.get("X-Forwarded-For", "") or (request.remote_addr or "")
    ip = xff.split(",")[0].strip()
    ipsig = hashlib.sha256((_FB_SALT + ip).encode()).hexdigest()[:12] if ip else ""
    verdict = j.get("verdict")
    if verdict not in _FB_VERDICTS:
        abort(400, "'verdict' חייב להיות up/down/outcome")
    count = j.get("count")
    if count is not None and (isinstance(count, bool) or not isinstance(count, int)):
        abort(400, "'count' חייב להיות מספר שלם")
    option = j.get("option")
    if option is not None:
        if not isinstance(option, dict):
            abort(400, "'option' חייב להיות אובייקט")
        if len(json.dumps(option, ensure_ascii=False)) > FB_OPTION_MAX:
            abort(400, "'option' גדול מדי")
    row = {
        "ts": round(time.time(), 1),
        "uid": _opt_str(j, "uid", 64) or "",
        "ipsig": ipsig,
        "verdict": verdict,
        "comment": _opt_str(j, "comment", 500) or "",
        "mode": _opt_str(j, "mode", 20),
        "target": _opt_str(j, "target", 10),  # which team the clue was for (UI wire mapping)
        "risk": _opt_str(j, "risk", 20),
        "side": _opt_str(j, "side", 20),
        "clue": _opt_str(j, "clue", MAX_CLUE_LEN * 2),
        "count": count,
        "intended": _str_list(j.get("intended"), "intended"),
        "focus": _str_list(j.get("focus"), "focus"),  # pinned targets — needed to reproduce
        "why": _opt_str(j, "why", 40) or "",  # structured 👎 tag (opposite/vague/wrong/risky/…)
        "board": _fb_board(j.get("board")),  # {words, roles} — the full board + colors
        "revealed": _fb_revealed(j.get("revealed")),  # cards already flipped
        "option": option,  # full clue option: reason, leak, assassin, score, read…
    }
    if not _fb_rate_ok(ipsig or row["uid"] or "anon"):
        abort(429, "יותר מדי משובים בזמן קצר — נסו שוב בעוד דקה")
    try:
        with (
            _fb_lock,
            open(os.path.join(FEEDBACK_DIR, "feedback.jsonl"), "a", encoding="utf-8") as f,
        ):
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        app.logger.exception("feedback write failed")
    return jsonify(ok=True)


# --------------------------------------------------------------------------- #
# Startup
# --------------------------------------------------------------------------- #


def warmup():
    """Load everything a request can need before serving: the geometry encoder, every advertised
    clue vocabulary (embedded + lemmatised), DictaBERT-lex, and the deck's lemmas. Requests then
    never pay a cold load, and concurrent first requests can't race to build the same assets."""
    t = time.time()
    for mode in ADVERTISED_VOCAB_MODES:
        geo_assets(mode)
    probe.deck_conflicts()  # deck lemmas + the root-conflict table /api/deal deals from
    app.logger.warning("warmup done in %.1fs", time.time() - t)


_started = False


def startup():
    global _started
    if _started:
        return
    _started = True
    _init_feedback()
    if os.environ.get("WARMUP", "").lower() in ("1", "true", "yes"):
        warmup()


def create_app():
    """WSGI factory for gunicorn (`codenames.app:create_app()`): runs startup in the worker."""
    startup()
    return app


if __name__ == "__main__":  # local dev server; production runs gunicorn (hf_space/Dockerfile)
    startup()
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "7860"))
    app.run(host=host, port=port, debug=False, threaded=True)
