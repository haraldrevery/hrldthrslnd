/**
 * The block renderer: a post document to the HTML that goes inside <main>.
 *
 * This is the only place block markup is written. The hand-written library in
 * input_custom_html/block_test_page.html shows the same blocks as copy-paste
 * HTML for pages made by hand; this produces them from data, and the two are
 * kept in step by the block test post the build renders from JSON.
 *
 * Every block is a `<section class="shell block block-<type>">`. The vertical
 * rhythm — a block pads its bottom and never its top — is the `.block` class in
 * css/input.css rather than an inline style, so the theme owns it. The one
 * exception is the hero, which is not a block in that sense: it owns the
 * viewport, sits first, and carries the page's h1.
 *
 * Pure string work over a resolver (see resolver.js), so this runs identically
 * inside the build and inside the editor's preview. Nothing here touches the
 * filesystem.
 */
import { escapeHtml, mediaKind, extensionOf } from "../paths.js";
import { pictureHtml, playerTag, posterFor, imageTag } from "../media_html.js";
import { mergeSubjects } from "../subjects.js";
import { BY_TYPE } from "./catalogue.js";
import { isFolderRef, isSafeFolderRef } from "./validate.js";

const esc = escapeHtml;

/**
 * The URL an asset reference will be served from.
 *
 * A bare name is a file in the post folder, which publishes at /<slug>/ — the
 * ASSIGNED slug, which may carry a collision suffix. Writing the URL here,
 * from the slug the registry actually handed out, is what closes the hole a
 * hand-written page has: it cannot know its final slug, so a suffixed post
 * shipped with every picture 404ing.
 *
 * Each segment is percent-encoded so a file called "My Photo.jpg" produces a
 * URL a browser will fetch; the resolver decodes it again to find the file.
 */
export function assetUrl(src, slug) {
  const value = String(src ?? "").trim();
  if (!isFolderRef(value)) return value;
  if (!isSafeFolderRef(value)) return value;
  return `/${slug}/${value.split("/").map(encodeURIComponent).join("/")}`;
}

/** A select field's value, or its default when the value is not an option. */
function choice(spec, block, name) {
  const field = spec.fields.find((f) => f.name === name);
  const value = block[name];
  return field.options.some((o) => o.value === value) ? value : field.default;
}

const text = (value) => String(value ?? "").trim();
const list = (value) => (Array.isArray(value) ? value : []);

/** A CSS length an author typed, or the fallback. Kept narrow on purpose. */
function cssLength(value, fallback) {
  const v = text(value);
  return /^\d*\.?\d+(rem|em|px|%|vw|vh|ch)$/.test(v) ? v : fallback;
}

/**
 * Render a whole post.
 *
 * @param {object} doc  a document that has passed validatePost()
 * @param {object} options
 * @param {object} options.md        the markdown library, which carries the resolver
 * @param {string} options.slug      the slug the registry assigned to this post
 * @param {string} options.inputPath the post's source path, so relative images
 *   inside markdown resolve through the same table as everything else
 * @param {boolean} options.editable  add `data-block` and `data-image` paths
 *   to the markup, so the editor's canvas can find what was clicked. Only the
 *   editor's preview asks for this; the build never does, so nothing of the
 *   editor reaches the published site.
 * @returns {{html: string, warnings: {path:string, message:string, detail?:string}[]}}
 */
export function renderPost(doc, { md, slug, inputPath = "", editable = false }) {
  const warnings = [];
  const ctx = {
    md,
    resolver: md.resolver,
    slug,
    env: inputPath ? { page: { inputPath } } : {},
    galleries: 0,
    editable,
    mark: (path, type) => (editable ? ` data-block="${esc(path)}"${type ? ` data-block-type="${esc(type)}"` : ""}` : ""),
    markImage: (path) => (editable ? ` data-image="${esc(path)}"` : ""),
    warn: (path, message, detail) => warnings.push({ path, message, detail }),
  };

  const parts = [];
  list(doc?.blocks).forEach((block, i) => {
    const html = renderTop(block, `blocks[${i}]`, ctx);
    if (html) parts.push(html);
  });

  return { html: parts.join("\n"), warnings };
}

/** A top-level block: the hero as it is, everything else in its section. */
function renderTop(block, path, ctx) {
  const spec = BY_TYPE.get(block?.type);
  if (!spec) {
    ctx.warn(path, `unknown block type ${JSON.stringify(block?.type)}, skipped`);
    return "";
  }
  if (spec.type === "hero") return renderHero(block, path, ctx);

  const inner = renderInner(block, path, ctx);
  return `<section class="shell block block-${spec.type}"${ctx.mark(path, spec.type)}>\n${inner}\n</section>`;
}

/** The inside of a block, which is also what a column holds. */
function renderInner(block, path, ctx) {
  switch (block.type) {
    case "heading": return renderHeading(block);
    case "text": return renderText(block, ctx);
    case "gallery": return renderGallery(block, path, ctx);
    case "video": return renderPlayerBlock(block, "video", ctx);
    case "audio": return renderPlayerBlock(block, "audio", ctx);
    case "download": return renderDownload(block, ctx);
    case "faq": return renderFaq(block, ctx);
    case "feature": return renderFeature(block, path, ctx);
    case "raw_html": return String(block.html ?? "");
    case "columns": return renderColumns(block, path, ctx);
    default:
      ctx.warn(path, `unknown block type ${JSON.stringify(block.type)}, skipped`);
      return "";
  }
}

/* --------------------------------------------------------------- helpers */

/** Optional heading and lede above a block's content. */
function head(block) {
  let html = "";
  if (text(block.title)) html += `<h2 class="display-md block-title">${esc(text(block.title))}</h2>\n`;
  if (text(block.lede)) html += `<p class="lede block-lede">${esc(text(block.lede))}</p>\n`;
  return html;
}

/** Content under a head gets the body wrapper that spaces it; alone it does not. */
function body(headHtml, content) {
  return headHtml ? `${headHtml}<div class="block-body">\n${content}\n</div>` : content;
}

/** A picture object from a block, resolved to what the page needs. */
function picture(img, ctx, gallery, { loading = "lazy" } = {}) {
  const url = assetUrl(img?.src, ctx.slug);
  const alt = text(img?.alt);
  const title = text(img?.title);
  return { url, alt, title, caption: text(img?.caption), ...pictureHtml(url, { alt, title, gallery, loading }, ctx.resolver) };
}

/* ------------------------------------------------------------------ hero */

/**
 * The title, line by line, with the accent phrase set in the gradient.
 *
 * `.text-flow` on a span INSIDE the h1, the way every hero in the library does
 * it, and `.hero-break` between lines so a short screen can drop the break.
 * The accent is matched once, on the first line that holds it, and escaped in
 * three pieces so the span never lands inside an entity.
 */
function heroTitle(title, accent) {
  const lines = String(title ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const phrase = text(accent);
  let done = false;

  return lines
    .map((line) => {
      const at = phrase && !done ? line.indexOf(phrase) : -1;
      if (at < 0) return esc(line);
      done = true;
      return (
        esc(line.slice(0, at)) +
        `<span class="text-flow">${esc(phrase)}</span>` +
        esc(line.slice(at + phrase.length))
      );
    })
    .join(' <br class="hero-break">');
}

function renderHero(block, path, ctx) {
  const spec = BY_TYPE.get("hero");
  const variant = choice(spec, block, "variant");
  const photographic = variant !== "stage";

  const classes = ["hero-stage"];
  if (variant === "photo") classes.push("hero-stage-photo");
  if (variant === "photo_adaptive") classes.push("hero-stage-photo-adaptive");

  let media = "";
  if (photographic && block.image?.src) {
    // The ORIGINAL, not the counterpart: a hero is the one place the
    // full-resolution file is the right file, and it loads eagerly because it
    // is above the fold by definition.
    const url = assetUrl(block.image.src, ctx.slug);
    const size = ctx.resolver.imageSize(url);
    if (!size) ctx.warn("blocks[0].image", `could not measure "${block.image.src}"`, "the hero picture ships without width and height");
    media = `<div class="hero-media">${imageTag(url, text(block.image.alt), text(block.image.title), size, { loading: "eager" })}</div>`;
  } else {
    media = `<div class="editorial-grid" aria-hidden="true"></div>`;
  }

  const actions = list(block.actions)
    .filter((a) => a && text(a.label) && text(a.href))
    .map((a, i) => `<a class="btn${i === 0 ? "" : " btn-ghost"}" href="${esc(text(a.href))}">${esc(text(a.label))}</a>`)
    .join("\n      ");

  const cue = block.scroll_cue === false
    ? ""
    : `\n  <a class="hero-scroll-cue" href="#hero-end">Scroll down <span class="arrow" aria-hidden="true">&#8595;</span></a>`;

  return (
    `<section class="${classes.join(" ")}"${ctx.mark(path, "hero")}>\n` +
    `  ${media}\n` +
    `  <div class="shell hero-copy">\n` +
    (text(block.eyebrow) ? `    <p class="eyebrow">${esc(text(block.eyebrow))}</p>\n` : "") +
    `    <h1 class="display">${heroTitle(block.title, block.accent)}</h1>\n` +
    (text(block.lede) ? `    <p class="lede">${esc(text(block.lede))}</p>\n` : "") +
    (actions ? `    <div class="hero-actions">\n      ${actions}\n    </div>\n` : "") +
    `  </div>` +
    cue +
    `\n</section>\n<div class="hero-end" id="hero-end"></div>`
  );
}

/* --------------------------------------------------------------- blocks */

function renderHeading(block) {
  return (
    (text(block.eyebrow) ? `<p class="eyebrow">${esc(text(block.eyebrow))}</p>\n` : "") +
    `<h2 class="display-md">${esc(text(block.title))}</h2>\n` +
    `<hr class="rule-grad">`
  );
}

function renderText(block, ctx) {
  return `<div class="prose">\n${ctx.md.render(String(block.markdown ?? ""), { ...ctx.env })}</div>`;
}

function renderGallery(block, path, ctx) {
  const spec = BY_TYPE.get("gallery");
  const layout = choice(spec, block, "layout");
  const gap = cssLength(block.gap, "0.75rem");
  ctx.galleries += 1;
  const group = `gallery-${ctx.galleries}`;

  const cells = list(block.images).map((img, i) => {
    const url = assetUrl(img?.src, ctx.slug);
    const kind = mediaKind(url);
    const at = ctx.markImage(`${path}.images[${i}]`);

    if (kind === "video") {
      const poster = posterFor(url, ctx.resolver);
      const size = poster ? ctx.resolver.imageSize(poster) : null;
      const player = playerTag("video", url, { poster, size });
      const ratio = size && size.height > 0 ? +(size.width / size.height).toFixed(4) : 1.7778;
      if (layout === "waterfall") return `<figure${at}>${player}${caption(img)}</figure>`;
      return `<figure class="art-plate fill" style="--ar:${ratio}"${at}>${player}</figure>`;
    }
    if (kind === "audio") {
      ctx.warn(`${path}.images[${i}]`, "an audio file in a gallery", "it is rendered as a player cell; the audio block suits it better");
      return `<figure${at}>${playerTag("audio", url)}${caption(img)}</figure>`;
    }

    const p = picture(img, ctx, group);
    const ratio = p.size && p.size.height > 0 ? +(p.size.width / p.size.height).toFixed(4) : null;
    if (!p.size) ctx.warn(`${path}.images[${i}]`, `could not measure "${img?.src}"`, "the cell takes the stylesheet's default ratio");

    if (layout === "waterfall") {
      return `<figure${at}><span class="art-plate">${p.html}</span>${caption(img)}</figure>`;
    }
    if (layout === "uniform") {
      const vector = extensionOf(url) === ".svg";
      return `<figure class="art-plate${vector ? " tile-vector" : " fill"}"${at}>${p.html}</figure>`;
    }
    return `<figure class="art-plate fill"${ratio ? ` style="--ar:${ratio}"` : ""}${at}>${p.html}</figure>`;
  });

  const grid = `<div class="gallery gallery-${layout}" style="--gallery-gap:${gap}">\n${cells.join("\n")}\n</div>`;
  return body(head(block), grid);
}

function caption(img) {
  const value = text(img?.caption) || text(img?.title);
  return value ? `<figcaption>${esc(value)}</figcaption>` : "";
}

function renderPlayerBlock(block, kind, ctx) {
  const url = assetUrl(block.src, ctx.slug);
  let poster = "";
  let size = null;
  if (kind === "video") {
    poster = text(block.poster) ? assetUrl(block.poster, ctx.slug) : posterFor(url, ctx.resolver);
    size = poster ? ctx.resolver.imageSize(poster) : null;
  }

  const headHtml =
    text(block.eyebrow) || text(block.title)
      ? `<div class="${kind}-head">\n` +
        (text(block.eyebrow) ? `<p class="eyebrow">${esc(text(block.eyebrow))}</p>\n` : "") +
        (text(block.title) ? `<p class="display-sm">${esc(text(block.title))}</p>\n` : "") +
        `</div>\n`
      : "";

  const facts = list(block.meta).map((m) => text(m)).filter(Boolean).map((m) => `<span>${esc(m)}</span>`);
  if (block.download !== false) facts.push(`<a class="link-underline" href="${esc(url)}" download>Download</a>`);
  const metaHtml = facts.length ? `<p class="${kind}-meta">${facts.join("\n")}</p>\n` : "";

  const captionHtml = text(block.caption)
    ? `<figcaption class="micro block-caption">${esc(text(block.caption))}</figcaption>\n`
    : "";

  return (
    `<figure class="${kind}-block">\n` +
    headHtml +
    playerTag(kind, url, { poster, size }) + "\n" +
    metaHtml +
    captionHtml +
    `</figure>`
  );
}

function renderDownload(block, ctx) {
  const url = assetUrl(block.src, ctx.slug);
  const name = text(block.title) || decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
  return (
    `<div class="download-block" data-download="${esc(url)}">\n` +
    `<div class="download-head">\n<div>\n` +
    `<p class="eyebrow">${esc(text(block.eyebrow) || "Download")}</p>\n` +
    `<p class="display-sm">${esc(name)}</p>\n</div>\n` +
    `<a class="btn-slim" href="${esc(url)}" download><span class="icon icon-download" aria-hidden="true"></span> Download</a>\n` +
    `</div>\n` +
    (text(block.note) ? `<p class="download-note">${esc(text(block.note))}</p>\n` : "") +
    `<div class="hash-row"><span class="micro">Size</span><span data-filesize>—</span></div>\n` +
    `<div class="hash-row"><span class="micro">SHA-256</span><span data-sha="256">—</span></div>\n` +
    `<div class="hash-row"><span class="micro">SHA-512</span><span data-sha="512">—</span></div>\n` +
    `</div>`
  );
}

function renderFaq(block, ctx) {
  const items = list(block.items)
    .filter((item) => item && text(item.question))
    .map(
      (item, i) =>
        `<details class="faq-item"${i === 0 && block.open_first === true ? " open" : ""}>\n` +
        `<summary class="faq-trigger"><span>${esc(text(item.question))}</span><span class="faq-icon" aria-hidden="true"></span></summary>\n` +
        `<div class="faq-panel">${ctx.md.render(String(item.answer ?? ""), { ...ctx.env })}</div>\n` +
        `</details>`,
    )
    .join("\n");
  return body(head(block), items);
}

function renderFeature(block, path, ctx) {
  const spec = BY_TYPE.get("feature");
  const side = choice(spec, block, "image_side");
  const p = picture(block.image, ctx, "feature");
  if (!p.size) ctx.warn(`${path}.image`, `could not measure "${block.image?.src}"`);

  const plate = `<div class="art-plate fill feature-plate">${p.html}</div>`;
  const action =
    text(block.action_label) && text(block.action_href)
      ? `<p class="feature-action"><a class="btn btn-ghost" href="${esc(text(block.action_href))}">${esc(text(block.action_label))}</a></p>\n`
      : "";
  const panel =
    `<div class="glass-card glass-card-solid panel-adaptive feature-panel">\n` +
    (text(block.eyebrow) ? `<p class="eyebrow">${esc(text(block.eyebrow))}</p>\n` : "") +
    `<h2 class="display-md">${esc(text(block.title))}</h2>\n` +
    (text(block.text) ? `<div class="feature-text">${ctx.md.render(String(block.text), { ...ctx.env })}</div>\n` : "") +
    action +
    `</div>`;

  return `<div class="block-two-col feature-row">\n${side === "right" ? `${panel}\n${plate}` : `${plate}\n${panel}`}\n</div>`;
}

function renderColumns(block, path, ctx) {
  const cols = list(block.items)
    .slice(0, 2)
    .map((inner, i) => {
      const at = `${path}.items[${i}]`;
      // An empty slot is a slot the editor is still filling, not a fault in
      // the renderer's eyes; the validator reports it.
      if (inner == null) return `<div class="block-col"${ctx.mark(at, "empty")}></div>`;
      const spec = BY_TYPE.get(inner?.type);
      if (!spec || spec.inColumns === false) {
        ctx.warn(at, `a ${spec ? spec.label.toLowerCase() : "unknown"} block cannot sit in a column, skipped`);
        return `<div class="block-col"${ctx.mark(at, "empty")}></div>`;
      }
      return `<div class="block-col block-col-${spec.type}"${ctx.mark(at, spec.type)}>\n${renderInner(inner, at, ctx)}\n</div>`;
    });
  return `<div class="block-two-col">\n${cols.join("\n")}\n</div>`;
}

/* ------------------------------------------------------------- page data */

/**
 * The data Eleventy needs for a JSON post: what a .md post's front matter
 * would have carried, read from `meta` and translated to the site's shape.
 * Tags and categories are merged here exactly as the data cascade merges them
 * for every other page, so a JSON post cannot end up on a different set of
 * subject pages from a markdown one that said the same thing.
 */
export function pageData(doc, { slug }) {
  const meta = doc?.meta ?? {};
  const image = text(meta.image) ? assetUrl(meta.image, slug) : "";
  const data = {
    title: text(meta.title),
    date: text(meta.date),
    description: text(meta.description),
    tags: mergeSubjects(meta.tags, meta.category),
    // Merged above; an empty category keeps the cascade's own merge a no-op.
    category: [],
    draft: meta.draft === true,
  };
  if (image) data.image = image;
  if (text(meta.author)) data.author = text(meta.author);
  if (text(meta.updated)) data.updated = text(meta.updated);
  return data;
}

export default renderPost;
