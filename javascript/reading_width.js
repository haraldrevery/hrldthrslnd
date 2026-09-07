/**
 * Reading-width cycler.
 *
 * Cycles the post column through 100 → 75 → 55 → 40 → 28 → 18 per cent of the
 * page container, and remembers the choice across posts in localStorage.
 *
 * Every width is already declared in CSS (see input.css, "Reading width"), so
 * the only thing this script does is set an attribute. With scripting disabled
 * the column stays at 100% and the button is never shown — the `js-width` class
 * added here is what makes it visible at all.
 */
(function () {
  "use strict";

  var STEPS = [100, 75, 55, 40, 28, 18];
  var STORAGE_KEY = "reading_width";

  var button = document.getElementById("width-cycle");
  var label = document.getElementById("width-cycle-label");
  var root = document.documentElement;

  function read() {
    try {
      var stored = parseInt(window.localStorage.getItem(STORAGE_KEY), 10);
      return STEPS.indexOf(stored) !== -1 ? stored : STEPS[0];
    } catch (error) {
      // Private mode, or storage disabled entirely. Not worth failing over.
      return STEPS[0];
    }
  }

  function write(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch (error) {
      /* the width still applies for this page; it just will not persist */
    }
  }

  // The face shows what the NEXT click will do, not where the column is now:
  // >< for the narrowing steps, <> on the last one, where the cycle wraps and
  // the column opens back to full width.
  function apply(value) {
    var widensNext = STEPS.indexOf(value) === STEPS.length - 1;

    root.setAttribute("data-width", String(value));
    if (label) label.textContent = widensNext ? "<>" : "><";
    if (button) {
      // The per cent is no longer on the button, so this is the only place it
      // is stated. Name the direction too — the glyph carries it visually.
      button.setAttribute(
        "aria-label",
        "Reading width " + value + " per cent. Click to " +
          (widensNext ? "widen to full." : "narrow.")
      );
    }
  }

  var currentIndex = STEPS.indexOf(read());
  if (currentIndex === -1) currentIndex = 0;

  // Apply the remembered width before looking for the button, and whether or
  // not one is there. Every post currently renders the dock — outline.njk puts
  // the width control outside the `{% if outline %}` guard, precisely because
  // the reading column exists whether or not the post has headings — but a
  // hand-written page can carry the column without the control, and it should
  // still honour the width chosen on the previous post.
  apply(STEPS[currentIndex]);
  root.classList.add("js-width");

  if (!button) return;

  button.addEventListener("click", function () {
    currentIndex = (currentIndex + 1) % STEPS.length;
    var value = STEPS[currentIndex];
    apply(value);
    write(value);
  });
})();
