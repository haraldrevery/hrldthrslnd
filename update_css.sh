#!/usr/bin/env bash
# Rebuild the stylesheet from css/input.css (which imports css/theme.css).
#
#   css/main.css      minified — what the site loads
#   css/main_max.css  expanded — for troubleshooting only, never linked
#
# site_generate does this for you on every build; this script is for tweaking
# theme.css and watching the result without a full rebuild.
set -euo pipefail
cd "$(dirname "$0")"

BIN=./tailwindcss-linux-x64
if [ ! -x "$BIN" ]; then
  if [ -f "$BIN" ]; then
    echo "Making $BIN executable…"
    chmod +x "$BIN"
  else
    echo "$BIN not found." >&2
    exit 1
  fi
fi

if [ "${1:-}" = "--watch" ]; then
  echo "Watching css/input.css → css/main.css (Ctrl-C to stop)…"
  exec "$BIN" -i css/input.css -o css/main.css --minify --watch
fi

"$BIN" -i css/input.css -o css/main.css --minify
"$BIN" -i css/input.css -o css/main_max.css

printf '\ncss/main.css      %6s bytes (minified)\n' "$(wc -c < css/main.css)"
printf 'css/main_max.css  %6s bytes (expanded)\n'   "$(wc -c < css/main_max.css)"
