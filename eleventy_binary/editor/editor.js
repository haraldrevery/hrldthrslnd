/**
 * The page builder.
 *
 * One file, no framework, no build step. It edits a post document — the JSON
 * the build renders — and talks to the server that served it through the
 * handful of calls in `api` below. Everything it knows about blocks comes
 * from the catalogue the server hands over, so a new block type needs no
 * change here.
 *
 * The document in memory is the truth while the page is open. Every edit
 * marks it dirty, re-checks it, re-renders the preview, and after a pause
 * saves it. Save keeps a revision; autosave keeps one only every so often.
 * Undo and redo are snapshots of the whole document, taken when a field is
 * left or a block is moved, so a slip is one keystroke from undone.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------------ api */
  const api = {
    async get(url) {
      const res = await fetch(url);
      return unwrap(res);
    },
    async send(method, url, body) {
      const res = await fetch(url, {
        method,
        headers: { "content-type": "application/json", "x-editor": "1" },
        body: JSON.stringify(body ?? {}),
      });
      return unwrap(res);
    },
    async upload(url, files) {
      const form = new FormData();
      for (const file of files) form.append("file", file, file.name);
      const res = await fetch(url, { method: "POST", headers: { "x-editor": "1" }, body: form });
      return unwrap(res);
    },
  };
  async function unwrap(res) {
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || `${res.status} ${res.statusText}`);
    return data;
  }

  /* ---------------------------------------------------------------- state */
  const state = {
    site: null,
    folder: null,
    slug: null,
    doc: null,
    assets: [],
    revisions: [],
    findings: [],
    dirty: false,
    saving: false,
    snapshot: null,
    history: [],
    future: [],
    suggestions: {},
    collapsed: new Set(),
  };

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const spec = (type) => state.site.catalogue.find((b) => b.type === type);

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "class") el.className = value;
      else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
      else if (key === "dataset") Object.assign(el.dataset, value);
      else if (key in el && key !== "list") el[key] = value;
      else el.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      el.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  function setStatus(text, isError) {
    const el = $("status");
    el.textContent = text;
    el.classList.toggle("is-error", Boolean(isError));
  }

  /* -------------------------------------------------------------- history */
  function snapshotNow() {
    state.snapshot = clone(state.doc);
  }
  /** Record the document as it stood before the edit now being made. */
  function commit() {
    if (!state.snapshot || same(state.snapshot, state.doc)) return;
    state.history.push(state.snapshot);
    if (state.history.length > 200) state.history.shift();
    state.future = [];
    snapshotNow();
    updateHistoryButtons();
  }
  function undo() {
    commit();
    if (!state.history.length) return;
    state.future.push(clone(state.doc));
    state.doc = state.history.pop();
    snapshotNow();
    renderAll();
    markDirty();
  }
  function redo() {
    if (!state.future.length) return;
    state.history.push(clone(state.doc));
    state.doc = state.future.pop();
    snapshotNow();
    renderAll();
    markDirty();
  }
  function updateHistoryButtons() {
    $("undo").disabled = state.history.length === 0;
    $("redo").disabled = state.future.length === 0;
  }

  /* --------------------------------------------------------------- change */
  const scheduleCheck = debounce(runCheck, 500);
  const schedulePreview = debounce(refreshPreview, 700);
  const scheduleAutosave = debounce(() => save(false), 2500);

  function markDirty() {
    state.dirty = true;
    setStatus("Unsaved changes");
    scheduleCheck();
    schedulePreview();
    scheduleAutosave();
    updateHistoryButtons();
  }

  async function runCheck() {
    if (!state.doc) return;
    try {
      const result = await api.send("POST", `/api/posts/${state.folder}/check`, { doc: state.doc });
      state.findings = result.findings;
      renderChecks();
    } catch (error) {
      setStatus(`Check failed: ${error.message}`, true);
    }
  }

  async function refreshPreview() {
    if (!state.doc) return;
    const frame = $("preview");
    let scrollY = 0;
    try { scrollY = frame.contentWindow.scrollY || 0; } catch { /* not ours yet */ }
    try {
      const result = await api.send("POST", `/api/posts/${state.folder}/preview`, { doc: state.doc });
      frame.onload = () => { try { frame.contentWindow.scrollTo(0, scrollY); } catch { /* fine */ } };
      frame.srcdoc = result.html;
      $("preview-url").textContent = `— will publish at /${result.slug}.html`;
    } catch (error) {
      setStatus(`Preview failed: ${error.message}`, true);
    }
  }

  async function save(explicit) {
    if (!state.doc || state.saving) return;
    if (!explicit && !state.dirty) return;
    state.saving = true;
    setStatus(explicit ? "Saving…" : "Autosaving…");
    try {
      const result = await api.send("PUT", `/api/posts/${state.folder}`, { doc: state.doc, revision: explicit });
      state.dirty = false;
      state.findings = result.check.findings;
      renderChecks();
      setStatus(`Saved ${new Date().toLocaleTimeString()}${result.revision ? " · revision kept" : ""}`);
      if (result.revision) await refreshRevisions();
      refreshPostList();
    } catch (error) {
      setStatus(`Save failed: ${error.message}`, true);
    } finally {
      state.saving = false;
    }
  }

  /* -------------------------------------------------------------- loading */
  async function loadSite() {
    state.site = await api.get("/api/site");
    $("site-name").textContent = `${state.site.name} — page builder`;
    document.title = `${state.site.name} — page builder`;
    renderPostSelect();
    const wanted = decodeURIComponent(location.hash.slice(1));
    const first = state.site.posts.find((p) => p.folder === wanted && p.source === "json") || state.site.posts.find((p) => p.source === "json");
    if (first) await loadPost(first.folder);
    else setStatus("No JSON posts yet — click New");
  }

  async function refreshPostList() {
    try {
      const { posts } = await api.get("/api/posts");
      state.site.posts = posts;
      renderPostSelect();
    } catch { /* the list is decoration; the document is what matters */ }
  }

  function renderPostSelect() {
    const select = $("post-select");
    select.replaceChildren(
      ...state.site.posts.map((p) =>
        h("option", { value: p.folder, disabled: p.source !== "json", selected: p.folder === state.folder },
          `${p.folder}${p.title ? ` — ${p.title}` : ""}${p.draft ? " (draft)" : ""}${p.source !== "json" ? " (hand-written HTML)" : ""}`),
      ),
    );
  }

  async function loadPost(folder) {
    const data = await api.get(`/api/posts/${folder}`);
    state.folder = folder;
    state.slug = data.slug;
    state.doc = data.doc;
    ensureShape();
    state.assets = data.assets;
    state.revisions = data.revisions;
    state.findings = data.check.findings;
    state.dirty = false;
    state.history = [];
    state.future = [];
    state.collapsed = new Set();
    snapshotNow();
    location.hash = folder;
    renderPostSelect();
    renderAll();
    refreshPreview();
    setStatus(`Opened input_custom_post/${folder}/${folder}.json`);
  }

  function ensureShape() {
    const doc = state.doc;
    if (typeof doc.format !== "number") doc.format = state.site.format;
    if (!doc.meta || typeof doc.meta !== "object") doc.meta = {};
    if (!Array.isArray(doc.blocks)) doc.blocks = [];
  }

  async function refreshRevisions() {
    const data = await api.get(`/api/posts/${state.folder}`);
    state.revisions = data.revisions;
    renderRevisions();
  }

  /* ------------------------------------------------------------ rendering */
  function renderAll() {
    renderMeta();
    renderBlocks();
    renderAddBar();
    renderAssets();
    renderRevisions();
    renderChecks();
    updateHistoryButtons();
  }

  function renderMeta() {
    const box = $("meta");
    box.replaceChildren(...state.site.metaFields.map((field) => fieldControl(field, state.doc.meta, `meta.${field.name}`)));
  }

  function renderBlocks() {
    const box = $("blocks");
    if (!state.doc.blocks.length) {
      box.replaceChildren(h("p", { class: "ed-hint" }, "No blocks yet. Add one below — a hero first, if the page wants an opening screen."));
      return;
    }
    box.replaceChildren(...state.doc.blocks.map((block, i) => blockCard(block, i)));
  }

  function blockCard(block, index) {
    const s = spec(block.type);
    const path = `blocks[${index}]`;
    const key = `${index}:${block.type}`;
    const collapsed = state.collapsed.has(key);
    const body = h("div", { class: `ed-block-body${collapsed ? " is-collapsed" : ""}` });

    if (!s) {
      body.append(h("p", { class: "ed-hint" }, `Unknown block type "${block.type}". Remove it, or fix the type in the file.`));
    } else if (s.type === "columns") {
      body.append(columnsEditor(block, path));
    } else {
      body.append(...s.fields.map((field) => fieldControl(field, block, `${path}.${field.name}`)));
    }

    const head = h("div", { class: "ed-block-head" },
      h("span", { class: "ed-type" }, s ? s.label : block.type),
      h("span", { class: "ed-desc" }, s ? s.description : ""),
      iconButton("▲", "Move up", () => moveBlock(index, -1), index === 0 || (s && s.hero)),
      iconButton("▼", "Move down", () => moveBlock(index, 1), index === state.doc.blocks.length - 1 || (s && s.hero) || spec(state.doc.blocks[index + 1]?.type)?.hero),
      iconButton("⧉", "Duplicate", () => duplicateBlock(index), s && s.hero),
      iconButton(collapsed ? "＋" : "－", collapsed ? "Expand" : "Collapse", () => {
        if (collapsed) state.collapsed.delete(key); else state.collapsed.add(key);
        renderBlocks();
      }),
      iconButton("✕", "Remove", () => removeBlock(index)),
    );

    return h("div", { class: `ed-block${s && s.hero ? " is-hero" : ""}`, dataset: { path } }, head, body);
  }

  function iconButton(glyph, title, onclick, disabled) {
    return h("button", { type: "button", class: "ed-btn ed-btn-small", title, onclick, disabled: Boolean(disabled) }, glyph);
  }

  function columnsEditor(block, path) {
    if (!Array.isArray(block.items)) block.items = [];
    while (block.items.length < 2) block.items.push(null);
    const slots = block.items.slice(0, 2).map((item, i) => {
      const slot = h("div", { class: "ed-col" });
      const typeSelect = h("select", {
        onchange: (e) => {
          commit();
          block.items[i] = e.target.value ? defaultBlock(e.target.value) : null;
          snapshotNow();
          renderBlocks();
          markDirty();
        },
      },
        h("option", { value: "" }, "— empty —"),
        ...state.site.columnTypes.map((type) => h("option", { value: type, selected: item && item.type === type }, spec(type).label)),
      );
      slot.append(h("label", { class: "ed-field" }, h("span", {}, `Column ${i + 1}`), typeSelect));
      if (item && spec(item.type)) {
        slot.append(...spec(item.type).fields.map((field) => fieldControl(field, item, `${path}.items[${i}].${field.name}`)));
      }
      return slot;
    });
    return h("div", { class: "ed-columns" }, ...slots);
  }

  function defaultBlock(type) {
    const s = spec(type);
    const block = { type };
    for (const field of s.fields) {
      if (field.default !== undefined) block[field.name] = field.default;
      else if (["images", "strings", "actions", "faq_items", "blocks"].includes(field.kind)) block[field.name] = [];
      else if (field.kind === "image") block[field.name] = null;
      else block[field.name] = "";
    }
    return block;
  }

  /* --------------------------------------------------------------- fields */
  function label(field) {
    return h("span", { class: field.required ? "ed-required" : "" }, field.label || field.name);
  }
  function hint(field) {
    return field.help ? h("span", { class: "ed-hint" }, field.help) : null;
  }

  /** One control bound to target[field.name], by kind. */
  function fieldControl(field, target, path) {
    const value = target[field.name];
    const bind = (el, read) => {
      el.dataset.path = path;
      el.addEventListener("input", () => { target[field.name] = read(el); markDirty(); });
      el.addEventListener("change", () => { target[field.name] = read(el); commit(); markDirty(); });
      return el;
    };

    switch (field.kind) {
      case "text":
        return h("label", { class: "ed-field" }, label(field), bind(h("input", { type: "text", value: value ?? "" }), (el) => el.value), hint(field));
      case "date":
        return h("label", { class: "ed-field" }, label(field), bind(h("input", { type: "date", value: value ?? "" }), (el) => el.value), hint(field));
      case "textarea":
        return h("label", { class: "ed-field" }, label(field), bind(h("textarea", { value: value ?? "" }), (el) => el.value), hint(field));
      case "markdown":
        return h("label", { class: "ed-field" }, label(field), bind(h("textarea", { class: "ed-markdown", value: value ?? "", spellcheck: true }), (el) => el.value), hint(field));
      case "html":
        return h("label", { class: "ed-field" }, label(field), bind(h("textarea", { class: "ed-code", value: value ?? "", spellcheck: false }), (el) => el.value), hint(field));
      case "boolean": {
        const box = h("input", { type: "checkbox", checked: value === true });
        return h("label", { class: "ed-field" }, h("span", {}, field.label), bind(box, (el) => el.checked), hint(field));
      }
      case "select": {
        const select = h("select", {}, ...field.options.map((o) => h("option", { value: o.value, selected: (value ?? field.default) === o.value }, o.label)));
        return h("label", { class: "ed-field" }, label(field), bind(select, (el) => el.value), hint(field));
      }
      case "strings": {
        const area = h("textarea", { value: Array.isArray(value) ? value.join("\n") : "" });
        return h("label", { class: "ed-field" }, label(field), bind(area, (el) => el.value.split("\n").map((s) => s.trim()).filter(Boolean)), hint(field), h("span", { class: "ed-hint" }, "One per line."));
      }
      case "file":
        return h("label", { class: "ed-field" }, label(field), assetInput(value ?? "", field.accept, path, (v) => { target[field.name] = v; }), hint(field));
      case "image": {
        if (!target[field.name] || typeof target[field.name] !== "object") target[field.name] = { src: "", alt: "", title: "", caption: "" };
        return h("div", { class: "ed-field" }, label(field), imageControl(target[field.name], path), hint(field));
      }
      case "images":
        return listControl(field, target, path, () => ({ src: "", alt: "", title: "", caption: "" }), (item, itemPath) => imageControl(item, itemPath), "picture");
      case "actions":
        return listControl(field, target, path, () => ({ label: "", href: "" }), (item, itemPath) =>
          h("div", {}, fieldControl({ name: "label", label: "Label", kind: "text" }, item, `${itemPath}.label`), fieldControl({ name: "href", label: "Link", kind: "text" }, item, `${itemPath}.href`)), "button");
      case "faq_items":
        return listControl(field, target, path, () => ({ question: "", answer: "" }), (item, itemPath) =>
          h("div", {}, fieldControl({ name: "question", label: "Question", kind: "text", required: true }, item, `${itemPath}.question`), fieldControl({ name: "answer", label: "Answer (markdown)", kind: "markdown" }, item, `${itemPath}.answer`)), "question");
      default:
        return h("p", { class: "ed-hint" }, `(${field.kind} field "${field.name}" has no control)`);
    }
  }

  /** A list of sub-objects with add, remove and reorder. */
  function listControl(field, target, path, blank, renderItem, noun) {
    if (!Array.isArray(target[field.name])) target[field.name] = [];
    const items = target[field.name];
    const box = h("div", { class: "ed-field", dataset: { path } }, label(field), hint(field));
    const list = h("div", {});
    const redraw = () => {
      list.replaceChildren(...items.map((item, i) => {
        const itemPath = `${path}[${i}]`;
        return h("div", { class: "ed-list-item", dataset: { path: itemPath } },
          h("div", { class: "ed-list-item-head" },
            h("span", { class: "micro" }, `${noun} ${i + 1}`),
            iconButton("▲", "Move up", () => { commit(); items.splice(i - 1, 0, items.splice(i, 1)[0]); snapshotNow(); redraw(); markDirty(); }, i === 0),
            iconButton("▼", "Move down", () => { commit(); items.splice(i + 1, 0, items.splice(i, 1)[0]); snapshotNow(); redraw(); markDirty(); }, i === items.length - 1),
            iconButton("✕", "Remove", () => { commit(); items.splice(i, 1); snapshotNow(); redraw(); markDirty(); }),
          ),
          renderItem(item, itemPath),
        );
      }));
    };
    redraw();
    box.append(list, h("button", { type: "button", class: "ed-btn ed-btn-small", style: "margin-top:0.5rem", onclick: () => { commit(); items.push(blank()); snapshotNow(); redraw(); markDirty(); } }, `+ ${noun}`));
    return box;
  }

  /** src, alt, title, caption for one picture, with a thumbnail beside it. */
  function imageControl(img, path) {
    // The box is always in the grid, picture or not: a hidden <img> is
    // display:none, which takes it out of the grid and drops the fields into
    // the thumbnail column.
    const thumb = h("img", { class: "ed-thumb", alt: "" });
    const thumbBox = h("div", { class: "ed-thumb-box" }, thumb);
    const updateThumb = () => {
      const url = assetPreviewUrl(img.src);
      if (url) { thumb.src = url; thumb.hidden = false; } else { thumb.removeAttribute("src"); thumb.hidden = true; }
    };
    updateThumb();
    const fields = h("div", {},
      h("label", { class: "ed-field" }, h("span", { class: "ed-required" }, "File"), assetInput(img.src ?? "", "image", `${path}.src`, (v) => {
        img.src = v;
        const suggestion = state.suggestions[v];
        if (suggestion) {
          if (!img.alt && suggestion.alt) img.alt = suggestion.alt;
          if (!img.title && suggestion.title) img.title = suggestion.title;
        }
        updateThumb();
      })),
      fieldControl({ name: "alt", label: "Alt text", kind: "text", help: "What the picture shows. Not the caption." }, img, `${path}.alt`),
      fieldControl({ name: "title", label: "Title", kind: "text", help: "The lightbox heading." }, img, `${path}.title`),
      fieldControl({ name: "caption", label: "Caption", kind: "text", help: "Shown under waterfall cells." }, img, `${path}.caption`),
    );
    return h("div", { class: "ed-image-row" }, thumbBox, fields);
  }

  /** A file reference: a folder asset (picked from the list) or a typed site path. */
  function assetInput(value, accept, path, onValue) {
    const listId = `assets-${accept || "any"}`;
    ensureDatalist(listId, accept);
    const input = h("input", { type: "text", value, list: listId, placeholder: "file in this folder, or /image/… site path" });
    input.setAttribute("list", listId);
    input.dataset.path = path;
    input.addEventListener("input", () => { onValue(input.value.trim()); markDirty(); });
    input.addEventListener("change", () => { onValue(input.value.trim()); commit(); markDirty(); });
    return input;
  }

  function ensureDatalist(id, accept) {
    let list = $(id);
    if (!list) {
      list = h("datalist", { id });
      document.body.append(list);
    }
    const wanted = state.assets.filter((a) => !a.isMin && (accept === "any" || !accept || a.kind === accept));
    list.replaceChildren(...wanted.map((a) => h("option", { value: a.name })));
  }

  function assetPreviewUrl(src) {
    if (!src) return "";
    if (src.startsWith("/")) return minVariant(src);
    const asset = state.assets.find((a) => a.name === src);
    if (!asset || asset.kind !== "image") return "";
    const min = src.replace(/\.[^.]+$/, "_min.jpg");
    return `/${state.slug}/${asset.hasMin ? min : src}`;
  }

  function minVariant(src) {
    if (!/\.(jpe?g|png|webp)$/i.test(src) || /_min\.jpe?g$/i.test(src)) return src;
    const base = src.replace(/\.[^.]+$/, "");
    return base.startsWith("/image/") ? `/image_min/${base.slice(7)}_min.jpg` : `${base}_min.jpg`;
  }

  /* ---------------------------------------------------------- structure */
  function moveBlock(index, delta) {
    commit();
    const blocks = state.doc.blocks;
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    blocks.splice(target, 0, blocks.splice(index, 1)[0]);
    snapshotNow();
    renderBlocks();
    markDirty();
  }
  function removeBlock(index) {
    const block = state.doc.blocks[index];
    const s = spec(block.type);
    if (!window.confirm(`Remove this ${s ? s.label.toLowerCase() : block.type} block? Undo can bring it back.`)) return;
    commit();
    state.doc.blocks.splice(index, 1);
    snapshotNow();
    renderBlocks();
    renderAddBar();
    markDirty();
  }
  function duplicateBlock(index) {
    commit();
    state.doc.blocks.splice(index + 1, 0, clone(state.doc.blocks[index]));
    snapshotNow();
    renderBlocks();
    markDirty();
  }
  function addBlock(type) {
    commit();
    const block = defaultBlock(type);
    if (spec(type).hero) state.doc.blocks.unshift(block);
    else state.doc.blocks.push(block);
    snapshotNow();
    renderBlocks();
    renderAddBar();
    markDirty();
    const cards = $("blocks").querySelectorAll(".ed-block");
    const card = spec(type).hero ? cards[0] : cards[cards.length - 1];
    if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderAddBar() {
    const hasHero = state.doc.blocks.some((b) => spec(b.type)?.hero);
    $("add-block").replaceChildren(
      h("span", { class: "micro" }, "Add a block"),
      ...state.site.catalogue.map((s) =>
        h("button", { type: "button", class: "ed-btn ed-btn-small", title: s.description, disabled: s.hero && hasHero, onclick: () => addBlock(s.type) }, s.label)),
    );
  }

  /* -------------------------------------------------------------- panels */
  function renderAssets() {
    const box = $("assets");
    const shown = state.assets.filter((a) => !a.isMin);
    if (!shown.length) {
      box.replaceChildren(h("p", { class: "ed-hint" }, "No files yet."));
      return;
    }
    box.replaceChildren(h("div", { class: "ed-assets" }, ...shown.map((a) => {
      const missingMin = a.kind === "image" && a.hasMin === false;
      const visual = a.kind === "image"
        ? h("img", { src: `/${state.slug}/${a.hasMin ? a.name.replace(/\.[^.]+$/, "_min.jpg") : a.name}`, alt: "", loading: "lazy" })
        : h("div", { class: "ed-kind" }, a.kind);
      return h("div", { class: `ed-asset${missingMin ? " is-missing-min" : ""}`, title: `${a.name}${a.width ? ` · ${a.width}×${a.height}` : ""} · ${Math.round(a.bytes / 1000)} kB${missingMin ? " · no _min counterpart yet (the build makes one)" : ""}` }, visual, a.name);
    })));
    for (const id of ["assets-image", "assets-video", "assets-audio", "assets-any"]) {
      if ($(id)) ensureDatalist(id, id.slice(7));
    }
  }

  function renderRevisions() {
    const box = $("revisions");
    if (!state.revisions.length) {
      box.replaceChildren(h("p", { class: "ed-hint" }, "No revisions yet. Save keeps one every time; autosave every fifteen minutes."));
      return;
    }
    box.replaceChildren(...state.revisions.map((r) =>
      h("div", { class: "ed-revision" },
        h("span", { class: "micro" }, new Date(r.saved).toLocaleString()),
        h("button", { type: "button", class: "ed-btn ed-btn-small", onclick: async () => {
          const { doc } = await api.get(`/api/posts/${state.folder}/revisions/${r.name}`);
          commit();
          state.doc = doc;
          ensureShape();
          snapshotNow();
          renderAll();
          markDirty();
          setStatus("Revision loaded — unsaved until you save");
        } }, "Load"),
      )));
  }

  function renderChecks() {
    const box = $("checks");
    const findings = state.findings || [];
    const worst = findings.some((f) => f.level === "error") ? "error" : findings.some((f) => f.level === "warn") ? "warn" : findings.length ? "note" : "ok";
    const words = { ok: "All clear", note: "Notes", warn: "Warnings — publishes with defects", error: "Errors — fix before publishing" };
    box.replaceChildren(
      h("div", { class: `ed-verdict ${worst}` }, words[worst]),
      ...findings.map((f) =>
        h("div", { class: "ed-finding", onclick: () => focusPath(f.path) },
          h("span", { class: `ed-level ${f.level}` }, f.level),
          h("span", {}, f.message, f.path ? h("span", { class: "ed-path" }, ` ${f.path}`) : null, f.detail ? h("span", { class: "ed-detail" }, f.detail) : null),
        )),
    );
    for (const el of document.querySelectorAll(".ed-invalid, .ed-warn-field")) el.classList.remove("ed-invalid", "ed-warn-field");
    for (const f of findings) {
      const el = document.querySelector(`[data-path="${CSS.escape(f.path)}"]`);
      if (el && f.level !== "note") el.classList.add(f.level === "error" ? "ed-invalid" : "ed-warn-field");
    }
  }

  function focusPath(path) {
    if (!path) return;
    let el = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
    let p = path;
    while (!el && p.includes(".")) {
      p = p.slice(0, p.lastIndexOf("."));
      el = document.querySelector(`[data-path="${CSS.escape(p)}"]`);
    }
    if (!el) return;
    const card = el.closest(".ed-block");
    if (card) {
      const body = card.querySelector(".ed-block-body");
      if (body && body.classList.contains("is-collapsed")) {
        const idx = Array.from($("blocks").children).indexOf(card);
        state.collapsed.delete(`${idx}:${state.doc.blocks[idx].type}`);
        renderBlocks();
        return focusPath(path);
      }
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
  }

  /* --------------------------------------------------------------- upload */
  async function uploadFiles(files) {
    if (!files.length) return;
    const log = $("upload-log");
    setStatus(`Importing ${files.length} file(s)…`);
    try {
      const result = await api.upload(`/api/posts/${state.folder}/assets`, files);
      state.assets = result.assets;
      for (const r of result.results) {
        if (r.primary && r.suggested) state.suggestions[r.primary] = r.suggested;
        log.prepend(h("div", {},
          h("strong", {}, r.primary ? `${r.original} → ${r.written.join(", ")}` : `${r.original}: not imported`),
          ...r.notices.map((n) => h("div", { class: "ed-finding", style: "cursor:default" }, h("span", { class: `ed-level ${n.level}` }, n.level), h("span", {}, n.message, n.detail ? h("span", { class: "ed-detail" }, n.detail) : null))),
        ));
      }
      renderAssets();
      setStatus(`Imported ${result.results.filter((r) => r.primary).length} file(s)`);
      runCheck();
    } catch (error) {
      setStatus(`Import failed: ${error.message}`, true);
    }
  }

  /* ---------------------------------------------------------------- build */
  async function runBuild() {
    const log = $("build-log");
    const button = $("build-run");
    button.disabled = true;
    log.textContent = "Running site_generate… (this can take a while on a site full of photographs)\n";
    try {
      if (state.dirty) await save(false);
      const result = await api.send("POST", "/api/build", { drafts: $("build-drafts").checked });
      const report = result.report;
      log.textContent =
        (report ? `${report.verdict.toUpperCase()}: ${report.pages} page(s), ${report.errors} error(s), ${report.warnings} warning(s)\n\n` : "") +
        result.output +
        (report && report.findings.length ? "\n\nFindings:\n" + report.findings.map((f) => `[${f.level}] ${f.scope}: ${f.page} — ${f.message}${f.detail ? ` — ${f.detail}` : ""}`).join("\n") : "") +
        `\n\nexit code ${result.code}`;
    } catch (error) {
      log.textContent += `\nBuild failed: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  }

  /* ---------------------------------------------------------------- wiring */
  $("post-select").addEventListener("change", async (e) => {
    if (state.dirty) await save(false);
    await loadPost(e.target.value);
  });
  $("save").addEventListener("click", () => save(true));
  $("undo").addEventListener("click", undo);
  $("redo").addEventListener("click", redo);
  $("upload").addEventListener("change", (e) => { uploadFiles(Array.from(e.target.files)); e.target.value = ""; });

  $("build").addEventListener("click", () => $("build-dialog").showModal());
  $("build-run").addEventListener("click", runBuild);
  $("build-close").addEventListener("click", () => $("build-dialog").close());

  $("new-post").addEventListener("click", () => { $("new-folder").value = ""; $("new-title").value = ""; $("new-dialog").showModal(); });
  $("new-cancel").addEventListener("click", () => $("new-dialog").close());
  $("new-create").addEventListener("click", async () => {
    const folder = $("new-folder").value.trim();
    const title = $("new-title").value.trim();
    try {
      if (state.dirty) await save(false);
      const result = await api.send("POST", "/api/posts", { folder, title });
      state.site.posts = result.posts;
      $("new-dialog").close();
      await loadPost(folder);
    } catch (error) {
      setStatus(`Could not create: ${error.message}`, true);
    }
  });

  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const editing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
    if (e.key.toLowerCase() === "s") { e.preventDefault(); save(true); }
    else if (e.key.toLowerCase() === "z" && !editing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  });

  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ""; }
  });

  loadSite().catch((error) => setStatus(`Could not load: ${error.message}`, true));
})();
