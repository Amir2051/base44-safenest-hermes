/**
 * PrivacyGuard.js
 * Blocks all third-party data collection, trackers, fingerprinting,
 * and analytics unless explicitly consented to by the user.
 */

const STORAGE_KEY = "safenest_privacy_consent";

// ── Consent management ────────────────────────────────────────────────────────
export function getConsent() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveConsent(consent) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...consent,
      timestamp: new Date().toISOString(),
      version: "1.0"
    }));
  } catch {}
}

export function hasConsented() {
  const c = getConsent();
  return c !== null;
}

export function isAnalyticsAllowed() {
  const c = getConsent();
  return c?.analytics === true;
}

export function isChatAllowed() {
  const c = getConsent();
  return c?.chat === true;
}

// ── Block all third-party cookies ────────────────────────────────────────────
export function blockThirdPartyCookies() {
  // Override document.cookie setter to strip third-party SameSite=None cookies
  const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "cookie")
    || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, "cookie");

  if (originalDescriptor && originalDescriptor.configurable) {
    Object.defineProperty(document, "cookie", {
      get: originalDescriptor.get,
      set(val) {
        // Block cookies with SameSite=None (typically third-party)
        if (val.toLowerCase().includes("samesite=none")) return;
        originalDescriptor.set.call(document, val);
      },
      configurable: true,
    });
  }
}

// ── Block navigator fingerprinting APIs ──────────────────────────────────────
export function blockFingerprinting() {
  // Canvas fingerprint noise
  const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (...args) {
    const ctx = this.getContext("2d");
    if (ctx) {
      // Add subtle noise to prevent exact fingerprinting
      const imageData = ctx.getImageData(0, 0, this.width || 1, this.height || 1);
      for (let i = 0; i < imageData.data.length; i += 100) {
        imageData.data[i] = imageData.data[i] ^ 1;
      }
      ctx.putImageData(imageData, 0, 0);
    }
    return origToDataURL.apply(this, args);
  };

  // WebGL fingerprint blocking
  const origGetParameter = WebGLRenderingContext.prototype.getParameter;
  WebGLRenderingContext.prototype.getParameter = function (param) {
    // Spoof RENDERER and VENDOR to prevent GPU fingerprinting
    if (param === 37446) return "Generic Renderer"; // RENDERER
    if (param === 37445) return "Generic Vendor";   // VENDOR
    return origGetParameter.call(this, param);
  };
}

// ── Block network requests to known trackers ─────────────────────────────────
// Note: googletagmanager.com is EXCLUDED from this blocklist because
// Google Analytics (GA4) is an allowed tracker when the user has
// granted analytics consent. The analytics utility (src/lib/analytics.js)
// handles consent gating before loading GA or sending events.
const BLOCKED_DOMAINS = [
  "google-analytics.com",
  "doubleclick.net",
  "facebook.com/tr",
  "connect.facebook.net",
  "analytics.twitter.com",
  "static.ads-twitter.com",
  "bat.bing.com",
  "snap.licdn.com",
  "px.ads.linkedin.com",
  "hotjar.com",
  "mixpanel.com",
  "segment.io",
  "segment.com",
  "clarity.ms",
  "fullstory.com",
  "mouseflow.com",
  "logrocket.com",
  "sentry.io",
  "bugsnag.com",
  "amplitude.com",
  "heap.io",
  "intercom.io",
  "crisp.chat",
  "tawk.to",
  "zopim.com",
];

export function blockTrackerRequests() {
  // Intercept fetch
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    if (BLOCKED_DOMAINS.some(domain => url.includes(domain))) {
      console.warn(`[PrivacyGuard] Blocked fetch to: ${url}`);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return origFetch.apply(this, arguments);
  };

  // Intercept XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const urlStr = String(url);
    if (BLOCKED_DOMAINS.some(domain => urlStr.includes(domain))) {
      console.warn(`[PrivacyGuard] Blocked XHR to: ${urlStr}`);
      this._blocked = true;
      return;
    }
    return origOpen.apply(this, [method, url, ...rest]);
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (this._blocked) return;
    return origSend.apply(this, args);
  };
}

// ── Remove existing tracker scripts from DOM ─────────────────────────────────
// googletagmanager.com and gtag are excluded because GA4 is an allowed
// tracker when the user has granted analytics consent.
export function removeTrackerScripts() {
  const trackerPatterns = [
    "google-analytics",
    "fbq",
    "twq",
    "hotjar",
    "mixpanel",
    "segment",
    "clarity",
    "fullstory",
  ];

  document.querySelectorAll("script[src]").forEach(script => {
    const src = script.getAttribute("src") || "";
    if (trackerPatterns.some(p => src.includes(p))) {
      script.remove();
      console.warn(`[PrivacyGuard] Removed tracker script: ${src}`);
    }
  });

  // Observe for dynamically injected scripts
  const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node.tagName === "SCRIPT") {
          const src = node.getAttribute("src") || "";
          if (trackerPatterns.some(p => src.includes(p))) {
            node.remove();
            console.warn(`[PrivacyGuard] Blocked dynamic script: ${src}`);
          }
        }
      });
    });
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  return observer;
}

// ── Block global tracking globals ────────────────────────────────────────────
// gtag is EXCLUDED from blocking because GA4 uses it when analytics consent
// is granted. The analytics utility manages gtag lifecycle.
export function blockTrackingGlobals() {
  const noop = () => {};
  const noopProxy = new Proxy(noop, {
    get: () => noopProxy,
    apply: () => undefined,
  });

  // Block common tracker globals (gtag excluded — handled by analytics utility)
  ["ga", "fbq", "twq", "_hsq", "mixpanel", "amplitude", "heap"].forEach(global => {
    if (!window[global]) {
      Object.defineProperty(window, global, {
        get: () => noopProxy,
        set: () => {},
        configurable: true,
      });
    }
  });
}

// ── Disable localStorage/sessionStorage for third-party use ──────────────────
export function sanitizeStorage() {
  // Clear any known tracker storage keys
  const trackerKeys = [
    "_ga", "_gid", "_fbp", "_fbc", "__utma", "__utmb", "__utmc", "__utmz",
    "ajs_anonymous_id", "ajs_user_id", "amplitude_id", "mp_", "ht_", "fs_"
  ];

  trackerKeys.forEach(key => {
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith(key)) {
        localStorage.removeItem(k);
      }
    });
  });
}

// ── Master init — call this once on app startup ───────────────────────────────
export function initPrivacyGuard({ blockAnalytics = true, blockChat = false } = {}) {
  blockThirdPartyCookies();
  blockFingerprinting();
  blockTrackerRequests();
  blockTrackingGlobals();
  sanitizeStorage();

  if (blockAnalytics || !isAnalyticsAllowed()) {
    removeTrackerScripts();
  }

  console.info("[PrivacyGuard] Privacy protection active.");
}