---
name: codenames-qa
description: QA the Hebrew Codenames engine — run the clue-legality regression, the clue-quality benchmark against the feedback set, and optionally verify the live HF Space. Use before committing engine changes, after tuning scoring or legality, or when asked to "run QA", "run the tests", "run the benchmark", or "check the engine still works".
---

# Codenames QA

Three checks, cheapest first. All run from the repo root. The offline ones need the compressed
fastText model the app uses:

```bash
export FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin
```

## 1. Legality regression (fast, model-free — run this on every change)

```bash
python tests/test_legality.py
```

Locks in the shared-root + transparency-gate behaviour (the `מדע`/`מדען` bug, the opaque
cognate `מלחמה`/`לחם` staying legal) using calibrated fastText cosines. **Must print
`All 18 legality cases pass`.** If you change `ROOT_TRANSPARENCY_THETA` or the root lexicon and
a case flips, that's the intended trip-wire — re-judge, don't just edit the expectation.

## 2. Clue-quality benchmark against real feedback

```bash
python -m research.bench_feedback
```

Reconstructs every 👍/👎 spymaster board (from the HF feedback dataset) and reports:
- **engine health** — served-clue legality (must be 100%), mean safe-run, safe-for-count;
- **learning from 👎** — how many disliked clues are now flagged illegal / still served;
- **retention of 👍** — how many liked clues are still in the shortlist.

Health metrics are the robust signal. Learning/retention are directional (small N, prior-engine
clues) — read them as trends, not pass/fail.

## 3. Verify the live Space (after a deploy)

```bash
python .agents/skills/codenames-qa/scripts/verify_live.py
```

POSTs to the deployed endpoints and asserts: `מדען` illegal next to `מדע`, `מלחמה` legal next to
`לחם`, a spymaster clue generates for each risk profile, and the input guards return clean 400s
(unknown role, empty board). Pass `--base <url>` to target a different host (default is the public
Space). Only meaningful once the Space build stage is `RUNNING` (see the `codenames-deploy` skill).

## When to run what

- Editing legality/scoring in `probe.py` → **1 + 2** before committing.
- After `codenames-deploy` → **3** once the Space is `RUNNING`.
