/* ===========================================================
   NumPay marketing site · interactions
   =========================================================== */
(function () {
  "use strict";

  const root = document.documentElement;

  /* ---------- chain data ----------
     Every entry here must be a network the wallet actually supports.
     Source of truth: packages/core/src/networks.ts (EVM) and
     packages/core/src/chains/ (Bitcoin, Litecoin, Solana, Sui, Tron, XRP).
     Do not add a chain to this list before it ships in the wallet. */
  const CHAINS = [
    { sym: "ETH", name: "Ethereum",  c: "linear-gradient(135deg,#627eea,#3c5bd4)" },
    { sym: "SOL", name: "Solana",    c: "linear-gradient(135deg,#9945ff,#14f195)" },
    { sym: "BTC", name: "Bitcoin",   c: "linear-gradient(135deg,#f7931a,#e8780c)" },
    { sym: "BNB", name: "BNB Chain", c: "linear-gradient(135deg,#f3ba2f,#d99e16)" },
    { sym: "POL", name: "Polygon",   c: "linear-gradient(135deg,#8247e5,#6c31c9)" },
    { sym: "ARB", name: "Arbitrum",  c: "linear-gradient(135deg,#28a0f0,#1b7fc4)" },
    { sym: "OP",  name: "Optimism",  c: "linear-gradient(135deg,#ff0420,#cc0319)" },
    { sym: "AVAX", name: "Avalanche", c: "linear-gradient(135deg,#e84142,#c42e2f)" },
    { sym: "BASE", name: "Base",     c: "linear-gradient(135deg,#0052ff,#0040cc)" },
    { sym: "SUI", name: "Sui",       c: "linear-gradient(135deg,#6fbcf0,#2f7dd1)" },
    { sym: "XRP", name: "XRP Ledger", c: "linear-gradient(135deg,#5c6470,#23292f)" },
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
     THEME
     The initial value is set by numpay/theme-init.js in <head>,
     which runs before first paint so a saved dark theme does not
     flash light. This half only handles the toggle.
     ========================================================= */
  const THEME_KEY = "numpay-site-theme";
  const themeToggle = document.getElementById("themeToggle");

  // `persist` is false for the initial sync: writing on load would lock the
  // visitor to whatever the OS happened to be the first time they landed,
  // and the site would stop following their system setting after that.
  function setTheme(t, persist) {
    const theme = t === "dark" ? "dark" : "light";
    root.setAttribute("data-theme", theme);
    if (themeToggle) themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    if (persist) { try { localStorage.setItem(THEME_KEY, theme); } catch (e) {} }
  }

  setTheme(root.getAttribute("data-theme"), false);

  if (themeToggle) themeToggle.addEventListener("click", function () {
    setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark", true);
  });

  // Track the OS setting for as long as the visitor has not made a choice.
  if (window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = function (e) {
      let chosen = null;
      try { chosen = localStorage.getItem(THEME_KEY); } catch (err) {}
      if (chosen !== "dark" && chosen !== "light") setTheme(e.matches ? "dark" : "light", false);
    };
    if (mq.addEventListener) mq.addEventListener("change", follow);
    else if (mq.addListener) mq.addListener(follow);
  }
})();
