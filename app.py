"""Local server for the Hebrew Codenames AI co-pilot.

The co-pilot (served at `/`) is the product: a human plays either seat and the
assistant coaches it — best clue when you're רב המרגלים, best guesses when you're
the מנחש — and *shows its reasoning* (the geometry shortlist, which candidate
DictaLM picked and why, the operative-eye reading of the clue, danger flags).

    HF_HUB_OFFLINE=1 .venv/bin/python app.py     # http://127.0.0.1:7860

The bot-vs-bot research game is still reachable at `/game`.

Default engine is **geometry** — pure fastText embeddings + DictaBERT legality, no
generative LLM in the loop (lighter, instant, fully offline). The clue word comes from
a mid-frequency noun/adjective band of the vocabulary, and the rationale is derived from
the geometry itself. DictaLM is optional (engines `hybrid`/`llm`) and loads lazily only
when selected. Encoders and the clue vocabulary load lazily on first use.
"""

import os
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import hashlib
import json
import random
import shutil
import threading
import time

import numpy as np
from flask import Flask, request, jsonify, send_file, send_from_directory, abort

import morph
import probe
import spy

app = Flask(__name__)
app.register_blueprint(spy.spy)

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
    # Scoring weights (m, lam_*, safe_margin) validated on bench_clue.py (real serve_clue path,
    # validated fasttext+qwen guesser); a random search over these knobs did not beat them on
    # held-out boards, so they stand. The count-trim `keep` (keep_rel) sets the coverage↔safety
    # point: lower claims more words but over-claims and risks a wrong guess. Chosen on the
    # held-out coverage/safety curve — balanced 0.60 keeps single-word clues to ~18% (0.66 gave
    # ~25%) at ~2.2 words/clue; cautious stays tight (safety first), bold reaches furthest.
    "cautious": dict(m=2, lam_a=3.0, lam_opp=1.3, lam_neu=0.7, keep=0.68, safe_margin=0.05),
    "balanced": dict(m=3, lam_a=2.5, lam_opp=0.9, lam_neu=0.6, keep=0.60, safe_margin=0.02),
    "bold":     dict(m=4, lam_a=1.8, lam_opp=0.7, lam_neu=0.4, keep=0.55, safe_margin=0.0),
}
_CAND_KEYS = ("m", "lam_a", "lam_opp", "lam_neu", "safe_margin")
LAM_F = 0.14                # weight on the mid-frequency (DETECT-FREQ) prior in candidate scoring

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
FEEDBACK_DATASET = os.environ.get("FEEDBACK_DATASET")          # e.g. "shmulc/codenames-feedback"
_FB_SALT = os.environ.get("FEEDBACK_SALT", "cn-feedback-v1")   # salts the IP hash (coarse anti-evasion signal, never the raw IP)
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
                src = hf_hub_download(FEEDBACK_DATASET, "data/feedback.jsonl",
                                      repo_type="dataset", token=os.environ["HF_TOKEN"])
                shutil.copyfile(src, local_fb)
                app.logger.info("seeded local feedback log from dataset")
            except Exception:
                app.logger.info("no existing feedback in dataset to seed — starting fresh")
        try:
            from huggingface_hub import CommitScheduler
            _fb_scheduler = CommitScheduler(
                repo_id=FEEDBACK_DATASET, repo_type="dataset", folder_path=FEEDBACK_DIR,
                path_in_repo="data", every=1, private=True, token=os.environ["HF_TOKEN"],
                squash_history=True)
            app.logger.info("feedback mirrored to dataset %s", FEEDBACK_DATASET)
        except Exception:
            app.logger.exception("feedback scheduler init failed — logging locally only")


@app.errorhandler(Exception)
def on_error(e):
    """Answer the client with JSON so the UI can recover instead of hanging. Routing/HTTP
    errors (e.g. a 404 for /favicon.ico) pass through with their own status — no 500, no
    traceback noise in the logs."""
    from werkzeug.exceptions import HTTPException
    if isinstance(e, HTTPException):
        return e
    app.logger.exception("request failed")
    return jsonify(error=f"שגיאת שרת: {e}"), 500


@app.get("/favicon.ico")
def favicon():
    return ("", 204)

MODELS = [
    {"id": probe.LLM_FAST, "label": "1.7B (מהיר)"},
    {"id": probe.LLM_BIG,  "label": "12B (איכותי)"},
]
ENCODER_KEYS = list(probe.ENCODERS.keys())
GEO_ENC = "blend_0.7_0.3"     # Concatenated L2-normalized fastText + Numberbatch blend
XENC = "neodictabert"          # cross-engine second opinion for the operative (no LLM)

_llms: dict = {}
_encs: dict = {}
_clue_vocab = None
_clue_freq = None
_clue_lemmas = None
_clue_emb: dict = {}


def get_llm(mid):
    mid = mid or probe.LLM_FAST
    if mid not in (probe.LLM_FAST, probe.LLM_BIG):    # never hand an arbitrary client string to mlx_lm.load
        abort(400, f"unknown model {mid!r}")
    if mid not in _llms:
        app.logger.info("loading LLM %s ...", mid)
        _llms[mid] = probe.HebrewLLM(mid)
    return _llms[mid]


def get_enc(key):
    if key not in _encs:
        app.logger.info("loading encoder %s ...", key)
        _encs[key] = probe.make_encoder(key)
    return _encs[key]


def _load_blocklist():
    """Offensive Hebrew terms (one per line, '#' comments) excluded from the clue vocabulary."""
    block = set()
    try:
        with open(os.path.join(probe.DATA, "blocklist_he.txt"), encoding="utf-8") as f:
            for line in f:
                w = line.strip()
                if w and not w.startswith("#"):
                    block.add(w)
    except FileNotFoundError:
        pass
    return block


def geo_assets():
    """(vocab, embedding, lemmas, freq_scores) for the geometry spymaster — a mid-frequency
    noun/adjective band of the clue vocabulary, embedded and FREQ-scored once. The vocab is
    lemmatised so legality catches prefixed forms (e.g. בסיר → סיר) that share a board lemma."""
    global _clue_vocab, _clue_freq, _clue_lemmas
    if _clue_vocab is None:
        # The full mid-frequency noun/adjective band (count >= 300, top-30k frequency source):
        # essentially any common, legal Hebrew noun/adjective is a candidate — not a small list.
        # The POS + frequency floor are quality guards (they keep junk/function words from
        # winning the geometry); legality (board word/shoresh) and the blocklist are the rest.
        vocab, counts = probe.clue_vocab_band(20000, lo=1000, hi=80000,
                                              pos={"NOUN", "ADJ"}, source_n=30000)
        freq = probe.freq_scores(counts, lo=1500, hi=40000)
        block = _load_blocklist()                  # drop offensive terms from the clue pool
        # content_master entries are already lemmas → use directly: correct shared-root
        # legality, and no re-lemmatising thousands of words at startup.
        keep = [i for i, w in enumerate(vocab) if w not in block]
        _clue_vocab = [vocab[i] for i in keep]
        _clue_lemmas = list(_clue_vocab)
        _clue_freq = freq[keep]
        app.logger.info("clue vocab: %d noun/adj band words (%d blocklisted)",
                        len(_clue_vocab), len(vocab) - len(keep))
    if GEO_ENC not in _clue_emb:
        _clue_emb[GEO_ENC] = get_enc(GEO_ENC).embed(_clue_vocab)
    return _clue_vocab, _clue_emb[GEO_ENC], _clue_lemmas, _clue_freq


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


def board_from(j) -> probe.Board:
    words = list(j.get("words") or [])
    if not words:
        abort(400, "board has no words")
    roles = j.get("roles") or {w: "neutral" for w in words}
    role = {}
    for w in words:
        r = roles.get(w, "neutral")
        if r not in _VALID_ROLES:              # reject unknown roles: a typo must not silently
            abort(400, f"invalid role {r!r} for word {w!r}")   # hide a word from the safety terms
        role[w] = r
    return probe.Board(words=words, role=role)


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
    return [{"word": w, "role": board.role.get(w, "neutral"),
             "sim": round(sims[w], 4), "conf": round(conf[w], 4)} for w in order]


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
        comps = Vt[:k]                       # (k, d) leading directions
        Xc = Xc - (Xc @ comps.T) @ comps     # project them out
    Xc /= (np.linalg.norm(Xc, axis=1, keepdims=True) + 1e-9)
    return Xc


def _classical_mds(D: np.ndarray, dim: int = 2) -> np.ndarray:
    """Classical (Torgerson) MDS in pure numpy: double-centre the squared-distance matrix
    B = -0.5 · J·D²·J and take the top-`dim` eigenvectors scaled by √eigenvalue."""
    n = D.shape[0]
    J = np.eye(n) - np.ones((n, n)) / n
    B = -0.5 * J @ (D ** 2) @ J
    w, V = np.linalg.eigh((B + B.T) / 2)     # symmetric → real eigenpairs
    idx = np.argsort(-w)[:dim]
    L = np.sqrt(np.clip(w[idx], 0.0, None))
    return V[:, idx] * L


# --------------------------------------------------------------------------- #
# Pages
# --------------------------------------------------------------------------- #

@app.get("/")
def index():
    frontend_index = os.path.join("frontend", "dist", "index.html")
    if os.path.exists(frontend_index):
        return send_file(frontend_index)
    return send_file("copilot.html")


@app.get("/legacy")
def legacy():
    return send_file("copilot.html")


@app.get("/assets/<path:filename>")
def frontend_asset(filename):
    return send_from_directory(os.path.join("frontend", "dist", "assets"), filename)


@app.get("/methods")
def methods():
    return send_file("methods.html")


@app.get("/game")
def game():
    if not os.path.exists("codenames_latent_space.html"):
        return ("הדף הזה אינו זמין בגרסה הציבורית.", 404)
    return send_file("codenames_latent_space.html")


@app.get("/api/health")
def health():
    return jsonify(ok=True, models=([] if EMBED_ONLY else MODELS),
                   encoders=ENCODER_KEYS, geo=GEO_ENC)


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
    j = request.get_json(force=True)
    board = board_from(j)
    clue = (j.get("clue") or "").strip() or None
    whiten = j.get("whiten", True)

    points = list(board.words) + ([clue] if clue else [])
    X = get_enc(GEO_ENC).embed(points)
    if whiten:
        X = _whiten_abtt(X, k=3)
    sims = np.clip(X @ X.T, -1.0, 1.0)
    D = 1.0 - sims                              # cosine distance
    Y = _classical_mds(D, dim=2)

    # normalise into a tidy [-1, 1] box so the client can scale to any canvas.
    # scale by a high percentile (not the max) so a couple of far outliers don't crush the
    # whole cloud into a tiny central blob; the few points beyond are clipped to the edge.
    scale = float(np.percentile(np.abs(Y), 90)) or float(np.abs(Y).max()) or 1.0
    Y = np.clip(Y / scale, -1.0, 1.0)
    coords = {w: [round(float(Y[i, 0]), 4), round(float(Y[i, 1]), 4)]
              for i, w in enumerate(board.words)}
    clue_xy = [round(float(Y[-1, 0]), 4), round(float(Y[-1, 1]), 4)] if clue else None
    return jsonify(coords=coords, roles=board.role, clue=clue, clue_xy=clue_xy)


# --------------------------------------------------------------------------- #
# Co-pilot
# --------------------------------------------------------------------------- #

def _analyze_clue(board: probe.Board, word: str, targets, count, score,
                  focus, reason: str = "", keep_rel: float = 0.66,
                  max_count: int | None = None) -> dict:
    """Full operative-eye analysis of one candidate clue: how the board reads, the *safe run*
    (team words a guesser reaches before any enemy), what it leaks, assassin proximity, a
    geometry rationale, and an honest no-clue verdict. Each entry in the spymaster `options`
    carries this so the UI can browse alternatives instantly without another round-trip.

    `targets` are the words the candidate was optimised for (focus / best-m); leak & risk are
    judged against them. The *recommended* number and the lit-up words, though, are the full
    safe run, capped by `max_count` when a risk profile sets a maximum claim."""
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
    if read and read[0]["role"] != "my":
        no_clue = True
        note = f"המילה הכי קרובה לרמז היא '{read[0]['word']}' — לא שלך. אין מילה שמקשרת את הצוות שלך בלי לסכן מילה זרה."
    elif asim is not None and asim >= floor:
        no_clue = True
        note = f"כל רמז שמקרב את המילים שלך מקרב גם את המתנקש ({aw}). מסוכן מדי."
    elif safe < 2 and not focus:
        no_clue = True
        note = "לא נמצאה מילה אחת שמחברת בין שתיים או יותר ממילות הצוות שלך. נסה לבחור יעדים אחרים או לחלק לתורות."
    elif leak:
        risky = True
        e = leak[0]
        note = (f"⚠ זהירות: '{e['word']}' ({ROLE_HE.get(e['role'], 'זרה')}) קרובה לרמז כמעט "
                f"כמו המילים שלך — מנחש עלול לבחור בה. בטוח ל-{safe} בלבד.")

    focusset = set(focus or [])
    disp_intended = []
    if not no_clue:
        encoder = get_enc(GEO_ENC)
        cliff_factor = 0.4 if getattr(encoder, "model_id", "").startswith("blend_") else 0.5
        coh_floor = 0.15 if getattr(encoder, "model_id", "").startswith("blend_") else COH_FLOOR
        disp_intended = probe.served_count(read, keep_rel=keep_rel, pin=focusset,
                                           enc=encoder, cohesion_floor=coh_floor,
                                           cohesion_mode=COH_MODE, cliff=cliff_factor)
        if max_count is not None:
            disp_intended = disp_intended[:max_count]
    disp_count = len(disp_intended)
    reason = reason or _geo_reason(disp_intended or targets, board, read)
    return {"word": word, "count": disp_count, "intended": disp_intended, "score": score,
            "reason": reason, "read": read, "leak": leak, "safe": safe,
            "assassin": {"word": aw, "rank": arank, "sim": asim},
            "no_clue": no_clue, "risky": risky, "note": note}


def _risk_order(options: list[dict], risk: str) -> list[int]:
    """Order analyzed geometry options by the risk *policy* (not just the scoring weight):
    refuse-clues always sink last; bold maximises coverage (count) then safety; cautious and
    balanced put safety first, then coverage. Returns option indices best-first."""
    if risk == "bold":
        key = lambda i: (1 if options[i]["no_clue"] else 0,
                         -options[i]["count"], -options[i]["safe"], -options[i]["score"])
    else:
        key = lambda i: (1 if options[i]["no_clue"] else 0,
                         1 if options[i]["risky"] else 0,
                         -options[i]["safe"], -options[i]["count"], -options[i]["score"])
    return sorted(range(len(options)), key=key)


def serve_clue(board: probe.Board, risk: str = "balanced", focus=None, profile=None):
    """The geometry engine's clue options for a board, ordered exactly as
    /api/coach/spymaster serves them (best first). Pure — no request context — so the
    endpoint, the benchmarks, and tests all measure the identical served clue.
    `profile` overrides RISK_PROFILES[risk] (for tuning); `risk` still selects the ordering
    policy. Returns (options, shortlist) where options[0] is the recommended clue."""
    prof = profile or RISK_PROFILES[risk]
    focus = [w for w in (focus or []) if w in board.my] or None
    vocab, emb, lems, freq = geo_assets()
    cands = probe.encoder_clue_candidates(
        get_enc(GEO_ENC), board, vocab, emb, vocab_lemmas=lems, vocab_freq=freq,
        lam_f=LAM_F, n=10, targets=focus, **{k: prof[k] for k in _CAND_KEYS})
    options = [_analyze_clue(board, c["word"], c["intended"], c["count"], c["score"], focus,
                             keep_rel=prof["keep"], max_count=prof["m"]) for c in cands]
    order = _risk_order(options, risk)
    return [options[i] for i in order], [cands[i] for i in order]


@app.post("/api/coach/spymaster")
def coach_spymaster():
    """Best clue for the marked board + a browsable shortlist, each with its own reasoning.

    `options` is the list the UI cycles through (a "next option" button); `picked` is the
    one to show first. The top-level fields mirror `options[picked]` for convenience."""
    j = request.get_json(force=True)
    board = board_from(j)
    if not board.my:
        abort(400, "board has no team (my) words")
    engine = "geometry" if EMBED_ONLY else (j.get("engine") or "geometry")
    mid = j.get("model")
    focus = [w for w in (j.get("focus") or []) if w in board.my] or None  # optional target subset (team only)
    risk = j.get("risk") if j.get("risk") in RISK_PROFILES else "balanced"
    prof = RISK_PROFILES[risk]
    cand_kw = {k: prof[k] for k in _CAND_KEYS}
    keep_rel = prof["keep"]

    shortlist, picked = [], 0
    if engine == "llm":
        clue = probe.llm_spymaster(get_llm(mid), board)
        if not clue or probe.llm_root_conflicts(get_llm(mid), [clue.word], board.words):
            return jsonify(error="DictaLM לא הצליח להחזיר רמז חוקי, נסה שוב או עבור לגאומטריה")
        options = [_analyze_clue(board, clue.word, clue.intended, clue.count, clue.margin,
                                 focus, reason=clue.reason, keep_rel=keep_rel, max_count=prof["m"])]
    elif engine == "hybrid":       # geometry proposes a legal shortlist, DictaLM gates + picks first
        vocab, emb, lems, freq = geo_assets()
        cands = probe.encoder_clue_candidates(get_enc(GEO_ENC), board, vocab, emb,
                                              vocab_lemmas=lems, vocab_freq=freq, lam_f=LAM_F,
                                              n=10, targets=focus, **cand_kw)
        bad = probe.llm_root_conflicts(get_llm(mid), [c["word"] for c in cands], board.words)
        cands = [c for c in cands if c["word"] not in bad] or cands   # keep >=1
        shortlist = cands
        chosen = probe.llm_pick_clue(get_llm(mid), board, cands)
        picked = next((i for i, c in enumerate(cands) if c["word"] == chosen.word), 0)
        options = [_analyze_clue(board, c["word"], c["intended"], c["count"], c["score"], focus,
                                 keep_rel=keep_rel, max_count=prof["m"])
                   for c in cands]
    else:                          # geometry: the same ordered options serve_clue / the benchmark use
        options, shortlist = serve_clue(board, risk, focus)
        options, shortlist = options[:10], shortlist[:10]

    if not options:
        return jsonify(error="לא נמצא רמז חוקי ללוח הזה", no_clue=True, options=[]), 200
    top = options[picked]
    return jsonify(
        engine=engine, options=options, picked=picked, shortlist=shortlist,
        clue=top["word"], count=top["count"], intended=top["intended"],
        reason=top["reason"], read=top["read"], leak=top["leak"],
        assassin=top["assassin"], no_clue=top["no_clue"], risky=top["risky"],
        safe=top["safe"], note=top["note"],
    )


@app.post("/api/coach/check")
def coach_check():
    """Evaluate a clue the human is considering: which words it lights up, how long
    the safe run is, the danger words, and assassin proximity. 'Test before you play.'"""
    j = request.get_json(force=True)
    board = board_from(j)
    clue = j["clue"].strip()
    # Legality (offline, no LLM): a clue is illegal if it is a board word / an inflection of one
    # (DictaBERT lemma), or shares a root (Wiktionary lexicon) with a board word it is transparent
    # to (fastText cosine). The optional DictaLM root-judge adds extra coverage on opt-in.
    illegal = probe.shares_lemma(clue, board, enc=get_enc(GEO_ENC))
    if not illegal and j.get("use_llm") and not EMBED_ONLY:   # embed-only deploy never touches the LLM
        illegal = bool(probe.llm_root_conflicts(get_llm(j.get("model")), [clue], board.words))
    read = _read_clue(board, clue)
    safe = 0                                   # team words from the top before any non-team word
    for r in read:
        if r["role"] == "my":
            safe += 1
        else:
            break
    first_danger = next((r for r in read if r["role"] != "my"), None)
    assassin_word = board.assassin
    arank = next((i for i, r in enumerate(read) if r["word"] == assassin_word), -1)
    return jsonify(clue=clue, illegal=illegal, read=read, safe=safe,
                   first_danger=first_danger, assassin={"word": assassin_word, "rank": arank})


@app.post("/api/coach/operative")
def coach_operative():
    """Best guesses for a clue + count, with confidence and a geometry second opinion."""
    j = request.get_json(force=True)
    board = board_from(j)
    clue = j["clue"].strip()
    count = max(1, min(9, int(j.get("count") or 1)))
    engine = "geometry" if EMBED_ONLY else (j.get("engine") or "geometry")
    mid = j.get("model")

    _, geo_sims = probe.encoder_rank(get_enc(GEO_ENC), board, clue)
    geo_conf = _conf(geo_sims)
    geo_order = sorted(board.words, key=lambda w: -geo_sims[w])

    agree, agree_with = None, None
    if engine == "geometry":
        order = geo_order
        if SECOND_OPINION:
            try:                   # honest second opinion: an independent encoder (no LLM)
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

    ranking = [{"word": w, "sim": round(geo_sims[w], 4), "conf": round(geo_conf[w], 4),
                "rank": i} for i, w in enumerate(order)]
    picks = order[:count]
    return jsonify(engine=engine, clue=clue, count=count, ranking=ranking, picks=picks,
                   geo_order=geo_order, agreement=agree, agree_with=agree_with)


@app.post("/api/feedback")
def feedback():
    """Record a 👍/👎 (and optional comment) on a clue. Stores the full board + clue option so
    every row is reproducible/debuggable, plus an anonymous client id and a salted IP hash for
    spam cleanup. Append-only; never fails the caller."""
    j = request.get_json(force=True, silent=True) or {}
    xff = request.headers.get("X-Forwarded-For", "") or (request.remote_addr or "")
    ip = xff.split(",")[0].strip()
    ipsig = hashlib.sha256((_FB_SALT + ip).encode()).hexdigest()[:12] if ip else ""
    row = {"ts": round(time.time(), 1),
           "uid": (j.get("uid") or "")[:64], "ipsig": ipsig,
           "verdict": j.get("verdict"), "comment": (j.get("comment") or "")[:500],
           "mode": j.get("mode"), "risk": j.get("risk"), "side": j.get("side"),
           "clue": j.get("clue"), "count": j.get("count"), "intended": j.get("intended"),
           "focus": j.get("focus"),         # targets the user pinned — needed to reproduce the clue
           "why": (j.get("why") or "")[:40],# structured 👎 reason tag (opposite/vague/wrong/risky/overreach)
           "board": j.get("board"),         # {words, roles} — the full board + colors
           "revealed": j.get("revealed"),   # cards already flipped (excluded from the engine board)
           "option": j.get("option")}       # full clue option: reason, leak, assassin, score, read…
    try:
        with _fb_lock, open(os.path.join(FEEDBACK_DIR, "feedback.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    except Exception:
        app.logger.exception("feedback write failed")
    return jsonify(ok=True)


if __name__ == "__main__":
    _init_feedback()
    if os.environ.get("WARMUP", "").lower() in ("1", "true", "yes"):
        app.logger.info("warming up geometry assets ...")
        geo_assets()               # load fastText + embed the clue vocab before serving
        import morph
        morph.lemmas(["מילה"])     # preload DictaBERT-lex (legality) so the first clue isn't slow
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "7860"))
    app.run(host=host, port=port, debug=False, threaded=True)
