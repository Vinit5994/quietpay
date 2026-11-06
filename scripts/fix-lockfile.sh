#!/usr/bin/env bash
# Resolve a pnpm-lock.yaml conflict during a rebase (docs/WORK_SPLIT.md §6).
# Never resolve the lockfile by hand: take main's copy and let pnpm regenerate it.
set -euo pipefail

GIT_DIR="$(git rev-parse --git-dir)"
if [[ ! -d "$GIT_DIR/rebase-merge" && ! -d "$GIT_DIR/rebase-apply" ]]; then
  echo "Not in a rebase. Run: git fetch origin && git rebase origin/main, then rerun this on a lockfile conflict."
  exit 1
fi

git checkout origin/main -- pnpm-lock.yaml
pnpm install
git add pnpm-lock.yaml
GIT_EDITOR=true git rebase --continue
