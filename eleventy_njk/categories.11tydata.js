/**
 * Pagination for the category overview, /categories.html.
 *
 * Paged in the listings in eleventy_binary/lib/eleventy_config.js rather than
 * by `pagination.size` here, because the page size comes from category.json —
 * the same reason full_index.11tydata.js pages over collections.fullIndex.
 *
 * Loaded from disk at build time, including from the compiled binary, so it
 * imports nothing.
 */
export default {
  pagination: {
    data: "collections.categoryIndex",
    size: 1,
    alias: "categoryIndexPage",
    // Every page is a real, crawlable URL — the sitemap should list them all.
    addAllPagesToCollections: true,
  },
  eleventyComputed: {
    // /categories.html, then /categories_page_2.html onward. Reserved in
    // eleventy_binary/lib/slugs.js, since a computed URL cannot be read there.
    permalink: (data) => data.categoryIndexPage.href,

    // Numbered from page 2, for the reason blog.11tydata.js gives: each page
    // canonicalises to itself, so they must not share a title and description.
    title: (data) =>
      data.categoryIndexPage.pageNumber === 0
        ? data.title
        : `${data.title} — page ${data.categoryIndexPage.pageNumber + 1}`,

    description: (data) =>
      data.categoryIndexPage.pageNumber === 0
        ? data.description
        : `${data.description} Page ${data.categoryIndexPage.pageNumber + 1} of ${data.categoryIndexPage.pageCount}.`,
  },
};
