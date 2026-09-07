#!/usr/bin/env bash
# Compile the site generator into a standalone binary for Linux and Windows.
#
# The result needs no Node, no Bun and no node_modules on the machine that runs
# it — that is the whole point, and it is what site_generate must satisfy.
#
#   ./eleventy_binary/compile.sh           both targets
#   ./eleventy_binary/compile.sh linux     just Linux
#   ./eleventy_binary/compile.sh windows   just Windows
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required to compile the binary. See https://bun.sh" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "node_modules/ not found — run 'bun install' first." >&2
  exit 1
fi

echo "Compiling site_generate…"
bun run eleventy_binary/compile.mjs "${1:-}"
chmod +x site_generate 2>/dev/null || true

echo
echo "Done. Verify with a clean run:"
echo "  mv node_modules node_modules.off && ./site_generate ; mv node_modules.off node_modules"
