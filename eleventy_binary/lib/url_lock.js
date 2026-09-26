/**
 * published_urls.json — the URL each published page was given, so it keeps it.
 *
 * The registry derives a page's URL from its file name, and when two files want
 * the same name the one enumerated first keeps it and the other takes a `_2`.
 * On its own that makes a URL depend on which other files exist: adding
 * input_markdown/post_i.md would take /post_i.html from the page folder that
 * already published there, and move that page and its pictures to /post_i_2.
 * Every link and bookmark to the old page would then open a different one.
 *
 * This file is the memory that prevents it. After every build that publishes,
 * the build records the name each non-draft page was published under. The next
 * build hands those names out first, so a page keeps its URL and a newcomer that
 * wants the same name takes the suffix instead.
 *
 * Rules, all deliberate:
 *   - A page is keyed by its source: the file path for a note or a hand-written
 *     page, the folder for a page folder (its page file may change from .html
 *     to .json without the page moving).
 *   - Renaming or moving a source is a new page with a new URL; its old entry
 *     is dropped because the source is gone. Use `permalink:` to keep an old URL.
 *   - A draft that was never published is not recorded. One that was keeps its
 *     entry, so its name is still held while it is unpublished.
 *   - A file that cannot be read is an error and is never overwritten, because
 *     rewriting it from scratch would forget every URL it held.
 *
 * Commit it with the site. It only changes when pages are added, removed or
 * renamed, one line per page.
 */
import fs from "node:fs";
import path from "node:path";

import log from "./log.js";

export const LOCK_FILE = "published_urls.json";

/** What slugify() and the collision suffix can produce, folders included. */
const SLUG = /^[a-z0-9_]+(?:\/[a-z0-9_]+)*$/;

const NOTE =
  "Written by site_generate after every build that publishes: the URL each page was " +
  "published at (/<name>.html), keyed by its source. A page keeps this URL even if " +
  "another file later wants the same name. Commit this file; edit it only to move a " +
  "page on purpose. See readme.md, 'Keeping URLs stable'.";

/** The identity a page keeps its URL under. */
export function lockKey(record) {
  if (record.kind === "custom_post") return `input_custom_post/${record.folder}/`;
  return String(record.inputPath).split(path.sep).join("/").replace(/^\.\//, "");
}

/**
 * The recorded names, as key -> slug.
 *
 * `readable` is false when the file exists but could not be used; the build
 * then holds no URLs and must not rewrite the file.
 */
export function readUrlLock(root) {
  const file = path.join(root, LOCK_FILE);
  if (!fs.existsSync(file)) return { entries: new Map(), readable: true };

  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    const pages = data?.pages;
    if (!pages || typeof pages !== "object" || Array.isArray(pages)) throw new Error('it has no "pages" object');

    const entries = new Map();
    for (const [key, slug] of Object.entries(pages)) {
      if (typeof slug === "string" && SLUG.test(slug)) {
        entries.set(key, slug);
      } else {
        log.warn("urls", `${LOCK_FILE}: the entry for ${key} is not a page name and is ignored`, JSON.stringify(slug));
      }
    }
    return { entries, readable: true };
  } catch (error) {
    log.error(
      "urls",
      `${LOCK_FILE} could not be read, so no page's URL is held this build`,
      `${error.message} — fix the file (git diff shows what changed); it is not rewritten until it can be read`,
    );
    return { entries: new Map(), readable: false };
  }
}

/**
 * Record the name every published page has now. Returns true when the file
 * changed. Written atomically, and not at all when the content is the same, so
 * a build that moved nothing leaves the file (and git) untouched.
 */
export function writeUrlLock(root, registry) {
  const lock = registry.lock ?? readUrlLock(root);
  if (!lock.readable) return false;

  const pages = {};
  for (const record of [...registry.all].sort((a, b) => (lockKey(a) < lockKey(b) ? -1 : 1))) {
    const key = lockKey(record);
    if (record.draft && !lock.entries.has(key)) continue;
    pages[key] = record.slug;
  }

  const text = `${JSON.stringify({ "//": NOTE, pages }, null, 2)}\n`;
  const file = path.join(root, LOCK_FILE);
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) return false;

  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
  return true;
}

export default readUrlLock;
