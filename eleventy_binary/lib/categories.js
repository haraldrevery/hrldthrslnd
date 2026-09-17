/**
 * category.json — the handful of subjects the site puts forward.
 *
 * A category is not a new way of filing a post. It is a group of subjects that
 * already exist, given a title, a description and a picture:
 *
 *   {
 *     "per_page": 9,
 *     "categories": [
 *       {
 *         "title": "Night Sky",
 *         "description": "Stars, planets and the long exposures that catch them.",
 *         "thumbnail": "/image/milky_way.jpg",
 *         "tags": ["astronomy", "astrophotography"]
 *       }
 *     ]
 *   }
 *
 * A post is in a category when any of its subjects — `tags` and `category`,
 * merged, exactly as everywhere else — is one of the category's `tags`, ignoring
 * case. Nothing is written on the post, so filing a post under a category is
 * the same act as tagging it, and a category can be regrouped without touching
 * a single page.
 *
 * `tags` is optional, and leaving it out matches the category's own title. That
 * is what keeps the old meaning of `category:` in front matter intact: a post
 * written `category: [Astronomy]` lands in a category titled "Astronomy" with no
 * list to keep in step.
 *
 * `slug` is optional too. Without it the URL comes from the title, so renaming a
 * category moves its page; set `slug` to pin it.
 *
 * `sort` is how the category's own page orders its entries: "date", newest
 * first, which is what every other listing on the site does, or "title", A-Z.
 * It is the one thing here that changes a page rather than describing it, and
 * it is per category on purpose — a run of photographs reads by date, a set of
 * reference notes reads by name, and the same site can want both.
 *
 * Read from the project root, beside site_settings.json, and never from a path
 * baked into the binary. A missing file is not a fault — it means the site has
 * no categories. A file that cannot be read is reported and ignored, so a stray
 * trailing comma costs the categories section and not the build.
 */
import fs from "node:fs";
import path from "node:path";

import { headingSlug } from "./paths.js";
import { subjectList, foldSubject } from "./subjects.js";

export const CATEGORY_FILE = "category.json";

/**
 * Categories per page of /categories.html. Nine is three of the grid's groups
 * of three — one large card and two small — and a multiple of three is what
 * keeps every page's pattern whole.
 */
export const DEFAULT_PER_PAGE = 9;

/**
 * How a category's page orders its entries.
 *
 * "date" is the site's own order — newest first, the one publishedPosts()
 * settles for every listing — and stays the default, so a category that says
 * nothing reads exactly as it did before this key existed.
 */
export const SORTS = ["date", "title"];
export const DEFAULT_SORT = "date";

const KNOWN_KEYS = new Set(["title", "description", "thumbnail", "tags", "slug", "sort"]);
const KNOWN_ROOT_KEYS = new Set(["categories", "per_page"]);

/** Keys that start with "//" are notes to the reader, the package.json way. */
const isNote = (key) => key.startsWith("//");

/**
 * Read and validate category.json.
 *
 * @returns {{ present: boolean, perPage: number, categories: object[], findings: object[] }}
 *   Findings are in the status check's shape and are NOT logged here: the
 *   status check reports them, once, against the file the author edits.
 */
export function readCategories(root = process.cwd()) {
  const file = path.join(root, CATEGORY_FILE);
  if (!fs.existsSync(file)) {
    return { present: false, perPage: DEFAULT_PER_PAGE, categories: [], findings: [] };
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return {
      present: true,
      perPage: DEFAULT_PER_PAGE,
      categories: [],
      findings: [finding("error", "not valid JSON — no categories were published", error.message)],
    };
  }

  return { present: true, ...parseCategories(doc) };
}

/**
 * Validate an already-parsed document. Separate from the read so it can be
 * tested without a file.
 *
 * Every entry is normalised into:
 *   { index, title, description, thumbnail, subjects, keys, slug, sort }
 * where `subjects` is the list as written (or the title) and `keys` is the same
 * list folded, which is what membership is decided on.
 */
export function parseCategories(doc) {
  const findings = [];
  const categories = [];

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    findings.push(finding(
      "error",
      "expected an object holding a \"categories\" list — no categories were published",
      "the file should look like { \"categories\": [ { \"title\": … } ] }",
    ));
    return { perPage: DEFAULT_PER_PAGE, categories, findings };
  }

  for (const key of Object.keys(doc)) {
    if (!KNOWN_ROOT_KEYS.has(key) && !isNote(key)) {
      findings.push(finding("warn", `unknown key "${key}" is ignored`, `known keys: ${[...KNOWN_ROOT_KEYS].join(", ")}`));
    }
  }

  let perPage = DEFAULT_PER_PAGE;
  if (doc.per_page !== undefined) {
    if (Number.isInteger(doc.per_page) && doc.per_page > 0) {
      perPage = doc.per_page;
    } else {
      findings.push(finding("warn", `"per_page" is not a positive whole number, using ${DEFAULT_PER_PAGE}`));
    }
  }

  if (!Array.isArray(doc.categories)) {
    findings.push(finding(
      "error",
      doc.categories === undefined ? "no \"categories\" list" : "\"categories\" is not a list",
      "no categories were published",
    ));
    return { perPage, categories, findings };
  }

  doc.categories.forEach((entry, index) => {
    const where = `categories[${index}]`;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      findings.push(finding("warn", `${where} is not an object, skipped`));
      return;
    }

    const title = typeof entry.title === "string" ? entry.title.trim() : "";
    if (!title) {
      findings.push(finding("warn", `${where} has no "title", skipped`, "the title is the card's heading and the page's name"));
      return;
    }
    const label = `${where} "${title}"`;

    for (const key of Object.keys(entry)) {
      if (!KNOWN_KEYS.has(key) && !isNote(key)) {
        findings.push(finding("warn", `${label} — unknown key "${key}" is ignored`, `known keys: ${[...KNOWN_KEYS].join(", ")}`));
      }
    }

    const description = typeof entry.description === "string" ? entry.description.trim() : "";
    if (!description) {
      findings.push(finding("warn", `${label} — no "description"`, "used on the card and as the page's meta description"));
    }

    const thumbnail = typeof entry.thumbnail === "string" ? entry.thumbnail.trim() : "";
    if (!thumbnail) {
      findings.push(finding("warn", `${label} — no "thumbnail"`, "the card falls back to default_image in site_settings.json"));
    }

    // subjectList() is the one reading of a subject list — it takes a list or a
    // comma-separated string, the same two shapes front matter accepts.
    let subjects = [];
    if (entry.tags !== undefined && typeof entry.tags !== "string" && !Array.isArray(entry.tags)) {
      findings.push(finding("warn", `${label} — "tags" is not a list, matching the title instead`));
    } else {
      subjects = subjectList(entry.tags);
    }
    if (subjects.length === 0) subjects = [title];

    let slug = "";
    if (entry.slug !== undefined) {
      const written = String(entry.slug).trim();
      slug = written ? headingSlug(written) : "";
      if (written && slug !== written) {
        findings.push(finding(
          "warn",
          `${label} — "slug" "${written}" is used as "${slug}"`,
          "a slug is lowercase letters, digits and hyphens",
        ));
      }
    }

    // An unknown order is a warning and the default, never a refusal: the rule
    // this file is built on is that a fault costs the categories nothing but
    // the thing that was misspelt.
    let sort = DEFAULT_SORT;
    if (entry.sort !== undefined) {
      const written = String(entry.sort).trim().toLowerCase();
      if (SORTS.includes(written)) {
        sort = written;
      } else {
        findings.push(finding(
          "warn",
          `${label} — "sort" is not a known order, using "${DEFAULT_SORT}"`,
          `known orders: ${SORTS.map((name) => `"${name}"`).join(", ")}`,
        ));
      }
    }

    categories.push({
      index,
      title,
      description,
      thumbnail,
      subjects,
      keys: [...new Set(subjects.map(foldSubject))],
      slug,
      sort,
    });
  });

  return { perPage, categories, findings };
}

/**
 * Whether a post's subjects put it in a category. Keys, not spellings: the
 * category may say "astronomy" where the post says "Astronomy".
 */
export function inCategory(category, subjects) {
  if (!Array.isArray(subjects)) return false;
  return subjects.some((subject) => category.keys.includes(foldSubject(subject)));
}

function finding(level, message, detail) {
  return { level, scope: "categories", page: CATEGORY_FILE, message, detail: detail ?? null };
}

export default readCategories;
