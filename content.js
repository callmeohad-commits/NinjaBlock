/*
 * NinjaAdBlocker – Heuristic Scoring Model
 * ----------------------------------------
 * 1. Extract features from each candidate element (div, iframe, aside, section, ins).
 * 2. Add up a weighted score.
 * 3. If score >= THRESHOLD, apply the "ninja-veil" class (blur + near-zero opacity,
 *    no clicks) instead of removing the element, so anti-adblock scripts still
 *    see it as rendered.
 * 4. A MutationObserver re-runs the model on content injected while scrolling.
 */
(() => {
  "use strict";

  const THRESHOLD = 6;           // minimum score for an element to be veiled
  const VEIL_CLASS = "ninja-veil";
  const DEBUG = false;           // set true to log scores in the console

  const CANDIDATE_SELECTOR = "div, iframe, aside, section, ins, article, li";

  // ---------- Feature dictionaries ----------

  // Strong keywords in id / class / data-* attributes
  const STRONG_KEYWORDS = [
    "taboola", "outbrain", "adsbygoogle", "ad-container", "adcontainer",
    "ad-slot", "adslot", "ad-unit", "adunit", "ad-banner", "adbanner",
    "dfp-ad", "gpt-ad", "google_ads", "doubleclick", "sponsored",
    "advert", "advertisement", "promoted", "revcontent", "mgid", "zergnet",
    "prebid", "ad-wrapper", "adwrapper", "ad_box", "adbox"
  ];

  // Weaker hints (often ads, but also used in normal layouts)
  const WEAK_KEYWORDS = [
    "banner", "promo", "partner", "commercial", "teaser", "widget",
    "sticky", "recommend", "native", "billboard", "leaderboard", "skyscraper"
  ];

  // Short token "ad" must be matched as a whole token (avoid "header", "shadow"...)
  const AD_TOKEN_RE = /(^|[\s_\-])(ad|ads)([\s_\-]|$|\d)/i;

  // Ad network domains for iframe src / link href
  const AD_DOMAINS = [
    "doubleclick.net", "googlesyndication.com", "googleadservices.com",
    "adservice.google", "taboola.com", "outbrain.com", "amazon-adsystem.com",
    "criteo", "adnxs.com", "rubiconproject.com", "pubmatic.com", "openx.net",
    "revcontent.com", "mgid.com", "media.net", "yieldmo", "teads.tv",
    "smartadserver", "adform.net", "zemanta"
  ];

  // Visible labels (English + Hebrew)
  const LABEL_RE = /^\s*(sponsored|advertisement|ad|ads|promoted|paid content|ממומן|פרסומת|תוכן ממומן|מודעה|בחסות)\s*$/i;

  // Standard IAB ad sizes [width, height]
  const IAB_SIZES = [
    [300, 250], [336, 280], [728, 90], [970, 90], [970, 250], [160, 600],
    [300, 600], [120, 600], [320, 50], [320, 100], [468, 60], [250, 250],
    [200, 200], [300, 50], [300, 100]
  ];
  const SIZE_TOLERANCE = 6; // px

  // ---------- Helpers ----------

  const scored = new WeakSet();

  function attrText(el) {
    const parts = [el.id, typeof el.className === "string" ? el.className : ""];
    for (const a of el.attributes) {
      if (a.name.startsWith("data-") || a.name === "aria-label" || a.name === "name") {
        parts.push(a.name, a.value);
      }
    }
    return parts.join(" ").toLowerCase();
  }

  function matchesIabSize(w, h) {
    return IAB_SIZES.some(([sw, sh]) =>
      Math.abs(w - sw) <= SIZE_TOLERANCE && Math.abs(h - sh) <= SIZE_TOLERANCE);
  }

  function hasAdDomain(url) {
    if (!url) return false;
    const u = url.toLowerCase();
    return AD_DOMAINS.some(d => u.includes(d));
  }

  function hasVisibleLabel(el) {
    // Look only at small text nodes near the top of the element (the "Sponsored" tag)
    const small = el.querySelectorAll("span, small, div, p, a, header, label");
    let checked = 0;
    for (const s of small) {
      if (++checked > 25) break;
      const t = s.textContent;
      if (t && t.length < 30 && LABEL_RE.test(t)) return true;
    }
    return false;
  }

  function isAncestorVeiled(el) {
    return !!el.parentElement && !!el.parentElement.closest("." + VEIL_CLASS);
  }

  // ---------- The scoring model ----------

  function score(el) {
    let s = 0;
    const reasons = [];
    const add = (pts, why) => { s += pts; if (DEBUG) reasons.push(`${why}(+${pts})`); };

    const text = attrText(el);
    const tag = el.tagName;

    // Feature 1: strong keywords in attributes
    const strongHits = STRONG_KEYWORDS.filter(k => text.includes(k)).length;
    if (strongHits) add(Math.min(strongHits * 4, 8), "strong-keyword");

    // Feature 2: isolated "ad"/"ads" token
    if (AD_TOKEN_RE.test(text)) add(3, "ad-token");

    // Feature 3: weak keywords
    const weakHits = WEAK_KEYWORDS.filter(k => text.includes(k)).length;
    if (weakHits) add(Math.min(weakHits, 2), "weak-keyword");

    // Feature 4: explicit ad attributes
    if (el.hasAttribute("data-ad-slot") || el.hasAttribute("data-ad-client") ||
        el.hasAttribute("data-google-query-id") || el.hasAttribute("data-ad")) {
      add(6, "ad-attribute");
    }

    // Feature 5: iframe pointing at an ad network
    if (tag === "IFRAME") {
      if (hasAdDomain(el.src)) add(7, "iframe-ad-domain");
      else if (!el.src || el.src === "about:blank") add(1, "blank-iframe");
    }

    // Feature 6: contains an ad iframe / ad-network link
    if (tag !== "IFRAME") {
      const inner = el.querySelector("iframe");
      if (inner && hasAdDomain(inner.src)) add(4, "child-ad-iframe");
      const links = el.querySelectorAll("a[href]");
      let adLinks = 0;
      for (let i = 0; i < links.length && i < 40; i++) {
        if (hasAdDomain(links[i].href)) adLinks++;
      }
      if (adLinks) add(Math.min(adLinks * 2, 5), "ad-links");
    }

    // Feature 7: visible "Sponsored" / "ממומן" label
    if (hasVisibleLabel(el)) add(5, "visible-label");

    // Feature 8: proportions – standard IAB size
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (w > 0 && h > 0 && matchesIabSize(w, h)) add(3, `iab-size ${w}x${h}`);

    // Feature 9: sticky / fixed small boxes (floating ads)
    const cs = getComputedStyle(el);
    if ((cs.position === "fixed" || cs.position === "sticky") &&
        h > 40 && h < window.innerHeight * 0.4 && /bottom|ad|banner|sticky/.test(text)) {
      add(2, "floating");
    }

    // Negative feature: huge structural containers are almost never a single ad
    const vpArea = window.innerWidth * window.innerHeight;
    if (w * h > vpArea * 0.6 || el.querySelectorAll("*").length > 1500) {
      add(-10, "too-large");
    }

    // Negative feature: semantic page regions
    if (["MAIN", "NAV", "HEADER", "FOOTER"].includes(tag) ||
        el.getAttribute("role") === "main" || el.getAttribute("role") === "navigation") {
      add(-10, "semantic-region");
    }

    // Negative feature: editable / form content
    if (el.isContentEditable || el.querySelector("input, textarea, [contenteditable='true']")) {
      add(-4, "has-form");
    }

    if (DEBUG && s > 0) console.debug("[NinjaAdBlocker]", s, reasons.join(" "), el);
    return s;
  }

  // ---------- Apply ----------

  function evaluate(el) {
    if (scored.has(el) || el.classList.contains(VEIL_CLASS)) return;
    scored.add(el);
    if (isAncestorVeiled(el)) return;
    if (score(el) >= THRESHOLD) {
      el.classList.add(VEIL_CLASS);
      el.setAttribute("tabindex", "-1");
    }
  }

  function scan(root) {
    if (!(root instanceof Element)) return;
    if (root.matches(CANDIDATE_SELECTOR)) evaluate(root);
    root.querySelectorAll(CANDIDATE_SELECTOR).forEach(evaluate);
  }

  // ---------- Watch for lazy-loaded / infinite-scroll ads ----------

  const pending = new Set();
  let scheduled = false;
  const idle = window.requestIdleCallback || (cb => setTimeout(cb, 120));

  function flush() {
    scheduled = false;
    const nodes = Array.from(pending);
    pending.clear();
    nodes.forEach(scan);
  }

  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      if (m.type === "childList") {
        m.addedNodes.forEach(n => { if (n.nodeType === 1) pending.add(n); });
      } else if (m.type === "attributes" && m.target.nodeType === 1) {
        // An element changed class/id/src – allow it to be re-scored
        scored.delete(m.target);
        pending.add(m.target);
      }
    }
    if (pending.size && !scheduled) {
      scheduled = true;
      idle(flush, { timeout: 500 });
    }
  });

  // ---------- Start ----------

  scan(document.body);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "id", "src", "data-ad-slot"]
  });

  // Some ads get their final size only after layout – re-check once after load
  window.addEventListener("load", () => {
    setTimeout(() => {
      document.querySelectorAll(CANDIDATE_SELECTOR).forEach(el => {
        if (!el.classList.contains(VEIL_CLASS)) scored.delete(el);
      });
      scan(document.body);
    }, 1500);
  }, { once: true });
})();
