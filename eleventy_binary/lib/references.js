/**
 * What the built site refers to.
 *
 * Two passes need to read references out of finished HTML: the status check,
 * which verifies that each one resolves, and the asset copier, which publishes
 * a page-builder folder's files only if something on the site uses them. The
 * helpers they share live here so the two cannot disagree about what a
 * reference is.
 */
import fs from "node:fs";
import path from "node:path";

import { walkFiles } from "./slugs.js";

/**
 * decodeURIComponent, but a malformed escape is not a crash.
 *
 * A literal `%` in a filename (`/100%_guide.html`) makes the real one throw
 * URIError, which took down the whole build with a stack trace and no hint
 * about which page held the link. An undecodable reference is just used as
 * written — if that path is not on disk it gets reported like any other.
 */
export function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** The candidate URLs in one attribute value. Only srcset holds more than one. */
export function attributeRefs(attr, value) {
  if (attr !== "srcset") return [value];
  // "url 400w, url 2x" — each candidate is a URL followed by an optional
  // descriptor. Commas inside a URL are legal but vanishingly rare in a static
  // site that names its own files; splitting on them is what the browser does.
  return value
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
}

/** Every quoted attribute value, whatever the attribute: src, href, content, data-*… */
const QUOTED_ATTR = /\s([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
/** CSS url(), in a style attribute or a <style> block. */
const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]+))\s*\)/gi;
const ENTITIES = { amp: "&", quot: '"', apos: "'", "#39": "'", lt: "<", gt: ">" };

/** An attribute value as the browser reads it: the few entities a URL can carry, decoded. */
const decodeEntities = (value) => value.replace(/&(amp|quot|apos|#39|lt|gt);/g, (_, name) => ENTITIES[name]);

/**
 * One reference as a decoded site-absolute path, or null when it is not a
 * file on this site at all (a fragment, a data: URI, mailto:, …).
 *
 * An absolute URL keeps only its path, whatever the host: the Open Graph image
 * is written as https://<site>/post/x_min.jpg, and that is the same file. For
 * a foreign host this can only add a path, never lose one.
 */
function sitePath(raw, pageDir) {
  let value = raw.trim().replace(/^["']|["']$/g, "");
  if (!value || value.startsWith("#") || /^data:/i.test(value)) return null;
  const absolute = /^(?:https?:)?\/\/[^/]+(\/.*)?$/i.exec(value);
  if (absolute) value = absolute[1] ?? "/";
  else if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;

  value = safeDecode(value.split(/[?#]/)[0]);
  if (!value) return null;
  return value.startsWith("/") ? path.posix.normalize(value) : path.posix.join(pageDir, value);
}

/**
 * Every site path the built pages and stylesheets refer to.
 *
 * Deliberately broad: any quoted attribute and any url(), with srcset-style
 * lists split as well, and relative references resolved against the page. A
 * path is only ever added, so the question it answers, "does anything use this
 * file?", errs on the side of yes. Commented-out markup does not count, the
 * same rule the link check follows.
 */
export function referencedPaths(outputDir) {
  const found = new Set();
  const add = (raw, pageDir) => {
    for (const candidate of [raw, ...attributeRefs("srcset", raw)]) {
      const resolved = sitePath(candidate, pageDir);
      if (resolved) found.add(resolved);
    }
  };

  for (const relative of walkFiles(outputDir)) {
    if (!/\.(html|css)$/i.test(relative)) continue;
    const text = fs.readFileSync(path.join(outputDir, relative), "utf8").replace(/<!--[\s\S]*?-->/g, "");
    const pageDir = path.posix.dirname(`/${relative}`);
    for (const match of text.matchAll(QUOTED_ATTR)) {
      // Decoded first: a style attribute carries url("…") as url(&quot;…&quot;).
      const value = decodeEntities(match[2] ?? match[3]);
      add(value, pageDir);
      for (const url of value.matchAll(CSS_URL)) add(url[1] ?? url[2] ?? url[3], pageDir);
    }
    // <style> blocks, and stylesheets.
    for (const match of text.matchAll(CSS_URL)) add(match[1] ?? match[2] ?? match[3], pageDir);
  }
  return found;
}
