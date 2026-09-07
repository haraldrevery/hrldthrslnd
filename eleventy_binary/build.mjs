/**
 * site_generate — the whole build, in order.
 *
 *   1. thumbnails   generate any missing image_min/*_min.jpg
 *   2. css          run the Tailwind binary over the templates
 *   3. eleventy     render every page
 *   4. assets       copy post-folder assets that Eleventy does not own
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
import { getRegistry } from "./lib/slugs.js";
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
 * A draft folder is skipped entirely. This pass does not go through Eleventy,
 * so the drafts preprocessor never sees it: the page itself was correctly held
 * back while its photographs were copied to /<slug>/ beside it and served to
 * anyone who guessed the path. Unpublished is unpublished, assets included.
 */
function copyPostAssets(root, outputDir, includeDrafts) {
  const registry = getRegistry(root);
  let copied = 0;
  let skippedDrafts = 0;

  for (const record of registry.all) {
    if (record.kind !== "custom_post") continue;
    if (record.draft && !includeDrafts) {
      skippedDrafts += 1;
      continue;
    }

    const sourceDir = path.join(root, "input_custom_post", record.folder);
    const targetDir = path.join(outputDir, record.slug);

    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".html" || ext === ".json") continue;

      fs.mkdirSync(targetDir, { recursive: true });
      fs.copyFileSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name));
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
 */
function swapIntoPlace(outputDir, stagingDir, previousDir) {
  if (fs.existsSync(previousDir)) fs.rmSync(previousDir, { recursive: true, force: true });
  if (fs.existsSync(outputDir)) fs.renameSync(outputDir, previousDir);
  fs.renameSync(stagingDir, outputDir);
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
    const empty = { reports: [], totals: { generated: 0, existing: 0, skipped: 0, oversized: 0 } };
    const report = await runStatusCheck({ root, outputDir, settings, images: empty });
    writeStatusPage({ outputDir, settings, status: report, images: empty });
    const counts = log.summary();
    console.log(
      `\nChecked ${report.pageCount} page(s) — ` +
        `${counts.errors} error(s), ${counts.warnings} warning(s).`,
    );
    console.log("Report: _site/status_check.html\n");
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
  // Checksums are computed from the shipped bytes, so this has to come after
  // every asset is in place.
  fillDownloadHashes(stagingDir);

  console.log("\n[5/5] status check");
  const status = await runStatusCheck({ root, outputDir: stagingDir, settings, images });
  writeStatusPage({ outputDir: stagingDir, settings, status, images });

  // Everything succeeded, so the staged build becomes the site.
  swapIntoPlace(outputDir, stagingDir, previousDir);

  const seconds = ((Date.now() - started) / 1000).toFixed(2);
  const summary = log.summary();

  console.log(
    `\nBuilt ${status.pageCount} page(s) in ${seconds}s — ` +
      `${summary.errors} error(s), ${summary.warnings} warning(s).`,
  );
  console.log("Report: _site/status_check.html\n");

  // A warning is information, not a failure; only a hard error fails the build,
  // so a CI job can treat a non-zero exit as "the site did not build".
  process.exit(summary.errors > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("\nBuild failed:\n", error);
  discardStaging(path.join(process.cwd(), "_site.tmp"));
  console.error("\n_site was left as it was — the previous build is still published.\n");
  process.exit(1);
});
