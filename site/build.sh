#!/usr/bin/env bash
# Builds the static site into site/dist: public/ + the kit subset + the brand assets the pages name, with cache-busting.
#   bash site/build.sh
# Writes site/dist.stamp (next to dist, never inside what is uploaded): the hash of the sources and, in a git checkout, HEAD.
# deploy/guard-fresh-build.sh refuses a deploy when that stamp is missing or no longer matches the sources.
set -euo pipefail
SITE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SITE/.." && pwd)"
DIST="$SITE/dist"
bash "$SITE/scripts/sync-kit.sh"
rm -f "$SITE/dist.stamp"
# Licences page: the production dependency list comes from the installed packages (needs pnpm install), then the legal pages are rewritten.
node "$ROOT/scripts/export-licences.mjs" "$SITE/licences-deps.json"
python3 -I "$SITE/scripts/gen-legal.py" >/dev/null
python3 -I "$SITE/scripts/fr-typo.py" >/dev/null
mkdir -p "$DIST"
find "$DIST" -mindepth 1 -delete
cp -R "$SITE/public/." "$DIST/"
# Support pages: board, buttons and supporters rendered from site/roadmap.json and SUPPORTERS.md.
python3 -I "$SITE/scripts/render-roadmap.py" "$DIST"
# Roles and Atlas sections: one recipe per role, from the same data as the application (src/core/recipes.ts, src/core/atlas.ts).
# The JSON is exported first, so the site cannot drift from the application (needs the dev dependencies: pnpm install).
node "$ROOT/scripts/export-recipes.mjs" "$SITE/recipes.json"
python3 -I "$SITE/scripts/render-roles.py" "$DIST"
mkdir -p "$DIST/kit"
( cd "$SITE/kit" && find . -type f ! -name CHECKSUMS.sha256 ! -name SYNCED-FROM.txt -print0 | xargs -0 -I{} cp --parents {} "$DIST/kit/" )
# Brand assets: exactly the files the pages name.
while IFS= read -r ref; do
  rel="${ref#/}"
  src="$ROOT/$rel"
  [ -f "$src" ] || { echo "build: $ref is named by a page but $src does not exist" >&2; exit 1; }
  mkdir -p "$DIST/$(dirname "$rel")"
  cp "$src" "$DIST/$rel"
done < <(grep -rhoE '/assets/brands?/[A-Za-z0-9._/-]+' "$DIST" --include='*.html' --include='*.css' --include='*.js' | sort -u)
# Every root-absolute file a page names must exist in dist.
missing=0
while IFS= read -r ref; do
  ref="${ref%%\?*}"
  case "$ref" in /|/en/|/mentions-legales/|/confidentialite/|/accessibilite/|/licences/|/en/*/) continue ;; esac
  [ -e "$DIST$ref" ] || { echo "build: missing in dist: $ref" >&2; missing=1; }
done < <(grep -rhoE '(href|src)="/[^"]*"' "$DIST" --include='*.html' | sed -E 's/^(href|src)="//; s/"$//' | sort -u)
[ "$missing" = 0 ] || exit 1
# Cache-busting: the stylesheets and scripts the pages name get ?v=<first 10 hex of their SHA-256>.
for f in site.css site.js kit/tokens/tokens.css kit/fonts/fallbacks.css kit/css/base.css kit/css/components.css kit/web/sg-theme.js; do
  h="$(sha256sum "$DIST/$f" | cut -c1-10)"
  find "$DIST" -name '*.html' -print0 | xargs -0 sed -i -E "s#(href|src)=\"/$f\"#\\1=\"/$f?v=$h\"#g"
done
# The build says what it was made from.
{ printf 'sources %s\n' "$(bash "$SITE/scripts/source-hash.sh")"
  if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then printf 'head %s\n' "$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo none)"; fi
  printf 'built %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"; } > "$SITE/dist.stamp"
echo "build ok: $DIST ($(find "$DIST" -type f | wc -l) files, $(du -sh "$DIST" | cut -f1))"
