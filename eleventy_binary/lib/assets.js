/**
 * Automatic asset inclusion.
 *
 * KaTeX's stylesheet and the glightbox bundle are only needed by pages that
 * actually contain maths or lightbox links. Deciding that with a flag in front
 * matter turned out to be a trap: a hand-written page copied out of
 * block_test_page.html carries lightbox anchors but no flag, so the links
 * silently did nothing.
 *
 * This inspects the finished HTML instead. A page gets exactly the assets its
 * own markup asks for, and an author never has to remember a flag — which
 * matters, because copy-and-paste is the documented way to build a page here.
 */

const ASSETS = [
  {
    // KaTeX output always carries this class; the stylesheet is what makes it
    // legible. No KaTeX script is ever loaded — the maths is already typeset.
    test: (html) => html.includes('class="katex'),
    head: '<link rel="stylesheet" href="/css/katex.css">',
  },
  {
    test: (html) => /class="[^"]*\bglightbox\b/.test(html),
    head: '<link rel="stylesheet" href="/css/glightbox.min.css">',
    body:
      '<script src="/javascript/glightbox.min.js" defer></script>\n' +
      '<script src="/javascript/glightbox_settings_min.js" defer></script>',
  },
  {
    test: (html) => html.includes('id="width-cycle"'),
    body: '<script src="/javascript/reading_width.js" defer></script>',
  },
];

/**
 * Where vendor stylesheets go: before the site stylesheet in base.njk.
 *
 * That order is a courtesy, not the mechanism. vendor_assets.sh wraps every
 * vendored sheet in `@layer vendor`, and both that sheet and main.css declare
 * the site's full layer order, so our rules outrank them by layer precedence —
 * which beats both specificity and source order. GLightbox's
 * `.glightbox-clean .gslide-title` and KaTeX's `.katex{font:…}` are the two
 * cases that used to depend on whichever <link> the browser read last.
 */
const VENDOR_CSS_MARKER = "<!--vendor-css-->";

export function injectAssets(html) {
  if (typeof html !== "string") return html;
  if (!html.includes("</head>") || !html.includes("</body>")) return html;

  // Commented-out markup is documentation, not a dependency. block_test_page.html
  // shows lightbox anchors inside comments so they can be copied, and pulling in
  // 70 kB of vendor CSS and JS for markup the browser will never render is the
  // exact waste this pass exists to avoid. Only the tests read this copy — the
  // page itself is written back with nothing removed.
  const visible = html.replace(/<!--[\s\S]*?-->/g, "");

  const head = [];
  const body = [];

  for (const asset of ASSETS) {
    if (!asset.test(visible)) continue;
    // Idempotent: a complete hand-written document that already links these
    // must not get a second copy. Checked against the visible copy too, so a
    // link that only exists inside a comment does not count as present.
    if (asset.head && !visible.includes(asset.head)) head.push(asset.head);
    if (asset.body && !visible.includes(asset.body)) body.push(asset.body);
  }

  let output = html;

  if (head.length) {
    const block = head.join("\n");
    output = output.includes(VENDOR_CSS_MARKER)
      ? output.replace(VENDOR_CSS_MARKER, block)
      // A complete hand-written document has no marker, so the sheet lands
      // after whatever it already links, main.css included. That is safe:
      // main.css carries the same `@layer …, vendor, …` order statement, so it
      // has already registered `vendor` in the right place by the time this
      // sheet is parsed, whichever order the two arrive in.
      : output.replace("</head>", `${block}\n</head>`);
  } else {
    output = output.replace(VENDOR_CSS_MARKER, "");
  }

  if (body.length) output = output.replace("</body>", `${body.join("\n")}\n</body>`);
  return output;
}

export default injectAssets;
