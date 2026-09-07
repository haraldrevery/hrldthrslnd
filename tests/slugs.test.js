/**
 * slugs.js — the registry, which is the site's URL authority.
 *
 * Everything here is about one property: the same input files must always
 * produce the same URLs. A slug that shifted between builds, between machines,
 * or because an unrelated file was added, is link rot.
 *
 * Each test builds a throwaway project tree rather than reading this
 * repository, so adding a real post can never change what these assert.
 */
import { test, expect, describe, afterEach } from "bun:test";
import path from "node:path";

import {
  buildRegistry,
  walkFiles,
  normaliseKey,
  publishedPathForSource,
  sourcePathForPublished,
} from "../eleventy_binary/lib/slugs.js";
import { makeProject, removeProject, quietly, frontMatter } from "./helpers.js";

const created = [];
function project(files) {
  const root = makeProject(files);
  created.push(root);
  return root;
}
afterEach(() => {
  while (created.length) removeProject(created.pop());
});

const post = (title) => frontMatter({ title, date: "2026-01-01" });

describe("walkFiles", () => {
  test("walks depth first in code-unit order, with forward slashes", () => {
    const root = project({
      "input_markdown/b.md": "b",
      "input_markdown/a.md": "a",
      "input_markdown/sub/c.md": "c",
    });
    expect(walkFiles(path.join(root, "input_markdown"))).toEqual([
      "a.md",
      "b.md",
      "sub/c.md",
    ]);
  });

  test("hidden files and folders are skipped", () => {
    const root = project({
      "input_markdown/a.md": "a",
      "input_markdown/.obsidian/workspace.json": "{}",
      "input_markdown/.DS_Store": "",
    });
    expect(walkFiles(path.join(root, "input_markdown"))).toEqual(["a.md"]);
  });
});

describe("normaliseKey", () => {
  test("one spelling: no leading ./, forward slashes", () => {
    expect(normaliseKey("./input_markdown/a.md")).toBe("input_markdown/a.md");
    expect(normaliseKey("input_markdown/a.md")).toBe("input_markdown/a.md");
  });
});

describe("buildRegistry — slugs", () => {
  test("a top-level file publishes at /<slug>.html", () => {
    const root = project({ "input_markdown/my_post.md": post("x") });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("my_post").permalink).toBe("/my_post.html");
  });

  test("a folder becomes part of the slug rather than being flattened", () => {
    const root = project({ "input_markdown/travel/iceland.md": post("x") });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("travel/iceland").permalink).toBe("/travel/iceland.html");
  });

  test("filenames are normalised per segment, so the tree survives", () => {
    const root = project({ "input_markdown/My Travel/A Note.md": post("x") });
    const registry = quietly(() => buildRegistry(root));
    expect([...registry.bySlug.keys()]).toEqual(["my_travel/a_note"]);
  });

  test("a collision suffixes the LAST segment, keeping the page in its folder", () => {
    const root = project({
      "input_markdown/travel/note.md": post("x"),
      "input_custom_html/travel/note.html": "<p>x</p>",
    });
    const registry = quietly(() => buildRegistry(root));
    // input_markdown wins the bare slug: it is first in SOURCES.
    expect(registry.bySlug.has("travel/note")).toBe(true);
    expect(registry.bySlug.has("travel/note_2")).toBe(true);
    expect(registry.bySlug.get("travel/note_2").permalink).toBe("/travel/note_2.html");
  });

  test("a file legitimately named _2 does not steal the suffix", () => {
    const root = project({
      "input_markdown/note.md": post("x"),
      "input_markdown/note_2.md": post("y"),
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("note").desired).toBe("note");
    expect(registry.bySlug.get("note_2").desired).toBe("note_2");
    // Neither was renamed, so neither should be reported as a collision.
    expect(registry.all.filter((r) => r.slug !== r.desired)).toEqual([]);
  });

  test("adding a file cannot take an existing page's URL away", () => {
    // The whole path is the slug, so a new file that sorts earlier gets its own
    // name rather than displacing one that is already published.
    const before = quietly(() =>
      buildRegistry(project({ "input_markdown/travel/note.md": post("x") })),
    );
    const after = quietly(() =>
      buildRegistry(
        project({
          "input_markdown/travel/note.md": post("x"),
          "input_markdown/archive/note.md": post("y"),
        }),
      ),
    );
    expect(before.bySlug.get("travel/note").permalink).toBe("/travel/note.html");
    expect(after.bySlug.get("travel/note").permalink).toBe("/travel/note.html");
  });

  test("directory data files are configuration, never pages", () => {
    const root = project({
      "input_markdown/a.md": post("x"),
      "input_markdown/input_markdown.11tydata.js": "export default {}",
    });
    const registry = quietly(() => buildRegistry(root));
    expect([...registry.bySlug.keys()]).toEqual(["a"]);
  });
});

describe("buildRegistry — names the built-in pages own", () => {
  const njk = (permalink) => `---\nlayout: base.njk\npermalink: ${permalink}\n---\n<p>x</p>\n`;

  test("a post cannot take a built-in page's URL", () => {
    // This used to be a hard build failure with a raw Eleventy stack trace:
    // the registry knew nothing about eleventy_njk/, so both files claimed
    // /about.html and Eleventy died on the duplicate permalink.
    const root = project({
      "eleventy_njk/about.njk": njk("/about.html"),
      "input_markdown/about.md": post("mine"),
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.has("about")).toBe(false);
    expect(registry.bySlug.get("about_2").permalink).toBe("/about_2.html");
  });

  test("the reserved list is read from eleventy_njk, so it cannot drift", () => {
    const root = project({
      "eleventy_njk/whatever.njk": njk("/somewhere.html"),
      "input_markdown/somewhere.md": post("mine"),
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.has("somewhere")).toBe(false);
    expect(registry.bySlug.has("somewhere_2")).toBe(true);
  });

  test("only bare names are reserved — a nested page collides with nothing", () => {
    const root = project({
      "eleventy_njk/about.njk": njk("/about.html"),
      "input_markdown/travel/about.md": post("trip"),
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("travel/about").permalink).toBe("/travel/about.html");
  });

  test("non-HTML built-ins are not reserved, because nothing can collide with them", () => {
    // slugify() turns every non-alphanumeric into an underscore, so no input
    // file can produce "feed.xml". Reserving it would only cost a needless
    // rename of a page called feed_xml.md.
    const root = project({
      "eleventy_njk/feed.njk": njk("/feed.xml"),
      "input_markdown/feed.md": post("mine"),
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("feed").permalink).toBe("/feed.html");
  });

  test("blog is reserved even though its permalink is computed elsewhere", () => {
    const root = project({ "input_markdown/blog.md": post("mine") });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.has("blog")).toBe(false);
    expect(registry.bySlug.has("blog_2")).toBe(true);
  });

  test("status_check is NOT reserved — that name is protected the other way", () => {
    // writeStatusPage() refuses to overwrite a page it did not write, so an
    // author who claims this URL keeps it and loses the report. Reserving it
    // here would reverse that and rename a page that works today.
    const root = project({ "input_markdown/status_check.md": post("mine") });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("status_check").permalink).toBe("/status_check.html");
  });

  test("a name in the generated range keeps its URL, and is only warned about", () => {
    // Reserving the prefix would rename files that collide with nothing, and a
    // rename is a URL change — the harm this module exists to prevent.
    const root = project({ "input_markdown/blog_tag_thoughts.md": post("mine") });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("blog_tag_thoughts").permalink).toBe(
      "/blog_tag_thoughts.html",
    );
  });

  test("a project with no eleventy_njk folder still builds", () => {
    const root = project({ "input_markdown/about.md": post("mine") });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("about").permalink).toBe("/about.html");
  });
});

describe("buildRegistry — declared permalinks", () => {
  const withPermalink = (permalink) =>
    frontMatter({ title: "x", date: "2026-01-01", permalink });

  test("a page can publish at a URL its filename does not decide", () => {
    const root = project({ "input_markdown/zz_note.md": withPermalink("/a-legacy-url.html") });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("zz_note").permalink).toBe("/a-legacy-url.html");
  });

  test("quotes around the value are allowed", () => {
    const root = project({ "input_markdown/a.md": withPermalink('"/pinned.html"') });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("a").permalink).toBe("/pinned.html");
  });

  test("the slug is NOT changed, so a post folder's media stays put", () => {
    // The page moves; its photographs do not. input_custom_post/post_i/ keeps
    // publishing to /post_i/, which is what the absolute paths written inside
    // the page itself refer to.
    const root = project({
      "input_custom_post/post_i/post_i.html": withPermalink("/portfolio.html"),
      "input_custom_post/post_i/photo.jpg": "",
    });
    const registry = quietly(() => buildRegistry(root));
    const record = registry.bySlug.get("post_i");
    expect(record.permalink).toBe("/portfolio.html");
    expect(record.slug).toBe("post_i");
    expect(record.publishedDir).toBe("post_i");
  });

  test("a value that is not a site-absolute path is refused, not guessed at", () => {
    const root = project({
      "input_markdown/a.md": withPermalink("relative.html"),
      "input_markdown/b.md": withPermalink("false"),
    });
    const registry = quietly(() => buildRegistry(root));
    // `permalink: false` in particular must not reach Eleventy, which reads it
    // as "write nothing" — an unpublished page via a field about naming.
    expect(registry.bySlug.get("a").permalink).toBe("/a.html");
    expect(registry.bySlug.get("b").permalink).toBe("/b.html");
  });

  test("two pages cannot claim one URL; the loser keeps its slug", () => {
    const root = project({
      "input_markdown/a.md": withPermalink("/shared.html"),
      "input_markdown/b.md": withPermalink("/shared.html"),
    });
    const registry = quietly(() => buildRegistry(root));
    const permalinks = [
      registry.bySlug.get("a").permalink,
      registry.bySlug.get("b").permalink,
    ];
    expect(permalinks).toContain("/shared.html");
    expect(permalinks).toContain("/b.html");
  });

  test("which of two claimants wins does not depend on the filesystem", () => {
    const files = {
      "input_markdown/b.md": withPermalink("/shared.html"),
      "input_markdown/a.md": withPermalink("/shared.html"),
    };
    for (let i = 0; i < 3; i += 1) {
      const registry = quietly(() => buildRegistry(project(files)));
      expect(registry.bySlug.get("a").permalink).toBe("/shared.html");
      expect(registry.bySlug.get("b").permalink).toBe("/b.html");
    }
  });

  test("a page cannot take a URL another page already holds by slug", () => {
    const root = project({
      "input_markdown/target.md": post("first"),
      "input_markdown/other.md": withPermalink("/target.html"),
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("target").permalink).toBe("/target.html");
    expect(registry.bySlug.get("other").permalink).toBe("/other.html");
  });

  test("a page cannot take a built-in page's URL, .html or not", () => {
    const root = project({
      "eleventy_njk/about.njk": "---\npermalink: /about.html\n---\n<p>x</p>\n",
      "eleventy_njk/feed.njk": "---\npermalink: /feed.xml\n---\n<rss/>\n",
      "input_markdown/a.md": withPermalink("/about.html"),
      "input_markdown/b.md": withPermalink("/feed.xml"),
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("a").permalink).toBe("/a.html");
    expect(registry.bySlug.get("b").permalink).toBe("/b.html");
  });

  test("the URL a page vacates becomes available to another", () => {
    const root = project({
      "input_markdown/a.md": withPermalink("/elsewhere.html"),
      "input_markdown/b.md": withPermalink("/a.html"),
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("a").permalink).toBe("/elsewhere.html");
    expect(registry.bySlug.get("b").permalink).toBe("/a.html");
  });

  test("declaring the URL you already have is not a collision with yourself", () => {
    const root = project({ "input_markdown/a.md": withPermalink("/a.html") });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("a").permalink).toBe("/a.html");
  });

  test("a page with no permalink key is unaffected", () => {
    const root = project({ "input_markdown/a.md": post("x") });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("a").permalink).toBe("/a.html");
    expect(registry.bySlug.get("a").declaredPermalink).toBeUndefined();
  });
});

describe("buildRegistry — drafts", () => {
  test("draft: true is recorded on the record", () => {
    const root = project({
      "input_markdown/a.md": frontMatter({ title: "a", draft: "true" }),
      "input_markdown/b.md": frontMatter({ title: "b", draft: "false" }),
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("a").draft).toBe(true);
    expect(registry.bySlug.get("b").draft).toBe(false);
  });

  test("a draft behind a trailing-whitespace fence is still a draft", () => {
    // The registry and Eleventy have to agree here, or the page is held back
    // while its co-located assets are published beside it.
    const root = project({
      "input_markdown/a.md": "--- \ntitle: a\ndraft: true\n--- \nbody\n",
    });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.bySlug.get("a").draft).toBe(true);
  });
});

describe("buildRegistry — post folders", () => {
  test("publishes the html file sharing the folder name", () => {
    const root = project({
      "input_custom_post/post_i/post_i.html": "<p>x</p>",
      "input_custom_post/post_i/other.html": "<p>y</p>",
      "input_custom_post/post_i/photo.jpg": "",
    });
    const registry = quietly(() => buildRegistry(root));
    const record = registry.bySlug.get("post_i");
    expect(normaliseKey(record.inputPath)).toBe("input_custom_post/post_i/post_i.html");
    expect(record.publishedDir).toBe("post_i");
  });

  test("a folder with no html file is skipped", () => {
    const root = project({ "input_custom_post/empty/photo.jpg": "" });
    const registry = quietly(() => buildRegistry(root));
    expect(registry.all).toEqual([]);
  });
});

describe("published path <-> source path", () => {
  test("a file beside a note publishes where the note's folder publishes", () => {
    const root = project({
      "input_markdown/My Travel/note.md": post("x"),
      "input_markdown/My Travel/photo.jpg": "",
    });
    quietly(() => {
      expect(publishedPathForSource("input_markdown/My Travel/photo.jpg", root)).toBe(
        "/my_travel/photo.jpg",
      );
    });
  });

  test("a folder BELOW the note keeps the name it has", () => {
    const root = project({
      "input_markdown/My Travel/note.md": post("x"),
      "input_markdown/My Travel/media/photo.jpg": "",
    });
    quietly(() => {
      expect(
        publishedPathForSource("input_markdown/My Travel/media/photo.jpg", root),
      ).toBe("/my_travel/media/photo.jpg");
    });
  });

  test("a file at the top of an input folder publishes to the site root", () => {
    const root = project({ "input_markdown/photo.jpg": "" });
    quietly(() => {
      expect(publishedPathForSource("input_markdown/photo.jpg", root)).toBe("/photo.jpg");
    });
  });

  test("round trip: a published URL resolves back to the file on disk", () => {
    const root = project({
      "input_markdown/My Travel/note.md": post("x"),
      "input_markdown/My Travel/photo.jpg": "",
    });
    quietly(() => {
      const url = publishedPathForSource("input_markdown/My Travel/photo.jpg", root);
      expect(sourcePathForPublished(url, root)).toBe(
        path.join(root, "input_markdown", "My Travel", "photo.jpg"),
      );
    });
  });

  test("a path no part of the build publishes answers null", () => {
    const root = project({ "input_markdown/a.md": post("x") });
    quietly(() => {
      expect(publishedPathForSource("css/main.css", root)).toBe(null);
    });
  });
});
