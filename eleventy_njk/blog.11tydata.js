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

    /*
     * The page number belongs in the title and the description, because both
     * come from blog.njk's front matter and are therefore the SAME on every
     * page of the journal. Each page canonicalises to itself, so a site with
     * more than one page of entries published a run of pages with one title,
     * one description and one <h1> between them, distinguishable only by their
     * contents — invisible today at 35 entries and 40 per page, and live the
     * moment the 41st is written.
     *
     * Page 1 keeps the plain wording, matching its plain URL. Written as a
     * fallback to `data.title` so the words themselves stay in blog.njk, where
     * an author looking for them would think to look.
     */
    title: (data) =>
      data.pagination.pageNumber === 0
        ? data.title
        : `${data.title} — page ${data.pagination.pageNumber + 1}`,

    description: (data) =>
      data.pagination.pageNumber === 0
        ? data.description
        : `${data.description} Page ${data.pagination.pageNumber + 1} of ${data.pagination.pages.length}.`,
  },
};
