#!/usr/bin/env bash
# Vendor third-party assets from node_modules into the repository.
#
# Run this after changing dependencies. It is a DEVELOPMENT step, not a build
# step: the site generator never touches node_modules, so KaTeX's stylesheet and
# fonts and the glightbox bundle must live in the repo as ordinary assets. That
# is also what keeps the promise of no CDN and no third-party requests.
#
# Two things happen to every vendored stylesheet on the way in:
#
#   1. Font URLs are rewritten from the package's own dist layout to where this
#      site serves them, and the .ttf sources are dropped (every browser that
#      runs this site takes woff2; the woff is the fallback).
#
#   2. The whole sheet is wrapped in `@layer vendor { … }`, and the sheet opens
#      by declaring the site's whole layer order: `@layer properties, theme,
#      base, vendor, components, utilities;`.
#
# Point 2 is load-bearing, and BOTH halves of it are.
#
# The wrapper first. Cascade layers outrank specificity AND source order: an
# UNLAYERED vendor rule beats any rule inside @layer, no matter how specific
# ours is or which sheet the browser read first. Tailwind compiles our own rules
# into @layer components, so without this wrapper KaTeX's `.katex{font:normal
# 1.21em KaTeX_Main,…}` silently overrides the --font-katex-* tokens in
# theme.css.
#
# Now the order. A layer's position is fixed by where it is FIRST named, and
# these sheets are linked ahead of main.css — so naming `vendor` here, inside
# the wrapper alone, made it the weakest layer of all: weaker than `base`, which
# is where Tailwind's preflight puts `*{margin:0;padding:0;border:0}`. That
# reset then beat every padding and margin the vendor sheets ship, because
# layer order decides before specificity is even consulted. GLightbox captions
# lost `.gdesc-inner{padding:22px 20px}` and sat flush against the panel edge;
# KaTeX lost the internal margins that position a radical's index and the
# spacing on \cancel and \angle.
#
# So the order statement goes here rather than in input.css: whichever vendor
# sheet a page loads is the first stylesheet in the document, so it is the only
# place that can register the order before the wrapper does it implicitly.
# input.css repeats the identical statement for pages that link no vendor sheet
# at all. `vendor` above `base` gives third-party CSS its own box model back;
# `vendor` below `components` keeps every override in input.css winning, which
# is what the paragraph above is about. Both properties hold at once.
#
# The statement has to name EVERY layer, not just insert vendor among the ones
# it cares about. Tailwind emits `@layer properties;` for the `--tw-*: initial`
# fallbacks on `*`, and it emits it first precisely so that layer is the
# weakest — those are defaults meant to lose to the utilities that set them.
# Left out of this statement it would instead be first named in main.css, i.e.
# after everything named here, making it the STRONGEST layer and letting the
# initial values beat the utilities on layer order alone. If a Tailwind upgrade
# adds another layer, it belongs in this list.
#
# Every rewrite is checked against the source afterwards. A regex that quietly
# eats a brace produces a stylesheet that still parses and is still the right
# rough size, so "it looks fine" is not evidence — the assertions below are.
set -euo pipefail
cd "$(dirname "$0")/.."

die() { printf 'vendor_assets: %s\n' "$*" >&2; exit 1; }

# Occurrences, not matching lines: minified vendor CSS is one enormous line, so
# `grep -c` would answer 1 for everything and every assertion would pass.
#
# "no matches" is an answer here, not an error, so the grep exit status is
# swallowed — under `set -e` plus `set -o pipefail` an unguarded zero-count grep
# aborts the script with no message at all.
occurrences() {
  local n
  n=$(grep -o -- "$1" "$2" 2>/dev/null | wc -l | tr -d '[:space:]') || true
  printf '%s' "${n:-0}"
}

# Same count of a given substring in source and output.
assert_preserved() {
  local needle=$1 src=$2 out=$3 before after
  before=$(occurrences "$needle" "$src")
  after=$(occurrences "$needle" "$out")
  [ "$before" = "$after" ] ||
    die "rewrite changed the number of '$needle' ($before in $src, $after in $out)"
}

# Substring that must not survive the rewrite.
assert_absent() {
  local needle=$1 out=$2 n
  n=$(occurrences "$needle" "$out")
  [ "$n" = 0 ] || die "$out still contains $n occurrence(s) of '$needle'"
}

if [ ! -d node_modules ]; then
  die "node_modules/ not found — run 'bun install' first."
fi

mkdir -p font/katex css javascript licence_and_legal

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# --- KaTeX ------------------------------------------------------------------
echo "→ KaTeX stylesheet and fonts"
katex_src=node_modules/katex/dist/katex.min.css
[ -f "$katex_src" ] || die "$katex_src not found."

rm -f font/katex/*.woff font/katex/*.woff2
cp node_modules/katex/dist/fonts/*.woff2 font/katex/
cp node_modules/katex/dist/fonts/*.woff  font/katex/

# Drop the .ttf source, then repoint the survivors at /font/katex/.
#
# The .ttf entry is LAST in each src list, so whatever follows it is the closing
# brace of the @font-face. The match must therefore be anchored on the literal
# `format("truetype")` and must never span a brace: an earlier version used
# `[^,;]*` to swallow the format() function, and since that class does not
# exclude { or }, it ate `}@font-face{font-display:block` at every boundary —
# collapsing all 20 faces into one invalid rule and consuming the `.katex{`
# selector that pins maths to KaTeX_Main. That is what the assertions catch.
sed -e 's#,\{0,1\}url(fonts/[^)]*\.ttf)\( *format("truetype")\)\{0,1\}##g' \
    -e 's#url(fonts/#url(/font/katex/#g' \
    "$katex_src" > "$tmp/katex.css"

assert_preserved '@font-face' "$katex_src" "$tmp/katex.css"
assert_preserved 'src:'       "$katex_src" "$tmp/katex.css"
assert_preserved '{'          "$katex_src" "$tmp/katex.css"
assert_preserved '}'          "$katex_src" "$tmp/katex.css"
assert_preserved '\.katex{'   "$katex_src" "$tmp/katex.css"

# The rule that detaches maths from the page font. If this is gone, unclassed
# atoms (digits, =, +, parentheses, \sin) inherit the body face instead.
occ=$(occurrences 'font:normal 1\.21em KaTeX_Main' "$tmp/katex.css")
[ "$occ" = 1 ] || die "the .katex base rule pinning KaTeX_Main did not survive the rewrite"

assert_absent '\.ttf'     "$tmp/katex.css"   # no reference to a file we do not ship
assert_absent 'url(fonts/' "$tmp/katex.css"  # every URL repointed
assert_absent ',;'        "$tmp/katex.css"   # dangling comma in a src list
assert_absent ',}'        "$tmp/katex.css"
assert_absent ',,'        "$tmp/katex.css"

# Every font the stylesheet asks for must actually be in the repository.
missing=0
while read -r ref; do
  [ -n "$ref" ] || continue
  [ -f ".$ref" ] || { echo "  missing: $ref" >&2; missing=$((missing + 1)); }
done < <(grep -o 'url(/font/katex/[^)]*)' "$tmp/katex.css" |
         sed -e 's#^url(##' -e 's#)$##' | sort -u)
[ "$missing" = 0 ] || die "$missing font file(s) referenced by css/katex.css are not in font/katex/"

# --- glightbox --------------------------------------------------------------
echo "→ glightbox"
glightbox_src=node_modules/glightbox/dist/css/glightbox.min.css
[ -f "$glightbox_src" ] || die "$glightbox_src not found."
cp node_modules/glightbox/dist/js/glightbox.min.js javascript/glightbox.min.js
# glightbox embeds its icons as data: URIs, so there is nothing to repoint —
# but assert that, rather than assume it. If a future release starts referencing
# a real file this fails loudly instead of shipping a silent 404.
all_urls=$(occurrences 'url(' "$glightbox_src")
data_urls=$(occurrences 'url(data:' "$glightbox_src")
[ "$all_urls" = "$data_urls" ] ||
  die "glightbox.min.css references $((all_urls - data_urls)) external file(s); teach this script to vendor them"

# css/input.css restyles the lightbox chrome by name, and since the controls
# were stripped to bare glyphs the whole look of them rides on these selectors
# still existing upstream. A release that renamed one would break no test and
# fail no build -- the overrides would simply stop applying and glightbox's own
# black pill would come back. A dependency bump runs this script, so this is
# where it can be caught. Same reasoning as the .katex{ assertion above.
for sel in '\.glightbox-clean \.gprev' '\.glightbox-clean \.gnext' \
           '\.glightbox-clean \.gclose' '\.gbtn\.focused' '\.gprev\.disabled'; do
  [ "$(occurrences "$sel" "$glightbox_src")" != 0 ] ||
    die "glightbox.min.css no longer contains '$sel', which css/input.css restyles"
done

cp "$glightbox_src" "$tmp/glightbox.min.css"

# --- Wrap both sheets in the vendor layer and install them ------------------
for sheet in katex.css glightbox.min.css; do
  {
    # Must precede the wrapper: the first mention of a layer is what fixes its
    # position, and `@layer vendor {` is itself a mention. See the header.
    printf '@layer properties, theme, base, vendor, components, utilities;\n'
    printf '@layer vendor {\n'
    cat "$tmp/$sheet"
    printf '\n}\n'
  } > "css/$sheet"
done

# The repository keeps one curated licence_<dep>.md per dependency; dropping a
# second raw copy beside it just produces an unreferenced stray file. Verify the
# curated file still carries upstream's text instead, so a dependency bump that
# changes the licence is caught here rather than never noticed.
check_licence() {
  local upstream=$1 curated=$2 a b
  [ -f "$upstream" ] || return 0
  if [ ! -f "$curated" ]; then
    echo "  [warn] $curated is missing — copy the text from $upstream" >&2
    return 0
  fi
  a=$(tr -s '[:space:]' ' ' < "$upstream" | sed -e 's/^ //' -e 's/ $//')
  b=$(tr -s '[:space:]' ' ' < "$curated"  | sed -e 's/^ //' -e 's/ $//')
  case "$b" in
    *"$a"*) ;;
    *) echo "  [warn] $curated no longer contains the text of $upstream — update it" >&2 ;;
  esac
}
check_licence node_modules/katex/LICENSE      licence_and_legal/licence_katex.md
check_licence node_modules/glightbox/LICENSE  licence_and_legal/licence_glightbox.md

echo
echo "Vendored:"
echo "  css/katex.css            ($(wc -c < css/katex.css) bytes, $(occurrences '@font-face' css/katex.css) @font-face rules)"
echo "  font/katex/              ($(ls font/katex | wc -l) files)"
echo "  javascript/glightbox.min.js"
echo "  css/glightbox.min.css    ($(wc -c < css/glightbox.min.css) bytes)"
