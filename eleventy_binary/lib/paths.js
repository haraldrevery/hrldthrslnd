/**
 * Path helpers shared by the markdown pipeline, the image mirror and
 * status_check, so all three agree on what a "_min" counterpart is called.
 */

/** Extensions that get a compressed *_min.jpg counterpart. */
export const RASTER_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);
/** Extensions that are used as-is — vector and animated formats. */
export const PASSTHROUGH_EXT = new Set([".svg", ".gif", ".avif", ".ico"]);

/** Media that needs a player element rather than an <img>. */
export const VIDEO_EXT = new Set([".mp4", ".webm", ".ogv", ".mov", ".m4v"]);
export const AUDIO_EXT = new Set([".mp3", ".ogg", ".wav", ".m4a", ".flac", ".opus"]);

/**
 * The lowercase extension of a path or URL, including the dot, or "" when there
 * is none.
 *
 * Every extension test in the pipeline goes through here, because the two
 * obvious shortcuts are both wrong. `path.extname` keeps a query string
 * (".jpg?v=2"), and `lastIndexOf(".")` returns -1 for an extensionless name,
 * where a bare `slice(-1)` silently yields the final character instead — so
 * "/video/clip" was being classified on the extension "p".
 *
 * Only the last path segment is considered, so a dot in a directory name
 * ("/dir.mp4/file") is not mistaken for the file's own extension, and a leading
 * dot (".gitignore") is a name rather than an extension.
 */
export function extensionOf(file) {
  const withoutQuery = String(file).split(/[?#]/)[0];
  const name = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLowerCase();
}

export function mediaKind(file) {
  const ext = extensionOf(file);
  if (VIDEO_EXT.has(ext)) return "video";
  if (AUDIO_EXT.has(ext)) return "audio";
  return "image";
}

/** MIME type for a <source> element. */
export function mediaType(file) {
  return ({
    ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime",
    ".webm": "video/webm", ".ogv": "video/ogg",
    ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
    ".m4a": "audio/mp4", ".flac": "audio/flac", ".opus": "audio/ogg",
  })[extensionOf(file)] ?? "";
}

export function isRaster(file) {
  return RASTER_EXT.has(extensionOf(file));
}

export function isMinName(file) {
  return /_min\.(jpe?g|png|webp)$/i.test(String(file).split(/[?#]/)[0]);
}

/**
 * The compressed counterpart for a source image.
 *
 *   /image/a.jpg          -> /image_min/a_min.jpg
 *   /image/sub/a.jpg      -> /image_min/sub/a_min.jpg   (subfolders mirrored)
 *   /post_i/a.jpg         -> /post_i/a_min.jpg          (post assets sit together)
 *   /svg/a.svg            -> /svg/a.svg                 (no counterpart)
 *
 * Returns the original path unchanged when the format has no _min form, so
 * callers can use the result unconditionally.
 */
export function minVariant(src) {
  if (typeof src !== "string" || !src) return src;
  if (!isRaster(src) || isMinName(src)) return src;

  // The counterpart is a different file, so a cache-busting query or a fragment
  // on the original does not carry over to it.
  const clean = src.split(/[?#]/)[0];
  const base = clean.slice(0, clean.length - extensionOf(clean).length);

  if (base.startsWith("/image/")) {
    return `/image_min/${base.slice("/image/".length)}_min.jpg`;
  }
  return `${base}_min.jpg`;
}

/** Filesystem name for a _min counterpart, e.g. "a.jpg" -> "a_min.jpg". */
export function minFileName(file) {
  const ext = extensionOf(file);
  const base = ext ? String(file).slice(0, -ext.length) : String(file);
  return `${base}_min.jpg`;
}

/** Normalise a slug: lowercase, non-alphanumerics collapsed to underscores. */
export function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "untitled";
}

/** Slug for a heading anchor: keeps hyphens, which read better in a URL bar. */
export function headingSlug(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "section";
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
