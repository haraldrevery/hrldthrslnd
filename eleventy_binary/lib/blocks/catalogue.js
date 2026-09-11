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
 *   image       one picture: { src, alt, title, caption }
 *   images      a list of pictures, each as above
 *   file        one asset path — a video, a clip, a download
 *   strings     a short list of one-line strings
 *   actions     a list of { label, href } buttons
 *   faq_items   a list of { question, answer } where answer is markdown
 *   blocks      nested blocks — used by `columns` alone
 *
 * `hero: true` marks the one block that may open a page and may appear nowhere
 * else. `inColumns: false` keeps a block out of a two-column row: a hero owns
 * the viewport, a feature block is already two columns, and columns do not nest.
 */

export const FORMAT_VERSION = 1;

const IMAGE_FIELDS = "src, alt, title and caption";

export const BLOCKS = [
  {
    type: "hero",
    label: "Hero",
    description: "The opening screen. One per page, always first, and it carries the page's h1.",
    hero: true,
    inColumns: false,
    fields: [
      {
        name: "variant",
        label: "Treatment",
        kind: "select",
        default: "stage",
        options: [
          { value: "stage", label: "Stage — type on the site's ground, no photograph" },
          { value: "photo", label: "Photograph — full bleed, always light on dark" },
          { value: "photo_adaptive", label: "Photograph — full bleed, follows the colour scheme" },
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
        help: "The ground for the two photograph treatments; ignored by the stage.",
      },
      { name: "actions", label: "Buttons", kind: "actions", help: "The first is solid, the rest are ghost buttons." },
      { name: "scroll_cue", label: "Scroll cue", kind: "boolean", default: true },
    ],
  },
  {
    type: "heading",
    label: "Heading",
    description: "A section masthead: eyebrow, heading and the gradient rule.",
    fields: [
      { name: "eyebrow", label: "Eyebrow", kind: "text" },
      { name: "title", label: "Heading", kind: "text", required: true },
    ],
  },
  {
    type: "text",
    label: "Text",
    description: "Markdown with KaTeX, typeset at build time. A # heading becomes an h2.",
    fields: [{ name: "markdown", label: "Markdown", kind: "markdown", required: true }],
  },
  {
    type: "gallery",
    label: "Gallery",
    description: "A run of pictures in one of three layouts. Video, GIF and SVG cells work too.",
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
          { value: "uniform", label: "Uniform — every cell cropped square" },
          { value: "waterfall", label: "Waterfall — columns, with captions" },
        ],
      },
      { name: "gap", label: "Gap", kind: "text", default: "0.75rem", help: "Any CSS length." },
      { name: "images", label: "Pictures", kind: "images", required: true, help: `Each carries ${IMAGE_FIELDS}.` },
    ],
  },
  {
    type: "video",
    label: "Video",
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
    description: "One picture beside a panel of catch text. Already two columns, so it cannot go in a row.",
    inColumns: false,
    fields: [
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
    type: "raw_html",
    label: "Raw HTML",
    description: "An escape hatch. Emitted verbatim; no template engine runs over it.",
    fields: [{ name: "html", label: "HTML", kind: "html", required: true }],
  },
  {
    type: "columns",
    label: "Two columns",
    description: "Any two blocks side by side. They stack on a phone.",
    inColumns: false,
    fields: [{ name: "items", label: "Blocks", kind: "blocks", count: 2, required: true }],
  },
];

export const BY_TYPE = new Map(BLOCKS.map((block) => [block.type, block]));

/** The block types that may sit inside a two-column row. */
export const COLUMN_TYPES = BLOCKS.filter((b) => b.inColumns !== false).map((b) => b.type);

/**
 * A new block of the given type with every default filled in and every list
 * empty, which is what the editor inserts and what the tests start from.
 */
export function defaultBlock(type) {
  const spec = BY_TYPE.get(type);
  if (!spec) throw new Error(`unknown block type "${type}"`);
  const block = { type };
  for (const field of spec.fields) {
    if (field.default !== undefined) block[field.name] = field.default;
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
