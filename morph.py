"""Hebrew morphology via DictaBERT — a real model from the Dicta lab, replacing
hand-rolled particle/suffix stem heuristics.

`lemmas()` uses `dicta-il/dictabert-lex` (lemmatization): it strips attached
particles and reduces inflections to the lexeme ('האש'->'אש', 'מילים'->'מילה',
'התוכנית'->'תוכנית'), so legality can be defined as *shared lemma* rather than a
letter-list approximation. Same-root-but-different-lemma cases (תוכנה / תוכנית)
are a stricter shoresh rule handled separately by the LLM root-judge in probe.py.

First load downloads the model (~mins); afterwards it is HF-cached and loads offline.
"""

from __future__ import annotations

import functools
import json
import os
import re
import threading
import unicodedata

_LEX_ID = "dicta-il/dictabert-lex"
_MORPH_ID = "dicta-il/dictabert-morph"
_lock = threading.Lock()
_tok = _model = None
_mtok = _mmodel = None

CONTENT_POS = {"NOUN", "PROPN", "ADJ", "VERB"}   # keep as clue words; drop ADP/PRON/DET/CONJ/ADV/NUM
_BATCH = 512   # DictaBERT.predict holds the whole list in memory at once — chunk to bound it


def _predict(model, tok, words):
    """model.predict over `words` in bounded batches (avoids OOM on large vocabularies)."""
    out = []
    for i in range(0, len(words), _BATCH):
        out.extend(model.predict(words[i:i + _BATCH], tok))
    return out


def _load():
    global _tok, _model
    if _model is None:
        with _lock:
            if _model is None:
                from transformers import AutoModel, AutoTokenizer
                _tok = AutoTokenizer.from_pretrained(_LEX_ID)
                _model = AutoModel.from_pretrained(_LEX_ID, trust_remote_code=True).eval()
    return _tok, _model


def _load_morph():
    global _mtok, _mmodel
    if _mmodel is None:
        with _lock:
            if _mmodel is None:
                from transformers import AutoModel, AutoTokenizer
                _mtok = AutoTokenizer.from_pretrained(_MORPH_ID)
                _mmodel = AutoModel.from_pretrained(_MORPH_ID, trust_remote_code=True).eval()
    return _mtok, _mmodel


def pos(words) -> list[str]:
    """Coarse UD part-of-speech per (isolated) word via DictaBERT-morph. For a word with
    attached particles, the content head's POS wins (so 'בבית' reads as NOUN, not ADP)."""
    words = list(words)
    if not words:
        return []
    tok, model = _load_morph()
    out = _predict(model, tok, words)
    res = []
    for item in out:
        toks = (item or {}).get("tokens") or []
        ps = [t.get("pos") for t in toks if t.get("pos")]
        head = next((p for p in ps if p in CONTENT_POS), ps[-1] if ps else "X")
        res.append(head)
    return res


def lemmas(words) -> list[str]:
    """Lemma of each (isolated) Hebrew word, aligned with `words`. Falls back to the
    surface form when the model returns nothing."""
    words = list(words)
    if not words:
        return []
    tok, model = _load()
    preds = _predict(model, tok, words)         # each word treated as its own sentence
    out = []
    for w, pred in zip(words, preds):
        lem = None
        if pred:
            # pred is a list of (token, lemma) for the word's piece(s)
            first = pred[0]
            lem = first[1] if isinstance(first, (list, tuple)) and len(first) > 1 else None
        out.append(lem if lem and lem != "[BLANK]" else w)
    return out


@functools.lru_cache(maxsize=1024)
def lemma(word: str) -> str:
    return lemmas([word])[0]


_FINALS = str.maketrans("ךםןףץ", "כמנפצ")


_CUSTOM_ROOTS = {
    "פרחח": {"פרחח"},
    "פרחחים": {"פרחח"},
}


def _get_lex_roots(w: str, lex: dict) -> set[str]:
    if w in _CUSTOM_ROOTS:
        return set(_CUSTOM_ROOTS[w])
    # Exact spelling is authoritative, final-letter variant is fallback
    roots_found = set(lex.get(w, ()))
    if not roots_found:
        roots_found.update(lex.get(w.translate(_FINALS), ()))
    return roots_found


def root_sig(word: str) -> str:
    """A coarse consonantal *shoresh* signature for shared-root legality. Normalise final
    forms, drop the matres lectionis (ו / י), and strip a trailing ה / ת (nominal/feminine
    ending). Two words whose signatures are equal almost always share a root — קוסם/קסם,
    רכבת/רכב, שומר/שמירה, תוכנה/תוכנית — which plain lemma equality cannot see.

    Apply it to a *lemma* (so attached particles and inflection are already gone). It is a
    morphologically motivated approximation, tuned to over-reject rather than ever let a
    derivative through; residual same-root pairs with a different skeleton are caught by the
    DictaLM root-judge (`probe.llm_root_conflicts`)."""
    s = word.translate(_FINALS).replace("ו", "").replace("י", "")
    if len(s) >= 4 and s[0] in "מהנ":     # servile prefix: present-participle מ-, hif'il ה-, nif'al נ-
        s = s[1:]                          # מפחד→פחד, הפחיד→הפחד→פחד, נפחד→פחד
    if len(s) > 3 and s[-1] in "נתה":     # agentive/feminine ending: פחדן→פחד, שומרת→שומר
        s = s[:-1]
    return s


# --------------------------------------------------------------------------- #
# Root lexicon — authoritative shared-root signal (Wiktionary/kaikki-derived)
# --------------------------------------------------------------------------- #
# `roots()` looks a surface word up in data/word2root.json (see data/ROOT_LEXICON_NOTICE.md).
# It is the primary shared-root source for clue legality; `root_sig` above stays as the
# fallback for words the lexicon does not cover.

_ROOT_LEXICON_PATH = os.path.join(os.path.dirname(__file__), "data", "word2root.json")
_NIQQUD = re.compile(r"[֑-ׇ]")   # cantillation + niqqud range
_PUNCT = re.compile(r"[׳׳'\"“”‘’`]")
_FINAL_FORMS = str.maketrans("ךםןףץ", "כמנפצ")


def _norm_lookup(word: str) -> str:
    """Normalise a surface word to the lexicon's key form: NFC, niqqud stripped, maqaf/hyphen
    removed. Final letters are left intact (correct standalone spelling), matching the keys."""
    w = _NIQQUD.sub("", unicodedata.normalize("NFC", word)).strip()
    return _PUNCT.sub("", w).replace("־", "").replace("-", "")


@functools.lru_cache(maxsize=1)
def _root_lexicon() -> dict:
    """Surface word -> list of triliteral roots, loaded once from data/word2root.json.
    Empty dict if the file is absent, so callers transparently fall back to root_sig."""
    try:
        with open(_ROOT_LEXICON_PATH, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


@functools.lru_cache(maxsize=4096)
def roots(word: str) -> set[str]:
    """Triliteral root(s) of a surface Hebrew word per the vendored Wiktionary lexicon.
    Handles prefixes, suffixes, plurals, construct forms, and inflections using 
    lexicon-based decomposition and lemmatization fallbacks."""
    lex = _root_lexicon()
    if not lex:
        return set()
        
    norm = _norm_lookup(word)
    if not norm:
        return set()
        
    # Tier 1: Direct lookup
    res = _get_lex_roots(norm, lex)
    if res:
        return res
            
    # Tier 2: Systematic prefix/suffix stripping based on lexicon validation
    # This avoids loading/running DictaBERT for simple prefix/suffix inflections
    PREFIXES = ["וב", "וכ", "ול", "ומ", "וה", "וש", "שב", "שה", "שכ", "של", "שמ", "ו", "ש", "ה", "ב", "כ", "ל", "מ"]
    SUFFIXES = ["יהם", "יהן", "יכם", "יכן", "ינו", "יה", "יו", "יך", "יי", "הם", "הן", "כם", "כן", "נו", "ות", "ים", "ה", "ת", "י", "ו", "ך"]
    
    candidates = set()
    
    # Try stripping prefixes only
    for p in PREFIXES:
        if norm.startswith(p) and len(norm) - len(p) >= 2:
            stem = norm[len(p):]
            stem_roots = _get_lex_roots(stem, lex)
            if stem_roots:
                candidates.update(stem_roots)
                
    # Try stripping suffixes only
    for s in SUFFIXES:
        if norm.endswith(s) and len(norm) - len(s) >= 2:
            stem = norm[:-len(s)]
            stem_roots = _get_lex_roots(stem, lex)
            if stem_roots:
                candidates.update(stem_roots)
                
    # Try stripping both prefixes and suffixes
    for p in PREFIXES:
        for s in SUFFIXES:
            if norm.startswith(p) and norm.endswith(s) and len(norm) - len(p) - len(s) >= 2:
                stem = norm[len(p):-len(s)]
                stem_roots = _get_lex_roots(stem, lex)
                if stem_roots:
                    candidates.update(stem_roots)
                    
    if candidates:
        return candidates
        
    # Tier 3: Lemmatizer fallback
    try:
        lem = lemma(word)
        norm_lem = _norm_lookup(lem)
        res = _get_lex_roots(norm_lem, lex)
        if res:
            return res
        # Try stripping on the lemma itself
        for p in PREFIXES:
            if norm_lem.startswith(p) and len(norm_lem) - len(p) >= 2:
                stem = norm_lem[len(p):]
                stem_roots = _get_lex_roots(stem, lex)
                if stem_roots:
                    candidates.update(stem_roots)
        for s in SUFFIXES:
            if norm_lem.endswith(s) and len(norm_lem) - len(s) >= 2:
                stem = norm_lem[:-len(s)]
                stem_roots = _get_lex_roots(stem, lex)
                if stem_roots:
                    candidates.update(stem_roots)
        for p in PREFIXES:
            for s in SUFFIXES:
                if norm_lem.startswith(p) and norm_lem.endswith(s) and len(norm_lem) - len(p) - len(s) >= 2:
                    stem = norm_lem[len(p):-len(s)]
                    stem_roots = _get_lex_roots(stem, lex)
                    if stem_roots:
                        candidates.update(stem_roots)
    except Exception:
        # DictaBERT might fail or not be loaded
        pass
        
    return candidates
