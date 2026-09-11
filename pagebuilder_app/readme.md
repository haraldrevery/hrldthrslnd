# Page builder

The page builder is not a separate application. It is a mode of the site
generator:

```bash
./site_generate --edit            # opens http://127.0.0.1:8484
./site_generate --edit --port 9000
```

On Windows, `site_generate.exe --edit`. The generator prints the address and
tries to open a browser; if none opens, paste the address into one.

There is nothing to install. The editor is four plain files —
[`../eleventy_binary/editor/`](../eleventy_binary/editor/) — embedded in the
binary and served on the loopback address. It runs the same validator, renderer,
image codecs and checks the build runs, on the same files.

## Using it

The page is the interface. The middle of the screen is the post as it will be
published; the panel on the right edits whatever you click in it.

- **Click a block** on the page to select it. A toolbar appears on it: drag the
  ⋮⋮ grip to move it, the arrows to nudge it, ⧉ to duplicate, ✕ to remove.
  "+ Add block" under it inserts a new block there.
- **Click a picture** in a gallery to edit its alt text, title and caption.
- **Drop photographs from your computer** onto the page. Onto a gallery, they
  are added to it. Onto a hero or a feature, the first one becomes its picture.
  Anywhere else, they become a new gallery at that spot. Any number at once;
  a progress bar shows each one being imported.
- **Gallery pictures** are a grid of thumbnails in the panel. Drag to reorder,
  "+ Upload" to add from your computer, "From library…" to pick from this
  post's files or from the site-wide folders (`image/`, `svg/`, `gif/` …).
- **Files** tab: everything in the post folder, with what is on the page and
  what is not. Select several and "Add to page", or drag them onto the page.
- **Page** tab: title, description, date, subjects, card image, draft, and the
  saved versions under History.
- The badge in the top bar says what the build will say. Click it for the list;
  click an item to jump to the field.
- Desktop, tablet and phone widths are the three buttons at the top.

Shortcuts: Ctrl+S saves and keeps a revision, Ctrl+Z / Ctrl+Shift+Z undo and
redo, Delete removes the selected block or picture, Escape deselects.

Text is edited in the panel, not on the page. Typing directly into the preview
would mean turning rendered HTML back into markdown, and a wrong round trip
silently rewrites your words.

## What it edits

A post folder whose page is a JSON document:

```
input_custom_post/my_trip/
├── my_trip.json        <-- the page. The build renders it; the editor edits it.
├── photo.jpg           <-- assets, referred to by bare name
├── photo_min.jpg       <-- made on import (or by the build if missing)
└── .revisions/         <-- every replaced version of the document; never published
```

The format is described in [`../page_builder_plan.md`](../page_builder_plan.md)
and defined by [`../eleventy_binary/lib/blocks/catalogue.js`](../eleventy_binary/lib/blocks/catalogue.js).
A document can be written by hand in any text editor, and
`./site_generate --check-post my_trip` says what the editor would say about it.

## What it does to a photograph you add

Turned upright from its EXIF orientation. If it is over the site's photograph
budget or over 2800px on a side, re-encoded as a JPEG under both. Its GPS block
is emptied and any GPS values in an XMP packet blanked; the rest of the file is
untouched. A `_min` counterpart under 80 kB is made with the same MozJPEG
settings the build uses. A title, description and date found in the EXIF are
offered as suggestions for the picture's fields. Video, audio, GIF and SVG files
are checked and passed through unchanged; the editor tells you what it saw.

## What it will never do

Delete a file, or overwrite one. An upload whose name is taken is saved under
the next free name, and its thumbnail with it.
A file dropped outside a drop target is ignored rather than opened, so a missed
drop cannot navigate away from unsaved work. Removing a picture from a page removes the reference; the
file stays in the folder until you delete it yourself.

## Safety of the document

Every save is written to a temporary file and renamed into place. An explicit
save (the Save button, Ctrl-S) keeps a copy of the version it replaced in
`.revisions/`; autosave keeps one every fifteen minutes. Undo and redo work
across every edit in the session.

## Building

The Build button runs `site_generate` as a separate process — exactly what you
would run yourself — and shows its report. A build with drafts is marked as
such and must not be deployed; the editor says so.
