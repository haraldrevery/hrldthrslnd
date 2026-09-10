/**
 * Data cascade for hand-written HTML pages.
 *
 * A file that opens with <!doctype html> is a complete document and is
 * published verbatim (front matter aside). Anything else is a fragment and gets
 * wrapped in the site layout — so a page can pick either level of control.
 *
 * Loaded from disk at build time, including from the compiled binary, so it
 * imports nothing. See input_markdown.11tydata.js for the full explanation.
 */
export default {
  pageKind: "custom_html",
  tags: [],
  // A second name for `tags`. The two are merged into one subject list
  // before anything renders, so a page can use either or both.
  category: [],
  draft: false,
  // Author-written HTML is never run through a template engine.
  templateEngineOverride: false,

  eleventyComputed: {
    // The permalink comes from the slug registry, which resolves it before
    // Eleventy starts: normally from the file's path, but from a `permalink:`
    // in this page's own front matter when it declares one. Resolved there
    // rather than read here on purpose — the unpublished check, the sitemap,
    // the feed and the search index all read the same record, and a value
    // taken here would be invisible to every one of them.
    permalink: (data) => data.slugRegistry?.[data.page.inputPath]?.permalink ?? false,
    layout: (data) =>
      /^\s*<!doctype\s+html/i.test(data.page.rawInput ?? "") ? false : "page.njk",
  },
};
