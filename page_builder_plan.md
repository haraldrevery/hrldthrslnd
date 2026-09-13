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
`download`, `faq`, `feature`, `stage_notes`, `stage_wash`, `raw_html`, and
`columns`, which holds exactly two of the others. `hero` may only be the first
block; the two `stage_` blocks run the full width of the page and cannot sit in
a column. The catalogue file is the authoritative field list.

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
| Fourth pass | done | two full-width blocks, field notes (1–5) and wash (1–6); `bleed`, `records` with `min`/`max`, `decorative` pictures; a stylesheet test. See below |

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

---

## Fourth pass: two full-width blocks

Two requests: block_test_page.html's "Section 04 — Field notes" with one to
five notes, and its "Section 03 — Wash" with one to six tiles. Both are a
`.photo-stage-adaptive` band: a photograph as the ground, type over it that
follows the reader's scheme. They are `stage_notes` and `stage_wash` in the
format — names that are permanent once a post is saved, so they are named for
what they are (a photo stage) rather than for a test page's section numbers.

Four things had to change underneath before either could be added.

### A block that is not in the column

Every block was `<section class="shell block">`, and `.shell` caps a block at
the column's width. A band has to reach both edges, so the catalogue gains
`bleed: true` and the renderer a third wrapper beside the hero's:
`<section class="block-bleed block-<type> photo-stage photo-stage-adaptive">`
with a `.shell` inside for the type. `.block` pads a block's bottom, which on a
band would be photograph; `.block-bleed` pads both ends and keeps the page's
rhythm below it as a margin. Neither band may sit in a column.

### Lists with bounds, as data

`actions` and `faq_items` are lists of small objects, each written out by hand
in the catalogue, the validator and the editor. Two more of those would have
been four copies. The catalogue gains one general kind, `records`, whose
entries' keys are the field's `item` list, with `min` and `max`: the validator
reports a count outside them at the list and a missing required key at the key
("note 2 has no heading"), the editor stops adding at `max` and removing at
`min`, and a new block starts with `min` empty entries. The JSON is a plain
list of objects either way, so the format stays at 1. `actions` and
`faq_items` are left as they are; their messages are worded for what they
hold, and moving them over gains nothing a reader would see.

The renderer also slices to `max`, so a hand-edited file with seven notes
renders five, and the validator says why.

### A picture that is a ground

Both originals give the photograph `alt=""` on purpose: it is the section's
ground, and what it shows is said in the text over it. The validator warned
about missing alt text on every picture, so a band could never be clean. An
image field can now be `decorative`: no alt warning, an empty alt in the
markup, no lightbox, no alt field in the editor, and not counted among the
page's plates — the collage's "N plates" and the salon's stamp count pictures
on the page, and a band's ground is not one.

### What the renderer works out, and what it is told

| Piece | Rendered from |
|---|---|
| Note numbers | the note's position: "Note 01", then the note's own label after " · " |
| Note layout | the count, by the stylesheet alone — see below |
| Heading | a textarea; each line break is a `<br>`, as in the originals |
| Wash accent | an `accent` field, matched once, as on the hero; missing from the heading is a warning on both |
| Quote | optional. Without it the tiles take the full width. How many to a row is the block's `tile_columns` since the fifth pass |
| Ground | the original file, lazy, measured; unmeasurable is a warning |

`.panel-field` placed three notes and nothing past them: a fourth landed in a
single twelfth of the grid. The stylesheet now counts from both ends — the
third of four, the fourth of five — and sets the last two as a second
staggered pair one column to the right of the first. It needs no class from
the renderer, so a hand-written field of four or five gets it too; one to
three are unchanged.

The originals' 20-odd style attributes are classes in `css/input.css`
(`.block-bleed`, `.bleed-*`, `.stat-grid-cols-2`/`-3` in the fifth pass and
`.stat-grid-fit` since the seventh, `.stat-tile-text`, `.note-card`,
`.note-text`), with the same values.

### Smaller changes made on the way

- Block glyphs live in the catalogue (`glyph`) rather than in a table in the
  editor.
- A drop onto the canvas fills the first picture field of any block that has
  one; the canvas learns which blocks take pictures from the catalogue, by way
  of the editor, instead of a list of type names.
- `defaultBlock()` copies a field's default rather than sharing it.
- A test renders every block and fails on any class the renderer writes that
  `css/main.css` does not style, other than the `block-<type>` and
  `block-col-<type>` hooks. It is what catches an `input.css` change with
  `update_css.sh` not run.
- `post_blocks.json`'s hero is the stage hero again ("Block / test / post");
  test text had been saved over it. It carries a wash and a field-notes band
  mirroring the hand-written sections.

### Not done

- `actions` and `faq_items` are not moved onto `records` (see above).
- A band's scheme is always adaptive, as both originals are. A dark-only band
  would be one select on each block when it is wanted.
- Note and tile text is plain text; a blank line starts a paragraph.
- The ground is the full original. Files imported through the editor are
  capped at 2800px; files in the site library are not, and the wash's fog
  picture is 4705px wide.

---

## Fifth pass: the wash's tile columns, and the uniform gallery's shape

Two requests: a three-column option for the wash's tiles, and a custom ratio
and height for the uniform gallery.

### Wash: two or three tiles to a row

`tile_columns` is a select, "2" (the default, and what every wash so far has
been) or "3". It means "at most": `.stat-grid-cols-2` and `.stat-grid-cols-3`
are auto-fit grids whose minimum track is the larger of 13rem and 40% (or 30%)
of the grid, so the percentage caps the count, 13rem makes a narrow screen
drop to fewer, and a phone gets one. Auto-fit rather than a fixed count keeps
`.stat-grid`'s outer rules whole: the first row is always full. These replace
the fourth pass's `.stat-grid-fit` and its `:has()` rule, which picked the
count from the number of tiles instead of from the author.

Three tiles in half the row are too narrow to read, so beside a quote the
three-column wash is `.bleed-pair-wide`: the quote takes two fifths and the
tiles three, from 48rem up, like `.block-two-col` itself. The quote was
capped at 44ch already and loses nothing it was using.

### Uniform gallery: ratio and height

| Field | Empty | Set |
|---|---|---|
| `ratio` | square, as before | every cell cropped to it: `--tile-ar` on the grid |
| `height` | the cells share out the column, as before | every cell exactly that tall and as wide as the ratio makes it; as many to a row as fit, rows centred (`.gallery-uniform-sized`, `--tile-h`). A cell wider than a phone's column narrows to it. Replaced in the sixth pass by a minimum that fills each row |

A ratio is written 3:2, 3/2, 3x2 or 1.5, and must lie between 1:5 and 5:1.
The editor offers the usual ones in a drop-down that still takes anything
typed. A height is a CSS length other than a percentage and above zero.

The hand-written uniform grid is untouched: `.gallery-uniform figure` reads
`var(--tile-ar, 1)`, and a grid that does not set it is square.

### Built on the way

- **Fields that belong to a layout.** Ratio and height mean nothing in a
  justified or waterfall gallery, so they carry `variants: ["uniform"]` like the
  hero's treatment-specific fields, and the gallery names `layout` as its
  `variantField`. `variantOf()`, the validator and the editor read that; a
  field outside its layout is hidden, not checked, and not rendered.
- **Values that must parse.** `lib/blocks/units.js` reads CSS lengths and
  ratios, once, for the validator and the renderer. A text field with a
  `format` ("length", "height", "ratio") is warned about at the field when it
  does not parse, and the renderer leaves it out. The gallery's gap gets the
  same check: a gap of "12" used to fall back to 0.75rem without a word.
- **Suggestions.** A text field may carry `suggestions`, drawn as a datalist.
- **Vector tiles in any shape.** An SVG in a uniform grid is a `.tile-vector`,
  whose artwork sized itself by its own width: right in a square cell, and
  spilling out of a 3:2 or 16:9 one. The tile is now a one-track grid the size
  of its inner box, so the artwork fits whatever the cell's ratio.
- **Checked in a headless browser**, against a copy of the project, at 1440,
  820 and 390 wide: washes of three, four and six tiles at two and three
  columns, with and without a quote; uniform galleries empty, 3:2, 4:5 at
  16rem, 16:9 at 10rem, 2:3 at 20rem and 1:1 at 8rem; the hand-written uniform
  grid, unchanged. The editor was driven through the new fields: ratio and
  height appear only for the uniform layout, an unreadable ratio is flagged at
  its field, and three tile columns reach the canvas.

---

## Sixth pass: the uniform gallery's row height, as a minimum

The fifth pass made the height exact: every cell that tall, rows centred,
empty space at the edges. Asked for instead: a height that is not so strict,
rows that fill the width, nothing odd as the page scales, and gaps that do not
change.

Every cell has the same ratio and the gap is fixed, so a row that fills the
width exactly can only be as tall as the width shared among n cells allows.
The height stops being a size and becomes the target that chooses n. Three
rules were weighed at the gallery widths of a 1440, 1024 and 820 screen and a
phone (3:2 at 12rem shown; 4:5, 16:9 and 1:1 behave alike):

| Rule | 1440 | 1024 | 820 | Phone |
|---|---|---|---|---|
| Exact (fifth pass) | 4 across, 184px empty | 3, 64px empty | 2, 156px empty | 1, 54px empty |
| Minimum (chosen) | 4 across, 116% | 3, 107% | 2, 127% | 1, 119% |
| Nearest fit | 5 across, 92% | 3, 107% | 3, 84% | 1, 119% |

Percentages are the height a cell gets as a share of the number. Over every
case the minimum rule lands at 100–130%, and on a phone a tall ratio goes one
to a row at the column's full width (up to 167% for 4:5 at 16rem), which is
what the justified gallery does on a phone too. Nearest fit is closer (82–120%)
but plain CSS cannot compute it: it needs a script, or typed arithmetic with
container queries, too new to rely on for a site meant to build unchanged for
ten years. It could be layered on later with the minimum rule as its fallback.
Capping each cell's width inside a wider track was rejected outright: the
visible gaps would grow.

So `.gallery-uniform-sized` is `repeat(auto-fit, minmax(min(100%, height ×
ratio), 1fr))` — the square grid's own mechanism with its 14rem minimum
replaced. As the window widens, cells grow until one more fits, then drop back
to the height; nothing jumps or overflows, and the gap is the grid's gap.

A gallery with fewer pictures than a row holds would stretch them to fill it —
two 16:9 pictures at 10rem on a wide screen became 2.4 times the height. The
renderer writes the picture count as `--tile-count`, and the grid is never
wider than that many cells a quarter past the height, plus their gaps: a short
gallery grows as a full row would, then stops and centres. A partial last row
of a longer gallery stays left-aligned at the row's cell size, as in every
uniform grid; centring it would take different cell sizes or gaps.

The field is labelled "Row height" now. The key in the JSON is still `height`,
so nothing saved changes.

---

## Seventh pass: the tile grid, and columns chosen by the text

Asked for: block_test_page.html's "The page, in six instruments" (the
"Extended readout" tiles) as a block, splitting into three to six columns by
how much the tiles say.

### Why the count has to know the tiles

The hand block is `repeat(auto-fit, minmax(15rem, 1fr))`: as many tiles as
fit. Measured, its six tiles are five and one alone at a 1440 window, six in
a row at 1920, and 3 + 3 at 1024 and 820. A grid that only knows the space
cannot avoid the lone tile; one that knows how many tiles there are can.

### The rule (lib/blocks/measure.js)

1. Each tile's width is estimated from its characters: the label on one line,
   no heading word broken, the heading in two lines, the text in about five.
   The widths per character were measured once on the live page (heading 12.4,
   label 11.2, text 7.4 px, 40px of padding) and live in one table there.
2. The grid's tile is the widest of them, at least 13rem; that says how many
   fit in the column of a 1440 window (1360px).
3. Of three up to that many — never more than six, never more than the
   tiles — the count that leaves the fewest empty cells in the last row wins,
   the larger on a tie.

| Tiles | Wide screen |
|---|---|
| 6 short (the hand block) | 6 across (the hand block: 5 + 1) |
| 6 of about 200 characters | 3 + 3 |
| 8 short | 4 + 4 |
| 7 short | 4 + 3 |
| 5 short | 5 across |
| 10 medium | 5 + 5 |

The author can set 3, 4, 5 or 6 instead of Auto; that count is taken as it
is. The grid carries `--cols` and `--tile-min` as custom properties — data
about the page, like `--ar` — and one rule, `.stat-grid-fit`, lays it out:
a track is the larger of `--tile-min` and a `--cols`-th of the grid, so a wide
screen gets the count and a narrower one gives up columns rather than squeeze
the text. Balanced on wide screens, by choice: at in-between widths a lone
tile is possible (six short tiles are 4 + 2 at 1024). Balancing at every
width would take container queries and a ladder of rules per count.

The wash's `.stat-grid-cols-2` and `-3` are replaced by the same rule with
`--cols` 2 or 3; the widths they give are the same to the pixel.

### Smaller things

- Tile headings are `.display-sm`, which has no word-breaking rule; a word
  longer than a tile now breaks (`overflow-wrap: anywhere`) rather than cross
  the hairline. measure.js avoids that in the first place by keeping the
  longest heading word on one line.
- The block stays out of two-column rows: the estimate assumes the full
  column.
- Numbers are the renderer's, as on the field notes: "01 · Ground".

`post_blocks.json` gains a 4:5 gallery at 16rem beside the square one.

## Alternating words, and the accent judged as it is drawn

The hero and the wash can set every other word of the title in the gradient
instead of one accent phrase: `alternate`, a checkbox, off by default.

- It starts on the first word, so the box shows even on a one-word title.
- The count runs on across line breaks: where a short screen drops a
  `.hero-break`, the joined line still alternates.
- A word is a run between spaces, punctuation and all. A no-break space ties
  two words into one. A run with no letter or digit — a dash, an ampersand —
  stays in ink and takes no turn.
- It takes the place of the accent. An accent left filled in is a note, not a
  warning, and is still there when the box is unticked.
- Each word is a `.text-flow` span of its own, so the reduced-motion and
  no-background-clip fallbacks, the adaptive panels' ink and the salon's
  gilding all apply as they are. No CSS was added. Each word carries its own
  copy of the gradient, sized to the word.
- Only `true` turns it on. Off, the markup is what it was, byte for byte.

The validator now matches the accent the way `titleLines` does — trimmed,
within one line of the title. It used to compare the untrimmed accent with the
whole title, so `" in layers"` warned although the page highlighted it, and an
accent spanning a line break passed although nothing was highlighted.

---

## Side by side, and back

Asked for: a button beside "Add block" that sets two neighbouring blocks side
by side as one two-column row, and one that splits a row back into two blocks.

- **Where.** The pill under the selected block gains a second, dark button.
  "Two columns" appears when the selected block and the one below may both sit
  in a column — `COLUMN_TYPES`, handed to the canvas with the labels the way
  `takesPictures` is. "Split columns" appears under a row, including when a
  column inside it is selected, which is how a row is usually selected. The
  pill therefore now sits under the row when a column is selected, and its
  "Add block" inserts after the row; before, it disappeared. The inspector's
  row panel gains "Split into two blocks" beside "Swap columns".
- **Nothing is copied.** Joining moves the two block objects into `items` as
  they are; splitting moves them back. A join then a split leaves the file byte
  for byte as it was. Each is one undo step.
- **A split does not drop what nobody can see.** An empty column leaves nothing
  behind. A third item, or a block that may not sit in a column — possible only
  in a file edited by hand, and drawn as an empty slot or not at all — comes
  out with the rest, and the checks say what is wrong with it. A row with both
  columns empty is not split; remove it.
- **The editor decides.** The canvas offers a button from what it has drawn;
  `joinBlocks()` and `splitRow()` check the document again before acting.
- **A contract test**: every column-safe block gives the same findings alone
  and in a row. That is the premise of moving a block unchanged; a rule that
  judged a block by where it stands would break it.
- The row panel's column cards overflowed the inspector when a summary was
  long (`1fr` tracks), hiding the second Edit button. Now `minmax(0, 1fr)`.

Checked in a headless browser against a copy of the project, 21 checks: the
offer where allowed and nowhere else (the hero, a feature, the block above an
existing row), the join, the split from the canvas with a column selected, the
round trip on disk, undo and redo, the split from the inspector, the pill at
phone width, and no console errors.

### Not done, and worth knowing

- Only the block below is offered as a partner; to join with the block above,
  select that one.
- A row is always 50/50. Blocks keep their own markup in a column but lose the
  `.block-<type>` rules of their section: a heading drops `.block-heading`'s
  top padding and sits higher than a text block beside it. That is how rows
  have always rendered — it is one click away now.
- Rows hold exactly two and do not nest. Both are written into the catalogue
  (`count: 2`), the validator, the renderer's `slice(0, 2)`, `.block-two-col`
  and six path patterns in the editor and canvas (`.items[n]`, one level).
- The two functions live in editor.js, which has no unit tests; the headless
  run is their only check. The editor also restates `defaultBlock()`, and the
  two already differ for a row: `[null, null]` in the editor, `[]` in the
  catalogue.
- `site_generate --edit` has this only once the binary is recompiled.
