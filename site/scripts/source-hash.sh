#!/usr/bin/env bash
# Prints one SHA-256 over everything a build is made from: site/public, site/kit, assets/brand, assets/brands, and the inputs of the
# rendered pages (site/roadmap.json, SUPPORTERS.md, site/recipes.json and what it is exported from, the scripts that write pages).
set -euo pipefail
SITE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(cd "$SITE/.." && pwd)"
cd "$ROOT"
{ for d in site/public site/kit assets/brand assets/brands; do [ -d "$d" ] && find "$d" -type f -print0; done
  for f in site/roadmap.json site/licences-deps.json scripts/export-licences.mjs SUPPORTERS.md site/scripts/render-roadmap.py site/scripts/render-roles.py site/recipes.json scripts/export-recipes.mjs src/core/recipes.ts src/core/atlas.ts src/renderer/src/i18n/fr.json src/renderer/src/i18n/en.json site/scripts/shell.py site/scripts/apply-shell.py site/scripts/gen-legal.py; do [ -f "$f" ] && printf '%s\0' "$f"; done; } | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
