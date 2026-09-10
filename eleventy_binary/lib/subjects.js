/**
 * Subjects — the one list a page is filed under.
 *
 * `tags` and `category` are two spellings of the same idea, so the site treats
 * them as one list and publishes one page per subject. This module is the only
 * place that turns whatever an author wrote into that list, because three
 * different consumers have to reach the same answer: the data cascade (which
 * feeds every template), the tagList collection (which decides what subject
 * pages exist and what they are called) and the status check (which runs over
 * raw sources before Eleventy has parsed anything). A rule that lived in any
 * two of those would drift, and the way it drifts is a post that is counted
 * under a subject whose page it does not appear on.
 *
 * Pure string work on purpose — no Eleventy, no filesystem.
 */

/**
 * A YAML value as a list of subject names.
 *
 * The three shapes an author actually writes:
 *
 *   tags: [test, template]     a flow sequence   -> ["test", "template"]
 *   tags:                      a block sequence  -> ["test", "template"]
 *     - test
 *     - template
 *   tags: test, template       a bare scalar     -> ["test", "template"]
 *
 * The last one is the interesting case, and the reason this function exists.
 * Eleventy already splits a bare scalar `tags` on commas — but it does not
 * TRIM, so `tags: test, template` reaches the templates as
 * `["test", " template"]`, with a leading space. That space is invisible in an
 * editor and invisible in the rendered chip, and it made " template" a
 * different subject from "template": two entries in the subject list, two
 * pages, one of them suffixed `-2` because both reduce to the same slug, and
 * the posts split between them. Trimming every member is what closes that.
 *
 * `category` is not a key Eleventy knows, so nothing splits it for us — which
 * is why the split is applied here to a bare scalar of either key. Splitting is
 * confined to a bare scalar precisely because that is Eleventy's own rule for
 * `tags`: a member of an explicit list is taken as written, so a subject that
 * genuinely contains a comma can still be written `["Wine, women and song"]`.
 *
 * Members are stringified before they are trimmed: `tags: [2026, true]` is
 * legal YAML and arrives as a number and a boolean.
 */
export function subjectList(value) {
  if (value == null) return [];

  const members = Array.isArray(value) ? value : String(value).split(",");
  const names = [];

  for (const member of members) {
    // A null member — `tags: [a, , b]` — is a hole, not a subject.
    if (member == null) continue;
    const name = String(member).trim();
    if (name) names.push(name);
  }

  return names;
}

/**
 * The key two spellings of one subject share.
 *
 * Case only. Authors capitalise categories ("Astronomy") and lowercase tags
 * ("astronomy"), and without this they are two subjects — worse than two, in
 * fact, because both reduce to the same slug, so introducing the capitalised
 * one TAKES the URL the lowercase one was published at and exiles the original
 * to `astronomy-2`. Every existing link to it breaks silently.
 *
 * Deliberately not headingSlug(). That function strips punctuation, so folding
 * on it would merge "C++" and "C#" into a single subject — which is a worse
 * answer than the suffixed URL the slug assigner gives them, and one the author
 * would have no way to override. Diacritics are left alone for the same reason:
 * "resume" and "résumé" are different words. Both of those remain rare
 * slug-level collisions, which is exactly what the `-2` suffix and its warning
 * were built for; case is the common one, and it is settled here instead.
 */
export function foldSubject(value) {
  return String(value ?? "").trim().toLowerCase();
}

/**
 * Several YAML values as one subject list — deduplicated, ignoring case.
 *
 * The first spelling seen wins, so argument order decides both the order of the
 * result and which capitalisation a page shows. Callers pass `tags` before
 * `category` so that adding a category cannot reorder or restyle the chips on
 * a post that already had tags.
 *
 * This settles duplicates WITHIN one page. Two pages spelling the same subject
 * differently are reconciled by the tagList collection, which picks one
 * canonical spelling for the whole site.
 */
export function mergeSubjects(...values) {
  const bySubject = new Map();

  for (const value of values) {
    for (const name of subjectList(value)) {
      const key = foldSubject(name);
      if (!bySubject.has(key)) bySubject.set(key, name);
    }
  }

  return [...bySubject.values()];
}

export default mergeSubjects;
