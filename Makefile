.DEFAULT_GOAL := help

PYTHON ?= .venv/bin/python

.PHONY: help install test serve build-site research deploy deploy-dry push

help:
	@printf '%s\n' \
		'install      Create the virtual environment and install dependencies' \
		'test         Run the legality regression' \
		'serve        Start the local co-pilot server' \
		'build-site   Rebuild the static cross-encoder map' \
		'research     List the available research commands' \
		'deploy       Sync + build UI + legality gate + upload to the Space + verify' \
		'deploy-dry   Everything deploy does except the upload (safe dry run)' \
		'push         Push the current branch to shmulc8/codenames (handles the gh account)'

install:
	python3 -m venv .venv
	$(PYTHON) -m pip install -r requirements.txt

test:
	$(PYTHON) tests/test_legality.py

serve:
	HF_HUB_OFFLINE=1 $(PYTHON) app.py

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
