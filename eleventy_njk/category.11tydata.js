/**
 * Pagination for the category pages.
 *
 * Two levels of paging, as for the subject pages (see tag.11tydata.js): every
 * category, and every page of each. The listings in
 * eleventy_binary/lib/eleventy_config.js cut both into one flat list,
 * `collections.categoryPages`, and this template takes it one item at a time.
 *
 * Loaded from disk at build time, including from the compiled binary, so it
 * imports nothing.
 */
export default {
  pagination: {
    data: "collections.categoryPages",
    size: 1,
    alias: "categoryPage",
    addAllPagesToCollections: true,
  },
  eleventyComputed: {
    // /category_<slug>.html, then _page_2 onwards — written by the listings, so
    // the card and the page take the URL from the same place.
    permalink: (data) => data.categoryPage.href,

    title: (data) =>
      data.categoryPage.pageNumber === 0
        ? data.categoryPage.category.title
        : `${data.categoryPage.category.title} — page ${data.categoryPage.pageNumber + 1}`,

    // The category's own description where it has one. Numbered from page 2,
    // for the reason blog.11tydata.js gives.
    description: (data) => {
      const { category, pageNumber, pageCount } = data.categoryPage;
      const base = category.description || `Entries filed under ${category.title}.`;
      return pageNumber === 0 ? base : `${base} Page ${pageNumber + 1} of ${pageCount}.`;
    },

    // The category's picture for the social card, already resolved to its
    // compressed counterpart. Overrides the site-wide `thumbnail` in
    // eleventy_config.js, which would otherwise fall back to default_image.
    thumbnail: (data) => data.categoryPage.category.thumbnail,
  },
};
