/**
 * Eleventy configuration for `npx @11ty/eleventy`.
 *
 * The compiled site_generate binary does NOT read this file — it builds the
 * same configuration in-process (see eleventy_binary/build.mjs), because a
 * config loaded from disk at runtime could not resolve its imports inside the
 * binary. Both paths call createConfig(), so the CONFIGURATION cannot drift.
 *
 * The BUILD still does, and badly, so do not treat `npx @11ty/eleventy` as a
 * preview of the site. Rendering pages is one of five phases; the other four
 * live in build.mjs and none of them runs here. What you get is a site with no
 * generated thumbnails, every co-located note asset and post-folder asset
 * missing, download blocks showing placeholder checksums instead of real ones,
 * and no status check. Use `bun run dev` for a preview that is actually the
 * site — it runs the whole build, drafts included, and serves it.
 *
 * KNOWN LIMITATION, --watch and --serve only: the slug registry is built once,
 * when createConfig() runs, and the config function closes over it. A post
 * ADDED while the watcher is running is therefore not in it, gets no permalink,
 * and — because Eleventy writes nothing for `permalink: false` — silently does
 * not appear at all. Editing an existing post is fine; adding one means
 * restarting the watcher.
 *
 * There used to be resetRegistry()/resetSettings()/resetImageSizeCache()
 * exports that looked like the fix for this. Nothing ever called them, and
 * calling them would not have worked either: clearing the caches leaves the
 * stale registry captured in this closure, so the two would simply disagree.
 * They have been removed rather than left to imply a working watch mode. A real
 * fix means resolving the registry lazily, per build, not clearing a cache.
 */
import { createConfig } from "./eleventy_binary/lib/eleventy_config.js";

const includeDrafts = process.env.ELEVENTY_DRAFTS === "true";

export default createConfig({ includeDrafts });
