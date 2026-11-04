#!/usr/bin/env bash
# Pre-commit hook: run sogoma-check on the staged files.
# Install, from the repository root: ln -s ../../tools/sogoma-check/pre-commit-hook.sh .git/hooks/pre-commit
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
mapfile -t staged < <(git diff --cached --name-only --diff-filter=ACM)
[ "${#staged[@]}" -eq 0 ] && exit 0
cd "$root"
exec python3 -I tools/sogoma-check/sogoma_check.py --root "$root" "${staged[@]}"
