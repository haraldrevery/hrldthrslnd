/**
 * The canvas overlay: what makes the preview editable.
 *
 * Runs INSIDE the preview page, and only there. The editor's server appends it
 * to a preview render; the build never sees it, and neither do the `data-block`
 * and `data-image` paths it reads, which the renderer adds only when the editor
 * asks for them.
 *
 *   hover     outlines the block under the pointer
 *   click     selects a block, or a picture in a gallery
 *   toolbar   on the selected block: drag grip, up, down, duplicate, remove
 *   insert    a "+" under the selected block, and "Add block" at the end
 *   drop      files from the desktop or pictures from the editor's library,
 *             onto a block or between blocks
 *
 * Nothing here edits the document. Every action is a message to the editor,
 * which owns the document, changes it and sends back new content. The overlay
 * keeps no state across updates except which path is selected.
 *
 * Clicks are caught in the capture phase and stopped, so a link in the page
 * selects its block instead of navigating, and the lightbox never opens.
 */
(function () {
  "use strict";

  // The editor's origin. Not window.location.origin: this page is a srcdoc
  // document, whose location is about:srcdoc and whose origin reads as "null",
  // so messages addressed with it are silently dropped. The parent is the same
  // origin (that is what lets it load us), so its location is the answer.
  const origin = window.parent.location.origin;
  const send = (message) => window.parent.postMessage({ source: "canvas", ...message }, origin);

  const TOP_LEVEL = /^blocks\[\d+\]$/;
  const main = () => document.querySelector("main");
  const topBlocks = () => Array.from(main().querySelectorAll("[data-block]")).filter((el) => TOP_LEVEL.test(el.dataset.block));
  const indexOf = (path) => Number((/^blocks\[(\d+)\]/.exec(path) || [])[1]);
  const byPath = (path) => (path ? main().querySelector(`[data-block="${CSS.escape(path)}"]`) : null);
  const imageByPath = (path) => (path ? main().querySelector(`[data-image="${CSS.escape(path)}"]`) : null);

  let labels = {};
  let emptyLabel = "Empty column";
  let selected = null; // { path, image }
  let hovered = null;

  /* ----------------------------------------------------------------- style */
  const style = document.createElement("style");
  style.textContent = `
    [data-block] { cursor: pointer; }
    [data-block].cv-hover { outline: 1px dashed rgba(79,107,255,0.75); outline-offset: -1px; }
    [data-block].cv-selected { outline: 2px solid #4f6bff; outline-offset: -2px; }
    [data-image].cv-selected { outline: 3px solid #4f6bff; outline-offset: -3px; }
    .block-col[data-block-type="empty"] { min-height: 8rem; border: 1.5px dashed rgba(127,127,127,0.5); border-radius: 6px; display: grid; place-items: center; }
    .block-col[data-block-type="empty"]::after { content: attr(data-empty-label); color: rgba(127,127,127,0.9); font: 13px system-ui, sans-serif; }
    .cv-toolbar { position: absolute; z-index: 2147483000; display: flex; align-items: center; gap: 1px; padding: 3px; background: #1d1f25; color: #f2f2f4;
      border-radius: 7px; font: 12px/1 system-ui, sans-serif; box-shadow: 0 4px 18px rgba(0,0,0,0.28); user-select: none; }
    .cv-toolbar button { all: unset; cursor: pointer; min-width: 26px; height: 26px; display: grid; place-items: center; border-radius: 5px; color: inherit; font-size: 13px; }
    .cv-toolbar button:hover { background: rgba(255,255,255,0.14); }
    .cv-toolbar button[disabled] { opacity: 0.3; cursor: default; background: none; }
    .cv-toolbar .cv-grip { cursor: grab; letter-spacing: -2px; }
    .cv-toolbar .cv-label { padding: 0 8px 0 6px; font-weight: 600; font-size: 11.5px; }
    .cv-toolbar .cv-sep { width: 1px; height: 16px; background: rgba(255,255,255,0.18); margin: 0 3px; }
    .cv-insert { position: absolute; z-index: 2147483000; transform: translate(-50%, -50%); }
    .cv-insert button, .cv-end button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 12px; border-radius: 14px;
      background: #4f6bff; color: #fff; font: 600 12px system-ui, sans-serif; box-shadow: 0 2px 10px rgba(0,0,0,0.25); }
    .cv-insert button:hover, .cv-end button:hover { background: #3d58ea; }
    .cv-end { display: flex; justify-content: center; padding: 28px 0 56px; }
    .cv-end button { background: transparent; color: #4f6bff; box-shadow: none; border: 1.5px dashed rgba(79,107,255,0.6); }
    .cv-end button:hover { background: rgba(79,107,255,0.1); }
    .cv-dropline { position: absolute; left: 0; right: 0; height: 3px; margin-top: -1.5px; background: #4f6bff; z-index: 2147483000; pointer-events: none; border-radius: 2px; }
    .cv-dropzone { outline: 2px dashed #4f6bff !important; outline-offset: -2px; }
    .cv-dropzone::before { content: "Drop to add here"; position: absolute; z-index: 2147482999; top: 12px; left: 50%; transform: translateX(-50%); background: #4f6bff; color: #fff; font: 600 12px system-ui, sans-serif; padding: 5px 10px; border-radius: 12px; }
    .cv-ghost { position: fixed; z-index: 2147483001; pointer-events: none; padding: 6px 10px; background: #1d1f25; color: #fff; font: 12px system-ui, sans-serif; border-radius: 6px; opacity: 0.92; }
    html.cv-dragging, html.cv-dragging * { cursor: grabbing !important; }
    .cv-empty { min-height: 60vh; display: grid; place-items: center; text-align: center; color: #8a8c93; font: 15px/1.5 system-ui, sans-serif; padding: 2rem; }
    .cv-empty strong { display: block; font-size: 18px; color: #50525a; margin-bottom: 4px; }
  `;
  document.head.append(style);

  const toolbar = document.createElement("div");
  toolbar.className = "cv-toolbar";
  toolbar.hidden = true;
  const insert = document.createElement("div");
  insert.className = "cv-insert";
  insert.hidden = true;
  const dropline = document.createElement("div");
  dropline.className = "cv-dropline";
  dropline.hidden = true;
  const end = document.createElement("div");
  end.className = "cv-end";
  document.body.append(toolbar, insert, dropline);
  main().after(end);

  const button = (text, title, onclick, disabled) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.disabled = Boolean(disabled);
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onclick(); });
    return b;
  };

  /* ------------------------------------------------------------- decorate */
  /** Everything that has to be redone whenever the content is replaced. */
  function decorate() {
    for (const el of main().querySelectorAll('[data-block-type="empty"]')) el.dataset.emptyLabel = emptyLabel;
    end.replaceChildren(button("+  Add block", "Add a block at the end", () => send({ type: "add-at", index: topBlocks().length })));
    if (!topBlocks().length && !main().querySelector(".cv-empty")) {
      const empty = document.createElement("div");
      empty.className = "cv-empty";
      empty.innerHTML = "<div><strong>Drop pictures here</strong>to start a gallery, or add a block below.</div>";
      main().append(empty);
    }
    hovered = null;
    applySelection();
  }

  function applySelection() {
    for (const el of document.querySelectorAll(".cv-selected")) el.classList.remove("cv-selected");
    if (selected) {
      byPath(selected.path)?.classList.add("cv-selected");
      imageByPath(selected.image)?.classList.add("cv-selected");
    }
    buildToolbar();
    place();
  }

  function place() {
    const el = selected && byPath(selected.path);
    if (!el) { toolbar.hidden = true; insert.hidden = true; return; }
    const rect = el.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    toolbar.hidden = false;
    // Pinned to the block's top-right corner, and held on screen while the
    // block is taller than the viewport and scrolled past its top.
    const y = Math.min(Math.max(top + 10, window.scrollY + 10), top + rect.height - toolbar.offsetHeight - 10);
    toolbar.style.top = `${Math.max(y, top + 4)}px`;
    toolbar.style.left = `${Math.max(rect.right + window.scrollX - toolbar.offsetWidth - 10, 8)}px`;
    if (TOP_LEVEL.test(selected.path)) {
      insert.hidden = false;
      insert.style.top = `${top + rect.height}px`;
      insert.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
    } else {
      insert.hidden = true;
    }
  }

  function buildToolbar() {
    toolbar.replaceChildren();
    insert.replaceChildren();
    const el = selected && byPath(selected.path);
    if (!el) return;
    const top = TOP_LEVEL.test(selected.path);
    const type = el.dataset.blockType;
    const hero = type === "hero";
    const blocks = topBlocks();
    const i = indexOf(selected.path);
    const label = document.createElement("span");
    label.className = "cv-label";
    label.textContent = type === "empty" ? emptyLabel : labels[type] || type;
    toolbar.append(label);

    if (top && !hero) {
      const sep = document.createElement("span");
      sep.className = "cv-sep";
      const grip = button("⋮⋮", "Drag to move", () => {});
      grip.className = "cv-grip";
      grip.addEventListener("pointerdown", startDrag);
      const firstMovable = blocks[0]?.dataset.blockType === "hero" ? 1 : 0;
      toolbar.append(sep, grip,
        button("↑", "Move up", () => send({ type: "move", from: i, to: i - 1 }), i <= firstMovable),
        button("↓", "Move down", () => send({ type: "move", from: i, to: i + 1 }), i === blocks.length - 1),
        button("⧉", "Duplicate", () => send({ type: "duplicate", path: selected.path })));
    }
    if (type !== "empty") toolbar.append(button("✕", top ? "Remove block" : "Clear this column", () => send({ type: "remove", path: selected.path })));
    if (top) insert.append(button("+  Add block", "Insert a block below this one", () => send({ type: "add-at", index: i + 1 })));
  }

  function select(path, image, { announce = true } = {}) {
    selected = path ? { path, image: image || null } : null;
    applySelection();
    if (announce) send({ type: "select", path: selected?.path ?? null, image: selected?.image ?? null });
  }

  /* --------------------------------------------------------------- events */
  document.addEventListener("click", (e) => {
    if (toolbar.contains(e.target) || insert.contains(e.target) || end.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    const image = e.target.closest("[data-image]");
    // The innermost block: a column inside a row, rather than the row.
    const block = e.target.closest("[data-block]");
    select(block?.dataset.block ?? null, image?.dataset.image ?? null);
  }, true);
  // Forms, details and media controls must not act on a click meant to select.
  document.addEventListener("submit", (e) => e.preventDefault(), true);

  document.addEventListener("mouseover", (e) => {
    const block = e.target.closest("[data-block]");
    if (hovered === block) return;
    hovered?.classList.remove("cv-hover");
    hovered = block;
    block?.classList.add("cv-hover");
  });
  document.addEventListener("mouseleave", () => { hovered?.classList.remove("cv-hover"); hovered = null; });
  window.addEventListener("scroll", place, { passive: true });
  window.addEventListener("resize", place);

  // Keys the editor handles, forwarded while the canvas has focus.
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (["delete", "backspace", "escape"].includes(k) || (mod && ["z", "y", "s"].includes(k))) {
      e.preventDefault();
      send({ type: "key", key: e.key, mod, shift: e.shiftKey });
    }
  });

  window.addEventListener("message", (e) => {
    if (e.origin !== origin || !e.data || e.data.source !== "editor") return;
    const m = e.data;
    if (m.type === "labels") { labels = m.labels || {}; emptyLabel = m.empty || emptyLabel; decorate(); }
    else if (m.type === "update") { main().innerHTML = m.html; decorate(); }
    else if (m.type === "scroll") { window.scrollTo(0, m.y || 0); }
    else if (m.type === "select") {
      selected = m.path ? { path: m.path, image: m.image || null } : null;
      applySelection();
      const el = m.image ? imageByPath(m.image) : byPath(m.path);
      if (el && m.scroll) {
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.top > window.innerHeight - 80) el.scrollIntoView({ behavior: "smooth", block: r.height > window.innerHeight ? "start" : "center" });
      }
    }
  });

  /* ----------------------------------------------------------------- drag */
  function dropIndexAt(clientY) {
    const blocks = topBlocks();
    const y = clientY + window.scrollY;
    let target = blocks.length;
    for (let i = 0; i < blocks.length; i += 1) {
      const r = blocks[i].getBoundingClientRect();
      if (y < r.top + window.scrollY + r.height / 2) { target = i; break; }
    }
    if (blocks[0]?.dataset.blockType === "hero" && target === 0) target = 1;
    return target;
  }
  function showDropline(target) {
    const blocks = topBlocks();
    if (!blocks.length) { dropline.hidden = true; return; }
    const anchor = blocks[Math.min(target, blocks.length - 1)];
    const r = anchor.getBoundingClientRect();
    dropline.hidden = false;
    dropline.style.top = `${(target < blocks.length ? r.top : r.bottom) + window.scrollY}px`;
  }

  function startDrag(e) {
    if (!selected) return;
    e.preventDefault();
    const from = indexOf(selected.path);
    const ghost = document.createElement("div");
    ghost.className = "cv-ghost";
    ghost.textContent = `Move ${labels[byPath(selected.path)?.dataset.blockType] || "block"}`;
    document.body.append(ghost);
    document.documentElement.classList.add("cv-dragging");
    let to = from;
    let scrollTimer = null;
    let lastY = e.clientY;

    const onMove = (ev) => {
      lastY = ev.clientY;
      ghost.style.left = `${ev.clientX + 14}px`;
      ghost.style.top = `${ev.clientY + 14}px`;
      const target = dropIndexAt(ev.clientY);
      to = target > from ? target - 1 : target;
      showDropline(target);
    };
    // Scroll while held near an edge, even when the pointer is not moving.
    scrollTimer = setInterval(() => {
      if (lastY < 70) window.scrollBy(0, -14);
      else if (lastY > window.innerHeight - 70) window.scrollBy(0, 14);
    }, 16);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      clearInterval(scrollTimer);
      ghost.remove();
      dropline.hidden = true;
      document.documentElement.classList.remove("cv-dragging");
      if (to !== from) send({ type: "move", from, to });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /* ----------------------------------------------------------------- drop */
  let zone = null;
  const clearDrop = () => { zone?.classList.remove("cv-dropzone"); zone = null; dropline.hidden = true; };
  const carries = (dt) => { const t = Array.from(dt?.types || []); return t.includes("Files") || t.includes("text/x-assets"); };
  // What a drop onto a block means depends on the block; these take pictures.
  const TAKES_PICTURES = new Set(["gallery", "hero", "feature", "empty"]);

  document.addEventListener("dragover", (e) => {
    if (!carries(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const block = e.target.closest("[data-block]");
    const into = block && TAKES_PICTURES.has(block.dataset.blockType) ? block : null;
    if (into !== zone) { zone?.classList.remove("cv-dropzone"); zone = into; into?.classList.add("cv-dropzone"); }
    if (into) dropline.hidden = true;
    else showDropline(dropIndexAt(e.clientY));
  });
  document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) clearDrop(); });
  document.addEventListener("drop", (e) => {
    if (!carries(e.dataTransfer)) return;
    e.preventDefault();
    const into = zone;
    const index = dropIndexAt(e.clientY);
    clearDrop();
    const files = Array.from(e.dataTransfer.files || []);
    const assets = (e.dataTransfer.getData("text/x-assets") || "").split("\n").filter(Boolean);
    if (!files.length && !assets.length) return;
    // Which picture inside the block the drop landed on, for a block with more
    // than one picture slot (the collage hero).
    const image = into ? e.target.closest("[data-image]")?.dataset.image ?? null : null;
    send({ type: "drop", path: into ? into.dataset.block : null, index, files, assets, image });
  });

  decorate();
  send({ type: "ready" });
})();
