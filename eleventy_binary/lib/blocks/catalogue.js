/**
 * The block catalogue: the contract between the post format, the validator,
 * the renderer and the editor.
 *
 * A block type exists if and only if it is listed here. The validator reads
 * the field list to know what is required and what a select may hold; the
 * renderer switches on `type`; the editor builds its forms from `fields`. A new
 * block is an entry here plus a render function, and nothing else has to be
 * told.
 *
 * Pure data, no imports, so the editor page can be handed this table over the
 * wire and read it as it is.
 *
 * Field kinds, and what the editor draws for them:
 *
 *   text        one line
 *   textarea    several lines of plain text
 *   markdown    a markdown + KaTeX editor
 *   html        raw HTML, emitted verbatim
 *   boolean     a checkbox
 *   select      one of `options`
 *
 * A text field may carry a `placeholder`: what the renderer prints when the
 * field is left empty, shown greyed in the empty field. `suggestions` are
 * offered in a drop-down that still takes anything typed. `format` says what
 * the text must parse as — "length" (a CSS length), "height" (one that is not
 * a percentage and not zero) or "ratio" (3:2) — read by units.js the same way
 * in the validator, which warns when it cannot, and the renderer, which then
 * leaves the value out.
 *   image       one picture: { src, alt, title, caption }
 *   images      a list of pictures, each as above
 *   file        one asset path — a video, a clip, a download
 *   strings     a short list of one-line strings
 *   actions     a list of { label, href } buttons
 *   faq_items   a list of { question, answer } where answer is markdown
 *   records     a list of small objects whose keys are the field's `item`
 *               list — each a text or textarea field that may be `required`.
 *               `itemLabel` names one of them in a message ("note 2 has no
 *               heading"), `addLabel` is the editor's button. A new list of
 *               this kind is catalogue data alone: the validator, the editor
 *               and the default block all read `item`.
 *   blocks      nested blocks — used by `columns` alone
 *
 * `min` and `max` on a list field bound how many it may hold. The validator
 * reports a count outside them as an error, the editor stops adding at `max`
 * and removing at `min`, and a new block starts with `min` empty entries.
 *
 * `hero: true` marks the one block that may open a page and may appear nowhere
 * else. `inColumns: false` keeps a block out of a two-column row: a hero owns
 * the viewport, a feature block is already two columns, and columns do not nest.
 *
 * `bleed: true` marks a block that runs the full width of the page instead of
 * sitting in the column: a photo stage, with the block's picture as its
 * ground. The renderer gives it its own wrapper (see renderTop), and it cannot
 * sit in a column either.
 *
 * `decorative: true` on an image field marks a picture that is a ground, not
 * content: the text over it says what it shows, so it is published with an
 * empty alt, no lightbox, and no alt-text warning, and it is not counted among
 * the page's plates.
 *
 * `glyph` is the one-character mark the editor shows beside the block's label.
 *
 * A block whose fields depend on its `variant` says so on the field, not in
 * the code that reads it. The variant is the select named "variant", or the
 * one the block names as its `variantField` — the gallery's ratio and height
 * belong to its "uniform" layout:
 *
 *   variants     the variants that use this field. Elsewhere the editor hides
 *                it, the validator skips it and the renderer ignores it — a
 *                photograph left behind on a stage hero is not on the page.
 *   requiredFor  the variants that cannot render without it.
 *   strict       on a select: a value this build does not know is an error,
 *                not a fallback. A hero treatment added by a newer build must
 *                not be published by an older one as a plain stage.
 */

export const FORMAT_VERSION = 1;

const IMAGE_FIELDS = "src, alt, title and caption";

/** The hero treatments that are built around a photograph. */
const PHOTOGRAPHIC = ["photo", "photo_adaptive", "collage", "salon"];

export const BLOCKS = [
  {
    type: "hero",
    label: "Hero",
    glyph: "H1",
    description: "The opening screen. One per page, always first, and it carries the page's h1.",
    hero: true,
    inColumns: false,
    fields: [
      {
        name: "variant",
        label: "Treatment",
        kind: "select",
        default: "stage",
        strict: true,
        options: [
          { value: "stage", label: "Stage — type on the site's ground, no photograph" },
          { value: "photo", label: "Photo, dark — full bleed, always light type on a darkened picture" },
          { value: "photo_adaptive", label: "Photo, adaptive — full bleed, follows the reader's colour scheme" },
          { value: "collage", label: "Collage — a portrait, a landscape and the masthead on a glass panel, overlapping" },
          { value: "salon", label: "Salon — the type beside one portrait hung on a mount, in gilded light" },
        ],
      },
      { name: "eyebrow", label: "Eyebrow", kind: "text", help: "The small label above the title." },
      {
        name: "title",
        label: "Title",
        kind: "textarea",
        required: true,
        help: "The page's h1. Each line break is a soft break that only survives where there is room.",
      },
      {
        name: "accent",
        label: "Accent word",
        kind: "text",
        help: "A word or phrase from the title to set in the chroma gradient. Must appear in the title exactly.",
      },
      { name: "lede", label: "Lede", kind: "textarea" },
      {
        name: "image",
        label: "Photograph",
        kind: "image",
        variants: PHOTOGRAPHIC,
        requiredFor: PHOTOGRAPHIC,
        help: "The ground for the photo treatments; the portrait in the collage and the salon. Its caption and title are printed beside it there.",
      },
      {
        name: "image_2",
        label: "Second picture",
        kind: "image",
        variants: ["collage"],
        help: "The landscape at the top right of the collage. Without it that corner stays empty.",
      },
      {
        name: "stamp",
        label: "Stamp line",
        kind: "text",
        variants: ["collage"],
        placeholder: "The post's first subject",
        help: "The small line under the date on the collage's stamp. Left empty it is the post's first subject.",
      },
      {
        name: "plate",
        label: "Plate label",
        kind: "text",
        variants: ["salon"],
        placeholder: "Plate I",
        help: "The label before the portrait's title under the frame. Left empty it reads “Plate I”.",
      },
      {
        name: "inscription",
        label: "Engraved line",
        kind: "text",
        variants: ["salon"],
        help: "The line at the foot of the salon. Left empty it reads: author · the date in Roman numerals · the first subject.",
      },
      { name: "actions", label: "Buttons", kind: "actions", help: "The first is solid, the rest are ghost buttons." },
      { name: "scroll_cue", label: "Scroll cue", kind: "boolean", default: true },
    ],
  },
  {
    type: "heading",
    label: "Heading",
    glyph: "H",
    description: "A section masthead: eyebrow, heading and the gradient rule.",
    fields: [
      { name: "eyebrow", label: "Eyebrow", kind: "text" },
      { name: "title", label: "Heading", kind: "text", required: true },
    ],
  },
  {
    type: "text",
    label: "Text",
    glyph: "¶",
    description: "Markdown with KaTeX, typeset at build time. A # heading becomes an h2.",
    fields: [{ name: "markdown", label: "Markdown", kind: "markdown", required: true }],
  },
  {
    type: "gallery",
    label: "Gallery",
    glyph: "▦",
    description: "A run of pictures in one of three layouts. Video, GIF and SVG cells work too.",
    variantField: "layout",
    fields: [
      { name: "title", label: "Heading", kind: "text" },
      { name: "lede", label: "Lede", kind: "textarea" },
      {
        name: "layout",
        label: "Layout",
        kind: "select",
        default: "justified",
        options: [
          { value: "justified", label: "Justified — native ratios, rows fill the column" },
          { value: "uniform", label: "Uniform — every cell cropped to one ratio, square unless you choose one" },
          { value: "waterfall", label: "Waterfall — columns, with captions" },
        ],
      },
      {
        name: "ratio",
        label: "Ratio",
        kind: "text",
        variants: ["uniform"],
        format: "ratio",
        placeholder: "1:1",
        suggestions: ["1:1", "4:5", "3:4", "2:3", "4:3", "3:2", "16:9", "21:9"],
        help: "Width to height, such as 3:2 or 4:5, between 1:5 and 5:1. Every picture is cropped to it. Left empty, the cells are square.",
      },
      {
        name: "height",
        label: "Row height",
        kind: "text",
        variants: ["uniform"],
        format: "height",
        placeholder: "The usual size",
        help: "The smallest a cell gets: a CSS length such as 12rem or 240px. Each row fits as many cells as that allows and they grow to fill the width, so a cell ends up this tall or a little taller. A gallery too short to fill a row grows by up to a quarter and is centred. Left empty, the cells are the usual size.",
      },
      { name: "gap", label: "Gap", kind: "text", default: "0.75rem", format: "length", help: "A CSS length such as 0.75rem or 12px." },
      { name: "images", label: "Pictures", kind: "images", required: true, help: `Each carries ${IMAGE_FIELDS}.` },
    ],
  },
  {
    type: "video",
    label: "Video",
    glyph: "▶",
    description: "The browser's own player in the site's frame, with a title and the numbers worth knowing.",
    fields: [
      { name: "eyebrow", label: "Eyebrow", kind: "text" },
      { name: "title", label: "Title", kind: "text" },
      { name: "src", label: "File", kind: "file", accept: "video", required: true },
      { name: "poster", label: "Poster frame", kind: "file", accept: "image", help: "Defaults to a _min counterpart of the same name if one exists." },
      { name: "meta", label: "Meta line", kind: "strings", help: "Short facts under the player: duration, resolution, codec." },
      { name: "caption", label: "Caption", kind: "textarea" },
      { name: "download", label: "Offer a download link", kind: "boolean", default: true },
    ],
  },
  {
    type: "audio",
    label: "Audio",
    glyph: "♪",
    description: "The browser's own audio controls, with a title and a caption.",
    fields: [
      { name: "eyebrow", label: "Eyebrow", kind: "text" },
      { name: "title", label: "Title", kind: "text" },
      { name: "src", label: "File", kind: "file", accept: "audio", required: true },
      { name: "meta", label: "Meta line", kind: "strings" },
      { name: "caption", label: "Caption", kind: "textarea" },
      { name: "download", label: "Offer a download link", kind: "boolean", default: true },
    ],
  },
  {
    type: "download",
    label: "Download",
    glyph: "↓",
    description: "A file to download, with its size, SHA-256 and SHA-512 filled in at build time.",
    fields: [
      { name: "eyebrow", label: "Eyebrow", kind: "text" },
      { name: "title", label: "Title", kind: "text", help: "Defaults to the file name." },
      { name: "src", label: "File", kind: "file", accept: "any", required: true },
      { name: "note", label: "Note", kind: "textarea" },
    ],
  },
  {
    type: "faq",
    label: "FAQ",
    glyph: "?",
    description: "Questions that open and close without any script.",
    fields: [
      { name: "title", label: "Heading", kind: "text" },
      { name: "items", label: "Questions", kind: "faq_items", required: true },
      { name: "open_first", label: "Open the first one", kind: "boolean", default: false },
    ],
  },
  {
    type: "feature",
    label: "Feature",
    glyph: "◧",
    description: "One picture and a panel of catch text, laid over the picture or set beside it. Already two columns, so it cannot go in a row.",
    inColumns: false,
    fields: [
      {
        name: "layout",
        label: "Layout",
        kind: "select",
        default: "overlay",
        options: [
          { value: "overlay", label: "Over — the glass panel laid over the picture, which keeps its own proportions" },
          { value: "beside", label: "Beside — a 3:4 plate next to a solid panel" },
        ],
      },
      { name: "eyebrow", label: "Eyebrow", kind: "text" },
      { name: "title", label: "Heading", kind: "text", required: true },
      { name: "text", label: "Text", kind: "markdown" },
      { name: "image", label: "Picture", kind: "image", required: true },
      {
        name: "image_side",
        label: "Picture on the",
        kind: "select",
        default: "left",
        options: [
          { value: "left", label: "left" },
          { value: "right", label: "right" },
        ],
      },
      { name: "action_label", label: "Button label", kind: "text" },
      { name: "action_href", label: "Button link", kind: "text" },
    ],
  },
  {
    type: "stage_notes",
    label: "Field notes",
    glyph: "▤",
    description: "One to five glass notes pinned across a photograph that runs the full width of the page.",
    bleed: true,
    inColumns: false,
    fields: [
      { name: "eyebrow", label: "Eyebrow", kind: "text" },
      { name: "title", label: "Heading", kind: "textarea", required: true, help: "Each line break is kept." },
      {
        name: "image",
        label: "Photograph",
        kind: "image",
        required: true,
        decorative: true,
        help: "The ground the notes are pinned to. Published without alt text: the notes are what it says.",
      },
      {
        name: "notes",
        label: "Notes",
        kind: "records",
        required: true,
        min: 1,
        max: 5,
        itemLabel: "note",
        addLabel: "Add note",
        help: "Each is numbered for you — “Note 01”, “Note 02” — and the label follows the number.",
        item: [
          { name: "label", label: "Label", kind: "text", placeholder: "Label after the note's number — a height, a place" },
          { name: "title", label: "Heading", kind: "text", required: true },
          { name: "text", label: "Text", kind: "textarea" },
        ],
      },
    ],
  },
  {
    type: "stage_wash",
    label: "Wash",
    glyph: "◐",
    description: "A heading, a quote and one to six tiles over a photograph that runs the full width of the page.",
    bleed: true,
    inColumns: false,
    fields: [
      { name: "eyebrow", label: "Eyebrow", kind: "text" },
      { name: "title", label: "Heading", kind: "textarea", required: true, help: "Set large. Each line break is kept." },
      {
        name: "accent",
        label: "Accent word",
        kind: "text",
        help: "A word or phrase from the heading to set in the chroma gradient. Must appear in the heading exactly.",
      },
      {
        name: "image",
        label: "Photograph",
        kind: "image",
        required: true,
        decorative: true,
        help: "The ground the section is washed over. Published without alt text: the text over it is what it says.",
      },
      { name: "quote", label: "Quote", kind: "textarea", help: "Set beside the tiles. Without one, the tiles take the full width." },
      {
        name: "tile_columns",
        label: "Tile columns",
        kind: "select",
        default: "2",
        options: [
          { value: "2", label: "Two — at most two tiles to a row; beside a quote, the tiles take half the width" },
          { value: "3", label: "Three — at most three to a row; beside a quote, the tiles take three fifths of the width" },
        ],
        help: "Fewer to a row where the screen is too narrow for them; one on a phone.",
      },
      {
        name: "tiles",
        label: "Tiles",
        kind: "records",
        required: true,
        min: 1,
        max: 6,
        itemLabel: "tile",
        addLabel: "Add tile",
        item: [
          { name: "label", label: "Label", kind: "text", placeholder: "Label — a word or two" },
          { name: "text", label: "Text", kind: "textarea", required: true },
        ],
      },
    ],
  },
  {
    type: "tile_grid",
    label: "Tile grid",
    glyph: "⊞",
    description: "Three to twelve numbered tiles in a hairline grid, three to six across — worked out from how much each tile says, so no tile is left alone on a row of a wide screen.",
    inColumns: false,
    fields: [
      { name: "eyebrow", label: "Eyebrow", kind: "text" },
      { name: "title", label: "Heading", kind: "text" },
      { name: "lede", label: "Lede", kind: "textarea" },
      {
        name: "tile_columns",
        label: "Columns",
        kind: "select",
        default: "auto",
        options: [
          { value: "auto", label: "Auto — three to six, from how much the tiles say, with no tile left alone on a row of a wide screen" },
          { value: "3", label: "3 — three across on a wide screen" },
          { value: "4", label: "4 — four across on a wide screen" },
          { value: "5", label: "5 — five across on a wide screen" },
          { value: "6", label: "6 — six across on a wide screen" },
        ],
        help: "On a narrower screen the grid gives up columns rather than squeeze its text; one on a phone.",
      },
      {
        name: "tiles",
        label: "Tiles",
        kind: "records",
        required: true,
        min: 3,
        max: 12,
        itemLabel: "tile",
        addLabel: "Add tile",
        help: "Each is numbered for you — “01”, “02” — and the label follows the number.",
        item: [
          { name: "label", label: "Label", kind: "text", placeholder: "Label after the tile's number — a word or two" },
          { name: "title", label: "Heading", kind: "text", required: true },
          { name: "text", label: "Text", kind: "textarea" },
        ],
      },
    ],
  },
  {
    type: "raw_html",
    label: "Raw HTML",
    glyph: "</>",
    description: "An escape hatch. Emitted verbatim; no template engine runs over it.",
    fields: [{ name: "html", label: "HTML", kind: "html", required: true }],
  },
  {
    type: "columns",
    label: "Two columns",
    glyph: "▥",
    description: "Any two blocks side by side. They stack on a phone.",
    inColumns: false,
    fields: [{ name: "items", label: "Blocks", kind: "blocks", count: 2, required: true }],
  },
];

export const BY_TYPE = new Map(BLOCKS.map((block) => [block.type, block]));

/**
 * The variant a block is rendered as: its own when that is one of the
 * options, the default otherwise. Null for a block without variants. The
 * select is the one named by the block's `variantField` — the gallery's
 * `layout` — and "variant" when it names none.
 */
export function variantOf(spec, block) {
  const name = spec.variantField ?? "variant";
  const field = spec.fields.find((f) => f.name === name);
  if (!field) return null;
  return field.options.some((o) => o.value === block?.[name]) ? block[name] : field.default;
}

/** Whether a field is part of the block as it is rendered — see `variants`. */
export function fieldApplies(spec, field, block) {
  return !field.variants || field.variants.includes(variantOf(spec, block));
}

/** The block types that may sit inside a two-column row. */
export const COLUMN_TYPES = BLOCKS.filter((b) => b.inColumns !== false).map((b) => b.type);

/** One empty entry for a `records` field: every key of its `item`, blank. */
export function blankRecord(field) {
  return Object.fromEntries(field.item.map((f) => [f.name, ""]));
}

/**
 * A new block of the given type with every default filled in and every list
 * empty, which is what the editor inserts and what the tests start from.
 * Defaults are copied, so two new blocks never share a list.
 */
export function defaultBlock(type) {
  const spec = BY_TYPE.get(type);
  if (!spec) throw new Error(`unknown block type "${type}"`);
  const block = { type };
  for (const field of spec.fields) {
    if (field.default !== undefined) block[field.name] = structuredClone(field.default);
    else if (field.kind === "records") block[field.name] = Array.from({ length: field.min ?? 0 }, () => blankRecord(field));
    else if (field.kind === "images" || field.kind === "strings" || field.kind === "actions" || field.kind === "faq_items") block[field.name] = [];
    else if (field.kind === "blocks") block[field.name] = [];
    else if (field.kind === "image") block[field.name] = null;
    else block[field.name] = "";
  }
  return block;
}

/** The meta fields of a post, in the order the editor shows them. */
export const META_FIELDS = [
  { name: "title", label: "Title", kind: "text", required: true },
  { name: "date", label: "Date", kind: "date", required: true, help: "YYYY-MM-DD" },
  { name: "description", label: "Description", kind: "textarea", required: true, help: "The meta description, the card excerpt and the search snippet." },
  { name: "tags", label: "Tags", kind: "strings", help: "Tags and categories are one list; either will do." },
  { name: "category", label: "Categories", kind: "strings" },
  { name: "image", label: "Card image", kind: "file", accept: "image", help: "The card thumbnail and the social image. Its _min counterpart is what ships." },
  { name: "author", label: "Author", kind: "text" },
  { name: "updated", label: "Updated", kind: "date", help: "Set when an entry is edited after publishing." },
  { name: "permalink", label: "Permalink", kind: "text", help: "Optional. A site-absolute path ending in .html; the folder's assets stay where they are." },
  { name: "draft", label: "Draft", kind: "boolean", default: false, help: "A draft is not built at all unless the build is run with --drafts." },
];

export default BLOCKS;
