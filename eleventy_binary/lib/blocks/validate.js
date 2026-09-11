/**
 * Validation of a post document, before anything is rendered.
 *
 * Findings, not exceptions: a document with six problems gets six findings,
 * each with a path into the JSON, so the editor can put the message beside the
 * field and the status check can print it beside the file. Levels follow the
 * rest of the build — `error` means the page cannot be published as it is,
 * `warn` means it will publish with a defect a reader or a crawler will
 * notice, `note` is information.
 *
 * What is NOT checked here: whether a site-absolute asset (/image/x.jpg)
 * exists. That answer needs the whole site, and the link check over the built
 * output already gives it. Files beside the post ARE checked when the caller
 * passes the folder's listing, because that is the mistake the editor exists
 * to catch while it is being made.
 *
 * Pure: no filesystem, no Eleventy. The same code runs in the build and in the
 * editor's browser page.
 */
import { BLOCKS, BY_TYPE, FORMAT_VERSION, COLUMN_TYPES, META_FIELDS } from "./catalogue.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether an asset reference points into the post folder rather than at a
 * site-wide path. Exported because the renderer and the status check share
 * the definition: a folder-relative reference is a bare name, or a path that
 * stays inside the folder.
 */
export function isFolderRef(src) {
  if (typeof src !== "string" || !src) return false;
  if (src.startsWith("/")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) return false;
  return true;
}

/** Whether a folder-relative reference stays inside the folder. */
export function isSafeFolderRef(src) {
  if (!isFolderRef(src)) return false;
  const segments = src.split("/");
  return segments.every((s) => s !== "" && s !== "." && s !== "..");
}

/**
 * Every asset reference in a document, with the path it sits at, so the same
 * walk serves the validator, the status check and the editor's "which files
 * does this page use" answer.
 *
 * @returns {{path:string, src:string, kind:string}[]}
 */
export function assetRefs(doc) {
  const refs = [];
  const push = (path, src, kind) => {
    if (typeof src === "string" && src.trim()) refs.push({ path, src: src.trim(), kind });
  };

  const meta = doc?.meta ?? {};
  push("meta.image", meta.image, "image");

  const walk = (block, path) => {
    if (!block || typeof block !== "object") return;
    const spec = BY_TYPE.get(block.type);
    if (!spec) return;
    for (const field of spec.fields) {
      const value = block[field.name];
      const at = `${path}.${field.name}`;
      if (field.kind === "image" && value && typeof value === "object") push(`${at}.src`, value.src, "image");
      else if (field.kind === "images" && Array.isArray(value)) {
        value.forEach((img, i) => {
          if (img && typeof img === "object") push(`${at}[${i}].src`, img.src, "media");
        });
      } else if (field.kind === "file") push(at, value, field.accept ?? "any");
      else if (field.kind === "blocks" && Array.isArray(value)) {
        value.forEach((inner, i) => walk(inner, `${at}[${i}]`));
      }
    }
  };

  (Array.isArray(doc?.blocks) ? doc.blocks : []).forEach((block, i) => walk(block, `blocks[${i}]`));
  return refs;
}

/**
 * @param {object} doc  the parsed post JSON
 * @param {object} options
 * @param {Set<string>|string[]|null} options.assets  the files in the post
 *   folder, as paths relative to it. When given, every folder-relative
 *   reference is checked against it. Null means "do not check".
 * @returns {{level:string, path:string, message:string, detail?:string}[]}
 */
export function validatePost(doc, { assets = null } = {}) {
  const findings = [];
  const error = (path, message, detail) => findings.push({ level: "error", path, message, detail });
  const warn = (path, message, detail) => findings.push({ level: "warn", path, message, detail });
  const note = (path, message, detail) => findings.push({ level: "note", path, message, detail });

  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    error("", "the file is not a JSON object");
    return findings;
  }

  if (doc.format !== FORMAT_VERSION) {
    error(
      "format",
      doc.format === undefined ? 'missing "format"' : `format ${JSON.stringify(doc.format)} is not one this build can read`,
      `this build reads format ${FORMAT_VERSION}`,
    );
  }

  /* ------------------------------------------------------------------ meta */
  const meta = doc.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    error("meta", 'missing "meta" object', "title, date and description live there");
  } else {
    const has = (key) => {
      const v = meta[key];
      if (v == null) return false;
      if (typeof v === "string") return v.trim() !== "";
      if (Array.isArray(v)) return v.some((m) => String(m ?? "").trim() !== "");
      return true;
    };

    if (!has("title")) error("meta.title", 'missing "title"', "it is the page's <title> and the card's heading");
    if (!has("date")) error("meta.date", 'missing "date"', "the journal is sorted by it");
    else if (!DATE.test(String(meta.date))) warn("meta.date", `date "${meta.date}" is not YYYY-MM-DD`, "sort order and the sitemap may be wrong");
    if (!has("description")) warn("meta.description", 'missing "description"', "used for the meta description, cards and search results");
    if (!has("tags") && !has("category")) warn("meta.tags", "no tags or categories", "the page will not appear on any subject page");
    if (!has("image")) warn("meta.image", 'missing "image"', "falls back to the site default for the card and the social image");
    if (has("updated") && !DATE.test(String(meta.updated))) warn("meta.updated", `updated "${meta.updated}" is not YYYY-MM-DD`);
    if (meta.draft !== undefined && typeof meta.draft !== "boolean") {
      warn("meta.draft", `draft is ${JSON.stringify(meta.draft)}, not true or false`, "anything other than true is treated as published");
    }
    for (const key of ["tags", "category"]) {
      const v = meta[key];
      if (v !== undefined && !Array.isArray(v) && typeof v !== "string") {
        error(`meta.${key}`, `"${key}" must be a list of strings`);
      }
    }
    if (has("permalink")) {
      const p = String(meta.permalink);
      if (!p.startsWith("/") || /\s/.test(p) || !/\.html$/i.test(p)) {
        warn("meta.permalink", `permalink "${p}" is not a site-absolute .html path`, "the build refuses it and keeps the slug-derived URL");
      }
    }
    for (const key of Object.keys(meta)) {
      if (!META_FIELDS.some((f) => f.name === key)) note(`meta.${key}`, `"${key}" is not a field this build knows`, "it is ignored");
    }
  }

  /* ---------------------------------------------------------------- blocks */
  if (!Array.isArray(doc.blocks)) {
    error("blocks", 'missing "blocks" list');
    return findings;
  }
  if (doc.blocks.length === 0) warn("blocks", "the page has no blocks");

  doc.blocks.forEach((block, i) => {
    const path = `blocks[${i}]`;
    const spec = validateBlock(block, path, { error, warn, note });
    if (!spec) return;
    if (spec.hero && i !== 0) error(path, "a hero must be the first block", "it is the opening screen and carries the h1");
    if (spec.type === "columns") {
      const items = Array.isArray(block.items) ? block.items : [];
      if (items.length !== 2) error(`${path}.items`, `a two-column row holds exactly 2 blocks, this one holds ${items.length}`);
      items.forEach((inner, j) => {
        const innerPath = `${path}.items[${j}]`;
        if (inner == null) {
          error(innerPath, `column ${j + 1} is empty`, "choose a block for it, or replace the row with a single block");
          return;
        }
        const innerSpec = validateBlock(inner, innerPath, { error, warn, note });
        if (innerSpec && !COLUMN_TYPES.includes(innerSpec.type)) {
          error(innerPath, `a ${innerSpec.label.toLowerCase()} block cannot sit in a column`);
        }
      });
    }
  });

  const heroes = doc.blocks.filter((b) => b && BY_TYPE.get(b.type)?.hero);
  if (heroes.length > 1) error("blocks", `${heroes.length} hero blocks — a page opens once`);
  if (heroes.length === 0 && doc.blocks.length > 0) {
    note("blocks", "no hero", "the page opens on its first block; the title from meta is not printed anywhere on the page, so make sure a block carries an h1-worthy heading");
  }

  /* ---------------------------------------------------------------- assets */
  const listing = assets == null ? null : new Set(assets);
  for (const ref of assetRefs(doc)) {
    // The one mistake the editor itself invites: a picture's address copied
    // out of the editor's own preview. It works while the editor is running
    // and nowhere else, so it is an error rather than an ordinary remote URL.
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//i.test(ref.src)) {
      error(ref.path, `"${ref.src}" points at the page builder's own server`, "it breaks the moment the site is published; choose the file from the library instead");
      continue;
    }
    if (/^(https?:)?\/\//i.test(ref.src)) {
      warn(ref.path, `"${ref.src}" is loaded from another site`, "this site is meant to serve every asset itself");
      continue;
    }
    if (!isFolderRef(ref.src)) {
      if (!ref.src.startsWith("/") && !/^[a-z][a-z0-9+.-]*:/i.test(ref.src)) {
        error(ref.path, `"${ref.src}" is not a file name or a site-absolute path`);
      }
      continue;
    }
    if (!isSafeFolderRef(ref.src)) {
      error(ref.path, `"${ref.src}" climbs out of the post folder`);
      continue;
    }
    if (listing && !listing.has(ref.src)) {
      error(ref.path, `"${ref.src}" is not in the post folder`, "the page would ship with it missing");
    }
  }

  return findings;
}

/**
 * One block against its catalogue entry. Returns the entry, or null when the
 * block is not one the catalogue knows.
 */
function validateBlock(block, path, { error, warn, note }) {
  if (!block || typeof block !== "object" || Array.isArray(block)) {
    error(path, "not a block object");
    return null;
  }
  const spec = BY_TYPE.get(block.type);
  if (!spec) {
    error(`${path}.type`, `unknown block type ${JSON.stringify(block.type)}`, `known: ${BLOCKS.map((b) => b.type).join(", ")}`);
    return null;
  }

  for (const field of spec.fields) {
    const at = `${path}.${field.name}`;
    const value = block[field.name];
    // A picture object with no src is an empty field, not a broken picture:
    // the editor materialises `{ src: "", alt: "" … }` for every image slot
    // so its form has something to bind to, and a stage hero never fills it.
    const empty =
      value == null ||
      (typeof value === "string" && value.trim() === "") ||
      (Array.isArray(value) && value.length === 0) ||
      (field.kind === "image" && typeof value === "object" && !Array.isArray(value) && !String(value.src ?? "").trim());

    if (field.required && empty) {
      // Columns report their count separately, with a better message.
      if (field.kind !== "blocks") error(at, `"${field.name}" is required`);
      continue;
    }
    if (empty) continue;

    switch (field.kind) {
      case "select":
        if (!field.options.some((o) => o.value === value)) {
          warn(at, `"${value}" is not one of ${field.options.map((o) => o.value).join(", ")}`, `the renderer uses "${field.default}"`);
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") warn(at, `"${field.name}" should be true or false`);
        break;
      case "image":
        validateImage(value, at, { error, warn });
        break;
      case "images":
        if (!Array.isArray(value)) error(at, `"${field.name}" must be a list`);
        else value.forEach((img, i) => validateImage(img, `${at}[${i}]`, { error, warn }));
        break;
      case "strings":
        if (!Array.isArray(value)) error(at, `"${field.name}" must be a list of strings`);
        break;
      case "actions":
        if (!Array.isArray(value)) error(at, `"${field.name}" must be a list`);
        else value.forEach((a, i) => {
          if (!a || typeof a !== "object" || !String(a.label ?? "").trim() || !String(a.href ?? "").trim()) {
            error(`${at}[${i}]`, "a button needs a label and a link");
          }
        });
        break;
      case "faq_items":
        if (!Array.isArray(value)) error(at, `"${field.name}" must be a list`);
        else value.forEach((item, i) => {
          if (!item || typeof item !== "object" || !String(item.question ?? "").trim()) {
            error(`${at}[${i}]`, "a question is missing its question");
          } else if (!String(item.answer ?? "").trim()) {
            warn(`${at}[${i}].answer`, "the question has no answer");
          }
        });
        break;
      case "html":
        if (/<script\b/i.test(String(value))) note(at, "raw HTML contains a <script>", "this site is meant to work with scripting off");
        break;
      case "blocks":
        // Judged by the caller, which knows the count and the column rule.
        if (!Array.isArray(value)) error(at, `"${field.name}" must be a list of blocks`);
        break;
      default:
        if (typeof value !== "string") error(at, `"${field.name}" must be text`);
    }
  }

  if (spec.type === "hero") {
    const photographic = block.variant === "photo" || block.variant === "photo_adaptive";
    if (photographic && !(block.image && block.image.src)) error(`${path}.image`, "a photograph treatment needs a picture");
    if (block.accent && typeof block.title === "string" && !block.title.includes(block.accent)) {
      warn(`${path}.accent`, `the accent "${block.accent}" does not appear in the title`, "nothing is highlighted");
    }
  }

  return spec;
}

function validateImage(value, at, { error, warn }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    error(at, "a picture is an object with at least a src");
    return;
  }
  if (!String(value.src ?? "").trim()) {
    error(`${at}.src`, "a picture needs a src");
    return;
  }
  if (!String(value.alt ?? "").trim()) {
    warn(`${at}.alt`, "no alt text", "read aloud by a screen reader, and the strongest signal image search has");
  } else if (value.caption && String(value.alt).trim() === String(value.caption).trim()) {
    warn(`${at}.alt`, "alt text is a copy of the caption", "that reads the same words out twice; describe what the picture shows instead");
  }
}

/** The worst level in a list of findings: "error", "warn", "note" or "ok". */
export function verdict(findings) {
  if (findings.some((f) => f.level === "error")) return "error";
  if (findings.some((f) => f.level === "warn")) return "warn";
  if (findings.some((f) => f.level === "note")) return "note";
  return "ok";
}

export default validatePost;
