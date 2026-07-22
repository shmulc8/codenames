"""One-command deploy for the Hebrew Codenames co-pilot.

    make deploy            # full: sync, build, legality gate, upload, wait, verify
    make deploy-dry        # everything except the upload (safe to run anytime)

The repo root is the single source of truth for code. The engine modules and served HTML the Space
needs are *generated* into `hf_space/` here and git-ignored there (see .gitignore), so no code is
maintained in two places. The UI is built straight into `hf_space/webapp/` (see ui/vite.config.ts).
`hf_space/` commits its own deploy files (Dockerfile, requirements.txt, README, .gitattributes) plus
`hf_space/data/` — a prod-curated data subset that intentionally differs from the dev root/data. The
237 MB fastText binaries already live in the Space and are never re-uploaded.
"""

import argparse
import os
import subprocess
import sys
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HF = os.path.join(REPO, "hf_space")
REPO_ID = "shmulc/hebrew-codenames-copilot"

# Code files mirrored root → hf_space at deploy time (repo-root-relative paths). These are the ONLY
# copies of this content in the tree; the hf_space versions are generated and git-ignored, so the
# two can never silently drift (this is what let the deployed morph.py fall behind the dev one).
# NOTE: data/ is deliberately NOT mirrored — hf_space/data/ carries a prod-curated subset that
# intentionally differs from the dev root/data (trimmed vocab / freq list), so it stays committed.
SHARED = [
    # engine package (imported as `codenames` — Dockerfile sets PYTHONPATH=/app/src)
    "src/codenames/__init__.py",
    "src/codenames/app.py",
    "src/codenames/probe.py",
    "src/codenames/morph.py",
    "src/codenames/exp_encoders.py",
    "src/codenames/deck_he.py",
    "src/codenames/guesser.py",
    # served HTML
    "copilot.html",
    "methods.html",
]
# Already in the Space (huge) or local-only junk — never upload.
IGNORE = ["data/cc.he.300.*", "**/__pycache__/**", "*.pyc", "**/.DS_Store"]


def _log(msg):
    print(f"\033[1m▶ {msg}\033[0m", flush=True)


def sync_shared():
    _log("sync shared files root → hf_space")
    changed, missing = [], []
    for f in SHARED:
        src, dst = os.path.join(REPO, f), os.path.join(HF, f)
        if not os.path.exists(src):
            missing.append(f)
            continue
        a = open(src, "rb").read()
        b = open(dst, "rb").read() if os.path.exists(dst) else None
        if a != b:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            open(dst, "wb").write(a)
            changed.append(f)
    print(f"  synced: {changed or 'all already in sync'}")
    if missing:
        sys.exit(f"✗ source file(s) missing at root — cannot build bundle: {missing}")


def build_ui():
    _log("build UI → hf_space/webapp (vite, emptyOutDir)")
    subprocess.run(["npm", "run", "build"], cwd=os.path.join(REPO, "ui"), check=True)


def legality_gate():
    _log("legality regression (gate)")
    env = dict(os.environ, FASTTEXT_COMPRESSED=os.path.join("data", "cc.he.300.fp16.bin"))
    r = subprocess.run(
        [sys.executable, "tests/test_legality.py"],
        cwd=REPO,
        env=env,
        capture_output=True,
        text=True,
    )
    tail = (r.stdout + r.stderr).strip().splitlines()[-1:] or [""]
    print("  " + tail[0])
    if r.returncode != 0 or "cases pass" not in (r.stdout + r.stderr):
        sys.exit("✗ legality gate failed — aborting deploy")


def upload():
    _log(f"upload hf_space/ → {REPO_ID}")
    os.environ["HF_HUB_OFFLINE"] = "0"  # offline mode would block the upload
    from huggingface_hub import HfApi

    api = HfApi()
    url = api.upload_folder(
        folder_path=HF,
        repo_id=REPO_ID,
        repo_type="space",
        ignore_patterns=IGNORE,
        commit_message="deploy via make deploy",
    )
    print(f"  commit: {url}")
    return api


def wait_running(api, timeout=600):
    _log("wait for build → RUNNING")
    deadline = time.time() + timeout
    stage = "?"
    while time.time() < deadline:
        stage = getattr(api.space_info(REPO_ID).runtime, "stage", "?")
        print(f"  stage: {stage}")
        if stage == "RUNNING":
            return True
        if "ERROR" in (stage or "") or stage in ("BUILD_ERROR", "RUNTIME_ERROR"):
            sys.exit(f"✗ build failed at stage {stage}")
        time.sleep(15)
    print(f"  (still {stage} after {timeout}s — check the Space)")
    return False


def verify():
    v = os.path.join(REPO, ".claude/skills/codenames-qa/scripts/verify_live.py")
    if os.path.exists(v):
        _log("verify live Space")
        subprocess.run([sys.executable, v], cwd=REPO)
    else:
        print("  (verify_live.py not present — verify the Space manually)")


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="sync + build + gate, no upload")
    ap.add_argument("--skip-build", action="store_true", help="reuse the current hf_space/webapp")
    ap.add_argument("--no-verify", action="store_true")
    args = ap.parse_args(argv)

    sync_shared()
    if not args.skip_build:
        build_ui()
    legality_gate()
    if args.dry_run:
        _log("dry run complete — hf_space/ is ready to upload (skipped)")
        return 0
    api = upload()
    if wait_running(api) and not args.no_verify:
        verify()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
