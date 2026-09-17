/**
 * categories.js — category.json, which is hand-written and therefore has to be
 * read defensively.
 *
 * The rule the tests are really about: a fault in this file costs the
 * categories, never the build. A trailing comma, a missing title, a subject
 * spelled three ways — each is reported and the site still renders.
 */
import { test, expect, describe, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import {
  readCategories,
  parseCategories,
  inCategory,
  DEFAULT_PER_PAGE,
} from "../eleventy_binary/lib/categories.js";
import { makeProject, removeProject } from "./helpers.js";

const created = [];
function project(files) {
  const root = makeProject(files);
  created.push(root);
  return root;
}
afterEach(() => {
  while (created.length) removeProject(created.pop());
});

const doc = (categories, rest = {}) => JSON.stringify({ ...rest, categories });
const messages = (findings) => findings.map((f) => f.message);

describe("readCategories", () => {
  test("no file at all is not a fault — the site simply has no categories", () => {
    const result = readCategories(project({ "site_settings.json": "{}" }));
    expect(result.present).toBe(false);
    expect(result.categories).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  test("a file that does not parse is one error, and no categories", () => {
    const root = project({ "category.json": '{ "categories": [ { "title": "A" }, ] }' });
    const result = readCategories(root);
    expect(result.categories).toEqual([]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].level).toBe("error");
    expect(result.findings[0].page).toBe("category.json");
  });

  test("a good file is read", () => {
    const root = project({
      "category.json": doc([{ title: "Night Sky", description: "d", thumbnail: "/image/x.jpg", tags: ["astronomy"] }]),
    });
    const result = readCategories(root);
    expect(result.present).toBe(true);
    expect(result.findings).toEqual([]);
    expect(result.categories[0]).toMatchObject({
      index: 0,
      title: "Night Sky",
      description: "d",
      thumbnail: "/image/x.jpg",
      subjects: ["astronomy"],
      keys: ["astronomy"],
    });
  });
});

describe("parseCategories", () => {
  test("a category with no tags matches its own title", () => {
    // What keeps `category: [Astronomy]` in front matter working with no list
    // to maintain: the category titled Astronomy gathers the subject Astronomy.
    const { categories } = parseCategories(JSON.parse(doc([{ title: "Astronomy", description: "d", thumbnail: "/i.jpg" }])));
    expect(categories[0].subjects).toEqual(["Astronomy"]);
    expect(categories[0].keys).toEqual(["astronomy"]);
  });

  test("tags may be a list or a comma-separated string, and are folded for matching", () => {
    const { categories } = parseCategories(
      JSON.parse(doc([
        { title: "A", description: "d", thumbnail: "/i.jpg", tags: ["One", "TWO"] },
        { title: "B", description: "d", thumbnail: "/i.jpg", tags: "one, two" },
      ])),
    );
    expect(categories[0].keys).toEqual(["one", "two"]);
    expect(categories[1].keys).toEqual(["one", "two"]);
  });

  test("an entry with no title is skipped rather than published nameless", () => {
    const { categories, findings } = parseCategories(JSON.parse(doc([{ description: "d" }, { title: "B" }])));
    expect(categories.map((c) => c.title)).toEqual(["B"]);
    expect(messages(findings).some((m) => m.includes('has no "title"'))).toBe(true);
  });

  test("a missing description or thumbnail is a warning, not a refusal", () => {
    const { categories, findings } = parseCategories(JSON.parse(doc([{ title: "A" }])));
    expect(categories).toHaveLength(1);
    expect(messages(findings).some((m) => m.includes('no "description"'))).toBe(true);
    expect(messages(findings).some((m) => m.includes('no "thumbnail"'))).toBe(true);
  });

  test("a slug is normalised, and says so", () => {
    const { categories, findings } = parseCategories(
      JSON.parse(doc([{ title: "A", description: "d", thumbnail: "/i.jpg", slug: "My Ghost" }])),
    );
    expect(categories[0].slug).toBe("my-ghost");
    expect(messages(findings).some((m) => m.includes('"slug"'))).toBe(true);
  });

  test("unknown keys are reported, and \"//\" notes are not", () => {
    const parsed = JSON.parse(doc([{ title: "A", description: "d", thumbnail: "/i.jpg", "//": "note", tag: "typo" }], { "//": "file note" }));
    const { findings } = parseCategories(parsed);
    expect(messages(findings).some((m) => m.includes('unknown key "tag"'))).toBe(true);
    expect(messages(findings).some((m) => m.includes("//"))).toBe(false);
  });

  test("per_page has to be a positive whole number", () => {
    expect(parseCategories(JSON.parse(doc([], { per_page: 4 }))).perPage).toBe(4);
    for (const bad of [0, -1, 2.5, "9"]) {
      const { perPage, findings } = parseCategories(JSON.parse(doc([], { per_page: bad })));
      expect(perPage).toBe(DEFAULT_PER_PAGE);
      expect(messages(findings).some((m) => m.includes("per_page"))).toBe(true);
    }
  });

  test("a document of the wrong shape is refused with one error", () => {
    for (const bad of [[], null, "x", { categories: {} }, {}]) {
      const { categories, findings } = parseCategories(bad);
      expect(categories).toEqual([]);
      expect(findings.some((f) => f.level === "error")).toBe(true);
    }
  });
});

describe("inCategory", () => {
  const category = parseCategories(
    JSON.parse(doc([{ title: "A", description: "d", thumbnail: "/i.jpg", tags: ["Astronomy", "survival"] }])),
  ).categories[0];

  test("matches on any subject, ignoring case", () => {
    expect(inCategory(category, ["astronomy"])).toBe(true);
    expect(inCategory(category, ["Survival"])).toBe(true);
    expect(inCategory(category, ["cooking", "SURVIVAL"])).toBe(true);
  });

  test("does not match on anything else", () => {
    expect(inCategory(category, ["astronomical"])).toBe(false);
    expect(inCategory(category, [])).toBe(false);
    expect(inCategory(category, undefined)).toBe(false);
  });
});
