/**
 * Stops `npx @11ty/eleventy` with directions, rather than letting it build.
 *
 * Plain Eleventy runs one of the five build phases. It exits cleanly and writes
 * a site that looks finished and is not: no generated thumbnails, no post-folder
 * or co-located note assets, placeholder checksums in download blocks, no status
 * check. The compiled site_generate and `bun run build` / `bun run dev` run the
 * whole build (eleventy_binary/build.mjs), with the same configuration this file
 * used to export.
 */
throw new Error(
  "This project is not built with plain Eleventy — it would skip thumbnails, " +
    "page assets and the status check. Run ./site_generate, or `bun run build` " +
    "(`bun run dev` for a drafts preview).",
);
