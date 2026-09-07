/**
 * Download block hashes.
 *
 * A download block carries `data-download="/path/as/served"`. This pass hashes
 * the file that was actually shipped into _site and writes the digests into the
 * block's [data-sha] and [data-filesize] elements, so a published checksum can
 * never disagree with the bytes it describes.
 *
 * Runs over the output rather than the templates for exactly that reason: the
 * hash is of the delivered file, not of a source that may differ.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import log from "./log.js";
import { humanBytes } from "./format.js";

const DOWNLOAD_ATTR = /\bdata-download\s*=\s*"([^"]+)"/gi;

/**
 * A copy of the HTML with every comment body blanked out, character for
 * character, so offsets into it are offsets into the original.
 *
 * The attribute this pass looks for is *documented* inside a comment in
 * block_test_page.html, and a page is free to comment out a whole download
 * block while working on it. Neither is a real reference, and neither should
 * be hashed or warned about. Masking rather than stripping keeps every index
 * usable against the untouched source, which is what gets written back.
 */
function maskComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, (comment) => " ".repeat(comment.length));
}

function digests(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    size: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    sha512: crypto.createHash("sha512").update(bytes).digest("hex"),
  };
}

function walkHtml(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkHtml(full, base, out);
    else if (entry.isFile() && entry.name.endsWith(".html")) out.push(path.relative(base, full));
  }
  return out;
}

/**
 * Find the element that owns the `data-download` attribute at `attrIndex`, and
 * return the span of its full outer HTML.
 *
 * A download block contains nested elements of the same tag, so the closing tag
 * cannot be found by matching the next `</div>` — that would stop at the first
 * inner one and leave the hash rows outside the block. This walks forward
 * counting opens and closes instead.
 */
function outerRange(html, attrIndex) {
  const open = html.lastIndexOf("<", attrIndex);
  if (open === -1) return null;

  const tagMatch = /^<([a-zA-Z][a-zA-Z0-9]*)/.exec(html.slice(open, open + 40));
  if (!tagMatch) return null;
  const tag = tagMatch[1].toLowerCase();

  const openEnd = html.indexOf(">", attrIndex);
  if (openEnd === -1) return null;

  const scanner = new RegExp(`<(/?)${tag}\\b`, "gi");
  scanner.lastIndex = openEnd + 1;

  let depth = 1;
  let match;
  while ((match = scanner.exec(html)) !== null) {
    depth += match[1] === "/" ? -1 : 1;
    if (depth === 0) {
      const close = html.indexOf(">", match.index);
      return { start: open, end: close === -1 ? html.length : close + 1 };
    }
  }
  return null;
}

/** Replace the text content of the first element carrying `attr` in `inner`. */
function fill(inner, attr, value) {
  const pattern = new RegExp(`(<([a-z]+)\\b[^>]*\\b${attr}[^>]*>)[\\s\\S]*?(</\\2>)`, "i");
  return inner.replace(pattern, `$1${value}$3`);
}

export function fillDownloadHashes(outputDir) {
  let filled = 0;
  const cache = new Map();

  for (const relative of walkHtml(outputDir)) {
    const file = path.join(outputDir, relative);
    const html = fs.readFileSync(file, "utf8");
    if (!html.includes("data-download")) continue;

    // Everything is *found* in the masked copy and *sliced* from the original.
    const scan = maskComments(html);
    DOWNLOAD_ATTR.lastIndex = 0;

    // Rebuilt left to right so each replacement's length change cannot
    // invalidate the offsets of the ones still to come.
    let out = "";
    let cursor = 0;
    let match;

    while ((match = DOWNLOAD_ATTR.exec(scan)) !== null) {
      const range = outerRange(scan, match.index);
      if (!range || range.start < cursor) continue;

      const block = html.slice(range.start, range.end);
      const clean = decodeURIComponent(match[1].split(/[?#]/)[0]);
      const assetPath = path.join(outputDir, clean);

      out += html.slice(cursor, range.start);

      if (!fs.existsSync(assetPath)) {
        log.warn(
          "downloads",
          "no checksum written — the file is not in the output",
          `${relative} references ${match[1]}`,
        );
        out += block;
      } else {
        if (!cache.has(assetPath)) cache.set(assetPath, digests(assetPath));
        const { size, sha256, sha512 } = cache.get(assetPath);

        let updated = block;
        updated = fill(updated, "data-filesize", humanBytes(size));
        updated = fill(updated, 'data-sha="256"', sha256);
        updated = fill(updated, 'data-sha="512"', sha512);

        out += updated;
        filled += 1;
      }

      cursor = range.end;
    }

    out += html.slice(cursor);
    if (out !== html) fs.writeFileSync(file, out, "utf8");
  }

  if (filled > 0) log.info(`  ${filled} download block(s) hashed`);
  return filled;
}

export default fillDownloadHashes;
