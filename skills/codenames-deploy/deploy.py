"""Deploy changed files from hf_space/ to the HF Space and report the build stage.

Run from the repo root:
    python skills/codenames-deploy/deploy.py [file ...]   # paths relative to hf_space/
Defaults to the app/engine files most changes touch. Needs an HF token with write access.
"""
import sys

REPO_ID = "shmulc/hebrew-codenames-copilot"
DEFAULT_FILES = ["probe.py", "app.py", "morph.py", "data/word2root.json"]


def main(argv) -> int:
    files = argv or DEFAULT_FILES
    msg = "Update " + ", ".join(files)

    from huggingface_hub import HfApi
    api = HfApi()
    print(f"deploying to {REPO_ID}: {files}")
    url = api.upload_folder(
        folder_path="hf_space",
        repo_id=REPO_ID,
        repo_type="space",
        allow_patterns=files,
        commit_message=msg,
    )
    print("commit:", url)
    try:
        stage = getattr(api.space_info(REPO_ID).runtime, "stage", "?")
        print("build stage:", stage, "(watch for it to reach RUNNING)")
    except Exception as e:
        print("could not read build stage:", e)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
