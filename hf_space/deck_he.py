"""Hebrew Codenames board deck — 573 single-word nouns.

Source: the `yaeldau/code-names` Hebrew Codenames implementation
(src/words/hebrew.json). These are the *board* words; clues are drawn from a
separate large frequency vocabulary (see probe.load_clue_vocab), per the
standard Codenames-AI setup (Koyyalagunta et al. 2021).
"""

import json
import os

_p = os.path.join(os.path.dirname(__file__), "data", "yaeldau_hebrew.json")
with open(_p, encoding="utf-8") as f:
    _raw = json.load(f)

_seen = set()
DECK = [w for w in (x.strip() for x in _raw) if w and not (w in _seen or _seen.add(w))]
