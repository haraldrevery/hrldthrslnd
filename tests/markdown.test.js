/**
 * markdown.js — figures, galleries and the lightbox anchor.
 *
 * The pipeline that turns `![alt](path)` into what a reader actually sees had
 * no tests at all, and the gap showed: whether a picture got a lightbox anchor
 * was decided by "does a separate _min file exist", which quietly excluded
 * every format that has no counterpart — SVG, GIF, AVIF, and any WebP nobody
 * had compressed by hand. They rendered, so nothing looked broken; they simply
 * could not be opened, and the slider stepped past them.
 */
import { test, expect, describe, afterEach } from "bun:test";
import path from "node:path";

import { createMarkdownLibrary } from "../eleventy_binary/lib/markdown.js";
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

/** A GIF header declaring the given size — enough for imageSize() to read. */
function gif(width, height) {
  const buffer = Buffer.alloc(10);
  Buffer.from("GIF89a").copy(buffer, 0);
  buffer.writeUInt16LE(width, 6);
  buffer.writeUInt16LE(height, 8);
  return buffer;
}

/** A PNG header declaring the given size. */
function png(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/** A JPEG that is nothing but SOI, a Start Of Frame and EOI. */
function jpeg(width, height) {
  const frame = Buffer.alloc(19);
  frame[0] = 0xff;
  frame[1] = 0xc0;
  frame.writeUInt16BE(17, 2);
  frame[4] = 8; // sample precision
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  frame[9] = 3; // three components
  return Buffer.concat([Buffer.from([0xff, 0xd8]), frame, Buffer.from([0xff, 0xd9])]);
}

const svg = '<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"></svg>';

/** The project every test here renders against. */
function fixture() {
  return project({
    "image/photo.png": png(1600, 900),
    "image_min/photo_min.jpg": jpeg(800, 450), // the counterpart is what gets measured
    "gif/loop.gif": gif(564, 564),
    "svg/mark.svg": svg,
  });
}

function render(root, source) {
  return createMarkdownLibrary(root).render(source, {});
}

describe("a single image is a figure", () => {
  test("a photograph shows its counterpart and links to the original", () => {
    const html = render(fixture(), "![Peaks](/image/photo.png)");
    expect(html).toContain('src="/image_min/photo_min.jpg"');
    expect(html).toContain('<a class="glightbox" href="/image/photo.png"');
    expect(html).toContain('data-gallery="post"');
  });

  test("a GIF gets the lightbox too, pointing at itself", () => {
    const html = render(fixture(), "![Loop](/gif/loop.gif)");
    expect(html).toContain('<a class="glightbox" href="/gif/loop.gif"');
    expect(html).toContain('src="/gif/loop.gif"');
    // Measured, so it reserves its space and the lazy load can fire.
    expect(html).toContain('width="564" height="564"');
  });

  test("an SVG gets the lightbox too", () => {
    const html = render(fixture(), "![Mark](/svg/mark.svg)");
    expect(html).toContain('<a class="glightbox" href="/svg/mark.svg"');
    expect(html).toContain('width="100" height="50"');
  });

  test("a remote image is left as a plain img", () => {
    // Not ours to serve at full resolution, and linking one would pull the
    // vendor bundle onto the page for a picture the site does not own.
    const html = render(fixture(), "![Remote](https://example.org/x.jpg)");
    expect(html).toContain('src="https://example.org/x.jpg"');
    expect(html).not.toContain("glightbox");
  });
});

describe("a run of images is one justified gallery", () => {
  test("every cell joins the slider, whatever the format", () => {
    const html = render(
      fixture(),
      "![Peaks](/image/photo.png)\n![Loop](/gif/loop.gif)\n![Mark](/svg/mark.svg)",
    );
    expect(html).toContain('class="gallery gallery-justified gallery-auto"');
    // Three cells, three anchors: the arrows step through all three.
    expect(html.match(/class="glightbox"/g)).toHaveLength(3);
    expect(html).toContain('href="/gif/loop.gif"');
    expect(html).toContain('href="/svg/mark.svg"');
  });

  test("each cell carries its own ratio", () => {
    const html = render(fixture(), "![Peaks](/image/photo.png)\n![Mark](/svg/mark.svg)");
    expect(html).toContain("--ar:1.7778"); // the 800x450 counterpart, not the original
    expect(html).toContain("--ar:2"); // 100x50
  });

  test("a run holding a video falls back to a stack of figures and players", () => {
    const html = render(fixture(), "![Peaks](/image/photo.png)\n![Clip](/video/x.mp4)");
    expect(html).not.toContain("gallery-auto");
    expect(html).toContain("<video controls");
    expect(html).toContain('<source src="/video/x.mp4" type="video/mp4">');
  });
});

describe("captions and alt text", () => {
  test("special characters are encoded exactly once", () => {
    const html = render(fixture(), '![Salt & Pepper](/image/photo.png "Titles & captions")');
    expect(html).toContain('alt="Salt &amp; Pepper"');
    expect(html).toContain("<figcaption>Titles &amp; captions</figcaption>");
    expect(html).not.toContain("&amp;amp;");
  });
});
