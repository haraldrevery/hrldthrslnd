/**
 * assets.js — the one pass that rewrites rendered HTML inside Eleventy.
 *
 * It decides which vendor stylesheet and script a page gets by inspecting the
 * finished markup, so the tests are about what counts as "the page asks for
 * this": a class in live markup does, the same class inside a comment does not,
 * and a page that already links a sheet must not get a second copy.
 */
import { test, expect, describe } from "bun:test";
import { injectAssets } from "../eleventy_binary/lib/assets.js";

const page = (head, body) =>
  `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe("injectAssets", () => {
  test("markup that is not a document is returned untouched", () => {
    expect(injectAssets("<p>fragment</p>")).toBe("<p>fragment</p>");
    expect(injectAssets(123)).toBe(123);
  });

  test("a page with maths gets the KaTeX stylesheet", () => {
    const out = injectAssets(page("", '<span class="katex">x</span>'));
    expect(out).toContain('href="/css/katex.css"');
  });

  test("a page with no maths does not", () => {
    const out = injectAssets(page("", "<p>plain</p>"));
    expect(out).not.toContain("katex.css");
  });

  test("a lightbox link pulls in both the stylesheet and the scripts", () => {
    const out = injectAssets(page("", '<a class="glightbox" href="/a.jpg">x</a>'));
    expect(out).toContain('href="/css/glightbox.min.css"');
    expect(out).toContain("/javascript/glightbox.min.js");
    expect(out).toContain("/javascript/glightbox_settings_min.js");
  });

  test("markup inside a comment is documentation, not a dependency", () => {
    // The block test pages show lightbox anchors inside comments so they can be
    // copied. Pulling in the vendor bundle for those is the waste this avoids.
    const out = injectAssets(page("", '<!-- <a class="glightbox">x</a> -->'));
    expect(out).not.toContain("glightbox.min.js");
  });

  test("the comment is only ignored for the tests — the page keeps it", () => {
    const html = page("", '<!-- <a class="glightbox">x</a> -->');
    expect(injectAssets(html)).toContain('<!-- <a class="glightbox">x</a> -->');
  });

  test("a hand-written document that already links a sheet gets no second copy", () => {
    const html = page(
      '<link rel="stylesheet" href="/css/katex.css">',
      '<span class="katex">x</span>',
    );
    const out = injectAssets(html);
    expect(out.match(/katex\.css/g)).toHaveLength(1);
  });

  test("the vendor marker is where stylesheets land, and is removed when unused", () => {
    const withMaths = injectAssets(
      page("<!--vendor-css-->", '<span class="katex">x</span>'),
    );
    expect(withMaths).toContain('<link rel="stylesheet" href="/css/katex.css">');
    expect(withMaths).not.toContain("<!--vendor-css-->");

    const without = injectAssets(page("<!--vendor-css-->", "<p>plain</p>"));
    expect(without).not.toContain("<!--vendor-css-->");
    expect(without).not.toContain("katex.css");
  });

  test("the reading-width script follows the control that needs it", () => {
    const out = injectAssets(page("", '<button id="width-cycle"></button>'));
    expect(out).toContain("/javascript/reading_width.js");
  });
});
