/**
 * The whole build, end to end, over a small project in a temp folder.
 *
 * Every other test here exercises one module. This one runs build.mjs the way
 * `bun run build` does, over the real templates in eleventy_njk/ and
 * eleventy_settings/, and reads what lands in _site/ — the gap where the
 * JSON-LD breakout and the empty <pubDate> lived, because each module was
 * right on its own and the template stitching them together was not.
 */
import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { makeProject, removeProject, frontMatter } from "./helpers.js";

const REPO = path.resolve(import.meta.dirname, "..");
const TRICKY_TITLE = "Why </script> ends a block & other notes";

let root;
let report;
let site;
const read = (file) => fs.readFileSync(path.join(site, file), "utf8");

beforeAll(() => {
  root = makeProject({
    "site_settings.json": JSON.stringify({
      name: "Test Journal",
      short_name: "TJ",
      description: "A fixture.",
      url: "https://journal.test",
      language: "en",
      date_locale: "en-GB",
      author: "A. Author",
    }),
    "input_markdown/tricky.md": frontMatter(
      { title: `"${TRICKY_TITLE}"`, date: "2026-05-01", description: "</script><b>x</b>", tags: "[Høst, Fjell]" },
      "## Været på toppen\n\nCold.",
    ),
    "input_markdown/undated.md": frontMatter({ title: "Undated", description: "d", tags: "[Fjell]" }),
    "input_markdown/secret.md": frontMatter({ title: "Secret", date: "2026-05-02", description: "d", tags: "[Fjell]", draft: "true" }),
    // A page-builder post that opens with the title card: every letter of its
    // title is its own span, which is what the search index has to read back.
    "input_custom_post/exposure/exposure.json": JSON.stringify({
      format: 1,
      meta: { title: "Long exposure", date: "2026-05-03", description: "d", tags: ["Fjell"] },
      blocks: [
        { type: "hero", variant: "cine", title: "The long\nexposure", lede: "Fog.", image: { src: "fog.jpg", alt: "", title: "", caption: "" } },
        { type: "text", markdown: "Un*told* words." },
      ],
    }),
  });
  // The pieces of the real project the templates need to render and link.
  for (const dir of ["eleventy_njk", "eleventy_settings", "javascript", "font", "icon", "svg", "licence_and_legal"]) {
    fs.cpSync(path.join(REPO, dir), path.join(root, dir), { recursive: true });
  }
  for (const dir of ["input_markdown", "input_custom_html", "input_custom_post"]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.copyFileSync(path.join(REPO, dir, `${dir}.11tydata.js`), path.join(root, dir, `${dir}.11tydata.js`));
  }
  fs.copyFileSync(path.join(REPO, "input_custom_post/post_i/thumbnail.jpg"), path.join(root, "input_custom_post/exposure/fog.jpg"));
  fs.mkdirSync(path.join(root, "css"));
  for (const sheet of ["main.css", "katex.css", "glightbox.min.css"]) {
    fs.copyFileSync(path.join(REPO, "css", sheet), path.join(root, "css", sheet));
  }

  const run = spawnSync("bun", ["run", path.join(REPO, "eleventy_binary/build.mjs"), "--no-css", "--json", "--quiet"], {
    cwd: root,
    encoding: "utf8",
  });
  const last = run.stdout.trim().split("\n").reverse().find((line) => line.startsWith("{"));
  report = last ? JSON.parse(last) : { findings: [], stderr: run.stderr };
  site = path.join(root, "_site");
}, 60_000);

afterAll(() => removeProject(root));

describe("a full build", () => {
  test("publishes, and the only error is the undated post", () => {
    // about.njk links a photograph and a demo page by hand; this fixture
    // carries neither, so those two links are broken here and nowhere else.
    const errors = report.findings.filter((f) => f.level === "error" && f.page !== "/about.html");
    expect(errors.map((f) => `${f.page}: ${f.message}`)).toEqual(['input_markdown/undated.md: missing "date"']);
    expect(fs.existsSync(path.join(site, "index.html"))).toBe(true);
  });

  test("every JSON-LD block parses, and a </script> in a title cannot close it", () => {
    const html = read("tricky.html");
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(blocks.length).toBe(1);
    const data = JSON.parse(blocks[0]);
    expect(data.headline).toBe(TRICKY_TITLE);
    expect(data.description).toBe("</script><b>x</b>");
  });

  test("a draft is not written, listed, indexed or fed", () => {
    expect(fs.existsSync(path.join(site, "secret.html"))).toBe(false);
    for (const file of ["sitemap.xml", "feed.xml", "search_index.json", "blog.html", "tag_fjell.html"]) {
      expect(read(file)).not.toContain("secret");
    }
  });

  test("the search index is valid JSON with the published posts", () => {
    const index = JSON.parse(read("search_index.json"));
    expect(index.entries.map((e) => e.url).sort()).toEqual(["/exposure.html", "/tricky.html", "/undated.html"]);
  });

  test("the front page's title is written by the title card's own function", () => {
    const html = read("index.html");
    const letter = (delay, ch) => `<span class="cine-letter" style="--letter-delay:${delay}s">${ch}</span>`;
    // "Journal" starts seven places into the table; a space between the words
    // keeps them words for anything that reads text rather than layout.
    expect(html).toContain(
      '<h1 class="cine-title" aria-label="Test Journal" style="--cine-word:7"><span aria-hidden="true">' +
        letter(0.32, "T") + letter(1.05, "e") + letter(0.61, "s") + letter(0.88, "t") +
        '</span> <span aria-hidden="true">' + letter(0.73, "J"),
    );
    expect(read("exposure.html")).toContain('<h1 class="cine-title" aria-label="The long exposure" style="--cine-word:8">');
  });

  test("a title card's letters, and a word split by inline tags, are indexed as words", () => {
    const entry = JSON.parse(read("search_index.json")).entries.find((e) => e.url === "/exposure.html");
    expect(entry.text).toStartWith("The long exposure Fog.");
    expect(entry.text).toContain("Untold words.");
  });

  test("the feed escapes text and leaves out a date it does not have", () => {
    const feed = read("feed.xml");
    expect(feed).toContain("<title>Why &lt;/script&gt; ends a block &amp; other notes</title>");
    expect(feed).not.toMatch(/<pubDate>\s*<\/pubDate>/);
    expect(feed).toContain("<pubDate>Fri, 01 May 2026 00:00:00 GMT</pubDate>");
    // No bare ampersand anywhere: an XML parser stops at the first one.
    expect(feed).not.toMatch(/&(?!amp;|lt;|gt;|quot;|#39;|#\d+;)/);
  });

  test("the sitemap sends lastmod only for dates someone wrote", () => {
    const sitemap = read("sitemap.xml");
    const entry = (url) => sitemap.match(new RegExp(`<loc>https://journal\\.test${url}</loc>[\\s\\S]*?</url>`))?.[0] ?? "";
    expect(entry("/tricky.html")).toContain("<lastmod>2026-05-01</lastmod>");
    expect(entry("/about.html")).not.toContain("<lastmod>");
    expect(entry("/undated.html")).not.toContain("<lastmod>");
  });

  test("og:locale is language_TERRITORY", () => {
    expect(read("tricky.html")).toContain('<meta property="og:locale" content="en_GB">');
  });

  test("Norwegian letters survive into subject URLs and heading anchors", () => {
    expect(fs.existsSync(path.join(site, "tag_host.html"))).toBe(true);
    expect(read("tricky.html")).toContain('id="vaeret-pa-toppen"');
  });

  test("two builds of the same sources produce the same search index and feed", () => {
    const before = { index: read("search_index.json"), feed: read("feed.xml") };
    spawnSync("bun", ["run", path.join(REPO, "eleventy_binary/build.mjs"), "--no-css", "--quiet"], { cwd: root });
    expect(read("search_index.json")).toBe(before.index);
    expect(read("feed.xml")).toBe(before.feed);
  }, 60_000);
});
