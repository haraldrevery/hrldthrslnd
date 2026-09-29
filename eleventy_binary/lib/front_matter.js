/**
 * Front matter parsing, in one place.
 *
 * Three modules used to carry their own copy of the same `^---\n…\n---`
 * regex — the outline pass and the licence loader to strip a block, the status
 * check to read keys out of one — and the registry was about to become a
 * fourth. They agreed by coincidence rather than by construction, which is the
 * kind of duplication that drifts the moment one of them is taught about CRLF
 * or a `---` inside the body.
 *
 * Deliberately regex based, not a YAML parser: it answers what an author WROTE
 * (is the key there, does it carry a value, is the fence one we read) for the
 * status check and for stripping a block. What the front matter MEANS — is the
 * page a draft, where does it publish — is read in slugs.js with gray-matter
 * and js-yaml, exactly as Eleventy reads it, so the two cannot disagree.
 */

/**
 * The leading `---` block: group 1 is its body, without the fences.
 *
 * Horizontal whitespace is allowed after either fence, because gray-matter
 * allows it: an invisible trailing space must not turn a file Eleventy reads
 * into one the status check reports as having no front matter.
 *
 * `[^\S\r\n]` rather than `\s`: spaces and tabs only, never the line break
 * itself, which the pattern still has to match explicitly.
 */
const FRONT_MATTER = /^---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/;

/**
 * The source with any UTF-8 byte order mark removed.
 *
 * Editors on Windows still write one before the opening `---`, and gray-matter
 * strips it, so this has to as well or the anchored pattern above misses a
 * block Eleventy reads.
 */
const withoutBom = (source) => String(source ?? "").replace(/^﻿/, "");

/**
 * A fence that names a language: `---json`, `---js`, `---toml`.
 *
 * gray-matter reads all of these, but the pattern above matches only a bare
 * `---`, and the registry treats such a file as unreadable. Detected rather
 * than parsed, so the status check can name the file with one clear error
 * instead of leaving a page that half-exists.
 */
const LANGUAGE_FENCE = /^---[ \t]*([A-Za-z][A-Za-z0-9]*)[ \t]*\r?\n/;

/** Whether a source opens with a front matter fence this module cannot read. */
export function hasUnsupportedFence(source) {
  return LANGUAGE_FENCE.test(withoutBom(source));
}

/** The raw front matter body, or null when the file has no block at all. */
export function frontMatterBlock(source) {
  const match = withoutBom(source).match(FRONT_MATTER);
  return match ? match[1] : null;
}

/**
 * The source with its front matter removed.
 * Content that has no block is returned unchanged.
 */
export function stripFrontMatter(source) {
  return withoutBom(source).replace(FRONT_MATTER, "");
}

/**
 * The text a top-level key carries on its own line, or null when the key is
 * absent. An empty string means the key is there with nothing after the colon.
 *
 * Matching is confined to the one line on purpose. The previous pattern spelled
 * the gap after the colon `\s*`, which matches a newline, so a key written with
 * no value swallowed the line break and returned the *next* key as its value —
 * `date:` above `description: hello` read as the token `description:`, and the
 * status check duly reported `date "description:" is not YYYY-MM-DD`. Diagnostics
 * that name the wrong key are worse than none.
 */
function valueLine(block, key) {
  if (block == null) return null;
  const match = String(block).match(new RegExp(`^${key}[^\\S\\n]*:([^\\n]*)`, "m"));
  return match ? match[1] : null;
}

/**
 * A value line with any trailing `# comment` discounted.
 *
 * YAML only starts a comment where the `#` follows whitespace, so `title:#1` is
 * the value "#1" and `title: #1` is an empty value — hence the leading `\s+`
 * rather than a bare `#`.
 */
const withoutComment = (line) => line.replace(/\s+#.*$/, "");

/** Whether a top-level key is present at all, whatever its value. */
export function hasKey(block, key) {
  return valueLine(block, key) !== null;
}

/**
 * Whether a top-level key is present *and* carries a value.
 *
 * `title:` with nothing after it is not a title — YAML reads it as null, the
 * page renders an empty <h1>, and `date:` becomes `new Date(null)`, which is
 * the Unix epoch rather than an error. A presence-only test passed all of that
 * without a word, so the keys most worth checking were the ones least checked.
 *
 * An empty value line is still a value when an indented block follows it: a
 * `- one` sequence, a nested mapping and a `|` scalar are all written that way,
 * and `tags:` above a bullet list is ordinary YAML that must not be reported as
 * empty.
 */
export function hasValue(block, key) {
  if (block == null) return false;

  const lines = String(block).split(/\r?\n/);
  const pattern = new RegExp(`^${key}[^\\S\\n]*:(.*)$`);

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    if (!match) continue;

    if (withoutComment(match[1]).trim() !== "") return true;

    const next = lines.slice(index + 1).find((line) => line.trim() !== "");
    return next != null && /^\s/.test(next);
  }

  return false;
}

/**
 * The first whitespace-delimited token of a top-level key's value, or null.
 *
 * A token rather than the rest of the line, because every caller wants a
 * boolean or a date, and YAML lets a trailing `# comment` follow either. Taking
 * the whole line would read `true # for now` as neither true nor false and warn
 * about a file Eleventy is perfectly happy with.
 *
 * Quotes are left on: `draft: "true"` is the string "true" to Eleventy, not a
 * draft, and the status check's "is this true or false" warning has to see the
 * difference. A caller that only wants the shape of a value strips them itself.
 */
export function firstToken(block, key) {
  const line = valueLine(block, key);
  if (line == null) return null;

  const token = withoutComment(line).trim().split(/\s+/)[0];
  return token ? token : null;
}

/**
 * The WHOLE value a top-level key carries, trimmed, or null when absent.
 *
 * The counterpart to firstToken() above, for the one caller that must not
 * silently discard what follows the first token. `permalink: /my page.html`
 * read as a token is "/my" — which begins with a slash, so every check the
 * registry ran on it passed, and the page published at an extensionless URL
 * nobody asked for. Worse, the registry is the sole authority on permalinks
 * (each input folder's .11tydata.js computes `permalink` from it), so the
 * unpublished check looked for "/my", found it, and reported all clear.
 *
 * A caller deciding whether a value is WELL FORMED needs the whole thing; one
 * that only wants a boolean or a date is better served by the token.
 */
export function wholeValue(block, key) {
  const line = valueLine(block, key);
  if (line == null) return null;
  return withoutComment(line).trim();
}

export default frontMatterBlock;
