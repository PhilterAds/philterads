/* CTA state, config-driven hrefs, goal bar, scroll reveal, Sip hop, language toggle. */
(function () {
  "use strict";
  var cfg = window.PHILTER || {};
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var install = cfg.installUrl || "";

  /* CTA groups: "soon" is the static default; a configured installUrl swaps to "live" */
  if (install) {
    document.querySelectorAll("[data-cta]").forEach(function (cta) {
      var soon = cta.querySelector('[data-cta-state="soon"]');
      var live = cta.querySelector('[data-cta-state="live"]');
      if (soon && live) { soon.hidden = true; live.hidden = false; }
    });
  }

  /* hrefs from config (static ones in the HTML already work without JS) */
  document.querySelectorAll("[data-href]").forEach(function (a) {
    var kind = a.getAttribute("data-href");
    var url = kind === "install" ? install : kind === "sponsors" ? cfg.sponsorsUrl : kind === "download" && cfg.downloadUrl ? cfg.downloadUrl : cfg.githubUrl;
    if (url) a.setAttribute("href", url);
  });
  /* repo / sponsors links stay hidden (and their "soon" stand-ins shown) until opened in config */
  var pay = cfg.stripe || {};
  var payOpen = ["t1", "t2", "t3", "t4", "t5"].every(function (k) { return /^https:\/\/(buy|donate)\.stripe\.com\//.test(pay[k] || ""); });
  var open = { repo: !!cfg.repoOpen, sponsors: !!cfg.sponsorsOpen, pay: payOpen, install: !!install };
  document.querySelectorAll("[data-needs]").forEach(function (el) {
    if (open[el.getAttribute("data-needs")]) el.hidden = false;
  });
  document.querySelectorAll("[data-unless]").forEach(function (el) {
    if (open[el.getAttribute("data-unless")]) el.hidden = true;
  });
  /* support tiers open Stripe-hosted checkout; the JA page asks Stripe for a Japanese checkout */
  if (open.pay) {
    var ja = document.documentElement.lang === "ja";
    var withLang = function (u) { return ja ? u + (u.indexOf("?") === -1 ? "?" : "&") + "locale=ja" : u; };
    document.querySelectorAll("[data-tier]").forEach(function (a) {
      a.setAttribute("href", withLang(pay[a.getAttribute("data-tier")]));
    });
    document.querySelectorAll('[data-pay="portal"]').forEach(function (a) {
      if (pay.portal) a.setAttribute("href", pay.portal); else a.parentNode.removeChild(a);
    });
  }

  /* official store badges: one per configured listing; "also works in" once Chrome is listed */
  var stores = cfg.stores || {};
  document.querySelectorAll("[data-stores]").forEach(function (box) {
    var any = false;
    box.querySelectorAll("[data-store]").forEach(function (li) {
      var url = stores[li.getAttribute("data-store")];
      if (!url) return;
      li.querySelector("a").setAttribute("href", url);
      li.hidden = false;
      any = true;
    });
    var also = box.querySelector("[data-also]");
    if (also && stores.chrome) also.hidden = false;
    if (any) box.hidden = false;
  });

  /* sponsor goal: only when both count and asOf are configured */
  var sp = cfg.sponsors || {};
  if (sp.count != null && sp.asOf) {
    var live = document.querySelector("[data-goal-live]");
    var bar = document.querySelector("[data-goal-bar]");
    var fill = document.querySelector("[data-goal-fill]");
    if (live && bar && fill) {
      var ja = document.documentElement.lang === "ja";
      live.textContent = ja
        ? "30人中" + sp.count + "人 · " + sp.asOf + "時点"
        : sp.count + " of 30 · as of " + sp.asOf;
      live.hidden = false;
      bar.setAttribute("aria-valuenow", String(sp.count));
      bar.hidden = false;
      fill.setAttribute("width", String(Math.max(0, Math.min(30, sp.count)) / 30 * 100));
    }
  }

  /* scroll reveal */
  var reveals = [].slice.call(document.querySelectorAll(".reveal"));
  if (!reduce && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
      });
    }, { threshold: 0.15, rootMargin: "0px 0px -8%" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* Sip hops on click, and once when you first boop it with the mouse */
  var sip = document.getElementById("mascot");
  if (sip) {
    var hop = function () {
      if (reduce || sip.classList.contains("hop")) return;
      sip.classList.add("hop");
    };
    sip.addEventListener("animationend", function () { sip.classList.remove("hop"); }, true);
    sip.addEventListener("click", hop);
    sip.addEventListener("mouseenter", hop, { once: true });
  }

  /* language toggle: remember the choice, carry the hash across */
  document.querySelectorAll("a[data-lang]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      try { localStorage.setItem("philter_lang", a.getAttribute("data-lang")); } catch (err) { /* private mode */ }
      var href = a.getAttribute("href");
      if (location.hash.length > 1 && href.indexOf("#") === -1) {
        e.preventDefault();
        location.assign(href + location.hash);
      }
    });
  });

  /* theme toggle: flips whatever is showing now (device default or a stored pick) and remembers it */
  var themeBtn = document.getElementById("theme-btn");
  if (themeBtn) {
    var root = document.documentElement;
    var darkMq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    var isDark = function () {
      var t = root.getAttribute("data-theme");
      return t ? t === "dark" : !!(darkMq && darkMq.matches);
    };
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    var sync = function () {
      var dark = isDark();
      themeBtn.setAttribute("aria-label", themeBtn.getAttribute(dark ? "data-label-dark" : "data-label-light"));
      if (root.getAttribute("data-theme")) {
        metas.forEach(function (m) { m.setAttribute("content", dark ? "#15111F" : "#F7F3FB"); });
      }
    };
    themeBtn.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("philter_theme", next); } catch (err) { /* private mode */ }
      sync();
    });
    if (darkMq && darkMq.addEventListener) darkMq.addEventListener("change", sync);
    sync();
  }
})();

/* download buttons, screenshot strip, copy chips */
(function () {
  "use strict";
  var cfg = window.PHILTER || {};
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.querySelectorAll('[data-href="download"]').forEach(function (a) {
    if (cfg.downloadUrl) a.setAttribute("href", cfg.downloadUrl);
  });
  /* a download keeps the page; jump to the steps so the next move is obvious */
  var steps = document.getElementById("install");
  document.querySelectorAll("[data-dl]:not([data-no-jump])").forEach(function (a) {
    a.addEventListener("click", function () {
      if (!steps) return;
      setTimeout(function () { steps.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); }, 350);
    });
  });
  var strip = document.querySelector(".look-strip");
  if (strip) {
    document.querySelectorAll("[data-look]").forEach(function (b) {
      b.addEventListener("click", function () {
        var slide = strip.querySelector(".look-slide");
        var step = slide ? slide.getBoundingClientRect().width + 20 : strip.clientWidth * 0.8;
        strip.scrollBy({ left: step * Number(b.getAttribute("data-look")), behavior: reduce ? "auto" : "smooth" });
      });
    });
  }
  document.querySelectorAll("[data-copy]").forEach(function (b) {
    var label = b.querySelector("span");
    var original = label ? label.textContent : "";
    b.addEventListener("click", function () {
      var text = b.getAttribute("data-copy");
      var done = function () {
        if (!label) return;
        label.textContent = b.getAttribute("data-copied") || original;
        setTimeout(function () { label.textContent = original; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    });
  });
})();

/* features showcase: tabs swap the store slide */
(function () {
  "use strict";
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".show-tab"));
  if (!tabs.length) return;
  var panel = document.getElementById("show-p");
  var imgs = document.querySelectorAll(".show-img");
  var narrow = window.matchMedia("(max-width: 879px)");
  var dots = Array.prototype.slice.call(document.querySelectorAll(".show-dots i"));
  var row = tabs[0].parentNode, syncing = false, timer;
  function pick(tab, focus, fromScroll) {
    var n = tab.getAttribute("data-show");
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
    });
    imgs.forEach(function (im) {
      var on = im.getAttribute("data-show") === n;
      im.classList.toggle("is-on", on);
      im.setAttribute("aria-hidden", on ? "false" : "true");
    });
    dots.forEach(function (d, k) { d.classList.toggle("is-on", String(k + 1) === n); });
    if (panel) panel.setAttribute("aria-labelledby", tab.id);
    if (focus) tab.focus({ preventScroll: true });
    if (narrow.matches && !fromScroll) {
      syncing = true;
      row.scrollTo({ left: tab.offsetLeft - tabs[0].offsetLeft, behavior: "smooth" });
      setTimeout(function () { syncing = false; }, 600);
    }
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener("click", function () { pick(tab, false); });
    tab.addEventListener("keydown", function (e) {
      var k = e.key, j = -1;
      if (k === "ArrowDown" || k === "ArrowRight") j = (i + 1) % tabs.length;
      else if (k === "ArrowUp" || k === "ArrowLeft") j = (i - 1 + tabs.length) % tabs.length;
      else if (k === "Home") j = 0;
      else if (k === "End") j = tabs.length - 1;
      if (j < 0) return;
      e.preventDefault();
      pick(tabs[j], true);
    });
  });
  /* phones: swiping the tab row also swaps the slide */
  row.addEventListener("scroll", function () {
    if (!narrow.matches || syncing) return;
    clearTimeout(timer);
    timer = setTimeout(function () {
      var best = tabs[0], dist = Infinity;
      tabs.forEach(function (t) {
        var d = Math.abs(t.offsetLeft - tabs[0].offsetLeft - row.scrollLeft);
        if (d < dist) { dist = d; best = t; }
      });
      if (row.scrollLeft >= row.scrollWidth - row.clientWidth - 4) best = tabs[tabs.length - 1];
      if (best.getAttribute("aria-selected") !== "true") pick(best, false, true);
    }, 120);
  }, { passive: true });
  /* old #zap links land on the Zap tab */
  if (location.hash === "#zap") {
    var z = document.querySelector('.show-tab[data-anchor="zap"]');
    if (z) { pick(z, false); z.scrollIntoView({ block: "center" }); }
  }
})();
