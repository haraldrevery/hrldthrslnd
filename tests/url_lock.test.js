/**
 * url_lock.js — a published page keeps its URL.
 *
 * The failure this exists for: a new file that wants a name an existing page
 * was published under took that name, and the existing page moved to a `_2`
 * URL. Every test here builds a throwaway project, so the real
 * published_urls.json is never read or written.
 */
import { test, expect, describe, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { buildRegistry, invalidateRegistry } from "../eleventy_binary/lib/slugs.js";
import { writeUrlLock, readUrlLock, LOCK_FILE } from "../eleventy_binary/lib/url_lock.js";
import { runStatusCheck } from "../eleventy_binary/lib/status_check.js";
import { loadSettings } from "../eleventy_binary/lib/settings.js";
import log from "../eleventy_binary/lib/log.js";
import { makeProject, removeProject, quietly, frontMatter } from "./helpers.js";

const created = [];
function project(files) {
  const root = makeProject({ "site_settings.json": "{}", ...files });
  created.push(root);
  return root;
}
afterEach(() => {
  while (created.length) removeProject(created.pop());
});

const page = (fields = {}) => frontMatter({ title: "T", ...fields });
const postDoc = (meta = {}) => JSON.stringify({ format: 1, meta: { title: "P", ...meta }, blocks: [] });
const registry = (root) => quietly(() => buildRegistry(root));
const slugOf = (reg, inputPath) => reg.all.find((r) => r.inputPath === inputPath)?.slug;
const lockOf = (root) => JSON.parse(fs.readFileSync(path.join(root, LOCK_FILE), "utf8")).pages;

/** The pages the status check reports as no longer published, over an empty _site. */
async function droppedUrls(root) {
  invalidateRegistry(root);
  fs.mkdirSync(path.join(root, "_site"), { recursive: true });
  const { log: out, error, warn } = console;
  console.log = console.error = console.warn = () => {};
  try {
    const { findings } = await runStatusCheck({
      root,
      outputDir: path.join(root, "_site"),
      settings: loadSettings(root),
      images: { reports: [], totals: {} },
    });
    return findings.filter((f) => f.scope === "urls").map((f) => f.page);
  } finally {
    Object.assign(console, { log: out, error, warn });
  }
}

describe("a page keeps the URL it was published under", () => {
  test("a newcomer that wants a published name takes the suffix instead", () => {
    const root = project({ "input_custom_post/post_i/post_i.json": postDoc() });
    writeUrlLock(root, registry(root));

    fs.mkdirSync(path.join(root, "input_markdown"));
    fs.writeFileSync(path.join(root, "input_markdown/post_i.md"), page());
    const reg = registry(root);
    expect(slugOf(reg, path.join("input_custom_post", "post_i", "post_i.json"))).toBe("post_i");
    expect(slugOf(reg, path.join("input_markdown", "post_i.md"))).toBe("post_i_2");
  });

  test("without a record the old order-based rule still applies", () => {
    const root = project({
      "input_custom_post/post_i/post_i.json": postDoc(),
      "input_markdown/post_i.md": page(),
    });
    const reg = registry(root);
    expect(slugOf(reg, path.join("input_markdown", "post_i.md"))).toBe("post_i");
  });

  test("a suffixed page keeps its suffix after the name it wanted is freed", () => {
    const root = project({ "input_markdown/a.md": page(), "input_markdown/A.md": page() });
    const first = registry(root);
    const suffixed = first.all.find((r) => r.slug === "a_2").inputPath;
    writeUrlLock(root, first);

    const other = suffixed.endsWith("A.md") ? "a.md" : "A.md";
    fs.rmSync(path.join(root, "input_markdown", other));
    const reg = registry(root);
    expect(slugOf(reg, suffixed)).toBe("a_2");
    expect(reg.all.find((r) => r.inputPath === suffixed).locked).toBe(true);
  });

  test("a page folder is keyed by its folder, so switching .html to .json keeps the URL", () => {
    const root = project({ "input_custom_post/trip/trip.html": "<p>x</p>", "input_markdown/zz.md": page() });
    writeUrlLock(root, registry(root));
    expect(lockOf(root)["input_custom_post/trip/"]).toBe("trip");
  });
});

describe("what is recorded", () => {
  test("drafts that were never published are not recorded", () => {
    const root = project({ "input_markdown/live.md": page(), "input_markdown/wip.md": page({ draft: "true" }) });
    writeUrlLock(root, registry(root));
    expect(Object.keys(lockOf(root))).toEqual(["input_markdown/live.md"]);
  });

  test("a published page turned back into a draft keeps its name held", () => {
    const root = project({ "input_markdown/live.md": page() });
    writeUrlLock(root, registry(root));
    fs.writeFileSync(path.join(root, "input_markdown/live.md"), page({ draft: "true" }));
    writeUrlLock(root, registry(root));
    expect(lockOf(root)["input_markdown/live.md"]).toBe("live");
  });

  test("a source that is gone is dropped", () => {
    const root = project({ "input_markdown/a.md": page(), "input_markdown/b.md": page() });
    writeUrlLock(root, registry(root));
    fs.rmSync(path.join(root, "input_markdown/b.md"));
    writeUrlLock(root, registry(root));
    expect(Object.keys(lockOf(root))).toEqual(["input_markdown/a.md"]);
  });

  test("a build that changed nothing does not rewrite the file", () => {
    const root = project({ "input_markdown/a.md": page() });
    expect(writeUrlLock(root, registry(root))).toBe(true);
    expect(writeUrlLock(root, registry(root))).toBe(false);
  });

  test("a file that cannot be read holds nothing, is reported, and is never overwritten", () => {
    const root = project({ "input_markdown/a.md": page(), [LOCK_FILE]: "{ not json" });
    const before = log.count("error");
    const reg = registry(root);
    expect(log.count("error")).toBe(before + 1);
    expect(readUrlLock(root).readable).toBe(false);
    expect(quietly(() => writeUrlLock(root, reg))).toBe(false);
    expect(fs.readFileSync(path.join(root, LOCK_FILE), "utf8")).toBe("{ not json");
  });

  test("a page whose source is gone is reported, since its URL now fails", async () => {
    const root = project({ "input_markdown/a.md": page() });
    writeUrlLock(root, registry(root));
    fs.renameSync(path.join(root, "input_markdown/a.md"), path.join(root, "input_markdown/b.md"));
    expect(await droppedUrls(root)).toEqual(["/a.html"]);
  });

  test("a renamed page that keeps its old address with permalink is not reported", async () => {
    const root = project({ "input_markdown/a.md": page() });
    writeUrlLock(root, registry(root));
    fs.rmSync(path.join(root, "input_markdown/a.md"));
    fs.writeFileSync(path.join(root, "input_markdown/b.md"), page({ permalink: "/a.html" }));
    expect(await droppedUrls(root)).toEqual([]);
  });

  test("a recorded name that a built-in page now uses is an error, not a quiet move", () => {
    const root = project({
      "input_markdown/gallery.md": page(),
      [LOCK_FILE]: JSON.stringify({ pages: { "input_markdown/gallery.md": "gallery" } }),
      "eleventy_njk/gallery.njk": "---\npermalink: /gallery.html\n---\n",
    });
    const before = log.count("error");
    const reg = registry(root);
    expect(log.count("error")).toBe(before + 1);
    expect(slugOf(reg, path.join("input_markdown", "gallery.md"))).toBe("gallery_2");
  });
});
