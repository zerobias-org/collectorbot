#!/usr/bin/env bash
set -euo pipefail

# Fetch the cyberab.org pages that extract-cyberab.py reads, into a local
# mirror layout. Feeds step 1 of the two-step refresh chain; see README.md.
#
#   ./scrape-cyberab.sh [output-dir]        # default: ./.cyberab-mirror
#
# WHY THIS IS A TARGETED FETCH AND NOT `wget --mirror`
# ----------------------------------------------------
# It used to be a full recursive mirror. Measured 2026-08-20: cyberab.org is a
# DNN site whose pages pull ~1.5MB of CSS and a long tail of JS. With the polite
# 1s delay a `--mirror --page-requisites --level=5` run spends hours on assets
# the extractor never opens, and had fetched exactly ONE html page after two
# minutes. The extractor reads a fixed list of 29 pages, so we fetch that list.
#
# The list is READ FROM extract-cyberab.py's PAGES map — one source of truth.
# Add a page there and this script picks it up on the next run.

OUT_DIR="${1:-$(dirname "$0")/.cyberab-mirror}"
HOST="cyberab.org"
UA="ZeroBias-Certifications-Catalog/1.0 (+https://github.com/zerobias-org/collectorbot)"
HERE="$(cd "$(dirname "$0")" && pwd)"

command -v python3 >/dev/null || { echo "python3 is required (to read the PAGES map)" >&2; exit 1; }
command -v curl    >/dev/null || { echo "curl is required" >&2; exit 1; }

mkdir -p "$OUT_DIR/$HOST"

echo "Fetching https://${HOST} -> ${OUT_DIR}/${HOST}"
echo "Start: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

PAGES=$(python3 - "$HERE/extract-cyberab.py" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
m = re.search(r'PAGES = \{.*?\n\}', src, re.S)
if not m:
    sys.exit("could not find the PAGES map in extract-cyberab.py")
ns = {}
exec(m.group(0), ns)
for group in ns['PAGES'].values():
    for path in group.values():
        print(path)
PY
)

ok=0; miss=0
while IFS= read -r page; do
  [ -z "$page" ] && continue
  # The site serves extensionless URLs; the extractor wants .html on disk.
  url="https://${HOST}/${page%.html}"
  out="${OUT_DIR}/${HOST}/${page}"
  mkdir -p "$(dirname "$out")"
  code=$(curl -sS -L -A "$UA" -o "$out" -w '%{http_code}' "$url" || echo 000)
  if [ "$code" = "200" ]; then
    ok=$((ok + 1))
  else
    miss=$((miss + 1))
    rm -f "$out"
    echo "  MISS ${code}  ${page}"
  fi
  sleep 1                       # be polite; the whole run is ~30s of waiting
done <<< "$PAGES"

echo "Finish: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Fetched: ${ok}   Missing: ${miss}"

if [ "$miss" -gt 0 ]; then
  echo ""
  echo "A MISS means the site moved or removed that page. Fix the path in"
  echo "extract-cyberab.py's PAGES map rather than ignoring it — a silently"
  echo "absent page becomes a silently absent certification."
fi

echo ""
echo "Next: python3 ${HERE##*/}/extract-cyberab.py \"${OUT_DIR}/${HOST}\" > extract.json"
