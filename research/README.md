# Research tools

Run these commands from the repository root with the virtual environment enabled.
They import the serving engine but do not change the deployed `hf_space/` mirror.

## Evaluation

- `python -m research.bench_feedback` — compare current clues with collected feedback.
- `python -m research.bench_intrinsic --encoders fasttext` — run association and similarity checks.
- `python -m research.bench_recovery --encoders fasttext` — measure LLM-guesser recovery.
- `python -m research.bench --n 15 --no-judge --configs geom` — run the synthetic-board benchmark.
- `python -m research.compare_encoders` — compare encoder recovery behavior.

## Tuning

- `python -m research.tune_clue --boards 24 --configs 40` — search clue-scoring profiles.
- `python -m research.validate_profiles --profiles data/tuned_profiles.json` — remeasure profiles.
- `python -m research.optuna_tune --trials 60 --boards 15` — tune scoring hyperparameters.

## External evaluators

- `python -m research.novita_eval --provider openrouter` — evaluate with a configured provider.
- `python -m research.oracle --n 12` — compare live-server clues with the local LLM judge.

Keep provider credentials in environment variables. Generated result snapshots are ignored by Git.
