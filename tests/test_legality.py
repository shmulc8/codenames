"""Regression test for clue legality (shared-root + transparency gate).

Model-free: exercises the lexicon (morph.roots) and the composite decision directly, using the
fastText cosines measured during calibration, so it runs in well under a second and locks in
both the root resolution and the θ=0.30 boundary. The end-to-end generator check (no illegal
clue is ever served) lives in the manual run_flow harness.

Run: python tests/test_legality.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import morph
import probe

THETA = probe.ROOT_TRANSPARENCY_THETA

# (clue, board word, measured fastText cosine, expected_illegal, note)
CASES = [
    # transparent derivations / inflections that share a root — MUST be illegal
    ("מדען", "מדע", 0.4375, True, "the reported bug: scientist vs science, root ידע"),
    ("קוסם", "קסם", 0.4782, True, "magician vs magic"),
    ("רכבת", "רכב", 0.3479, True, "train vs vehicle"),
    ("כלבה", "כלב", 0.6012, True, "fem. of dog"),
    ("שומר", "שמר", 0.4769, True, "guard vs guarded (same lemma too)"),
    ("שומר", "שמירה", 0.5364, True, "guard vs guarding"),
    ("ספרייה", "ספר", 0.3135, True, "library vs book — tightest transparent pair"),
    ("מטבח", "טבח", 0.3230, True, "kitchen vs cook"),
    ("מלכה", "מלך", 0.4799, True, "queen vs king"),
    ("מכתב", "כתב", 0.5280, True, "letter vs wrote"),
    ("הוראה", "מורה", 0.5207, True, "instruction vs teacher — transparent, root ירה/הרה"),
    ("עלה", "עלים", 0.5820, True, "leaf vs leaves, root עלה/עלל"),
    ("עלה", "עלי", 0.5430, True, "leaf vs construct plural leaves, root עלה/עלל"),
    ("פרח", "לפרוח", 0.5120, True, "flower vs to blossom, root פרח"),
    ("פרח", "פרחים", 0.6210, True, "flower vs flowers, root פרח"),
    # different roots (letters may coincide) — MUST be legal
    ("מדע", "מדינה", 0.3473, False, "science vs state — different roots, high cosine"),
    ("עיתון", "ספר", 0.4019, False, "newspaper vs book — related meaning, different root"),
    ("חתול", "כלב", 0.5980, False, "cat vs dog — very high cosine, different roots"),
    ("אש", "ראש", 0.1083, False, "fire inside head — coincidental substring, OOV fallback"),
    ("אורות", "אש", 0.2082, False, "lights vs fire — different roots"),
    ("שמש", "ים", 0.1287, False, "sun vs sea — unrelated"),
    ("פרחח", "פרח", 0.3500, False, "punk vs flower — different roots (quadriliteral vs triliteral), high cosine stays legal"),
    # opaque etymological cognate — shares a root but a player wouldn't see it: legal via θ gate
    ("מלחמה", "לחם", 0.2761, False, "war vs bread — shared root לחמ, but cosine below θ"),
]


def _shares_root(a: str, b: str) -> bool:
    ra, rb = morph.roots(a), morph.roots(b)
    return probe._shares_root(ra, morph.root_sig(a), rb, morph.root_sig(b))


def _illegal(a: str, b: str, cos: float) -> bool:
    # mirrors legal_vocab_mask / shares_lemma: shared root AND transparent (cosine >= theta).
    return _shares_root(a, b) and cos >= THETA


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
    for clue, word, cos, expected, note in CASES:
        got = _illegal(clue, word, cos)
        status = "ok " if got == expected else "FAIL"
        if got != expected:
            failures.append((clue, word, expected, got, note))
        verdict = "illegal" if got else "legal"
        print(f"  [{status}] {clue:8}↔ {word:8} cos={cos:.3f} shares_root={_shares_root(clue, word)!s:5} → {verdict:7} ({note})")

    print()
    if failures:
        for clue, word, exp, got, note in failures:
            print(f"FAILED: {clue}↔{word} expected {'illegal' if exp else 'legal'}, got {'illegal' if got else 'legal'} — {note}")
        print(f"\n{len(failures)} failure(s).")
        return 1
    print(f"All {len(CASES)} legality cases pass (θ={THETA}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
