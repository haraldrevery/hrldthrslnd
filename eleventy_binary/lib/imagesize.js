/**
 * Intrinsic image dimensions, read from the file header.
 *
 * Emitting width and height on every <img> does two things that matter here:
 * it reserves the right space before the file arrives (no layout shift), and it
 * stops `loading="lazy"` from deadlocking — an image with no reserved height
 * collapses to zero, never enters the viewport, and so is never loaded.
 *
 * Only headers are parsed; nothing is decoded, so this is cheap enough to run
 * for every image in every post on every build.
 */
import fs from "node:fs";
import path from "node:path";

import { minVariant, extensionOf } from "./paths.js";
import { sourcePathForPublished } from "./slugs.js";

/**
 * Header reads, keyed by root and URL together. The URL alone is not a key:
 * the same "/image/a.jpg" resolves to a different file under a different root,
 * and the size of one would have been served for the other.
 */
const cache = new Map();
const cacheKey = (root, url) => `${root}\u0000${url}`;

/** SOF0-SOF15, less the markers in that range that are not frame headers. */
const isStartOfFrame = (marker) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

/**
 * A JPEG's dimensions, read by walking the file rather than a window of it.
 *
 * Seeks from segment to segment instead of buffering a fixed prefix, because
 * the frame header is not at any fixed depth. An embedded ICC profile is the
 * ordinary case that pushes it down: a Lightroom or Capture One export carries
 * one of several hundred kilobytes, split across as many APP2 segments as it
 * needs, and every one of those sits AHEAD of the Start Of Frame. Reading the
 * first 64 kB and giving up measured nothing for exactly the files a
 * photography site is made of — and a picture with no width and height is a
 * layout shift on load and, being lazy, often no load at all.
 *
 * Each hop is a four-byte read at a computed offset, so a normal photograph
 * costs a handful of them however large it is.
 */
function readJpeg(handle, size) {
  const head = Buffer.alloc(2);
  if (fs.readSync(handle, head, 0, 2, 0) < 2) return null;
  if (head[0] !== 0xff || head[1] !== 0xd8) return null; // no SOI: not a JPEG

  const segment = Buffer.alloc(4);
  let offset = 2;

  while (offset + 4 <= size) {
    if (fs.readSync(handle, segment, 0, 4, offset) < 4) return null;

    // Every segment starts with 0xFF. Anything else means we are no longer on a
    // boundary, so the file is malformed and guessing where the next one might
    // be would only invent an answer.
    if (segment[0] !== 0xff) return null;

    const marker = segment[1];
    // Legal padding before a marker.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Standalone markers: TEM, the restart markers, SOI and EOI carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      continue;
    }

    if (isStartOfFrame(marker)) {
      // precision(1) height(2) width(2), immediately after the length field.
      const frame = Buffer.alloc(5);
      if (fs.readSync(handle, frame, 0, 5, offset + 4) < 5) return null;
      return { height: frame.readUInt16BE(1), width: frame.readUInt16BE(3) };
    }

    // Start Of Scan: entropy-coded data from here on, and no frame header was
    // found before it. Nothing further is worth walking.
    if (marker === 0xda) return null;

    const length = segment.readUInt16BE(2);
    if (length < 2) return null; // a malformed length would not advance
    offset += 2 + length;
  }

  return null;
}

function readPng(buffer) {
  if (buffer.length < 24) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readGif(buffer) {
  if (buffer.length < 10) return null;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function readSvg(buffer) {
  const head = buffer.subarray(0, 2048).toString("utf8");
  const viewBox = head.match(/viewBox\s*=\s*"([^"]+)"/i);
  if (viewBox) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]) };
    }
  }
  const width = head.match(/\bwidth\s*=\s*"(\d+(?:\.\d+)?)(?:px)?"/i);
  const height = head.match(/\bheight\s*=\s*"(\d+(?:\.\d+)?)(?:px)?"/i);
  if (width && height) return { width: Math.round(+width[1]), height: Math.round(+height[1]) };
  return null;
}

/**
 * Dimensions for a site-absolute URL such as "/image_min/a_min.jpg",
 * resolved against the project root. Returns null when the file is missing or
 * the format is not one we can measure — callers then emit no attributes,
 * which is no worse than before.
 */
/**
 * Dimensions for a path on disk, uncached.
 *
 * Split out of imageSize() so a caller that already holds a filesystem path can
 * measure a file without inventing a site-absolute URL for it — the thumbnail
 * mirror works entirely in real paths. Kept as the one place these headers are
 * parsed: a second copy of this in images.js is precisely the duplication that
 * front_matter.js exists as a warning about.
 */
export function readImageHeader(filePath) {
  let handle;
  try {
    // statSync doubles as the existence check, and rules out a directory, which
    // opens perfectly well and then fails on the first read.
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size === 0) return null;

    handle = fs.openSync(filePath, "r");
    const ext = extensionOf(filePath);

    // JPEG is walked, because its frame header has no fixed depth. Every other
    // format here declares its size in a short, fixed prefix.
    if (ext === ".jpg" || ext === ".jpeg") return readJpeg(handle, stats.size);

    const buffer = Buffer.alloc(Math.min(2048, stats.size));
    fs.readSync(handle, buffer, 0, buffer.length, 0);
    if (ext === ".png") return readPng(buffer);
    if (ext === ".gif") return readGif(buffer);
    if (ext === ".svg") return readSvg(buffer);
    return null;
  } catch {
    return null;
  } finally {
    // In a finally rather than after the reads: a throw between open and close
    // used to leak the descriptor, and this runs for every image in every post.
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {
        /* already gone */
      }
    }
  }
}

export function imageSize(url, root = process.cwd()) {
  if (typeof url !== "string" || !url.startsWith("/")) return null;

  const key = cacheKey(path.resolve(root), url);
  if (cache.has(key)) return cache.get(key);

  const size = readImageHeader(publishedFilePath(url, root));

  cache.set(key, size);
  return size;
}

/**
 * The file on disk behind a site-absolute URL.
 *
 * Two places to look, and the order matters. A passthrough folder (image/,
 * card_thumbnail/, svg/) sits at the same path under the project root that it
 * will have in the output, so it is found directly. An asset that lives beside
 * a page does not: at the moment this runs it is still in input_markdown/ or
 * input_custom_post/ and nothing has copied it yet, so the published path it
 * will have is a path to nothing. Falling through to the registry is what lets
 * a picture next to a note be measured at all — without it every co-located
 * image shipped with no width and height, which is a layout shift on load and,
 * for a lazy image, often no load at all.
 */
function publishedFilePath(url, root) {
  const relative = decodeURIComponent(url.split(/[?#]/)[0]);
  const direct = path.join(root, relative);
  if (fs.existsSync(direct)) return direct;
  return sourcePathForPublished(relative, root) ?? direct;
}

export default imageSize;

/**
 * The best available thumbnail for an image URL.
 *
 * Prefers the compressed `_min` counterpart, but only when that file actually
 * exists; otherwise the original is returned unchanged.
 *
 * This matters because not every image folder is mirrored. `card_thumbnail/`
 * holds images that are already thumbnails, and `svg/` and `gif/` have no
 * counterpart at all — so rewriting those paths blindly would point cards and
 * Open Graph tags at files that were never generated.
 */
export function resolveThumbnail(url, root = process.cwd()) {
  if (typeof url !== "string" || !url.startsWith("/")) return url;

  const candidate = minVariant(url);
  if (candidate === url) return url;

  const relative = decodeURIComponent(candidate.split(/[?#]/)[0]);

  // Already where it will be served from: image_min/, card_thumbnail/ and every
  // other passthrough folder sits at this same path under the project root.
  if (fs.existsSync(path.join(root, relative))) return candidate;

  // Anything published out of an input folder does not: a post folder publishes
  // to /<slug>/ while its files stay in input_custom_post/<folder>/, and a note's
  // pictures stay in input_markdown/<folder>/ until the asset pass copies them.
  // The published path is a path to nothing until then, so the lookup has to go
  // back through the registry. Doing it by joining the published name onto a
  // source root instead was what broke "My Post": slugify() had renamed the
  // folder, so every card and og:image for it silently shipped the
  // full-resolution photograph.
  const source = sourcePathForPublished(relative, root);
  if (source && fs.existsSync(source)) return candidate;

  return url;
}
