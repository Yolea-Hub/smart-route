#!/usr/bin/env bash
# Copies the subset of the Sogoma kit that the site loads into site/kit/, so the site is self-contained for a deploy.
# Source: the repository-root kit/ (required). The copy is never edited by hand.
#   bash site/scripts/sync-kit.sh            copy
#   bash site/scripts/sync-kit.sh --check    exit 1 when site/kit differs from its source
set -euo pipefail
SITE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$SITE/.." && pwd)"
SRC="$ROOT/kit"
[ -d "$SRC/tokens" ] || { echo "sync-kit: the repository-root kit/ is missing ($SRC/tokens not found). Restore kit/ (the Sogoma kit) at the repository root." >&2; exit 2; }
DEST="$SITE/kit"
FILES=(logos/yolea-lockup-on-sky.svg logos/yolea-lockup.svg logos/yolea-lockup-reversed.svg tokens/tokens.css fonts/fallbacks.css css/base.css css/components.css web/sg-theme.js fonts/LICENCES)
# Every font file base.css names, nothing else.
while IFS= read -r f; do FILES+=("fonts/$f"); done < <(grep -o 'url("\.\./fonts/[^"]*")' "$SRC/css/base.css" | sed 's/^url("\.\.\/fonts\///; s/")$//' | sort -u)
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
for f in "${FILES[@]}"; do
  [ -e "$SRC/$f" ] || { echo "sync-kit: missing $SRC/$f" >&2; exit 2; }
  mkdir -p "$STAGE/$(dirname "$f")"
  cp -R "$SRC/$f" "$STAGE/$f"
done
printf 'source: kit/ (repository root)\n' > "$STAGE/SYNCED-FROM.txt"
( cd "$STAGE" && find . -type f ! -name SYNCED-FROM.txt -print0 | sort -z | xargs -0 sha256sum ) > "$STAGE/CHECKSUMS.sha256"
if [ "${1:-}" = "--check" ]; then
  [ -d "$DEST" ] || { echo "sync-kit --check: site/kit is absent" >&2; exit 1; }
  if diff -rq -x SYNCED-FROM.txt "$STAGE" "$DEST" >/dev/null; then echo "sync-kit: site/kit matches $SRC"; exit 0; fi
  echo "sync-kit --check: site/kit differs from $SRC" >&2; exit 1
fi
rm -rf "$DEST"; mkdir -p "$DEST"
cp -R "$STAGE"/. "$DEST"/
echo "sync-kit: $(find "$DEST" -type f | wc -l) files copied from $SRC to site/kit"
