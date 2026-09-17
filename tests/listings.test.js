/**
 * listings.js — the names and the paging of every page the build generates
 * from data rather than from a file.
 *
 * Two properties are worth the tests. A generated page must never take a URL a
 * real page already holds, because Eleventy refuses two templates writing one
 * file and the whole build stops; and the name a subject gets must not depend
 * on anything that moves, or an unrelated post can quietly move a URL.
 */
import { test, expect, describe } from "bun:test";

import {
  TAG_PREFIX,
  CATEGORY_PREFIX,
  listingHref,
  occupiedBases,
  assignSlugs,
  paginate,
} from "../eleventy_binary/lib/listings.js";

describe("listingHref", () => {
  test("page 1 keeps the clean URL, later pages are numbered", () => {
    expect(listingHref("tag_astronomy")).toBe("/tag_astronomy.html");
    expect(listingHref("tag_astronomy", 0)).toBe("/tag_astronomy.html");
    expect(listingHref("tag_astronomy", 1)).toBe("/tag_astronomy_page_2.html");
    expect(listingHref("categories", 4)).toBe("/categories_page_5.html");
  });
});

describe("occupiedBases", () => {
  test("a permalink occupies its own name", () => {
    expect(occupiedBases(["/tag_x.html"]).has("tag_x")).toBe(true);
  });

  test("a numbered page occupies the run it belongs to as well", () => {
    // Whether a subject HAS a second page depends on how many entries carry
    // it, so a name that would only collide once it grows has to be taken now.
    const bases = occupiedBases(["/tag_x_page_2.html"]);
    expect(bases.has("tag_x_page_2")).toBe(true);
    expect(bases.has("tag_x")).toBe(true);
  });

  test("anything that is not an .html permalink is ignored", () => {
    expect(occupiedBases(["/feed.xml", "", null]).size).toBe(0);
  });
});

describe("assignSlugs", () => {
  const subjects = (...names) => names.map((name) => ({ key: name.toLowerCase(), name }));

  test("a subject is named after itself", () => {
    const { slugs, renamed } = assignSlugs(subjects("Astronomy"), { prefix: TAG_PREFIX });
    expect(slugs.get("astronomy")).toBe("astronomy");
    expect(renamed).toEqual([]);
  });

  test("two subjects that reduce to one name are separated by suffix", () => {
    // headingSlug strips punctuation, so C++ and C# both want "c". The key
    // decides which keeps it — "c#" sorts before "c++" — and not which of the
    // two was handed over first.
    const { slugs, renamed } = assignSlugs(subjects("C++", "C#"), { prefix: TAG_PREFIX });
    expect(slugs.get("c#")).toBe("c");
    expect(slugs.get("c++")).toBe("c-2");
    expect(renamed).toHaveLength(1);
    expect(renamed[0].blockedBy).toBe("C#");
  });

  test("the order is the key's, not the order they were handed over", () => {
    // The display list is sorted by how many entries carry each subject, so
    // tying the names to it would let publishing one post take a URL away.
    const forwards = assignSlugs(subjects("C++", "C#"), { prefix: TAG_PREFIX });
    const backwards = assignSlugs(subjects("C#", "C++"), { prefix: TAG_PREFIX });
    expect([...backwards.slugs]).toEqual([...forwards.slugs]);
  });

  test("a page holding the URL makes the generated page step aside", () => {
    const occupied = occupiedBases(["/tag_astronomy.html"]);
    const { slugs, renamed } = assignSlugs(subjects("Astronomy"), { prefix: TAG_PREFIX, occupied });
    expect(slugs.get("astronomy")).toBe("astronomy-2");
    expect(renamed[0].blockedBy).toBe("page");
  });

  test("a page holding a numbered page of the run does too", () => {
    const occupied = occupiedBases(["/tag_astronomy_page_2.html"]);
    const { slugs } = assignSlugs(subjects("Astronomy"), { prefix: TAG_PREFIX, occupied });
    expect(slugs.get("astronomy")).toBe("astronomy-2");
  });

  test("only the matching prefix blocks a name", () => {
    // /category_x.html and /tag_x.html are different pages and must not fight.
    const occupied = occupiedBases(["/category_x.html"]);
    expect(assignSlugs(subjects("X"), { prefix: TAG_PREFIX, occupied }).slugs.get("x")).toBe("x");
    expect(assignSlugs(subjects("X"), { prefix: CATEGORY_PREFIX, occupied }).slugs.get("x")).toBe("x-2");
  });

  test("a declared slug is used instead of the name", () => {
    const { slugs } = assignSlugs([{ key: "a", name: "Night Sky", slug: "night" }], {
      prefix: CATEGORY_PREFIX,
    });
    expect(slugs.get("a")).toBe("night");
  });
});

describe("paginate", () => {
  const items = [1, 2, 3, 4, 5];
  const href = (n) => listingHref("tag_x", n);

  test("cuts into pages that carry their own URL and pager", () => {
    const pages = paginate(items, 2, href);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.href)).toEqual([
      "/tag_x.html",
      "/tag_x_page_2.html",
      "/tag_x_page_3.html",
    ]);
    expect(pages[1].entries).toEqual([3, 4]);
    expect(pages[1].first).toBe(3);
    expect(pages[1].pageCount).toBe(3);
    expect(pages[1].total).toBe(5);
  });

  test("the pager names its neighbours, and stops at both ends", () => {
    const [first, middle, last] = paginate(items, 2, href);
    expect(first.pager.href.previous).toBeNull();
    expect(first.pager.href.next).toBe("/tag_x_page_2.html");
    expect(middle.pager.href.previous).toBe("/tag_x.html");
    expect(last.pager.href.next).toBeNull();
    // Every page lists the whole run, which is what the numbered links are.
    expect(last.pager.hrefs).toHaveLength(3);
  });

  test("an empty list still gets its one page, unless asked otherwise", () => {
    // A category's card links its first page whether or not anything is filed
    // under it yet, so that page has to exist.
    expect(paginate([], 10, href)).toHaveLength(1);
    expect(paginate([], 10, href)[0].entries).toEqual([]);
    expect(paginate([], 10, href, { keepEmpty: false })).toHaveLength(0);
  });

  test("a size that is not a positive whole number puts everything on one page", () => {
    expect(paginate(items, 0, href)).toHaveLength(1);
    expect(paginate(items, undefined, href)[0].entries).toHaveLength(5);
  });
});
