---
name: codenames-feedback
description: Pull and summarize user feedback (👍/👎 on clues) for the Hebrew Codenames co-pilot from the private HF dataset shmulc/codenames-feedback. Use when asked to "check feedback", "any new feedback", "grab feedback", review clue thumbs-up/down, or see what users complained about.
---

# Codenames feedback

Live 👍/👎 feedback on clues is written by the deployed Space
(`shmulc/hebrew-codenames-copilot`) and mirrored to the **private HF dataset
`shmulc/codenames-feedback`** (file `data/feedback.jsonl`). The truth is on HF —
the local `feedback/feedback.jsonl` is only a seed/mirror, so always query HF.

## Run

```bash
python .agents/skills/codenames-feedback/scripts/pull_feedback.py
```

Requires an HF token with read access to the dataset (the stored `~/.cache/huggingface/token`
is used automatically; no `HF_TOKEN` env needed). Uses `force_download` so you always get the
latest, not a cached snapshot.

## What it reports

- Verdict counts (👍/👎), time span, and how many rows are new vs the local mirror.
- Every written comment (these are the highest-signal rows — real complaints).
- Self-test rows (comment contains `ignore`/`test`) are flagged so you can discount them.

## Each row's fields

`ts, verdict, clue, count, intended, mode, risk, comment, board {words, roles}, revealed, focus, why`.
The full board + focus + revealed cards are stored, so any row is reproducible — feed it back
through the engine (see the `codenames-qa` skill's `bench_feedback.py`) to see what the current
engine would do on that exact board.

## Turning feedback into fixes

Downvotes cluster into: illegal clues (shared root — now caught), over-reach (a stretched
extra word), and taste (e.g. a more general clue preferred). See the project memory
(`spymaster-scoring-design`, `codenames-feedback-loop`) for the roadmap these drove.
