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
import { getRegistry, normaliseKey } from "./slugs.js";
import { createMarkdownLibrary, outlineFor } from "./markdown.js";
import { headingSlug, escapeHtml } from "./paths.js";
import { imageSize, resolveThumbnail } from "./imagesize.js";
import { injectAssets } from "./assets.js";
import { rfc822Date, toDate } from "./format.js";
import { stripFrontMatter } from "./front_matter.js";
import { mergeSubjects, foldSubject } from "./subjects.js";
import { renderPost, pageData } from "./blocks/render.js";
import {
  TAG_PREFIX, CATEGORY_PREFIX, CATEGORIES_BASE,
  listingHref, occupiedBases, assignSlugs, paginate,
} from "./listings.js";
import { readCategories, inCategory } from "./categories.js";

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
  // The test suite builds throwaway project trees; a fixture that happened to
  // be a .md or .html file must never be mistaken for site content.
  "tests/**",
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
   * Subject key -> the slug its page is published under.
   *
   * One table, read by both routes from a subject to its URL: the tagList and
   * tagPages collections, which supply tag.njk's permalinks and the chips in
   * tag_filter.njk, and the tagUrl filter, which card.njk and post.njk use to
   * link a post's own subjects. Deriving the slug independently on each side
   * worked only while headingSlug was injective — and it is not, because it
   * strips punctuation: "C++" and "C#" both reduce to "c". Deduplicating on one
   * side alone would have been worse than the crash it replaced, pointing every
   * C# chip at the C++ page with no broken link for the status check to find.
   *
   * Keyed by foldSubject(), not by the text as written, so that a post filed
   * under "Astronomy" and one filed under "astronomy" resolve to the same page
   * rather than to two pages fighting over one URL.
   */
  const tagSlugs = new Map();

  /**
   * Subject key -> the one spelling the whole site shows for it.
   *
   * A subject is written by hand on every page that carries it, so the same
   * subject arrives spelled several ways. The slug table above makes them one
   * page; this makes them one NAME, so a card chip cannot read "Astronomy"
   * while the page it links to is titled "astronomy".
   */
  const tagLabels = new Map();

  /**
   * The listings of each build, keyed by the collection API object Eleventy
   * hands every collection callback — one per build, so a watch-mode rebuild
   * computes afresh rather than reading the last build's answer.
   */
  const listingsByBuild = new WeakMap();

  /** Say so when a generated page could not have the name it wanted. */
  const reportRenamed = (scope, prefix, renamed) => {
    for (const { name, desired, slug, blockedBy } of renamed) {
      log.warn(
        scope,
        blockedBy === "page"
          ? `a page is already published at /${prefix}${desired}.html, or at a numbered page of it`
          : `"${name}" and "${blockedBy}" reduce to the same URL name "${desired}"`,
        `"${name}" is published at /${prefix}${slug}.html instead`,
      );
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
    // input_markdown/ publishes markdown and nothing else. Now that it is walked
    // recursively, whatever a note folder happens to contain is inside Eleventy's
    // input: a saved web page, a template fragment. Neither is a post, and a .njk
    // in particular would be handed to Nunjucks and could fail the build over a
    // file nobody meant to publish. They are copied as ordinary assets instead.
    eleventyConfig.ignores.add("input_markdown/**/*.njk");
    eleventyConfig.ignores.add("input_markdown/**/*.html");

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
    //
    // css/main_max.css is deliberately NOT here. update_css.sh writes it beside
    // main.css and its own header calls it "for troubleshooting only, never
    // linked" — but it was in this list, so 98 kB of expanded CSS shipped on
    // every build, larger than the 76 kB minified sheet it shadows and linked
    // by nothing. It is still generated; it just stays a local working file.
    for (const sheet of ["main.css", "katex.css", "glightbox.min.css"]) {
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
        // Eleventy reports inputPath with a leading "./" and forward slashes on
        // every platform; the registry builds its own with path.join, which is
        // backslash-separated on Windows. Both spellings are keyed, and both are
        // normalised first — keying the raw join meant that on Windows no lookup
        // here ever matched, and a permalink that misses is not an error but
        // `false`, which publishes nothing. Every markdown and custom-html page
        // silently disappeared from the build.
        const key = normaliseKey(record.inputPath);
        table[key] = value;
        table[`./${key}`] = value;
        // A JSON post is known to Eleventy by its virtual path, and the
        // directory data file looks its permalink up under that name.
        if (record.virtualPath) {
          table[record.virtualPath] = value;
          table[`./${record.virtualPath}`] = value;
        }
      }
      return table;
    })());

    /* ------------------------------------------------------------ JSON posts
       A post folder whose page is a `<folder>.json` document has no template
       on disk for Eleventy to find. Its blocks are rendered here, through the
       same markdown library every .md post uses, and the result is handed to
       Eleventy as a virtual template at the path the registry reserved for it.
       From there it is an ordinary page: it takes the site layout, joins
       collections.posts, and reaches the feed, the sitemap, the search index
       and the subject pages like anything else.

       Rendered at configuration time, which is before Eleventy has read a
       file. That is fine: everything the renderer needs — the registry, the
       markdown library, the thumbnail lookups — already exists by then, and it
       is the same moment the registry itself is consulted.

       A document that fails to parse is not registered, and the "not
       published" check reports the page the registry promised and never got.
       A document that parses but fails validation IS rendered, as best it can
       be, because the status check reports every finding against the source
       file and the author fixes them there; refusing to render would only take
       the page off the site while they do. */
    for (const record of registry.all) {
      if (record.source !== "json") continue;

      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(path.join(root, record.inputPath), "utf8"));
      } catch (error) {
        log.error("posts", `${record.inputPath} is not valid JSON, no page rendered`, error.message);
        continue;
      }

      const { html, warnings } = renderPost(doc, {
        md,
        slug: record.slug,
        inputPath: record.inputPath,
        site: { author: settings.author },
      });
      for (const warning of warnings) {
        log.note("posts", `${record.inputPath} — ${warning.path}: ${warning.message}`, warning.detail);
      }

      eleventyConfig.addTemplate(record.virtualPath, html, {
        ...pageData(doc, { slug: record.slug }),
        layout: "page.njk",
        pageKind: "custom_post",
        // Author content, never run through a template engine — the same rule
        // the directory data file states for hand-written pages.
        templateEngineOverride: false,
        permalink: record.permalink,
      });
    }

    /**
     * Computed data that needs the bundled libraries (the markdown parser, the
     * image-path helpers) and therefore cannot live in a .11tydata.js file.
     * Applied globally; each entry leaves pages it does not own untouched.
     */
    eleventyConfig.addGlobalData("eleventyComputed", {
      /**
       * The subjects a page is filed under: `tags` and `category` as one list.
       *
       * They are the same idea under two names, so the site publishes one page
       * per subject and both keys feed it. Done here rather than in each input
       * folder's .11tydata.js because every consumer — the subject collection,
       * the chips, the feed's <category> elements, the JSON-LD keywords, the
       * search index — reads `tags`, and merging at the single point they all
       * read from is what keeps them from disagreeing.
       *
       * Note that this reads `data.tags`, the key it defines. Eleventy answers
       * a self-reference in computed data with the value from the cascade, not
       * with a partially computed one, so this sees exactly what the author
       * wrote. (`outline` below relies on the same behaviour.)
       *
       * Eleventy's own automatic `collections.<tag>` is NOT fed by computed
       * data and therefore knows nothing about categories. Nothing here uses
       * it — every subject page comes from the `tagPages` collection below — but
       * that is the reason this approach works, so it is worth stating.
       *
       * `tags` is passed first so a page that already had them keeps its chips
       * in the order and the capitalisation it had before categories existed.
       */
      tags: (data) => mergeSubjects(data.tags, data.category),

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
        return source ? resolveThumbnail(source, root) : "";
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
    // The URL of a subject's page, for a chip that names it. The whole URL
    // rather than the slug, so the /tag_ prefix is written in listings.js and
    // nowhere else — the tag page permalinks and the links pointing at them must
    // come from exactly the same table.
    //
    // The fallback matters only if this is somehow called before the listings
    // have been built. Eleventy resolves every collection before it renders
    // anything, so it should not happen; if it ever did, headingSlug is the
    // name the table would have given any subject that collides with nothing.
    eleventyConfig.addFilter("tagUrl", (tag) => {
      const key = foldSubject(tag);
      return listingHref(`${TAG_PREFIX}${tagSlugs.get(key) ?? headingSlug(String(tag).trim())}`);
    });
    /**
     * The site-wide spelling of a subject, for a page that holds its own.
     *
     * Accepts a string or a list and answers in kind, because base.njk and
     * search-index.njk hand over the whole array while the chips ask one at a
     * time. Unknown subjects come back trimmed rather than dropped: a page that
     * is not in the subject list at all (a draft, in a build that includes
     * them) still has to render its chips.
     */
    eleventyConfig.addFilter("tagLabel", (value) => {
      const label = (tag) => tagLabels.get(foldSubject(tag)) ?? String(tag).trim();
      return Array.isArray(value) ? value.map(label) : label(value);
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
    const isPost = (item) => registry.byInputPath.has(normaliseKey(item.inputPath));

    const publishable = (item) => {
      if (!isPost(item)) return false;
      if (item.data.draft === true && !includeDrafts) return false;
      return true;
    };

    /**
     * Every published post, newest first.
     *
     * A named function rather than a callback written inline, because
     * `fullIndex` below needs the same list in the same order, and a collection
     * callback cannot read another collection — each is built from getAll().
     */
    const publishedPosts = (api) =>
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
        });

    eleventyConfig.addCollection("posts", publishedPosts);

    /**
     * The full index (eleventy_njk/full_index.njk), already cut into pages.
     *
     * Paged here rather than by the template's own `pagination.size`, because
     * the page size comes from site_settings.json and Eleventy settles a
     * template's pagination before computed data runs — the reason
     * blog.11tydata.js has to read the settings file a second time, by hand.
     * Cut in the one place that already holds the parsed settings, the
     * template pages over the result one item at a time, the way tag.njk
     * pages over tagPages.
     *
     * Never empty: a site with no posts still gets its one page, because the
     * footer links it from every page and a missing target would be a broken
     * link on all of them.
     */
    eleventyConfig.addCollection("fullIndex", (api) => {
      const posts = publishedPosts(api);
      const size = settings.index_per_page;
      const pages = [];
      for (let start = 0; start < posts.length; start += size) {
        pages.push(posts.slice(start, start + size));
      }
      if (pages.length === 0) pages.push([]);

      return pages.map((entries, number) => {
        // The latest change among this page's entries, for the sitemap's
        // <lastmod>. An edit counts as well as a publication, so this is the
        // later of `updated` and `date` per entry, not the first entry's date.
        const changed = entries
          .map((item) => Math.max(postTime(item.data.updated), postTime(item.data.date)))
          .filter(Number.isFinite);
        return {
          entries,
          // 1-based position of the first entry, for "Entries 201–400 of 612".
          first: number * size + 1,
          lastModified: changed.length ? isoDate(new Date(Math.max(...changed))) : "",
        };
      });
    });

    /**
     * The site's standing pages — About, Contact, Legal, and whatever joins
     * them in eleventy_njk/ — listed at the head of the full index.
     *
     * Derived rather than listed by name, so a page added to eleventy_njk/
     * appears without anyone remembering to add it here. A standing page is a
     * titled HTML page that is not a post, not one page of a paginated listing
     * (the journal, the subject pages, the index itself) and not marked
     * noindex. The front page has `title: false` and drops out on that, which
     * is right: it is where the wordmark goes, not an entry.
     */
    eleventyConfig.addCollection("sitePages", (api) =>
      api
        .getAll()
        .filter((item) => {
          if (isPost(item) || item.data.pagination || !item.data.title) return false;
          if (/noindex/i.test(String(item.data.robots ?? ""))) return false;
          return String(item.outputPath ?? "").endsWith(".html");
        })
        .sort((a, b) => String(a.data.title).localeCompare(String(b.data.title))),
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

    /**
     * Subjects and categories: every page the build generates from data.
     *
     * Computed once per build and shared by five collections. This used to be
     * the body of `tagList`, which filled the tag tables above as a side effect
     * — and that held only while tagList happened to run first. Eleventy 3 does
     * not run collections in the order they are declared; it orders them by
     * what the templates paging over them depend on. Anything else reading the
     * tables could have run against empty ones. So every collection asks for
     * the listings, and whichever asks first builds them.
     */
    const listings = (api) => {
      if (!listingsByBuild.has(api)) listingsByBuild.set(api, buildListings(api));
      return listingsByBuild.get(api);
    };

    const buildListings = (api) => {
      const posts = publishedPosts(api);
      const perPage = settings.posts_per_page;

      // The URLs real pages hold — drafts included, so a subject's URL does not
      // depend on whether this build is a preview. A generated page that wants
      // one of these steps aside rather than failing the build; see assignSlugs.
      const occupied = occupiedBases(registry.all.map((record) => record.permalink));

      /* -- subjects ---------------------------------------------------------- */
      // Walked newest first, so each subject's own list of posts comes out
      // already in the order its pages show them.
      const subjects = new Map();
      for (const post of posts) {
        for (const tag of post.data.tags ?? []) {
          const key = foldSubject(tag);
          if (!key) continue;
          const name = String(tag).trim();
          const entry = subjects.get(key);

          if (!entry) {
            subjects.set(key, { key, tag: name, count: 1, posts: [post] });
            continue;
          }

          entry.count += 1;
          entry.posts.push(post);
          // The spelling the site shows, when pages disagree about it: the one
          // that sorts first, never the one that happened to be read first.
          // Read order is the order pages come off disk, so tying the label to
          // it would let adding an unrelated post rename a subject.
          if (name < entry.tag) entry.tag = name;
        }
      }

      const tagNames = assignSlugs(
        [...subjects.values()].map(({ key, tag }) => ({ key, name: tag })),
        { prefix: TAG_PREFIX, occupied },
      );
      reportRenamed("tags", TAG_PREFIX, tagNames.renamed);

      tagSlugs.clear();
      tagLabels.clear();
      for (const entry of subjects.values()) {
        entry.slug = tagNames.slugs.get(entry.key);
        entry.href = listingHref(`${TAG_PREFIX}${entry.slug}`);
        tagSlugs.set(entry.key, entry.slug);
        tagLabels.set(entry.key, entry.tag);
      }

      const subjectCard = ({ key, tag, count, slug, href }) => ({ key, tag, count, slug, href });

      const tagList = [...subjects.values()]
        .map(subjectCard)
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));

      // Pages in key order, so the same site always renders them in the same
      // order. A subject always has at least one post, so never an empty page.
      const tagPages = [...subjects.values()]
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
        .flatMap((entry) =>
          paginate(entry.posts, perPage, (n) => listingHref(`${TAG_PREFIX}${entry.slug}`, n))
            .map((page) => ({ ...page, subject: subjectCard(entry) })),
        );

      /* -- categories -------------------------------------------------------- */
      // Findings from the file are the status check's to report, once, against
      // category.json. Here a file that does not parse simply has no categories.
      const declared = readCategories(root);

      const categoryKey = (category) =>
        `${foldSubject(category.title)} ${String(category.index).padStart(6, "0")}`;
      const categoryNames = assignSlugs(
        declared.categories.map((category) => ({
          key: categoryKey(category),
          name: category.title,
          slug: category.slug,
        })),
        { prefix: CATEGORY_PREFIX, occupied },
      );
      reportRenamed("categories", CATEGORY_PREFIX, categoryNames.renamed);

      const categoryList = declared.categories.map((category, position) => {
        const slug = categoryNames.slugs.get(categoryKey(category));
        const source = category.thumbnail || settings.default_image;
        return {
          // 1-based and continuous across the overview's pages, for the plate
          // number a card carries.
          number: position + 1,
          title: category.title,
          description: category.description,
          slug,
          href: listingHref(`${CATEGORY_PREFIX}${slug}`),
          thumbnail: source ? resolveThumbnail(source, root) : "",
          // The subjects this category gathers that have a page to link to,
          // under the spelling the rest of the site shows.
          subjects: category.keys
            .filter((key) => subjects.has(key))
            .map((key) => subjectCard(subjects.get(key))),
          posts: posts.filter((post) => inCategory(category, post.data.tags)),
        };
      });
      for (const category of categoryList) category.count = category.posts.length;

      // No categories, no overview page: nothing links to it then.
      const categoryIndex = paginate(
        categoryList,
        declared.perPage,
        (n) => listingHref(CATEGORIES_BASE, n),
        { keepEmpty: false },
      );

      // A category with nothing in it yet still gets its page, because its card
      // links there regardless.
      const categoryPages = categoryList.flatMap((category) =>
        paginate(category.posts, perPage, (n) => listingHref(`${CATEGORY_PREFIX}${category.slug}`, n))
          .map((page) => ({ ...page, category })),
      );

      return { tagList, tagPages, categoryList, categoryIndex, categoryPages };
    };

    // The subject list, most-used first: the chips in tag_filter.njk.
    eleventyConfig.addCollection("tagList", (api) => listings(api).tagList);
    // One item per page of every subject, for tag.njk to page over.
    eleventyConfig.addCollection("tagPages", (api) => listings(api).tagPages);
    // category.json in file order, resolved: the cards.
    eleventyConfig.addCollection("categoryList", (api) => listings(api).categoryList);
    // The pages of /categories.html.
    eleventyConfig.addCollection("categoryIndex", (api) => listings(api).categoryIndex);
    // One item per page of every category, for category.njk to page over.
    eleventyConfig.addCollection("categoryPages", (api) => listings(api).categoryPages);

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
