/**
 * GLightbox initialisation.
 *
 * Loads after glightbox.min.js. Purely additive: every lightbox link is a plain
 * anchor to the full-resolution file, so with scripting disabled clicking one
 * simply opens the image directly.
 */
(function () {
  "use strict";

  if (typeof window.GLightbox !== "function") return;
  if (document.querySelectorAll(".glightbox").length === 0) return;

  window.GLightbox({
    selector: ".glightbox",
    touchNavigation: true,
    loop: true,
    zoomable: true,
    draggable: true,
    // Respect the same motion preference the stylesheet does.
    openEffect: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : "zoom",
    closeEffect: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "none" : "zoom",
    slideEffect: "slide",
    descPosition: "bottom",
  });

  document.documentElement.classList.add("js-lightbox");
})();
