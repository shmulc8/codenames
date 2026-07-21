.DEFAULT_GOAL := help

PYTHON ?= .venv/bin/python

.PHONY: help install test serve build-site research

help:
	@printf '%s\n' \
		'install      Create the virtual environment and install dependencies' \
		'test         Run the legality regression' \
		'serve        Start the local co-pilot server' \
		'build-site   Rebuild the static cross-encoder map' \
		'research     List the available research commands'

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
