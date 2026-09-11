# Page builder — plan and status

This is the working plan for the page builder, written after a full read of the
generator on 2026-09-11. It replaces the sketch in `page_builder_app.md` where
the two disagree, and it says why. The status table at the end is kept current.

The one requirement that outranks every other: **the site must still build,
and still be editable by hand, in ten years.** Every choice below is measured
against that.

---

## Findings that had to be settled first

The generator itself is sound: the build is staged and swapped atomically, the
slug registry is deterministic, the checks are thorough, and the 166 tests pass.
The debt is all at the seam the builder sits on.

| # | Debt | Why it blocks the builder |
|---|---|---|
| 1 | `post_i.json` and `post_i.html` were written by hand side by side; nothing read the JSON | No source of truth. An app that emits HTML must re-export every post on every theme change |
| 2 | Markdown + KaTeX pipeline reads the filesystem directly | Cannot run in an editor preview; a second pipeline would drift |
| 3 | Block library is 215 inline styles and comment conventions | Nothing machine-readable for an editor to build from |
| 4 | Slug suffix on collision moves a post folder's assets; page hard-codes the old path | Every image 404s, and the writer of the file cannot know the final slug |
| 5 | Status check has no tests and no machine-readable output | The editor's indicators were meant to reuse it |
| 6 | Module-level caches live for the process | Generator cannot be embedded in a long-running app |
| 7 | Three front-matter readers; the app would add a YAML writer | A draft flag written in a shape the pre-pass misreads publishes the draft's assets |
| 8 | No EXIF handling; originals ship verbatim | GPS-tagged photographs go public. Thumbnails ignore orientation |
| 9 | Hero-first, h1-on-fragment, component-classes-only are all implicit | Must be encoded, not remembered |

---

## Decisions

### D1. The JSON file is the page. The generator renders it.

`input_custom_post/<name>/<name>.json` is the post. The generator validates it,
renders its blocks through the same markdown pipeline every other page uses, and
registers the result with Eleventy as a virtual template. It appears in the
journal, the feed, the sitemap, the search index and the subject pages like any
other post.

A hand-written `<name>.html` still works exactly as before when there is no JSON
beside it. That escape hatch is kept on purpose.

Consequences: the editor never emits HTML; a theme change re-renders every post;
there is no YAML for the editor to write, so debt 7 disappears for builder
posts; the renderer knows the assigned slug, so debt 4 disappears for builder
posts and becomes a status-check error for hand-written ones.

### D2. The editor is a mode of the generator binary, not a separate app.

`site_generate --edit` starts a small HTTP server bound to `127.0.0.1` and opens
a dependency-free page in whatever browser is installed. The page is plain HTML,
CSS and JavaScript with no framework and no build step, embedded in the binary
the same way the WASM codecs already are.

This departs from `page_builder_app.md`, which proposed Tauri or Electron with
Puck. The reasons, in order of weight:

- **Longevity.** A Tauri or Electron project needs a Rust or Node toolchain,
  hundreds of packages and an OS webview that still accepts them, all of which
  churn on a two-to-three-year cycle. A page served by the binary that already
  has to keep working needs nothing the site does not already need.
- **One code path.** The server runs the same validator, renderer, checks and
  codecs the build runs, in the same process, on the same files. There is no
  bridge to keep in sync and no second copy of anything.
- **Safety on disk.** All file writes go through one small store module with
  atomic temp-and-rename writes, never-overwrite on upload, and a revision copy
  of every save inside the post folder. That is far easier to audit than a
  webview talking to native file APIs.
- **Puck** is a free-form React canvas. The data model here is a list of rows
  with one or two slots, which is a list editor, not a canvas.

The abstraction `page_builder_app.md` asks for survives in a narrower form: the
page talks to the server through a single `api.js` module, so a native shell
could replace the transport later without touching the editor.

### D3. Blocks are data. The catalogue is the contract.

`eleventy_binary/lib/blocks/catalogue.js` lists every block type, its fields,
whether it is a hero, and whether it may sit in a column. The validator, the
renderer and the editor all read it. A block that is not in the catalogue does
not exist.

Every rendered block is a `<section class="shell block block-<type>">`. The
vertical rhythm that used to be an inline style on every block is now the
`.block` class in `css/input.css`, so the theme can retune it.

### D4. The generator stays a subprocess for building.

The editor's Build button runs the generator as a child process rather than
calling the build in-process. The module caches then never go stale across
builds, and the editor cannot corrupt a build by holding state. The only cache
the editor touches is the registry, which it invalidates when it creates a post
folder.

### D5. Nothing is deleted by software.

The editor can create files and write new versions of files. It cannot delete a
file or overwrite an uploaded asset. Removing an image from a page removes the
reference; the file stays in the folder until a person deletes it.

---

## The post format, version 1

```json
{
  "format": 1,
  "meta": {
    "title": "A page folder",
    "date": "2026-09-01",
    "description": "One HTML page plus its own media, kept together.",
    "tags": ["reference", "test"],
    "category": [],
    "image": "thumbnail.jpg",
    "draft": false
  },
  "blocks": [
    { "type": "hero", "variant": "photo", "title": "Kept\ntogether", "image": { "src": "street_scene.jpg", "alt": "…" } },
    { "type": "text", "markdown": "## How the folder is published\n\nBody copy with $x^2$ maths." },
    { "type": "gallery", "layout": "justified", "images": [ { "src": "street_scene.jpg", "alt": "…" } ] }
  ]
}
```

Asset references: a bare name (`street_scene.jpg`) is a file in the post
folder; a site-absolute path (`/image/x.jpg`) is a site-wide asset. Nothing else
is accepted. Optional meta keys: `author`, `updated`, `permalink`.

Block types: `hero`, `heading`, `text`, `gallery`, `video`, `audio`,
`download`, `faq`, `feature`, `raw_html`, and `columns`, which holds exactly two
of the others. `hero` may only be the first block. The catalogue file is the
authoritative field list.

---

## Phases

**Phase 1 — contracts.** Catalogue, validator, renderer. Resolver interface
split out of the markdown pipeline. `.block` rhythm classes.

**Phase 2 — generator integration.** JSON post folders registered and rendered
as virtual templates. Hand-written post folders unchanged. Status check learns
the JSON posts and the hard-coded-folder-path error. Report also written as
`status_check.json`.

**Phase 3 — images.** Thumbnail encoder split from the filesystem. EXIF reader,
GPS scrubber, orientation applied to generated thumbnails. Import pipeline with
the original-size cap from the spec.

**Phase 4 — editor.** Local server, file store with revisions, the editor page:
meta form, block list, per-block fields from the catalogue, asset upload, live
preview, checks panel, revisions, build button.

**Phase 5 — content and docs.** `post_i` ported to JSON. A JSON post exercising
every block. Readmes updated. Binary recompiled and verified.

---

## Status

| Phase | State | Notes |
|---|---|---|
| 1 | done | `lib/blocks/`, `lib/resolver.js`, `lib/media_html.js`, `.block` classes; 27 tests |
| 2 | done | virtual templates, `--check-post`, `--json`, `status_check.json`, post-folder path check |
| 3 | done | `lib/thumbnail.js`, `lib/exif.js`, orientation fixed in the build's mirror too |
| 4 | done | `--edit`: `lib/editor/`, `editor/`; smoke-tested against every endpoint |
| 5 | done | `post_i` ported, `post_blocks` added, readmes updated, binary recompiled |
| UI pass | done | canvas editing, bulk import and drop, library picker, one inspector; driven end to end in a headless browser |

---

## Second pass: the editor's interface

The first editor worked but was a form with a preview beside it: three panes,
every field of every block on screen at once, all-caps labels and help text on
each, a picture chosen by typing its file name, and a checks panel that grew
into the preview's space. Trying it on a real post showed the failure plainly —
a hero picture set by pasting a URL copied from the file list, because there
was nothing to click.

The second pass turns it around: **the page is the interface.**

- **Canvas first.** The preview is the centre of the screen and never moves. It
  is the rendered page with a thin overlay script (`editor/canvas.js`, served
  only to the preview, never built into the site): hover outlines a block,
  clicking selects it, a floating toolbar on the selected block moves,
  duplicates or removes it, a grip drags it to a new position, and a "+"
  between blocks inserts one there. Clicking a picture in a gallery selects
  that picture. The overlay talks to the editor with `postMessage`; the page
  markup carries `data-block` and `data-image` paths only when rendered for the
  canvas.
- **One inspector, three tabs.** Block, Page, Files. The Block tab shows the
  selected block alone. Labels are small and quiet; help sits in a tooltip.
- **Pictures are picked, dropped or bulk-imported, never typed.** A gallery's
  pictures are a grid of thumbnails with drag-to-reorder. Files dropped onto a
  gallery in the canvas, onto its inspector, or chosen with "Add pictures" are
  imported in bulk and appended, alt and title prefilled from EXIF where the
  file has any. Files dropped anywhere else on the canvas become a new gallery
  at that place. The Files tab is a library: click a picture to add it to the
  selected gallery, or drag it onto the canvas. A site-wide picture can still
  be typed as a `/image/…` path in one place, the picture's own panel.
- **Checks are a badge, not a pane.** The verdict sits in the top bar; clicking
  it opens the list, and each finding focuses its field. Nothing pushes the
  canvas.
- **Device widths.** Desktop, tablet and phone, as a canvas width toggle.

Not done in this pass: editing text directly on the canvas. Headings and
markdown would need a round trip from rendered HTML back to source, and a
wrong round trip silently rewrites the author's words. Selection and drag on
the canvas, with the text in the inspector, is the safe form of it.

Deferred, deliberately: zip export (the folder is the project; a zip of a folder
is a shell command), Windows shell integration for `--edit` (the URL is printed;
open it), EXIF import of titles from XMP sidecars.
