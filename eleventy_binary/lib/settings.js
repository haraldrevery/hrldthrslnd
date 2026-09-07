/**
 * site_settings.json loader.
 *
 * Read from the current working directory, never from a path baked into the
 * binary — the compiled site_generate must pick up whatever settings file sits
 * next to it in the project it is invoked in.
 */
import fs from "node:fs";
import path from "node:path";
import log from "./log.js";

/**
 * Exported so the status check can tell "the author chose this" from "the
 * template shipped with this". `url` and `name` in particular reach a crawler
 * before they reach a reader — canonical, og:url, every <loc> in the sitemap,
 * the publisher block in the JSON-LD and the Sitemap: line in robots.txt — and
 * nothing anywhere reported that they had never been changed.
 */
export const DEFAULTS = {
  name: "SITE_NAME",
  short_name: "SITE",
  description: "",
  url: "https://example.com",
  language: "en",
  // Full BCP-47 tag for rendered dates. Kept separate from `language` because a
  // bare language code is not a locale: the old code appended "-GB" to whatever
  // `language` held, which produced tags like "de-GB" and silently picked a
  // date order nobody asked for.
  date_locale: "en-GB",
  author: "",
  posts_per_page: 40,
  // One "default image", as website.md names it. The card and Open Graph
  // thumbnail is derived from it — resolveThumbnail() picks the _min
  // counterpart when one exists.
  default_image: "",
  nav: [],
  // The footer keeps its own list. A site's header carries the places a reader
  // is going; a footer carries the housekeeping — licence, status, feed — and
  // conflating the two forced every link to appear in both.
  footer_nav: [],
  footer_note: "",
  asset_folders: [
    "image", "image_min", "card_thumbnail", "svg",
    "font", "javascript", "video", "gif", "audio",
  ],
  status_check: {
    max_image_bytes: 900000,
    max_image_min_bytes: 80000,
    max_gif_bytes: 3000000,
    max_video_bytes: 40000000,
    // Audio had no limit at all while audio/ was a published asset folder, so
    // nothing ever reported an oversized one.
    max_audio_bytes: 20000000,
  },
};

/**
 * Parsed settings, keyed by the root they were read from. Keyed rather than a
 * single slot because a bare cache silently hands back another project's
 * settings the moment loadSettings() is called with a second root.
 */
const cache = new Map();

export function loadSettings(root = process.cwd()) {
  const key = path.resolve(root);
  if (cache.has(key)) return cache.get(key);

  const file = path.join(key, "site_settings.json");
  let parsed = {};
  if (fs.existsSync(file)) {
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      log.error("settings", "site_settings.json is not valid JSON", error.message);
    }
  } else {
    log.error("settings", "site_settings.json not found", `looked in ${key}`);
  }

  const settings = {
    ...DEFAULTS,
    ...parsed,
    status_check: { ...DEFAULTS.status_check, ...(parsed.status_check ?? {}) },
  };

  // Trailing slashes on the site URL produce doubled slashes in the sitemap
  // and in every absolute Open Graph URL, so normalise once here.
  settings.url = String(settings.url).replace(/\/+$/, "");

  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0);
  settings.nav = [...(settings.nav ?? [])].sort(byOrder);

  // An absent or empty footer_nav falls back to the header's links, which is
  // what every project written before the two lists were split still expects.
  const footerNav = [...(settings.footer_nav ?? [])].sort(byOrder);
  settings.footer_nav = footerNav.length > 0 ? footerNav : settings.nav;

  if (!Array.isArray(settings.asset_folders) || settings.asset_folders.length === 0) {
    log.warn("settings", "asset_folders is missing or empty, using the defaults");
    settings.asset_folders = DEFAULTS.asset_folders;
  }

  if (!Number.isFinite(settings.posts_per_page) || settings.posts_per_page < 1) {
    log.warn("settings", "posts_per_page is not a positive number, using 40");
    settings.posts_per_page = 40;
  }

  cache.set(key, settings);
  return settings;
}

export default loadSettings;
