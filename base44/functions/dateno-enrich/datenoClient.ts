/**
 * Dateno API client — SafeNestT OS
 *
 * Internal HTTP client for the Dateno public-data discovery/enrichment API.
 * All calls go through the server-side Deno function so the API key is never
 * exposed to the browser.
 *
 * Official API (confirmed from Dateno docs):
 *   Base URL:  https://api.dateno.io
 *   Search:    /search/0.2/query
 *   Auth:      ?apikey=<YOUR_API_KEY>        (query parameter)
 *   Search:    GET /search/0.2/query?q=...&limit=...&offset=...&apikey=...
 *   Raw entry: GET /search/0.2/raw/{entry_id}?apikey=...
 *   Response:  openSearch-compatible (Meilisearch) body:
 *              { took, timed_out, _shards, hits: { total, max_score, hits: [ { _id, _source } ] } }
 *
 * @module datenoClient
 */

// Official Dateno API root (production).
export const DATENO_BASE_URL = "https://api.dateno.io";

// Official search endpoint path (confirmed via Dateno docs).
export const DATENO_SEARCH_PATH = "/search/0.2/query";

// Official raw-entry endpoint (documented: Raw Dataset Entry By Id accepts entry_id).
export const DATENO_RAW_PATH = "/search/0.2/raw";

// Headroom for safe pagination across all pages.
export const DATENO_MAX_LIMIT = 500; // enforced by the Dateno API
export const DATENO_DEFAULT_LIMIT = 20;
export const DATENO_DEFAULT_TIMEOUT_MS = 30000;

// Client identification (matches official SDK behaviour).
export const DATENO_CLIENT_HEADER = "SafeNestT-OS/1.0";

// ── Request helpers ─────────────────────────────────────────────────────────

/**
 * Build the search URL with the `apikey` query parameter.
 * The key is passed via the URL query string (documented authentication).
 */
export function buildDatenoSearchUrl(
  q: string,
  params: Record<string, any> = {},
  apiKey: string
): string {
  const { limit = DATENO_DEFAULT_LIMIT, offset = 0, ...filters } = params;
  const qs = new URLSearchParams({
    q: q ?? "",
    limit: String(Math.min(limit, DATENO_MAX_LIMIT)),
    offset: String(Math.max(offset, 0)),
    apikey: apiKey,
  });
  // Add any documentation-supported filter params: software, owner_type, catalog_type,
  // owner_country, coverage_country. Keys must match the official documented names.
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  // The apikey is appended so it is not mis-ordered in multi-key strings.

  return `${DATENO_BASE_URL}${DATENO_SEARCH_PATH}?${qs.toString()}`;
}

export function buildDatenoRawEntryUrl(
  entryId: string,
  apiKey: string
): string {
  const qs = new URLSearchParams({ apikey: apiKey });
  return `${DATENO_BASE_URL}${DATENO_RAW_PATH}/${encodeURIComponent(entryId)}?${qs.toString()}`;
}

// ── Provenance helpers ──────────────────────────────────────────────────────

/** Normalise a raw Dateno hit into a SafeNestT provenance record. */
export function normaliseDatenoHit(hit: any): any {
  const src = hit?._source;
  if (!src) return null;

  const dataset = src?.dataset || {};
  const source = src?.source || {};

  return {
    // Provenance
    source_name: source?.name || null,
    source_url: source?.url || null,
    owner_name: source?.owner_name || null,
    owner_type: source?.owner_type || null,
    catalog_type: source?.catalog_type || null,
    dataset_id: dataset?.id || null,
    dataset_int_id: dataset?.int_id || null,
    dataset_title: dataset?.title || null,
    dataset_url: dataset?.url || null,
    dataset_description: dataset?.description || null,
    dataset_date_created: dataset?.date_created || null,
    dataset_date_changed: dataset?.date_changed || null,
    dataset_license_id: dataset?.license_id || null,
    dataset_datatypes: dataset?.datatypes || [],
    dataset_formats: dataset?.formats || [],
    dataset_tags: dataset?.tags || [],
    dataset_topics: dataset?.topics || [],
    dataset_topics_original: dataset?.topics_original || [],
    dataset_num_resources: dataset?.num_resources ?? null,
    dataset_has_archive: dataset?.has_archive ?? false,

    // Source metadata
    source_uid: source?.uid || null,
    source_software: source?.software || null,
    source_langs: source?.langs || [],
    source_countries: source?.countries || [],
    source_macroregions: source?.macroregions || [],

    // Raw/document fields
    hit_id: hit?._id || null,
    hit_score: hit?._score ?? null,
    hit_index: hit?._index || null,
  };
}

/**
 * Extract simple, deterministic metadata from a search response.
 * Mirrors the documented response shape (openSearch-compatible).
 */
export function extractDatenoSearchMeta(body: any): {
  total: number;
  timed_out: boolean;
  took: number;
  hits: any[];
} {
  const hitsBody = body?.hits || {};
  return {
    total: hitsBody?.total?.value || 0,
    timed_out: hitsBody?.timed_out || false,
    took: body?.took || 0,
    hits: hitsBody?.hits || [],
  };
}

/**
 * Extract raw-hit-level provenance (entry-level).
 * The API returns raw dataset entries through /search/0.2/raw/{entry_id}.
 */
export function extractDatenoRawEntry(body: any): any {
  const data = body?.data || {};
  return {
    id: data?.id || null,
    int_id: data?.int_id || null,
    source: data?.source || null,
    dataset: data?.dataset || null,
    resources: data?.resources || null,
  };
}
