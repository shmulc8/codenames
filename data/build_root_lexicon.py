"""Build data/word2root.json — a surface-word → triliteral-root(s) map for Hebrew.

Source: the Hebrew Wiktionary extract from kaikki.org (wiktextract). Download once:

    curl -O https://kaikki.org/dictionary/Hebrew/kaikki.org-dictionary-Hebrew.jsonl
    mv kaikki.org-dictionary-Hebrew.jsonl kaikki_hebrew.jsonl
    python build_root_lexicon.py            # writes word2root.json next to this file

Roots are gathered from six signals (he-rootbox templates, "terms belonging to the root X"
categories, "from the root X" etymology prose, root-page derived lists, affix base-chasing,
and inflection-table propagation). See the project's legality notes for how this feeds the
clue-legality check. Licensing/attribution: see ROOT_LEXICON_NOTICE.md.
"""

import json, collections, re, unicodedata

SRC = "kaikki_hebrew.jsonl"

NIQQUD = re.compile(r"[֑-ׇ]")  # cantillation + niqqud range
FINALS = str.maketrans("ךםןףץ", "כמנפצ")

def strip_niqqud(s):
    s = unicodedata.normalize("NFC", s)
    return NIQQUD.sub("", s)

def norm_word(w):
    """Normalize a surface word: strip niqqud + maqaf-hyphen artifacts, strip whitespace.
    Do NOT touch final letters here -- those are correct standalone spelling (קסם keeps its
    final מ). Final-letter normalization only makes sense for *root* strings (see norm_root),
    where Wiktionary's root notation can show the last radical in its word-final allograph."""
    w = strip_niqqud(w).strip()
    w = w.replace("־", "").replace("-", "")
    return w

def norm_root(r):
    """Root string like 'ר־ו־ץ' -> letters joined 'רוץ' with final-letter normalization."""
    r = strip_niqqud(r).strip()
    letters = [c for c in r.split("־") if c]
    # some roots use plain hyphen or no separator
    if len(letters) <= 1 and "-" in r:
        letters = [c for c in r.split("-") if c]
    joined = "".join(letters) if letters else r.replace("-", "")
    return joined.translate(FINALS)

CATRE = re.compile(r"^Hebrew terms belonging to the root (.+)$")
FROMROOTRE = re.compile(r"from the root ([א-ת][־א-ת]*)")
HEBWORD = re.compile(r"[א-ת]+")

ALL = [json.loads(line) for line in open(SRC, encoding="utf-8")]

word2roots = collections.defaultdict(set)
root_entries = {}  # root -> set of derived words (from pos=='root' entries)
n_lines = 0
n_rootbox = 0
n_root_pos = 0
n_catroot = 0
n_fromroot = 0

for d in ALL:
        n_lines += 1
        w = d.get("word", "")
        if d.get("pos") == "root":
            rk = norm_root(w)
            for sense in d.get("senses", []) or []:
                for der in sense.get("derived", []) or []:
                    dw = der.get("word")
                    if dw:
                        root_entries.setdefault(rk, set()).add(norm_word(dw))
            for der in d.get("derived", []) or []:
                dw = der.get("word")
                if dw:
                    root_entries.setdefault(rk, set()).add(norm_word(dw))
            n_root_pos += 1
            continue

        nw = norm_word(w)
        if not nw:
            continue
        for et in d.get("etymology_templates", []) or []:
            if et.get("name") in ("he-rootbox", "he-root"):
                args = et.get("args", {})
                r = args.get("1")
                if r:
                    rk = norm_root(r)
                    if rk:
                        word2roots[nw].add(rk)
                        n_rootbox += 1
        # categories (both entry-level and per-sense) carry "Hebrew terms belonging to the
        # root X" tags -- a much higher-yield source than the he-rootbox template alone,
        # since it is populated by a different (broader) Wiktionary template/process.
        allcats = list(d.get("categories") or [])
        for sense in d.get("senses", []) or []:
            allcats += sense.get("categories") or []
        for c in allcats:
            name = c.get("name") if isinstance(c, dict) else str(c)
            m = CATRE.match(name)
            if m:
                rk = norm_root(m.group(1))
                if rk:
                    word2roots[nw].add(rk)
                    n_catroot += 1
        # some etymology prose explicitly names the root even when no he-rootbox template or
        # root category was applied to this entry, e.g. "Action noun of the verb הִמְצִיא
        # (himtsí), from the root מ־צ" -- catch it directly out of etymology_text.
        etxt = d.get("etymology_text") or ""
        m = FROMROOTRE.search(etxt)
        if m:
            rk = norm_root(m.group(1))
            if rk:
                word2roots[nw].add(rk)
                n_fromroot += 1
        # also collect from forms (inflected surface forms) -> same root as lemma
        # only do this once we know the lemma's root, done in a second pass below

print(f"lines={n_lines} root_pos_entries={n_root_pos} rootbox_hits={n_rootbox} catroot_hits={n_catroot} fromroot_hits={n_fromroot}")
print(f"distinct words with direct root (via he-rootbox on own entry): {len(word2roots)}")
print(f"distinct roots seen as pos=='root' entries: {len(root_entries)}")

# Merge in the root->derived-words direction: every derived word also gets that root.
added = 0
for rk, ws in root_entries.items():
    for w in ws:
        if w and rk not in word2roots[w]:
            word2roots[w].add(rk)
            added += 1
print(f"additional (word,root) pairs added from root-entry 'derived' lists: {added}")
print(f"TOTAL distinct words with >=1 root: {len(word2roots)}")

def propagate_forms():
    """Propagate each entry's own root(s) to all its inflected surface forms listed in
    'forms' (declension/conjugation tables) -- e.g. tags אורות with אור's root. Also lets a
    homograph collision on a *niqqud-stripped* canonical form (e.g. the pu'al verb סופר's
    canonical form סֻפַּר strips to ספר) feed the bare consonantal root back to that string."""
    added = 0
    for d in ALL:
        if d.get("pos") == "root":
            continue
        w = norm_word(d.get("word", ""))
        roots = word2roots.get(w)
        if not roots:
            continue
        for frm in d.get("forms", []) or []:
            fw = norm_word(frm.get("form", ""))
            if fw and fw != w and len(fw) >= 2:
                before = len(word2roots[fw])
                word2roots[fw] |= roots
                if len(word2roots[fw]) > before:
                    added += 1
    return added

# Run forms-propagation BEFORE affix-chasing so base words like ספר -- which only pick up a
# root via a homograph's inflected-form collision (see propagate_forms docstring) -- are
# already resolved when ספרייה (סֵפֶר + ־ִיָּה) goes looking for its base's root.
form_added = propagate_forms()
print(f"forms-propagation pass 1: added roots for {form_added} more surface forms")

# Chase derivational templates (affix/suffix/prefix/confix) back to their Hebrew base word and
# inherit its root -- catches nominalizations like ספרייה that get no he-rootbox/category tag
# of their own. Two rounds so a 2-hop derivation chain (X -> Y -> root) resolves.
DERIV_TEMPLATES = {"affix", "suffix", "prefix", "confix", "af"}
for round_ in range(2):
    chased = 0
    for d in ALL:
        if d.get("pos") == "root":
            continue
        nw = norm_word(d.get("word", ""))
        if not nw or word2roots.get(nw):
            continue  # already has a root, or no word text
        for et in d.get("etymology_templates", []) or []:
            if et.get("name") not in DERIV_TEMPLATES:
                continue
            args = et.get("args", {})
            for key in ("2", "3", "4"):
                base = strip_niqqud(args.get(key, ""))  # strip niqqud FIRST -- it's
                # interleaved between consonants (סֵפֶר), so a bare [א-ת]+ scan over the
                # un-stripped string only ever matches single-letter fragments
                m = HEBWORD.search(base)
                if not m:
                    continue
                base_w = norm_word(m.group(0))
                if base_w and base_w != nw and word2roots.get(base_w):
                    word2roots[nw] |= word2roots[base_w]
                    chased += 1
                    break
            if word2roots.get(nw):
                break
    print(f"round {round_+1}: affix/derivation base-chasing added roots for {chased} more words")

print(f"TOTAL after affix-chasing: {len(word2roots)}")

# Second forms-propagation pass: newly-chased words (e.g. ספרייה) may have their own
# inflected forms (e.g. plural ספריות) that should now also inherit the root.
form_added_2 = propagate_forms()
print(f"forms-propagation pass 2 (post-chase): added roots for {form_added_2} more surface forms")
print(f"FINAL total distinct surface words with >=1 root: {len(word2roots)}")

out = {w: sorted(rs) for w, rs in word2roots.items()}
json.dump(out, open("word2root.json", "w", encoding="utf-8"), ensure_ascii=False)
print("wrote word2root.json with", len(out), "entries")
