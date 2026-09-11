/**
 * A post folder whose page is a JSON document, as the registry sees it.
 */
import { test, expect, describe, afterEach } from "bun:test";

import { buildRegistry } from "../eleventy_binary/lib/slugs.js";
import { makeProject, removeProject, quietly } from "./helpers.js";

const created = [];
function project(files) {
  const root = makeProject(files);
  created.push(root);
  return root;
}
afterEach(() => {
  while (created.length) removeProject(created.pop());
});

const post = (meta = {}) => JSON.stringify({ format: 1, meta: { title: "t", date: "2026-01-01", ...meta }, blocks: [] });

describe("JSON post folders", () => {
  test("the document is the page, with a virtual path Eleventy can render", () => {
    const root = project({ "input_custom_post/p/p.json": post(), "input_custom_post/p/a.jpg": "x" });
    const registry = quietly(() => buildRegistry(root));
    const record = registry.bySlug.get("p");
    expect(record.source).toBe("json");
    expect(record.inputPath).toBe("input_custom_post/p/p.json");
    expect(record.virtualPath).toBe("input_custom_post/p/p.json.html");
    expect(record.permalink).toBe("/p.html");
    expect(registry.byInputPath.get(record.virtualPath)).toBe(record);
  });

  test("draft and permalink are read from meta, strictly", () => {
    const root = project({
      "input_custom_post/a/a.json": post({ draft: true }),
      "input_custom_post/b/b.json": post({ draft: "true" }),
      "input_custom_post/c/c.json": post({ permalink: "/elsewhere.html" }),
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("a").draft).toBe(true);
    expect(registry.bySlug.get("b").draft).toBe(false);
    expect(registry.bySlug.get("c").permalink).toBe("/elsewhere.html");
    expect(registry.bySlug.get("c").slug).toBe("c");
  });

  test("a JSON beside an HTML wins, and a broken JSON is still the page", () => {
    const root = project({
      "input_custom_post/p/p.json": post(),
      "input_custom_post/p/p.html": "---\ntitle: old\n---\n<p>old</p>",
      "input_custom_post/q/q.json": "{ not json",
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("p").source).toBe("json");
    expect(registry.bySlug.get("q").source).toBe("json");
    expect(registry.bySlug.get("q").draft).toBe(false);
  });

  test("a folder with only HTML is unchanged", () => {
    const root = project({ "input_custom_post/p/p.html": "---\ntitle: t\n---\n<p>x</p>" });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("p").source).toBe("html");
    expect(registry.bySlug.get("p").virtualPath).toBeUndefined();
  });
});
