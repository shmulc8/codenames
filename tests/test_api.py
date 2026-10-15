"""Request-validation regression for the HTTP API (model-free: every case is rejected or answered
before an encoder loads).

Run: PYTHONPATH=src python tests/test_api.py
"""

import os
import tempfile

os.environ["FEEDBACK_DIR"] = tempfile.mkdtemp(prefix="cn_feedback_test_")

from codenames import app as appmod  # noqa: E402

W = ["חתול", "כלב", "ים", "שמש", "מלך", "ספר", "עץ", "בית", "רכבת", "אש"]
R = dict(
    zip(
        W,
        ["my", "my", "my", "opp", "opp", "opp", "neutral", "neutral", "neutral", "assassin"],
        strict=True,
    )
)
SPY, CHECK, OP, SPACE, FB = (
    "/api/coach/spymaster",
    "/api/coach/check",
    "/api/coach/operative",
    "/api/space",
    "/api/feedback",
)

CASES = [
    ("body is a list", SPY, [], 400),
    ("words is a string", SPY, {"words": "שלום", "roles": {}}, 400),
    ("roles missing", SPY, {"words": W}, 400),
    ("role missing for a card", SPY, {"words": W, "roles": {"חתול": "my"}}, 400),
    ("roles is a list", SPY, {"words": W, "roles": []}, 400),
    ("duplicate card", SPY, {"words": [*W, "חתול"], "roles": R}, 400),
    ("two assassins", SPY, {"words": W, "roles": {**R, "עץ": "assassin"}}, 400),
    ("26 cards", SPACE, {"words": [f"מ{i}" for i in range(26)], "roles": {}}, 400),
    ("blank card", SPY, {"words": [*W, " "], "roles": R}, 400),
    ("over-long card", SPY, {"words": [*W, "א" * 40], "roles": {**R, "א" * 40: "neutral"}}, 400),
    ("non-string card", SPY, {"words": [*W, 5], "roles": R}, 400),
    ("unknown risk", SPY, {"words": W, "roles": R, "risk": "yolo"}, 400),
    ("unknown vocab mode", SPY, {"words": W, "roles": R, "vocab_mode": "x"}, 400),
    ("revealed card not on board", SPY, {"words": W, "roles": R, "revealed": ["זברה"]}, 400),
    ("all cards revealed", SPY, {"words": ["חתול"], "roles": R, "revealed": ["חתול"]}, 400),
    ("check without clue", CHECK, {"words": W, "roles": R}, 400),
    ("check blank clue", CHECK, {"words": W, "roles": R, "clue": "  "}, 400),
    ("check two words", CHECK, {"words": W, "roles": R, "clue": "חדר אוכל"}, 400),
    ("check maqaf compound", CHECK, {"words": W, "roles": R, "clue": "בית־ספר"}, 400),
    ("check latin clue", CHECK, {"words": W, "roles": R, "clue": "cat"}, 400),
    ("check digits", CHECK, {"words": W, "roles": R, "clue": "חתול2"}, 400),
    ("operative count string", OP, {"words": W, "roles": R, "clue": "חיה", "count": "abc"}, 400),
    ("operative count 0", OP, {"words": W, "roles": R, "clue": "חיה", "count": 0}, 400),
    ("operative count bool", OP, {"words": W, "roles": R, "clue": "חיה", "count": True}, 400),
    ("feedback non-string uid", FB, {"uid": 123, "verdict": "up"}, 400),
    ("feedback without verdict", FB, {"uid": "x"}, 400),
    (
        "feedback huge option",
        FB,
        {"uid": "x", "verdict": "up", "option": {"r": ["x" * 30000]}},
        400,
    ),
    ("body over the size cap", FB, {"uid": "x", "verdict": "up", "comment": "x" * 70000}, 413),
    ("unknown route", "/api/nope", {}, 404),
]


def main() -> int:
    client = appmod.app.test_client()
    failures = 0
    for name, path, body, want in CASES:
        r = client.post(path, json=body)
        js = r.get_json(silent=True)
        ok = r.status_code == want and isinstance(js, dict) and isinstance(js.get("error"), str)
        failures += not ok
        print(
            f"  [{'ok ' if ok else 'FAIL'}] {name:30s} {r.status_code} {(js or {}).get('error', '')[:50]}"
        )

    # not JSON at all → JSON 400
    r = client.post(CHECK, data=b"not json", content_type="application/json")
    failures += not (r.status_code == 400 and r.is_json)

    # one live card: the map answers without touching the encoder (MDS needs >= 2 points)
    r = client.post(SPACE, json={"words": ["חתול"], "roles": {"חתול": "my"}})
    ok = r.status_code == 200 and r.get_json()["coords"] == {"חתול": [0.0, 0.0]}
    failures += not ok
    print(f"  [{'ok ' if ok else 'FAIL'}] {'space with one live card':30s} {r.status_code}")

    # clue policy: geresh / gershayim / niqqud are accepted, niqqud stripped
    for clue, want in (("ג'ירפה", "ג'ירפה"), ('צה"ל', 'צה"ל'), ("צ׳יפס", "צ׳יפס"), ("רוּחַ", "רוח")):
        with appmod.app.test_request_context(json={"clue": clue}):
            got = appmod.clue_from({"clue": clue})
        ok = got == want
        failures += not ok
        print(f"  [{'ok ' if ok else 'FAIL'}] clue {clue!r:12} → {got!r}")

    # revealed cards (strings or the UI's {word, chosenBy}) are removed from the board
    b = appmod.board_from({"words": W, "roles": R, "revealed": ["חתול", {"word": "אש"}]})
    ok = "חתול" not in b.words and "אש" not in b.words and len(b.words) == len(W) - 2
    failures += not ok
    print(f"  [{'ok ' if ok else 'FAIL'}] revealed removed server-side")

    # feedback rate limit: the 21st row in a minute from one client is refused
    codes = [
        client.post(
            FB, json={"uid": "rl", "verdict": "up"}, headers={"X-Forwarded-For": "9.9.9.9"}
        ).status_code
        for _ in range(appmod.FB_RATE + 1)
    ]
    ok = codes[:-1] == [200] * appmod.FB_RATE and codes[-1] == 429
    failures += not ok
    print(f"  [{'ok ' if ok else 'FAIL'}] feedback rate limit → {codes[-2:]}")

    print(f"\n{'All API validation cases pass.' if not failures else f'{failures} failure(s).'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
