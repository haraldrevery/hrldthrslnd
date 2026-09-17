/**
 * Pagination for the subject pages.
 *
 * Two levels of paging — every subject, and every page of each — and Eleventy
 * pages one list at a time. So the listings in eleventy_binary/lib/eleventy_config.js
 * cut both levels into one flat list, `collections.tagPages`, and this template
 * takes it one item at a time. Each item carries its own URL and its own pager.
 *
 * Loaded from disk at build time, including from the compiled binary, so it
 * imports nothing.
 */
export default {
  pagination: {
    data: "collections.tagPages",
    size: 1,
    alias: "tagPage",
    // Every subject page is a real, crawlable URL. Without this Eleventy adds
    // only the first page of a paginated template to its collections, so the
    // sitemap listed one subject and silently dropped the rest.
    addAllPagesToCollections: true,
  },
  eleventyComputed: {
    // Written by the listings, so the page and every chip linking to it take
    // the URL from the same place: /tag_<slug>.html, then _page_2 onwards.
    permalink: (data) => data.tagPage.href,

    // Numbered from page 2, for the reason blog.11tydata.js gives: each page
    // canonicalises to itself, so they must not share a title and description.
    title: (data) =>
      data.tagPage.pageNumber === 0
        ? data.tagPage.subject.tag
        : `${data.tagPage.subject.tag} — page ${data.tagPage.pageNumber + 1}`,

    description: (data) => {
      const base = `Entries filed under ${data.tagPage.subject.tag}.`;
      return data.tagPage.pageNumber === 0
        ? base
        : `${base} Page ${data.tagPage.pageNumber + 1} of ${data.tagPage.pageCount}.`;
    },
  },
};
