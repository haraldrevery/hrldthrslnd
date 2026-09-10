/**
 * Data cascade for markdown posts.
 *
 * IMPORTANT: this file is loaded from disk by Eleventy at build time, including
 * when the build runs from the compiled site_generate binary — where there is
 * no node_modules to resolve against. It must therefore import nothing but
 * Node builtins. Anything needing the markdown parser or the image helpers is
 * computed in eleventy_binary/lib/eleventy_config.js instead, which is bundled.
 */
export default {
  layout: "post.njk",
  pageKind: "markdown",
  tags: [],
  // A second name for `tags`. The two are merged into one subject list
  // before anything renders, so a page can use either or both.
  category: [],
  draft: false,

  // Markdown only — no Liquid or Nunjucks pre-pass, so a stray {{ or {% in a
  // post reaches the browser as typed instead of breaking the build.
  // NOTE: `false` here would switch off markdown rendering too, publishing the
  // raw source; "md" turns off only the template engine layer.
  templateEngineOverride: "md",

  eleventyComputed: {
    // The permalink comes from the slug registry, which resolves it before
    // Eleventy starts: normally from the file's path, but from a `permalink:`
    // in this page's own front matter when it declares one. Resolved there
    // rather than read here on purpose — the unpublished check, the sitemap,
    // the feed and the search index all read the same record, and a value
    // taken here would be invisible to every one of them.
    permalink: (data) => data.slugRegistry?.[data.page.inputPath]?.permalink ?? false,
  },
};
