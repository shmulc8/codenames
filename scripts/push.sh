#!/usr/bin/env bash
# Push to shmulc8/codenames without the account dance. Local git/ssh here resolve to a
# different GitHub account that can't write to shmulc8, so we borrow gh's credential for the
# shmulc8 account for one push and restore whatever account was active afterwards.
#   make push            # pushes current branch to origin
#   make push BRANCH=x   # pushes branch x
set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"
REMOTE_URL="https://github.com/shmulc8/codenames.git"

prev="$(gh api user --jq .login 2>/dev/null || true)"        # currently active gh account
restore() { [ -n "$prev" ] && gh auth switch -h github.com -u "$prev" >/dev/null 2>&1 || true; }
trap restore EXIT

gh auth switch -h github.com -u shmulc8 >/dev/null
echo "▶ pushing $BRANCH → shmulc8/codenames (as shmulc8)"
git -c credential.helper= -c credential.helper='!gh auth git-credential' \
    push "$REMOTE_URL" "$BRANCH"
