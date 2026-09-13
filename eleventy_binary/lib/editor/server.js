/**
 * The page builder's server: `site_generate --edit`.
 *
 * A small HTTP server on the loopback address that serves the editor page and
 * answers its requests. It runs the same validator, renderer, codecs and
 * checks the build runs, on the same files, in the same process — there is no
 * second copy of anything and no bridge to keep in step. The page itself is
 * three static files embedded in the binary the way the WASM codecs are.
 *
 * What it will not do:
 *
 *   - listen anywhere but 127.0.0.1;
 *   - change a file except through store.js, which never deletes and never
 *     overwrites an upload;
 *   - build in-process. The Build button runs the generator as a child, so
 *     the build's own caches are fresh every time and a half-finished edit in
 *     here cannot leak into it;
 *   - accept a state-changing request without the `x-editor` header. A page
 *     on another origin cannot add a custom header to a request without a
 *     preflight, and this server answers no preflight, so a malicious site the
 *     author happens to have open cannot post into it.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import indexHtml from "../../editor/index.html" with { type: "file" };
import editorJs from "../../editor/editor.js" with { type: "file" };
import editorCss from "../../editor/editor.css" with { type: "file" };
import canvasJs from "../../editor/canvas.js" with { type: "file" };

import log from "../log.js";
import { loadSettings } from "../settings.js";
import { getRegistry, sourcePathForPublished } from "../slugs.js";
import { createMarkdownLibrary } from "../markdown.js";
import { injectAssets } from "../assets.js";
import { extensionOf, minFileName, isRaster, isMinName, VIDEO_EXT, AUDIO_EXT } from "../paths.js";
import { resolveThumbnail, readImageHeader } from "../imagesize.js";
import { BLOCKS, META_FIELDS, COLUMN_TYPES, FORMAT_VERSION } from "../blocks/catalogue.js";
import { validatePost, verdict } from "../blocks/validate.js";
import { renderPost } from "../blocks/render.js";
import { importMedia } from "./import_media.js";
import {
  StoreError, listPosts, readPost, writePost, createPost, listAssets, writeAsset,
  freeName, revisionsOf, readRevision, assertFolderName, describeFile,
} from "./store.js";

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".mp4": "video/mp4", ".webm": "video/webm",
  ".mov": "video/quicktime", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4",
  ".flac": "audio/flac", ".opus": "audio/ogg", ".txt": "text/plain; charset=utf-8", ".pdf": "application/pdf",
};

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const fail = (status, message) => json({ error: message }, status);

export async function startEditor({ root, port = 8484 }) {
  const settings = loadSettings(root);
  const md = createMarkdownLibrary(root);
  const origin = `http://127.0.0.1:${port}`;

  /** The folders the site serves verbatim, plus the two the build writes into. */
  const staticFolders = new Set([...(settings.asset_folders ?? []), "css", "icon"]);

  function serveFile(file) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return null;
    return new Response(Bun.file(file), {
      headers: { "content-type": MIME[extensionOf(file)] ?? "application/octet-stream", "cache-control": "no-store" },
    });
  }

  /** A site URL, answered from where the file is NOW rather than from _site. */
  function serveSitePath(pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return null;
    }
    if (decoded.includes("..") || decoded.includes("\0")) return null;

    const [, first, ...rest] = decoded.split("/");
    if (staticFolders.has(first)) return serveFile(path.join(root, first, ...rest));
    if (rest.length === 0 && /^(favicon\.(ico|svg)|apple-touch-icon\.png)$/.test(first)) return serveFile(path.join(root, "icon", first));

    // A post folder's assets, a note's pictures: through the registry, which
    // is what the build consults too. Rebuilt on every request because the
    // editor creates folders while it runs; the registry is cheap to build.
    const source = sourcePathForPublished(decoded, root);
    return source ? serveFile(source) : null;
  }

  /**
   * One folder of the site-wide library, for the picker.
   *
   * Read-only, and confined to the asset folders site_settings.json names,
   * minus the ones that hold no pictures a page would pick (the thumbnail
   * mirror, fonts, scripts). `dir` is checked segment by segment before it
   * becomes a path, so a request cannot list anything outside those folders.
   */
  const LIBRARY_EXCLUDE = new Set(["image_min", "font", "javascript", "css", "icon"]);
  function libraryFolders() {
    return (settings.asset_folders ?? []).filter((d) => !LIBRARY_EXCLUDE.has(d) && fs.existsSync(path.join(root, d)));
  }
  function siteAssets(dir) {
    const clean = String(dir ?? "").replace(/^\/+|\/+$/g, "");
    if (!clean) return { dir: "", parent: null, dirs: libraryFolders().map((d) => ({ name: d, path: d })), files: [] };

    const segments = clean.split("/");
    if (!libraryFolders().includes(segments[0]) || segments.some((s) => !s || s === "." || s === ".." || s.startsWith("."))) {
      throw new StoreError(400, "not a library folder");
    }
    const full = path.join(root, ...segments);
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) throw new StoreError(404, "no such folder");

    const dirs = [];
    const files = [];
    for (const entry of fs.readdirSync(full, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (entry.name.startsWith(".")) continue;
      const rel = `${clean}/${entry.name}`;
      if (entry.isDirectory()) { dirs.push({ name: entry.name, path: rel }); continue; }
      if (!entry.isFile() || isMinName(entry.name)) continue;
      const ext = extensionOf(entry.name);
      const kind = isRaster(entry.name) || ext === ".gif" || ext === ".svg" ? "image" : VIDEO_EXT.has(ext) ? "video" : AUDIO_EXT.has(ext) ? "audio" : "file";
      const url = `/${rel.split("/").map(encodeURIComponent).join("/")}`;
      const size = kind === "image" ? readImageHeader(path.join(full, entry.name)) : null;
      files.push({
        name: entry.name,
        src: `/${rel}`,
        url,
        thumb: kind === "image" ? resolveThumbnail(url, root) : null,
        kind,
        bytes: fs.statSync(path.join(full, entry.name)).size,
        width: size?.width ?? null,
        height: size?.height ?? null,
        ...(kind === "image" ? describeFile(path.join(full, entry.name)) : {}),
      });
    }
    return { dir: clean, parent: segments.length > 1 ? segments.slice(0, -1).join("/") : "", dirs, files };
  }

  function previewDocument(doc, folder) {
    const registry = getRegistry(root);
    const record = registry.all.find((r) => r.kind === "custom_post" && r.folder === folder);
    const slug = record?.slug ?? folder;
    // Rendered with the editor's paths on every block, and the canvas overlay
    // appended. Neither exists in a build: this markup is for the iframe only.
    const { html, warnings } = renderPost(doc, { md, slug, inputPath: `input_custom_post/${folder}/${folder}.json`, editable: true, site: { author: settings.author } });
    const page =
      `<!doctype html>\n<html lang="${settings.language}">\n<head>\n<meta charset="utf-8">\n` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Preview</title>\n` +
      `<!--vendor-css-->\n<link rel="stylesheet" href="/css/main.css">\n</head>\n` +
      `<body class="grain">\n<main id="main">\n${html}\n</main>\n` +
      `<script src="/canvas.js" defer></script>\n</body>\n</html>\n`;
    return { html: injectAssets(page), warnings, slug };
  }

  function checkDocument(doc, folder) {
    const assets = listAssets(root, folder).map((a) => a.name);
    const findings = validatePost(doc, { assets });
    return { verdict: verdict(findings), findings };
  }

  /** The generator, as a child process. */
  function generatorCommand() {
    const exe = process.execPath;
    if (/^bun(\.exe)?$/i.test(path.basename(exe))) {
      return [exe, "run", path.resolve(import.meta.dirname, "../../build.mjs")];
    }
    return [exe];
  }

  async function runBuild({ drafts }) {
    const cmd = [...generatorCommand(), "--json", "--quiet"];
    if (drafts) cmd.push("--drafts");
    const child = Bun.spawn({ cmd, cwd: root, stdout: "pipe", stderr: "pipe" });
    const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const code = await child.exited;

    let report = null;
    const lines = out.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (lines[i].startsWith("{")) {
        try { report = JSON.parse(lines[i]); } catch { /* not the report */ }
        break;
      }
    }
    return { code, output: `${out}${err ? `\n${err}` : ""}`, report };
  }

  async function handleApi(req, url) {
    const parts = url.pathname.split("/").filter(Boolean); // ["api", ...]
    const method = req.method;

    if (method !== "GET") {
      if (req.headers.get("x-editor") !== "1") return fail(403, "missing x-editor header");
      const from = req.headers.get("origin");
      if (from && from !== origin && from !== `http://localhost:${port}`) return fail(403, "wrong origin");
    }

    const body = async () => {
      try {
        return await req.json();
      } catch {
        throw new StoreError(400, "the request body is not JSON");
      }
    };

    if (parts[1] === "site" && method === "GET") {
      return json({
        name: settings.name,
        url: settings.url,
        language: settings.language,
        format: FORMAT_VERSION,
        catalogue: BLOCKS,
        metaFields: META_FIELDS,
        columnTypes: COLUMN_TYPES,
        budgets: settings.status_check,
        posts: listPosts(root),
      });
    }

    if (parts[1] === "posts") {
      if (parts.length === 2 && method === "GET") return json({ posts: listPosts(root) });
      if (parts.length === 2 && method === "POST") {
        const { folder, title } = await body();
        assertFolderName(folder);
        const today = new Date().toISOString().slice(0, 10);
        const doc = {
          format: FORMAT_VERSION,
          meta: { title: String(title ?? folder), date: today, description: "", tags: [], category: [], image: "", draft: true },
          blocks: [],
        };
        createPost(root, folder, doc);
        return json({ folder, doc, posts: listPosts(root) }, 201);
      }

      const folder = assertFolderName(parts[2]);
      const action = parts[3];

      if (!action && method === "GET") {
        const { doc } = readPost(root, folder);
        const record = getRegistry(root).all.find((r) => r.kind === "custom_post" && r.folder === folder);
        return json({ folder, slug: record?.slug ?? folder, doc, assets: listAssets(root, folder, { described: true }), revisions: revisionsOf(root, folder), check: checkDocument(doc, folder) });
      }
      if (!action && method === "PUT") {
        const { doc, revision } = await body();
        const written = writePost(root, folder, doc, { revision: revision === true });
        return json({ saved: true, ...written, check: checkDocument(doc, folder) });
      }
      if (action === "check" && method === "POST") {
        const { doc } = await body();
        return json(checkDocument(doc, folder));
      }
      if (action === "preview" && method === "POST") {
        const { doc } = await body();
        const { html, warnings, slug } = previewDocument(doc, folder);
        return json({ html, warnings, slug });
      }
      if (action === "assets" && method === "GET") return json({ assets: listAssets(root, folder, { described: true }) });
      if (action === "assets" && method === "POST") {
        const form = await req.formData();
        const results = [];
        for (const entry of form.getAll("file")) {
          if (!(entry instanceof File)) continue;
          const bytes = Buffer.from(await entry.arrayBuffer());
          const imported = await importMedia({ name: entry.name, bytes, settings });
          const written = [];
          // The primary's final name decides the counterpart's: the pair is
          // renamed together or not at all.
          const primaryFile = imported.files.find((f) => f.role === "primary");
          const primaryName = primaryFile ? freeName(root, folder, primaryFile.name) : null;
          if (primaryFile && primaryName !== primaryFile.name) {
            imported.notices.push({ level: "note", message: `saved as ${primaryName}`, detail: `${primaryFile.name} was already in the folder; nothing is overwritten` });
          }
          for (const file of imported.files) {
            const name = file.role === "min" ? minFileName(primaryName) : primaryName;
            writeAsset(root, folder, name, file.bytes);
            written.push(name);
          }
          results.push({ original: entry.name, primary: primaryName, written, kind: imported.kind, notices: imported.notices, suggested: imported.suggested });
        }
        return json({ results, assets: listAssets(root, folder, { described: true }) });
      }
      if (action === "revisions" && parts[4] && method === "GET") {
        return json({ doc: readRevision(root, folder, parts[4]) });
      }
    }

    if (parts[1] === "library" && method === "GET") {
      return json(siteAssets(url.searchParams.get("dir")));
    }

    if (parts[1] === "build" && method === "POST") {
      const { drafts } = await body();
      return json(await runBuild({ drafts: drafts === true }));
    }

    return fail(404, "no such endpoint");
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    // A build can take a while and an upload can be large.
    idleTimeout: 255,
    maxRequestBodySize: 2 * 1024 * 1024 * 1024,
    async fetch(req) {
      const url = new URL(req.url);
      try {
        if (url.pathname === "/") return new Response(Bun.file(indexHtml), { headers: { "content-type": MIME[".html"], "cache-control": "no-store" } });
        if (url.pathname === "/editor.js") return new Response(Bun.file(editorJs), { headers: { "content-type": MIME[".js"], "cache-control": "no-store" } });
        if (url.pathname === "/editor.css") return new Response(Bun.file(editorCss), { headers: { "content-type": MIME[".css"], "cache-control": "no-store" } });
        if (url.pathname === "/canvas.js") return new Response(Bun.file(canvasJs), { headers: { "content-type": MIME[".js"], "cache-control": "no-store" } });
        if (url.pathname.startsWith("/api/")) return await handleApi(req, url);
        if (req.method === "GET") return serveSitePath(url.pathname) ?? new Response("not found", { status: 404 });
        return fail(405, "method not allowed");
      } catch (error) {
        if (error instanceof StoreError) return fail(error.status, error.message);
        log.error("editor", `${req.method} ${url.pathname} failed`, error.stack ?? error.message);
        return fail(500, error.message);
      }
    },
  });

  console.log(`\nPage builder — ${settings.name}\n\n  ${origin}\n\n  Editing input_custom_post/ in ${root}\n  Press Ctrl-C to stop.\n`);
  openBrowser(origin);
  return server;
}

/** Best effort, and silent on failure: the URL is already printed. */
function openBrowser(url) {
  const cmd =
    process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : process.platform === "darwin" ? ["open", url]
    : ["xdg-open", url];
  try {
    Bun.spawn({ cmd, stdout: "ignore", stderr: "ignore" });
  } catch {
    /* no browser to open, or no such command */
  }
}

export default startEditor;
