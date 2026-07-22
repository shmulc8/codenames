---
name: codenames-deploy
description: Deploy the Hebrew Codenames co-pilot to its HF Space (shmulc/hebrew-codenames-copilot) by uploading changed files from hf_space/, and report the build stage. Use when asked to "deploy", "push to HF", "ship the Space", or "release the co-pilot".
---

# Codenames deploy

The `hf_space/` directory is the deploy bundle for the Space
`shmulc/hebrew-codenames-copilot`. It is **not its own git repo** — deployment uploads files to
the Space via `huggingface_hub`. Upload only the files that changed and leave the large fastText
binaries (`data/cc.he.300.*`, hundreds of MB) already in the Space untouched.

## Before deploying

- This is **outward-facing**: it publishes to the live Space and triggers a Docker rebuild.
  Confirm with the user first unless already told to ship.
- Make sure `hf_space/` is in sync with any dev-tree change (the dev `probe.py` differs
  structurally from `hf_space/probe.py`; `app.py`/`morph.py` are kept identical — apply edits to
  both). Run the `codenames-qa` legality regression first.
- Requires an HF token with **write** access to the Space (`~/.cache/huggingface/token`).

## Run

```bash
# default: upload the app/engine files most changes touch
python .agents/skills/codenames-deploy/scripts/deploy.py

# or name the changed files explicitly (paths relative to hf_space/)
python .agents/skills/codenames-deploy/scripts/deploy.py probe.py app.py data/word2root.json
```

It uploads the given files from `hf_space/` in one commit, prints the commit URL, and reports the
build stage. The stage goes `RUNNING_BUILDING` → `RUNNING`; the old build keeps serving until the
new image is up.

## After deploying

Once the stage is `RUNNING`, verify live with the `codenames-qa` skill:

```bash
python .agents/skills/codenames-qa/scripts/verify_live.py
```
