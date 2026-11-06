#!/usr/bin/env bash
# Fails if a branch changes files its owner doesn't own (docs/WORK_SPLIT.md §2).
#   a/*        -> only Person A's paths (+ pnpm-lock.yaml)
#   b/*        -> only Person B's paths (+ pnpm-lock.yaml)
#   x/*, fix/* -> no check, just print the changed files
set -euo pipefail

BRANCH="${GITHUB_HEAD_REF:-$(git branch --show-current)}"
BASE="${OWNERSHIP_BASE:-origin/main}"

A_PATHS=(
  "contracts/" "apps/api/" "packages/shared/" "packages/sdk-node/" "scripts/" ".github/"
  "package.json" "pnpm-workspace.yaml" "tsconfig.base.json" ".gitignore" ".nvmrc" ".npmrc" ".env.example"
  "docs/EVIDENCE.md" "docs/tasks/PERSON_A.md" "docs/feedback/A.md"
  "README.md" "WHITECHAIN_FEEDBACK.md"
)
B_PATHS=(
  "apps/web/" "apps/store/" "tools/mock-api/"
  "docs/design/" "docs/readme/" "docs/tasks/PERSON_B.md" "docs/feedback/B.md"
)
BOTH=("pnpm-lock.yaml")

# Files changed on this branch since it left main.
CHANGED="$(git diff --name-only "$(git merge-base "$BASE" HEAD)" HEAD)"

echo "Branch: $BRANCH (vs $BASE)"
if [[ -z "$CHANGED" ]]; then
  echo "No changed files."
  exit 0
fi

owns() { # owns <file> <paths...>
  local file="$1"; shift
  local p
  for p in "$@"; do
    if [[ "$p" == */ ]]; then
      [[ "$file" == "$p"* ]] && return 0
    else
      [[ "$file" == "$p" ]] && return 0
    fi
  done
  return 1
}

case "$BRANCH" in
  a/*) OWNER="A"; ALLOWED=("${A_PATHS[@]}" "${BOTH[@]}") ;;
  b/*) OWNER="B"; ALLOWED=("${B_PATHS[@]}" "${BOTH[@]}") ;;
  x/*|fix/*)
    echo "Branch '$BRANCH' skips the ownership check. Changed files:"
    echo "$CHANGED" | sed 's/^/  /'
    exit 0 ;;
  *)
    echo "ERROR: branch '$BRANCH' must start with a/, b/, x/ or fix/ (see docs/WORK_SPLIT.md §3)."
    exit 1 ;;
esac

BAD=()
while IFS= read -r f; do
  owns "$f" "${ALLOWED[@]}" || BAD+=("$f")
done <<< "$CHANGED"

if (( ${#BAD[@]} > 0 )); then
  echo "ERROR: Person $OWNER's branch changes files outside Person $OWNER's paths:"
  printf '  %s\n' "${BAD[@]}"
  echo "Restore them with: git checkout $BASE -- <file>, then ask the owner (or use an x/ branch)."
  exit 1
fi

echo "OK: all $(echo "$CHANGED" | wc -l | tr -d ' ') changed files belong to Person $OWNER."
