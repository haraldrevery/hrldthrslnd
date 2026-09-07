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
 *
 * SUBFOLDERS. input_markdown/ and input_custom_html/ are walked recursively and
 * the folder path becomes part of the slug: input_markdown/travel/iceland.md
 * publishes at /travel/iceland.html. A file at the top level is unaffected —
 * slugify() of a single segment is exactly what it was — so nesting is additive
 * and no existing URL moves.
 *
 * Deriving the slug from the whole path rather than the basename is what makes
 * a vault-sized input safe. The bare filename is not unique in a tree that has
 * folders in it (every note collection ends up with several `index.md`), and
 * the suffix that resolves a collision is assigned in enumeration order — so
 * with basename slugs, adding a file that happens to sort earlier takes the
 * bare URL away from a page that was already published and pushes it to `_2`.
 * A path is unique by construction, which removes that whole class of silent
 * link rot rather than reporting it after the fact.
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
 * Files that live in an input folder but are build configuration, not content.
 * The directory data files sit beside the posts they configure and must never
 * be enumerated as a page or copied into the output.
 */
const isDataFile = (name) => /\.11tydata\.(js|json|cjs|mjs)$/i.test(name);

/**
 * Whether a name is hidden. `.obsidian/`, `.trash/`, `.git/` and `.DS_Store`
 * all sit inside a note vault and none of them is content. Skipped everywhere
 * this module and the asset copier walk, so a vault can be pointed at
 * input_markdown/ without its machinery being published.
 */
const isHidden = (name) => name.startsWith(".");

/**
 * Built registries, keyed by the root they were scanned from — see the same
 * note in settings.js. One shared slot would hand a second project the first
 * one's slugs.
 */
const registries = new Map();

/** Symlink loops already reported, so each one is mentioned once per build. */
const reportedCycles = new Set();

/**
 * Every file under `dir`, depth first, as paths relative to it with forward
 * slashes.
 *
 * Ordering is fixed by sorting each directory's entries in plain code-unit
 * order, exactly as listPostFolders() does and for the same reason: this walk
 * decides which file keeps a bare slug when two want the same one, and
 * localeCompare would hand the same inputs different URLs on another machine.
 *
 * Directory symlinks ARE followed, because the obvious way to publish a note
 * vault is to link it in rather than copy it, and a walk that silently stepped
 * over the link would make this feature not work at all for its main use. The
 * set of already-visited real paths is what keeps a link pointing back up the
 * tree from recursing forever; a cycle is reported rather than ignored, since a
 * silently truncated walk is a silently missing page.
 */
export function walkFiles(dir, { prefix = "", seen = null, out = [] } = {}) {
  const visited = seen ?? new Set();

  let real;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return out; // unreadable; Eleventy reports its own error on the contents
  }
  if (visited.has(real)) {
    // Reported once per build, not once per walk. Three passes walk these same
    // folders — the thumbnail mirror, the registry and the asset copier — so a
    // single loop was printing the same warning three times, which reads as
    // three problems and is the fastest way to teach someone to skim the report.
    if (!reportedCycles.has(real)) {
      reportedCycles.add(real);
      log.warn(
        "slugs",
        "symlink loops back to a folder already visited, not followed",
        `${prefix || path.basename(dir)}/ — files below it are not published`,
      );
    }
    return out;
  }
  visited.add(real);

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (isHidden(entry.name)) continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);

    // A symlink is neither isDirectory() nor isFile(), so both are resolved
    // with a stat before deciding — otherwise every linked-in note is skipped.
    let stats;
    try {
      stats = fs.statSync(full);
    } catch {
      continue; // a broken link points at nothing to publish
    }

    if (stats.isDirectory()) {
      walkFiles(full, { prefix: relative, seen: visited, out });
    } else if (stats.isFile()) {
      out.push(relative);
    }
  }

  return out;
}

/**
 * The published slug for a path inside an input folder.
 *
 * Each segment is slugified on its own so the separators survive: slugifying
 * "travel/iceland" whole would collapse the slash into an underscore and flatten
 * the tree back out.
 */
function slugForRelativePath(relative) {
  return relative
    .split("/")
    .filter(Boolean)
    .map((segment) => slugify(segment))
    .join("/");
}

function listSourceFiles(root, source) {
  const dir = path.join(root, source.dir);
  if (!fs.existsSync(dir)) return [];

  return walkFiles(dir)
    .filter((relative) => {
      const name = relative.slice(relative.lastIndexOf("/") + 1);
      if (isDataFile(name)) return false;
      return source.match(name);
    })
    .map((relative) => {
      const withoutExt = relative.slice(0, relative.length - path.extname(relative).length);
      // dirname() answers "." for a file at the top level, and "." is a path
      // segment like any other as far as slugify() is concerned — it would have
      // become the folder "untitled". An empty string is what "no folder" means
      // here, and every caller below already reads it that way.
      const parent = path.posix.dirname(relative);
      const folder = parent === "." ? "" : parent;
      return {
        kind: source.kind,
        inputPath: path.join(source.dir, ...relative.split("/")),
        // The path within the input folder, which is what the slug comes from.
        relative,
        base: withoutExt,
        // Where this file's neighbours are on disk, and where they publish to.
        sourceDir: folder ? `${source.dir}/${folder}` : source.dir,
        publishedDir: slugForRelativePath(folder),
      };
    });
}

/**
 * A post folder publishes the HTML file that shares the folder's name
 * (`post_i/post_i.html`); failing that, the single HTML file inside it.
 *
 * Not walked recursively: here a folder IS the page, so a folder inside one is
 * a folder of that page's assets, not another post. build.mjs copies those.
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
    if (isHidden(entry.name)) continue;
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
      relative: `${name}/${preferred}`,
      base: name,
      folder: name,
      sourceDir: `input_custom_post/${name}`,
      // A post folder's own assets publish under its slug, which is assigned
      // below; filled in there rather than guessed at here.
      publishedDir: null,
    });
  }
  return entries;
}

export function buildRegistry(root = process.cwd()) {
  const candidates = [
    ...listSourceFiles(root, SOURCES[0]),
    ...listSourceFiles(root, SOURCES[1]),
    ...listPostFolders(root),
  ];

  const bySlug = new Map();
  const byInputPath = new Map();
  /** Published directory -> the folder on disk whose assets publish there. */
  const dirs = new Map();
  /** The same pairing read the other way, for going from disk to URL. */
  const sourceDirs = new Map();

  for (const candidate of candidates) {
    const desired =
      candidate.kind === "custom_post"
        ? slugify(candidate.base)
        : slugForRelativePath(candidate.base);

    // The suffix goes on the last segment, not on the whole path: a collision
    // is between two pages, and /travel/iceland_2.html says that where
    // /travel_iceland_2.html would quietly move the page out of its folder.
    const cut = desired.lastIndexOf("/");
    const parent = cut < 0 ? "" : desired.slice(0, cut + 1);
    const leaf = cut < 0 ? desired : desired.slice(cut + 1);

    let slug = desired;
    let suffix = 1;

    while (bySlug.has(slug)) {
      suffix += 1;
      slug = `${parent}${leaf}_${suffix}`;
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
      // A post folder's assets publish under the slug the page got, which is
      // only known now. Everything else already knows its own folder.
      publishedDir: candidate.kind === "custom_post" ? slug : candidate.publishedDir,
      draft: readDraft(root, candidate.inputPath),
      permalink: `/${slug}.html`,
    };
    bySlug.set(slug, record);
    byInputPath.set(normaliseKey(candidate.inputPath), record);

    // A page at the top of an input folder publishes to the site root, so its
    // neighbours do too. That is recorded one way only: the reverse table would
    // have to answer "which folder does / come from" with input_markdown,
    // input_custom_html and the project root all claiming it at once, and a
    // lookup that has to pick between three right answers is not a lookup.
    if (record.publishedDir) registerDir(dirs, record);
    if (!sourceDirs.has(record.sourceDir)) {
      sourceDirs.set(record.sourceDir, record.publishedDir ?? "");
    }
  }

  return { bySlug, byInputPath, dirs, sourceDirs, all: [...bySlug.values()] };
}

/**
 * Remember that a published directory is served out of a source directory, and
 * report it when two different source folders claim the same one.
 *
 * They can: slugify() normalises, so "My Notes" and "my-notes" both publish to
 * /my_notes/, and their files would then be copied over each other in the
 * output. Left undetected that is one folder's picture silently replacing
 * another's — which is exactly the failure the slug suffix exists to prevent for
 * pages, applied to the assets beside them.
 */
function registerDir(dirs, record) {
  const existing = dirs.get(record.publishedDir);
  if (existing && existing !== record.sourceDir) {
    log.warn(
      "slugs",
      `two folders publish their assets to the same place, "/${record.publishedDir}/"`,
      `${existing}/ and ${record.sourceDir}/ — a file in one overwrites the same name in the other`,
    );
    return;
  }
  dirs.set(record.publishedDir, record.sourceDir);
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

/**
 * One spelling for an input path: no leading "./", forward slashes.
 *
 * Exported because every table keyed by an input path has to agree with this,
 * and one of them did not. Eleventy reports inputPath with forward slashes on
 * every platform while path.join() produces backslashes on Windows, so a table
 * keyed on the raw join matched nothing there — and a permalink that misses its
 * lookup is not an error, it is `false`, which publishes no page at all.
 */
export function normaliseKey(inputPath) {
  return String(inputPath).replace(/^\.\//, "").split(path.sep).join("/");
}

export function getRegistry(root = process.cwd()) {
  const key = path.resolve(root);
  if (!registries.has(key)) registries.set(key, buildRegistry(key));
  return registries.get(key);
}

/**
 * The folder on disk whose files are served from a published directory, or null.
 *
 * A published path says nothing about where its bytes live: /travel/photo.jpg is
 * input_markdown/travel/photo.jpg and /my_post/photo.jpg is
 * input_custom_post/My Post/photo.jpg. Anything that has to open one of those
 * files during the build — measuring an image, looking for a _min counterpart —
 * is looking at a path that does not exist yet, and has to translate it here.
 *
 * Longest match wins, so a nested folder resolves against its own entry rather
 * than against the shallower one it sits inside.
 */
export function sourceDirFor(publishedDir, root = process.cwd()) {
  const { dirs } = getRegistry(root);
  let candidate = String(publishedDir).replace(/^\/+|\/+$/g, "");

  while (candidate) {
    const source = dirs.get(candidate);
    if (source) return { sourceDir: source, publishedDir: candidate };
    const cut = candidate.lastIndexOf("/");
    if (cut < 0) break;
    candidate = candidate.slice(0, cut);
  }
  return null;
}

/**
 * The input folders whose files publish into the site root rather than into a
 * folder of their own. Consulted only when nothing in the registry claims a
 * path — an input folder that holds no pages at all still holds assets.
 */
const ASSET_SOURCE_DIRS = ["input_markdown", "input_custom_html"];

/** Longest registered source folder that is `relative` or contains it. */
function matchSourceDir(sourceDirs, relative) {
  let candidate = relative;
  while (candidate) {
    const published = sourceDirs.get(candidate);
    if (published !== undefined) return { sourceDir: candidate, publishedDir: published };
    const cut = candidate.lastIndexOf("/");
    if (cut < 0) break;
    candidate = candidate.slice(0, cut);
  }
  return null;
}

/**
 * Where a file on disk ends up in the published site, as a site-absolute URL.
 * Returns null for a path no part of the build publishes.
 *
 * The one place that answers this, because three passes need the same answer
 * and a disagreement between any two of them is a missing picture. The asset
 * copier uses it to decide where to write a file; the markdown pipeline uses it
 * to turn `![](photo.jpg)` beside a note into the URL that file will actually
 * have; the status check follows the result to see whether anything is there.
 *
 * Only a *folder that holds a page* is renamed, and it is renamed to that page's
 * own folder — `input_markdown/My Travel/` publishes at `/my_travel/`, because
 * the page inside it had to be given a URL and a URL cannot hold a space. A
 * folder below that is copied under the name it has. This is what keeps a
 * relative reference working without rewriting the author's path: the rename
 * happens at or above the note, and a reference from the note points downwards.
 */
export function publishedPathForSource(relativePath, root = process.cwd()) {
  const clean = String(relativePath)
    .split(path.sep)
    .join("/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
  if (!clean) return null;

  const cut = clean.lastIndexOf("/");
  const folder = cut < 0 ? "" : clean.slice(0, cut);
  const file = clean.slice(cut + 1);

  const { sourceDirs } = getRegistry(root);
  const match = folder ? matchSourceDir(sourceDirs, folder) : null;
  if (match) {
    const rest = folder.slice(match.sourceDir.length).replace(/^\//, "");
    return `/${[match.publishedDir, rest, file].filter(Boolean).join("/")}`;
  }

  // Nothing in this folder is published, so no page has renamed it; it keeps
  // the name it has, minus the input folder it sits in.
  for (const source of ASSET_SOURCE_DIRS) {
    if (clean === source) return null; // the folder itself, not a file in it
    if (clean.startsWith(`${source}/`)) return `/${clean.slice(source.length + 1)}`;
  }
  return null;
}

/**
 * The file on disk a site-absolute URL will be served from, or null.
 *
 * The inverse of publishedPathForSource(), and the reason anything can measure
 * an image before the build has copied it: during a build `/travel/photo.jpg`
 * does not exist yet, and `input_markdown/travel/photo.jpg` does.
 */
export function sourcePathForPublished(url, root = process.cwd()) {
  const relative = String(url).replace(/^\/+/, "");
  if (!relative) return null;

  const cut = relative.lastIndexOf("/");
  if (cut > 0) {
    const match = sourceDirFor(relative.slice(0, cut), root);
    if (match) {
      const rest = relative.slice(match.publishedDir.length + 1);
      return path.join(root, ...match.sourceDir.split("/"), ...rest.split("/"));
    }
  }

  for (const source of ASSET_SOURCE_DIRS) {
    const candidate = path.join(root, source, ...relative.split("/"));
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export default getRegistry;
