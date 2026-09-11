/**
 * The editor's only way to the disk.
 *
 * Every write the page builder makes goes through this file, and the rules are
 * short enough to hold in one head:
 *
 *   - A document is written to a temporary file beside it and renamed into
 *     place. A crash mid-write leaves the old document intact and a .tmp file
 *     to notice, never a half-written page.
 *   - Before a document is replaced, the version being replaced is copied to
 *     `.revisions/` inside the post folder. The folder starts with a dot, so
 *     every walker in the build skips it and nothing in it is ever published.
 *   - An asset is written with the exclusive flag. If the name is taken the
 *     write fails and the caller picks another name; a file on disk is never
 *     overwritten by an upload.
 *   - Nothing here deletes anything. There is no function for it.
 *
 * Folder names are checked against one pattern before they touch a path, so a
 * request cannot name a folder outside input_custom_post/.
 */
import fs from "node:fs";
import path from "node:path";

import { getRegistry, invalidateRegistry, walkFiles } from "../slugs.js";
import { invalidateImageSizeCache, readImageHeader } from "../imagesize.js";
import { isRaster, isMinName, extensionOf, minFileName, VIDEO_EXT, AUDIO_EXT } from "../paths.js";

const FOLDER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const REVISIONS = ".revisions";

/** How long autosave waits before it is worth keeping a revision of its own. */
const AUTOSAVE_REVISION_GAP_MS = 15 * 60 * 1000;

export class StoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function assertFolderName(name) {
  if (!FOLDER_NAME.test(String(name ?? ""))) {
    throw new StoreError(400, "a post folder name is letters, digits, _ and -, and starts with a letter or digit");
  }
  return name;
}

export function assertAssetName(name) {
  if (!ASSET_NAME.test(String(name ?? "")) || name === REVISIONS) {
    throw new StoreError(400, "an asset name is letters, digits, dots, _ and -, and starts with a letter or digit");
  }
  return name;
}

const postsDir = (root) => path.join(root, "input_custom_post");
const folderDir = (root, folder) => path.join(postsDir(root), assertFolderName(folder));
const docPath = (root, folder) => path.join(folderDir(root, folder), `${folder}.json`);

/** Every post folder the registry knows, with what the list needs. */
export function listPosts(root) {
  invalidateRegistry(root);
  const registry = getRegistry(root);
  return registry.all
    .filter((record) => record.kind === "custom_post")
    .map((record) => {
      let title = "";
      let date = "";
      if (record.source === "json") {
        try {
          const doc = JSON.parse(fs.readFileSync(path.join(root, record.inputPath), "utf8"));
          title = String(doc?.meta?.title ?? "");
          date = String(doc?.meta?.date ?? "");
        } catch {
          /* listed anyway, as a folder that needs attention */
        }
      }
      return {
        folder: record.folder,
        slug: record.slug,
        source: record.source,
        draft: Boolean(record.draft),
        title,
        date,
        permalink: record.permalink,
      };
    });
}

export function readPost(root, folder) {
  const file = docPath(root, folder);
  if (!fs.existsSync(file)) throw new StoreError(404, `no document at input_custom_post/${folder}/${folder}.json`);
  const raw = fs.readFileSync(file, "utf8");
  try {
    return { doc: JSON.parse(raw), raw };
  } catch (error) {
    throw new StoreError(422, `the document is not valid JSON: ${error.message}`);
  }
}

/**
 * Write a document, atomically, keeping the previous version.
 *
 * @param {object} options
 * @param {boolean} options.revision  always keep a revision (an explicit save);
 *   otherwise one is kept only if the last is older than the autosave gap, so a
 *   session of small edits does not leave hundreds of near-identical copies.
 */
export function writePost(root, folder, doc, { revision = false } = {}) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new StoreError(400, "the document must be a JSON object");
  const dir = folderDir(root, folder);
  if (!fs.existsSync(dir)) throw new StoreError(404, `no post folder input_custom_post/${folder}/`);

  const file = docPath(root, folder);
  const serialised = `${JSON.stringify(doc, null, 2)}\n`;

  let kept = null;
  if (fs.existsSync(file)) {
    const previous = fs.readFileSync(file, "utf8");
    if (previous !== serialised) kept = keepRevision(dir, folder, previous, revision);
  }

  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, serialised, "utf8");
  fs.renameSync(tmp, file);
  return { bytes: serialised.length, revision: kept };
}

function keepRevision(dir, folder, contents, force) {
  const revDir = path.join(dir, REVISIONS);
  fs.mkdirSync(revDir, { recursive: true });
  if (!force) {
    const newest = listRevisions(dir)[0];
    if (newest && Date.now() - newest.mtimeMs < AUTOSAVE_REVISION_GAP_MS) return null;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${folder}.${stamp}.json`;
  fs.writeFileSync(path.join(revDir, name), contents, "utf8");
  return name;
}

/** Newest first. */
function listRevisions(dir) {
  const revDir = path.join(dir, REVISIONS);
  if (!fs.existsSync(revDir)) return [];
  return fs
    .readdirSync(revDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => ({ name, mtimeMs: fs.statSync(path.join(revDir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function revisionsOf(root, folder) {
  return listRevisions(folderDir(root, folder)).map((r) => ({ name: r.name, saved: new Date(r.mtimeMs).toISOString() }));
}

export function readRevision(root, folder, name) {
  if (!/^[A-Za-z0-9._-]+\.json$/.test(String(name ?? "")) || name.includes("..")) throw new StoreError(400, "bad revision name");
  const file = path.join(folderDir(root, folder), REVISIONS, name);
  if (!fs.existsSync(file)) throw new StoreError(404, "no such revision");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new StoreError(422, `the revision is not valid JSON: ${error.message}`);
  }
}

/** A new post folder holding an empty document. Refuses an existing folder. */
export function createPost(root, folder, doc) {
  const dir = folderDir(root, folder);
  if (fs.existsSync(dir)) throw new StoreError(409, `input_custom_post/${folder}/ already exists`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(docPath(root, folder), `${JSON.stringify(doc, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  invalidateRegistry(root);
  return { folder };
}

/** The files in a post folder that a page can refer to, with what the editor shows. */
export function listAssets(root, folder) {
  const dir = folderDir(root, folder);
  if (!fs.existsSync(dir)) throw new StoreError(404, `no post folder input_custom_post/${folder}/`);
  const files = walkFiles(dir).filter((relative) => relative !== `${folder}.json` && !relative.endsWith(".tmp"));
  const set = new Set(files);

  return files.map((relative) => {
    const full = path.join(dir, relative);
    const ext = extensionOf(relative);
    const stats = fs.statSync(full);
    const kind = isRaster(relative) || ext === ".gif" || ext === ".svg" ? "image" : VIDEO_EXT.has(ext) ? "video" : AUDIO_EXT.has(ext) ? "audio" : "file";
    const size = kind === "image" ? readImageHeader(full) : null;
    const min = isRaster(relative) && !isMinName(relative) ? path.posix.join(path.posix.dirname(relative), minFileName(path.posix.basename(relative))).replace(/^\.\//, "") : null;
    return {
      name: relative,
      bytes: stats.size,
      kind,
      width: size?.width ?? null,
      height: size?.height ?? null,
      isMin: isMinName(relative),
      hasMin: min ? set.has(min) : null,
    };
  });
}

/**
 * Write a new asset. `wx` — exclusive create — is the whole safety story: a
 * name that exists fails here and the importer chooses another.
 */
export function writeAsset(root, folder, name, bytes) {
  const dir = folderDir(root, folder);
  if (!fs.existsSync(dir)) throw new StoreError(404, `no post folder input_custom_post/${folder}/`);
  assertAssetName(name);
  const file = path.join(dir, name);
  try {
    fs.writeFileSync(file, bytes, { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") throw new StoreError(409, `${name} already exists in the folder`);
    throw error;
  }
  invalidateImageSizeCache();
  return { name, bytes: bytes.length };
}

/**
 * A name not yet taken in the folder: the name itself, else name_2, name_3 …
 *
 * The _min counterpart is part of the decision. An original and its thumbnail
 * are one pair named by one rule — a.jpg and a_min.jpg — and renaming them
 * separately breaks the pair: a.jpg becomes a_2.jpg while a_min.jpg becomes
 * a_min_2.jpg, which is nobody's counterpart, so the build makes a_2_min.jpg
 * on top and then a thumbnail OF a_min_2.jpg. A name is free only when both
 * halves of the pair are.
 */
export function freeName(root, folder, name) {
  const dir = folderDir(root, folder);
  const ext = extensionOf(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  const taken = (candidate) =>
    fs.existsSync(path.join(dir, candidate)) ||
    (isRaster(candidate) && !isMinName(candidate) && fs.existsSync(path.join(dir, minFileName(candidate))));
  let candidate = name;
  let n = 1;
  while (taken(candidate)) {
    n += 1;
    candidate = `${base}_${n}${ext}`;
  }
  return candidate;
}

export { REVISIONS };
