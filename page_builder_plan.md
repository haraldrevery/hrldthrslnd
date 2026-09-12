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
| Third pass | done | collage and salon hero treatments; title and caption from the file's XMP, IPTC or EXIF; 19 tests. See below |
| Feature overlay | done | the feature block's "Over" layout: block_test_page's "Featured dispatch", at the picture's own proportions. See below |

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

---

## Third pass: two more heroes, and pictures that name themselves

Two requests: the hero compositions of `block_test_page_c.html` (the collage)
and `block_test_page_d.html` (the salon) as treatments the editor can pick; and
a picture's title and description filled in from the file when it is imported.

### Fields say which treatment uses them

Every hero field used to apply to every treatment, and "which treatments take a
photograph" was written out in three places — the validator, the renderer and
the editor. A collage needs a second picture a salon does not; a salon needs an
engraved line a collage does not. So a field now carries `variants` (the
treatments that use it) and `requiredFor` in the catalogue, and all three read
that: `fieldApplies()` in the catalogue, restated as `fieldShown()` in the
editor, which receives the catalogue as data. A field outside its treatment is
hidden, not validated, and not an asset reference.

### An unknown treatment is an error

The renderer falls back to the default for a select value it does not know, and
the validator only warned. For the hero that meant a post written with a newer
treatment and built by an older `site_generate` was published as a plain stage.
The variant field is now `strict`, and an unknown treatment is an error. That
protects from this build on; a binary built before it still only warns, which is
one more reason the binary is recompiled with every change here.

### What the originals wrote by hand, the renderer works out

Pages C and D are full of furniture typed for one page. Each piece was decided
on its own:

| Piece | Rendered from |
|---|---|
| Collage portrait and landscape | `image`, and a new `image_2`. The landscape is small on every screen, so it loads its `_min` |
| Ink block | the number of sections below the hero, and the portrait's caption |
| Stamp | the post's date as DD.MM.YYYY, over a new `stamp` field. Empty, it is the first subject |
| Ruler | one segment per section, as long as the square root of its content; then the year and the number of pictures |
| Salon accent | always gilded: `.salon-stage .text-flow` |
| Salon stamp | the number of pictures on the page in Roman numerals, from two up |
| Plate caption | a new `plate` field (empty, "Plate I"), then " — " and the portrait's title, or its caption |
| Engraved line | a new `inscription` field. Empty, it is the author · the date in Roman numerals · the first subject |

The class names are a contract with the phone layouts in `css/input.css`, which
find the pieces by name, not position. `tests/blocks.test.js` lists them.

### Classes, not style attributes

The hand pages place their pieces with 27 style attributes between them. Markup
generated into every post cannot do that and still be retuned by the theme, so
each is a class in `input.css`, beside the rules the hand pages already rely on,
with the same values. The hand pages are unchanged: their inline styles say the
same thing and still win. The ruler's segment lengths stay inline, because they
are data about the page, the way `--ar` is on a gallery cell.

### Which metadata field, from where

Lightroom and ExifTool write a title to XMP `dc:title` and IPTC ObjectName, and
a description to XMP `dc:description`, IPTC Caption-Abstract and usually EXIF
ImageDescription. Windows Explorer writes its Title to XPTitle *and*
ImageDescription. Cameras write ImageDescription too, with "OLYMPUS DIGITAL
CAMERA" in it. `exif.js` now reads all three blocks, and `describedAs()` picks:
XMP, then IPTC, then EXIF; boilerplate ignored; a caption that only repeats the
title is no caption. Over the site's 195 originals that gives 97 titles and 96
captions, all from XMP written by ExifTool.

The title goes to the picture's title and the description to its caption —
never its alt text, which describes the picture for someone who cannot see it
and is not the same sentence as the photographer's. The caption is now the
lightbox description (alt stands in without one), so the caption field is shown
for every picture rather than only in waterfall galleries.

### Read from the file, not remembered from the import

The first version kept what it read in the editor's memory: gone on reload,
never offered for a picture picked from the library, and lost for good when the
import re-encoded the file, because a fresh encode carries no metadata at all.
Now the server reads the title and caption from the head of each file whenever
it lists a post folder or the site library, and a re-encoded import is given a
minimal XMP packet back — title, caption, creator and rights, and nothing else:
no camera data, no location. Replacing a picture no longer keeps the old
picture's alt text.

### Not done

- Alt text is never filled in from metadata, on purpose.
- XMP sidecar files (`.xmp` beside a raw file) are still not read. XMP embedded
  in the JPEG is.
- The hand pages C and D keep their inline styles; they could now use the
  classes, but they are the reference the renderer was checked against.
- `post_hero_collage` and `post_hero_salon` are drafts, and their pictures have
  no alt text yet.
- `post_blocks.json` has an empty feature block (no title, no picture), which
  the checker reports as two errors. Not touched here.

---

## The feature block, laid over its picture

The feature block gains a `layout`: **overlay**, the new default, is the
"Featured dispatch" block from `block_test_page.html` — the glass panel laid
over the picture — and **beside** is the 3:4 plate next to a solid panel it
rendered before. `post_blocks.json`'s "Featured — 01" is pinned to `beside`, so
it stays the twin of the hand-written block it mirrors.

The hand-written dispatch crops its picture to a fixed height (a viewport
fraction, 3:2 on a phone) and pins the panel to the far edge. That suits a
photograph chosen for it, not one chosen in the editor, which can be any shape.
So the builder's version keeps the picture's own proportions:

- The plate carries the measured ratio as `--ar`, the way a gallery cell does,
  and `.feature-overlay-native` in `css/input.css` gives it that aspect ratio.
  Nothing is cropped.
- A ratio alone makes a portrait taller than the screen, which is why the hand
  block uses a height. The plate's width is the smaller of the room the panel
  leaves and what a `min(80vh, 44rem)` height allows at that ratio, so a
  portrait narrows instead of growing.
- The picture and the panel sit in a row with the panel pulled back over the
  picture by the lap, and the pair is centred, so the overlap holds however
  narrow the picture ends up. `image_side: right` reverses the row; the picture
  stays first in the source, so the panel still paints over it.
- On a phone the two stack, the panel stepping over the picture's lower edge,
  as in the hand block.

Checked in a headless browser at 1440 and 390 wide against the hand block, with
a 2.4:1 panorama, a 16:9 landscape and a 0.71 portrait. One trade-off: on a
phone, the 3rem step over a panorama's lower edge covers about a third of what
is a short strip.

The beside layout still crops to 3:4, as the hand block does.
