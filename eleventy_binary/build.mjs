/**
 * site_generate — the whole build, in order.
 *
 *   1. thumbnails   generate any missing image_min/*_min.jpg
 *   2. css          run the Tailwind binary over the templates
 *   3. eleventy     render every page
 *   4. assets       copy the files beside a page that Eleventy does not own
 *   5. status check inspect the output and write _site/status_check.html
 *
 * CSS runs before Eleventy so the freshly built stylesheet is the one Eleventy
 * copies into _site. Flags: --drafts, --no-css, --quiet, --help.
 *
 * Steps 3 to 5 render into a staging directory which is swapped into place only
 * once they have all succeeded, so a failed build leaves the last good site
 * exactly where it was. See swapIntoPlace().
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

import Eleventy from "@11ty/eleventy";

import log from "./lib/log.js";
import { loadSettings } from "./lib/settings.js";
import { getRegistry, walkFiles, normaliseKey, publishedPathForSource } from "./lib/slugs.js";
import { createConfig } from "./lib/eleventy_config.js";
import { generateMissingThumbnails } from "./lib/images.js";
import { runStatusCheck, writeStatusPage } from "./lib/status_check.js";
import { fillDownloadHashes } from "./lib/downloads.js";

const HELP = `
site_generate — build the static site.

  site_generate [options]

  --drafts      include pages marked "draft: true" (for local preview only)
  --no-css      skip the Tailwind step and reuse the existing css/main.css
  --check-only  do not build; just inspect the existing _site and rewrite
                _site/status_check.html. This is what status_check.sh runs.
  --quiet       suppress notes; warnings and errors are always shown
  --help        show this message

Run it from the project root — the folder holding site_settings.json.
`;

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  if (flags.has("--help") || flags.has("-h")) {
    console.log(HELP.trim());
    process.exit(0);
  }
  return {
    includeDrafts: flags.has("--drafts"),
    css: !flags.has("--no-css"),
    checkOnly: flags.has("--check-only"),
    quiet: flags.has("--quiet"),
  };
}

/** The Tailwind standalone binary for this platform, if it is present. */
function tailwindBinary(root) {
  const candidates =
    process.platform === "win32"
      ? ["tailwindcss-windows-x64.exe", "tailwindcss.exe"]
      : ["tailwindcss-linux-x64", "tailwindcss"];

  for (const name of candidates) {
    const full = path.join(root, name);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function buildCss(root) {
  const binary = tailwindBinary(root);
  if (!binary) {
    log.warn(
      "css",
      "no Tailwind binary found — reusing the existing css/main.css",
      "expected tailwindcss-linux-x64 or tailwindcss-windows-x64.exe in the project root",
    );
    return false;
  }

  // Two outputs: minified for the site, expanded for troubleshooting.
  const runs = [
    { out: "css/main.css", args: ["--minify"] },
    { out: "css/main_max.css", args: [] },
  ];

  for (const run of runs) {
    const result = spawnSync(
      binary,
      ["-i", "css/input.css", "-o", run.out, ...run.args],
      { cwd: root, encoding: "utf8" },
    );

    if (result.error) {
      // A missing executable bit is by far the most common cause here, and the
      // message from spawn alone does not make that obvious.
      log.error("css", `could not run ${path.basename(binary)}`, result.error.message);
      return false;
    }
    if (result.status !== 0) {
      log.error("css", `Tailwind failed building ${run.out}`, (result.stderr || "").trim());
      return false;
    }
  }

  const bytes = fs.statSync(path.join(root, "css/main.css")).size;
  log.info(`  css/main.css ${Math.round(bytes / 1024)} kB, css/main_max.css written`);
  return true;
}

/**
 * Copy a post folder's assets to /<slug>/ in the output.
 *
 * Eleventy owns the .html file; everything beside it (images, audio, the page
 * builder's .json save file's companions) is copied here so relative paths
 * inside a page-builder page keep resolving. The .json save file itself is not
 * published — it is a working file, not part of the site.
 *
 * Subfolders are included. A post folder is a folder: media grouped under
 * media/ or img/ is the obvious way for a page builder to organise a page's
 * assets, and generateMissingThumbnails() already walks a post folder
 * recursively. The two disagreed — a nested photograph got its _min
 * counterpart generated in the source tree and then nothing copied either file
 * into _site, so the page shipped with every nested asset missing and only the
 * link check noticed.
 *
 * A draft folder is skipped entirely. This pass does not go through Eleventy,
 * so the drafts preprocessor never sees it: the page itself was correctly held
 * back while its photographs were copied to /<slug>/ beside it and served to
 * anyone who guessed the path. Unpublished is unpublished, assets included.
 */
function copyPostAssets(root, outputDir, includeDrafts) {
  const registry = getRegistry(root);
  let copied = 0;
  let skippedDrafts = 0;

  /**
   * Every file under a post folder that belongs in the published copy, as paths
   * relative to that folder.
   *
   * `.html` and `.json` are skipped at the TOP level only, because that is
   * where the two files the site does not publish live: the page itself, which
   * Eleventy owns, and the builder's save file. Deeper down there is no such
   * convention — a folder of assets is a folder of assets, and a page that
   * ships a data file or an embedded fragment should get it.
   *
   * Symlinks are neither followed nor copied: `isDirectory()` and `isFile()`
   * are both false for one, which is the behaviour this had before and also
   * what keeps a link back up the tree from making this recurse forever.
   */
  const collect = (dir, prefix = "") => {
    const found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        found.push(...collect(path.join(dir, entry.name), relative));
        continue;
      }
      if (!entry.isFile()) continue;
      if (prefix === "") {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === ".html" || ext === ".json") continue;
      }
      found.push(relative);
    }
    return found;
  };

  for (const record of registry.all) {
    if (record.kind !== "custom_post") continue;
    if (record.draft && !includeDrafts) {
      skippedDrafts += 1;
      continue;
    }

    const sourceDir = path.join(root, "input_custom_post", record.folder);
    const targetDir = path.join(outputDir, record.slug);

    for (const relative of collect(sourceDir)) {
      const target = path.join(targetDir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(sourceDir, relative), target);
      copied += 1;
    }
  }

  if (copied > 0) log.info(`  ${copied} post asset(s) copied`);
  if (skippedDrafts > 0) {
    log.note(
      "assets",
      `${skippedDrafts} draft post folder(s) skipped`,
      "their assets stay out of _site along with the page",
    );
  }
}

/**
 * Copy the files that sit beside a page in input_markdown/ or
 * input_custom_html/ to wherever that folder publishes.
 *
 * Eleventy owns the pages themselves and copies nothing else out of these
 * folders — they are not passthrough directories, because a passthrough copy
 * would also publish the .md sources. So a note that keeps its photographs in
 * the folder beside it needs this pass, or the page ships with every picture
 * missing.
 *
 * Where a file lands is decided by publishedPathForSource() rather than worked
 * out here, because the markdown pipeline has to reach exactly the same answer
 * when it rewrites `![](photo.jpg)` into a URL. Two passes computing the same
 * mapping separately is how you get a page whose images are all 404 while both
 * halves look correct on their own.
 *
 * A file already written by Eleventy is never overwritten. An asset cannot be
 * allowed to replace a rendered page: the folders share one namespace, so a
 * stray `index.html` dropped in a note folder would otherwise silently take the
 * place of a real one.
 *
 * A draft's neighbours stay unpublished along with it, on the same reasoning
 * copyPostAssets() gives — this pass does not go through Eleventy, so the drafts
 * preprocessor never sees these files. The unit is the folder: a folder whose
 * pages are ALL drafts publishes none of its files, and one that has a published
 * page in it publishes them all, because a picture in a mixed folder cannot be
 * attributed to one page rather than the other.
 */
function copyPageAssets(root, outputDir, includeDrafts) {
  const registry = getRegistry(root);

  // Folders whose every page is a draft; nothing in them is published.
  const pages = new Map();
  for (const record of registry.all) {
    if (record.kind === "custom_post") continue;
    const entry = pages.get(record.sourceDir) ?? { total: 0, drafts: 0 };
    entry.total += 1;
    if (record.draft) entry.drafts += 1;
    pages.set(record.sourceDir, entry);
  }
  const draftOnly = new Set(
    [...pages].filter(([, e]) => e.total > 0 && e.total === e.drafts).map(([dir]) => dir),
  );

  let copied = 0;
  let skippedDrafts = 0;
  const writtenBy = new Map();

  for (const source of ["input_markdown", "input_custom_html"]) {
    const dir = path.join(root, source);
    if (!fs.existsSync(dir)) continue;

    for (const relative of walkFiles(dir)) {
      const sourceRelative = `${source}/${relative}`;

      // The pages themselves are Eleventy's, and the directory data files are
      // build configuration rather than content.
      if (registry.byInputPath.has(normaliseKey(sourceRelative))) continue;
      if (/\.11tydata\.(js|json|cjs|mjs)$/i.test(relative)) continue;

      const cut = sourceRelative.lastIndexOf("/");
      if (!includeDrafts && draftOnly.has(sourceRelative.slice(0, cut))) {
        skippedDrafts += 1;
        continue;
      }

      const url = publishedPathForSource(sourceRelative, root);
      if (!url) continue;

      const target = path.join(outputDir, ...url.replace(/^\//, "").split("/"));

      const owner = writtenBy.get(target);
      if (owner) {
        log.warn(
          "assets",
          `two files publish to the same place, "${url}"`,
          `${owner} and ${sourceRelative} — the first one is the one that shipped`,
        );
        continue;
      }
      if (fs.existsSync(target)) {
        log.warn(
          "assets",
          `not copied, a rendered page already occupies "${url}"`,
          `${sourceRelative} — rename it, or the page it collides with`,
        );
        continue;
      }

      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, ...sourceRelative.split("/")), target);
      writtenBy.set(target, sourceRelative);
      copied += 1;
    }
  }

  if (copied > 0) log.info(`  ${copied} page asset(s) copied`);
  if (skippedDrafts > 0) {
    log.note(
      "assets",
      `${skippedDrafts} file(s) beside a draft skipped`,
      "they stay out of _site along with the page they belong to",
    );
  }
}

/**
 * Replace `outputDir` with `stagingDir`, keeping the old copy until the new one
 * is in place.
 *
 * The output used to be deleted before Eleventy ran, which meant *any* build
 * failure — a template error, a duplicate permalink, a bad date in one post —
 * destroyed the published site and left a directory holding nothing but the
 * assets that had been copied before the failure. Renaming instead keeps the
 * previous build intact right up to the moment a complete replacement exists.
 *
 * Renames rather than a recursive copy, so the swap is close to instantaneous
 * even for a site full of photographs, and both directories are siblings inside
 * the project root — the same filesystem, which is what makes rename atomic.
 *
 * The swap is two renames, and the gap between them is the one moment in the
 * build where the site does not exist. If the second one fails — a disk that
 * filled up, a virus scanner holding a handle open on Windows, a permission
 * change — the first is undone before the error is allowed out, so the live
 * site is back before anyone can look for it. Failing that, the error carries
 * the instructions for putting it back by hand and asks the caller NOT to
 * discard the staging directory, which at that point holds the only copy of
 * the new build.
 */
function swapIntoPlace(outputDir, stagingDir, previousDir) {
  if (fs.existsSync(previousDir)) fs.rmSync(previousDir, { recursive: true, force: true });

  const movedAside = fs.existsSync(outputDir);
  if (movedAside) fs.renameSync(outputDir, previousDir);

  try {
    fs.renameSync(stagingDir, outputDir);
  } catch (error) {
    if (movedAside) {
      try {
        fs.renameSync(previousDir, outputDir);
      } catch (restoreError) {
        error.keepStaging = true;
        error.recovery =
          `The site is not in place and could not be put back automatically.\n` +
          `  The previous build is in ${path.basename(previousDir)}\n` +
          `  The new build is in ${path.basename(stagingDir)}\n` +
          `Rename whichever you want published to ${path.basename(outputDir)}.\n` +
          `Restore failed with: ${restoreError.message}`;
        throw error;
      }
    }
    throw error;
  }

  fs.rmSync(previousDir, { recursive: true, force: true });
}

/** Remove a staging directory left behind by a failed or interrupted build. */
function discardStaging(stagingDir) {
  try {
    if (fs.existsSync(stagingDir)) fs.rmSync(stagingDir, { recursive: true, force: true });
  } catch {
    // Nothing to do about it, and it must not mask the real build error.
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const root = process.cwd();
  log.quiet = options.quiet;

  if (!fs.existsSync(path.join(root, "site_settings.json"))) {
    console.error(
      "site_settings.json not found in " + root + "\n" +
      "Run site_generate from the project root.",
    );
    process.exit(1);
  }

  const started = Date.now();
  const settings = loadSettings(root);
  const outputDir = path.join(root, "_site");

  // --check-only inspects what is already in _site and stops. Nothing is
  // rebuilt, so it can be run against a deployed copy without changing it.
  if (options.checkOnly) {
    if (!fs.existsSync(outputDir)) {
      console.error("_site does not exist — run site_generate first.");
      process.exit(1);
    }
    console.log(`\nsite_generate --check-only — ${settings.name}\n`);
    const empty = { reports: [], totals: { generated: 0, existing: 0, skipped: 0, oversized: 0, stale: 0 } };
    const report = await runStatusCheck({ root, outputDir, settings, images: empty });
    const written = writeStatusPage({ outputDir, settings, status: report, images: empty });
    const counts = log.summary();
    console.log(
      `\nChecked ${report.pageCount} page(s) — ` +
        `${counts.errors} error(s), ${counts.warnings} warning(s).`,
    );
    console.log(
      written
        ? "Report: _site/status_check.html\n"
        : "Report NOT written — /status_check.html belongs to another page.\n",
    );
    process.exit(counts.errors > 0 ? 1 : 0);
  }

  console.log(`\nsite_generate — ${settings.name}`);
  if (options.includeDrafts) console.log("  including drafts (preview build)");

  // Render into a staging directory, not over the live one. Building into an
  // empty directory is still what keeps a page from a previous build — a draft
  // included with --drafts, a renamed post, a tag page for a tag nobody uses any
  // more — from staying published; doing it beside the output rather than on top
  // of it is what keeps a failed build from taking the site down with it.
  const stagingDir = path.join(root, "_site.tmp");
  const previousDir = path.join(root, "_site.previous");
  discardStaging(stagingDir);

  console.log("\n[1/5] thumbnails");
  const images = await generateMissingThumbnails(root);

  console.log("\n[2/5] css");
  if (options.css) buildCss(root);
  else log.info("  skipped (--no-css)");

  console.log("\n[3/5] pages");
  const eleventy = new Eleventy(root, stagingDir, {
    quietMode: true,
    configPath: false,
    // The output directory is passed to the config too: it sets it through the
    // UserConfig API, which would otherwise put the pages back in _site and
    // defeat the staging entirely.
    config: createConfig({
      includeDrafts: options.includeDrafts,
      root,
      outputDir: path.relative(root, stagingDir),
    }),
  });
  await eleventy.write();

  console.log("\n[4/5] assets");
  copyPostAssets(root, stagingDir, options.includeDrafts);
  copyPageAssets(root, stagingDir, options.includeDrafts);
  // Checksums are computed from the shipped bytes, so this has to come after
  // every asset is in place.
  fillDownloadHashes(stagingDir);

  console.log("\n[5/5] status check");
  const status = await runStatusCheck({
    root,
    outputDir: stagingDir,
    settings,
    images,
    includeDrafts: options.includeDrafts,
  });
  const reportWritten = writeStatusPage({ outputDir: stagingDir, settings, status, images });

  // Everything succeeded, so the staged build becomes the site.
  swapIntoPlace(outputDir, stagingDir, previousDir);

  const seconds = ((Date.now() - started) / 1000).toFixed(2);
  const summary = log.summary();

  console.log(
    `\nBuilt ${status.pageCount} page(s) in ${seconds}s — ` +
      `${summary.errors} error(s), ${summary.warnings} warning(s).`,
  );
  console.log(
    reportWritten
      ? "Report: _site/status_check.html\n"
      : "Report NOT written — /status_check.html belongs to another page.\n",
  );

  // A warning is information, not a failure; only a hard error fails the build,
  // so a CI job can treat a non-zero exit as "the site did not build".
  process.exit(summary.errors > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("\nBuild failed:\n", error);

  // Only discard the staging directory while it is still just a work area.
  // If the swap got far enough to move the live site aside and could not put
  // it back, staging holds the only copy of the new build and deleting it here
  // would turn a recoverable failure into a lost one — while printing a
  // reassurance that is no longer true.
  if (error?.keepStaging) {
    console.error(`\n${error.recovery}\n`);
  } else {
    discardStaging(path.join(process.cwd(), "_site.tmp"));
    console.error("\n_site was left as it was — the previous build is still published.\n");
  }
  process.exit(1);
});
