/**
 * The page builder.
 *
 * The page is the interface: the canvas in the middle is the rendered post,
 * made clickable by canvas.js, and the inspector on the right edits whatever
 * is selected in it. Pictures are dropped, picked from a library or imported
 * in bulk; nothing asks for a file name to be typed.
 *
 * One file, no framework, no build step. The document in memory is the truth
 * while the page is open; every edit re-checks it, re-renders the canvas and,
 * after a pause, saves it. Undo and redo are whole-document snapshots.
 *
 * Talks to the server that served it through `api` below, and to the canvas
 * through postMessage. The catalogue the server hands over is the only source
 * of what blocks exist and what fields they have.
 */
(function () {
  "use strict";

  /* ============================================================== helpers */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const PROPS = new Set(["value", "checked", "disabled", "hidden", "selected", "textContent", "innerHTML", "multiple"]);

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const svg = (paths) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("viewBox", "0 0 20 20");
    el.innerHTML = paths;
    return el;
  };
  const ICON = {
    back: '<path d="M12 4 6 10l6 6"/>',
    copy: '<rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M13 7V4.5A1.5 1.5 0 0 0 11.5 3h-7A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13H7"/>',
    trash: '<path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/>',
    up: '<path d="M10 16V4M5 9l5-5 5 5"/>',
    down: '<path d="M10 4v12M5 11l5 5 5-5"/>',
    left: '<path d="M12 4 6 10l6 6"/>',
    right: '<path d="m8 4 6 6-6 6"/>',
    close: '<path d="M5 5l10 10M15 5 5 15"/>',
    plus: '<path d="M10 4v12M4 10h12"/>',
    upload: '<path d="M10 13V3M6 7l4-4 4 4M4 13v3h12v-3"/>',
    image: '<rect x="3" y="4" width="14" height="12" rx="1.5"/><circle cx="7.5" cy="8.5" r="1.5"/><path d="m3.5 15 4.5-4.5 3 3 2-2 3.5 3.5"/>',
    folder: '<path d="M3 6a1.5 1.5 0 0 1 1.5-1.5H8l2 2h5.5A1.5 1.5 0 0 1 17 8v6.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z"/>',
    swap: '<path d="M4 7h12l-3-3M16 13H4l3 3"/>',
  };
  const icon = (name) => svg(ICON[name]);
  const iconButton = (name, title, onclick, opts = {}) =>
    h("button", { type: "button", class: `icon-btn icon-btn-sm${opts.danger ? " danger" : ""}`, title, "aria-label": title, disabled: opts.disabled, onclick }, icon(name));

  const TYPE_GLYPH = { hero: "H1", heading: "H", text: "¶", gallery: "▦", video: "▶", audio: "♪", download: "↓", faq: "?", feature: "◧", raw_html: "</>", columns: "▥" };

  function debounce(fn, ms) {
    let t = null;
    const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    d.flush = () => { clearTimeout(t); fn(); };
    return d;
  }

  const EXT = (name) => { const m = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(String(name)); return m ? m[1].toLowerCase() : ""; };
  const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "svg", "avif"]);
  const VIDEO_EXT = new Set(["mp4", "webm", "ogv", "mov", "m4v"]);
  const AUDIO_EXT = new Set(["mp3", "ogg", "wav", "m4a", "flac", "opus"]);
  const kindOf = (name) => { const e = EXT(name); return IMAGE_EXT.has(e) ? "image" : VIDEO_EXT.has(e) ? "video" : AUDIO_EXT.has(e) ? "audio" : "file"; };
  const baseName = (src) => { const s = String(src || ""); try { return decodeURIComponent(s.slice(s.lastIndexOf("/") + 1)); } catch { return s.slice(s.lastIndexOf("/") + 1); } };
  const kb = (bytes) => bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} kB`;

  /* ================================================================== api */
  async function unwrap(res) {
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
    return data;
  }
  const api = {
    get: (url) => fetch(url, { cache: "no-store" }).then(unwrap),
    send: (method, url, body) => fetch(url, { method, headers: { "content-type": "application/json", "x-editor": "1" }, body: JSON.stringify(body ?? {}) }).then(unwrap),
    upload(folder, file) {
      const form = new FormData();
      form.append("file", file, file.name);
      return fetch(`/api/posts/${encodeURIComponent(folder)}/assets`, { method: "POST", headers: { "x-editor": "1" }, body: form }).then(unwrap);
    },
  };

  /* ================================================================ state */
  const state = {
    site: null,
    folder: null,
    slug: null,
    doc: null,
    assets: [],
    revisions: [],
    findings: [],
    version: 0,
    savedVersion: 0,
    saving: false,
    saveError: null,
    snapshot: null,
    history: [],
    future: [],
    sel: null, // { path, image } — image is an index into the block's images
    tab: "block",
    device: "desktop",
    canvasReady: false,
    canvasSheets: "",
    canvasScroll: 0,
    described: {}, // site-library URL -> { title, caption } from the file's own metadata
    filesSel: new Set(),
  };
  const spec = (type) => state.site.catalogue.find((b) => b.type === type);
  const isDirty = () => state.version !== state.savedVersion;

  /**
   * Whether a field is part of the block as it renders: the catalogue's
   * `variants`, read the way fieldApplies() in catalogue.js reads it. The
   * catalogue arrives here as data, so the rule is restated, not imported.
   */
  function fieldShown(s, f, block) {
    if (!f.variants) return true;
    const v = s.fields.find((x) => x.name === "variant");
    const current = v && v.options.some((o) => o.value === block.variant) ? block.variant : v?.default;
    return f.variants.includes(current);
  }

  /* ---------------------------------------------------------------- paths */
  function parsePath(path) {
    const out = [];
    String(path).replace(/([^.[\]]+)|\[(\d+)\]/g, (m, key, idx) => { out.push(idx !== undefined ? Number(idx) : key); return m; });
    return out;
  }
  function getAt(obj, path) {
    return parsePath(path).reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }
  function setAt(obj, path, value) {
    const keys = parsePath(path);
    const last = keys.pop();
    const parent = keys.reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (parent != null) parent[last] = value;
  }
  const blockPathOf = (path) => (/^blocks\[\d+\](\.items\[\d+\])?/.exec(String(path)) || [null])[0];
  const topIndexOf = (path) => Number((/^blocks\[(\d+)\]/.exec(String(path)) || [])[1]);
  const isNested = (path) => /\.items\[\d+\]$/.test(String(path));

  /* ============================================================== history */
  function snapshotNow() { state.snapshot = clone(state.doc); }
  /** Close the current step: whatever changed since the last boundary becomes one undo. */
  function commit() {
    if (!state.doc || !state.snapshot || same(state.snapshot, state.doc)) return;
    state.history.push(state.snapshot);
    if (state.history.length > 300) state.history.shift();
    state.future = [];
    snapshotNow();
    renderHistory();
  }
  /** A structural change as one undoable step. */
  function mutate(fn, { inspector = true } = {}) {
    commit();
    fn();
    commit();
    changed();
    if (inspector) renderInspector();
  }
  function undo() {
    commit();
    if (!state.history.length) return;
    state.future.push(clone(state.doc));
    state.doc = state.history.pop();
    snapshotNow();
    afterDocSwap();
  }
  function redo() {
    if (!state.future.length) return;
    state.history.push(clone(state.doc));
    state.doc = state.future.pop();
    snapshotNow();
    afterDocSwap();
  }
  function afterDocSwap() {
    if (state.sel && getAt(state.doc, state.sel.path) === undefined) state.sel = null;
    changed();
    renderInspector();
    renderHistory();
    tellCanvasSelection(false);
  }
  function renderHistory() {
    $("#undo").disabled = state.history.length === 0 && (!state.snapshot || same(state.snapshot, state.doc));
    $("#redo").disabled = state.future.length === 0;
  }

  /* ================================================== change, check, save */
  const scheduleCheck = debounce(runCheck, 400);
  const schedulePreview = debounce(refreshPreview, 300);
  const scheduleSave = debounce(() => save(false), 1800);

  /** Something in the document changed. Text fields call this on every keystroke. */
  function changed() {
    state.version += 1;
    renderSaveState();
    renderHistory();
    scheduleCheck();
    schedulePreview();
    scheduleSave();
  }

  async function runCheck() {
    if (!state.doc) return;
    try {
      const result = await api.send("POST", `/api/posts/${state.folder}/check`, { doc: state.doc });
      state.findings = result.findings;
      renderChecks();
      markFindings();
      if (!state.sel && state.tab === "block") renderInspector();
    } catch (error) {
      toast(`Checking failed: ${error.message}`, { level: "error" });
    }
  }

  async function save(explicit) {
    if (!state.doc) return;
    if (state.saving) { scheduleSave(); return; }
    if (!explicit && !isDirty()) return;
    state.saving = true;
    state.saveError = null;
    const version = state.version;
    renderSaveState();
    try {
      const result = await api.send("PUT", `/api/posts/${state.folder}`, { doc: state.doc, revision: explicit === true });
      state.savedVersion = Math.max(state.savedVersion, version);
      state.findings = result.check.findings;
      renderChecks();
      markFindings();
      if (result.revision) {
        await refreshRevisions();
        if (explicit) toast("Saved, and the previous version kept in History");
      } else if (explicit) {
        toast("Saved");
      }
      refreshPostList();
    } catch (error) {
      state.saveError = error.message;
      toast(`Could not save: ${error.message}`, { level: "error", sticky: true });
    } finally {
      state.saving = false;
      renderSaveState();
      if (isDirty()) scheduleSave();
    }
  }

  function renderSaveState() {
    const el = $("#save-state");
    el.className = "save-state";
    if (state.saveError) { el.textContent = "Not saved"; el.classList.add("is-error"); el.title = state.saveError; }
    else if (state.saving) { el.textContent = "Saving…"; el.title = ""; }
    else if (isDirty()) { el.textContent = "Edited"; el.classList.add("is-dirty"); el.title = "Autosaves in a moment"; }
    else { el.textContent = "Saved"; el.title = "Everything is on disk"; }
  }

  /* =============================================================== canvas */
  const frame = () => $("#canvas");
  function tellCanvas(message) {
    const win = frame().contentWindow;
    if (win && state.canvasReady) win.postMessage({ source: "editor", ...message }, location.origin);
  }
  function tellCanvasSelection(scroll) {
    const sel = state.sel;
    tellCanvas({ type: "select", path: sel ? sel.path : null, image: sel && sel.image != null ? `${sel.path}.images[${sel.image}]` : null, scroll: Boolean(scroll) });
  }

  async function refreshPreview() {
    if (!state.doc) return;
    let result;
    try {
      result = await api.send("POST", `/api/posts/${state.folder}/preview`, { doc: state.doc });
    } catch (error) {
      toast(`Preview failed: ${error.message}`, { level: "error" });
      return;
    }
    state.slug = result.slug;
    renderPostSwitch();
    const parsed = new DOMParser().parseFromString(result.html, "text/html");
    const sheets = $$('link[rel="stylesheet"]', parsed).map((l) => l.getAttribute("href")).join("|");
    // The same stylesheets as the page already has: swap the content in place,
    // so the canvas neither flashes nor loses its scroll position. A new
    // stylesheet (the first maths, the first lightbox) needs a real load.
    if (state.canvasReady && sheets === state.canvasSheets) {
      tellCanvas({ type: "update", html: parsed.querySelector("main").innerHTML });
      tellCanvasSelection(false);
      return;
    }
    try { state.canvasScroll = frame().contentWindow.scrollY || 0; } catch { /* first load */ }
    state.canvasSheets = sheets;
    state.canvasReady = false;
    frame().srcdoc = result.html;
  }

  window.addEventListener("message", (e) => {
    if (e.origin !== location.origin || !e.data || e.data.source !== "canvas") return;
    const m = e.data;
    switch (m.type) {
      case "ready":
        state.canvasReady = true;
        tellCanvas({ type: "labels", labels: Object.fromEntries(state.site.catalogue.map((b) => [b.type, b.label])), empty: "Empty column" });
        tellCanvas({ type: "scroll", y: state.canvasScroll });
        tellCanvasSelection(false);
        break;
      case "select": {
        const image = m.image ? Number((/\.images\[(\d+)\]$/.exec(m.image) || [])[1]) : null;
        select(m.path, Number.isFinite(image) ? image : null, { fromCanvas: true });
        break;
      }
      case "move": moveBlock(m.from, m.to); break;
      case "duplicate": duplicateBlock(m.path); break;
      case "remove": removeBlock(m.path); break;
      case "add-at": openPalette({ index: m.index }); break;
      case "drop": handleDrop(m); break;
      case "key": handleKey({ key: m.key, mod: m.mod, shift: m.shift, typing: false }); break;
      default: break;
    }
  });

  /* ============================================================ selection */
  function select(path, image = null, { fromCanvas = false, focusField = null } = {}) {
    const block = path ? getAt(state.doc, path) : undefined;
    state.sel = path && block !== undefined ? { path, image } : null;
    if (state.sel) state.tab = "block";
    renderTabs();
    renderInspector();
    if (!fromCanvas) tellCanvasSelection(true);
    if (focusField) focusPath(focusField);
  }

  /* ======================================================= block operations */
  function defaultBlock(type) {
    const s = spec(type);
    const block = { type };
    for (const f of s.fields) {
      if (f.default !== undefined) block[f.name] = clone(f.default);
      else if (["images", "strings", "actions", "faq_items"].includes(f.kind)) block[f.name] = [];
      else if (f.kind === "blocks") block[f.name] = [null, null];
      else if (f.kind === "image") block[f.name] = null;
      else block[f.name] = "";
    }
    return block;
  }
  const hasHero = () => state.doc.blocks.some((b) => b && spec(b.type)?.hero);
  const heroFirst = () => Boolean(state.doc.blocks[0] && spec(state.doc.blocks[0].type)?.hero);

  /** Insert at a top-level index (clamped past a hero). Returns the path. */
  function insertBlock(block, index) {
    let at;
    mutate(() => {
      const blocks = state.doc.blocks;
      if (spec(block.type).hero) { blocks.unshift(block); at = 0; return; }
      at = Math.min(Math.max(index ?? blocks.length, heroFirst() ? 1 : 0), blocks.length);
      blocks.splice(at, 0, block);
    }, { inspector: false });
    select(`blocks[${at}]`);
    return `blocks[${at}]`;
  }

  function moveBlock(from, to) {
    const blocks = state.doc.blocks;
    if (from === to || from < 0 || from >= blocks.length) return;
    if (spec(blocks[from]?.type)?.hero) return;
    to = Math.min(Math.max(to, heroFirst() ? 1 : 0), blocks.length - 1);
    if (from === to) return;
    mutate(() => { blocks.splice(to, 0, blocks.splice(from, 1)[0]); }, { inspector: false });
    select(`blocks[${to}]`);
  }

  function duplicateBlock(path) {
    if (isNested(path)) return;
    const i = topIndexOf(path);
    const block = state.doc.blocks[i];
    if (!block || spec(block.type)?.hero) return;
    mutate(() => { state.doc.blocks.splice(i + 1, 0, clone(block)); }, { inspector: false });
    select(`blocks[${i + 1}]`);
    toast(`${spec(block.type).label} duplicated`);
  }

  function removeBlock(path) {
    const block = getAt(state.doc, path);
    if (block === undefined) return;
    const label = block && spec(block.type) ? spec(block.type).label : "Block";
    mutate(() => {
      if (isNested(path)) setAt(state.doc, path, null);
      else state.doc.blocks.splice(topIndexOf(path), 1);
    }, { inspector: false });
    select(isNested(path) ? path.replace(/\.items\[\d+\]$/, "") : null);
    toast(`${label} removed`, { action: { label: "Undo", fn: undo } });
  }

  /* ========================================================= media import */
  /**
   * A new picture object for a file, described by the file itself: its title
   * and caption as the server read them from its metadata. Never its alt
   * text — that describes the picture for someone who cannot see it, and is
   * the author's to write.
   */
  function pictureFor(src) {
    const d = assetInfo(src) || state.described[src] || {};
    return { src, alt: "", title: d.title || "", caption: d.caption || "" };
  }
  const galleryable = (src) => kindOf(src) === "image" || kindOf(src) === "video";

  /** Import files one at a time with progress; returns the names written. */
  async function importFiles(files) {
    files = Array.from(files || []);
    if (!files.length) return [];
    const progress = toast(`Importing ${files.length} file${files.length === 1 ? "" : "s"}…`, { sticky: true, progress: 0 });
    const results = [];
    for (let i = 0; i < files.length; i += 1) {
      progress.update(`Importing ${i + 1} of ${files.length} · ${files[i].name}`, i / files.length);
      try {
        const r = await api.upload(state.folder, files[i]);
        state.assets = r.assets;
        results.push(...r.results);
      } catch (error) {
        results.push({ original: files[i].name, primary: null, written: [], notices: [{ level: "error", message: error.message }] });
      }
    }
    progress.close();

    const ok = results.filter((r) => r.primary);
    const failed = results.filter((r) => !r.primary);
    // One line a person can read, from the notices the import pipeline wrote;
    // the file-by-file version is behind Details.
    const count = (test) => results.filter((r) => r.notices.some((n) => test(n))).length;
    const described = count((n) => /read from the file$/.test(n.message));
    const resized = count((n) => /^re-encoded/.test(n.message));
    const located = count((n) => /location data removed/.test(n.message));
    const renamed = count((n) => /^saved as/.test(n.message));
    const attention = count((n) => n.level === "warn" || n.level === "error");
    const parts = [
      described && `${described} titled from the file`,
      resized && `${resized} resized to the site's limits`,
      located && `location data removed from ${located}`,
      renamed && `${renamed} renamed so nothing was overwritten`,
      attention && `${attention} need a look`,
    ].filter(Boolean);
    const details = results.flatMap((r) => [
      ...(r.primary ? [] : [`${r.original}: not imported`]),
      ...r.notices.map((n) => `${r.primary || r.original}: ${n.message}${n.detail ? ` — ${n.detail}` : ""}`),
    ]);
    toast(
      `${ok.length} file${ok.length === 1 ? "" : "s"} imported${failed.length ? `, ${failed.length} failed` : ""}${parts.length ? ` · ${parts.join(" · ")}` : ""}`,
      { level: failed.length ? "error" : "info", details, sticky: failed.length > 0 },
    );
    renderFilesCount();
    if (state.tab === "files") renderInspector();
    scheduleCheck();
    return ok.map((r) => r.primary);
  }

  /** Add sources to the gallery at `path`, as one undoable step. */
  function addToGallery(path, srcs) {
    const block = getAt(state.doc, path);
    const pics = srcs.filter(galleryable);
    if (!block || block.type !== "gallery" || !pics.length) return;
    mutate(() => {
      if (!Array.isArray(block.images)) block.images = [];
      block.images.push(...pics.map(pictureFor));
    }, { inspector: false });
    select(path, block.images.length - pics.length);
    toast(`${pics.length} picture${pics.length === 1 ? "" : "s"} added to the gallery`);
  }

  /** Blocks for a set of sources: pictures become one gallery, the rest one block each. */
  function blocksFor(srcs) {
    const out = [];
    const pics = srcs.filter((s) => kindOf(s) === "image");
    if (pics.length) out.push({ ...defaultBlock("gallery"), images: pics.map(pictureFor) });
    for (const s of srcs) {
      const k = kindOf(s);
      if (k === "video") out.push({ ...defaultBlock("video"), src: s, title: baseName(s).replace(/\.[^.]+$/, "") });
      else if (k === "audio") out.push({ ...defaultBlock("audio"), src: s, title: baseName(s).replace(/\.[^.]+$/, "") });
      else if (k === "file") out.push({ ...defaultBlock("download"), src: s });
    }
    return out;
  }

  function insertBlocksAt(blocks, index) {
    if (!blocks.length) return;
    let at;
    mutate(() => {
      at = Math.min(Math.max(index ?? state.doc.blocks.length, heroFirst() ? 1 : 0), state.doc.blocks.length);
      state.doc.blocks.splice(at, 0, ...blocks);
    }, { inspector: false });
    select(`blocks[${at}]`);
  }

  /** A drop on the canvas: files from the desktop, or names from the library. */
  async function handleDrop({ path, index, files, assets, image }) {
    let srcs = Array.from(assets || []);
    if (files && files.length) srcs = srcs.concat(await importFiles(files));
    if (!srcs.length) return;
    const target = path ? getAt(state.doc, path) : undefined;
    const pics = srcs.filter((s) => kindOf(s) === "image");
    const firstPic = pics[0];

    if (target && target.type === "gallery") return addToGallery(path, srcs);
    if (target && (target.type === "hero" || target.type === "feature") && firstPic) {
      mutate(() => {
        if (target.type !== "hero") { target.image = pictureFor(firstPic); return; }
        const heroSpec = spec("hero");
        if (!fieldShown(heroSpec, heroSpec.fields.find((f) => f.name === "image"), target)) target.variant = "photo_adaptive";
        if (target.variant !== "collage") { target.image = pictureFor(firstPic); return; }
        // The collage has two picture slots. A drop aimed at one fills that
        // one; two pictures at once fill both; one picture fills the second
        // slot when only the portrait is set, and the portrait otherwise.
        const aimed = /\.image_2$/.test(image || "") ? "image_2" : /\.image$/.test(image || "") ? "image" : null;
        if (aimed) target[aimed] = pictureFor(firstPic);
        else if (pics.length > 1) { target.image = pictureFor(pics[0]); target.image_2 = pictureFor(pics[1]); }
        else target[target.image?.src && !target.image_2?.src ? "image_2" : "image"] = pictureFor(firstPic);
      }, { inspector: false });
      select(path);
      toast(`Picture set on the ${spec(target.type).label.toLowerCase()}`);
      return;
    }
    if (target === null && isNested(path)) {
      const [first] = blocksFor(srcs);
      if (first && spec(first.type).inColumns !== false) {
        mutate(() => setAt(state.doc, path, first), { inspector: false });
        select(path);
      }
      return;
    }
    insertBlocksAt(blocksFor(srcs), index);
  }

  /* ===================================================== asset thumbnails */
  function assetInfo(name) { return state.assets.find((a) => a.name === name); }
  const minName = (name) => name.replace(/\.[^.]+$/, "_min.jpg");
  const encodePath = (p) => p.split("/").map(encodeURIComponent).join("/");

  /** A small, fast picture for a source: the _min counterpart where one exists. */
  function thumbUrl(src) {
    if (!src) return "";
    if (/^https?:/i.test(src)) return src;
    if (src.startsWith("/")) {
      if (!/\.(jpe?g|png|webp)$/i.test(src) || /_min\.jpe?g$/i.test(src)) return src;
      const base = src.replace(/\.[^.]+$/, "");
      return base.startsWith("/image/") ? `/image_min/${base.slice(7)}_min.jpg` : `${base}_min.jpg`;
    }
    const a = assetInfo(src);
    const name = a && a.kind === "image" && a.hasMin ? minName(src) : src;
    return `/${encodePath(state.slug || state.folder)}/${encodePath(name)}`;
  }
  function fullUrl(src) {
    if (!src || /^https?:/i.test(src) || src.startsWith("/")) return src;
    return `/${encodePath(state.slug || state.folder)}/${encodePath(src)}`;
  }
  function thumbImg(src, alt = "") {
    const img = h("img", { src: thumbUrl(src), alt, loading: "lazy", decoding: "async" });
    // A guessed _min that does not exist yet falls back to the file itself.
    img.addEventListener("error", () => { const f = fullUrl(src); if (img.getAttribute("src") !== f) img.src = f; }, { once: true });
    return img;
  }

  /* ============================================================ inspector */
  function renderTabs() {
    for (const b of $$(".tabs [data-tab]")) b.setAttribute("aria-selected", String(b.dataset.tab === state.tab));
  }
  function renderFilesCount() {
    $("#files-count").textContent = state.assets.filter((a) => !a.isMin).length || "";
  }

  function renderInspector() {
    if (!state.doc) return;
    const body = $("#inspector-body");
    const scroll = body.scrollTop;
    const sameView = body.dataset.view === `${state.tab}:${state.sel ? state.sel.path : ""}`;
    let view;
    if (state.tab === "page") view = pageTab();
    else if (state.tab === "files") view = filesTab();
    else view = state.sel ? blockTab() : structureTab();
    body.replaceChildren(view);
    body.dataset.view = `${state.tab}:${state.sel ? state.sel.path : ""}`;
    if (sameView) body.scrollTop = scroll;
    markFindings();
  }

  /* ------------------------------------------------------ structure view */
  function summaryOf(block) {
    if (!block) return "empty";
    const t = (v) => String(v || "").replace(/[#*_`>$\\]/g, "").replace(/\s+/g, " ").trim();
    switch (block.type) {
      case "hero": return t(block.title) || "untitled";
      case "heading": return t(block.title) || "untitled";
      case "text": return t(block.markdown).slice(0, 80) || "empty";
      case "gallery": return `${(block.images || []).length} picture${(block.images || []).length === 1 ? "" : "s"} · ${block.layout || "justified"}${block.title ? ` · ${t(block.title)}` : ""}`;
      case "video": case "audio": case "download": return t(block.title) || baseName(block.src) || "no file";
      case "faq": return `${(block.items || []).length} question${(block.items || []).length === 1 ? "" : "s"}`;
      case "feature": return t(block.title) || "untitled";
      case "raw_html": return "HTML";
      case "columns": return (block.items || []).map((b) => (b && spec(b.type) ? spec(b.type).label : "empty")).join(" + ");
      default: return block.type;
    }
  }
  function worstFor(prefix) {
    let worst = null;
    for (const f of state.findings) {
      if (!(f.path === prefix || f.path.startsWith(`${prefix}.`) || f.path.startsWith(`${prefix}[`))) continue;
      if (f.level === "error") return "error";
      if (f.level === "warn") worst = "warn";
    }
    return worst;
  }

  function structureTab() {
    const blocks = state.doc.blocks;
    if (!blocks.length) {
      const zone = h("div", { class: "empty-state" },
        h("strong", {}, "An empty page"),
        "Drop pictures onto the canvas to start a gallery, or add a block.",
        h("div", {}, h("button", { type: "button", class: "btn btn-primary", onclick: () => openPalette({}) }, icon("plus"), "Add a block")),
      );
      dropTarget(zone, (srcs) => insertBlocksAt(blocksFor(srcs), 0));
      return h("div", { class: "pane" }, zone);
    }
    const list = h("div", { class: "outline" });
    let dragFrom = null;
    blocks.forEach((block, i) => {
      const s = block && spec(block.type);
      const hero = s && s.hero;
      const flag = worstFor(`blocks[${i}]`);
      const row = h("div", {
        class: "outline-item", draggable: hero ? "false" : "true", role: "button", tabindex: "0",
        onclick: () => select(`blocks[${i}]`),
        onkeydown: (e) => { if (e.key === "Enter") select(`blocks[${i}]`); },
      },
        h("span", { class: "outline-grip", title: hero ? "The hero stays first" : "Drag to reorder" }, hero ? " " : "⋮⋮"),
        h("div", { class: "outline-text" }, h("div", { class: "outline-label" }, s ? s.label : block?.type ?? "Empty"), h("div", { class: "outline-sum" }, summaryOf(block))),
        flag ? h("span", { class: `outline-flag ${flag}`, title: flag === "error" ? "Has errors" : "Has warnings" }) : h("span"),
      );
      row.addEventListener("dragstart", (e) => { dragFrom = i; row.classList.add("is-dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-block", String(i)); });
      row.addEventListener("dragend", () => { dragFrom = null; row.classList.remove("is-dragging"); $$(".drop-before,.drop-after", list).forEach((el) => el.classList.remove("drop-before", "drop-after")); });
      row.addEventListener("dragover", (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        $$(".drop-before,.drop-after", list).forEach((el) => el.classList.remove("drop-before", "drop-after"));
        row.classList.add(after ? "drop-after" : "drop-before");
      });
      row.addEventListener("drop", (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        const r = row.getBoundingClientRect();
        const after = e.clientY > r.top + r.height / 2;
        let to = after ? i + 1 : i;
        if (to > dragFrom) to -= 1;
        moveBlock(dragFrom, to);
      });
      list.append(row);
    });
    return h("div", {},
      h("div", { class: "pane" },
        h("div", { class: "f-row", style: { marginBottom: "10px" } }, h("p", { class: "pane-title", style: { margin: 0 } }, "Page structure"),
          h("button", { type: "button", class: "btn btn-sm", onclick: () => openPalette({}) }, icon("plus"), "Add block")),
        list,
        h("p", { class: "f-note" }, "Click a block here or on the canvas to edit it. Drag to reorder. Drop pictures anywhere on the canvas to add a gallery there."),
      ),
    );
  }

  /* ---------------------------------------------------------- block view */
  function blockTab() {
    const path = state.sel.path;
    const block = getAt(state.doc, path);
    const nested = isNested(path);
    const parentPath = nested ? path.replace(/\.items\[\d+\]$/, "") : null;
    const s = block && spec(block.type);
    const col = nested ? Number(/\.items\[(\d+)\]$/.exec(path)[1]) + 1 : null;

    const crumbs = h("div", { class: "crumbs" },
      h("button", { type: "button", onclick: () => select(null) }, "Page"),
      nested ? [h("span", {}, "›"), h("button", { type: "button", onclick: () => select(parentPath) }, "Two columns"), h("span", {}, "›"), h("span", {}, `Column ${col}`)] : null,
    );
    const actions = h("div", { style: { display: "flex", gap: "2px" } },
      !nested && s && !s.hero ? iconButton("copy", "Duplicate", () => duplicateBlock(path)) : null,
      block !== null ? iconButton("trash", nested ? "Clear this column" : "Remove block", () => removeBlock(path), { danger: true }) : null,
    );
    const head = h("div", { class: "insp-head" },
      iconButton("back", "Back to the page", () => select(nested ? parentPath : null)),
      h("div", { class: "insp-head-main" }, crumbs,
        h("div", { class: "insp-title" }, h("span", { class: "type-icon" }, s ? TYPE_GLYPH[s.type] || "·" : "·"), s ? s.label : block === null ? "Empty column" : block.type),
        s ? h("div", { class: "insp-desc" }, s.description) : null),
      actions,
    );

    let content;
    if (block === null) content = columnChooser(path);
    else if (!s) content = h("p", { class: "f-note" }, `Unknown block type “${block.type}”. Remove it, or fix the type in the file.`);
    else if (s.type === "columns") content = columnsEditor(block, path);
    else content = h("div", {}, ...fieldsFor(s, block, path));
    return h("div", {}, head, h("div", { class: "pane" }, content));
  }

  /** The catalogue's fields, with the rarely-touched ones folded away. */
  function fieldsFor(s, block, path) {
    const ADVANCED = { gallery: ["gap"], video: ["poster", "meta", "download"], audio: ["meta", "download"], hero: ["scroll_cue"] };
    const rare = new Set(ADVANCED[s.type] || []);
    const main = [];
    const more = [];
    for (const f of s.fields) {
      if (!fieldShown(s, f, block)) continue;
      (rare.has(f.name) ? more : main).push(field(f, block, `${path}.${f.name}`));
    }
    if (more.length) main.push(h("details", { class: "more" }, h("summary", {}, "More options"), ...more));
    return main;
  }

  function columnChooser(path) {
    const options = state.site.columnTypes.map((type) => {
      const s = spec(type);
      return h("button", { type: "button", onclick: () => { mutate(() => setAt(state.doc, path, defaultBlock(type)), { inspector: false }); select(path); } },
        h("span", { class: "type-icon" }, TYPE_GLYPH[type] || "·"), h("strong", {}, s.label), h("small", {}, s.description));
    });
    return h("div", {}, h("p", { class: "f-note", style: { marginTop: 0, marginBottom: "10px" } }, "Choose what goes in this column."), h("div", { class: "palette", style: { gridTemplateColumns: "1fr" } }, options));
  }

  function columnsEditor(block, path) {
    if (!Array.isArray(block.items)) block.items = [null, null];
    while (block.items.length < 2) block.items.push(null);
    const slots = block.items.slice(0, 2).map((item, i) => {
      const s = item && spec(item.type);
      const at = `${path}.items[${i}]`;
      return h("div", { class: `col-slot${item ? "" : " is-empty"}`, "data-path": at },
        h("div", { class: "col-slot-label" }, `Column ${i + 1}`),
        item ? h("div", {}, h("strong", {}, s ? s.label : item.type), h("div", { class: "outline-sum" }, summaryOf(item))) : h("div", { class: "f-note", style: { margin: 0 } }, "Empty"),
        h("button", { type: "button", class: `btn btn-sm${item ? "" : " btn-primary"}`, onclick: () => select(at) }, item ? "Edit" : "Choose a block"),
      );
    });
    return h("div", {},
      h("div", { class: "col-slots" }, slots),
      h("div", { style: { marginTop: "10px" } },
        h("button", { type: "button", class: "btn btn-sm", onclick: () => mutate(() => block.items.reverse()) }, icon("swap"), "Swap columns")),
      h("p", { class: "f-note" }, "The two stack on a phone, left column first. Click a column on the canvas to edit it directly."),
    );
  }

  /* =============================================================== fields */
  function fieldShell(f, path, control, { inline = false } = {}) {
    const head = h("div", { class: "f-head" },
      h("span", { class: "f-label" }, f.label || f.name),
      f.required ? null : h("span", { class: "f-opt" }, ""),
      f.help ? h("span", { class: "f-help", title: f.help }, "?") : null,
    );
    if (inline) return h("div", { class: "f", "data-path": path }, h("div", { class: "f-row" }, head, control));
    return h("div", { class: "f", "data-path": path }, head, control);
  }

  /** Bind a text-like control: live edits on input, one undo step on change. */
  function bindText(el, target, key, read = (x) => x.value) {
    el.addEventListener("input", () => { target[key] = read(el); changed(); });
    el.addEventListener("change", () => { target[key] = read(el); commit(); });
    return el;
  }
  function autoGrow(ta) {
    const fit = () => { ta.style.height = "auto"; ta.style.height = `${Math.min(ta.scrollHeight + 2, 520)}px`; };
    ta.addEventListener("input", fit);
    requestAnimationFrame(fit);
    return ta;
  }

  function field(f, target, path) {
    const key = f.name;
    const value = target[key];
    switch (f.kind) {
      case "text":
        return fieldShell(f, path, bindText(h("input", { class: "input", type: "text", value: value ?? "", "data-path": path }), target, key));
      case "date":
        return fieldShell(f, path, bindText(h("input", { class: "input", type: "date", value: value ?? "", "data-path": path }), target, key));
      case "textarea":
        return fieldShell(f, path, autoGrow(bindText(h("textarea", { class: "textarea", rows: 2, value: value ?? "", "data-path": path }), target, key)));
      case "markdown":
        return fieldShell(f, path, h("div", {},
          autoGrow(bindText(h("textarea", { class: "textarea md", value: value ?? "", spellcheck: "true", "data-path": path, placeholder: "Write in markdown. ## makes a heading, $x^2$ is maths." }), target, key)),
          h("div", { class: "f-note" }, "Markdown with KaTeX: $inline$ and $$display$$ maths are typeset at build time.")));
      case "html":
        return fieldShell(f, path, autoGrow(bindText(h("textarea", { class: "textarea code", value: value ?? "", spellcheck: "false", "data-path": path }), target, key)));
      case "boolean": {
        const input = h("input", { type: "checkbox", checked: value === true, "data-path": path, onchange: (e) => mutate(() => { target[key] = e.target.checked; }, { inspector: false }) });
        return fieldShell(f, path, h("label", { class: "switch" }, input, h("span")), { inline: true });
      }
      case "select": {
        const current = f.options.some((o) => o.value === value) ? value : f.default;
        const seg = h("div", { class: `seg seg-full${f.options.length > 3 ? " seg-wrap" : ""}`, role: "group", "data-path": path },
          f.options.map((o) => {
            const [short] = o.label.split(" — ");
            return h("button", { type: "button", "aria-pressed": String(o.value === current), title: o.label, onclick: () => mutate(() => { target[key] = o.value; }) }, short);
          }));
        const chosen = f.options.find((o) => o.value === current);
        return fieldShell(f, path, h("div", {}, seg, chosen && chosen.label.includes(" — ") ? h("div", { class: "f-note" }, chosen.label.split(" — ").slice(1).join(" — ")) : null));
      }
      case "strings":
        return fieldShell(f, path, chipInput(target, key, path));
      case "image":
        return fieldShell(f, path, imageSlot(target, key, path));
      case "file":
        return fieldShell(f, path, fileSlot(target, key, path, f.accept || "any"));
      case "images":
        return fieldShell(f, path, galleryManager(target, key, path));
      case "actions":
        return fieldShell(f, path, rowsEditor(target, key, path, () => ({ label: "", href: "" }), (item, at) => [
          bindText(h("input", { class: "input", placeholder: "Label", value: item.label ?? "", "data-path": `${at}.label` }), item, "label"),
          bindText(h("input", { class: "input", placeholder: "/page.html or https://…", value: item.href ?? "", "data-path": `${at}.href` }), item, "href"),
        ], "Add button"));
      case "faq_items":
        return fieldShell(f, path, rowsEditor(target, key, path, () => ({ question: "", answer: "" }), (item, at) => [
          bindText(h("input", { class: "input", placeholder: "Question", value: item.question ?? "", "data-path": `${at}.question` }), item, "question"),
          autoGrow(bindText(h("textarea", { class: "textarea", rows: 2, placeholder: "Answer (markdown)", value: item.answer ?? "", "data-path": `${at}.answer` }), item, "answer")),
        ], "Add question"));
      default:
        return h("p", { class: "f-note" }, `No control for “${f.kind}”.`);
    }
  }

  function chipInput(target, key, path) {
    if (!Array.isArray(target[key])) target[key] = target[key] ? String(target[key]).split(",").map((s) => s.trim()).filter(Boolean) : [];
    const list = target[key];
    const box = h("div", { class: "chips", "data-path": path });
    const input = h("input", { type: "text", placeholder: list.length ? "" : "Type and press Enter" });
    const addFrom = () => {
      const parts = input.value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return;
      mutate(() => { for (const p of parts) if (!list.some((x) => x.toLowerCase() === p.toLowerCase())) list.push(p); }, { inspector: false });
      input.value = "";
      draw();
      input.focus();
    };
    const draw = () => {
      box.replaceChildren(
        ...list.map((item, i) => h("span", { class: "chip" }, item, h("button", { type: "button", title: `Remove ${item}`, onclick: (e) => { e.stopPropagation(); mutate(() => list.splice(i, 1), { inspector: false }); draw(); } }, "×"))),
        input,
      );
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addFrom(); }
      else if (e.key === "Backspace" && !input.value && list.length) { mutate(() => list.pop(), { inspector: false }); draw(); input.focus(); }
    });
    input.addEventListener("blur", addFrom);
    box.addEventListener("click", () => input.focus());
    draw();
    return box;
  }

  function rowsEditor(target, key, path, blank, renderRow, addLabel) {
    if (!Array.isArray(target[key])) target[key] = [];
    const items = target[key];
    const wrap = h("div", { "data-path": path });
    const draw = () => {
      wrap.replaceChildren(
        ...items.map((item, i) => h("div", { class: "list-row", "data-path": `${path}[${i}]` },
          h("div", { class: "list-row-fields" }, renderRow(item, `${path}[${i}]`)),
          h("div", { class: "list-row-tools" },
            iconButton("up", "Move up", () => { mutate(() => items.splice(i - 1, 0, items.splice(i, 1)[0]), { inspector: false }); draw(); }, { disabled: i === 0 }),
            iconButton("down", "Move down", () => { mutate(() => items.splice(i + 1, 0, items.splice(i, 1)[0]), { inspector: false }); draw(); }, { disabled: i === items.length - 1 }),
            iconButton("trash", "Remove", () => { mutate(() => items.splice(i, 1), { inspector: false }); draw(); }, { danger: true }),
          ))),
        h("button", { type: "button", class: "btn btn-sm", onclick: () => { mutate(() => items.push(blank()), { inspector: false }); draw(); $$("input,textarea", wrap).slice(-2)[0]?.focus(); } }, icon("plus"), addLabel),
      );
    };
    draw();
    return wrap;
  }

  /* -------------------------------------------------------- picture slots */
  /** Make an element accept dropped files and library items. */
  function dropTarget(el, onSources) {
    el.addEventListener("dragover", (e) => {
      const types = Array.from(e.dataTransfer.types || []);
      if (!types.includes("Files") && !types.includes("text/x-assets")) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.add("dropzone-over");
    });
    el.addEventListener("dragleave", (e) => { if (!el.contains(e.relatedTarget)) el.classList.remove("dropzone-over"); });
    el.addEventListener("drop", async (e) => {
      const types = Array.from(e.dataTransfer.types || []);
      if (!types.includes("Files") && !types.includes("text/x-assets")) return;
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove("dropzone-over");
      let srcs = (e.dataTransfer.getData("text/x-assets") || "").split("\n").filter(Boolean);
      if (e.dataTransfer.files.length) srcs = srcs.concat(await importFiles(e.dataTransfer.files));
      if (srcs.length) onSources(srcs);
    });
  }

  function pickFiles({ multiple = true, accept = "" } = {}) {
    return new Promise((resolve) => {
      const input = $("#file-input");
      input.multiple = multiple;
      input.accept = accept;
      input.value = "";
      input.onchange = () => resolve(Array.from(input.files || []));
      input.click();
    });
  }
  const ACCEPT = { image: "image/*,.svg", video: "video/*", audio: "audio/*", any: "", media: "image/*,video/*,.svg" };

  function imageSlot(target, key, path) {
    const img = target[key] && typeof target[key] === "object" ? target[key] : null;
    // A new picture is described by its own file, not by the one it replaces:
    // the old alt text, title and caption were about a different photograph.
    const set = (src) => mutate(() => { target[key] = src ? (img && img.src === src ? img : pictureFor(src)) : null; });
    const choose = async () => { const [src] = await openLibrary({ multiple: false, accept: "image", title: "Choose a picture" }); if (src) set(src); };
    const upload = async () => { const files = await pickFiles({ multiple: false, accept: ACCEPT.image }); const [src] = await importFiles(files); if (src) set(src); };

    if (!img || !img.src) {
      const slot = h("div", { class: "slot is-empty", "data-path": `${path}.src` },
        h("div", { class: "slot-thumb" }, icon("image")),
        h("div", {}, h("div", { class: "slot-sub" }, "No picture. Drop one here, or"),
          h("div", { class: "slot-btns" },
            h("button", { type: "button", class: "btn btn-sm", onclick: choose }, "Choose…"),
            h("button", { type: "button", class: "btn btn-sm", onclick: upload }, icon("upload"), "Upload"))));
      dropTarget(slot, (srcs) => set(srcs.find((s) => kindOf(s) === "image")));
      return slot;
    }
    const a = assetInfo(img.src);
    const slot = h("div", { class: "slot", "data-path": `${path}.src` },
      h("div", { class: "slot-thumb" }, thumbImg(img.src)),
      h("div", {},
        h("div", { class: "slot-name" }, baseName(img.src)),
        h("div", { class: "slot-sub" }, a && a.width ? `${a.width} × ${a.height} · ${kb(a.bytes)}` : img.src.startsWith("/") ? "Site library" : ""),
        h("div", { class: "slot-btns" },
          h("button", { type: "button", class: "btn btn-sm", onclick: choose }, "Replace…"),
          h("button", { type: "button", class: "btn btn-sm btn-ghost btn-danger", onclick: () => set(null) }, "Remove"))));
    dropTarget(slot, (srcs) => set(srcs.find((s) => kindOf(s) === "image")));
    return h("div", {}, slot, h("div", { style: { marginTop: "10px" } }, pictureFields(img, path)));
  }

  /**
   * alt, title, caption for one picture object. Title and caption arrive
   * filled from the file's own metadata; alt text is always the author's.
   */
  function pictureFields(img, path) {
    const alt = autoGrow(bindText(h("textarea", { class: "textarea", rows: 2, value: img.alt ?? "", "data-path": `${path}.alt`, placeholder: "What the picture shows, for someone who cannot see it" }), img, "alt"));
    return h("div", {},
      h("div", { class: "f", "data-path": `${path}.alt` },
        h("div", { class: "f-head" }, h("span", { class: "f-label" }, "Alt text"), h("span", { class: "f-help", title: "Read aloud by screen readers and used by image search. Describe the picture; do not repeat the caption." }, "?")),
        alt),
      h("div", { class: "f", "data-path": `${path}.title` },
        h("div", { class: "f-head" }, h("span", { class: "f-label" }, "Title"), h("span", { class: "f-help", title: "The heading on the lightbox slide. Filled from the file's own title where it has one." }, "?")),
        bindText(h("input", { class: "input", value: img.title ?? "", "data-path": `${path}.title` }), img, "title")),
      h("div", { class: "f", "data-path": `${path}.caption` },
        h("div", { class: "f-head" }, h("span", { class: "f-label" }, "Caption"), h("span", { class: "f-help", title: "The lightbox description, the line under the picture in the waterfall layout, and the note beside a collage's portrait. Filled from the file's own description where it has one." }, "?")),
        bindText(h("input", { class: "input", value: img.caption ?? "", "data-path": `${path}.caption` }), img, "caption")),
    );
  }

  function fileSlot(target, key, path, accept) {
    const value = target[key] || "";
    const set = (src) => mutate(() => { target[key] = src || ""; });
    const noun = accept === "video" ? "video" : accept === "audio" ? "audio file" : accept === "image" ? "picture" : "file";
    const choose = async () => { const [src] = await openLibrary({ multiple: false, accept, title: `Choose a ${noun}` }); if (src) set(src); };
    const upload = async () => { const files = await pickFiles({ multiple: false, accept: ACCEPT[accept] ?? "" }); const [src] = await importFiles(files); if (src) set(src); };
    const a = value ? assetInfo(value) : null;
    const slot = h("div", { class: `slot${value ? "" : " is-empty"}`, "data-path": path },
      h("div", { class: "slot-thumb" }, value && kindOf(value) === "image" ? thumbImg(value) : (value ? EXT(value) || "file" : icon(accept === "image" ? "image" : "upload"))),
      h("div", {},
        value ? h("div", { class: "slot-name" }, baseName(value)) : h("div", { class: "slot-sub" }, `No ${noun}. Drop one here, or`),
        value ? h("div", { class: "slot-sub" }, a ? kb(a.bytes) : value.startsWith("/") ? "Site library" : "Not in this folder") : null,
        h("div", { class: "slot-btns" },
          h("button", { type: "button", class: "btn btn-sm", onclick: choose }, value ? "Replace…" : "Choose…"),
          value ? null : h("button", { type: "button", class: "btn btn-sm", onclick: upload }, icon("upload"), "Upload"),
          value ? h("button", { type: "button", class: "btn btn-sm btn-ghost btn-danger", onclick: () => set("") }, "Remove") : null)));
    dropTarget(slot, (srcs) => set(srcs[0]));
    return slot;
  }

  /* ------------------------------------------------------ gallery manager */
  function galleryManager(target, key, path) {
    if (!Array.isArray(target[key])) target[key] = [];
    const images = target[key];
    const blockPath = path.replace(/\.images$/, "");
    const active = state.sel && state.sel.path === blockPath ? state.sel.image : null;

    const grid = h("div", { class: "pics-grid", "data-path": path });
    let dragFrom = null;
    images.forEach((img, i) => {
      const noAlt = !String(img?.alt || "").trim();
      const tile = h("button", {
        type: "button", class: `pic${active === i ? " is-active" : ""}`, draggable: "true", title: `${baseName(img?.src)}${noAlt ? " — no alt text" : ""}`,
        "data-path": `${path}[${i}]`, onclick: () => select(blockPath, active === i ? null : i),
      },
        kindOf(img?.src) === "image" ? thumbImg(img.src, img.alt || "") : h("span", { class: "pic-kind" }, EXT(img?.src) || "?"),
        h("span", { class: "pic-num" }, String(i + 1)),
        noAlt ? h("span", { class: "pic-warn", title: "No alt text" }, "!") : null,
      );
      tile.addEventListener("dragstart", (e) => { dragFrom = i; tile.classList.add("is-dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/x-pic", String(i)); });
      tile.addEventListener("dragend", () => { dragFrom = null; tile.classList.remove("is-dragging"); $$(".drop-before", grid).forEach((el) => el.classList.remove("drop-before")); });
      tile.addEventListener("dragover", (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        e.stopPropagation();
        $$(".drop-before", grid).forEach((el) => el.classList.remove("drop-before"));
        tile.classList.add("drop-before");
      });
      tile.addEventListener("drop", (e) => {
        if (dragFrom === null) return;
        e.preventDefault();
        e.stopPropagation();
        const from = dragFrom;
        let to = i > from ? i - 1 : i;
        if (to === from) return;
        mutate(() => images.splice(to, 0, images.splice(from, 1)[0]), { inspector: false });
        select(blockPath, to);
      });
      grid.append(tile);
    });

    const addFromLibrary = async () => {
      const srcs = await openLibrary({ multiple: true, accept: "media", title: "Add pictures to the gallery" });
      if (srcs.length) addToGallery(blockPath, srcs);
    };
    const upload = async () => {
      const files = await pickFiles({ multiple: true, accept: ACCEPT.media });
      const srcs = await importFiles(files);
      if (srcs.length) addToGallery(blockPath, srcs);
    };
    grid.append(h("button", { type: "button", class: "pic-add", onclick: upload, title: "Upload pictures from your computer" }, h("b", {}, "+"), "Upload"));

    const box = h("div", {},
      grid,
      h("div", { class: "pics-bar" },
        h("button", { type: "button", class: "btn btn-sm", onclick: addFromLibrary }, icon("folder"), "From library…"),
        h("span", { class: "f-note" }, images.length ? `${images.length} · drag to reorder` : "Drop files here")),
    );
    dropTarget(box, (srcs) => addToGallery(blockPath, srcs));

    if (active != null && images[active]) {
      const img = images[active];
      const at = `${path}[${active}]`;
      const a = assetInfo(img.src);
      box.append(h("div", { class: "pic-detail" },
        h("div", { class: "pic-detail-head" },
          h("span", {}, `Picture ${active + 1} of ${images.length}`),
          iconButton("left", "Previous picture", () => select(blockPath, active - 1), { disabled: active === 0 }),
          iconButton("right", "Next picture", () => select(blockPath, active + 1), { disabled: active === images.length - 1 }),
          iconButton("close", "Close", () => select(blockPath, null))),
        kindOf(img.src) === "image" ? (() => { const big = thumbImg(img.src, img.alt || ""); big.className = "pic-detail-img"; return big; })() : null,
        h("div", { class: "pic-detail-body" },
          h("div", { class: "pic-file" },
            h("code", {}, baseName(img.src)),
            a && a.width ? h("span", {}, `${a.width} × ${a.height} · ${kb(a.bytes)}`) : null,
            h("span", { style: { flex: "1 1 auto" } }),
            h("button", { type: "button", class: "btn btn-sm", onclick: async () => {
              const [src] = await openLibrary({ multiple: false, accept: "media", title: "Replace this picture" });
              if (src) mutate(() => { Object.assign(img, pictureFor(src)); });
            } }, "Replace…"),
            h("button", { type: "button", class: "btn btn-sm btn-ghost btn-danger", onclick: () => {
              mutate(() => images.splice(active, 1), { inspector: false });
              select(blockPath, images.length ? Math.min(active, images.length - 1) : null);
            } }, "Remove")),
          pictureFields(img, at))));
    }
    return box;
  }

  /* ============================================================= page tab */
  function pageTab() {
    const meta = state.doc.meta;
    const fields = Object.fromEntries(state.site.metaFields.map((f) => [f.name, f]));
    const f = (name, over = {}) => field({ ...fields[name], ...over }, meta, `meta.${name}`);
    const card = fields.image;
    const cardSlot = fieldShell(card, "meta.image", (() => {
      const value = meta.image || "";
      const set = (src) => mutate(() => { meta.image = src || ""; });
      const choose = async () => { const [src] = await openLibrary({ multiple: false, accept: "image", title: "Choose the card image" }); if (src) set(src); };
      const slot = h("div", { class: `slot${value ? "" : " is-empty"}`, "data-path": "meta.image" },
        h("div", { class: "slot-thumb" }, value ? thumbImg(value) : icon("image")),
        h("div", {},
          h("div", { class: value ? "slot-name" : "slot-sub" }, value ? baseName(value) : "Falls back to the site's default image"),
          h("div", { class: "slot-btns" },
            h("button", { type: "button", class: "btn btn-sm", onclick: choose }, value ? "Replace…" : "Choose…"),
            value ? h("button", { type: "button", class: "btn btn-sm btn-ghost btn-danger", onclick: () => set("") }, "Remove") : null)));
      dropTarget(slot, (srcs) => set(srcs.find((s) => kindOf(s) === "image")));
      return slot;
    })());

    const revs = state.revisions.length
      ? state.revisions.map((r) => h("div", { class: "rev" },
        h("span", {}, new Date(r.saved).toLocaleString()),
        h("button", { type: "button", class: "btn btn-sm", onclick: () => restoreRevision(r) }, "Restore")))
      : [h("p", { class: "f-note", style: { margin: 0 } }, "Each Save keeps the version it replaced here; autosave keeps one every fifteen minutes.")];

    return h("div", {},
      h("div", { class: "pane" },
        f("title"),
        f("description", { kind: "textarea" }),
        h("div", { class: "f-grid2" }, f("date"), fieldShell(fields.draft, "meta.draft", h("label", { class: "switch", title: fields.draft.help }, h("input", { type: "checkbox", checked: meta.draft === true, onchange: (e) => mutate(() => { meta.draft = e.target.checked; }, { inspector: false }) }), h("span")), { inline: false })),
        f("tags", { label: "Subjects", help: "Tags and categories are one list on the site; each gets its own page." }),
        cardSlot,
        h("details", { class: "more" }, h("summary", {}, "More"), f("category"), f("author"), f("updated"), f("permalink"))),
      h("div", { class: "pane" }, h("p", { class: "pane-title" }, "History"), ...revs),
      h("div", { class: "pane" }, h("p", { class: "pane-title" }, "Where it lives"),
        h("p", { class: "f-note", style: { margin: 0 } }, `input_custom_post/${state.folder}/${state.folder}.json · publishes at /${state.slug}.html${meta.draft ? " (not while it is a draft)" : ""}`)),
    );
  }

  async function restoreRevision(r) {
    try {
      const { doc } = await api.get(`/api/posts/${state.folder}/revisions/${encodeURIComponent(r.name)}`);
      commit();
      state.doc = doc;
      ensureShape();
      commit();
      state.sel = null;
      changed();
      renderInspector();
      toast(`Restored the version from ${new Date(r.saved).toLocaleString()}`, { action: { label: "Undo", fn: undo } });
    } catch (error) {
      toast(`Could not restore: ${error.message}`, { level: "error" });
    }
  }

  /* ============================================================ files tab */
  function usedSources() {
    const used = new Map();
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) { if ((k === "src" || k === "poster" || k === "image") && typeof x === "string") used.set(x, (used.get(x) || 0) + 1); walk(x); } }
    };
    walk(state.doc);
    return used;
  }

  function filesTab() {
    const used = usedSources();
    const assets = state.assets.filter((a) => !a.isMin);
    state.filesSel = new Set([...state.filesSel].filter((n) => assets.some((a) => a.name === n)));
    const upload = async () => { const files = await pickFiles({ multiple: true }); await importFiles(files); };
    const zone = h("div", { class: "upload-zone" },
      icon("upload"),
      h("div", {}, h("strong", {}, "Drop files here"), " or ", h("button", { type: "button", class: "btn btn-sm", onclick: upload }, "Choose files…")),
      h("div", { class: "f-note", style: { margin: 0 } }, "Photographs are turned upright, capped in size, stripped of location data and given a thumbnail. Nothing is ever overwritten."));
    dropTarget(zone, () => {});

    const grid = h("div", { class: "lib-grid" }, assets.map((a) => {
      const selected = state.filesSel.has(a.name);
      const item = h("button", {
        type: "button", class: `lib-item${selected ? " is-selected" : ""}`, draggable: "true", title: `${a.name}${a.width ? ` · ${a.width} × ${a.height}` : ""} · ${kb(a.bytes)}\nDrag onto the page, or select and add.`,
        onclick: () => { if (selected) state.filesSel.delete(a.name); else state.filesSel.add(a.name); renderInspector(); },
      },
        h("div", { class: "lib-thumb" }, a.kind === "image" ? thumbImg(a.name) : EXT(a.name)),
        h("div", { class: "lib-name" }, a.name),
        h("div", { class: "lib-sub" }, used.get(a.name) ? h("span", {}, "on the page") : h("span", {}, "unused"), a.kind === "image" && a.hasMin === false ? h("span", { class: "warn", title: "The build makes the thumbnail if it is missing" }, "no thumbnail") : null));
      item.addEventListener("dragstart", (e) => {
        const names = selected && state.filesSel.size ? [...state.filesSel] : [a.name];
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/x-assets", names.join("\n"));
        e.dataTransfer.setData("text/plain", names.join("\n"));
      });
      return item;
    }));

    const selCount = state.filesSel.size;
    const selBlock = state.sel ? getAt(state.doc, state.sel.path) : null;
    const galleryPath = selBlock && selBlock.type === "gallery" ? state.sel.path : null;
    const bar = selCount ? h("div", { class: "lib-actions" },
      h("span", {}, `${selCount} selected`),
      h("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: () => { state.filesSel.clear(); renderInspector(); } }, "Clear"),
      galleryPath ? h("button", { type: "button", class: "btn btn-sm", onclick: () => { const s = [...state.filesSel]; state.filesSel.clear(); addToGallery(galleryPath, s); } }, "Add to gallery") : null,
      h("button", { type: "button", class: "btn btn-sm btn-primary", onclick: () => {
        const s = [...state.filesSel];
        state.filesSel.clear();
        const index = state.sel && !isNested(state.sel.path) ? topIndexOf(state.sel.path) + 1 : state.doc.blocks.length;
        insertBlocksAt(blocksFor(s), index);
      } }, "Add to page")) : null;

    return h("div", { style: { display: "flex", flexDirection: "column", minHeight: "100%" } },
      h("div", { class: "pane", style: { flex: "1 1 auto" } }, zone,
        assets.length ? grid : h("p", { class: "f-note" }, "No files in this post folder yet."),
        assets.length ? h("p", { class: "f-note" }, "Drag files onto the page to place them. Pictures from the site-wide folders are in the library picker.") : null),
      bar);
  }

  /* ============================================================= library */
  /**
   * The picker: this post's files, or the site-wide folders. Resolves with the
   * chosen sources — bare names for files in the post folder, site paths for
   * the rest — or an empty list when cancelled.
   */
  function openLibrary({ multiple = true, accept = "image", title = "Choose" } = {}) {
    return new Promise((resolve) => {
      const modal = $("#modal");
      const chosen = [];
      let source = "post";
      let dir = "";
      let filter = "";
      let listing = null;
      const accepts = (kind) => accept === "any" || (accept === "media" ? kind === "image" || kind === "video" : kind === accept);

      const finish = (value) => { modal.close(); resolve(value); };
      modal.onclose = () => resolve(chosen.length && modal.returnValue === "ok" ? chosen.slice() : []);
      modal.oncancel = null;

      const toggle = (src) => {
        const at = chosen.indexOf(src);
        if (!multiple) { chosen.length = 0; chosen.push(src); }
        else if (at >= 0) chosen.splice(at, 1);
        else chosen.push(src);
        draw();
      };

      async function load() {
        if (source === "site") {
          try { listing = await api.get(`/api/library?dir=${encodeURIComponent(dir)}`); }
          catch (error) { listing = { dirs: [], files: [], error: error.message }; }
          // Remembered so a picture picked from here arrives titled — see pictureFor().
          for (const f of listing.files) if (f.title || f.caption) state.described[f.url] = { title: f.title, caption: f.caption };
        }
        draw();
      }

      function tile(src, thumb, name, sub, kind) {
        const selected = chosen.includes(src);
        const el = h("button", {
          type: "button", class: `lib-item${selected ? " is-selected" : ""}`, title: name,
          onclick: () => toggle(src),
          ondblclick: () => { if (!chosen.includes(src)) chosen.push(src); modal.returnValue = "ok"; finish(chosen.slice()); },
        },
          h("div", { class: "lib-thumb" }, kind === "image" && thumb ? (() => { const i = h("img", { src: thumb, alt: "", loading: "lazy" }); return i; })() : EXT(name) || kind),
          h("div", { class: "lib-name" }, name),
          sub ? h("div", { class: "lib-sub" }, sub) : null);
        return el;
      }

      function draw() {
        const q = filter.toLowerCase();
        let body;
        if (source === "post") {
          const items = state.assets.filter((a) => !a.isMin && accepts(a.kind) && a.name.toLowerCase().includes(q));
          body = items.length
            ? h("div", { class: "lib-grid" }, items.map((a) => tile(a.name, thumbUrl(a.name), a.name, a.width ? `${a.width}×${a.height}` : kb(a.bytes), a.kind)))
            : h("div", { class: "empty-state" }, h("strong", {}, "Nothing here yet"), "Upload files into this post, or look in the site library.");
        } else if (!listing) {
          body = h("p", { class: "f-note" }, "Loading…");
        } else {
          const crumbs = h("div", { class: "breadcrumbs", style: { marginBottom: "10px" } },
            h("button", { type: "button", onclick: () => { dir = ""; load(); } }, "Site library"),
            ...(listing.dir ? listing.dir.split("/").flatMap((seg, i, all) => ["/", h("button", { type: "button", onclick: () => { dir = all.slice(0, i + 1).join("/"); load(); } }, seg)]) : []));
          const folders = listing.dirs.filter((d) => d.name.toLowerCase().includes(q)).map((d) =>
            h("button", { type: "button", class: "lib-item lib-folder", onclick: () => { dir = d.path; load(); } }, h("div", { class: "lib-thumb" }, icon("folder")), h("div", { class: "lib-name" }, d.name)));
          const files = listing.files.filter((f) => accepts(f.kind) && f.name.toLowerCase().includes(q)).map((f) => tile(f.url, f.thumb, f.name, f.width ? `${f.width}×${f.height}` : kb(f.bytes), f.kind));
          body = h("div", {}, crumbs, listing.error ? h("p", { class: "f-note" }, listing.error) : null,
            folders.length || files.length ? h("div", { class: "lib-grid" }, folders, files) : h("p", { class: "f-note" }, "Nothing that fits here."));
        }

        modal.replaceChildren(
          h("form", { method: "dialog", style: { display: "contents" } },
            h("div", { class: "modal-head" }, h("h2", {}, title),
              h("div", { class: "seg" },
                h("button", { type: "button", "aria-pressed": String(source === "post"), onclick: () => { source = "post"; draw(); } }, "This post"),
                h("button", { type: "button", "aria-pressed": String(source === "site"), onclick: () => { source = "site"; load(); } }, "Site library")),
              h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => { modal.returnValue = ""; finish([]); } }, icon("close"))),
            h("div", { class: "modal-body" },
              h("div", { class: "lib-toolbar" },
                (() => { const i = h("input", { class: "input", type: "search", placeholder: "Filter by name", value: filter }); i.addEventListener("input", () => { filter = i.value; const pos = i.selectionStart; draw(); const again = $(".lib-toolbar .input", modal); again.focus(); again.setSelectionRange(pos, pos); }); return i; })(),
                h("button", { type: "button", class: "btn", onclick: async () => {
                  const files = await pickFiles({ multiple, accept: ACCEPT[accept] ?? "" });
                  const srcs = await importFiles(files);
                  source = "post";
                  for (const s of srcs) if (!chosen.includes(s)) { if (!multiple) chosen.length = 0; chosen.push(s); }
                  draw();
                } }, icon("upload"), "Upload…")),
              body),
            h("div", { class: "modal-foot" },
              h("span", { class: "grow" }, chosen.length ? `${chosen.length} selected${multiple ? " · in the order you picked them" : ""}` : multiple ? "Click to select; double-click to add one at once." : "Click to select; double-click to choose."),
              h("button", { type: "button", class: "btn", onclick: () => { modal.returnValue = ""; finish([]); } }, "Cancel"),
              h("button", { type: "button", class: "btn btn-primary", disabled: !chosen.length, onclick: () => { modal.returnValue = "ok"; finish(chosen.slice()); } }, multiple ? `Add${chosen.length ? ` ${chosen.length}` : ""}` : "Choose"))),
        );
      }

      modal.className = "modal";
      modal.returnValue = "";
      draw();
      if (!modal.open) modal.showModal();
    });
  }

  /* ============================================================= palette */
  function openPalette({ index = null } = {}) {
    const modal = $("#modal");
    modal.className = "modal";
    modal.onclose = null;
    const choose = (type) => {
      modal.close();
      if (type === "__pictures") {
        openLibrary({ multiple: true, accept: "media", title: "Pictures for a new gallery" }).then((srcs) => { if (srcs.length) insertBlocksAt(blocksFor(srcs), index ?? undefined); });
        return;
      }
      insertBlock(defaultBlock(type), index ?? undefined);
    };
    modal.replaceChildren(
      h("div", { class: "modal-head" }, h("h2", {}, "Add a block"), h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => modal.close() }, icon("close"))),
      h("div", { class: "modal-body" },
        h("div", { class: "palette" },
          h("button", { type: "button", onclick: () => choose("__pictures") }, h("span", { class: "type-icon" }, "▦"), h("strong", {}, "Gallery from pictures…"), h("small", {}, "Pick several pictures at once and get a gallery of them.")),
          state.site.catalogue.map((s) => h("button", { type: "button", disabled: s.hero && hasHero(), title: s.hero && hasHero() ? "The page already has a hero" : "", onclick: () => choose(s.type) },
            h("span", { class: "type-icon" }, TYPE_GLYPH[s.type] || "·"), h("strong", {}, s.label), h("small", {}, s.description))))),
    );
    modal.showModal();
  }

  /* ============================================================== checks */
  function renderChecks() {
    const badge = $("#checks-badge");
    const errors = state.findings.filter((f) => f.level === "error").length;
    const warns = state.findings.filter((f) => f.level === "warn").length;
    badge.className = `checks-badge${errors ? " error" : warns ? " warn" : ""}`;
    badge.textContent = errors ? `${errors} error${errors === 1 ? "" : "s"}${warns ? `, ${warns} warning${warns === 1 ? "" : "s"}` : ""}` : warns ? `${warns} warning${warns === 1 ? "" : "s"}` : "Ready to publish";
    badge.title = "What the build will say about this page";
  }

  function markFindings() {
    for (const el of $$(".is-invalid,.is-warned")) el.classList.remove("is-invalid", "is-warned");
    for (const f of state.findings) {
      if (f.level === "note") continue;
      const el = $(`#inspector-body [data-path="${CSS.escape(f.path)}"]`);
      if (!el) continue;
      const target = el.matches("input,textarea,.chips,.slot,.seg,.pic") ? el : $("input,textarea,.chips,.slot,.seg", el) || el;
      target.classList.add(f.level === "error" ? "is-invalid" : "is-warned");
    }
  }

  function describePath(path) {
    const m = /^blocks\[(\d+)\](?:\.items\[(\d+)\])?/.exec(path || "");
    if (!m) return path && path.startsWith("meta") ? "Page settings" : "";
    const top = state.doc.blocks[Number(m[1])];
    let label = top && spec(top.type) ? spec(top.type).label : "Block";
    if (m[2] !== undefined) { const inner = top?.items?.[Number(m[2])]; label += ` › column ${Number(m[2]) + 1}${inner && spec(inner.type) ? ` (${spec(inner.type).label})` : ""}`; }
    const pic = /\.images\[(\d+)\]/.exec(path);
    return `Block ${Number(m[1]) + 1}: ${label}${pic ? ` › picture ${Number(pic[1]) + 1}` : ""}`;
  }

  function openChecks() {
    const list = state.findings.filter((f) => f.level !== "note");
    const notes = state.findings.filter((f) => f.level === "note");
    const items = [...list, ...notes].map((f) => h("button", { type: "button", class: `finding ${f.level}`, onclick: () => { closePopover(); focusFinding(f.path); } },
      h("span", {}, f.message, f.detail ? h("small", {}, f.detail) : null, h("small", { class: "where" }, describePath(f.path)))));
    openPopover($("#checks-badge"), [
      h("div", { class: "pop-head" }, list.length ? "Before you publish" : "Nothing blocks publishing"),
      items.length ? items : h("p", { class: "f-note", style: { padding: "0 10px 8px" } }, "Every required field is filled, every picture has alt text and every file is in the folder."),
    ], { align: "right" });
  }

  function focusFinding(path) {
    if (!path) return;
    if (path.startsWith("meta")) { state.tab = "page"; state.sel = null; renderTabs(); renderInspector(); focusPath(path); return; }
    const blockPath = blockPathOf(path);
    if (!blockPath) { state.tab = "block"; select(null); return; }
    const pic = new RegExp(`^${blockPath.replace(/[[\].]/g, "\\$&")}\\.images\\[(\\d+)\\]`).exec(path);
    select(blockPath, pic ? Number(pic[1]) : null);
    focusPath(path);
  }

  function focusPath(path) {
    requestAnimationFrame(() => {
      let p = path;
      let el = null;
      while (p && !(el = $(`#inspector-body [data-path="${CSS.escape(p)}"]`))) {
        const cut = Math.max(p.lastIndexOf("."), p.lastIndexOf("["));
        p = cut > 0 ? p.slice(0, cut) : "";
      }
      if (!el) return;
      const details = el.closest("details");
      if (details) details.open = true;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      const input = el.matches("input,textarea,button") ? el : $("input,textarea,button", el);
      if (input) input.focus({ preventScroll: true });
      el.classList.remove("flash");
      void el.offsetWidth;
      el.classList.add("flash");
    });
  }

  /* ============================================================ popovers */
  let popoverAnchor = null;
  function openPopover(anchor, content, { align = "left" } = {}) {
    const pop = $("#popover");
    if (!pop.hidden && popoverAnchor === anchor) { closePopover(); return; }
    popoverAnchor = anchor;
    pop.replaceChildren(...[content].flat(Infinity));
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    pop.style.top = `${r.bottom + 6}px`;
    if (align === "right") { pop.style.left = ""; pop.style.right = `${Math.max(8, window.innerWidth - r.right)}px`; }
    else { pop.style.right = ""; pop.style.left = `${Math.max(8, r.left)}px`; }
  }
  function closePopover() { $("#popover").hidden = true; popoverAnchor = null; }
  document.addEventListener("mousedown", (e) => {
    const pop = $("#popover");
    if (!pop.hidden && !pop.contains(e.target) && !(popoverAnchor && popoverAnchor.contains(e.target))) closePopover();
  });

  /* ============================================================== toasts */
  function toast(message, { level = "info", action = null, details = null, sticky = false, progress = null } = {}) {
    const box = $("#toasts");
    const text = h("span", {}, message);
    const bar = progress != null ? h("div", { class: "toast-bar" }, h("i", { style: { width: `${Math.round(progress * 100)}%` } })) : null;
    let detailList = null;
    const el = h("div", { class: `toast${level === "error" ? " error" : ""}`, role: level === "error" ? "alert" : "status" },
      h("div", { class: "toast-row" }, text,
        details && details.length ? h("button", { type: "button", onclick: () => { if (detailList) { detailList.remove(); detailList = null; } else { detailList = h("ul", {}, details.map((d) => h("li", {}, d))); el.append(detailList); } } }, "Details") : null,
        action ? h("button", { type: "button", onclick: () => { action.fn(); close(); } }, action.label) : null,
        h("button", { type: "button", "aria-label": "Dismiss", onclick: () => close() }, "×")),
      bar);
    box.append(el);
    while (box.children.length > 4) box.firstElementChild.remove();
    let timer = sticky ? null : setTimeout(() => close(), action ? 7000 : 4000);
    function close() { clearTimeout(timer); el.remove(); }
    el.addEventListener("mouseenter", () => clearTimeout(timer));
    el.addEventListener("mouseleave", () => { if (!sticky) timer = setTimeout(() => close(), 2500); });
    return {
      update(msg, p) { text.textContent = msg; if (bar && p != null) bar.firstElementChild.style.width = `${Math.round(p * 100)}%`; },
      close,
    };
  }

  /* ============================================================== posts */
  function renderPostSwitch() {
    if (!state.doc) return;
    $("#post-title").textContent = state.doc.meta.title || state.folder;
    $("#post-meta").textContent = `/${state.slug || state.folder}.html${state.doc.meta.draft ? " · draft" : ""}`;
  }

  function openPostMenu() {
    const posts = state.site.posts;
    openPopover($("#post-switch"), [
      ...posts.map((p) => h("button", {
        type: "button", class: `menu-item${p.folder === state.folder ? " is-current" : ""}`, disabled: p.source !== "json",
        title: p.source !== "json" ? "A hand-written HTML page; edit it in a text editor" : "",
        onclick: async () => { closePopover(); if (p.folder !== state.folder) { await flushSave(); await loadPost(p.folder); } },
      }, h("span", {}, p.title || p.folder, h("small", {}, `${p.folder}${p.source !== "json" ? " · hand-written HTML" : ""}`)), p.draft ? h("span", { class: "tag draft" }, "Draft") : h("span"))),
      h("div", { class: "menu-sep" }),
      h("button", { type: "button", class: "menu-item", onclick: () => { closePopover(); openNewPost(); } }, h("span", {}, "New post…"), h("span")),
    ]);
  }

  async function refreshPostList() {
    try { const { posts } = await api.get("/api/posts"); state.site.posts = posts; } catch { /* decoration only */ }
  }

  /**
   * A folder name suggested from a title. Only a suggestion — the author can
   * edit it before the folder exists — so it can afford what the build's own
   * slugify() cannot: letters with no decomposition (ø, æ, ß, ł …) are spelled
   * out instead of dropped. slugify() leaves them alone on purpose, because
   * changing it would move published URLs.
   */
  const SPELLED = { "ø": "o", "Ø": "O", "æ": "ae", "Æ": "AE", "œ": "oe", "Œ": "OE", "ß": "ss",
    "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ð": "d", "Ð": "D", "þ": "th", "Þ": "TH", "ı": "i" };
  function slugifyFolder(s) {
    return String(s)
      .replace(/[øØæÆœŒßłŁđĐðÐþÞı]/g, (c) => SPELLED[c])
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
  }

  function openNewPost() {
    const modal = $("#modal");
    modal.className = "modal small";
    modal.onclose = null;
    let touched = false;
    const title = h("input", { class: "input", placeholder: "A walk up Galdhøpiggen" });
    const folder = h("input", { class: "input", placeholder: "a_walk_up_galdhopiggen" });
    const error = h("p", { class: "f-note", style: { color: "var(--ui-danger)" } });
    title.addEventListener("input", () => { if (!touched) folder.value = slugifyFolder(title.value); });
    folder.addEventListener("input", () => { touched = true; });
    const create = async () => {
      error.textContent = "";
      try {
        await flushSave();
        const result = await api.send("POST", "/api/posts", { folder: folder.value.trim(), title: title.value.trim() });
        state.site.posts = result.posts;
        modal.close();
        await loadPost(result.folder);
        toast("Post created as a draft. Drop pictures onto the page to begin.");
      } catch (e) { error.textContent = e.message; }
    };
    modal.replaceChildren(
      h("div", { class: "modal-head" }, h("h2", {}, "New post"), h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => modal.close() }, icon("close"))),
      h("div", { class: "modal-body" },
        h("div", { class: "f" }, h("div", { class: "f-head" }, h("span", { class: "f-label" }, "Title")), title),
        h("div", { class: "f" }, h("div", { class: "f-head" }, h("span", { class: "f-label" }, "Folder and address")), folder,
          h("div", { class: "f-note" }, "Becomes input_custom_post/<folder>/ and the page /<folder>.html. Letters, digits and underscores.")),
        error),
      h("div", { class: "modal-foot" }, h("span", { class: "grow" }), h("button", { type: "button", class: "btn", onclick: () => modal.close() }, "Cancel"), h("button", { type: "button", class: "btn btn-primary", onclick: create }, "Create")),
    );
    modal.showModal();
    title.focus();
    title.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });
    folder.addEventListener("keydown", (e) => { if (e.key === "Enter") create(); });
  }

  /* =============================================================== build */
  function openBuild() {
    const modal = $("#modal");
    modal.className = "modal";
    modal.onclose = null;
    const drafts = h("input", { type: "checkbox" });
    const out = h("div", {});
    const run = h("button", { type: "button", class: "btn btn-primary", onclick: async () => {
      run.disabled = true;
      out.replaceChildren(h("p", { class: "f-note" }, "Building… this takes a moment on a site full of photographs."));
      try {
        await flushSave();
        const result = await api.send("POST", "/api/build", { drafts: drafts.checked });
        const r = result.report;
        out.replaceChildren(
          r ? h("div", { class: "summary" },
            h("span", { class: r.errors ? "error" : r.warnings ? "warn" : "ok" }, r.errors ? "Built with errors" : r.warnings ? "Built with warnings" : "Built cleanly"),
            h("span", {}, `${r.pages} pages`), h("span", { class: r.errors ? "error" : "" }, `${r.errors} errors`), h("span", { class: r.warnings ? "warn" : "" }, `${r.warnings} warnings`),
            drafts.checked ? h("span", { class: "warn" }, "Includes drafts — do not deploy") : null) : null,
          r && r.findings.length ? h("div", {}, r.findings.slice(0, 60).map((f) => h("div", { class: `finding ${f.level}`, style: { cursor: "default" } }, h("span", {}, `${f.page} — ${f.message}`, f.detail ? h("small", {}, f.detail) : null)))) : null,
          h("details", { class: "more", style: { marginTop: "12px" } }, h("summary", {}, "Full output"), h("pre", { class: "log" }, `${result.output}\n\nexit code ${result.code}`)),
        );
      } catch (error) {
        out.replaceChildren(h("p", { class: "f-note", style: { color: "var(--ui-danger)" } }, `Build failed: ${error.message}`));
      } finally {
        run.disabled = false;
      }
    } }, "Build now");
    modal.replaceChildren(
      h("div", { class: "modal-head" }, h("h2", {}, "Build the site"), h("button", { type: "button", class: "icon-btn", "aria-label": "Close", onclick: () => modal.close() }, icon("close"))),
      h("div", { class: "modal-body" },
        h("p", { class: "f-note", style: { marginTop: 0 } }, "Runs site_generate exactly as you would from a terminal and writes the site to _site/. Saves first."),
        h("label", { class: "check-row" }, drafts, "Include drafts (a preview build; it is marked and must not be deployed)"),
        out),
      h("div", { class: "modal-foot" }, h("span", { class: "grow" }), h("button", { type: "button", class: "btn", onclick: () => modal.close() }, "Close"), run),
    );
    modal.showModal();
  }

  /* ============================================================ loading */
  function ensureShape() {
    const d = state.doc;
    if (typeof d.format !== "number") d.format = state.site.format;
    if (!d.meta || typeof d.meta !== "object") d.meta = {};
    if (!Array.isArray(d.blocks)) d.blocks = [];
  }

  async function flushSave() {
    if (isDirty() || state.saving) {
      scheduleSave.flush();
      while (state.saving) await new Promise((r) => setTimeout(r, 50));
    }
  }

  async function refreshRevisions() {
    try { const data = await api.get(`/api/posts/${state.folder}`); state.revisions = data.revisions; if (state.tab === "page") renderInspector(); } catch { /* keep the old list */ }
  }

  async function loadPost(folder) {
    const data = await api.get(`/api/posts/${encodeURIComponent(folder)}`);
    Object.assign(state, {
      folder, slug: data.slug, doc: data.doc, assets: data.assets, revisions: data.revisions, findings: data.check.findings,
      version: 0, savedVersion: 0, saveError: null, history: [], future: [], sel: null, filesSel: new Set(), canvasReady: false, canvasSheets: "", canvasScroll: 0,
    });
    ensureShape();
    snapshotNow();
    history.replaceState(null, "", `#${encodeURIComponent(folder)}`);
    renderPostSwitch();
    renderTabs();
    renderInspector();
    renderChecks();
    renderSaveState();
    renderHistory();
    renderFilesCount();
    refreshPreview();
  }

  async function boot() {
    state.site = await api.get("/api/site");
    document.title = `${state.site.name} — page builder`;
    const wanted = decodeURIComponent(location.hash.slice(1));
    const json = state.site.posts.filter((p) => p.source === "json");
    const first = json.find((p) => p.folder === wanted) || json[0];
    if (first) await loadPost(first.folder);
    else { $("#post-title").textContent = "No posts yet"; openNewPost(); }
  }

  /* ============================================================= wiring */
  $("#post-switch").addEventListener("click", openPostMenu);
  $("#checks-badge").addEventListener("click", openChecks);
  $("#save").addEventListener("click", () => { commit(); save(true); });
  $("#undo").addEventListener("click", undo);
  $("#redo").addEventListener("click", redo);
  $("#build").addEventListener("click", openBuild);
  for (const b of $$(".tabs [data-tab]")) b.addEventListener("click", () => { state.tab = b.dataset.tab; renderTabs(); renderInspector(); });
  for (const b of $$("#device [data-device]")) {
    b.addEventListener("click", () => {
      state.device = b.dataset.device;
      $("#canvas-wrap").dataset.device = state.device;
      for (const x of $$("#device [data-device]")) x.setAttribute("aria-pressed", String(x === b));
    });
  }

  // A file dropped outside a drop target must not navigate away from unsaved work.
  window.addEventListener("dragover", (e) => { if (Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault(); });
  window.addEventListener("drop", (e) => { if (Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault(); });

  /** Shortcuts, from the editor or forwarded by the canvas. Returns true when handled. */
  function handleKey({ key, mod, shift, typing }) {
    const k = key.toLowerCase();
    if (mod && k === "s") { commit(); save(true); return true; }
    if (typing) return false;
    if (mod && k === "z") { if (shift) redo(); else undo(); return true; }
    if (mod && k === "y") { redo(); return true; }
    if ($("#modal").open || !state.doc) return false;
    if (k === "escape") {
      if (!$("#popover").hidden) closePopover();
      else if (state.sel) select(state.sel.image != null ? state.sel.path : null);
      return true;
    }
    if ((k === "delete" || k === "backspace") && state.sel) {
      if (state.sel.image != null) {
        const block = getAt(state.doc, state.sel.path);
        const i = state.sel.image;
        mutate(() => block.images.splice(i, 1), { inspector: false });
        select(state.sel.path, block.images.length ? Math.min(i, block.images.length - 1) : null);
        toast("Picture removed from the gallery", { action: { label: "Undo", fn: undo } });
      } else if (getAt(state.doc, state.sel.path) !== null) {
        removeBlock(state.sel.path);
      }
      return true;
    }
    return false;
  }
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || Boolean(document.activeElement?.isContentEditable);
    if (handleKey({ key: e.key, mod: e.ctrlKey || e.metaKey, shift: e.shiftKey, typing })) e.preventDefault();
  });

  window.addEventListener("beforeunload", (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });
  // A post named in the address bar: #folder opens it, saving the current one first.
  window.addEventListener("hashchange", async () => {
    const wanted = decodeURIComponent(location.hash.slice(1));
    if (!wanted || wanted === state.folder || !state.site) return;
    if (!state.site.posts.some((p) => p.folder === wanted && p.source === "json")) return;
    await flushSave();
    await loadPost(wanted);
  });

  boot().catch((error) => toast(`Could not start: ${error.message}`, { level: "error", sticky: true }));
})();
