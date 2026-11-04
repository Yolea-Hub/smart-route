#!/usr/bin/env bash
# Mirrors one GitHub release of Yolea-Hub/smart-route into the private R2 bucket served by the site Worker (smartroute.yolea.ai/dl/...).
# GitHub Releases stay the source of truth; this copies them, after checking every SHA-256 against the release's SHA256SUMS.
#
#   scripts/mirror-release.sh [--dry-run] [--from-dir DIR] [--keep] <tag>        e.g. scripts/mirror-release.sh v0.2.1
#
#   --dry-run       download (or read), verify and build latest.json, but upload nothing; the work folder is kept and printed
#   --from-dir DIR  take the installers and SHA256SUMS from DIR instead of downloading (they are still verified, byte for byte)
#   --keep          keep the work folder after a successful real run (a dry run always keeps it)
#
# Order: verify everything -> upload v<ver>/<files> -> upload latest.json LAST (the site only learns of a version once all its files are there).
# Idempotent: running it again for the same tag overwrites the same keys with the same bytes.
# Needs: bash, curl, gh (release metadata), jq, sha256sum, and for the upload the pinned wrangler of site/deploy (pnpm install there once)
# with a Cloudflare login (`wrangler login`) or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in the environment.
# TMPDIR chooses where the work folder is made.
set -euo pipefail

REPO="Yolea-Hub/smart-route"
BUCKET="smart-route-downloads"
PARTS=16        # ranged connections per file (one GitHub connection is slow on some routes; sixteen together are not)
TRIES=5         # attempts per part
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$ROOT/site/deploy"

die() { echo "mirror-release: $*" >&2; exit 1; }
usage() { sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' >&2; exit 2; }

DRY=0; KEEP=0; FROM=""; TAG=""
while [ "$#" -gt 0 ]; do
	case "$1" in
		--dry-run) DRY=1 ;;
		--keep) KEEP=1 ;;
		--from-dir) [ "$#" -ge 2 ] || usage; FROM="$2"; shift ;;
		-h|--help) usage ;;
		-*) die "unknown option $1" ;;
		*) [ -z "$TAG" ] || usage; TAG="$1" ;;
	esac
	shift
done
[ -n "$TAG" ] || usage
[[ "$TAG" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)$ ]] || die "the tag must look like v1.2.3 (got '$TAG')"
VER="${BASH_REMATCH[1]}"
for c in curl gh jq sha256sum; do command -v "$c" >/dev/null || die "$c is required"; done
if [ -n "$FROM" ]; then FROM="$(cd "$FROM" && pwd)" || die "--from-dir: no such folder"; fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/smart-route-mirror-${VER}.XXXXXX")"
FILES="${FROM:-$WORK/files}"
mkdir -p "$FILES"
echo "work folder: $WORK"
echo "files folder: $FILES"

# --- release metadata (must be published, not a draft or prerelease)
META="$WORK/release.json"
gh release view "$TAG" --repo "$REPO" --json tagName,isDraft,isPrerelease,publishedAt,assets > "$META" || die "gh release view $TAG failed"
[ "$(jq -r '.isDraft or .isPrerelease' "$META")" = "false" ] || die "$TAG is a draft or a prerelease: not mirrored"
DATE="$(jq -r '.publishedAt[0:10]' "$META")"
[[ "$DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "no publication date in the release metadata"

NAME_RE="^Smart-Route-${VER//./\\.}-(linux-(x86_64\\.AppImage|amd64\\.deb)|win-x64\\.exe|mac-(arm64|x64)\\.dmg)$"
# "name<TAB>size" of the installers and of SHA256SUMS in the release
ASSETS="$WORK/assets.tsv"
jq -r '.assets[] | [.name, .size] | @tsv' "$META" | LC_ALL=C sort > "$ASSETS"
INSTALLERS=()
while IFS=$'\t' read -r name _; do
	if [[ "$name" =~ $NAME_RE ]]; then INSTALLERS+=("$name"); fi
done < "$ASSETS"
[ "${#INSTALLERS[@]}" -gt 0 ] || die "$TAG has no installer named Smart-Route-$VER-<os>-<arch>.<ext>"
grep -q "^SHA256SUMS	" "$ASSETS" || die "$TAG has no SHA256SUMS: refused"
size_of() { awk -F'\t' -v n="$1" '$1==n {print $2}' "$ASSETS"; }
url_of() { echo "https://github.com/$REPO/releases/download/$TAG/$1"; }

# --- ranged parallel download
fetch_part() { # url first last out
	local url="$1" first="$2" last="$3" out="$4" want try got
	want=$((last - first + 1))
	if [ -f "$out" ] && [ "$(stat -c %s "$out")" = "$want" ]; then return 0; fi # kept from an earlier run
	for try in $(seq 1 "$TRIES"); do
		rm -f "$out.tmp"
		if curl -fsSL --connect-timeout 20 --max-time 1800 --speed-limit 2000 --speed-time 60 -r "$first-$last" -o "$out.tmp" "$url"; then
			got="$(stat -c %s "$out.tmp")"
			if [ "$got" = "$want" ]; then mv "$out.tmp" "$out"; return 0; fi
			echo "part $out: got $got bytes, wanted $want (try $try/$TRIES)" >&2
		else
			echo "part $out: curl failed (try $try/$TRIES)" >&2
		fi
		sleep $((try * 3))
	done
	return 1
}
export -f fetch_part
export TRIES

download() { # name  -> $FILES/name, size checked
	local name="$1" size url dir i first last step
	size="$(size_of "$name")"; url="$(url_of "$name")"
	[ -n "$size" ] || die "$name is not in the release"
	if [ -f "$FILES/$name" ] && [ "$(stat -c %s "$FILES/$name")" = "$size" ]; then echo "have $name ($size bytes)"; return 0; fi
	dir="$WORK/parts/$name"; mkdir -p "$dir"
	if [ "$size" -lt 1048576 ]; then
		fetch_part "$url" 0 $((size - 1)) "$dir/00" || die "download of $name failed"
		mv "$dir/00" "$FILES/$name"
	else
		step=$(( (size + PARTS - 1) / PARTS ))
		echo "download $name: $size bytes in $PARTS parts of up to $step bytes"
		for i in $(seq 0 $((PARTS - 1))); do
			first=$((i * step)); last=$((first + step - 1)); [ "$last" -lt $((size - 1)) ] || last=$((size - 1))
			[ "$first" -le "$last" ] || continue
			printf '%s %s %s %s\n' "$url" "$first" "$last" "$dir/$(printf '%02d' "$i")"
		done | xargs -P "$PARTS" -L1 bash -c 'fetch_part "$@"' _ || die "download of $name failed"
		cat "$dir"/[0-9][0-9] > "$FILES/$name.assembling"
		[ "$(stat -c %s "$FILES/$name.assembling")" = "$size" ] || die "$name assembled to the wrong size"
		mv "$FILES/$name.assembling" "$FILES/$name"
	fi
	rm -rf "$dir"
}

if [ -z "$FROM" ]; then
	download SHA256SUMS
	for n in "${INSTALLERS[@]}"; do download "$n"; done
fi

# --- verify every installer against SHA256SUMS (and the sizes against the release)
[ -f "$FILES/SHA256SUMS" ] || die "$FILES/SHA256SUMS is absent"
MANIFEST="$WORK/manifest.tsv"; : > "$MANIFEST"
for n in "${INSTALLERS[@]}"; do
	[ -f "$FILES/$n" ] || die "$FILES/$n is absent"
	[ "$(stat -c %s "$FILES/$n")" = "$(size_of "$n")" ] || die "$n: size $(stat -c %s "$FILES/$n") differs from the release's $(size_of "$n")"
	want="$(awk -v n="$n" '{ f=$2; sub(/^\*/, "", f) } f==n && $1 ~ /^[0-9a-fA-F]{64}$/ {print tolower($1)}' "$FILES/SHA256SUMS")"
	[ -n "$want" ] && [ "$(printf '%s\n' "$want" | wc -l)" = 1 ] || die "$n: not exactly one line in SHA256SUMS: refused"
	have="$(sha256sum "$FILES/$n" | cut -d' ' -f1)"
	[ "$have" = "$want" ] || die "CHECKSUM MISMATCH for $n: file $have, SHA256SUMS $want: refused"
	echo "sha256 ok  $have  $n"
	printf '%s\t%s\t%s\n' "$n" "$(stat -c %s "$FILES/$n")" "$have" >> "$MANIFEST"
done

# --- latest.json (written now, uploaded last)
LATEST="$WORK/latest.json"
node - "$VER" "$DATE" "$MANIFEST" > "$LATEST" <<'JS'
const fs = require('node:fs')
const [ver, date, manifest] = process.argv.slice(2)
const OS = { linux: 'linux', win: 'windows', mac: 'mac' }
const files = fs.readFileSync(manifest, 'utf8').trim().split('\n').map((line) => {
  const [name, size, sha256] = line.split('\t')
  const m = /^Smart-Route-[0-9.]+-(linux|win|mac)-(x86_64|amd64|x64|arm64)\.(AppImage|deb|exe|dmg)$/.exec(name)
  return { os: OS[m[1]], arch: m[2] === 'arm64' ? 'arm64' : 'x64', kind: m[3], name, url: `/dl/v${ver}/${name}`, size: Number(size), sha256 }
})
process.stdout.write(JSON.stringify({ version: ver, date, files }, null, 2) + '\n')
JS
jq -e . "$LATEST" >/dev/null || die "latest.json is not valid JSON"

ctype() {
	case "$1" in
		*.deb) echo application/vnd.debian.binary-package ;;
		*.dmg) echo application/x-apple-diskimage ;;
		SHA256SUMS) echo 'text/plain; charset=utf-8' ;;
		latest.json) echo 'application/json; charset=utf-8' ;;
		*) echo application/octet-stream ;;
	esac
}
put() { # local-file key content-type
	if [ "$DRY" = 1 ]; then echo "[dry-run] would upload $2 ($(stat -c %s "$1") bytes, $3) to r2://$BUCKET/$2"; return 0; fi
	( cd "$DEPLOY" && npx --no-install wrangler r2 object put "$BUCKET/$2" --file "$1" --content-type "$3" --remote -y ) || die "upload of $2 failed; latest.json was NOT updated"
}

for n in "${INSTALLERS[@]}" SHA256SUMS; do put "$FILES/$n" "v$VER/$n" "$(ctype "$n")"; done
put "$LATEST" latest.json "$(ctype latest.json)"

# --- summary
echo
echo "=== summary ==="
echo "tag: $TAG  version: $VER  date: $DATE  mode: $([ "$DRY" = 1 ] && echo dry-run || echo uploaded)"
echo "files verified: ${#INSTALLERS[@]} installers + SHA256SUMS"
cut -f1,2 "$MANIFEST" | awk -F'\t' '{printf "  %-48s %12d bytes\n", $1, $2}'
echo "latest.json:"
sed 's/^/  /' "$LATEST"
if [ "$DRY" = 1 ]; then
	echo "dry run: nothing uploaded. Work folder kept: $WORK"
	echo "Verified files: $FILES   (reuse with: scripts/mirror-release.sh --from-dir '$FILES' $TAG)"
elif [ -z "$FROM" ] && [ "$KEEP" = 0 ]; then
	rm -rf "$WORK"; echo "work folder removed"
else
	echo "work folder kept: $WORK"
fi
