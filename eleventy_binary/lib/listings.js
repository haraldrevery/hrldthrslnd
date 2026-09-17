/**
 * Listings — the pages the build generates from data rather than from files:
 * one run of pages per subject, one per category, and the category overview.
 *
 * Pure on purpose — no Eleventy, no filesystem — so the two decisions that can
 * silently break a URL are testable on their own: which name a generated page
 * is published under, and how a list is cut into numbered pages.
 *
 *   /tag_<slug>.html              /tag_<slug>_page_2.html …
 *   /category_<slug>.html         /category_<slug>_page_2.html …
 *   /categories.html              /categories_page_2.html …
 *
 * THE TWO ALPHABETS. A generated slug comes from headingSlug(), which writes
 * [a-z0-9-]; a page's slug comes from slugify(), which writes [a-z0-9_]. The
 * `_page_N` suffix is therefore unambiguous — no subject can be named into it —
 * and a page file can only ever collide with a generated page whose slug has no
 * hyphen in it. That collision is still common enough to design for: a note
 * called "Category Theory.md" is /category_theory.html, which is exactly where
 * a category titled "Theory" would go.
 */
import { headingSlug } from "./paths.js";

export const TAG_PREFIX = "tag_";
export const CATEGORY_PREFIX = "category_";
export const CATEGORIES_BASE = "categories";

/**
 * The URL of page `pageNumber` (0-based) of a listing published at `base`.
 * Page 1 keeps the clean name, the way /blog.html and /full_index.html do.
 */
export function listingHref(base, pageNumber = 0) {
  return pageNumber === 0 ? `/${base}.html` : `/${base}_page_${pageNumber + 1}.html`;
}

/**
 * Every listing base a set of published URLs already occupies.
 *
 * `/tag_x.html` occupies `tag_x`, and so does `/tag_x_page_3.html`. The second
 * is counted even though tag x may only have one page today: whether it has two
 * depends on how many entries carry it, and a URL that moved the day a subject
 * grew a second page would be exactly the silent breakage this exists to stop.
 */
export function occupiedBases(permalinks) {
  const bases = new Set();
  for (const permalink of permalinks) {
    const match = /^\/(.+)\.html$/i.exec(String(permalink));
    if (!match) continue;
    bases.add(match[1]);
    const paged = /^(.+)_page_\d+$/.exec(match[1]);
    if (paged) bases.add(paged[1]);
  }
  return bases;
}

/**
 * Give each item a slug under `prefix`, resolving collisions by suffix.
 *
 * Two kinds of collision, resolved the same way — the GENERATED page steps
 * aside, never the file:
 *
 *   another item   "C++" and "C#" both reduce to "c"
 *   a real page    a file, or a declared permalink, already publishes there
 *
 * The second used to be a build failure: Eleventy refuses two templates writing
 * one file, and the whole build stopped over a note that happened to be named
 * after a subject. Renaming the file instead would move a URL that exists for
 * the benefit of one that is generated, which slugs.js refuses on principle.
 *
 * Assigned in code-unit order of `key`, never in display order, so publishing
 * an entry cannot reshuffle which of two colliding items keeps the bare name.
 *
 * @param {Iterable<{key: string, name: string, slug?: string}>} items
 *   `slug`, when given, is used instead of headingSlug(name).
 * @param {object} options
 * @param {string} options.prefix         e.g. "tag_"
 * @param {Set<string>} [options.occupied] from occupiedBases()
 * @returns {{ slugs: Map<string, string>, renamed: object[] }}
 *   `renamed` lists every item that did not get the name it wanted, and why.
 */
export function assignSlugs(items, { prefix, occupied = new Set() }) {
  const slugs = new Map();
  const renamed = [];
  const owners = new Map();

  const ordered = [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  for (const item of ordered) {
    const desired = item.slug || headingSlug(item.name);
    let slug = desired;
    let suffix = 1;

    const holder = (candidate) =>
      owners.get(candidate) ?? (occupied.has(`${prefix}${candidate}`) ? "page" : null);

    const first = holder(desired);
    while (holder(slug)) {
      suffix += 1;
      slug = `${desired}-${suffix}`;
    }

    if (slug !== desired) {
      renamed.push({
        key: item.key,
        name: item.name,
        desired,
        slug,
        // "page" when a file holds the URL, otherwise the name of the item that does.
        blockedBy: first,
      });
    }

    owners.set(slug, item.name);
    slugs.set(item.key, slug);
  }

  return { slugs, renamed };
}

/**
 * Cut a list into numbered pages.
 *
 * Each page carries its own pager — the same shape as Eleventy's `pagination`
 * object, as far as pagination.njk reads it — because a template that pages
 * over these pages one at a time gets an Eleventy `pagination` describing the
 * WHOLE run: every page of every subject. Its hrefs would list them all.
 *
 * @param {Array} items
 * @param {number} size          items per page
 * @param {(n: number) => string} hrefFor  URL of page n, 0-based
 * @param {object} [options]
 * @param {boolean} [options.keepEmpty=true]
 *   An empty list still gets its one page. Right for a category, whose card
 *   links its first page whether or not anything is filed under it yet.
 */
export function paginate(items, size, hrefFor, { keepEmpty = true } = {}) {
  const per = Number.isInteger(size) && size > 0 ? size : items.length || 1;
  const chunks = [];
  for (let start = 0; start < items.length; start += per) {
    chunks.push(items.slice(start, start + per));
  }
  if (chunks.length === 0 && keepEmpty) chunks.push([]);

  const hrefs = chunks.map((_, n) => hrefFor(n));

  return chunks.map((entries, pageNumber) => ({
    entries,
    pageNumber,
    pageCount: chunks.length,
    // 1-based position of the first entry on this page, for numbering.
    first: pageNumber * per + 1,
    total: items.length,
    href: hrefs[pageNumber],
    pager: {
      hrefs,
      href: {
        previous: pageNumber > 0 ? hrefs[pageNumber - 1] : null,
        next: pageNumber < chunks.length - 1 ? hrefs[pageNumber + 1] : null,
      },
    },
  }));
}
