/**
 * Pagination for the journal index.
 *
 * Lives here rather than in blog.njk's front matter because `posts_per_page`
 * comes from site_settings.json, and Eleventy resolves pagination config before
 * computed data runs.
 *
 * Reads the settings file directly with a Node builtin: this file is loaded
 * from disk at build time, including from the compiled binary, where importing
 * from node_modules is not possible.
 */
import fs from "node:fs";

let perPage = 40;
try {
  const settings = JSON.parse(fs.readFileSync("site_settings.json", "utf8"));
  if (Number.isFinite(settings.posts_per_page) && settings.posts_per_page > 0) {
    perPage = settings.posts_per_page;
  }
} catch {
  // loadSettings() already reports a missing or malformed settings file; fall
  // back quietly rather than reporting it twice.
}

export default {
  pagination: {
    data: "collections.posts",
    size: perPage,
    alias: "entries",
    // Page 2 onwards are crawlable pages like any other; without this only
    // /blog.html would ever reach the sitemap.
    addAllPagesToCollections: true,
  },
  eleventyComputed: {
    // Page 1 keeps the clean /blog.html URL; later pages are numbered.
    permalink: (data) =>
      data.pagination.pageNumber === 0
        ? "/blog.html"
        : `/blog_page_${data.pagination.pageNumber + 1}.html`,
  },
};
