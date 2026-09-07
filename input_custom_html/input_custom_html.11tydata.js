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
  draft: false,
  // Author-written HTML is never run through a template engine.
  templateEngineOverride: false,

  eleventyComputed: {
    permalink: (data) => data.slugRegistry?.[data.page.inputPath]?.permalink ?? false,
    layout: (data) =>
      /^\s*<!doctype\s+html/i.test(data.page.rawInput ?? "") ? false : "page.njk",
  },
};
