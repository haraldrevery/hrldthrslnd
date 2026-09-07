/**
 * Data cascade for page-builder post folders.
 *
 * Same doctype rule as input_custom_html/. The folder's other files are copied
 * to /<slug>/ by the generator, so relative asset paths inside the page keep
 * resolving.
 *
 * Loaded from disk at build time, including from the compiled binary, so it
 * imports nothing. See input_markdown.11tydata.js for the full explanation.
 */
export default {
  pageKind: "custom_post",
  tags: [],
  draft: false,
  templateEngineOverride: false,

  eleventyComputed: {
    permalink: (data) => data.slugRegistry?.[data.page.inputPath]?.permalink ?? false,
    layout: (data) =>
      /^\s*<!doctype\s+html/i.test(data.page.rawInput ?? "") ? false : "page.njk",
  },
};
