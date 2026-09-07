# The site generator

Eleventy 3, compiled by Bun into a standalone binary. The binary runs with no
Node, no Bun and no `node_modules` on the machine — which is the requirement
that shaped most of the decisions below.

## Build order

`build.mjs` runs five steps, and the order matters:

1. **thumbnails** — generate any missing `image_min/*_min.jpg`
2. **css** — run the Tailwind binary over the templates
3. **pages** — Eleventy renders everything into `_site/`
4. **assets** — copy post-folder files, then fill in download checksums
5. **status check** — inspect the output, write `_site/status_check.html`

CSS comes before Eleventy because Eleventy copies `css/main.css` into the
output; building it afterwards would ship the previous run's stylesheet.
Checksums come after the copy step because they are hashes of the bytes that
were actually shipped, not of a source that might differ.

`_site/` is deleted at the start. Eleventy leaves behind files it no longer
generates, and a stale page — a renamed post, a tag page for a tag nobody uses
any more, a draft from a `--drafts` run — would otherwise stay published.

## Flags

```
--drafts      include pages marked draft: true (local preview only)
--no-css      skip Tailwind, reuse the existing css/main.css
--check-only  do not build; inspect the existing _site and rewrite the report
--quiet       suppress notes; warnings and errors are always shown
--help
```

Exit code is non-zero only on **errors**. Warnings are information.

## Modules

| File | Responsibility |
|---|---|
| `build.mjs` | The five steps above, and the CLI |
| `compile.mjs` / `compile.sh` | Produce the Linux and Windows binaries |
| `vendor_assets.sh` | Copy KaTeX and glightbox out of node_modules into the repo |
| `lib/eleventy_config.js` | The whole Eleventy configuration, shared by the binary and `eleventy.config.js` |
| `lib/markdown.js` | markdown-it: KaTeX, anchors, heading demotion, image figures, outline |
| `lib/slugs.js` | One slug namespace across all three input folders, with conflict resolution |
| `lib/images.js` | The `image/` → `image_min/` mirror |
| `lib/codecs.js` | WASM codec bootstrap (see below) |
| `lib/imagesize.js` | Intrinsic dimensions, parsed from file headers |
| `lib/assets.js` | Adds the stylesheets and scripts a page's markup implies |
| `lib/downloads.js` | SHA-256 / SHA-512 for download blocks |
| `lib/status_check.js` | Site health checks, terminal output and HTML report |
| `lib/paths.js` | Slugs, `_min` naming, HTML escaping |
| `lib/settings.js` | `site_settings.json` |
| `lib/log.js` | One log everything reports through |

## Compiling

```bash
./eleventy_binary/compile.sh            # both targets
./eleventy_binary/compile.sh linux
./eleventy_binary/compile.sh windows
```

Always verify against a clean environment before shipping a binary — this is
the test that actually matters:

```bash
mv node_modules node_modules.off
./site_generate
mv node_modules.off node_modules
```

### Why compile.mjs exists instead of `bun build --compile`

One dependency needs patching at bundle time. Eleventy reads its own
`package.json` at runtime through a path derived from `import.meta.url`; inside
a compiled binary that resolves to `/package.json`, which does not exist, and
Eleventy throws before doing anything. `compile.mjs` swaps that one function for
the values baked in at compile time.

It is the only patch required, and it **fails loudly** if Eleventy's
`ImportJsonSync.js` changes shape, rather than silently producing a binary that
dies on first run. If you upgrade Eleventy and the compile step errors, that is
why — read the message and update the shim.

## Two constraints worth knowing before editing

### 1. Files Eleventy loads from disk cannot import anything

Eleventy reads `*.11tydata.js` files from the filesystem at build time. Inside
the binary there is no `node_modules` to resolve against, so those files may use
**Node builtins only**.

That is why the input folders' data files contain nothing but static values and
a permalink lookup against `slugRegistry`, a plain object that
`lib/eleventy_config.js` (which *is* bundled) puts into the data cascade.
Anything needing the markdown parser or the image helpers is computed in the
config's global `eleventyComputed` instead.

`eleventy_njk/blog.11tydata.js` reads `site_settings.json` with `node:fs` for
the same reason.

### 2. The config callback's return value is discarded

When the configuration is passed to the `Eleventy` constructor as a callback —
which is what the binary does, since it cannot load a config file from disk —
Eleventy ignores whatever the function returns. Directories and template formats
must go through the UserConfig setters (`setInputDirectory`,
`setIncludesDirectory`, …), not through a returned `dir` object. A returned
`dir` fails silently and Eleventy looks for layouts in `_includes/`.

## The WASM image codecs

`@jsquash` normally loads its `.wasm` files from disk at runtime, which the
binary cannot do. `lib/codecs.js` embeds them with `import … with { type: "file" }`
and hands each one to its `init()` as an already-compiled `WebAssembly.Module`.

This is why image generation works from a single self-contained binary, and why
`lib/images.js` must always go through `initCodecs()`.

## Vendored assets

KaTeX's stylesheet and fonts, and the glightbox bundle, are committed to the
repository as ordinary assets — not copied out of `node_modules` at build time.
The generator never touches `node_modules`, and the site is required to make no
third-party requests.

Re-run `./eleventy_binary/vendor_assets.sh` after changing those dependencies.
It also rewrites KaTeX's font URLs to `/font/katex/` and drops the `.ttf`
sources.
