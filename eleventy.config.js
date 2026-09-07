/**
 * Eleventy configuration for development (`bun run dev`, `npx @11ty/eleventy`).
 *
 * The compiled site_generate binary does NOT read this file — it builds the
 * same configuration in-process (see eleventy_binary/build.mjs), because a
 * config loaded from disk at runtime could not resolve its imports inside the
 * binary. Both paths call createConfig(), so they cannot drift apart.
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
