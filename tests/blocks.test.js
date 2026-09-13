/**
 * blocks/ — the page-builder document: catalogue, validator and renderer.
 *
 * Rendered against the memory resolver, so nothing here touches a project on
 * disk: what is under test is that a document produces the markup the site's
 * stylesheet expects, and that a broken document is reported at the field
 * that is broken rather than as an exception somewhere else.
 */
import { test, expect, describe } from "bun:test";
import { readFileSync } from "node:fs";

import { BLOCKS, BY_TYPE, defaultBlock, COLUMN_TYPES, fieldApplies } from "../eleventy_binary/lib/blocks/catalogue.js";
import { validatePost, assetRefs, verdict } from "../eleventy_binary/lib/blocks/validate.js";
import { renderPost, assetUrl, pageData } from "../eleventy_binary/lib/blocks/render.js";
import { cssLength, parseRatio } from "../eleventy_binary/lib/blocks/units.js";
import { tileLayout, tileNeed, balancedColumns } from "../eleventy_binary/lib/blocks/measure.js";
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

  // The editor's "Two columns" and "Split columns" move a block between the
  // page and a row as the same object. That is only lossless while no block
  // is judged by where it stands: whatever a column-safe block is on its own,
  // it must be in a column, finding for finding.
  test("a column-safe block is checked the same on its own and in a row", () => {
    const strip = (findings, prefix) =>
      findings.filter((f) => f.path.startsWith(prefix)).map((f) => `${f.level}:${f.path.slice(prefix.length)}:${f.message}`).sort();
    const filled = { type: "text", markdown: "a" };
    for (const type of COLUMN_TYPES) {
      const block = defaultBlock(type);
      const alone = strip(validatePost(doc([block, filled])), "blocks[0]");
      const inRow = strip(validatePost(doc([{ type: "columns", items: [block, filled] }])), "blocks[0].items[0]");
      expect(inRow).toEqual(alone);
    }
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

  test("an address copied out of the editor is an error; any other remote URL a warning", () => {
    const findings = validatePost(doc([{ type: "gallery", images: [
      { src: "http://127.0.0.1:8484/post_x/a_min.jpg", alt: "a" },
      { src: "https://example.org/b.jpg", alt: "b" },
    ] }]), { assets: [] });
    expect(findings.find((f) => f.path === "blocks[0].images[0].src").level).toBe("error");
    expect(findings.find((f) => f.path === "blocks[0].images[1].src").level).toBe("warn");
  });

  test("an empty column slot is reported as such, and renders as an empty slot", () => {
    const d = doc([{ type: "columns", items: [{ type: "text", markdown: "a" }, null] }]);
    const finding = validatePost(d).find((f) => f.path === "blocks[0].items[1]");
    expect(finding.message).toBe("column 2 is empty");
    const { html, warnings } = renderPost(d, { md, slug: "post_x", editable: true });
    expect(html).toContain('<div class="block-col" data-block="blocks[0].items[1]" data-block-type="empty"></div>');
    expect(warnings).toEqual([]);
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

  test("alternating words sets every other word in the gradient, across the break, in place of the accent", () => {
    const hero = (extra) => render([{ type: "hero", title: "Galdhøpiggen,\nin layers", accent: "layers", ...extra }]).html;
    expect(hero({ alternate: true })).toContain('<h1 class="display"><span class="text-flow">Galdhøpiggen,</span> <br class="hero-break">in <span class="text-flow">layers</span></h1>');
    // Off, or anything but true, is the accent exactly as before.
    expect(hero({ alternate: false })).toBe(hero({}));
    expect(hero({ alternate: "yes" })).toBe(hero({}));
  });

  test("an alternating title skips a dash, keeps words tied by a no-break space, and escapes each word", () => {
    const h1 = (title) => render([{ type: "hero", title, alternate: true }]).html.match(/<h1 class="display">(.*)<\/h1>/)[1];
    expect(h1("Rome — in winter")).toBe('<span class="text-flow">Rome</span> — in <span class="text-flow">winter</span>');
    expect(h1("in layers of ice")).toBe('<span class="text-flow">in layers</span> of <span class="text-flow">ice</span>');
    expect(h1("<Fish> & chips")).toBe('<span class="text-flow">&lt;Fish&gt;</span> &amp; chips');
    expect(h1("One")).toBe('<span class="text-flow">One</span>');
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

  test("the overlay feature lays the panel over the picture, at the picture's own proportions", () => {
    const { html, warnings } = render([{ type: "feature", eyebrow: "E", title: "T", text: "Body", image: { src: "photo.jpg", alt: "A", caption: "C" }, action_label: "Go", action_href: "/x" }]);
    expect(warnings).toEqual([]);
    // The overlay is the default layout. photo_min.jpg measures 800 × 600, and the plate carries that ratio.
    expect(html).toContain('<div class="feature-overlay feature-overlay-native">');
    expect(html).toContain('<div class="feature-overlay-visual art-plate fill" style="--ar:1.3333">');
    expect(html).toContain('<div class="feature-overlay-panel feature-panel glass-card panel-adaptive">');
    expect(html.indexOf("feature-overlay-visual")).toBeLessThan(html.indexOf("feature-overlay-panel"));
    expect(html).toContain('data-description="C"');
    expect(html).not.toContain("feature-plate");

    const right = render([{ type: "feature", title: "T", image: { src: "photo.jpg", alt: "A" }, image_side: "right" }]).html;
    expect(right).toContain('<div class="feature-overlay feature-overlay-native feature-overlay-flip">');
    // Flipped by the stylesheet; the picture stays first so the panel still paints over it.
    expect(right.indexOf("feature-overlay-visual")).toBeLessThan(right.indexOf("feature-overlay-panel"));

    // A picture that cannot be measured carries no ratio, and the stylesheet's 3:2 stands in.
    const unmeasured = render([{ type: "feature", title: "T", image: { src: "/image/unknown.jpg", alt: "A" } }]);
    expect(unmeasured.html).toContain('<div class="feature-overlay-visual art-plate fill">');
    expect(unmeasured.warnings.some((w) => w.path === "blocks[0].image")).toBe(true);
  });

  test("the beside feature puts the picture on the side asked for", () => {
    const left = render([{ type: "feature", layout: "beside", title: "T", image: { src: "photo.jpg", alt: "A" }, image_side: "left" }]).html;
    expect(left).toContain('<div class="block-two-col feature-row">');
    expect(left.indexOf("feature-plate")).toBeLessThan(left.indexOf("feature-panel"));
    const right = render([{ type: "feature", layout: "beside", title: "T", image: { src: "photo.jpg", alt: "A" }, image_side: "right", action_label: "Go", action_href: "/x" }]).html;
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

  test("editable markup carries block and picture paths; the build's does not", () => {
    const blocks = [{ type: "hero", title: "h" }, { type: "gallery", images: [{ src: "photo.jpg", alt: "A" }] }, { type: "columns", items: [{ type: "text", markdown: "a" }, { type: "text", markdown: "b" }] }];
    const plain = render(blocks).html;
    expect(plain).not.toContain("data-block");
    const editable = renderPost(doc(blocks), { md, slug: "post_x", editable: true }).html;
    expect(editable).toContain('<section class="hero-stage" data-block="blocks[0]" data-block-type="hero">');
    expect(editable).toContain('<section class="shell block block-gallery" data-block="blocks[1]" data-block-type="gallery">');
    expect(editable).toContain('data-image="blocks[1].images[0]"');
    expect(editable).toContain('<div class="block-col block-col-text" data-block="blocks[2].items[1]" data-block-type="text">');
  });

  test("pageData translates meta into what a .md post's front matter carries", () => {
    const data = pageData(doc([], { category: ["B", "a"], author: "Me", updated: "2026-02-03" }), { slug: "post_x" });
    expect(data).toEqual({
      title: "T", date: "2026-01-02", description: "D", tags: ["a", "B"], category: [],
      draft: false, image: "/post_x/photo.jpg", author: "Me", updated: "2026-02-03",
    });
  });

  test("a gallery picture's caption is its lightbox description; alt stands in without one", () => {
    const { html } = render([{ type: "gallery", images: [{ src: "photo.jpg", alt: "A", title: "T", caption: "C" }, { src: "tall.jpg", alt: "B" }] }]);
    expect(html).toContain('data-title="T" data-description="C"');
    expect(html).toContain('data-description="B"');
  });
});

describe("hero treatments", () => {
  const portrait = { src: "photo.jpg", alt: "A stair", title: "On the stairs", caption: "Plate 001 — a stairway." };
  const landscape = { src: "tall.jpg", alt: "A beach", title: "Onshore", caption: "Waves." };
  const below = [{ type: "text", markdown: "a" }, { type: "gallery", images: [{ src: "photo.jpg", alt: "A" }, { src: "tall.jpg", alt: "B" }] }];
  // The hero alone: everything up to the sentinel it ends with.
  const heroOf = (html) => html.slice(0, html.indexOf('<div class="hero-end"'));

  test("fields declare the treatments that use them, and name only real ones", () => {
    const hero = BY_TYPE.get("hero");
    const options = hero.fields.find((f) => f.name === "variant").options.map((o) => o.value);
    for (const f of hero.fields) {
      for (const v of [...(f.variants ?? []), ...(f.requiredFor ?? [])]) expect(options).toContain(v);
    }
    const field = (name) => hero.fields.find((f) => f.name === name);
    expect(fieldApplies(hero, field("image"), { variant: "stage" })).toBe(false);
    expect(fieldApplies(hero, field("image"), {})).toBe(false); // the default is the stage
    expect(fieldApplies(hero, field("image"), { variant: "salon" })).toBe(true);
    expect(fieldApplies(hero, field("image_2"), { variant: "collage" })).toBe(true);
    expect(fieldApplies(hero, field("image_2"), { variant: "salon" })).toBe(false);
    expect(fieldApplies(hero, field("inscription"), { variant: "salon" })).toBe(true);
  });

  test("an unknown treatment is an error, not a quiet stage; other selects still only warn", () => {
    const hero = validatePost(doc([{ type: "hero", variant: "cinema", title: "x" }]));
    expect(hero.some((f) => f.level === "error" && f.path === "blocks[0].variant")).toBe(true);
    const gallery = validatePost(doc([{ type: "gallery", layout: "grid", images: [{ src: "photo.jpg", alt: "a" }] }]));
    expect(gallery.find((f) => f.path === "blocks[0].layout").level).toBe("warn");
  });

  test("the collage and the salon need their portrait; the collage wants its landscape", () => {
    for (const variant of ["collage", "salon"]) {
      const findings = validatePost(doc([{ type: "hero", variant, title: "x" }]));
      expect(findings.some((f) => f.level === "error" && f.path === "blocks[0].image")).toBe(true);
    }
    const collage = validatePost(doc([{ type: "hero", variant: "collage", title: "x", image: portrait }]));
    expect(collage.some((f) => f.level === "warn" && f.path === "blocks[0].image_2")).toBe(true);
    expect(verdict(validatePost(doc([{ type: "hero", variant: "salon", title: "x", image: portrait }]), { assets: ["photo.jpg"] }))).not.toBe("error");
  });

  test("a field the treatment does not use is not checked, and names no file", () => {
    const stage = { type: "hero", variant: "stage", title: "x", image: { src: "gone.jpg" }, image_2: { src: "gone.jpg" } };
    const findings = validatePost(doc([stage]), { assets: ["photo.jpg"] });
    expect(findings.filter((f) => f.path.startsWith("blocks[0]"))).toEqual([]);
    expect(assetRefs(doc([stage])).map((r) => r.path)).toEqual(["meta.image"]);
  });

  test("the collage renders every piece the stylesheet finds by name, and fills them from the page", () => {
    const { html, warnings } = render([
      { type: "hero", variant: "collage", eyebrow: "E", title: "A page\nthat overlaps", accent: "overlaps", image: portrait, image_2: landscape },
      ...below,
    ]);
    expect(warnings).toEqual([]);
    const hero = heroOf(html);
    for (const piece of [
      "hero-stage collage-stage", "shell collage-shell", "collage", "collage-portrait", "collage-landscape",
      "collage-panel hero-copy glass-card glass-card-solid panel-adaptive", "collage-block ink-panel panel-adaptive",
      "collage-stamp paper-panel", "collage-rule",
    ]) {
      expect(hero).toContain(`class="${piece}"`);
    }
    expect(hero.match(/<h1\b/g)).toHaveLength(1);
    // The portrait is the full-size file behind the lightbox, its caption the slide's description…
    expect(hero).toContain('<a class="glightbox" href="/post_x/photo.jpg" data-gallery="hero" data-title="On the stairs" data-description="Plate 001 — a stairway.">');
    expect(hero).toContain('<img src="/post_x/photo.jpg" alt="A stair" width="1600" height="1200" loading="eager"');
    // …and the landscape, small on every screen, loads its counterpart.
    expect(hero).toContain('<img src="/post_x/tall_min.jpg" alt="A beach" width="600" height="900" loading="eager"');
    // Worked out from the page: two sections below, the caption, the date, the first subject, four plates.
    expect(hero).toContain('<p class="display collage-count">02</p>');
    expect(hero).toContain('<p class="collage-note">Plate 001 — a stairway.</p>');
    expect(hero).toContain('<p class="display-sm collage-stamp-value">02.01.2026</p>');
    expect(hero).toContain('<p class="micro collage-stamp-sub">a</p>');
    expect(hero).toContain('<span class="micro">Sections 01 — 02</span>');
    expect(hero).toContain('<span class="micro">2026 · 4 plates</span>');
    expect(hero.match(/<span style="flex:\d+"><\/span>/g)).toHaveLength(2);
    expect(html).toContain('<div class="hero-end" id="hero-end"></div>');
  });

  test("the salon hangs the portrait, counts the plates and engraves the date in Roman numerals", () => {
    const { html, warnings } = renderPost(
      doc([{ type: "hero", variant: "salon", title: "A quiet room\nin gilded light", accent: "gilded light", image: portrait }, ...below]),
      { md, slug: "post_x", site: { author: "H. Revery" } },
    );
    expect(warnings).toEqual([]);
    const hero = heroOf(html);
    for (const piece of [
      "hero-stage salon-stage", "block-two-col", "hero-copy", "hero-in salon-frame", "paper-panel salon-mount",
      "art-plate fill salon-plate", "paper-panel salon-stamp", "micro hero-in salon-plate-caption", "hero-in salon-rule",
    ]) {
      expect(hero).toContain(`class="${piece}"`);
    }
    // Every piece is placed by a class, so the theme can reach it.
    expect(hero).not.toContain("style=");
    expect(hero).toContain('<span class="text-flow">gilded light</span>');
    expect(hero).toContain('<p class="display-sm">III</p>');
    expect(hero).toContain("Plate I — On the stairs");
    expect(hero).toContain('<p class="micro">H. Revery · II.I.MMXXVI · a</p>');
  });

  test("the salon's engraved line is the block's own when it has one; the post's author beats the site's", () => {
    const hero = { type: "hero", variant: "salon", title: "x", image: portrait };
    expect(render([{ ...hero, inscription: "Set in <gold>" }]).html).toContain('<p class="micro">Set in &lt;gold&gt;</p>');
    const own = renderPost(doc([hero], { author: "Me" }), { md, slug: "post_x", site: { author: "Site" } }).html;
    expect(own).toContain('<p class="micro">Me · II.I.MMXXVI · a</p>');
    // One plate is not a count worth hanging a stamp for.
    expect(own).not.toContain("salon-stamp");
  });

  test("the collage's stamp line and the salon's plate label are the block's own when set", () => {
    const collage = heroOf(render([{ type: "hero", variant: "collage", title: "x", image: portrait, image_2: landscape, stamp: "Var. 02" }]).html);
    expect(collage).toContain('<p class="micro collage-stamp-sub">Var. 02</p>');

    const salon = heroOf(render([{ type: "hero", variant: "salon", title: "x", image: portrait, plate: "Fig. 3" }]).html);
    expect(salon).toContain('<p class="micro hero-in salon-plate-caption">Fig. 3 — On the stairs</p>');
    expect(salon).not.toContain("Plate I");

    // A typed label stands alone when the portrait has no title; the default does not.
    const untitled = { src: "photo.jpg", alt: "A" };
    expect(heroOf(render([{ type: "hero", variant: "salon", title: "x", image: untitled, plate: "Fig. 3" }]).html)).toContain('salon-plate-caption">Fig. 3</p>');
    expect(heroOf(render([{ type: "hero", variant: "salon", title: "x", image: untitled }]).html)).not.toContain("salon-plate-caption");
  });

  test("a stage hero ignores a picture left behind from another treatment", () => {
    const { html } = render([{ type: "hero", variant: "stage", title: "x", image: portrait, image_2: landscape }]);
    expect(html).not.toContain("photo.jpg");
    expect(html).not.toContain("tall");
  });
});

describe("full-width blocks", () => {
  const ground = { src: "photo.jpg", alt: "", title: "", caption: "" };
  const notes = (n) => Array.from({ length: n }, (_, i) => ({ label: `L${i + 1}`, title: `T${i + 1}`, text: `Body ${i + 1}` }));
  const tiles = (n) => Array.from({ length: n }, (_, i) => ({ label: `K${i + 1}`, text: `V${i + 1}` }));

  test("bleed blocks stay out of columns, and every records field is bounded and names its entries", () => {
    const bleed = BLOCKS.filter((b) => b.bleed).map((b) => b.type);
    expect(bleed).toEqual(["stage_notes", "stage_wash"]);
    for (const type of bleed) expect(COLUMN_TYPES).not.toContain(type);
    for (const spec of BLOCKS) {
      for (const f of spec.fields.filter((x) => x.kind === "records")) {
        expect(f.min).toBeLessThanOrEqual(f.max);
        expect(f.item.length).toBeGreaterThan(0);
        expect(f.itemLabel).toBeTruthy();
      }
    }
  });

  test("a new block starts with its minimum of empty entries, and never shares a list", () => {
    const a = defaultBlock("stage_notes");
    expect(a.notes).toEqual([{ label: "", title: "", text: "" }]);
    const b = defaultBlock("stage_notes");
    a.notes.push({});
    expect(b.notes).toHaveLength(1);
    expect(defaultBlock("stage_wash").tiles).toEqual([{ label: "", text: "" }]);
  });

  test("one to five notes and one to six tiles; outside that is an error at the list", () => {
    const check = (block) => validatePost(doc([block]), { assets: ["photo.jpg"] });
    const at = (findings, path) => findings.some((f) => f.level === "error" && f.path === path);
    for (const n of [1, 5]) expect(verdict(check({ type: "stage_notes", title: "x", image: ground, notes: notes(n) }))).not.toBe("error");
    for (const n of [1, 6]) expect(verdict(check({ type: "stage_wash", title: "x", image: ground, tiles: tiles(n) }))).not.toBe("error");
    expect(at(check({ type: "stage_notes", title: "x", image: ground, notes: notes(6) }), "blocks[0].notes")).toBe(true);
    expect(at(check({ type: "stage_wash", title: "x", image: ground, tiles: tiles(7) }), "blocks[0].tiles")).toBe(true);
    expect(at(check({ type: "stage_notes", title: "x", image: ground, notes: [] }), "blocks[0].notes")).toBe(true);
  });

  test("an entry is reported at its key", () => {
    const findings = validatePost(doc([
      { type: "stage_notes", title: "x", image: ground, notes: [{ label: "a", title: "t" }, { label: "b", title: " " }, "loose"] },
      { type: "stage_wash", title: "x", image: ground, tiles: [{ label: "only a label" }, { text: 3 }] },
    ]));
    const errors = findings.filter((f) => f.level === "error").map((f) => `${f.path}: ${f.message}`);
    expect(errors).toContain("blocks[0].notes[1].title: note 2 has no heading");
    expect(errors).toContain("blocks[0].notes[2]: note 3 is not an object");
    expect(errors).toContain("blocks[1].tiles[0].text: tile 1 has no text");
    expect(errors).toContain('blocks[1].tiles[1].text: "text" must be text');
  });

  test("the ground is required, is asked for no alt text, and is not one of the page's plates", () => {
    const missing = validatePost(doc([{ type: "stage_wash", title: "x", tiles: tiles(1) }]));
    expect(missing.some((f) => f.level === "error" && f.path === "blocks[0].image")).toBe(true);
    const band = { type: "stage_notes", title: "x", image: ground, notes: notes(1) };
    expect(validatePost(doc([band]), { assets: ["photo.jpg"] }).filter((f) => f.path.startsWith("blocks[0]"))).toEqual([]);
    expect(assetRefs(doc([band])).find((r) => r.path === "blocks[0].image.src").decorative).toBe(true);
    // A collage counts the pictures on the page; a band's ground is not one of them.
    const { html } = render([{ type: "hero", variant: "collage", title: "x", image: { src: "photo.jpg", alt: "A" } }, band]);
    expect(html).toContain('<span class="micro">2026 · 1 plate</span>');
  });

  test("field notes run the full width: the ground behind a shell, and the notes numbered", () => {
    const { html, warnings } = render([{ type: "stage_notes", eyebrow: "E", title: "Jotunheimen,\nfrom the top", image: { ...ground, alt: "not printed" }, notes: notes(3) }]);
    expect(warnings).toEqual([]);
    expect(html.startsWith('<section class="block-bleed block-stage_notes photo-stage photo-stage-adaptive">')).toBe(true);
    expect(html).not.toContain("shell block");
    expect(html).toContain('<div class="stage-media"><img src="/post_x/photo.jpg" alt="" width="1600" height="1200" loading="lazy" decoding="async"></div>');
    expect(html).toContain('<div class="shell bleed-shell">');
    expect(html).toContain('<p class="eyebrow">E</p>\n<h2 class="display-md bleed-title">Jotunheimen,<br>from the top</h2>');
    expect(html).toContain('<div class="panel-field bleed-body">');
    expect(html.match(/<article class="glass-card note-card">/g)).toHaveLength(3);
    expect(html).toContain('<p class="micro">Note 01 · L1</p>\n<h3>T1</h3>\n<p class="note-text">Body 1</p>');
    expect(html).not.toContain("glightbox");
  });

  test("never more entries than the layout is drawn for, even from a hand-edited file", () => {
    expect(render([{ type: "stage_notes", title: "x", image: ground, notes: notes(7) }]).html.match(/note-card/g)).toHaveLength(5);
    expect(render([{ type: "stage_wash", title: "x", image: ground, tiles: tiles(9) }]).html.match(/stat-tile-text/g)).toHaveLength(6);
    const plain = render([{ type: "stage_notes", title: "x", image: ground, notes: [{ title: "Unlabelled", text: "One.\n\nTwo." }] }]).html;
    expect(plain).toContain('<p class="micro">Note 01</p>');
    expect(plain).toContain('<p class="note-text">One.</p>\n<p class="note-text">Two.</p>');
  });

  test("the wash sets the quote beside the tiles, or the tiles alone at full width", () => {
    const both = render([{ type: "stage_wash", eyebrow: "E", title: "Fog is a\nblend mode", accent: "blend mode", image: ground, quote: "Fog <does>\nthis.", tiles: tiles(4) }]).html;
    expect(both).toContain('<section class="block-bleed block-stage_wash photo-stage photo-stage-adaptive">');
    expect(both).toContain('<h2 class="display bleed-title">Fog is a<br><span class="text-flow">blend mode</span></h2>');
    expect(both).toContain('<div class="block-two-col bleed-pair bleed-body">\n<blockquote class="bleed-quote">Fog &lt;does&gt;<br>this.</blockquote>');
    expect(both).toContain('<div class="stat-grid stat-grid-glass stat-grid-fit" style="--cols:2">');
    expect(both).toContain('<div>\n<p class="micro">K1</p>\n<p class="stat-tile-text">V1</p>\n</div>');
    const alone = render([{ type: "stage_wash", title: "x", image: ground, tiles: [{ text: "No label" }] }]).html;
    expect(alone).not.toContain("block-two-col");
    expect(alone).not.toContain("blockquote");
    expect(alone).toContain('<div class="bleed-body">\n<div class="stat-grid stat-grid-glass stat-grid-fit" style="--cols:2">\n<div>\n<p class="stat-tile-text">No label</p>\n</div>');
  });

  test("the wash's tiles are two or three to a row; three beside a quote take the wider share", () => {
    const wash = (extra) => render([{ type: "stage_wash", title: "x", image: ground, quote: "q", tiles: tiles(6), ...extra }]).html;
    expect(wash({})).toContain('<div class="block-two-col bleed-pair bleed-body">');
    const three = wash({ tile_columns: "3" });
    expect(three).toContain('<div class="block-two-col bleed-pair bleed-pair-wide bleed-body">');
    expect(three).toContain('<div class="stat-grid stat-grid-glass stat-grid-fit" style="--cols:3">');
    // With no quote there is no pair to widen.
    const alone = wash({ tile_columns: "3", quote: "" });
    expect(alone).toContain('<div class="bleed-body">\n<div class="stat-grid stat-grid-glass stat-grid-fit" style="--cols:3">');
    expect(alone).not.toContain("bleed-pair");
    // A count this build does not know is a warning, and two stands in.
    expect(wash({ tile_columns: "4" })).toContain('style="--cols:2"');
    const findings = validatePost(doc([{ type: "stage_wash", title: "x", image: ground, tiles: tiles(1), tile_columns: "4" }]));
    expect(findings.find((f) => f.path === "blocks[0].tile_columns").level).toBe("warn");
  });

  test("an accent missing from a band's heading is a warning, as on the hero", () => {
    const findings = validatePost(doc([{ type: "stage_wash", title: "Fog", accent: "mist", image: ground, tiles: tiles(1) }]));
    expect(findings.some((f) => f.level === "warn" && f.path === "blocks[0].accent")).toBe(true);
  });

  test("the accent is judged as the renderer matches it: trimmed, and within one line", () => {
    const accentFindings = (title, accent, extra = {}) =>
      validatePost(doc([{ type: "hero", title, accent, ...extra }])).filter((f) => f.path === "blocks[0].accent");
    // A stray space is trimmed by the renderer, which still highlights.
    expect(accentFindings("Galdhøpiggen,\nin layers", " in layers ")).toEqual([]);
    // Across a line break the renderer finds nothing, so that is the warning.
    expect(accentFindings("Galdhøpiggen,\nin layers", "Galdhøpiggen,\nin").map((f) => f.level)).toEqual(["warn"]);
    // With alternating words on, the accent is set aside, and a note says so.
    expect(accentFindings("Galdhøpiggen", "missing", { alternate: true }).map((f) => f.level)).toEqual(["note"]);
  });

  test("a band alternates its heading's words the way the hero does", () => {
    const html = render([{ type: "stage_wash", title: "Fog is a\nblend mode", accent: "blend mode", alternate: true, image: ground, tiles: tiles(1) }]).html;
    expect(html).toContain('<h2 class="display bleed-title"><span class="text-flow">Fog</span> is <span class="text-flow">a</span><br>blend <span class="text-flow">mode</span></h2>');
    const findings = validatePost(doc([{ type: "stage_wash", title: "x", alternate: "yes", image: ground, tiles: tiles(1) }]));
    expect(findings.find((f) => f.path === "blocks[0].alternate").level).toBe("warn");
  });

  test("a band is refused in a column, and carries its path for the canvas", () => {
    const refused = validatePost(doc([{ type: "columns", items: [{ type: "text", markdown: "a" }, { type: "stage_wash", title: "x", image: ground, tiles: tiles(1) }] }]));
    expect(refused.some((f) => f.level === "error" && f.path === "blocks[0].items[1]")).toBe(true);
    const editable = renderPost(doc([{ type: "stage_notes", title: "x", image: ground, notes: notes(1) }]), { md, slug: "post_x", editable: true }).html;
    expect(editable).toContain('<section class="block-bleed block-stage_notes photo-stage photo-stage-adaptive" data-block="blocks[0]" data-block-type="stage_notes">');
  });

  test("an unmeasurable ground is a warning, not a crash", () => {
    const { html, warnings } = render([{ type: "stage_notes", title: "x", image: { src: "/image/unknown.jpg" }, notes: notes(1) }]);
    expect(html).toContain('<img src="/image/unknown.jpg" alt="" loading="lazy" decoding="async">');
    expect(warnings[0].path).toBe("blocks[0].image");
  });
});

describe("tile grid", () => {
  // block_test_page.html's "Extended readout", word for word.
  const HAND = [
    ["Ground", "Blueprint grid", ".editorial-grid, promoted from wallpaper to the design itself."],
    ["Accent", "Cool spectrum", "--grad-cool re-inks the masthead word; the dots mix its own pigments."],
    ["Surface", "Glass console", "One .paper-panel, blurred, bordered and dressed as an instrument."],
    ["Voice", "Mono throughout", "The readout speaks in Harald Revery Mono at --step--2, all caps."],
    ["Motion", "One rule, pulsing", ".rule-grad pans the spectrum; everything else on the stage is still."],
    ["Scheme", "Both, always", "Every colour is a token; switch the system setting and the console follows."],
  ].map(([label, title, text]) => ({ label, title, text }));
  const short = (n) => Array.from({ length: n }, (_, i) => ({ label: `L${i}`, title: `Tile ${i}`, text: "A short line." }));
  const medium = (n) => Array.from({ length: n }, (_, i) => ({ label: "Medium", title: `Tile ${i}`, text: "word ".repeat(30).trim() }));
  const long = (n) => Array.from({ length: n }, (_, i) => ({ label: "Long", title: `Tile ${i}`, text: "word ".repeat(40).trim() }));

  test("the count comes from how much the tiles say, and leaves no tile alone on a wide screen", () => {
    const cols = (tiles, choice) => tileLayout(tiles, choice).columns;
    expect(cols(HAND)).toBe(6); // the hand block itself is 5 + 1 at a 1440 window
    expect(cols(long(6))).toBe(3);
    expect(cols(short(8))).toBe(4);
    expect(cols(short(7))).toBe(4);
    expect(cols(short(5))).toBe(5);
    expect(cols(medium(10))).toBe(5);
    expect(cols(short(12))).toBe(6);
    expect(cols(short(9))).toBe(3);
    expect(cols(short(3))).toBe(3);
    expect(cols(short(2))).toBe(2); // fewer than three tiles: one row of them
  });

  test("balancing keeps three to six and prefers no empty cells, the most columns on a tie", () => {
    expect(balancedColumns(6, 5)).toBe(3);
    expect(balancedColumns(6, 2)).toBe(3);
    expect(balancedColumns(11, 6)).toBe(6);
  });

  test("a long heading word widens the tile; the minimum always lets the chosen count fit", () => {
    expect(tileNeed({ title: "Internationalisation" }, 0)).toBeGreaterThan(280);
    const wide = tileLayout([...short(5), { title: "Internationalisation" }]);
    expect(wide).toMatchObject({ columns: 3, tileMin: 18 });
    // The author's six, on text too long for six, still fits six in the reference window…
    const forced = tileLayout(long(6), "6");
    expect(forced.columns).toBe(6);
    expect(forced.tileMin * 16 * 6).toBeLessThanOrEqual(1360);
    // …and a count past the tiles is the tiles.
    expect(tileLayout(short(4), "6").columns).toBe(4);
  });

  test("renders the hand block's shape, numbered, with the grid's count on it", () => {
    const { html, warnings } = render([{ type: "tile_grid", eyebrow: "Extended readout", title: "The page, in six instruments", lede: "L", tiles: HAND }]);
    expect(warnings).toEqual([]);
    expect(html).toContain('<section class="shell block block-tile_grid">');
    expect(html).toContain('<p class="eyebrow">Extended readout</p>\n<h2 class="display-md block-title">The page, in six instruments</h2>');
    expect(html).toContain('<div class="stat-grid stat-grid-fit tile-grid" style="--cols:6;--tile-min:13rem">');
    expect(html).toContain('<div>\n<p class="micro tile-label">01 · Ground</p>\n<p class="display-sm tile-title">Blueprint grid</p>\n<p class="tile-text">.editorial-grid, promoted from wallpaper to the design itself.</p>\n</div>');
    expect(html.match(/tile-label/g)).toHaveLength(6);
    expect(render([{ type: "tile_grid", tile_columns: "3", tiles: HAND }]).html).toContain('style="--cols:3;--tile-min:13rem"');
    const bare = render([{ type: "tile_grid", tiles: [{ title: "A" }, { title: "B" }, { title: "C" }] }]).html;
    expect(bare).toContain('<p class="micro tile-label">01</p>');
    expect(bare).toContain('<section class="shell block block-tile_grid">\n<div class="stat-grid');
  });

  test("three to twelve tiles, each with a heading, and never in a column", () => {
    const check = (tiles, extra = {}) => validatePost(doc([{ type: "tile_grid", tiles, ...extra }]));
    expect(check(short(2)).some((f) => f.level === "error" && f.path === "blocks[0].tiles")).toBe(true);
    expect(check(short(13)).some((f) => f.level === "error" && f.path === "blocks[0].tiles")).toBe(true);
    expect(verdict(check(short(12)))).not.toBe("error");
    expect(check([...short(2), { label: "x" }]).map((f) => f.message)).toContain("tile 3 has no heading");
    expect(check(short(3), { tile_columns: "7" }).find((f) => f.path === "blocks[0].tile_columns").level).toBe("warn");
    expect(COLUMN_TYPES).not.toContain("tile_grid");
  });
});

describe("uniform gallery ratio and height", () => {
  const images = [{ src: "photo.jpg", alt: "A" }, { src: "/svg/mark.svg", alt: "M" }];
  const grid = (extra) => /<div class="gallery [^"]*"[^>]*>/.exec(render([{ type: "gallery", layout: "uniform", images, ...extra }]).html)[0];

  test("left empty, it is the square grid it always was", () => {
    expect(grid({})).toBe('<div class="gallery gallery-uniform" style="--gallery-gap:0.75rem">');
  });

  test("a ratio is carried on the grid, in any of the ways it is written", () => {
    expect(grid({ ratio: "3:2" })).toBe('<div class="gallery gallery-uniform" style="--gallery-gap:0.75rem;--tile-ar:1.5">');
    expect(grid({ ratio: "4/5" })).toContain("--tile-ar:0.8");
    expect(grid({ ratio: "16 x 9" })).toContain("--tile-ar:1.7778");
    expect(grid({ ratio: "1.25" })).toContain("--tile-ar:1.25");
  });

  test("a row height is carried with the picture count, so a short gallery can stop growing", () => {
    expect(grid({ ratio: "3:2", height: "12rem", gap: "4px" }))
      .toBe('<div class="gallery gallery-uniform gallery-uniform-sized" style="--gallery-gap:4px;--tile-ar:1.5;--tile-h:12rem;--tile-count:2">');
    // No height, no count: the count only matters to a sized grid.
    expect(grid({ ratio: "3:2" })).not.toContain("--tile-count");
  });

  test("what cannot be read is left out of the page and warned about at its field", () => {
    const bad = { ratio: "wide", height: "50%", gap: "12" };
    expect(grid(bad)).toBe('<div class="gallery gallery-uniform" style="--gallery-gap:0.75rem">');
    const findings = validatePost(doc([{ type: "gallery", layout: "uniform", images, ...bad }]));
    for (const at of ["ratio", "height", "gap"]) {
      expect(findings.find((f) => f.path === `blocks[0].${at}`)?.level).toBe("warn");
    }
    // Past 5:1 a cell is a strip, and zero is no height at all.
    expect(grid({ ratio: "6:1", height: "0rem" })).toBe('<div class="gallery gallery-uniform" style="--gallery-gap:0.75rem">');
  });

  test("ratio and height belong to the uniform layout: elsewhere they are hidden, unchecked and unrendered", () => {
    const gallery = BY_TYPE.get("gallery");
    const field = (name) => gallery.fields.find((f) => f.name === name);
    expect(fieldApplies(gallery, field("ratio"), { layout: "uniform" })).toBe(true);
    expect(fieldApplies(gallery, field("ratio"), { layout: "justified" })).toBe(false);
    expect(fieldApplies(gallery, field("height"), {})).toBe(false); // justified is the default
    const justified = { type: "gallery", layout: "justified", ratio: "junk", height: "junk", images };
    expect(validatePost(doc([justified])).some((f) => /ratio|height/.test(f.path))).toBe(false);
    expect(render([justified]).html).not.toContain("--tile");
  });

  test("units read lengths and ratios narrowly", () => {
    expect(cssLength("0.75rem")).toBe("0.75rem");
    expect(cssLength("50%")).toBe("50%");
    expect(cssLength("50%", { percent: false })).toBe(null);
    expect(cssLength("0px", { positive: true })).toBe(null);
    expect(cssLength("12")).toBe(null);
    expect(cssLength("1rem; color:red")).toBe(null);
    expect(parseRatio("3:2")).toBe(1.5);
    expect(parseRatio("1:5")).toBe(0.2);
    expect(parseRatio("1:6")).toBe(null);
    expect(parseRatio("3:0")).toBe(null);
    expect(parseRatio("")).toBe(null);
  });
});

describe("the stylesheet", () => {
  /*
   * Every class the renderer writes is styled by css/main.css, or is a hook
   * the contract names: block-<type> and block-col-<type> on every block, so
   * the theme can reach one kind without the renderer's help. A class added to
   * the renderer and to css/input.css without update_css.sh being run fails
   * here, instead of shipping a block with no styles.
   */
  const HOOKS = new Set([
    ...BLOCKS.flatMap((b) => [`block-${b.type}`, `block-col-${b.type}`]),
    "block-col", // a column's wrapper, which the editor's canvas finds by name
    "glightbox", // the lightbox script's hook; css/glightbox.min.css styles it
  ]);
  const img = (src, alt = "A") => ({ src, alt, title: "T", caption: "C" });
  const pages = [
    ...["stage", "photo", "photo_adaptive", "collage", "salon"].map((variant) => [
      { type: "hero", variant, eyebrow: "E", title: "A\nB", accent: "B", lede: "L", image: img("photo.jpg"), image_2: img("tall.jpg"), actions: [{ label: "a", href: "/a" }, { label: "b", href: "/b" }] },
      { type: "text", markdown: "a" },
    ]),
    [
      { type: "heading", eyebrow: "E", title: "H" },
      { type: "gallery", title: "G", lede: "L", layout: "justified", images: [img("photo.jpg"), img("clip.mp4")] },
      { type: "gallery", layout: "uniform", images: [img("photo.jpg"), img("/svg/mark.svg")] },
      { type: "gallery", layout: "uniform", ratio: "3:2", height: "12rem", images: [img("photo.jpg")] },
      { type: "stage_wash", title: "T", image: img("photo.jpg", ""), quote: "q", tile_columns: "3", tiles: [{ label: "l", text: "x" }] },
      { type: "tile_grid", eyebrow: "E", title: "T", lede: "L", tiles: [1, 2, 3].map((n) => ({ label: `l${n}`, title: `t${n}`, text: "x" })) },
      { type: "gallery", layout: "waterfall", images: [img("photo.jpg")] },
      { type: "video", eyebrow: "E", title: "V", src: "clip.mp4", meta: ["1:00"], caption: "c" },
      { type: "audio", eyebrow: "E", title: "A", src: "/audio/a.wav", meta: ["0:01"], caption: "c" },
      { type: "download", eyebrow: "E", src: "a.zip", note: "n" },
      { type: "faq", title: "F", items: [{ question: "Q", answer: "A" }] },
      { type: "feature", eyebrow: "E", title: "T", text: "x", image: img("photo.jpg"), action_label: "Go", action_href: "/x" },
      { type: "feature", layout: "beside", title: "T", image: img("photo.jpg"), image_side: "right" },
      { type: "stage_notes", eyebrow: "E", title: "T", image: img("photo.jpg", ""), notes: [{ label: "l", title: "t", text: "x" }] },
      { type: "stage_wash", eyebrow: "E", title: "T", accent: "T", image: img("photo.jpg", ""), quote: "q", tiles: [{ label: "l", text: "x" }] },
      { type: "columns", items: [{ type: "text", markdown: "a" }, { type: "faq", items: [{ question: "Q", answer: "A" }] }] },
    ],
  ];

  test("styles every class the renderer writes", () => {
    const css = readFileSync(new URL("../css/main.css", import.meta.url), "utf8");
    const defined = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]));
    const written = new Set();
    for (const blocks of pages) {
      for (const [, list] of render(blocks).html.matchAll(/class="([^"]*)"/g)) {
        for (const name of list.split(/\s+/)) if (name) written.add(name);
      }
    }
    expect([...written].filter((name) => !defined.has(name) && !HOOKS.has(name)).sort()).toEqual([]);
  });
});
