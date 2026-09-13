/**
 * Pagination for the full index.
 *
 * Unlike blog.11tydata.js this reads no settings file. The page size is applied
 * in eleventy_binary/lib/eleventy_config.js, which hands over collections.fullIndex
 * already cut into pages, so each page of this template is one item of it.
 *
 * Loaded from disk at build time, including from the compiled binary, so it
 * imports nothing.
 */
export default {
  pagination: {
    data: "collections.fullIndex",
    size: 1,
    alias: "indexPage",
    // Every page is a real, crawlable URL — the sitemap should list them all.
    addAllPagesToCollections: true,
  },
  eleventyComputed: {
    /*
     * Page 1 keeps the clean URL. Later pages are /full_index_page_N.html, not
     * /full_index_N.html: the slug registry resolves a collision by appending
     * _2, _3 …, so a note called full_index.md is published as full_index_2 —
     * which is where page 2 would have been, and the build would have failed
     * on the duplicate the day the index grew a second page.
     */
    permalink: (data) =>
      data.pagination.pageNumber === 0
        ? "/full_index.html"
        : `/full_index_page_${data.pagination.pageNumber + 1}.html`,

    // Numbered from page 2, for the reason blog.11tydata.js gives: each page
    // canonicalises to itself, so they must not share a title and description.
    title: (data) =>
      data.pagination.pageNumber === 0
        ? data.title
        : `${data.title} — page ${data.pagination.pageNumber + 1}`,

    description: (data) =>
      data.pagination.pageNumber === 0
        ? data.description
        : `${data.description} Page ${data.pagination.pageNumber + 1} of ${data.pagination.pages.length}.`,

    // The newest change among this page's entries, which sitemap.njk sends as
    // <lastmod>. Without it the page reports its template file's date.
    updated: (data) => data.indexPage?.lastModified || undefined,
  },
};
