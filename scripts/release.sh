#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: current directory is not a git repository." >&2
  exit 1
fi

if [[ "${1:-}" == "" ]]; then
  echo "Usage: ./scripts/release.sh \"commit message\""
  exit 1
fi

if [[ -z "$(git status --porcelain)" ]]; then
  echo "No changes to commit."
  exit 0
fi

MESSAGE="$1"

git add -A
git commit -m "$MESSAGE"
git push origin main

echo "Done: pushed to origin/main"
