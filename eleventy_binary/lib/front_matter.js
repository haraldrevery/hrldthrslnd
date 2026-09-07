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
 * Deliberately regex based, not a YAML parser. This module is bundled into the
 * compiled binary, but it is also the shape the .11tydata.js files could use;
 * more importantly Eleventy remains the authority on what the front matter
 * *means* — everything here is a cheap pre-pass over the raw source, used to
 * decide which files to enumerate before Eleventy has parsed anything.
 */

/**
 * The leading `---` block: group 1 is its body, without the fences.
 *
 * Horizontal whitespace is allowed after either fence, because gray-matter
 * allows it and this parser has to reach the same answer Eleventy does. It did
 * not, and the failure was invisible in both senses: the offending character is
 * a space nobody can see in an editor, and the consequence showed up somewhere
 * else entirely. A single trailing space after the opening `---` made this
 * report "no front matter at all", so readDraft() answered "not a draft" for a
 * page whose block said `draft: true`. Eleventy read the block correctly and
 * held the page back — while the asset copier, trusting the registry, published
 * that draft's co-located files beside the page that was never written. The
 * status check then reported two errors that both named the wrong cause.
 *
 * `[^\S\r\n]` rather than `\s`: spaces and tabs only, never the line break
 * itself, which the pattern still has to match explicitly.
 */
const FRONT_MATTER = /^---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)/;

/**
 * The source with any UTF-8 byte order mark removed.
 *
 * Editors on Windows still write one, and it sits *before* the opening `---`,
 * so the anchored pattern above did not match and the file looked like it had
 * no front matter at all. gray-matter strips the mark before parsing, so
 * Eleventy read the block perfectly well: the two disagreed, and the
 * disagreement was silent in the damaging direction — the status check reported
 * a missing block on a page that had one, and readDraft() below reported "not a
 * draft" for a file whose front matter said otherwise, publishing it.
 */
const withoutBom = (source) => String(source ?? "").replace(/^﻿/, "");

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
 * Quotes are left on. isDraft() below depends on that: `draft: "true"` is the
 * string "true" to Eleventy and therefore NOT a draft, and a token that had been
 * unquoted here could not tell the two apart. A caller that only wants to report
 * on the shape of a value can strip them itself; one that decides whether a page
 * is published must not.
 */
export function firstToken(block, key) {
  const line = valueLine(block, key);
  if (line == null) return null;

  const token = withoutComment(line).trim().split(/\s+/)[0];
  return token ? token : null;
}

/**
 * Whether a front matter block marks the page as a draft.
 *
 * Matches Eleventy's own reading rather than being generous: the drafts
 * preprocessor tests `data.draft === true`, and the YAML core schema makes a
 * boolean out of true/True/TRUE and nothing else — `yes` and `1` parse as a
 * string and a number, so they are NOT drafts there and must not be here. A
 * looser test would unpublish a page Eleventy is publishing, which is the more
 * damaging direction to be wrong in.
 */
export function isDraft(block) {
  const value = firstToken(block, "draft");
  return value != null && /^true$/i.test(value);
}

export default frontMatterBlock;
