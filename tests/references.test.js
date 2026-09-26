/**
 * references.js — what the built site refers to — and the location check.
 *
 * referencedPaths() decides which files in a page-builder folder are published,
 * so a reference it misses is a missing picture on the site. Every way a page
 * refers to a file is exercised here.
 */
import { test, expect, describe, afterEach } from "bun:test";
import path from "node:path";

import { referencedPaths } from "../eleventy_binary/lib/references.js";
import { carriesLocation } from "../eleventy_binary/lib/status_check.js";
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

describe("referencedPaths", () => {
  const html = `<!doctype html><html><head>
<meta property="og:image" content="https://example.com/trip/cover_min.jpg">
<style>.band { background: url('/trip/band.jpg'); }</style>
</head><body>
<a class="glightbox" href="/trip/big.jpg"><img src="/trip/big_min.jpg" srcset="/trip/big_min.jpg 800w, /trip/huge.jpg 2400w"></a>
<video poster="/trip/clip_min.jpg"><source src="/trip/clip.mp4"></video>
<div class="download-block" data-download="/trip/notes.pdf"></div>
<img src="/trip/My%20Photo.jpg">
<img src="sibling.jpg">
<div style="--bg:url(&quot;/trip/inline.jpg&quot;)"></div>
<!-- <img src="/trip/commented.jpg"> -->
<a href="mailto:x@example.com">mail</a> <a href="#top">top</a>
</body></html>`;

  const found = () => referencedPaths(project({ "trip.html": html, "sub/page.html": '<img src="../trip/rel.jpg">' }));

  test("every attribute a page loads a file through", () => {
    const refs = found();
    for (const file of ["big.jpg", "big_min.jpg", "huge.jpg", "clip_min.jpg", "clip.mp4", "notes.pdf"]) {
      expect(refs.has(`/trip/${file}`)).toBe(true);
    }
  });

  test("an absolute URL to the site counts by its path", () => {
    expect(found().has("/trip/cover_min.jpg")).toBe(true);
  });

  test("CSS url(), in a <style> block and in a style attribute", () => {
    const refs = found();
    expect(refs.has("/trip/band.jpg")).toBe(true);
    expect(refs.has("/trip/inline.jpg")).toBe(true);
  });

  test("encoded names are decoded, relative ones resolved against their page", () => {
    const refs = found();
    expect(refs.has("/trip/My Photo.jpg")).toBe(true);
    expect(refs.has("/sibling.jpg")).toBe(true);
    expect(refs.has("/trip/rel.jpg")).toBe(true);
  });

  test("commented-out markup and non-file links do not count", () => {
    const refs = found();
    expect(refs.has("/trip/commented.jpg")).toBe(false);
    expect([...refs].some((ref) => ref.includes("mailto") || ref.includes("#"))).toBe(false);
  });
});

describe("carriesLocation", () => {
  /** A JPEG that is nothing but SOI, one XMP packet, and EOI. */
  function jpegWithXmp(xmp) {
    const payload = Buffer.concat([Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"), Buffer.from(xmp, "utf8")]);
    const length = Buffer.alloc(2);
    length.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), length, payload, Buffer.from([0xff, 0xd9])]);
  }

  test("a published photograph with GPS in its metadata is caught", () => {
    const root = project({
      "gps.jpg": jpegWithXmp('<x:xmpmeta><rdf:Description exif:GPSLatitude="59,20.5N"/></x:xmpmeta>'),
      "clean.jpg": jpegWithXmp('<x:xmpmeta><rdf:Description dc:title="x"/></x:xmpmeta>'),
    });
    expect(carriesLocation(path.join(root, "gps.jpg"))).toBe(true);
    expect(carriesLocation(path.join(root, "clean.jpg"))).toBe(false);
  });

  test("thumbnails and other formats are not read", () => {
    const root = project({ "a_min.jpg": jpegWithXmp("exif:GPSLatitude"), "b.png": "exif:GPSLatitude" });
    expect(carriesLocation(path.join(root, "a_min.jpg"))).toBe(false);
    expect(carriesLocation(path.join(root, "b.png"))).toBe(false);
  });
});
