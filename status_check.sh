#!/usr/bin/env bash
# Inspect the generated site and report problems.
#
# Checks the same things the build does, without rebuilding: broken local
# links, images with no alt text, missing *_min counterparts, oversized assets,
# missing or malformed YAML front matter, duplicate slugs, missing meta
# descriptions, and any reference that reaches outside this domain.
#
# Also rewrites _site/status_check.html with the same findings.
# Exits non-zero if there are errors, so it can gate a deploy.
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -d _site ]; then
  echo "_site does not exist — run ./site_generate first." >&2
  exit 1
fi

if [ -x ./site_generate ]; then
  exec ./site_generate --check-only "$@"
fi

# No compiled binary yet: fall back to the development toolchain.
if command -v bun >/dev/null 2>&1 && [ -d node_modules ]; then
  echo "site_generate not found — using bun." >&2
  exec bun run eleventy_binary/build.mjs --check-only "$@"
fi

echo "Neither ./site_generate nor a bun + node_modules setup was found." >&2
echo "Compile the binary with ./eleventy_binary/compile.sh" >&2
exit 1
