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
import { postFolderFor } from "./slugs.js";

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
export function imageSize(url, root = process.cwd()) {
  if (typeof url !== "string" || !url.startsWith("/")) return null;

  const key = cacheKey(path.resolve(root), url);
  if (cache.has(key)) return cache.get(key);

  const filePath = path.join(root, decodeURIComponent(url.split(/[?#]/)[0]));
  let size = null;

  try {
    if (fs.existsSync(filePath)) {
      // 64 kB is far more than any of these headers need.
      const handle = fs.openSync(filePath, "r");
      const buffer = Buffer.alloc(Math.min(65536, fs.statSync(filePath).size));
      fs.readSync(handle, buffer, 0, buffer.length, 0);
      fs.closeSync(handle);

      const ext = extensionOf(filePath);
      if (ext === ".jpg" || ext === ".jpeg") size = readJpeg(buffer);
      else if (ext === ".png") size = readPng(buffer);
      else if (ext === ".gif") size = readGif(buffer);
      else if (ext === ".svg") size = readSvg(buffer);
    }
  } catch {
    size = null;
  }

  cache.set(key, size);
  return size;
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
export function resolveThumbnail(url, root = process.cwd(), extraRoots = []) {
  if (typeof url !== "string" || !url.startsWith("/")) return url;

  const candidate = minVariant(url);
  if (candidate === url) return url;

  const relative = decodeURIComponent(candidate.split(/[?#]/)[0]).replace(/^\//, "");

  // Already where it will be served from: image_min/, card_thumbnail/ and every
  // other passthrough folder sits at this same path under the project root.
  if (fs.existsSync(path.join(root, relative))) return candidate;

  // A post folder publishes to /<slug>/ but lives under input_custom_post/, so
  // the published path does not exist on disk yet at the time this runs. The
  // extra roots let the same lookup find it at its source location.
  //
  // The leading segment has to be translated from the slug back to the folder
  // name rather than joined on as-is: the two differ whenever slugify() changed
  // anything, so a folder called "My Post" was looked up at
  // input_custom_post/my_post/, never found, and every card and og:image for
  // that post silently shipped the full-resolution photograph.
  const slash = relative.indexOf("/");
  if (slash > 0) {
    const folder = postFolderFor(relative.slice(0, slash), root);
    if (folder) {
      const rest = relative.slice(slash + 1);
      for (const dir of extraRoots) {
        if (fs.existsSync(path.join(root, dir, folder, rest))) return candidate;
      }
    }
  }

  return url;
}

/** The source roots a published path might actually live under. */
export const THUMBNAIL_ROOTS = ["input_custom_post"];
