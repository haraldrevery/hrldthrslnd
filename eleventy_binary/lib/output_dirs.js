/**
 * The folders a build writes, beside the sources in the project root.
 *
 *   _site/          the site, as published. Only a build without --drafts
 *                   writes here, so it never contains an unpublished page.
 *   _site_drafts/   a --drafts preview, drafts included. Never deploy it.
 *   _site_report/   the build report (status_check.html and .json). Kept out
 *                   of both sites, because it names draft files and internal
 *                   paths that are nobody's business but the author's.
 *
 * A build stages into "<folder>.tmp" and keeps the old copy as
 * "<folder>.previous" during the swap; see swapIntoPlace() in build.mjs.
 *
 * Every name starts with "_site" on purpose: .gitignore and the Eleventy
 * ignores match that prefix too, so a scratch copy made by hand is ignored as
 * well. The explicit entries are what the code relies on.
 */
export const OUTPUT_DIR = "_site";
export const DRAFTS_DIR = "_site_drafts";
export const REPORT_DIR = "_site_report";

/** Where a build with or without --drafts writes its pages. */
export const outputDirFor = (includeDrafts) => (includeDrafts ? DRAFTS_DIR : OUTPUT_DIR);
