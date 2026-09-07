/**
 * Site search.
 *
 * One of only three scripts on this site. Everything it powers is hidden by CSS
 * until this file runs and adds `js-search` to <html>, so a visitor with
 * scripting disabled never sees a search field at all rather than seeing one
 * that does nothing.
 *
 * The nav renders the widget twice — desktop bar and mobile drawer — so this
 * binds every `[data-search]` it finds rather than looking one up by id. The
 * id-based version wired up only the first, which left the drawer's field
 * disabled and inert on exactly the screens that have no other search.
 *
 * No dependencies, no network beyond a single fetch of /search_index.json.
 */
(function () {
  "use strict";

  var MAX_RESULTS = 8;

  /** Filled once the index arrives; every widget reads the same array. */
  var entries = [];
  var widgets = [];

  /* ------------------------------------------------------------- matching */

  var MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];

  function normalise(value) {
    return String(value == null ? "" : value).toLowerCase();
  }

  /**
   * Split an ISO date into the pieces someone might actually type for it, so
   * "2026-09-03" answers to 2026-09-03, 2026-09, 2026, 09, 9, september, sep,
   * 03 and 3. Computed once per entry when the index lands rather than inside
   * score(), which runs across the whole index on every keystroke.
   */
  function dateTokens(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(normalise(value));
    if (!match) return [];

    var year = match[1];
    var month = match[2];
    var day = match[3];
    var name = MONTHS[Number(month) - 1] || "";

    var tokens = [
      year + "-" + month + "-" + day,
      year + "-" + month,
      year,
      month, String(Number(month)),
      day, String(Number(day)),
    ];
    if (name) tokens.push(name, name.slice(0, 3));
    return tokens;
  }

  /**
   * Does one query term name part of this date?
   * Whole tokens rather than substrings, so "20" does not quietly return every
   * post written in 2026 — but month names also match on a prefix, so "sep"
   * and "septem" both find September without needing the whole word.
   */
  function matchesDate(tokens, term) {
    for (var i = 0; i < tokens.length; i += 1) {
      var token = tokens[i];
      if (token === term) return true;
      if (
        term.length >= 3 &&
        token.length > term.length &&
        token.indexOf(term) === 0 &&
        !/\d/.test(token)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Score one entry against the query terms.
   * A title hit outranks a tag hit, which outranks body text, so typing a
   * post's name puts that post first rather than burying it under mentions.
   * A date hit sits just under a title hit: "2026" or "september 2026" is a
   * deliberate enough thing to type that it should beat a passing mention of
   * the same digits in someone's body copy.
   */
  function score(entry, terms) {
    var title = normalise(entry.title);
    var tags = normalise((entry.tags || []).join(" "));
    var description = normalise(entry.description);
    var text = normalise(entry.text);
    var dates = entry.dateTokens || [];
    var total = 0;

    for (var i = 0; i < terms.length; i += 1) {
      var term = terms[i];
      var hit = 0;

      if (title.indexOf(term) === 0) hit += 60;
      else if (title.indexOf(term) !== -1) hit += 40;
      if (tags.indexOf(term) !== -1) hit += 25;
      if (matchesDate(dates, term)) hit += 30;
      if (description.indexOf(term) !== -1) hit += 12;
      if (text.indexOf(term) !== -1) hit += 5;

      // Every term must appear somewhere, or this is not a match.
      if (hit === 0) return 0;
      total += hit;
    }
    return total;
  }

  function search(query) {
    var terms = normalise(query).split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];

    var scored = [];
    for (var i = 0; i < entries.length; i += 1) {
      var value = score(entries[i], terms);
      if (value > 0) scored.push({ entry: entries[i], score: value });
    }

    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.entry.date).localeCompare(String(a.entry.date));
    });

    return scored.slice(0, MAX_RESULTS).map(function (item) {
      return item.entry;
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------------------------------------------------------------- widget */

  /**
   * Wire up one search field and its dropdown.
   *
   * Every widget owns its own highlight state and its own result element ids —
   * `aria-activedescendant` points at a specific element, so two widgets
   * sharing an id namespace would leave screen readers announcing the wrong
   * dropdown's rows.
   */
  function createWidget(container) {
    var input = container.querySelector("[data-search-input]");
    var results = container.querySelector("[data-search-results]");
    if (!input || !results) return null;

    // Unique per widget, and stable: the results element already carries an id
    // the markup guarantees is unique.
    var idPrefix = (results.id || "search-results") + "-option-";

    var active = -1;
    var current = [];

    function open() {
      results.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }

    function close() {
      results.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    }

    function render(list) {
      current = list;
      active = -1;

      if (list.length === 0) {
        results.innerHTML = '<p class="search-empty">No matches.</p>';
        open();
        return;
      }

      var html = "";
      for (var i = 0; i < list.length; i += 1) {
        var entry = list[i];
        var meta = (entry.tags || []).slice(0, 3).join(" · ");
        html +=
          '<a class="search-result" role="option" aria-selected="false"' +
          ' id="' + escapeHtml(idPrefix + i) + '"' +
          ' href="' + escapeHtml(entry.url) + '">' +
          '<span class="search-result-title">' + escapeHtml(entry.title) + "</span>" +
          '<span class="search-result-meta"> ' + escapeHtml(entry.date) +
          (meta ? " · " + escapeHtml(meta) : "") + "</span>" +
          "</a>";
      }
      results.innerHTML = html;
      open();
    }

    function highlight(index) {
      var nodes = results.querySelectorAll(".search-result");
      if (nodes.length === 0) return;

      // Wrap around at both ends, which is what arrow keys are expected to do.
      if (index < 0) index = nodes.length - 1;
      if (index >= nodes.length) index = 0;
      active = index;

      for (var i = 0; i < nodes.length; i += 1) {
        var selected = i === active;
        nodes[i].setAttribute("aria-selected", selected ? "true" : "false");
        if (selected) {
          input.setAttribute("aria-activedescendant", nodes[i].id);
          // Keep the highlighted row inside the scrolling dropdown.
          if (nodes[i].scrollIntoView) nodes[i].scrollIntoView({ block: "nearest" });
        }
      }
    }

    input.addEventListener("input", function () {
      var query = input.value.trim();
      if (query.length < 2) {
        close();
        return;
      }
      render(search(query));
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        close();
        return;
      }
      if (results.hidden || current.length === 0) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        highlight(active + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        highlight(active - 1);
      } else if (event.key === "Enter") {
        // Enter with nothing highlighted should not hijack the keystroke.
        if (active < 0) return;
        event.preventDefault();
        var node = results.querySelectorAll(".search-result")[active];
        if (node) window.location.href = node.getAttribute("href");
      }
    });

    input.addEventListener("focus", function () {
      if (input.value.trim().length >= 2 && current.length > 0) open();
    });

    return {
      enable: function () { input.disabled = false; },
      // A click anywhere outside this widget closes it — including a click in
      // the other one, which is why the test is per widget rather than global.
      closeUnlessInside: function (target) {
        if (container.contains(target)) return;
        close();
      },
    };
  }

  /* ------------------------------------------------------------------ boot */

  var containers = document.querySelectorAll("[data-search]");
  for (var i = 0; i < containers.length; i += 1) {
    var widget = createWidget(containers[i]);
    if (widget) widgets.push(widget);
  }
  if (widgets.length === 0) return;

  document.addEventListener("click", function (event) {
    for (var j = 0; j < widgets.length; j += 1) {
      widgets[j].closeUnlessInside(event.target);
    }
  });

  fetch("/search_index.json", { credentials: "omit" })
    .then(function (response) {
      if (!response.ok) throw new Error("HTTP " + response.status);
      return response.json();
    })
    .then(function (data) {
      entries = (data && data.entries) || [];
      for (var m = 0; m < entries.length; m += 1) {
        entries[m].dateTokens = dateTokens(entries[m].date);
      }
      for (var k = 0; k < widgets.length; k += 1) widgets[k].enable();
      // Only reveal the fields once there is actually an index behind them.
      document.documentElement.classList.add("js-search");
    })
    .catch(function () {
      // Leave the fields hidden and disabled: a search box that cannot search
      // is worse than no search box.
    });
})();
