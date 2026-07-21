"""Smoke-verify the live Hebrew Codenames Space: legality, spymaster generation, input guards.

Run from the repo root (needs `probe` to build a sample board):
    python .claude/skills/codenames-qa/scripts/verify_live.py [--base https://shmulc-hebrew-codenames-copilot.hf.space]
Exits non-zero if any assertion fails.
"""
import argparse
import json
import os
import random
import sys
import urllib.error
import urllib.request

os.environ.setdefault("FASTTEXT_COMPRESSED", "data/cc.he.300.fp16.bin")
sys.path.insert(0, os.getcwd())   # run from the repo root so `import probe` resolves
DEFAULT_BASE = "https://shmulc-hebrew-codenames-copilot.hf.space"


def post(base, path, payload):
    req = urllib.request.Request(base + path, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:200]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=DEFAULT_BASE)
    base = ap.parse_args().base

    ok = True

    def check(desc, cond, detail=""):
        nonlocal ok
        ok = ok and cond
        print(f"  [{'PASS' if cond else 'FAIL'}] {desc}{('  ' + detail) if detail else ''}")

    print(f"verifying {base}")
    print("== legality ==")
    for clue, w0, want_illegal in [("מדען", "מדע", True), ("מלחמה", "לחם", False), ("מדינה", "מדע", False)]:
        st, r = post(base, "/api/coach/check",
                     {"words": [w0, "כלב", "ים", "שולחן"], "roles": {w0: "my"}, "clue": clue})
        got = isinstance(r, dict) and r.get("illegal")
        check(f"{clue} vs {w0} → illegal={got}", st == 200 and got == want_illegal, f"(want {want_illegal})")

    print("== spymaster ==")
    import probe
    b = probe.sample_board(random.Random(1))
    for risk in ("cautious", "balanced", "bold"):
        st, r = post(base, "/api/coach/spymaster", {"words": b.words, "roles": b.role, "risk": risk})
        good = st == 200 and isinstance(r, dict) and r.get("clue")
        check(f"{risk} clue", good, f"→ {r.get('clue')}·{r.get('count')}" if isinstance(r, dict) else str(r))

    print("== input guards (expect 400) ==")
    st, _ = post(base, "/api/coach/spymaster",
                 {"words": ["חתול", "כלב"], "roles": {"חתול": "assasin", "כלב": "my"}})
    check("unknown role → 400", st == 400)
    st, _ = post(base, "/api/coach/check", {"words": [], "clue": "בדיקה"})
    check("empty board → 400", st == 400)

    print("\n" + ("ALL PASS ✓" if ok else "FAILURES ✗"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
