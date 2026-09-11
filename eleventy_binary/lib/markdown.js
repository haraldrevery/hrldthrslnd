/**
 * The markdown pipeline.
 *
 * Produces static HTML with no client-side dependencies: KaTeX is typeset at
 * build time, headings carry stable anchors for the CSS-only outline panel, and
 * images are rewritten to load their compressed *_min counterpart with the full
 * resolution behind a glightbox link.
 *
 * Every file question — how big is this image, which thumbnail stands in for
 * it, where does the file beside this note publish — goes through a resolver
 * (see resolver.js). That is what lets the identical pipeline run inside the
 * build, inside the editor's live preview, and in a test with no project on
 * disk. Pass a project root and you get the disk resolver, which is what every
 * caller did before the interface existed.
 */
import markdownIt from "markdown-it";
import anchorPlugin from "markdown-it-anchor";
import footnotePlugin from "markdown-it-footnote";
import deflistPlugin from "markdown-it-deflist";
import attrsPlugin from "markdown-it-attrs";
import katexPluginModule from "@vscode/markdown-it-katex";

import path from "node:path";

import { headingSlug, escapeHtml, mediaKind } from "./paths.js";
import { normaliseKey } from "./slugs.js";
import { asResolver } from "./resolver.js";
import { imageTag, lightboxLink, lightboxable, playerTag, posterFor } from "./media_html.js";

const katexPlugin = katexPluginModule.default?.default ?? katexPluginModule.default ?? katexPluginModule;
const anchor = anchorPlugin.default ?? anchorPlugin;

/**
 * Demote every heading by one level.
 *
 * The YAML `title` is rendered as the page's single h1, so a `# Heading` in the
 * body must become an h2 or the document ends up with two h1s. Runs before the
 * anchor plugin so anchors are generated against the final levels.
 */
function demoteHeadings(state) {
  for (const token of state.tokens) {
    if (token.type !== "heading_open" && token.type !== "heading_close") continue;
    const level = Number(token.tag.slice(1));
    const demoted = Math.min(level + 1, 6);
    token.tag = `h${demoted}`;
    if (token.type === "heading_open") token.attrJoin("data-level", String(demoted));
  }
}

/**
 * Collect the heading tree into `env.outline` for the outline panel.
 * Runs after the anchor plugin so every heading already has an id.
 */
function collectOutline(state) {
  // `md.renderInline()` runs the full core chain in inline mode. Without this
  // guard a nested inline render (see renderFigure) would reset the outline
  // that the block-level pass just collected.
  if (state.inlineMode) return;
  const env = state.env;
  if (!env) return;
  env.outline = [];

  const tokens = state.tokens;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type !== "heading_open") continue;
    const inline = tokens[i + 1];
    if (!inline || inline.type !== "inline") continue;

    // Strip the appended anchor link and any inline markup from the label.
    const text = inline.children
      .filter((child) => child.type === "text" || child.type === "code_inline")
      .map((child) => child.content)
      .join("")
      .trim();

    env.outline.push({
      level: Number(token.tag.slice(1)),
      id: token.attrGet("id") ?? "",
      text,
    });
  }
}

/**
 * Wrap tables so a wide table scrolls inside its own box.
 * Without this the page body scrolls horizontally on narrow screens.
 */
function wrapTables(state) {
  if (state.inlineMode) return;
  const tokens = state.tokens;
  if (!tokens.some((token) => token.type === "table_open")) return;

  const wrapped = [];
  let depth = 0;

  for (const token of tokens) {
    if (token.type === "table_open") {
      if (depth === 0) {
        const open = new state.Token("html_block", "", 0);
        open.content = '<div class="table-scroll">\n';
        wrapped.push(open);
      }
      depth += 1;
    }

    wrapped.push(token);

    if (token.type === "table_close") {
      depth -= 1;
      if (depth === 0) {
        const close = new state.Token("html_block", "", 0);
        close.content = "</div>\n";
        wrapped.push(close);
      }
    }
  }

  state.tokens = wrapped;
}

/**
 * Turn a paragraph that holds nothing but images into figures.
 *
 * One image on its own becomes a <figure>: the compressed *_min counterpart is
 * shown and the full resolution file sits behind a glightbox link, so a page
 * never downloads a full-size photo just to display a thumbnail.
 *
 * Several images on consecutive lines become one justified gallery — markdown
 * puts them in a single paragraph separated by softbreaks, which is exactly the
 * run an author means when they write pictures back to back.
 */
function imageFigures(md, resolver) {
  return function (state) {
    if (state.inlineMode) return;
    const tokens = state.tokens;

    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i].type !== "paragraph_open") continue;
      const inline = tokens[i + 1];
      const close = tokens[i + 2];
      if (!inline || inline.type !== "inline" || !close || close.type !== "paragraph_close") continue;

      const images = meaningfulChildren(inline);
      if (images.length === 0) continue;
      if (!images.every((child) => child.type === "image")) continue;

      const html =
        images.length === 1
          ? renderFigure(images[0], md, resolver, state.env)
          : renderGroup(images, md, resolver, state.env);

      const replacement = new state.Token("html_block", "", 0);
      replacement.content = `${html}\n`;
      tokens.splice(i, 3, replacement);
    }
  };
}

/**
 * The inline children of a paragraph that carry meaning.
 *
 * The line break between two images is a `softbreak` token (a `hardbreak` when
 * the line ended in two spaces), and neither is content. Counting them as
 * content is what used to stop a run of images being recognised at all: the
 * paragraph looked like image + softbreak + image rather than two images, so it
 * fell through to the inline renderer and every picture in the run lost its
 * figure, its caption and its lightbox link.
 */
function meaningfulChildren(inline) {
  return inline.children.filter((child) => {
    if (child.type === "softbreak" || child.type === "hardbreak") return false;
    return !(child.type === "text" && child.content.trim() === "");
  });
}

/**
 * A run of images written on consecutive lines, as one justified gallery.
 *
 * .gallery-auto is what marks it as this pipeline's work rather than a
 * hand-placed gallery, and it is what the stylesheet hangs the shorter row
 * height on.
 *
 * Every cell keeps its native aspect ratio and joins the post's lightbox
 * slider. The cells are cropped to a common row height, so they carry no
 * <figcaption> — a caption would have to sit inside that height and would eat
 * the picture. The alt text and the title still reach the reader through the
 * slider's description and heading.
 *
 * A run that is not made up entirely of still images cannot be cropped into a
 * row of cells — a <video> needs its controls and its own width — so it falls
 * back to the stack of figures and players each line would have produced on its
 * own. That is still an improvement on what a mixed run used to render as: a
 * paragraph of bare <img> tags and a download link.
 */
function renderGroup(tokens, md, resolver, env) {
  const allStills = tokens.every((token) => mediaKind(token.attrGet("src") ?? "") === "image");
  if (!allStills) return tokens.map((token) => renderFigure(token, md, resolver, env)).join("");

  const cells = tokens.map((token) => renderCell(token, md, resolver, env)).join("");
  return `<div class="gallery gallery-justified gallery-auto">${cells}</div>`;
}

/**
 * A markdown `src` as the site-absolute URL it will actually be served from.
 *
 * `![](/image/x.jpg)` is already absolute and is returned untouched — that is
 * how every post in this repository is written and nothing about it changes.
 * `![](photo.jpg)` beside a note in a subfolder is the case this exists for: it
 * is resolved against the note's folder ON DISK and then translated to where
 * that folder publishes, because the two are not the same string once slugify()
 * has renamed a folder for the URL. Left as written it would be resolved by the
 * browser against the page's URL, which is right only by coincidence.
 *
 * Returned unchanged when there is no page to resolve against. The outline pass
 * renders a post with no env to collect its headings, and a relative path has no
 * meaning without a page — but the outline does not look at images, so guessing
 * would only invent a wrong answer for something nobody reads.
 *
 * A path that climbs out of the input folder resolves to nothing and is also
 * returned as written, which leaves it for the status check to report as the
 * broken link it is.
 */
function resolveSrc(src, env, resolver) {
  if (typeof src !== "string" || !src) return src;
  if (src.startsWith("/") || src.startsWith("#")) return src;
  // A scheme, or a protocol-relative URL: not ours to resolve.
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith("//")) return src;

  const inputPath = env?.page?.inputPath;
  if (!inputPath) return src;

  // Decoded for the filesystem lookup: the file beside the note is called
  // "My Photo.jpg", not "My%20Photo.jpg".
  let decoded = src;
  try {
    decoded = decodeURIComponent(src);
  } catch {
    // A stray % is not an escape; use the path as typed.
  }

  const noteDir = path.posix.dirname(normaliseKey(inputPath));
  const onDisk = path.posix.join(noteDir, decoded.split(/[?#]/)[0]);
  return resolver.publishedPathForSource(onDisk) ?? src;
}

/**
 * The plain-text alt for an image token.
 *
 * markdown-it's own image renderer uses this, and it returns text rather than
 * HTML — which is what the caller needs, because every use here is escaped
 * once on the way into an attribute. Rendering the alt to HTML first and
 * stripping the tags afterwards double-encoded it instead, so an alt reading
 * "Salt & Pepper" reached the page as "Salt &amp;amp; Pepper".
 */
function altText(token, md) {
  return md.renderer.renderInlineAsText(token.children ?? [], md.options, {});
}

function renderFigure(token, md, resolver, env) {
  const src = resolveSrc(token.attrGet("src") ?? "", env, resolver);
  const title = token.attrGet("title") ?? "";
  const alt = altText(token, md);

  // Markdown has no syntax for video or audio, so ![caption](/video/x.mp4) is
  // the only way to write one. Without this it produced an <img> pointing at an
  // .mp4 — a silently blank box.
  const kind = mediaKind(src);
  if (kind !== "image") return renderPlayer(kind, src, alt, title, resolver);

  // Only swap in a counterpart that was actually generated.
  const thumb = resolver.resolveThumbnail(src);
  const img = imageTag(thumb, alt, title, resolver.imageSize(thumb));

  // `src`, not `thumb`: the anchor always opens the file as written, which for
  // a photograph is the full-resolution original and for an SVG or GIF is the
  // only file there is. See lightboxable() for why those are not two cases.
  const media = lightboxable(src) ? lightboxLink(src, alt, title, img) : img;

  const caption = title || alt;
  return (
    `<figure class="md-figure">` +
    `<span class="art-plate">${media}</span>` +
    (caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : "") +
    `</figure>`
  );
}

/**
 * One cell of an automatic gallery.
 *
 * The figure is the art plate itself rather than wrapping one, which is the
 * shape .gallery-justified lays out and the same markup the hand-written
 * gallery blocks in input_custom_html/ use.
 */
function renderCell(token, md, resolver, env) {
  const src = resolveSrc(token.attrGet("src") ?? "", env, resolver);
  const title = token.attrGet("title") ?? "";
  const alt = altText(token, md);

  const thumb = resolver.resolveThumbnail(src);
  const size = resolver.imageSize(thumb);
  const img = imageTag(thumb, alt, title, size);
  const media = lightboxable(src) ? lightboxLink(src, alt, title, img) : img;

  // The cell's native ratio drives both its flex-basis and its flex-grow, so a
  // wide picture claims a wider share of the row than a tall one — that is the
  // whole of the justifying, and it needs no measuring script. A file we could
  // not measure carries no --ar and takes the stylesheet's landscape default.
  const ratio = size && size.height > 0 ? +(size.width / size.height).toFixed(4) : null;
  const style = ratio ? ` style="--ar:${ratio}"` : "";
  return `<figure class="art-plate fill"${style}>${media}</figure>`;
}

/**
 * A <video> or <audio> figure for a markdown media link. A poster frame is
 * used when a *_min counterpart of the same name exists beside the file, which
 * is the convention the rest of the pipeline already follows.
 */
function renderPlayer(kind, src, alt, title, resolver) {
  const caption = title || alt;
  const poster = kind === "video" ? posterFor(src, resolver) : "";
  const player = playerTag(kind, src, { poster });

  return (
    `<figure class="md-figure md-${kind}">` +
    player +
    (caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : "") +
    `</figure>`
  );
}

/** Inline images (inside a sentence) still get the _min swap, without a figure. */
function inlineImageRule(md, resolver) {
  const fallback = md.renderer.rules.image;
  md.renderer.rules.image = function (tokens, idx, options, env, self) {
    const token = tokens[idx];
    const src = resolveSrc(token.attrGet("src"), env, resolver);
    if (src) token.attrSet("src", src);
    // An inline (mid-sentence) media link cannot become a player without
    // breaking the paragraph, so it degrades to a plain download link.
    if (src && mediaKind(src) !== "image") {
      const label = escapeHtml(token.content || src);
      return `<a href="${escapeHtml(src)}" class="link-underline">${label}</a>`;
    }
    if (src) {
      const thumb = resolver.resolveThumbnail(src);
      token.attrSet("src", thumb);
      const size = resolver.imageSize(thumb);
      if (size && !token.attrGet("width")) {
        token.attrSet("width", String(size.width));
        token.attrSet("height", String(size.height));
      }
    }
    token.attrSet("loading", "lazy");
    token.attrSet("decoding", "async");
    return fallback
      ? fallback(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };
}

/** External links open in a new tab and disown the opener; internal ones do not. */
function externalLinkRule(md) {
  const fallback = md.renderer.rules.link_open;
  md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    const href = tokens[idx].attrGet("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      tokens[idx].attrSet("target", "_blank");
      tokens[idx].attrSet("rel", "noopener noreferrer");
    }
    return fallback
      ? fallback(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };
}

/**
 * @param {string|object} rootOrResolver  a project root, or a resolver from
 *   resolver.js. A root string is what every caller passed before the resolver
 *   existed and still works: it becomes the disk resolver for that root. The
 *   editor and the tests pass a resolver instead.
 */
export function createMarkdownLibrary(rootOrResolver = process.cwd()) {
  const resolver = asResolver(rootOrResolver);

  const md = markdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
  });

  // Order is deliberate: demote first so anchors match the rendered levels.
  md.core.ruler.push("demote_headings", demoteHeadings);

  // Ids only, no visible permalink: the outline panel and in-page links need
  // the ids, but the hover "#" inside every heading is unwanted decoration.
  md.use(anchor, {
    slugify: headingSlug,
  });

  md.use(katexPlugin, {
    throwOnError: false,
    // Static output only. `output: "htmlAndMathml"` keeps the MathML copy for
    // screen readers while the visual layer stays pure CSS — no KaTeX script
    // ever runs in the browser.
    output: "htmlAndMathml",
    strict: false,
    trust: false,
  });

  md.use(footnotePlugin);
  md.use(deflistPlugin);
  md.use(attrsPlugin, { allowedAttributes: ["id", "class", "width", "height", "title"] });

  md.core.ruler.push("collect_outline", collectOutline);
  md.core.ruler.push("wrap_tables", wrapTables);
  md.core.ruler.push("image_figures", imageFigures(md, resolver));

  inlineImageRule(md, resolver);
  externalLinkRule(md);

  // Exposed so a caller holding the library can render alongside it with the
  // same view of the files — the block renderer does exactly that.
  md.resolver = resolver;

  return md;
}

/**
 * Render markdown and return both the HTML and the heading outline.
 * Eleventy's own render path only returns a string, so the outline is captured
 * separately here and stashed on the page data.
 */
export function renderWithOutline(md, source) {
  const env = {};
  const html = md.render(source, env);
  return { html, outline: env.outline ?? [] };
}

export default createMarkdownLibrary;

/**
 * Outline for a markdown source, memoised.
 *
 * Eleventy's render path returns only a string, so the heading tree is produced
 * by a separate pass. The cache keeps that from doubling the KaTeX work on
 * maths-heavy posts, which is by far the most expensive part of a build.
 */
const outlineCache = new Map();

export function outlineFor(md, source) {
  if (outlineCache.has(source)) return outlineCache.get(source);
  const { outline } = renderWithOutline(md, source);
  outlineCache.set(source, outline);
  return outline;
}
