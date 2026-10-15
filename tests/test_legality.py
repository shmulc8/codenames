"""Regression test for clue legality (shared-root + transparency gate).

Runs the production decision (`probe.shares_lemma` with the production encoder `app.GEO_ENC`)
on hand-picked cases, then on the labelled calibration set tests/fixtures/legality_pairs.json,
whose accuracy at the configured θ must not regress. Cosines are computed live, so the test
tracks whatever encoder the server uses.

Run: PYTHONPATH=src FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin python tests/test_legality.py
"""

import json
import os

from codenames import app, morph, probe

THETA = probe.ROOT_TRANSPARENCY_THETA

# (clue, board word, expected_illegal, note)
CASES = [
    # transparent derivations / inflections that share a root — MUST be illegal
    ("מדען", "מדע", True, "the reported bug: scientist vs science, root ידע"),
    ("קוסם", "קסם", True, "magician vs magic"),
    ("רכבת", "רכב", True, "train vs vehicle"),
    ("כלבה", "כלב", True, "fem. of dog"),
    ("שומר", "שמר", True, "guard vs guarded (same lemma too)"),
    ("שומר", "שמירה", True, "guard vs guarding"),
    ("ספרייה", "ספר", True, "library vs book — tightest transparent pair"),
    ("מטבח", "טבח", True, "kitchen vs cook"),
    ("מלכה", "מלך", True, "queen vs king"),
    ("מכתב", "כתב", True, "letter vs wrote"),
    ("הוראה", "מורה", True, "instruction vs teacher — transparent, root ירה/הרה"),
    ("עלה", "עלים", True, "leaf vs leaves, root עלה/עלל"),
    ("עלה", "עלי", True, "leaf vs construct plural leaves, root עלה/עלל"),
    ("פרח", "לפרוח", True, "flower vs to blossom, root פרח"),
    ("פרח", "פרחים", True, "flower vs flowers, root פרח"),
    # different roots (letters may coincide) — MUST be legal
    ("מדע", "מדינה", False, "science vs state — different roots, high cosine"),
    ("עיתון", "ספר", False, "newspaper vs book — related meaning, different root"),
    ("חתול", "כלב", False, "cat vs dog — very high cosine, different roots"),
    ("אש", "ראש", False, "fire inside head — coincidental substring, OOV fallback"),
    ("אורות", "אש", False, "lights vs fire — different roots"),
    ("שמש", "ים", False, "sun vs sea — unrelated"),
    (
        "פרחח",
        "פרח",
        False,
        "punk vs flower — different roots (quadriliteral vs triliteral), high cosine stays legal",
    ),
    # opaque etymological cognate — shares a root but a player wouldn't see it: legal via θ gate
    ("מלחמה", "לחם", False, "war vs bread — shared root לחמ, but cosine below θ"),
    # same-root derivatives the production encoder scores below the old θ=0.30 — MUST be illegal
    ("רוחני", "רוח", True, "spiritual vs wind/spirit"),
    ("ריפוי", "רופא", True, "healing vs doctor"),
    ("קשירה", "קשר", True, "tying vs knot"),
    ("גננת", "גנן", True, "kindergarten teacher vs gardener (root גנן)"),
    ("גינון", "גנן", True, "gardening vs gardener"),
]

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "legality_pairs.json")
MIN_ACCURACY = 0.78  # calibration accuracy at θ (0.789 when θ was set)
MAX_MISSED = 7  # labelled-illegal pairs the gate lets through (6 when θ was set)


def _shares_root(a: str, b: str) -> bool:
    ra, rb = morph.roots(a), morph.roots(b)
    return probe._shares_root(ra, morph.root_sig(a), rb, morph.root_sig(b))


_ENC = None


def _illegal(clue: str, word: str) -> bool:
    global _ENC
    _ENC = _ENC or app.get_enc(app.GEO_ENC)
    return probe.shares_lemma(clue, probe.Board(words=[word], role={word: "opp"}), enc=_ENC)


def _cos(a: str, b: str) -> float:
    v = app.get_enc(app.GEO_ENC).embed([a, b])
    return float(v[0] @ v[1])


def main() -> int:
    # the reported bug must resolve to a shared root
    assert morph.roots("מדע") & morph.roots("מדען"), "מדע/מדען must share a lexicon root (ידע)"
    # Surface normalization must survive niqqud, maqaf, and Hebrew quote marks.
    assert morph.roots("מַדְעָן") == morph.roots("מדען"), "niqqud normalization regressed"
    assert morph.roots("מדען־") == morph.roots("מדען"), "maqaf normalization regressed"

    assert _shares_root("עלה", "עלים"), "עלה/עלים must share a root"
    assert _shares_root("עלה", "עלי"), "עלה/עלי must share a root"
    assert _shares_root("עלה", "העלה"), "עלה/העלה must share a root"
    assert _shares_root("פרח", "פרחים"), "פרח/פרחים must share a root"
    assert not _shares_root("פרח", "פרחח"), "פרח/פרחח must not share a root"
    assert not _shares_root("פרחח", "פרח"), "פרחח/פרח must not share a root"

    failures = []
    for clue, word, expected, note in CASES:
        got = _illegal(clue, word)
        cos = _cos(clue, word)
        status = "ok " if got == expected else "FAIL"
        if got != expected:
            failures.append((clue, word, expected, got, note))
        verdict = "illegal" if got else "legal"
        print(
            f"  [{status}] {clue:8}↔ {word:8} cos={cos:.3f} shares_root={_shares_root(clue, word)!s:5} → {verdict:7} ({note})"
        )

    with open(FIXTURE, encoding="utf-8") as f:
        pairs = json.load(f)["pairs"]
    tp = fp = fn = tn = 0
    for p in pairs:
        pred = _illegal(p["clue"], p["word"])
        tp += pred and p["illegal"]
        fp += pred and not p["illegal"]
        fn += (not pred) and p["illegal"]
        tn += (not pred) and not p["illegal"]
    accuracy = (tp + tn) / len(pairs)
    print(
        f"\n  calibration set ({len(pairs)} pairs, θ={THETA}): accuracy {accuracy:.3f} "
        f"— illegal blocked {tp}, illegal missed {fn}, legal blocked {fp}, legal kept {tn}"
    )
    if accuracy < MIN_ACCURACY or fn > MAX_MISSED:
        failures.append(
            ("calibration", "set", True, False, f"accuracy {accuracy:.3f}, missed {fn}")
        )

    print()
    if failures:
        for clue, word, exp, got, note in failures:
            print(
                f"FAILED: {clue}↔{word} expected {'illegal' if exp else 'legal'}, got {'illegal' if got else 'legal'} — {note}"
            )
        print(f"\n{len(failures)} failure(s).")
        return 1
    print(f"All {len(CASES)} legality cases pass (θ={THETA}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
