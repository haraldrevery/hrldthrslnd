/**
 * Download block hashing.
 *
 * fillDownloadHashes() rewrites files in place, so every test here builds a
 * throwaway output directory and reads back what was written — the same thing
 * the build does, which is the only way to test a pass whose whole job is a
 * side effect on disk.
 */
import { test, expect, describe } from "bun:test";
import fs from "node:fs";
import path from "node:path";

import { fillDownloadHashes } from "../eleventy_binary/lib/downloads.js";
import { makeProject, removeProject, quietly } from "./helpers.js";

/** An output directory holding one asset and one page, and the page's result. */
function run(pageHtml, assetBytes = "hello") {
  const root = makeProject({
    "audio/clip.wav": assetBytes,
    "page.html": pageHtml,
  });
  try {
    quietly(() => fillDownloadHashes(root));
    return fs.readFileSync(path.join(root, "page.html"), "utf8");
  } finally {
    removeProject(root);
  }
}

// sha256("hello"), which is what every block below should end up carrying.
const SHA256 = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

describe("fillDownloadHashes", () => {
  test("writes size and digest into the elements that ask for them", () => {
    const out = run(
      `<div data-download="/audio/clip.wav">` +
        `<span data-filesize></span><code data-sha="256"></code></div>`,
    );
    expect(out).toContain("<span data-filesize>5 bytes</span>");
    expect(out).toContain(`<code data-sha="256">${SHA256}</code>`);
  });

  test("a nested element of the same tag does not steal the value", () => {
    // The reason outerRange() counts depth. Matching the next closing tag put
    // the digest between the two <span>s instead of inside the one carrying the
    // attribute, so the page showed an empty field and a loose hash beside it.
    const out = run(
      `<div data-download="/audio/clip.wav">` +
        `<span data-sha="256"><span class="label">SHA-256</span></span></div>`,
    );
    expect(out).toContain(`<span data-sha="256">${SHA256}</span>`);
    expect(out).not.toContain("</span>" + SHA256);
  });

  test("the attribute named inside a comment is documentation, not a target", () => {
    // These blocks document themselves, and the documentation names the very
    // attributes this pass looks for.
    const out = run(
      `<div data-download="/audio/clip.wav">` +
        `<!-- put the size in a [data-filesize] element -->` +
        `<span data-filesize></span></div>`,
    );
    expect(out).toContain("[data-filesize] element -->");
    expect(out).toContain("<span data-filesize>5 bytes</span>");
  });

  test("an existing value is replaced, not appended to", () => {
    const out = run(
      `<div data-download="/audio/clip.wav"><span data-filesize>0 B</span></div>`,
    );
    expect(out).toContain("<span data-filesize>5 bytes</span>");
    expect(out).not.toContain("0 B");
  });

  test("a block whose file is not in the output is left alone", () => {
    const out = run(
      `<div data-download="/audio/missing.wav"><span data-filesize>?</span></div>`,
    );
    expect(out).toContain("<span data-filesize>?</span>");
  });

  test("two blocks on one page are both filled", () => {
    const out = run(
      `<div data-download="/audio/clip.wav"><span data-filesize></span></div>` +
        `<div data-download="/audio/clip.wav"><span data-sha="256"></span></div>`,
    );
    expect(out).toContain("<span data-filesize>5 bytes</span>");
    expect(out).toContain(`<span data-sha="256">${SHA256}</span>`);
  });

  test("a page with no download block is not rewritten at all", () => {
    const html = `<p>nothing here</p>`;
    expect(run(html)).toBe(html);
  });
});
