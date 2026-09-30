/**
 * SafeNestT Analytics Utility (GA4)
 *
 * Wraps Google Analytics 4 tracking with privacy guard integration.
 * Only sends events when the user has consented to analytics.
 * Never sends sensitive data ( PII, wallet addresses, case details, etc.).
 *
 * Usage:
 *   import { trackEvent, pageView } from '@/lib/analytics'
 *   trackEvent('case_created', { category: 'fraud' })
 *   pageView('/cases')
 */

const MEASUREMENT_ID = 'G-EV4Q5153LZ'
const GA_ENDPOINT = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID

// ── Consent check ──────────────────────────────────────────────────────────

function isAnalyticsConsentGranted() {
  if (typeof window === 'undefined') return false
  try {
    // Respect PrivacyGuard consent
    const guard = window.PrivacyGuard
    if (guard && typeof guard.isAnalyticsAllowed === 'function') {
      return guard.isAnalyticsAllowed()
    }
    // Fallback: check our own consent storage
    const raw = localStorage.getItem('safenest_privacy_consent')
    if (raw) {
      const consent = JSON.parse(raw)
      return consent.analytics === true
    }
  } catch {
    // If anything fails, treat as no consent
  }
  return false
}

// ── Safe gtag wrapper ─────────────────────────────────────────────────────

function safeGtag(...args) {
  if (!isAnalyticsConsentGranted()) return
  try {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag(...args)
    }
  } catch {
    // gtag unavailable — silently ignore
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Track a GA4 event with safe, non-sensitive parameters only.
 *
 * Allowed param keys: event_category, event_label, value (non-negative int)
 * All other keys are ignored to prevent accidental PII leakage.
 */
export function trackEvent(eventName, params = {}) {
  if (!eventName || typeof eventName !== 'string') return

  // Whitelist of safe params to pass to gtag
  const safeParams = {}
  if (params.event_category && typeof params.event_category === 'string') {
    safeParams.event_category = params.event_category
  }
  if (params.event_label && typeof params.event_label === 'string') {
    // Sanitize: strip anything that looks like PII
    const sanitized = params.event_label.replace(
      /[\w\.-]+@[\w\.-]+|\+?\d{7,}|\b0x[a-fA-F0-9]{40}\b|\bSN-\d{4}-\d{3,5}\b/g,
      '[REDACTED]'
    )
    safeParams.event_label = sanitized
  }
  if (typeof params.value === 'number' && params.value >= 0 && params.value <= 1000000) {
    safeParams.value = Math.round(params.value)
  }

  safeGtag('event', eventName, safeParams)
}

/**
 * Track a page view. Call this on route changes.
 */
export function pageView(path) {
  if (!path) return
  safeGtag('config', MEASUREMENT_ID, {
    page_path: path,
    page_title: document.title || undefined,
  })
}

/**
 * Returns true if GA4 is initialized and consent is granted.
 */
export function isGAEnabled() {
  return isAnalyticsConsentGranted() && typeof window !== 'undefined' && window.gtag
}

/**
 * Initialize GA4. Safe to call multiple times (gtag is idempotent,
 * and we check for existing dataLayer before creating).
 *
 * Must be called once at app startup. In React Strict Mode, this may
 * be called twice — that's fine, gtag handles it.
 */
export function initGA() {
  if (typeof window === 'undefined') return

  // Already initialized?
  if (window.gtag) return

  // Check consent before even loading the script
  if (!isAnalyticsConsentGranted()) {
    // Still set up the dataLayer and noop gtag so calls don't throw
    window.dataLayer = window.dataLayer || []
    window.gtag = function () {
      window.dataLayer.push(arguments)
    }
    return
  }

  // Load the gtag script
  const script = document.createElement('script')
  script.async = true
  script.src = GA_ENDPOINT
  script.onerror = () => {
    // GA script failed to load — make gtag a noop so calls don't throw
    window.gtag = function () {
      window.dataLayer.push(arguments)
    }
  }
  document.head.appendChild(script)

  // Initialize dataLayer and gtag
  window.dataLayer = window.dataLayer || []
  window.gtag = function () {
    window.dataLayer.push(arguments)
  }

  // Configure GA4 once the script is loaded
  script.onload = () => {
    try {
      window.gtag('js', new Date())
      window.gtag('config', MEASUREMENT_ID)
    } catch {
      // Ignore
    }
  }

  // Fallback: if script already in cache, onload may not fire
  // Use a small timeout as a safety net
  setTimeout(() => {
    if (!window.gtag) {
      window.gtag = function () {
        window.dataLayer.push(arguments)
      }
    }
  }, 1000)
}
