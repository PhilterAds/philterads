/* Language pick, sync in <head> so the redirect happens before first paint.
   The only things this site ever stores are the visitor's language and theme choices.
   Rules: on an English page with no stored choice, a Japanese browser goes to the same page under /ja/.
   An explicit stored choice always wins wherever it disagrees with the page. */
(function () {
  "use strict";
  document.documentElement.classList.add("js"); // gates .reveal styles; without JS nothing hides
  var theme = null;
  try { theme = localStorage.getItem("philter_theme"); } catch (e) { /* private mode */ }
  if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme); // before paint: no flash
  var page = document.documentElement.lang === "ja" ? "ja" : "en";
  var stored = null;
  try { stored = localStorage.getItem("philter_lang"); } catch (e) { /* private mode */ }
  if (stored !== "en" && stored !== "ja") stored = null;
  if (page === "en") {
    var first = (navigator.languages && navigator.languages[0]) || navigator.language || "";
    var want = stored || (/^ja/i.test(first) ? "ja" : "en");
    if (want === "ja") location.replace("/ja" + location.pathname + location.hash);
  } else if (stored === "en") {
    location.replace((location.pathname.replace(/^\/ja(?=\/)/, "") || "/") + location.hash);
  }
})();
