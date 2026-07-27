/* ===========================================================
   NumPay marketing site — interactions
   =========================================================== */
(function () {
  "use strict";

  const root = document.documentElement;

  /* ---------- chain data ---------- */
  const CHAINS = [
    { sym: "ETH", name: "Ethereum",  c: "linear-gradient(135deg,#627eea,#3c5bd4)" },
    { sym: "SOL", name: "Solana",    c: "linear-gradient(135deg,#9945ff,#14f195)" },
    { sym: "BTC", name: "Bitcoin",   c: "linear-gradient(135deg,#f7931a,#e8780c)" },
    { sym: "BNB", name: "BNB Chain", c: "linear-gradient(135deg,#f3ba2f,#d99e16)" },
    { sym: "MATIC", name: "Polygon", c: "linear-gradient(135deg,#8247e5,#6c31c9)" },
    { sym: "ARB", name: "Arbitrum",  c: "linear-gradient(135deg,#28a0f0,#1b7fc4)" },
    { sym: "OP",  name: "Optimism",  c: "linear-gradient(135deg,#ff0420,#cc0319)" },
    { sym: "AVAX", name: "Avalanche", c: "linear-gradient(135deg,#e84142,#c42e2f)" },
    { sym: "BASE", name: "Base",     c: "linear-gradient(135deg,#0052ff,#0040cc)" },
    { sym: "ADA", name: "Cardano",   c: "linear-gradient(135deg,#0033ad,#0052ff)" },
    { sym: "DOT", name: "Polkadot",  c: "linear-gradient(135deg,#e6007a,#b30060)" },
    { sym: "TRX", name: "Tron",      c: "linear-gradient(135deg,#ff060a,#cc0508)" },
  ];

  /* ---------- chain grid ---------- */
  const grid = document.getElementById("chainGrid");
  if (grid) {
    grid.innerHTML = CHAINS.map(function (ch) {
      return '<div class="chain-cell">' +
        '<span class="cd" style="background:' + ch.c + '">' + ch.sym.slice(0, 3) + '</span>' +
        '<span class="cn">' + ch.name + '</span></div>';
    }).join("");
  }

  /* ---------- marquee ---------- */
  const marquee = document.getElementById("marquee");
  if (marquee) {
    const one = CHAINS.map(function (ch) {
      return '<span class="chain-name"><span class="chain-dot" style="background:' + ch.c + '">' +
        ch.sym.slice(0, 1) + '</span>' + ch.name + '</span>';
    }).join("");
    marquee.innerHTML = one + one; // duplicate for seamless loop
  }

  /* ---------- FAQ ---------- */
  const FAQS = [
    { q: "What exactly is a NumPay ID?", a: "It's a short, unique 11-digit number tied to your self-custody wallet. Instead of sharing a long blockchain address, you share your NumPay ID, and it resolves to the right address on whichever chain someone is paying you on." },
    { q: "Is NumPay custodial? Do you hold my funds?", a: "No. NumPay is fully non-custodial. Your private keys and recovery phrase are generated and stored only on your device. We can't access, freeze, or move your funds. Your NumPay ID is just a friendly pointer to addresses you already own." },
    { q: "Which blockchains are supported?", a: "NumPay supports 20+ networks including Ethereum, Solana, Bitcoin, BNB Chain, Polygon, Arbitrum, Optimism, Base, Avalanche and more, with new chains added regularly." },
    { q: "What happens if I lose my phone?", a: "Your wallet is recoverable from your secret recovery phrase on any compatible wallet, including a fresh NumPay install. As long as you've safely backed up that phrase, your funds and NumPay ID are safe." },
    { q: "Does it cost anything to use?", a: "Creating a wallet and claiming a NumPay ID is free. You only ever pay the standard network (gas) fees for on-chain transactions, plus any routing fee disclosed up front on swaps." },
    { q: "Can someone send to my ID from another wallet?", a: "Sending by NumPay ID works between NumPay users. You can also share a standard address or QR generated in the app, so anyone on any wallet can still pay you." },
  ];
  const faqList = document.getElementById("faqList");
  if (faqList) {
    faqList.innerHTML = FAQS.map(function (f) {
      return '<details class="faq"><summary>' + f.q +
        '<span class="q-ic"><i class="ph-bold ph-plus"></i></span>' +
        '</summary><div class="a">' + f.a + '</div></details>';
    }).join("");
    // accordion: close others on open
    const items = faqList.querySelectorAll(".faq");
    items.forEach(function (d) {
      d.addEventListener("toggle", function () {
        if (d.open) items.forEach(function (o) { if (o !== d) o.open = false; });
      });
    });
  }

  /* ---------- nav scrolled state ---------- */
  const nav = document.getElementById("nav");
  const onScroll = function () {
    if (window.scrollY > 8) nav.classList.add("scrolled");
    else nav.classList.remove("scrolled");
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- mobile burger: smooth jump to download ---------- */
  const burger = document.getElementById("burger");
  if (burger) burger.addEventListener("click", function () {
    document.getElementById("how").scrollIntoView({ behavior: "smooth" });
  });

  /* ---------- scroll reveal ---------- */
  const reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && reveals.length) {
    const io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in"); });
  }

  /* =========================================================
     THEME + TWEAKS
     ========================================================= */
  const ACCENTS = {
    sunset: { b: "#f97316", b2: "#fb923c", b3: "#ea580c", ink: "#d9540b", inkDark: "#fbbf6e", soft: "rgba(249,115,22,", glow: "rgba(249,115,22,.28)" },
    violet: { b: "#7c6df0", b2: "#a394ff", b3: "#5b4cdb", ink: "#5b4cdb", inkDark: "#b6abff", soft: "rgba(124,109,240,", glow: "rgba(124,109,240,.30)" },
    emerald:{ b: "#10b981", b2: "#34d399", b3: "#059669", ink: "#0a8f64", inkDark: "#5eead4", soft: "rgba(16,185,129,", glow: "rgba(16,185,129,.30)" },
    azure:  { b: "#2f7df6", b2: "#60a5fa", b3: "#1d63d8", ink: "#1f63d8", inkDark: "#88b8ff", soft: "rgba(47,125,246,", glow: "rgba(47,125,246,.30)" },
  };

  function applyAccent(key) {
    const a = ACCENTS[key] || ACCENTS.violet;
    const dark = root.getAttribute("data-theme") === "dark";
    root.style.setProperty("--brand", a.b);
    root.style.setProperty("--brand-2", a.b2);
    root.style.setProperty("--brand-3", a.b3);
    root.style.setProperty("--brand-ink", dark ? a.inkDark : a.ink);
    root.style.setProperty("--brand-glow", a.glow);
    root.style.setProperty("--brand-soft", a.soft + (dark ? ".18)" : ".12)"));
    root.style.setProperty("--brand-grad", "linear-gradient(135deg," + a.b2 + " 0%," + a.b + " 55%," + a.b3 + " 100%)");
    root.style.setProperty("--card-grad", "linear-gradient(150deg," + a.b2 + " 0%," + a.b + " 48%," + a.b3 + " 100%)");
  }

  function applyTheme(t) {
    root.setAttribute("data-theme", t === "dark" ? "dark" : "light");
    // re-apply accent so the ink color tracks theme
    applyAccent(state.accent);
    // sync toggles
    document.querySelectorAll("#twTheme button").forEach(function (b) {
      b.classList.toggle("on", b.dataset.themeVal === root.getAttribute("data-theme"));
    });
  }

  // state, seeded from inline defaults
  const defaults = (window.NUMPAY_TWEAKS || { theme: "light", accent: "sunset" });
  const state = { theme: defaults.theme, accent: defaults.accent };

  // restore persisted
  try {
    const saved = JSON.parse(localStorage.getItem("numpay-site-tweaks") || "null");
    if (saved) { state.theme = saved.theme || state.theme; state.accent = saved.accent || state.accent; }
  } catch (e) {}

  function persist() {
    try { localStorage.setItem("numpay-site-tweaks", JSON.stringify(state)); } catch (e) {}
    try { window.parent.postMessage({ type: "__edit_mode_set_keys", edits: { theme: state.theme, accent: state.accent } }, "*"); } catch (e) {}
  }

  // init
  applyTheme(state.theme);
  applyAccent(state.accent);

  /* ---- header theme toggle ---- */
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) themeToggle.addEventListener("click", function () {
    state.theme = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(state.theme); persist();
  });

  /* ---- tweaks: theme segment ---- */
  document.querySelectorAll("#twTheme button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.theme = b.dataset.themeVal;
      applyTheme(state.theme); persist();
    });
  });

  /* ---- tweaks: accent swatches ---- */
  const accWrap = document.getElementById("twAccent");
  if (accWrap) {
    accWrap.innerHTML = Object.keys(ACCENTS).map(function (k) {
      const a = ACCENTS[k];
      return '<span class="tw-sw" data-accent="' + k + '" title="' + k + '" style="background:linear-gradient(135deg,' + a.b2 + ',' + a.b3 + ')"></span>';
    }).join("");
    function syncSw() {
      accWrap.querySelectorAll(".tw-sw").forEach(function (s) {
        s.classList.toggle("on", s.dataset.accent === state.accent);
      });
    }
    accWrap.querySelectorAll(".tw-sw").forEach(function (s) {
      s.addEventListener("click", function () {
        state.accent = s.dataset.accent;
        applyAccent(state.accent); persist(); syncSw();
      });
    });
    syncSw();
  }

  /* =========================================================
     Tweaks host protocol (toolbar toggle)
     ========================================================= */
  const panel = document.getElementById("tweaks");
  const closeBtn = document.getElementById("tweaksClose");
  function setPanel(on) { if (panel) panel.classList.toggle("on", !!on); }

  // register listener BEFORE announcing availability
  window.addEventListener("message", function (e) {
    const d = e.data || {};
    if (d.type === "__activate_edit_mode") setPanel(true);
    if (d.type === "__deactivate_edit_mode") setPanel(false);
  });

  if (closeBtn) closeBtn.addEventListener("click", function () {
    setPanel(false);
    try { window.parent.postMessage({ type: "__edit_mode_dismissed" }, "*"); } catch (e) {}
  });

  // announce availability so the toolbar toggle appears
  try { window.parent.postMessage({ type: "__edit_mode_available" }, "*"); } catch (e) {}
})();
