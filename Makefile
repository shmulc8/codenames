.DEFAULT_GOAL := help

PYTHON ?= .venv/bin/python

.PHONY: help install test lint format format-check typecheck check serve build-site research deploy deploy-dry push

help:
	@printf '%s\n' \
		'install      Create the virtual environment and install dependencies' \
		'test         Run the legality regression' \
		'lint         Lint with ruff' \
		'format       Auto-format with ruff' \
		'format-check Check formatting without writing (CI)' \
		'typecheck    Run mypy (advisory — known baseline, not a gate)' \
		'check        lint + format-check + test (the CI gate, run before pushing)' \
		'serve        Start the local co-pilot server' \
		'build-site   Rebuild the static cross-encoder map' \
		'research     List the available research commands' \
		'deploy       Sync + build UI + legality gate + upload to the Space + verify' \
		'deploy-dry   Everything deploy does except the upload (safe dry run)' \
		'push         Push the current branch to shmulc8/codenames (handles the gh account)'

install:
	python3 -m venv .venv
	$(PYTHON) -m pip install -r requirements.txt
	$(PYTHON) -m pip install -e .

test:
	FASTTEXT_COMPRESSED=data/cc.he.300.fp16.bin $(PYTHON) tests/test_legality.py

lint:
	$(PYTHON) -m ruff check .

format:
	$(PYTHON) -m ruff format .

format-check:
	$(PYTHON) -m ruff format --check .

typecheck:
	$(PYTHON) -m mypy

check: lint format-check test

serve:
	HF_HUB_OFFLINE=1 $(PYTHON) -m codenames.app

build-site:
	HF_HUB_OFFLINE=1 $(PYTHON) scripts/build_site.py

research:
	@sed -n '1,200p' research/README.md

deploy:
	$(PYTHON) scripts/deploy.py

deploy-dry:
	$(PYTHON) scripts/deploy.py --dry-run

push:
	@bash scripts/push.sh $(BRANCH)
