/* CTA state, config-driven hrefs, goal bar, scroll reveal, Sip hop, language toggle. */
(function () {
  "use strict";
  var cfg = window.PHILTER || {};
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var install = cfg.installUrl || "";

  /* Browser-aware install button. The static HTML (no JS) is the generic GitHub download.
     Edge goes to Edge Add-ons; the Chrome family goes to the Chrome Web Store once it is listed,
     and to the GitHub zip until then. Other browsers and phones keep the generic button. */
  var stores0 = cfg.stores || {};
  var chromeStore = stores0.chrome || install;
  var browser = (function () {
    var ua = navigator.userAgent || "";
    var uad = navigator.userAgentData;
    var brands = uad && uad.brands ? uad.brands.map(function (b) { return b.brand; }).join(" ") : "";
    var mobile = uad && typeof uad.mobile === "boolean" ? uad.mobile : /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    if (mobile) return "mobile";
    if (/Edg\//.test(ua) || /Microsoft Edge/.test(brands)) return "edge";
    if (/OPR\//.test(ua) || /Opera/.test(brands)) return "opera";
    if (/Vivaldi/.test(ua)) return "vivaldi";
    if (navigator.brave || /Brave/.test(brands)) return "brave";
    if (/Firefox\//.test(ua)) return "firefox";
    if (/Chrome\//.test(ua)) return "chrome";
    return "other";
  })();
  var ja = document.documentElement.lang === "ja";
  /* Opera is on the roadmap (its own store), so it keeps the generic button like the logo row says */
  var NAMES = { edge: "Edge", chrome: "Chrome", brave: "Brave", vivaldi: "Vivaldi" };
  var T = ja ? {
    label: function (n) { return n + "版を<span class=\"nobr\">ダウンロード</span>"; },
    edgeNote: "無料・オープンソース。Microsoft Edgeアドオンからワンクリックでインストールできます。",
    storeNote: "無料・オープンソース。Chromeウェブストアからワンクリックでインストールできます。",
    zipNote: "無料・オープンソース。Chromeウェブストア版は審査中のため、今はGitHubから約1分でインストールできます。",
    otherNote: "PhilterAdsはパソコンのChromeとEdgeで動きます。どちらかでこのページを開いてください。",
    others: "ほかのブラウザ"
  } : {
    label: function (n) { return "Download for " + n; },
    edgeNote: "Free and open source. Installs from Microsoft Edge <span class=\"nobr\">Add-ons</span> in one click.",
    storeNote: "Free and open source. Installs from the Chrome Web Store in one click.",
    zipNote: "Free and open source. Our Chrome Web Store listing is in review, so for now it installs from GitHub in about a minute.",
    otherNote: "PhilterAds runs in Chrome and Edge on a computer. Open this page in one of them to install it.",
    others: "Other browsers"
  };
  var target = null;      // store URL for this browser, or null for the GitHub zip
  var note = T.otherNote;
  if (browser === "edge" && stores0.edge) { target = stores0.edge; note = T.edgeNote; }
  else if (browser === "edge" || NAMES[browser]) {
    if (browser !== "edge" && chromeStore) { target = chromeStore; note = T.storeNote; }
    else note = T.zipNote;
  }
  document.documentElement.setAttribute("data-browser", browser);
  if (browser === "edge") {
    var eb = document.querySelector("[data-get-eyebrow]");
    if (eb) eb.innerHTML = ja ? "Edge用 <span class=\"nobr\">無料の広告ブロッカー</span>・<span class=\"nobr\">ポップアップブロッカー</span>" : "Free ad blocker and pop-up blocker <span class=\"nobr\">for Edge</span>";
  }
  document.querySelectorAll("[data-cta]").forEach(function (cta) {
    var btn = cta.querySelector("[data-get]");
    if (!btn) return;
    var label = btn.querySelector("[data-get-label]");
    var alt = cta.querySelector("[data-get-alt]");
    var noteEl = cta.querySelector("[data-get-note]");
    if (NAMES[browser] && label) label.innerHTML = T.label(NAMES[browser]);
    if (noteEl) noteEl.innerHTML = note;  /* static strings above, never user input */
    if (target) {
      /* a store page, not a file: no zip href override, no jump to the manual steps */
      btn.removeAttribute("data-href");
      btn.removeAttribute("data-dl");
      btn.setAttribute("href", target);
      if (alt) alt.textContent = T.others;
    } else if (browser === "mobile") {
      /* a zip is no use on a phone: show the steps instead of downloading */
      btn.removeAttribute("data-href");
      btn.removeAttribute("data-dl");
      btn.setAttribute("href", "#install");
      if (alt) alt.hidden = true;
    }
  });

  /* "Works in" logo row: the Chrome family links to the Chrome Web Store once it is listed,
     and the visitor's own browser gets a ring */
  document.querySelectorAll("[data-browsers] [data-br]").forEach(function (a) {
    var k = a.getAttribute("data-br");
    if (stores0.chrome && (k === "chrome" || k === "brave" || k === "vivaldi")) a.setAttribute("href", stores0.chrome);
    if (stores0.edge && k === "edge") a.setAttribute("href", stores0.edge);
    if (k === browser) a.classList.add("is-you");
  });

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

  /* logo (Sip + wordmark) = home: back to the hero on the main page, or to the main page from elsewhere */
  var goHome = function (e) {
    var hero = document.getElementById("top");
    if (!hero) { location.assign(document.documentElement.lang === "ja" ? "/ja/" : "/"); return; }
    if (e) e.preventDefault();
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  };
  if (sip) sip.addEventListener("click", goHome);
  document.querySelectorAll(".site-head .wordmark").forEach(function (w) { w.addEventListener("click", goHome); });

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

/* supporter pickers: the #support card and the dialog the banner buttons open share one picker.
   One-time passes the picked amount to Stripe (prefilled_amount, still editable there);
   monthly goes straight to the chosen tier's Payment Link. */
(function () {
  var pay = (window.PHILTER || {}).stripe || {};
  var ja = document.documentElement.lang === "ja";
  var link = function (base, params) {
    if (ja) params.push("locale=ja");
    return params.length ? base + (base.indexOf("?") === -1 ? "?" : "&") + params.join("&") : base;
  };

  function wire(form) {
    var labels = form.closest("[data-go-once]");
    var go = form.querySelector(".sip-go");
    var goTxt = go.querySelector(".sip-go-txt");
    var other = form.querySelector(".sip-other input");
    var otherBox = form.querySelector(".sip-other");
    var label = function (key, n) { return labels.getAttribute("data-go-" + key).replace("{n}", n); };
    var mode = function () { return form.querySelector('input[name="sip-mode"]:checked').value; };

    function update() {
      var m = mode();
      form.querySelectorAll(".sip-pane").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== m; });
      var href = "", text;
      if (m === "once") {
        var chip = form.querySelector('input[name="sip-amt"]:checked');
        var n = other.value ? parseInt(other.value, 10) : chip ? parseInt(chip.value, 10) : 0;
        otherBox.classList.toggle("is-on", !!other.value);
        if (pay.t5 && n >= 1 && n <= 10000) { href = link(pay.t5, ["prefilled_amount=" + n * 100]); text = label("once", n); }
        else text = label("none");
      } else {
        var t = form.querySelector('input[name="sip-tier"]:checked');
        if (pay[t.value]) href = link(pay[t.value], []);
        text = label("month", t.getAttribute("data-amt"));
      }
      goTxt.textContent = text;
      if (href) { go.setAttribute("href", href); go.removeAttribute("aria-disabled"); }
      else { go.removeAttribute("href"); go.setAttribute("aria-disabled", "true"); }
    }
    function focusPick() {
      var pick = mode() === "once"
        ? (other.value ? other : form.querySelector('input[name="sip-amt"]:checked'))
        : form.querySelector('input[name="sip-tier"]:checked');
      if (pick) pick.focus();
    }
    function setMode(m) {
      form.querySelector('input[name="sip-mode"][value="' + m + '"]').checked = true;
      update();
    }

    form.addEventListener("change", function (e) {
      if (e.target.name === "sip-amt") other.value = "";
      update();
      if (e.target.name === "sip-mode") focusPick();
    });
    other.addEventListener("input", function () {
      var clean = other.value.replace(/\D/g, "").replace(/^0+/, "");
      if (clean !== other.value) other.value = clean;
      if (clean) form.querySelectorAll('input[name="sip-amt"]').forEach(function (r) { r.checked = false; });
      update();
    });
    /* Enter in the amount box = continue; only the dialog's close button submits for real */
    form.addEventListener("submit", function (e) {
      if (e.submitter && e.submitter.classList.contains("sip-x")) return;
      e.preventDefault();
      if (go.hasAttribute("href")) go.click();
    });
    go.addEventListener("click", function (e) {
      if (!go.hasAttribute("href")) { e.preventDefault(); other.focus(); }
    });
    update();
    return { setMode: setMode, focusPick: focusPick };
  }

  document.querySelectorAll(".sip-card").forEach(wire);

  var dlg = document.getElementById("sip-dlg");
  var openers = document.querySelectorAll("[data-sip]");
  if (!dlg || !openers.length) return;
  var picker = wire(dlg.querySelector(".sip-form"));
  openers.forEach(function (b) {
    b.addEventListener("click", function () {
      if (typeof dlg.showModal !== "function") { location.hash = "#support"; return; }
      picker.setMode(b.getAttribute("data-sip"));
      dlg.showModal();
      picker.focusPick();
    });
  });
  /* click on the dimmed backdrop closes */
  dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
})();
