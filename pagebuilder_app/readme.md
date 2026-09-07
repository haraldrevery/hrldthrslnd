# Page builder app — not built yet

The block editor described in `../page_builder_app.md` has not been implemented.
This folder is a placeholder so the project layout matches the plan.

## What stands in for it

`input_custom_post/` already exists as an input format, and the generator
already handles it: a folder holding `post_x.html` plus its own media, published
to `/post_x.html` with the assets copied to `/post_x/`. That is the format the
app will read and write, so pages made by hand today will open in the app later.

Until then, **[`../input_custom_html/block_test_page.html`](../input_custom_html/block_test_page.html)**
is the substitute. It holds every block type the site can render — hero, heading,
text with maths, three gallery layouts, video, audio, download with generated
checksums, FAQ, feature panel, stat grid, index rows and raw HTML — each fenced
with `COPY FROM HERE` / `COPY TO HERE` comments. Copy a block into a new file,
add front matter, rebuild.

`block_test_page_a.html` and `block_test_page_b.html` show the two hero
treatments.

## What already exists for it

The generator side of several app features is done and can be reused:

- **`../eleventy_binary/lib/images.js`** — the `_min` thumbnail pipeline, WASM
  MozJPEG, ≤ 80 kB budget, with the "you were missing this, I made one" warning.
- **`../eleventy_binary/lib/downloads.js`** — SHA-256 and SHA-512 for download
  blocks, computed from the shipped bytes at build time.
- **`../eleventy_binary/lib/status_check.js`** — the front-matter, heading
  structure, alt-text and `_min` completeness checks the app's green/amber/red
  indicators are meant to surface, already written and already running.
- **`../eleventy_binary/lib/imagesize.js`** — intrinsic dimensions from file
  headers, no decode.

When the app is built, `compile.sh` belongs here and the Tauri project under
`page_builder/`, per the layout in `../website.md`.
