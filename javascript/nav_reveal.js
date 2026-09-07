/**
 * Nav reveal over a leading hero.
 *
 * On a page that opens with a full-height hero, the bar is out of the way while
 * the hero has the screen to itself, and slides in about half a viewport down.
 * On every other page this does nothing at all.
 *
 * "A full-height hero" means one of the opening sections named in
 * LEAD_SECTIONS below, placed at the top of <main>. Nothing else is touched.
 *
 * The reveal is CSS; all this does is set two classes on <html> (see input.css,
 * "Nav reveal"):
 *
 *   js-nav-reveal   this script is live — arm the hidden state
 *   nav-revealed    the hero is behind us — show the bar
 *
 * Arming from here rather than in the markup is what keeps the no-script path
 * honest: with scripting disabled neither class is ever set, nothing hides, and
 * the bar is the plain sticky bar it is everywhere else. It also means the bar
 * is never hidden before the observer that would bring it back exists, so there
 * is no window in which the page can be left with no navigation.
 */
(function () {
  "use strict";

  var root = document.documentElement;

  // The full-height opening sections this applies to. .hero-stage is the site
  // component (variants A to D and index.njk); .cine-stage is the cinematic
  // title card, which carries its own stylesheet rather than using that
  // component but is the same thing from the bar's point of view — a screenful
  // that owns the top of the page. Add a name here when a new one is written.
  var LEAD_SECTIONS = "main > .hero-stage, main > .cine-stage";

  // Metadata that may legitimately sit in front of the opening section without
  // making it any less the top of the page. A block that carries its own
  // <style> — which is how the cinematic card travels — puts that element
  // first inside <main>, so the section is main's SECOND element child and a
  // plain :first-child test misses it.
  //
  // Testing what precedes the section rather than counting its position is
  // what keeps this honest: two <style> blocks, or a <link>, and it still
  // reads correctly, where an :nth-child(-n+2) would quietly stop matching.
  var SKIPPABLE = { STYLE: 1, LINK: 1, SCRIPT: 1, TEMPLATE: 1 };

  function isLeading(el) {
    for (var prev = el.previousElementSibling; prev; prev = prev.previousElementSibling) {
      if (SKIPPABLE[prev.tagName] !== 1) return false;
    }
    return true;
  }

  // A stage used lower down a page is an ordinary full-bleed section with the
  // bar already above it — there is nothing there for the bar to get out of the
  // way of, and the CSS that pulls a stage up under the bar is scoped to a
  // leading one too (input.css, `main > .hero-stage:first-child`; the
  // equivalent pair in the cinematic block's own <style>).
  var hero = null;
  var candidates = document.querySelectorAll(LEAD_SECTIONS);
  for (var i = 0; i < candidates.length; i++) {
    if (isLeading(candidates[i])) { hero = candidates[i]; break; }
  }

  if (!hero || !window.IntersectionObserver) return;

  // Where across the viewport the bar arrives, as a percentage down from the
  // top. The observer's root is shrunk from the top by this much, so the hero
  // stops intersecting the moment its bottom edge rises past that line.
  //
  // For a hero exactly one viewport tall — which is what the first-child rule
  // in input.css makes it — that works out as half a viewport of scrolling.
  // The bar therefore lands while the hero is still half on screen, rather
  // than waiting for it to leave entirely.
  //
  // Turn it down to arrive later, up to arrive sooner. It is a percentage
  // rather than a measured pixel offset on purpose: percentages in rootMargin
  // resolve against the viewport, so this re-reads itself when the window is
  // resized and there is nothing here to go stale.
  var REVEAL_LINE = 80;

  // An observer rather than a scroll listener — the browser does the geometry
  // off the main thread and calls back only when the line is crossed, so this
  // costs nothing on the frames in between.
  var observer = new IntersectionObserver(
    function (entries) {
      root.classList.toggle("nav-revealed", !entries[entries.length - 1].isIntersecting);

      // Armed from inside the callback, on the first run, so the state class
      // and the class that gives it meaning land in the same style recalc. Set
      // before observing instead, and a page opened already past that line —
      // a restored scroll position, or a link straight to an anchor —
      // would hide the bar for the frame before the first callback corrected
      // it, which is a flicker in exactly the case the bar should never have
      // been hidden at all.
      root.classList.add("js-nav-reveal");
    },
    { rootMargin: "-" + REVEAL_LINE + "% 0px 0px 0px", threshold: 0 }
  );

  observer.observe(hero);
})();
