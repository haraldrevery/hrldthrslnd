/**
 * The resolver: everything the renderers need to know about files, behind one
 * small interface.
 *
 * The markdown pipeline and the block renderer both have to answer three
 * questions while they render — how big is this image, which thumbnail should
 * stand in for it, and where does this file beside the page publish to. They
 * used to answer them by calling the filesystem-bound helpers directly, which
 * meant the renderers could only ever run inside a build, against a project on
 * disk. The editor's live preview and the tests both need to render without
 * one.
 *
 * So the three questions are an object, and the renderers take the object.
 * diskResolver() is the build's answer and wraps the helpers that were called
 * before. memoryResolver() is a table. Nothing else changes: a caller that
 * still passes a root string gets the disk resolver, so the old signature keeps
 * working.
 */
import path from "node:path";

import { imageSize, resolveThumbnail } from "./imagesize.js";
import { publishedPathForSource } from "./slugs.js";

/** The resolver a build uses: the project on disk, via the registry. */
export function diskResolver(root = process.cwd()) {
  const resolved = path.resolve(root);
  return {
    kind: "disk",
    root: resolved,
    imageSize: (url) => imageSize(url, resolved),
    resolveThumbnail: (url) => resolveThumbnail(url, resolved),
    publishedPathForSource: (relative) => publishedPathForSource(relative, resolved),
  };
}

/**
 * A resolver made of tables, for tests and for rendering without a project.
 *
 * @param {object} options
 * @param {Record<string, {width:number,height:number}>} options.sizes
 *   site-absolute URL -> dimensions; anything not listed measures as null
 * @param {Record<string, string>} options.thumbnails
 *   site-absolute URL -> the thumbnail URL to show for it; anything not listed
 *   stands in for itself
 * @param {Record<string, string>} options.published
 *   path on disk (relative to the project root) -> the URL it publishes at
 */
export function memoryResolver({ sizes = {}, thumbnails = {}, published = {} } = {}) {
  return {
    kind: "memory",
    root: null,
    imageSize: (url) => sizes[url] ?? null,
    resolveThumbnail: (url) => thumbnails[url] ?? url,
    publishedPathForSource: (relative) => {
      const clean = String(relative).replace(/^\.\//, "");
      return published[clean] ?? null;
    },
  };
}

/**
 * Whatever a caller handed over, as a resolver.
 *
 * A string is a project root; undefined is the current directory; an object
 * that already answers the three questions is used as it is. This is what lets
 * createMarkdownLibrary(root) keep its old signature.
 */
export function asResolver(value) {
  if (value && typeof value === "object" && typeof value.imageSize === "function") return value;
  return diskResolver(typeof value === "string" ? value : process.cwd());
}

export default diskResolver;
