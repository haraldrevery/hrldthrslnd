/**
 * blocks/ — the page-builder document: catalogue, validator and renderer.
 *
 * Rendered against the memory resolver, so nothing here touches a project on
 * disk: what is under test is that a document produces the markup the site's
 * stylesheet expects, and that a broken document is reported at the field
 * that is broken rather than as an exception somewhere else.
 */
import { test, expect, describe } from "bun:test";

import { BLOCKS, BY_TYPE, defaultBlock, COLUMN_TYPES } from "../eleventy_binary/lib/blocks/catalogue.js";
import { validatePost, assetRefs, verdict } from "../eleventy_binary/lib/blocks/validate.js";
import { renderPost, assetUrl, pageData } from "../eleventy_binary/lib/blocks/render.js";
import { createMarkdownLibrary } from "../eleventy_binary/lib/markdown.js";
import { memoryResolver } from "../eleventy_binary/lib/resolver.js";

const resolver = memoryResolver({
  sizes: {
    "/post_x/photo_min.jpg": { width: 800, height: 600 },
    "/post_x/photo.jpg": { width: 1600, height: 1200 },
    "/post_x/tall_min.jpg": { width: 600, height: 900 },
    "/image/site_min.jpg": { width: 1280, height: 720 },
    "/post_x/clip_min.jpg": { width: 640, height: 360 },
  },
  thumbnails: {
    "/post_x/photo.jpg": "/post_x/photo_min.jpg",
    "/post_x/tall.jpg": "/post_x/tall_min.jpg",
    "/image/site.jpg": "/image/site_min.jpg",
  },
  published: { "input_custom_post/post_x/inline.jpg": "/post_x/inline.jpg" },
});
const md = createMarkdownLibrary(resolver);

function doc(blocks, meta = {}) {
  return {
    format: 1,
    meta: { title: "T", date: "2026-01-02", description: "D", tags: ["a"], image: "photo.jpg", ...meta },
    blocks,
  };
}
const render = (blocks, meta) =>
  renderPost(doc(blocks, meta), { md, slug: "post_x", inputPath: "input_custom_post/post_x/post_x.json" });

describe("catalogue", () => {
  test("every type has a label, fields, and a default block that validates", () => {
    for (const spec of BLOCKS) {
      expect(spec.label).toBeTruthy();
      expect(Array.isArray(spec.fields)).toBe(true);
      const block = defaultBlock(spec.type);
      expect(block.type).toBe(spec.type);
    }
    expect(BY_TYPE.get("hero").hero).toBe(true);
  });

  test("hero, feature and columns stay out of columns", () => {
    expect(COLUMN_TYPES).not.toContain("hero");
    expect(COLUMN_TYPES).not.toContain("feature");
    expect(COLUMN_TYPES).not.toContain("columns");
    expect(COLUMN_TYPES).toContain("text");
  });
});

describe("validatePost", () => {
  test("a complete document is clean", () => {
    const findings = validatePost(doc([{ type: "text", markdown: "hi" }]), { assets: ["photo.jpg"] });
    expect(findings.filter((f) => f.level !== "note")).toEqual([]);
  });

  test("missing meta is reported at the field", () => {
    const findings = validatePost({ format: 1, meta: { title: "", date: "yesterday" }, blocks: [] });
    const paths = findings.map((f) => `${f.level}:${f.path}`);
    expect(paths).toContain("error:meta.title");
    expect(paths).toContain("warn:meta.date");
    expect(paths).toContain("warn:meta.description");
    expect(paths).toContain("warn:meta.tags");
  });

  test("the wrong format, and no format, are errors", () => {
    expect(verdict(validatePost({ format: 2, meta: {}, blocks: [] }))).toBe("error");
    expect(validatePost({ meta: {}, blocks: [] }).some((f) => f.path === "format")).toBe(true);
    expect(validatePost(null)[0].level).toBe("error");
  });

  test("a hero anywhere but first, or twice, is an error", () => {
    const hero = { type: "hero", title: "x" };
    const late = validatePost(doc([{ type: "text", markdown: "a" }, hero]));
    expect(late.some((f) => f.level === "error" && f.path === "blocks[1]")).toBe(true);
    const twice = validatePost(doc([hero, hero]));
    expect(twice.some((f) => f.level === "error" && f.path === "blocks")).toBe(true);
  });

  test("an image slot the editor left empty is not a broken picture", () => {
    const findings = validatePost(doc([{ type: "hero", variant: "stage", title: "x", image: { src: "", alt: "", title: "", caption: "" } }]));
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
    const required = validatePost(doc([{ type: "feature", title: "t", image: { src: "" } }]));
    expect(required.some((f) => f.level === "error" && f.path === "blocks[0].image")).toBe(true);
  });

  test("a photograph hero needs its picture", () => {
    const findings = validatePost(doc([{ type: "hero", variant: "photo", title: "x" }]));
    expect(findings.some((f) => f.level === "error" && f.path === "blocks[0].image")).toBe(true);
  });

  test("an unknown type and a missing required field are errors at their path", () => {
    const findings = validatePost(doc([{ type: "banner" }, { type: "text" }]));
    expect(findings.some((f) => f.path === "blocks[0].type" && f.level === "error")).toBe(true);
    expect(findings.some((f) => f.path === "blocks[1].markdown" && f.level === "error")).toBe(true);
  });

  test("columns hold exactly two column-safe blocks", () => {
    const one = validatePost(doc([{ type: "columns", items: [{ type: "text", markdown: "a" }] }]));
    expect(one.some((f) => f.path === "blocks[0].items" && f.level === "error")).toBe(true);
    const nested = validatePost(doc([{ type: "columns", items: [{ type: "text", markdown: "a" }, { type: "hero", title: "h" }] }]));
    expect(nested.some((f) => f.path === "blocks[0].items[1]" && f.level === "error")).toBe(true);
  });

  test("a picture without alt is a warning; alt equal to the caption too", () => {
    const findings = validatePost(
      doc([{ type: "gallery", images: [{ src: "photo.jpg" }, { src: "photo.jpg", alt: "Same", caption: "Same" }] }]),
    );
    expect(findings.filter((f) => f.path.endsWith(".alt") && f.level === "warn")).toHaveLength(2);
  });

  test("a folder reference is checked against the folder; a site path is not", () => {
    const findings = validatePost(
      doc([{ type: "gallery", images: [{ src: "gone.jpg", alt: "a" }, { src: "/image/anything.jpg", alt: "b" }] }]),
      { assets: ["photo.jpg"] },
    );
    const errors = findings.filter((f) => f.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe("blocks[0].images[0].src");
  });

  test("a reference that climbs out of the folder is refused", () => {
    const findings = validatePost(doc([{ type: "download", src: "../secret.pdf" }]), { assets: [] });
    expect(findings.some((f) => f.level === "error" && /climbs/.test(f.message))).toBe(true);
  });

  test("assetRefs walks meta, pictures, files and columns", () => {
    const refs = assetRefs(
      doc([
        { type: "columns", items: [{ type: "download", src: "a.zip" }, { type: "video", src: "b.mp4", poster: "b.jpg" }] },
        { type: "feature", title: "t", image: { src: "c.jpg" } },
      ]),
    );
    expect(refs.map((r) => r.src)).toEqual(["photo.jpg", "a.zip", "b.mp4", "b.jpg", "c.jpg"]);
  });
});

describe("assetUrl", () => {
  test("a bare name publishes under the assigned slug, encoded", () => {
    expect(assetUrl("My Photo.jpg", "post_x_2")).toBe("/post_x_2/My%20Photo.jpg");
    expect(assetUrl("img/a.jpg", "p")).toBe("/p/img/a.jpg");
  });
  test("a site path and a remote URL pass through", () => {
    expect(assetUrl("/image/a.jpg", "p")).toBe("/image/a.jpg");
    expect(assetUrl("https://x/y.jpg", "p")).toBe("https://x/y.jpg");
  });
});

describe("renderPost", () => {
  test("a hero is first, carries the h1 and the accent, and ends with the sentinel", () => {
    const { html } = render([{ type: "hero", title: "Kept\ntogether", accent: "together", eyebrow: "E", lede: "L", actions: [{ label: "Go", href: "/a" }, { label: "Or", href: "/b" }] }]);
    expect(html.startsWith('<section class="hero-stage">')).toBe(true);
    expect(html).toContain('<h1 class="display">Kept <br class="hero-break"><span class="text-flow">together</span></h1>');
    expect(html).toContain('<a class="btn" href="/a">Go</a>');
    expect(html).toContain('<a class="btn btn-ghost" href="/b">Or</a>');
    expect(html).toContain('<div class="hero-end" id="hero-end"></div>');
    expect(html).toContain("hero-scroll-cue");
  });

  test("a photograph hero loads the original eagerly with its size", () => {
    const { html } = render([{ type: "hero", variant: "photo", title: "x", image: { src: "photo.jpg", alt: "A" } }]);
    expect(html).toContain('class="hero-stage hero-stage-photo"');
    expect(html).toContain('<div class="hero-media"><img src="/post_x/photo.jpg" alt="A" width="1600" height="1200" loading="eager"');
  });

  test("every other block is a section with the rhythm class", () => {
    const { html } = render([{ type: "heading", title: "H", eyebrow: "e" }, { type: "text", markdown: "# Demoted" }]);
    expect(html).toContain('<section class="shell block block-heading">');
    expect(html).toContain('<h2 class="display-md">H</h2>');
    expect(html).toContain('<section class="shell block block-text">');
    expect(html).toContain('id="demoted"');
    expect(html).not.toContain("style=\"padding");
  });

  test("a justified gallery cell carries --ar from the thumbnail and a lightbox link", () => {
    const { html, warnings } = render([{ type: "gallery", layout: "justified", images: [{ src: "photo.jpg", alt: "A", title: "T" }, { src: "tall.jpg", alt: "B" }] }]);
    expect(html).toContain('<div class="gallery gallery-justified" style="--gallery-gap:0.75rem">');
    expect(html).toContain('<figure class="art-plate fill" style="--ar:1.3333">');
    expect(html).toContain('<figure class="art-plate fill" style="--ar:0.6667">');
    expect(html).toContain('<a class="glightbox" href="/post_x/photo.jpg" data-gallery="gallery-1" data-title="T" data-description="A">');
    expect(html).toContain('<img src="/post_x/photo_min.jpg" alt="A" width="800" height="600"');
    expect(warnings).toEqual([]);
  });

  test("a waterfall cell carries its caption; a uniform SVG cell is a vector tile", () => {
    const water = render([{ type: "gallery", layout: "waterfall", images: [{ src: "photo.jpg", alt: "A", caption: "C" }] }]).html;
    expect(water).toContain('<figure><span class="art-plate">');
    expect(water).toContain("<figcaption>C</figcaption>");
    const uniform = render([{ type: "gallery", layout: "uniform", images: [{ src: "/svg/mark.svg", alt: "M" }] }]).html;
    expect(uniform).toContain('<figure class="art-plate tile-vector">');
  });

  test("a bad gap and a bad layout fall back rather than leak", () => {
    const { html } = render([{ type: "gallery", layout: "spiral", gap: "expression(1)", images: [{ src: "photo.jpg", alt: "A" }] }]);
    expect(html).toContain("gallery-justified");
    expect(html).toContain("--gallery-gap:0.75rem");
  });

  test("an unmeasurable picture is a warning, not a crash", () => {
    const { html, warnings } = render([{ type: "gallery", images: [{ src: "unknown.jpg", alt: "A" }] }]);
    expect(html).toContain('<figure class="art-plate fill">');
    expect(warnings[0].path).toBe("blocks[0].images[0]");
  });

  test("video and audio blocks use native players with preload none", () => {
    const { html } = render([
      { type: "video", src: "clip.mp4", title: "Clip", meta: ["1:00"], caption: "c" },
      { type: "audio", src: "/audio/a.wav", download: false },
    ]);
    expect(html).toContain('<figure class="video-block">');
    expect(html).toContain('<video controls preload="none" playsinline poster="/post_x/clip_min.jpg" width="640" height="360">');
    expect(html).toContain('<source src="/post_x/clip.mp4" type="video/mp4">');
    expect(html).toContain('<a class="link-underline" href="/post_x/clip.mp4" download>Download</a>');
    expect(html).toContain('<figcaption class="micro block-caption">c</figcaption>');
    expect(html).toContain('<audio controls preload="none"><source src="/audio/a.wav" type="audio/wav">');
    expect(html.match(/download>Download/g)).toHaveLength(1);
  });

  test("a download block carries data-download and the three slots the hasher fills", () => {
    const { html } = render([{ type: "download", src: "My File.zip" }]);
    expect(html).toContain('<div class="download-block" data-download="/post_x/My%20File.zip">');
    expect(html).toContain('<p class="display-sm">My File.zip</p>');
    expect(html).toContain("<span data-filesize>");
    expect(html).toContain('<span data-sha="256">');
    expect(html).toContain('<span data-sha="512">');
  });

  test("faq answers are markdown and the first can open", () => {
    const { html } = render([{ type: "faq", open_first: true, items: [{ question: "Q?", answer: "*A*" }, { question: "R?", answer: "B" }] }]);
    expect(html).toContain('<section class="shell block block-faq">');
    expect(html).toContain('<details class="faq-item" open>');
    expect(html).toContain("<em>A</em>");
    expect(html.match(/<details/g)).toHaveLength(2);
  });

  test("feature puts the picture on the side asked for", () => {
    const left = render([{ type: "feature", title: "T", image: { src: "photo.jpg", alt: "A" }, image_side: "left" }]).html;
    expect(left.indexOf("feature-plate")).toBeLessThan(left.indexOf("feature-panel"));
    const right = render([{ type: "feature", title: "T", image: { src: "photo.jpg", alt: "A" }, image_side: "right", action_label: "Go", action_href: "/x" }]).html;
    expect(right.indexOf("feature-panel")).toBeLessThan(right.indexOf("feature-plate"));
    expect(right).toContain('<a class="btn btn-ghost" href="/x">Go</a>');
  });

  test("columns render two slots and refuse a hero inside", () => {
    const { html, warnings } = render([{ type: "columns", items: [{ type: "text", markdown: "a" }, { type: "hero", title: "h" }] }]);
    expect(html).toContain('<div class="block-two-col">');
    expect(html).toContain('<div class="block-col block-col-text">');
    expect(html).toContain('<div class="block-col"></div>');
    expect(warnings[0].path).toBe("blocks[0].items[1]");
  });

  test("raw html is verbatim and text is escaped", () => {
    const { html } = render([{ type: "raw_html", html: "{{ kept }} <b>x</b>" }, { type: "heading", title: "<script>" }]);
    expect(html).toContain("{{ kept }} <b>x</b>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("a relative picture inside markdown resolves through the resolver", () => {
    const { html } = render([{ type: "text", markdown: "![Inline](inline.jpg)" }]);
    expect(html).toContain('href="/post_x/inline.jpg"');
  });

  test("pageData translates meta into what a .md post's front matter carries", () => {
    const data = pageData(doc([], { category: ["B", "a"], author: "Me", updated: "2026-02-03" }), { slug: "post_x" });
    expect(data).toEqual({
      title: "T", date: "2026-01-02", description: "D", tags: ["a", "B"], category: [],
      draft: false, image: "/post_x/photo.jpg", author: "Me", updated: "2026-02-03",
    });
  });
});
