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

function readJpeg(buffer) {
  // Walk the marker segments looking for a Start Of Frame.
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0–SOF15, excluding the non-frame markers DHT (c4), JPG (c8), DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (offset + 4 > buffer.length) break;
    offset += 2 + buffer.readUInt16BE(offset + 2);
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
  try {
    if (!fs.existsSync(filePath)) return null;
    // 64 kB is far more than any of these headers need.
    const handle = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(Math.min(65536, fs.statSync(filePath).size));
    fs.readSync(handle, buffer, 0, buffer.length, 0);
    fs.closeSync(handle);

    const ext = extensionOf(filePath);
    if (ext === ".jpg" || ext === ".jpeg") return readJpeg(buffer);
    if (ext === ".png") return readPng(buffer);
    if (ext === ".gif") return readGif(buffer);
    if (ext === ".svg") return readSvg(buffer);
    return null;
  } catch {
    return null;
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
