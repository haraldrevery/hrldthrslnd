/**
 * Site health check.
 *
 * Runs over the generated output rather than the sources, so it reports what a
 * visitor would actually hit: a link that resolves in the templates but points
 * at a file nobody copied is exactly the failure this is meant to catch.
 *
 * The same findings are printed to the terminal and written to
 * _site_report/status_check.html and .json — beside the site, never inside it.
 */
import fs from "node:fs";
import path from "node:path";

import log from "./log.js";
import { getRegistry, SOURCES, walkFiles } from "./slugs.js";
import { DEFAULTS } from "./settings.js";
import {
  escapeHtml, isRaster, isDecodable, isMinName, extensionOf,
  RASTER_EXT, VIDEO_EXT, AUDIO_EXT,
} from "./paths.js";
import {
  frontMatterBlock, firstToken, hasKey, hasValue, hasUnsupportedFence,
} from "./front_matter.js";
import { humanBytes, calendarDateFault } from "./format.js";
import { validatePost } from "./blocks/validate.js";
import { readCategories, CATEGORY_FILE } from "./categories.js";
import { foldSubject } from "./subjects.js";
import { safeDecode, attributeRefs } from "./references.js";
import { readExif } from "./exif.js";

const REQUIRED_FRONT_MATTER = ["title", "date", "description", "tags"];

/**
 * Keys that satisfy a requirement between them.
 *
 * `tags` and `category` are two names for the same list and are merged into one
 * before anything renders, so a page filed only under a category IS on a
 * subject page. Checking `tags` alone reported it as filed under nothing —
 * permanently, on a page that was perfectly correct, which is the shape of
 * false positive that teaches an author to stop reading this report.
 *
 * This check reads raw source with a regex and never sees the merge, so the
 * pairing has to be stated here as well as in subjects.js. It is stated as a
 * list of alternatives rather than by parsing, because that is all this pre-pass
 * can honestly know: whether the key is there and carries something.
 */
const EQUIVALENT_KEYS = { tags: ["tags", "category"] };

/**
 * Attributes that point at a local asset we can verify exists.
 *
 * Both quoting styles, because HTML allows either and hand-written pages use
 * either. Matching only double quotes meant a broken `src='/image/gone.jpg'`
 * was reported as no problem at all — a silent hole in the one check that
 * exists to catch exactly that.
 *
 * The leading look-behind pins the name to the start of an attribute. Without
 * it `href` also matched inside `data-href` and `xlink:href` — attributes the
 * browser never fetches — and every such value was reported as a broken link.
 *
 * `srcset` is listed because a responsive image whose candidates are all
 * missing still renders nothing; the attribute name is captured so the loop
 * can split that one into its comma-separated candidates.
 */
const ASSET_ATTR = /(?<![-\w:])(src|srcset|href|data-src|poster)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;

/**
 * Sub-resource loads only — things the browser fetches to render the page.
 *
 * A plain <a href> to another site is an ordinary outbound link and says
 * nothing about third-party requests; flagging those made the report cry wolf
 * over every citation in a post. What actually breaks the no-third-party
 * promise is loading an asset from somewhere else.
 */
const SUBRESOURCE = /<(?:(?:img|script|iframe|source|video|audio|embed|track)\b[^>]*?\b(src|poster|srcset)|link\b[^>]*?\b(href))\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;

/**
 * The value out of a quoted-attribute match: the double-quoted body, else the
 * single-quoted one. Exactly one of the two ever participates in a match.
 *
 * The attribute patterns above capture a name first, so they pass their own
 * pair of group indices rather than relying on the default 1/2.
 */
const quotedValue = (match, dq = 1, sq = 2) => match[dq] ?? match[sq];

/**
 * Every target an in-page link can land on: `id` anywhere, plus `name` on an
 * anchor, which is how pages written before HTML5 name their sections and which
 * browsers still honour.
 */
const FRAGMENT_TARGET = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')|<a\b[^>]*?\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/**
 * Fragments that resolve without any element carrying them.
 *
 * An empty fragment and "#top" both mean the top of the document per the HTML
 * spec's "indicated part" rules, so neither is broken.
 */
const ALWAYS_RESOLVES = new Set(["", "top"]);

/**
 * Front matter checks run against the SOURCE files, because that is where the
 * author would fix them. Everything else runs against the output.
 *
 * A draft is still checked, but every finding on one is a warning and says so.
 * The two obvious alternatives are both wrong: skipping drafts hides a missing
 * title until the day you publish, which is the worst moment to find out, while
 * treating them as errors fails a production build over a page that is not in
 * it — this pass reads the sources, so it sees drafts that no other check does.
 * Reporting them as warnings keeps the information and stops it blocking a
 * build of a site the page is not part of.
 */
function checkFrontMatter(root, findings, includeDrafts) {
  const registry = getRegistry(root);

  for (const record of registry.all) {
    const file = path.join(root, record.inputPath);
    if (!fs.existsSync(file)) continue;

    // A page-builder document has no front matter; its `meta` is checked by
    // the same validator the editor runs, so the two can never disagree about
    // what a complete post is.
    if (record.source === "json") {
      checkJsonPost(root, record, findings, includeDrafts);
      continue;
    }

    // A draft being built with --drafts IS on the site, so it is held to the
    // same standard as everything else around it.
    const unpublished = record.draft && !includeDrafts;
    const level = (want) => (unpublished ? "warn" : want);
    const page = unpublished ? `${record.inputPath} (draft)` : record.inputPath;

    const source = fs.readFileSync(file, "utf8");
    const block = frontMatterBlock(source);

    if (block === null) {
      // A file that opens with `---` meant to have a block and did not get one,
      // which is a different mistake from never writing one and needs a
      // different instruction. Saying "no front matter" for an unterminated
      // fence sends the author to add a block they can plainly see is already
      // there.
      // Three different mistakes that all arrive here as "no block", and each
      // needs its own instruction — "no front matter" sent an author to add a
      // block they could plainly see was already there.
      const unsupportedFence = hasUnsupportedFence(source);
      const opensWithFence = !unsupportedFence && /^\uFEFF?---/.test(source);

      findings.push({
        // An unsupported fence is an error even on a draft. Eleventy DOES read
        // it, so the two disagree about whether the page is a draft at all —
        // and the registry, not knowing, publishes its co-located assets beside
        // a page Eleventy never wrote. Downgrading that to a warning would be
        // quiet about the one case where quiet is the actual damage.
        level: unsupportedFence ? "error" : level("error"),
        scope: "front matter",
        page,
        message: unsupportedFence
          ? "the front matter fence names a language this build cannot read"
          : opensWithFence
            ? "the front matter block is not closed"
            : "no YAML front matter block",
        detail: unsupportedFence
          ? "`---json`, `---js` and the like are read by Eleventy but not by the " +
            "registry, so the two disagree about whether this page is a draft and " +
            "where it publishes — rewrite the block as plain YAML behind a bare `---`"
          : opensWithFence
            ? "the opening `---` has no matching `---` line — a `...` terminator " +
              "does not close one; the page cannot get a title, date, tags or social image"
            : "the page cannot get a title, date, tags or social image",
      });
      continue;
    }

    for (const key of REQUIRED_FRONT_MATTER) {
      const accepted = EQUIVALENT_KEYS[key] ?? [key];
      if (accepted.some((name) => hasValue(block, name))) continue;

      // A key written with no value is its own mistake and reads nothing like a
      // forgotten line, so it is worth naming separately. With alternatives,
      // the one the author actually wrote is the one to name — telling someone
      // who wrote `category:` that they are missing "tags" sends them to add a
      // second key they do not need.
      const written = accepted.find((name) => hasKey(block, name));
      const named = accepted.join('" or "');

      findings.push({
        level: level(key === "title" || key === "date" ? "error" : "warn"),
        scope: "front matter",
        page,
        message: written ? `"${written}" has no value` : `missing "${named}"`,
        detail:
          key === "description"
            ? "used for the meta description, cards and search results"
            : key === "tags"
              ? "the page will not appear on any subject page — `tags` and " +
                "`category` are merged into one list, so either will do"
              : "required",
      });
    }

    if (!hasValue(block, "image")) {
      findings.push({
        level: "warn",
        scope: "front matter",
        page,
        message: hasKey(block, "image") ? '"image" has no value' : 'missing "image"',
        detail: "falls back to the site default for the card and Open Graph image",
      });
    }

    const draftValue = firstToken(block, "draft");
    if (draftValue && !/^(true|false)$/i.test(draftValue)) {
      findings.push({
        level: "warn",
        scope: "front matter",
        page,
        message: `"draft: ${draftValue}" is not true or false`,
        detail: "anything other than true is treated as published",
      });
    }

    // Quotes are stripped for this test and this test only. `date: "2026-06-03"`
    // is a perfectly good date — Eleventy parses the quoted string into the same
    // day as the bare one — so warning about it was crying wolf. The draft check
    // above deliberately does NOT do this: there, quoting changes the meaning.
    // `updated` is optional and holds the same shape as `date`; it is what the
    // sitemap's <lastmod> and the JSON-LD dateModified use when it is there.
    for (const key of ["date", "updated"]) {
      const value = firstToken(block, key)?.replace(/^['"]|['"]$/g, "");
      if (!value) continue;
      const fault = calendarDateFault(value);
      if (fault) {
        findings.push({
          level: level("error"),
          scope: "front matter",
          page,
          message: `${key} "${value}" is not a real date`,
          detail: fault,
        });
        continue;
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) continue;
      findings.push({
        level: "warn",
        scope: "front matter",
        page,
        message: `${key} "${value}" is not YYYY-MM-DD`,
        detail: "sort order and the sitemap may be wrong",
      });
    }
  }
}

/**
 * A page-builder document, validated against the files actually in its folder.
 *
 * Notes are dropped here: they are the editor's business while a page is
 * being written, and on a build report they would only bury the findings that
 * matter. The draft rule is the same one checkFrontMatter() applies — a draft
 * that is not in the build is reported at warning level, whatever the finding.
 */
function checkJsonPost(root, record, findings, includeDrafts) {
  const unpublished = record.draft && !includeDrafts;
  const page = unpublished ? `${record.inputPath} (draft)` : record.inputPath;

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(root, record.inputPath), "utf8"));
  } catch (error) {
    findings.push({
      level: "error",
      scope: "post json",
      page,
      message: "not valid JSON, so no page was rendered",
      detail: error.message,
    });
    return;
  }

  const assets = walkFiles(path.join(root, record.sourceDir)).filter(
    (relative) => relative !== `${record.folder}.json`,
  );

  for (const finding of validatePost(doc, { assets })) {
    if (finding.level === "note") continue;
    findings.push({
      level: unpublished ? "warn" : finding.level,
      scope: "post json",
      page,
      message: finding.path ? `${finding.path} — ${finding.message}` : finding.message,
      detail: finding.detail,
    });
  }
}

/**
 * A hand-written post page that names its own folder in a path, when the
 * registry had to give the page a different slug.
 *
 * A post folder's assets publish at /<slug>/, and the slug carries a suffix
 * when the folder's name was already taken. The page cannot know that when it
 * is written, so every `/post_i/photo.jpg` in it goes to the wrong place —
 * and the link check would report each picture separately, with no hint that
 * one rename fixes them all. This names the cause once. A JSON post has no
 * such problem: the renderer writes the URL from the assigned slug.
 */
function checkPostFolderPaths(root, findings) {
  for (const record of getRegistry(root).all) {
    if (record.kind !== "custom_post" || record.source === "json") continue;
    if (record.slug === record.desired) continue;

    let html = "";
    try {
      html = fs.readFileSync(path.join(root, record.inputPath), "utf8");
    } catch {
      continue;
    }
    if (!html.includes(`/${record.desired}/`)) continue;

    findings.push({
      level: "error",
      scope: "post folder",
      page: record.inputPath,
      message: `refers to /${record.desired}/ but its assets publish at /${record.slug}/`,
      detail:
        "the folder's name was already taken by another page, so this one carries " +
        "a suffix — rename the folder, or write the page as a JSON document and the " +
        "build fills the path in",
    });
  }
}

/** Broken local links, missing media, images without alt text. */
function checkHtml(outputDir, findings, stats) {
  const htmlFiles = walkFiles(outputDir).filter((f) => f.endsWith(".html"));
  stats.pageCount = htmlFiles.length;

  for (const relative of htmlFiles) {
    const rawHtml = fs.readFileSync(path.join(outputDir, relative), "utf8");
    const pageUrl = `/${relative}`;

    // Commented-out markup is not a reference. The block test pages carry
    // example <source> and <img> tags inside comments on purpose, and flagging
    // those as broken links would train the author to ignore this report.
    const html = rawHtml.replace(/<!--[\s\S]*?-->/g, "");

    // --- in-page links land on something -----------------------------------
    /**
     * Checked here and not in the loop below, which skips a bare "#…" because
     * it resolves to no FILE. That skip was the whole check: a link to a
     * section that was renamed, or never given an id, resolved to nothing and
     * was reported by nobody, so four pages shipped with dead contents links.
     *
     * Same-page only. A fragment on ANOTHER page needs every page's ids in hand
     * before any page can be judged, which is a second pass over the output;
     * the cross-page form is rarer and the same-page form is where the rot is.
     */
    const targets = new Set();
    for (const found of html.matchAll(FRAGMENT_TARGET)) {
      const value = found[1] ?? found[2] ?? found[3] ?? found[4];
      if (value) targets.add(value);
    }

    for (const found of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"(#[^"]*)"|'(#[^']*)')/gi)) {
      const fragment = safeDecode(quotedValue(found).slice(1));
      if (ALWAYS_RESOLVES.has(fragment) || targets.has(fragment)) continue;

      findings.push({
        level: "error",
        scope: "broken link",
        page: pageUrl,
        message: `#${fragment}`,
        detail: "no element on this page has that id",
      });
    }

    // --- local references resolve to a real file ---------------------------
    const pageDir = path.dirname(path.join(outputDir, relative));

    for (const match of html.matchAll(ASSET_ATTR)) {
      const attr = match[1].toLowerCase();
      for (const ref of attributeRefs(attr, quotedValue(match, 2, 3))) {
        const raw = ref.trim();
        if (!raw || raw.startsWith("#") || raw.startsWith("data:")) continue;

        if (/^(https?:)?\/\//i.test(raw)) continue; // handled by the sub-resource pass
        if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue; // mailto:, tel:, javascript:, any other scheme

        const withoutQuery = safeDecode(raw.split(/[?#]/)[0]);
        if (!withoutQuery) continue; // "?x=1" or "#frag" — same page

        // Root-relative against the output, everything else against the page
        // that holds it. Skipping relative links entirely meant a post linking
        // a sibling file by name was never checked at all — the references most
        // likely to rot were the ones the check refused to look at.
        const target = raw.startsWith("/")
          ? path.join(outputDir, withoutQuery)
          : path.resolve(pageDir, withoutQuery);

        // A reference that climbs out of the built site cannot resolve for a
        // visitor however it looks on this disk.
        const insideOutput = path.relative(outputDir, target);
        if (insideOutput.startsWith("..") || path.isAbsolute(insideOutput)) {
          findings.push({
            level: "error",
            scope: "broken link",
            page: pageUrl,
            message: raw,
            detail: "resolves to a path outside the built site",
          });
          continue;
        }

        if (fs.existsSync(target)) continue;
        // A bare directory link resolves to its index.html.
        if (fs.existsSync(path.join(target, "index.html"))) continue;

        findings.push({
          level: "error",
          scope: "broken link",
          page: pageUrl,
          message: raw,
          detail: "no such file in the built site",
        });
      }
    }

    // --- assets loaded from somewhere else --------------------------------
    for (const match of html.matchAll(SUBRESOURCE)) {
      const attr = (match[1] ?? match[2]).toLowerCase();
      for (const ref of attributeRefs(attr, quotedValue(match, 3, 4))) {
        const raw = ref.trim();
        if (/^(https?:)?\/\//i.test(raw)) stats.remoteRefs.push({ page: pageUrl, url: raw });
      }
    }

    // --- images carry alt text --------------------------------------------
    for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
      if (/\salt\s*=/i.test(tag[0])) continue;
      findings.push({
        level: "warn",
        scope: "accessibility",
        page: pageUrl,
        message: "an <img> has no alt attribute",
        detail: tag[0].slice(0, 120),
      });
    }

    // --- exactly one h1 ----------------------------------------------------
    const h1Count = (html.match(/<h1\b/gi) ?? []).length;
    if (h1Count === 0) {
      findings.push({
        level: "warn", scope: "structure", page: pageUrl,
        message: "no <h1>", detail: "search engines use it as the page's title",
      });
    } else if (h1Count > 1) {
      findings.push({
        level: "warn", scope: "structure", page: pageUrl,
        message: `${h1Count} <h1> elements`, detail: "a page should have exactly one",
      });
    }

    // --- meta description --------------------------------------------------
    // Pages marked noindex are developer tools, not published pages; they have
    // nothing to gain from a meta description.
    const noindex = /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex/i.test(html);
    const description = html.match(
      /<meta\s+name=["']description["']\s+content=(?:"([^"]*)"|'([^']*)')/i,
    );
    if (!noindex && (!description || !quotedValue(description).trim())) {
      findings.push({
        level: "warn", scope: "seo", page: pageUrl,
        message: "empty meta description", detail: "add `description:` to the front matter",
      });
    }
  }
}

/**
 * Settings the template shipped with and nobody changed.
 *
 * Compared against settings.js's own DEFAULTS rather than against literals, so
 * this cannot drift from them. Only the fields a stranger sees are checked: the
 * site URL is baked into every canonical, og:url, JSON-LD publisher, sitemap
 * <loc> and the Sitemap: line of robots.txt, and the name is the title suffix
 * on every page. A build that publishes "https://example.com" is not a broken
 * build — it just is not this site's — so these are warnings.
 */
/**
 * A value that reads like a template placeholder: capitals, spaces and
 * underscores only, with SITE as one of its words — "SITE", "SITE_NAME",
 * "SITE LONG NAME". An edited copy of the template drifts away from DEFAULTS
 * without ever becoming a real name, which the equality test alone missed.
 */
const looksLikePlaceholder = (value) => /^[A-Z _]+$/.test(value) && /(^|[ _])SITE([ _]|$)/.test(value);

function checkSettings(settings, findings) {
  const placeholders = [
    { key: "url", detail: "every canonical, og:url, sitemap <loc> and robots.txt Sitemap: line points at it" },
    { key: "name", detail: "it is the title suffix on every page and the og:site_name" },
    { key: "short_name", detail: "it is the site's alternate name in the JSON-LD" },
    { key: "author", detail: "it is the author in every page's meta tags and JSON-LD, and the footer's copyright line" },
  ];

  for (const { key, detail } of placeholders) {
    const value = String(settings[key] ?? "");
    const unchanged = value !== "" && value === String(DEFAULTS[key]);
    if (!unchanged && !looksLikePlaceholder(value)) continue;
    findings.push({
      level: "warn",
      scope: "settings",
      page: "site_settings.json",
      message: unchanged
        ? `"${key}" is still the template default, "${DEFAULTS[key]}"`
        : `"${key}" looks like a placeholder, "${value}"`,
      detail,
    });
  }

  // Not a placeholder, but the same class of thing: an unusable value that
  // nothing else reports. `absolute` builds every outward-facing URL from this.
  if (settings.url && !/^https?:\/\/[^/]+$/i.test(settings.url)) {
    findings.push({
      level: "warn",
      scope: "settings",
      page: "site_settings.json",
      message: `"url" is not a bare origin: "${settings.url}"`,
      detail: "it should look like https://example.org, with no path and no trailing slash",
    });
  }
}

/**
 * The budget a file is held to, by what the file IS rather than where it sits.
 *
 * This used to be a list of four folders — image/, image_min/, gif/, video/ —
 * which is the legacy layout and no longer where most media lives. A photograph
 * beside a note publishes to /<note-folder>/, a post folder's media publishes to
 * /<slug>/, and audio/ never had a budget at all: all of it was exempt from the
 * limits site_settings.json declares, and none of it counted toward the asset
 * weight the report prints. Keying on the extension covers every layout at once
 * and cannot fall behind a new one.
 *
 * A `_min` name is the compressed counterpart and is held to the thumbnail
 * budget wherever it lives, which is the whole point of generating one.
 */
function budgetFor(relative, limits) {
  const ext = extensionOf(relative);
  if (ext === ".gif") return { limit: limits.max_gif_bytes, label: "gif" };
  if (VIDEO_EXT.has(ext)) return { limit: limits.max_video_bytes, label: "video" };
  if (AUDIO_EXT.has(ext)) return { limit: limits.max_audio_bytes, label: "audio" };
  if (RASTER_EXT.has(ext)) {
    return isMinName(relative)
      ? { limit: limits.max_image_min_bytes, label: "thumbnail" }
      : { limit: limits.max_image_bytes, label: "photograph" };
  }
  return null; // svg, fonts, css, js: counted below, but no budget is declared
}

/**
 * How much of a JPEG to read for its metadata. EXIF and XMP sit in APP
 * segments before the image data, each at most 64 kB.
 */
const METADATA_HEAD = 256 * 1024;

/**
 * Whether a published JPEG says where it was taken, in EXIF or in XMP.
 *
 * Only the page builder's importer strips location, so a photograph added to
 * image/ or beside a note is published exactly as exported. A _min counterpart
 * is a fresh encode with no metadata, and is not read. Other formats are not
 * checked: cameras and phones write location into JPEG (and HEIC, which a
 * browser cannot show anyway).
 */
export function carriesLocation(file) {
  if (!/\.jpe?g$/i.test(file) || isMinName(file)) return false;
  let fd = null;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(Math.min(fs.fstatSync(fd).size, METADATA_HEAD));
    fs.readSync(fd, head, 0, head.length, 0);
    const exif = readExif(head);
    return Boolean(exif.hasGps || exif.xmpGps);
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Oversized assets, _min counterparts that blew the budget, and location data. */
function checkAssets(outputDir, settings, findings, stats) {
  const limits = settings.status_check;

  // One walk of the whole output. "Asset" is everything that is not a page,
  // which is the only definition that stays true as the layout changes — an
  // allowlist of folders is what let the weight figure drift from the site's
  // real weight in the first place.
  for (const relative of walkFiles(outputDir)) {
    if (extensionOf(relative) === ".html") continue;

    const size = fs.statSync(path.join(outputDir, relative)).size;
    stats.totalAssetBytes += size;
    stats.assetCount += 1;

    if (carriesLocation(path.join(outputDir, relative))) {
      findings.push({
        level: "warn",
        scope: "privacy",
        page: `/${relative}`,
        message: "the photograph carries GPS location data",
        detail:
          "anyone who downloads it can read where it was taken. Pictures imported in the page " +
          "builder are cleaned automatically; for this one, export without location (Lightroom: " +
          "Metadata > Remove Location Info) or run: exiftool -gps:all= -xmp:geotag= <file>",
      });
    }

    const budget = budgetFor(relative, limits);
    if (!budget || !Number.isFinite(budget.limit) || size <= budget.limit) continue;

    findings.push({
      level: "warn",
      scope: "asset size",
      page: `/${relative}`,
      message: `${budget.label} is ${humanBytes(size)}`,
      detail: `over the ${humanBytes(budget.limit)} budget in site_settings.json`,
    });
  }

  // Every image/ file should have its image_min/ counterpart in the output.
  const sources = walkFiles(path.join(outputDir, "image"));
  for (const relative of sources) {
    if (!isRaster(relative)) continue;
    const ext = extensionOf(relative);
    const counterpart = path.join(
      outputDir,
      "image_min",
      path.dirname(relative),
      `${path.basename(relative, path.extname(relative))}_min.jpg`,
    );
    if (fs.existsSync(counterpart)) continue;

    // An error only where the build could have made one and did not. A format
    // the mirror cannot decode is a warning: the page still works — it just
    // ships the full-resolution file — and the only fix is the author's, so
    // failing the build over it left no way to get back to a green run.
    const makeable = isDecodable(relative);
    findings.push({
      level: makeable ? "error" : "warn",
      scope: "image mirror",
      page: `/image/${relative}`,
      message: "no _min counterpart in the output",
      detail: makeable
        ? "galleries and cards will fall back to the full-resolution file"
        : `the mirror cannot encode from ${ext} — supply the counterpart by hand, ` +
          "or the full-resolution file is what cards and galleries load",
    });
  }
}

/**
 * Slug collisions the registry had to resolve with a suffix.
 *
 * Compared against the slug the file actually asked for, not against the shape
 * of the result. Testing for a `_2` ending instead warned about every file
 * legitimately named `test_post_2.md`, on every build — a permanent false
 * positive, which is the fastest way to teach an author to skim past the
 * report.
 *
 * A page holding a name recorded in published_urls.json is skipped: that is
 * the URL it was published under, kept on purpose, and it was reported once,
 * on the build that first gave it the suffix.
 */
function checkSlugs(root, findings) {
  const registry = getRegistry(root);
  for (const record of registry.all) {
    if (record.slug === record.desired || record.locked) continue;
    findings.push({
      level: "warn",
      scope: "slug",
      page: record.inputPath,
      message: `published as "${record.slug}", not "${record.desired}"`,
      detail: "another input file already claimed the name it wanted",
    });
  }
}

/**
 * category.json: what is wrong with the file, and which of its subjects match
 * nothing.
 *
 * The file is hand-written JSON, so the likely faults are the silent ones. A
 * trailing comma is loud — it is an error, and the categories section is not
 * published — but a misspelt subject is not: the category renders, its card
 * counts fewer entries than it should, and nothing looks broken. So every
 * subject a category names is checked against what was actually published.
 *
 * "Published" is read from the output's search index, which lists every entry
 * the build published with its subjects under the site-wide spelling. Reading
 * the output rather than the sources is this module's rule, and it is what
 * lets --check-only run the same check against a finished _site. Without an
 * index to read, the subject check is skipped rather than guessed at.
 */
function checkCategories(root, outputDir, findings) {
  const { present, categories, findings: fileFindings } = readCategories(root);
  if (!present) return;
  findings.push(...fileFindings);
  if (categories.length === 0) return;

  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(path.join(outputDir, "search_index.json"), "utf8")).entries;
  } catch {
    return;
  }
  if (!Array.isArray(entries)) return;

  const published = new Set();
  for (const entry of entries) {
    for (const tag of entry?.tags ?? []) published.add(foldSubject(tag));
  }

  for (const category of categories) {
    const unmatched = category.subjects.filter((subject) => !published.has(foldSubject(subject)));
    if (unmatched.length === 0) continue;

    const nothing = unmatched.length === category.subjects.length;
    findings.push({
      level: "warn",
      scope: "categories",
      page: CATEGORY_FILE,
      message: nothing
        ? `"${category.title}" matches no published entry — its page is empty`
        : `"${category.title}" — ${unmatched.map((s) => `"${s}"`).join(", ")} ` +
          `${unmatched.length === 1 ? "matches" : "match"} no published entry`,
      detail:
        "check the spelling against the subjects on /blog.html — case is ignored, punctuation is not" +
        (category.subjects.length === 1 && category.subjects[0] === category.title
          ? `; with no "tags" list, a category matches its own title`
          : ""),
    });
  }
}

/**
 * Source files that were registered but never became a page, and pages the
 * registry has never heard of.
 *
 * The check that exists because its absence hid a whole class of failure. A
 * permalink is not required to succeed: the data files resolve it out of the
 * slug registry and fall back to `false`, and Eleventy writes nothing at all for
 * `permalink: false`. So a source file the registry missed was not an error, it
 * was a page that quietly did not exist — not in the output, not in
 * collections.posts, not in the sitemap or the feed or the search index, and not
 * in any check here either, because every other check reads the registry or the
 * output and it was in neither. Three posts sat in a subfolder of
 * input_markdown/ doing exactly that while the build reported "All clear".
 *
 * Both halves are needed. The first catches a file the registry knows about that
 * produced no page; the second catches a file the registry never saw, which is
 * the shape the original failure took.
 */
function checkUnpublished(root, outputDir, includeDrafts, findings) {
  const registry = getRegistry(root);

  for (const record of registry.all) {
    if (record.draft && !includeDrafts) continue;
    const target = path.join(outputDir, ...record.permalink.replace(/^\//, "").split("/"));
    if (fs.existsSync(target)) continue;
    findings.push({
      level: "error",
      scope: "not published",
      page: record.inputPath,
      message: `no page was written at ${record.permalink}`,
      detail:
        "the source was registered but produced no output — usually a permalink " +
        "that resolved to false, which Eleventy writes nothing for",
    });
  }

  // Deliberately its own walk, with none of the registry's filtering, so that
  // anything the registry declined to enumerate shows up here rather than
  // vanishing. Hidden folders are the one exception that is reported quietly:
  // a vault's .obsidian/ and .trash/ are skipped on purpose and saying so once
  // is information, while an error on each would be noise.
  const seen = (relative) => registry.byInputPath.has(relative);
  let hidden = 0;

  for (const source of SOURCES) {
    if (!source.match) continue; // input_custom_post is enumerated by folder
    const dir = path.join(root, source.dir);
    if (!fs.existsSync(dir)) continue;

    // includeHidden, because this walk exists to see what the others skip: the
    // hidden ones are counted and reported once below rather than dropped.
    for (const posix of walkFiles(dir, { includeHidden: true })) {
      const name = posix.slice(posix.lastIndexOf("/") + 1);
      if (!source.match(name)) continue;
      if (/\.11tydata\.(js|json|cjs|mjs)$/i.test(name)) continue;
      if (seen(`${source.dir}/${posix}`)) continue;

      if (posix.split("/").some((segment) => segment.startsWith("."))) {
        hidden += 1;
        continue;
      }

      findings.push({
        level: "error",
        scope: "not published",
        page: `${source.dir}/${posix}`,
        message: "on disk but not registered, so no page was written",
        detail: "nothing links to it and nothing serves it — it is not on the site at all",
      });
    }
  }

  if (hidden > 0) {
    log.note(
      "status",
      `${hidden} file(s) in hidden folders were not published`,
      "names beginning with a dot (.obsidian, .trash) are skipped on purpose",
    );
  }
}

export async function runStatusCheck({ root, outputDir, settings, images, includeDrafts = false }) {
  const findings = [];
  const stats = {
    pageCount: 0,
    assetCount: 0,
    totalAssetBytes: 0,
    remoteRefs: [],
  };

  if (!fs.existsSync(outputDir)) {
    log.error("status", `${path.basename(outputDir)} does not exist`, "nothing to check");
    return { findings, ...stats };
  }

  checkSettings(settings, findings);
  checkFrontMatter(root, findings, includeDrafts);
  checkHtml(outputDir, findings, stats);
  checkAssets(outputDir, settings, findings, stats);
  checkSlugs(root, findings);
  checkCategories(root, outputDir, findings);
  checkPostFolderPaths(root, findings);
  checkUnpublished(root, outputDir, includeDrafts, findings);

  // Assets fetched from another origin break the no-third-party promise, so
  // these are worth flagging. Outbound <a> links are not, and are not counted.
  const external = stats.remoteRefs.filter((ref) => !ref.url.startsWith(settings.url));
  for (const ref of external) {
    findings.push({
      level: "warn",
      scope: "third party asset",
      page: ref.page,
      message: ref.url,
      detail: "loaded from another domain — this site is meant to serve every asset itself",
    });
  }

  for (const finding of findings) {
    const method = finding.level === "error" ? "error" : "warn";
    log[method](finding.scope, `${finding.page} — ${finding.message}`, finding.detail);
  }

  return { findings, ...stats };
}

/* ---------------------------------------------------------------- HTML page */

const sevClass = { error: "sev-error", warn: "sev-warn" };

/**
 * The same report as data, for anything that is not a person reading a page:
 * the editor's status panel, a deploy script, a test. Written beside the HTML
 * report as status_check.json. The shape is the return value of
 * runStatusCheck() plus the thumbnail totals, the folder that was checked and a
 * timestamp, and nothing in it is derived from the HTML — the two are written
 * from the same findings.
 */
export function statusReport({ status, images, checked = "" }) {
  const errors = status.findings.filter((f) => f.level === "error").length;
  const warnings = status.findings.filter((f) => f.level === "warn").length;
  return {
    generated: new Date().toISOString(),
    checked,
    verdict: errors > 0 ? "error" : warnings > 0 ? "warn" : "ok",
    pages: status.pageCount,
    assets: status.assetCount,
    assetBytes: status.totalAssetBytes,
    errors,
    warnings,
    thumbnails: {
      generated: images?.totals?.generated ?? 0,
      stale: images?.totals?.stale ?? 0,
      collisions: images?.totals?.collisions ?? 0,
    },
    findings: status.findings,
  };
}

/**
 * The report's own stylesheet, inline.
 *
 * The report lives outside the site (see output_dirs.js) and is opened straight
 * from disk, where the site's root-relative /css/main.css does not resolve. So
 * it carries a small sheet of its own, follows the system colour scheme, and
 * uses system fonts. It also means main.css no longer carries rules that only
 * this one page used.
 */
const REPORT_CSS = `
:root { color-scheme: light dark; --bg: #f6f5f1; --fg: #17171a; --muted: #5b5b63; --line: #d9d7d0;
  --raised: #ffffff; --err: #b3261e; --warn: #8a5a00; --ok: #1d6b43; }
@media (prefers-color-scheme: dark) { :root { --bg: #0e0e11; --fg: #ececea; --muted: #a3a3ab;
  --line: #2c2c33; --raised: #16161b; --err: #ff8a80; --warn: #f5c26b; --ok: #7fd6a4; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 system-ui, sans-serif; }
main { max-width: 76rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
h1 { font-size: 2rem; margin: 0.4rem 0 0; }
h2 { font-size: 1.15rem; margin: 2.5rem 0 0.75rem; }
p, ul { max-width: 60rem; }
.eyebrow, th, .sev, .stats span { font: 600 0.72rem/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  letter-spacing: 0.12em; text-transform: uppercase; }
.muted, th, .stats span { color: var(--muted); }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.75rem; margin-top: 1.5rem; }
.stats div { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; padding: 0.75rem 1rem; }
.stats b { display: block; font-size: 1.5rem; font-weight: 600; margin-top: 0.3rem; }
.sev { display: inline-block; padding: 0.2rem 0.6rem; border: 1px solid currentColor; border-radius: 999px; }
.sev-error { color: var(--err); } .sev-warn { color: var(--warn); } .sev-ok { color: var(--ok); }
.table { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { text-align: left; padding: 0.55rem 0.7rem; border-bottom: 1px solid var(--line); vertical-align: top; }
td .muted { display: block; margin-top: 0.2rem; }
code { font: 0.85em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
`;

/**
 * Write status_check.html and status_check.json into `reportDir`.
 *
 * A standalone document rather than an Eleventy template: it reports on the
 * finished output, so it can only be produced after Eleventy has already run.
 *
 * It is written beside the site, never into it. The report names draft files,
 * source paths and asset problems, and a copy inside the site would be
 * published with it. Outside, it can also never collide with an author's own
 * page at /status_check.html.
 *
 * @param {object} options
 * @param {string} options.reportDir  where to write, normally _site_report/
 * @param {string} options.checked    the folder the findings describe, as the
 *   author knows it ("_site", "_site_drafts"), for the heading
 * @param {string} [options.note]     one extra line for the heading, such as
 *   why the build was not published
 */
export function writeStatusPage({ reportDir, checked, note = "", settings, status, images }) {
  const errors = status.findings.filter((f) => f.level === "error");
  const warnings = status.findings.filter((f) => f.level === "warn");

  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(
    path.join(reportDir, "status_check.json"),
    `${JSON.stringify(statusReport({ status, images, checked }), null, 2)}\n`,
    "utf8",
  );

  const verdict =
    errors.length > 0
      ? { klass: "sev-error", text: `${errors.length} error(s)` }
      : warnings.length > 0
        ? { klass: "sev-warn", text: `${warnings.length} warning(s)` }
        : { klass: "sev-ok", text: "All clear" };

  const rows = [...errors, ...warnings]
    .map(
      (f) => `
      <tr>
        <td><span class="sev ${sevClass[f.level]}">${f.level}</span></td>
        <td>${escapeHtml(f.scope)}</td>
        <td><code>${escapeHtml(f.page)}</code></td>
        <td>${escapeHtml(f.message)}${f.detail ? `<span class="muted">${escapeHtml(f.detail)}</span>` : ""}</td>
      </tr>`,
    )
    .join("");

  const generated = images.reports.flatMap((r) =>
    r.generated.map((g) => `${path.basename(g.file)} — ${humanBytes(g.bytes)} at q${g.quality}`),
  );
  // `?? []` rather than a bare access: --check-only builds its own empty images
  // object, and a field added here later must not take that path down with it.
  const stale = images.reports.flatMap((r) =>
    (r.stale ?? []).map((entry) => ({
      file: entry.file,
      certain: Boolean(entry.certain),
      detail: entry.detail ?? "",
    })),
  );
  // Two images that reduce to one counterpart. An error rather than a warning:
  // one of the two is showing the other's photograph on every card and in every
  // gallery, and no amount of rebuilding fixes it.
  const collisions = images.reports.flatMap((r) => r.collisions ?? []);

  const section = (title, intro, items) =>
    items.length
      ? `<section>
    <h2>${title}</h2>
    <p class="muted">${intro}</p>
    <ul>
      ${items.map((item) => `<li>${item}</li>`).join("\n      ")}
    </ul>
  </section>`
      : "";

  const stat = (label, value) => `<div><span>${label}</span><b>${value}</b></div>`;

  const html = `<!doctype html>
<html lang="${escapeHtml(settings.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Status — ${escapeHtml(settings.name)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<main>

  <p class="eyebrow muted">${escapeHtml(settings.name)} — build report</p>
  <h1>Status</h1>
  <p class="muted">
    Generated ${escapeHtml(new Date().toISOString().replace("T", " ").slice(0, 19))} UTC, for the
    build in <code>${escapeHtml(checked)}/</code>. Rewritten from scratch every time a build or a
    check runs.${note ? `<br>${escapeHtml(note)}` : ""}
  </p>

  <p><span class="sev ${verdict.klass}">${escapeHtml(verdict.text)}</span></p>

  <div class="stats">
    ${stat("Pages", status.pageCount)}
    ${stat("Assets", status.assetCount)}
    ${stat("Asset weight", humanBytes(status.totalAssetBytes))}
    ${stat("Errors", errors.length)}
    ${stat("Warnings", warnings.length)}
    ${stat("Thumbnails made", images.totals.generated)}
    ${stat("Stale thumbnails", images.totals.stale ?? 0)}
  </div>

  ${section(
    "Thumbnail name collisions",
    "A <code>_min</code> counterpart is always a JPEG, so two images whose names differ only in " +
      "extension want the same file. Only the first one has a thumbnail; the second is showing " +
      "it. Rename one of each pair.",
    collisions.map(
      (entry) =>
        `<code>${escapeHtml(entry.first)}</code> and <code>${escapeHtml(entry.second)}</code> ` +
        `both reduce to <code>${escapeHtml(entry.target)}</code>`,
    ),
  )}

  ${section(
    "Stale thumbnails",
    "These <code>_min</code> files may no longer match the images they were made from, so cards, " +
      "galleries and social cards could be showing the previous picture. They are never " +
      "regenerated automatically, in case you compressed them by hand — delete one to have a " +
      "fresh counterpart made on the next build.",
    stale.map(
      (entry) =>
        `<code>${escapeHtml(entry.file)}</code> — ${entry.certain ? "replaced" : "possibly replaced"}: ` +
        `<span class="muted">${escapeHtml(entry.detail)}</span>`,
    ),
  )}

  ${section(
    "Thumbnails generated this build",
    "These <code>_min</code> files were missing and the builder made them. Commit them, or replace " +
      "them with your own compression, to keep builds reproducible.",
    generated.map((g) => `<code>${escapeHtml(g)}</code>`),
  )}

  <section>
    <h2>Findings</h2>
    ${
      rows
        ? `<div class="table">
      <table>
        <thead><tr><th>Level</th><th>Kind</th><th>Where</th><th>What</th></tr></thead>
        <tbody>${rows}
        </tbody>
      </table>
    </div>`
        : `<p>Nothing to report. Every link resolves, every image has a counterpart and alt text,
      and no page reaches outside this domain.</p>`
    }
  </section>

</main>
</body>
</html>
`;

  fs.writeFileSync(path.join(reportDir, "status_check.html"), html, "utf8");
}

export default runStatusCheck;
