/**
 * Slug registry.
 *
 * All three input folders share one slug namespace, because they all publish
 * into the root of the generated site. The registry is built once, in a
 * deterministic order, so a given set of input files always produces the same
 * URLs — a slug that shifted between builds would break every existing link.
 *
 * Conflicts are resolved by suffix (`post_2`, `post_3`, …) and reported.
 *
 * Each record also carries the slug it *wanted* (`desired`) and whether the
 * source is a draft. Both are read here, once, because this is the only pass
 * that already visits every input file: without them a caller cannot tell a
 * file legitimately named `post_2` from one that was renamed out of a
 * collision, and cannot tell a draft's assets from a published page's.
 */
import fs from "node:fs";
import path from "node:path";

import log from "./log.js";
import { slugify } from "./paths.js";
import { frontMatterBlock, isDraft } from "./front_matter.js";

/** Folder priority: an earlier folder keeps the bare slug on a conflict. */
export const SOURCES = [
  { dir: "input_markdown", kind: "markdown", match: (f) => f.endsWith(".md") },
  { dir: "input_custom_html", kind: "custom_html", match: (f) => f.endsWith(".html") },
  { dir: "input_custom_post", kind: "custom_post", match: null },
];

/**
 * Built registries, keyed by the root they were scanned from — see the same
 * note in settings.js. One shared slot would hand a second project the first
 * one's slugs.
 */
const registries = new Map();

function listMarkdownAndHtml(root, source) {
  const dir = path.join(root, source.dir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => source.match(file))
    .sort()
    .map((file) => ({
      kind: source.kind,
      inputPath: path.join(source.dir, file),
      base: path.basename(file, path.extname(file)),
    }));
}

/**
 * A post folder publishes the HTML file that shares the folder's name
 * (`post_i/post_i.html`); failing that, the single HTML file inside it.
 */
function listPostFolders(root) {
  const dir = path.join(root, "input_custom_post");
  if (!fs.existsSync(dir)) return [];

  const entries = [];
  // Plain code-unit order, not localeCompare. This sort decides which folder
  // keeps a bare slug when two want the same one, so a locale-dependent
  // comparison could hand the same inputs different URLs on another machine —
  // exactly what the note at the top of this file rules out.
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    const folder = path.join(dir, name);

    const htmlFiles = fs.readdirSync(folder).filter((f) => f.endsWith(".html")).sort();
    if (htmlFiles.length === 0) {
      log.warn("slugs", `post folder has no .html file, skipped`, `input_custom_post/${name}/`);
      continue;
    }

    const preferred = htmlFiles.includes(`${name}.html`) ? `${name}.html` : htmlFiles[0];
    if (htmlFiles.length > 1 && !htmlFiles.includes(`${name}.html`)) {
      log.warn(
        "slugs",
        `post folder has ${htmlFiles.length} .html files and none matches the folder name`,
        `input_custom_post/${name}/ — using ${preferred}`,
      );
    }

    entries.push({
      kind: "custom_post",
      inputPath: path.join("input_custom_post", name, preferred),
      base: name,
      folder: name,
    });
  }
  return entries;
}

export function buildRegistry(root = process.cwd()) {
  const candidates = [
    ...listMarkdownAndHtml(root, SOURCES[0]),
    ...listMarkdownAndHtml(root, SOURCES[1]),
    ...listPostFolders(root),
  ];

  const bySlug = new Map();
  const byInputPath = new Map();

  for (const candidate of candidates) {
    const desired = slugify(candidate.base);
    let slug = desired;
    let suffix = 1;

    while (bySlug.has(slug)) {
      suffix += 1;
      slug = `${desired}_${suffix}`;
    }

    if (slug !== desired) {
      log.warn(
        "slugs",
        `slug "${desired}" is already taken by ${bySlug.get(desired).inputPath}`,
        `${candidate.inputPath} published as "${slug}" instead`,
      );
    }
    if (desired !== candidate.base) {
      log.note(
        "slugs",
        `filename normalised for the URL`,
        `${candidate.base} -> ${slug}`,
      );
    }

    const record = {
      ...candidate,
      slug,
      desired,
      draft: readDraft(root, candidate.inputPath),
      permalink: `/${slug}.html`,
    };
    bySlug.set(slug, record);
    byInputPath.set(normaliseKey(candidate.inputPath), record);
  }

  return { bySlug, byInputPath, all: [...bySlug.values()] };
}

/**
 * Whether a source file is marked `draft: true`.
 *
 * An unreadable file is reported as not a draft: the registry is built before
 * Eleventy runs, and guessing "draft" for a file we simply failed to open would
 * silently unpublish a real page. Eleventy will raise its own error on it.
 */
function readDraft(root, inputPath) {
  try {
    return isDraft(frontMatterBlock(fs.readFileSync(path.join(root, inputPath), "utf8")));
  } catch {
    return false;
  }
}

function normaliseKey(inputPath) {
  return inputPath.replace(/^\.\//, "").split(path.sep).join("/");
}

export function getRegistry(root = process.cwd()) {
  const key = path.resolve(root);
  if (!registries.has(key)) registries.set(key, buildRegistry(key));
  return registries.get(key);
}

/**
 * The source folder a post slug was published from, or null.
 *
 * A post folder publishes to /<slug>/ while its files stay in
 * input_custom_post/<folder>/, and the two names differ whenever slugify() had
 * to normalise the folder name — "My Post" publishes at /my_post/. Anything
 * looking for a post's assets on disk has to come through here rather than
 * reusing the published path.
 */
export function postFolderFor(slug, root = process.cwd()) {
  const record = getRegistry(root).bySlug.get(slug);
  return record && record.kind === "custom_post" ? record.folder : null;
}

export default getRegistry;
