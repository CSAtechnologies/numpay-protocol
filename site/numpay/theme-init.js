/* Runs synchronously in <head>, before first paint, so a visitor who chose
   dark never sees a flash of the light theme. Kept as its own file (rather
   than an inline <script>) so the page can ship a strict CSP with no
   'unsafe-inline' in script-src. */
(function () {
  // Marks that scripting is alive. The scroll-reveal animation hides elements
  // with opacity:0 until site.js adds .in, so that rule is scoped to .js and
  // the page stays fully readable if any script fails, is blocked, or is still
  // loading. Content must never depend on JavaScript to be visible.
  document.documentElement.classList.add("js");

  try {
    var saved = localStorage.getItem("numpay-site-theme");
    if (saved !== "dark" && saved !== "light") {
      saved = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    document.documentElement.setAttribute("data-theme", saved);
  } catch (e) {
    /* private mode or storage disabled: the light default in the markup stands */
  }
})();
