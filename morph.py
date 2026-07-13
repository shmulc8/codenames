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

import threading

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


def lemma(word: str) -> str:
    return lemmas([word])[0]


_FINALS = str.maketrans("ךםןףץ", "כמנפצ")


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
