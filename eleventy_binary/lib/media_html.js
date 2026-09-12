/**
 * The HTML for one picture, one video or one audio clip.
 *
 * Shared by the markdown pipeline and the block renderer, because a photograph
 * has to come out the same whether it was written as `![alt](/image/x.jpg)` in
 * a note or picked into a gallery in the editor: the same thumbnail, the same
 * width and height, the same lightbox anchor carrying the same title and
 * description. Two copies of this drifted once already — see lightboxable()
 * below for the shape that took.
 *
 * Pure string work. Every measurement comes through the resolver that is
 * passed in, so this runs identically inside a build and inside the editor.
 */
import { escapeHtml, mediaKind, mediaType, extensionOf } from "./paths.js";

/**
 * The <img> for a picture, already pointing at its thumbnail.
 *
 * Intrinsic dimensions reserve the right space before the file loads, which
 * also keeps loading="lazy" from deadlocking on a zero-height image.
 */
export function imageTag(thumb, alt, title, size, { loading = "lazy" } = {}) {
  return (
    `<img src="${escapeHtml(thumb)}" alt="${escapeHtml(alt ?? "")}"` +
    (size ? ` width="${size.width}" height="${size.height}"` : "") +
    ` loading="${loading}" decoding="async"` +
    (loading === "eager" ? ` fetchpriority="high"` : "") +
    (title ? ` title="${escapeHtml(title)}"` : "") +
    ">"
  );
}

/**
 * Wrap a thumbnail in the anchor glightbox opens.
 *
 * data-gallery groups the slider. Every image in a markdown post shares one
 * group so the arrows step through the post's pictures; a block names its own
 * group so a page of several galleries does not become one long slider.
 *
 * The slide's description is the picture's caption where it has one — the
 * photographer's own line, imported from the file's metadata — and its alt
 * text otherwise, which is all a markdown image carries.
 */
export function lightboxLink(src, alt, title, inner, gallery = "post", description = alt) {
  return (
    `<a class="glightbox" href="${escapeHtml(src)}" data-gallery="${escapeHtml(gallery)}"` +
    (title ? ` data-title="${escapeHtml(title)}"` : "") +
    (description ? ` data-description="${escapeHtml(description)}"` : "") +
    `>${inner}</a>`
  );
}

/**
 * Whether a still image should get the lightbox anchor.
 *
 * The test used to be "the thumbnail differs from the source" — link out only
 * when there is a SEPARATE full-resolution file to link to. That reads as an
 * optimisation and is really a silent feature removal: an SVG, a GIF, an AVIF
 * and a WebP with no hand-made counterpart all resolve to themselves, so every
 * one of them rendered as a bare <img>. No zoom on click, and — because the
 * slider is built from the anchors — no place in the post's gallery group
 * either.
 *
 * GLightbox was never the limit. Its own source-type test accepts
 * `jpeg|jpg|jpe|gif|png|apn|webp|avif|svg`, and it opens an animated GIF or a
 * vector the same way it opens a photograph.
 *
 * So the rule is about the URL, not the format: anything this site serves
 * itself is lightboxed. A remote or `data:` src is left alone — it is not ours
 * to open at full resolution, and putting one behind an anchor would pull the
 * vendor bundle onto a page for a picture the site does not own.
 */
export function lightboxable(src) {
  return typeof src === "string" && src.startsWith("/");
}

/**
 * A picture as thumbnail-plus-anchor, measured through the resolver.
 * Returns the markup and the dimensions it found, because a gallery cell also
 * needs the ratio for its own layout.
 */
export function pictureHtml(src, { alt = "", title = "", gallery = "post", loading = "lazy", description = alt }, resolver) {
  const thumb = resolver.resolveThumbnail(src);
  const size = resolver.imageSize(thumb);
  const img = imageTag(thumb, alt, title, size, { loading });
  const html = lightboxable(src) ? lightboxLink(src, alt, title, img, gallery, description || alt) : img;
  return { html, size, thumb };
}

/**
 * A poster frame beside a video, named like every other _min counterpart.
 *
 * Checked with imageSize() rather than resolveThumbnail(): the latter treats a
 * name that already ends in _min as final and hands it straight back, so it
 * would happily return a path to a file that does not exist.
 */
export function posterFor(src, resolver) {
  // extensionOf(), not lastIndexOf("."): a dot in a DIRECTORY name is not the
  // file's extension, so "/video.old/clip" was cut at the folder and asked
  // about "/video_min.jpg" — a file in a different folder entirely.
  const ext = extensionOf(src);
  if (!ext) return "";
  const candidate = `${src.slice(0, src.length - ext.length)}_min.jpg`;
  return resolver.imageSize(candidate) ? candidate : "";
}

/**
 * The bare <video> or <audio> element, no figure around it.
 *
 * `preload="none"` on purpose: a page with several clips must not pull their
 * first frames on load. Native controls only — there is no player script on
 * this site, so the element degrades to whatever the browser ships and keeps
 * working with scripting off.
 */
export function playerTag(kind, src, { poster = "", size = null } = {}) {
  const type = mediaType(src);
  const fallback =
    `<p>Your browser cannot play this ${kind}. ` +
    `<a href="${escapeHtml(src)}">Download the file</a>.</p>`;

  if (kind === "audio") {
    return (
      `<audio controls preload="none">` +
      `<source src="${escapeHtml(src)}"${type ? ` type="${type}"` : ""}>` +
      fallback +
      `</audio>`
    );
  }

  return (
    `<video controls preload="none" playsinline` +
    (poster ? ` poster="${escapeHtml(poster)}"` : "") +
    (size ? ` width="${size.width}" height="${size.height}"` : "") +
    `>` +
    `<source src="${escapeHtml(src)}"${type ? ` type="${type}"` : ""}>` +
    fallback +
    `</video>`
  );
}

export { mediaKind };
