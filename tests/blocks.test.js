/**
 * blocks/ — the page-builder document: catalogue, validator and renderer.
 *
 * Rendered against the memory resolver, so nothing here touches a project on
 * disk: what is under test is that a document produces the markup the site's
 * stylesheet expects, and that a broken document is reported at the field
 * that is broken rather than as an exception somewhere else.
 */
import { test, expect, describe } from "bun:test";

import { BLOCKS, BY_TYPE, defaultBlock, COLUMN_TYPES, fieldApplies } from "../eleventy_binary/lib/blocks/catalogue.js";
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
