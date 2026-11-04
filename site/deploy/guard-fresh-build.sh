#!/usr/bin/env bash
# Refuses a deploy of a build that is absent, incomplete, a draft, older than its sources, or (in a git checkout) made from another commit or a dirty tree.
# Run by `pnpm run deploy:site` and by wrangler itself (build.command), so a bare `wrangler deploy` is guarded too.
#   guard-fresh-build.sh <build folder>        (the folder is site/dist; site/dist.stamp sits next to it, never inside what is uploaded)
# build.sh writes the stamp: the hash of the sources (scripts/source-hash.sh) and, in a git checkout, HEAD.
# GUARD_DRY_RUN=1 (set only by `pnpm run dry`, which deploys nothing) checks that the folder exists and stops there,
# and only when a parent process really runs with --dry-run: the variable alone never skips the checks of a real deploy.
set -u
if [ "$#" -ne 1 ]; then
	echo "usage: guard-fresh-build.sh <build folder>" >&2
	exit 2
fi
DIR="${1%/}"
REBUILD="bash site/build.sh"
refuse() {
	printf 'REFUS : %s\nREFUSED: %s\nReconstruire depuis la racine du dépôt / Rebuild from the repository root: %s\n' "$1" "$2" "$REBUILD" >&2
	exit 1
}
[ -d "$DIR" ] || refuse "le dossier $DIR est absent." "the folder $DIR is absent."
really_dry_run() { # walks up the parents through /proc; without /proc the answer is no
	local pid=$PPID
	while [ -n "$pid" ] && [ "$pid" -gt 1 ] && [ -r "/proc/$pid/cmdline" ]; do
		tr '\0' '\n' < "/proc/$pid/cmdline" | grep -qx -- '--dry-run' && return 0
		pid="$(awk '/^PPid:/ { print $2 }' "/proc/$pid/status")"
	done
	return 1
}
if [ "${GUARD_DRY_RUN:-}" = "1" ]; then
	really_dry_run || refuse "GUARD_DRY_RUN=1 sans --dry-run : la vérification ne s'efface pas pour un vrai déploiement." "GUARD_DRY_RUN=1 without --dry-run: the checks do not step aside for a real deploy."
	echo "guard: dry run, nothing is deployed; the folder $DIR exists"
	exit 0
fi
SITE="$(cd "$DIR/.." && pwd)"
ROOT="$(cd "$SITE/.." && pwd)"
for f in index.html en/index.html 404.html _headers robots.txt kit/css/base.css site.css site.js; do
	[ -f "$DIR/$f" ] || refuse "$DIR/$f est absent : ce dossier n'est pas une construction complète." "$DIR/$f is absent: this folder is not a complete build."
done
grep -qx 'Disallow: /' "$DIR/robots.txt" && refuse "$DIR/robots.txt interdit tout : ce n'est pas une construction de production." "$DIR/robots.txt disallows everything: this is not a production build."
STAMP="$SITE/dist.stamp"
[ -f "$STAMP" ] || refuse "$STAMP est absent : cette construction ne dit pas de quoi elle vient." "$STAMP is absent: this build does not say what it was made from."
# The kit copy must still equal its source, and the sources must be those the build was made from.
bash "$SITE/scripts/sync-kit.sh" --check >&2 || refuse "site/kit ne correspond plus à kit/ (scripts/sync-kit.sh)." "site/kit no longer matches kit/ (scripts/sync-kit.sh)."
WANT="$(awk '$1=="sources" {print $2}' "$STAMP")"
NOW="$(bash "$SITE/scripts/source-hash.sh")"
[ -n "$WANT" ] && [ "$WANT" = "$NOW" ] || refuse "les sources ont changé depuis la construction (empreinte $NOW, attendue $WANT)." "the sources changed since the build (hash $NOW, expected $WANT)."
if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
	DIRTY="$(git -C "$ROOT" status --porcelain -- site ':!site/dist' ':!site/dist.stamp' assets/brand assets/brands)"
	if [ -n "$DIRTY" ]; then
		printf '%s\n' "$DIRTY" | head -20 >&2
		refuse "des fichiers non enregistrés existent sous site/ ou assets/." "uncommitted files exist under site/ or assets/."
	fi
	HEAD_SHA="$(git -C "$ROOT" rev-parse HEAD)"
	[ "$(awk '$1=="head" {print $2}' "$STAMP")" = "$HEAD_SHA" ] || refuse "la construction vient d'un autre commit que HEAD ($HEAD_SHA)." "the build comes from a commit other than HEAD ($HEAD_SHA)."
fi
echo "build ok: $DIR matches its sources; the tree is clean"
