/**
 * The Eleventy configuration, shared by two callers.
 *
 *   eleventy.config.js      — for `npx @11ty/eleventy` during development
 *   eleventy_binary/build.mjs — for the compiled site_generate binary
 *
 * Keeping it in one module means the binary and the dev server can never drift
 * apart. Nothing here reads a path relative to this file, because inside the
 * compiled binary that path does not exist; everything resolves from cwd.
 */
import fs from "node:fs";
import path from "node:path";

import log from "./log.js";
import { loadSettings } from "./settings.js";
import { getRegistry } from "./slugs.js";
import { createMarkdownLibrary, outlineFor } from "./markdown.js";
import { headingSlug, escapeHtml } from "./paths.js";
import { imageSize, resolveThumbnail, THUMBNAIL_ROOTS } from "./imagesize.js";
import { injectAssets } from "./assets.js";
import { rfc822Date, toDate } from "./format.js";
import { stripFrontMatter } from "./front_matter.js";

/**
 * Directories copied verbatim into _site.
 *
 * Only the fallback: the real list comes from `asset_folders` in
 * site_settings.json, so adding a folder of your own (photos/, sketches/, …)
 * is a settings change rather than a code change.
 */
const PASSTHROUGH_DIRS = [
  "image",
  "image_min",
  "card_thumbnail",
  "svg",
  "font",
  "javascript",
  "video",
  "gif",
  "audio",
];

/** Everything at the project root that is not site content. */
const IGNORED = [
  "node_modules/**",
  "node_modules.off/**",
  "_site/**",
  // Any scratch copy of the output — a backup taken before a risky build must
  // not become input on the next one.
  "_site*/**",
  "eleventy_binary/**",
  "eleventy_settings/**",
  "inspiration/**",
  "licence_and_legal/**",
  "css/**",
  "font/**",
  "image/**",
  "image_min/**",
  "svg/**",
  "icon/**",
  "video/**",
  "gif/**",
  "audio/**",
  "card_thumbnail/**",
  "javascript/**",
  "pagebuilder_app/**",
];

const isoDate = (value) => {
  const date = toDate(value);
  return date ? date.toISOString().slice(0, 10) : "";
};

/**
 * A page's date as a sortable number, with undated pages given a value every
 * real date beats. Kept apart from isoDate so that "no date" stays a single
 * definite position in the order instead of a hole in it.
 */
const postTime = (value) => toDate(value)?.getTime() ?? Number.NEGATIVE_INFINITY;

/**
 * `locale` is a full BCP-47 tag from site_settings.json, not the bare language
 * code: "de" and "de-GB" are different date orders, and deriving one from the
 * other by string concatenation produced tags nobody chose.
 */
const humanDate = (value, locale = "en-GB") => {
  const date = toDate(value);
  if (!date) return "";
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
};

/**
 * Build the Eleventy config function.
 *
 * @param {object} options
 * @param {boolean} options.includeDrafts  publish `draft: true` pages too
 * @param {string}  options.root           project root (defaults to cwd)
 * @param {string}  options.outputDir      where pages are written, relative to
 *   root. Configurable because the binary renders into a staging directory and
 *   swaps it into place only once the build has succeeded; the dev server keeps
 *   the default. Whatever it is called, it is added to `ignores` below, so the
 *   output of one build can never become the input of the next.
 */
export function createConfig({
  includeDrafts = false,
  root = process.cwd(),
  outputDir = "_site",
} = {}) {
  const settings = loadSettings(root);
  const registry = getRegistry(root);
  const md = createMarkdownLibrary(root);

  /**
   * Tag -> the slug its subject page is published under.
   *
   * One table, read by both routes from a tag to its URL: the tagList
   * collection, which supplies blog-tag.njk's permalink and the chips in
   * tag_filter.njk, and the tagSlug filter, which card.njk and post.njk use to
   * link a post's own tags. Deriving the slug independently on each side worked
   * only while headingSlug was injective — and it is not, because it strips
   * punctuation: "C++" and "C#" both reduce to "c". Deduplicating on one side
   * alone would have been worse than the crash it replaced, pointing every C#
   * chip at the C++ page with no broken link for the status check to find.
   */
  const tagSlugs = new Map();

  /**
   * Fill that table, resolving collisions by suffix.
   *
   * Assigned in code-unit order of the tag itself, never in the order the
   * subject list is displayed in. That list is sorted by how many entries carry
   * each tag, so tying the slugs to it would let publishing one post reshuffle
   * which tag keeps the bare URL — silently breaking every link to the one that
   * lost it. Tag text is the only input here that does not move.
   */
  const assignTagSlugs = (tags) => {
    tagSlugs.clear();
    const taken = new Set();

    for (const tag of [...tags].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
      const desired = headingSlug(tag);
      let slug = desired;
      let suffix = 1;

      while (taken.has(slug)) {
        suffix += 1;
        slug = `${desired}-${suffix}`;
      }

      if (slug !== desired) {
        log.warn(
          "tags",
          `two subjects reduce to the same URL name "${desired}"`,
          `"${tag}" is published at /blog_tag_${slug}.html instead`,
        );
      }

      taken.add(slug);
      tagSlugs.set(tag, slug);
    }
  };

  return function configure(eleventyConfig) {
    /* ------------------------------------------------------------ directories
       Set through the UserConfig API rather than by returning a `dir` object:
       when the config is handed to the Eleventy constructor as a callback (the
       path the compiled binary takes) its return value is discarded, so a
       returned `dir` would silently be ignored and Eleventy would look for
       layouts in the default _includes/. */
    eleventyConfig.setInputDirectory(".");
    eleventyConfig.setOutputDirectory(outputDir);
    eleventyConfig.setIncludesDirectory("eleventy_settings");
    eleventyConfig.setLayoutsDirectory("eleventy_settings");
    eleventyConfig.setDataDirectory("eleventy_data");
    eleventyConfig.setTemplateFormats(["njk", "md", "html"]);

    /* --------------------------------------------------------------- ignores */
    for (const pattern of IGNORED) eleventyConfig.ignores.add(pattern);

    // The output directory, whatever it was called.
    //
    // IGNORED covers `_site*` because that is what build.mjs happens to choose,
    // but outputDir is a parameter and the ignore was a literal — so any other
    // name and the previous build's rendered HTML became input on the next one.
    // It does not fail cleanly either: Eleventy hands an already-rendered page
    // to Liquid, which reports a syntax error at a line inside an HTML comment.
    // Deriving the pattern from the argument keeps the two from drifting.
    const outputPattern = String(outputDir).replace(/^\.\//, "").replace(/\/+$/, "");
    if (outputPattern && outputPattern !== ".") {
      eleventyConfig.ignores.add(`${outputPattern}/**`);
    }

    // Root-level markdown is project documentation, never site content. It is
    // enumerated from disk rather than matched with a "*.md" glob, because that
    // glob also matches input_markdown/ and would silently drop every post —
    // and rather than listed by name, because then any new note dropped at the
    // root (checklist.md, todo.md) quietly gets published as a page.
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        eleventyConfig.ignores.add(entry.name);
      }
    }
    // Asset folders hold media, never templates. Ignoring them keeps a stray
    // .html or .md dropped in one from being published as a page.
    for (const dir of settings.asset_folders ?? PASSTHROUGH_DIRS) {
      eleventyConfig.ignores.add(`${dir}/**`);
    }

    /* ---------------------------------------------------------------- assets */
    const assetFolders = settings.asset_folders ?? PASSTHROUGH_DIRS;
    for (const dir of assetFolders) {
      if (fs.existsSync(path.join(root, dir))) {
        eleventyConfig.addPassthroughCopy(dir);
      } else {
        log.note("assets", "listed in asset_folders but not present", `${dir}/`);
      }
    }
    // The generated stylesheets, and the icons, which live under a folder name
    // that differs from its published location.
    // Stylesheets are copied by name rather than by copying css/ wholesale,
    // because input.css and theme.css are build inputs and must not ship.
    for (const sheet of ["main.css", "main_max.css", "katex.css", "glightbox.min.css"]) {
      if (fs.existsSync(path.join(root, "css", sheet))) {
        eleventyConfig.addPassthroughCopy({ [`css/${sheet}`]: `css/${sheet}` });
      }
    }
    if (fs.existsSync(path.join(root, "icon"))) {
      eleventyConfig.addPassthroughCopy({ icon: "." });
    }

    /* --------------------------------------------------------------- library */
    eleventyConfig.setLibrary("md", md);

    /* ----------------------------------------------------------- global data */
    eleventyConfig.addGlobalData("settings", settings);

    /**
     * The slug registry, as plain data.
     *
     * The .11tydata.js files are loaded from disk by Eleventy at runtime, so
     * inside the compiled binary they cannot import anything from node_modules
     * or from this bundle. They read this instead — a plain object, put in the
     * data cascade by code that IS bundled.
     */
    eleventyConfig.addGlobalData("slugRegistry", (() => {
      const table = {};
      for (const record of registry.all) {
        const value = { slug: record.slug, permalink: record.permalink };
        // Eleventy reports inputPath with a leading "./"; the registry stores it
        // without. Both spellings are keyed so a lookup cannot miss on that.
        table[record.inputPath] = value;
        table[`./${record.inputPath}`] = value;
      }
      return table;
    })());

    /**
     * Computed data that needs the bundled libraries (the markdown parser, the
     * image-path helpers) and therefore cannot live in a .11tydata.js file.
     * Applied globally; each entry leaves pages it does not own untouched.
     */
    eleventyConfig.addGlobalData("eleventyComputed", {
      /** Heading tree for the CSS-only outline panel. Markdown posts only. */
      outline: (data) => {
        if (data.pageKind !== "markdown") return data.outline ?? [];
        // Front matter is not content; strip it before counting headings.
        const body = stripFrontMatter(data.page.rawInput ?? "");
        return outlineFor(md, body);
      },

      /**
       * Card and Open Graph image: the compressed counterpart where one exists,
       * otherwise the image as given. Images in card_thumbnail/ are already
       * thumbnails and have no counterpart, so they pass through untouched.
       */
      thumbnail: (data) => {
        if (data.thumbnail) return data.thumbnail;
        const source = data.image || settings.default_image;
        return source ? resolveThumbnail(source, root, THUMBNAIL_ROOTS) : "";
      },
    });
    /**
     * legal.md plus every licence in licence_and_legal/, rendered to HTML.
     *
     * The folder is outside Eleventy's template scope (it is documentation, not
     * pages), so it is read directly here and handed to legal.njk as data. Each
     * licence becomes its own titled section on the generated page.
     */
    eleventyConfig.addGlobalData("legal", () => {
      const dir = path.join(root, "licence_and_legal");
      if (!fs.existsSync(dir)) {
        log.warn("legal", "licence_and_legal/ not found — legal.html will be near-empty");
        return { body: "", licences: [] };
      }

      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
      let body = "";
      const licences = [];

      for (const file of files) {
        // Licence files may carry front matter; strip it before rendering.
        const source = stripFrontMatter(fs.readFileSync(path.join(dir, file), "utf8"));

        if (file === "legal.md") {
          body = md.render(source);
          continue;
        }

        // Title from the first heading, falling back to the filename. The
        // heading is then removed from the body — the section renders it as its
        // own header, and leaving it in prints every licence name twice.
        const heading = source.match(/^#{1,3}\s+(.+)$/m);
        const licenceBody = heading
          ? source.replace(heading[0], "").replace(/^\s+/, "")
          : source;

        licences.push({
          file,
          title: heading ? heading[1].trim() : file.replace(/\.md$/, "").replace(/[_-]+/g, " "),
          id: headingSlug(file.replace(/\.md$/, "")),
          html: md.render(licenceBody),
        });
      }

      if (!body) log.warn("legal", "licence_and_legal/legal.md not found");
      return { body, licences };
    });

    eleventyConfig.addGlobalData("build", () => ({
      date: new Date().toISOString(),
      generator: "site_generate",
      includeDrafts,
    }));

    /* ------------------------------------------------------------- filters */
    eleventyConfig.addFilter("isoDate", isoDate);
    eleventyConfig.addFilter("humanDate", (v) => humanDate(v, settings.date_locale));
    // RSS 2.0 requires RFC-822 in <pubDate>; ISO 8601 is not valid there.
    eleventyConfig.addFilter("rfc822Date", rfc822Date);
    eleventyConfig.addFilter("year", (v) => {
      const date = toDate(v);
      return date ? String(date.getUTCFullYear()) : "";
    });
    // Named tagSlug rather than "slug" so it cannot be shadowed by Eleventy's
    // own built-in slug filter — the tag page permalinks and the links pointing
    // at them must come from exactly the same table.
    //
    // The fallback matters only if this is somehow called before the tagList
    // collection has been built. Eleventy resolves every collection before it
    // renders anything, so it should not happen; if it ever did, headingSlug is
    // what this filter returned for years, so the failure is the old behaviour
    // rather than a broken link.
    eleventyConfig.addFilter("tagSlug", (tag) => {
      const key = String(tag);
      return tagSlugs.get(key) ?? headingSlug(key);
    });
    /**
     * ` width="…" height="…" ` for an image, read off the file itself.
     * Reserving the space keeps the layout from shifting on load, and stops a
     * lazy image with no intrinsic height from never loading at all.
     */
    eleventyConfig.addFilter("sizeAttrs", (url) => {
      const size = imageSize(url, root);
      return size ? ` width="${size.width}" height="${size.height}"` : "";
    });
    // No escapeHtml filter is registered, on purpose. Nunjucks autoescaping is
    // on and already escapes every interpolation, so a filter that escapes again
    // is not a safety net but a way to emit "&amp;amp;" — which is exactly what
    // feed.njk did for as long as one existed. escapeHtml() is still used by the
    // code in this file that builds HTML strings by hand, where nothing escapes
    // for it.
    /**
     * Site-absolute URL for a path. An empty input yields an empty string, not
     * the bare domain: a caller asking for the absolute URL of nothing wants
     * nothing, and returning the homepage there silently turned a missing
     * og:image into a social card pointing at the site root.
     */
    eleventyConfig.addFilter("absolute", (url) => {
      if (!url) return "";
      if (/^https?:\/\//i.test(url)) return url;
      return `${settings.url}${url.startsWith("/") ? "" : "/"}${url}`;
    });
    eleventyConfig.addFilter("limit", (arr, n) => (Array.isArray(arr) ? arr.slice(0, n) : arr));
    eleventyConfig.addFilter("jsonify", (value) => JSON.stringify(value));
    /** Strip tags and collapse whitespace — used to build search snippets. */
    eleventyConfig.addFilter("plain", (html, max = 240) => {
      const text = String(html ?? "")
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        // The heading anchor is decoration, not text. markdown-it-anchor puts an
        // aria-hidden <a class="header-anchor">#</a> inside every heading, so
        // stripping tags alone left a bare "#" behind each one — in every search
        // snippet, and in the body text a query is matched against.
        .replace(/<a\b[^>]*\bclass="[^"]*\bheader-anchor\b[^"]*"[^>]*>[\s\S]*?<\/a>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;|&#\d+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
    });

    /* ------------------------------------------------------------- drafts */
    /**
     * Drop drafts before they are rendered.
     *
     * Filtering them out of the collections alone is not enough: the page would
     * still be written to _site and remain reachable by anyone who guessed the
     * URL — unlisted, but published. Returning false from a preprocessor stops
     * the file being written at all.
     */
    eleventyConfig.addPreprocessor("drafts", "md,html,njk", (data) => {
      if (data.draft === true && !includeDrafts) {
        log.note("drafts", `skipped, marked draft: true`, data.page.inputPath);
        return false;
      }
      return undefined;
    });

    /* --------------------------------------------------------- collections */
    const isPost = (item) => {
      const key = item.inputPath.replace(/^\.\//, "");
      return registry.byInputPath.has(key);
    };

    const publishable = (item) => {
      if (!isPost(item)) return false;
      if (item.data.draft === true && !includeDrafts) return false;
      return true;
    };

    eleventyConfig.addCollection("posts", (api) =>
      api
        .getAll()
        .filter(publishable)
        .sort((a, b) => {
          // Compared as two numbers rather than by subtracting the dates.
          // Subtraction produced NaN the moment either page had no usable date,
          // and NaN is not "these two are equal" — it is an answer the sort
          // cannot reason with, so a single undated post left the whole list in
          // an arbitrary order, dated pages included, and the title tie-break
          // below was never reached. Undated pages now sort last, together, by
          // title, and every other page keeps its place.
          const at = postTime(a.data.date);
          const bt = postTime(b.data.date);
          if (at !== bt) return bt - at;
          return String(a.data.title ?? "").localeCompare(String(b.data.title ?? ""));
        }),
    );

    /**
     * Every page the sitemap should list.
     *
     * Built here rather than by filtering `collections.all` in the template.
     * `eleventyExcludeFromCollections` removes a page from `all`, and it was set
     * on all of index, about, blog, contact and legal to keep them out of
     * `collections.posts` — which the registry-driven filter above already does
     * on its own. The result was a sitemap that silently listed the posts and
     * nothing else, homepage included.
     *
     * The rule now lives in one place and is stated positively: anything that
     * renders an HTML file and has not opted out with
     * `eleventyExcludeFromSitemap`. Drafts never reach here — the preprocessor
     * stops them being written at all.
     */
    eleventyConfig.addCollection("sitemap", (api) =>
      api
        .getAll()
        .filter((item) => {
          if (item.data.eleventyExcludeFromSitemap) return false;
          // Not a page: the feed, the search index and the sitemap itself.
          if (!String(item.outputPath ?? "").endsWith(".html")) return false;
          return Boolean(item.url);
        })
        // Code-unit order, so the same site always emits the same sitemap.
        .sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)),
    );

    eleventyConfig.addCollection("tagList", (api) => {
      const counts = new Map();
      for (const item of api.getAll().filter(publishable)) {
        for (const tag of item.data.tags ?? []) {
          const key = String(tag);
          const entry = counts.get(key) ?? { tag: key, count: 0 };
          entry.count += 1;
          counts.set(key, entry);
        }
      }

      // Every published tag is known at this point, which is the earliest the
      // table can be built and still be complete.
      assignTagSlugs(counts.keys());

      return [...counts.values()]
        .map((entry) => ({ ...entry, slug: tagSlugs.get(entry.tag) }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    });

    /* -------------------------------------------------------- shortcodes */
    /**
     * Render the CSS-only outline panel for a post.
     * Emitted as raw HTML rather than a template partial so the same markup is
     * available to hand-written pages in input_custom_html/.
     */
    eleventyConfig.addShortcode("outlineList", (outline) => {
      if (!Array.isArray(outline) || outline.length === 0) return "";
      return outline
        .map(
          (heading) =>
            `<a class="outline-link outline-h${heading.level}" href="#${escapeHtml(heading.id)}">` +
            `${escapeHtml(heading.text)}</a>`,
        )
        .join("\n");
    });

    /* ------------------------------------------------------------ hooks */
    eleventyConfig.on("eleventy.before", () => {
      // The registry is built before Eleventy starts so permalink functions in
      // the directory data files always see a complete picture.
      log.info(`  ${registry.all.length} page source(s) registered`);
    });

    /* ------------------------------------------------------------ transform */
    /**
     * The one thing that rewrites rendered HTML: adding the stylesheet and
     * scripts a page's own markup implies. Everything else an author writes
     * reaches the browser exactly as typed.
     */
    eleventyConfig.addTransform("assets", function (content) {
      if (!String(this.page?.outputPath ?? "").endsWith(".html")) return content;
      return injectAssets(content);
    });

    // Note: user-authored markdown and HTML are kept away from any template
    // engine via `templateEngineOverride: false` in each input folder's
    // .11tydata.js, so a stray {{ or {% in a post cannot break the build.
    // That is a data-cascade setting rather than a global one, which is what
    // lets eleventy_njk/*.njk keep full Nunjucks processing.
  };
}

export { IGNORED, PASSTHROUGH_DIRS, outlineFor };
export default createConfig;
