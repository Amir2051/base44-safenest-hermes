/**
 * UME — Unified Metadata Enrichment (SafeNestT OS data module)
 *
 * Central data + provenance + matching module for SafeNestT OS.
 *
 * This module is the single source of truth for:
 *  - data catalogs / sources (VARA, Dubai Pulse, Dateno)
 *  - record provenance (source_url, source_name, retrieved_at, source_record_id, ...)
 *  - entity matching / filter helpers (VASP registry, UAE sources, global public data)
 *
 * It deliberately does NOT perform live API calls. Live retrieval is done
 * server-side through the Base44 function layer (datenoEnrichProxy,
 * osintProxy, uae-intel-sync). This module keeps the *data contract* and
 * *matching logic* importable, testable, and free of side effects.
 *
 * Design rules:
 *  - All matched records carry provenance alongside data.
 *  - No record is treated as proof of fraud by itself.
 *  - Matching (name / domain / email / phone / country / wallet / transaction)
 *    is deterministic and auditable.
 */

// ── Provenance constants ────────────────────────────────────────────────────

/** Well-known source identifiers (stable keys for joins). */
export const SOURCES = {
  VARA_PUBLIC_REGISTER: "vara_public_register",
  DUBAI_PULSE: "dubai_pulse",
  DATENO: "dateno",
};

/** Record-level provenance fields that every imported/matched record must carry. */
export const PROVENANCE_FIELDS = [
  "source_url",
  "source_name",
  "retrieved_at",
  "source_record_id",
  "source_record_order",
];

// ── VASP / Licence / Activity (Dateno enrichment context) ───────────────────

/** VASP registry record provenance (VARA or Dateno-sourced). */
export function VaspRecord(overrides = {}) {
  return {
    // Identity
    id: null,
    name: null,
    reference: null,
    vara_reference: null,
    // Licence
    licence_type: null,
    licence_date: null,
    status: "Active",
    cma_registration: null,
    // Licenced activities
    licensed_activities: [],
    // Domains / identifiers linked to the VASP
    domains: [],
    websites: [],
    wallet_addresses: [],
    // Provenance
    source_url: null,
    source_name: null,
    retrieved_at: null,
    source_record_id: null,
    source_record_order: null,
    jurisdiction: null,
    dataset_id: null,
    dataset_title: null,
    dataset_url: null,
    dataset_description: null,
    ...overrides,
  };
}

// A controlled set of fields that the VASP record controller treats as load-bearing.
export const VASPRECORD_FIELD_MAP = {
  // identity
  "VASP Name": "name",
  "Reference": "reference",
  "Licence Type": "licence_type",
  "Licensed Activities": "licensed_activities",
  "Licence Issued": "licence_date",
  "Status": "status",
  "CMA Registration Number": "cma_registration",
};

/** Normalise a raw cell value (strip HTML, collapse whitespace, etc.). */
export function normaliseCell(raw) {
  if (raw === null || raw === undefined) return null;
  let text = String(raw)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  // Drop a leading @ footnote marker (Dateno/VARA convention).
  if (text.startsWith("@")) text = text.slice(1).trim();
  return text || null;
}

/** Build the full provenance envelope for an imported record. */
export function buildProvenance(record, retrievedAt, sourceUrl, sourceName, sourceRecordId = "", sourceRecordOrder = "") {
  const base = { ...record };
  return {
    ...base,
    source_url: sourceUrl,
    source_name: sourceName,
    retrieved_at: retrievedAt,
    source_record_id: sourceRecordId,
    source_record_order: sourceRecordOrder,
  };
}

// ── Source field mapping: key -> SafeNestT entity field(s) ──────────────────

/** Map a Dateno hit's provenace fields onto SafeNestT entity fields. */
export function mapDatenoHitToEntity(hit) {
  const src = hit?._source;
  const dataset = src?.dataset || {};
  const source = src?.source || {};

  return {
    // Generic enrichment notes (kept for the front end to display).
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
    source_uid: source?.uid || null,
    source_countries: source?.countries || [],
    source_macroregions: source?.macroregions || [],
    source_software: source?.software || null,
    hit_id: hit?._id || null,
    hit_score: hit?._score ?? null,
  };
}

/** Normalise a raw Dateno hit into a SafeNestT provenance record (re-export). */
export function normaliseDatenoHit(hit) {
  return mapDatenoHitToEntity(hit);
}

/**
 /** Build a complete, schema-validated DatenoLedger record from a normalized
  *  Dateno enrichment hit (the flat record shape returned by the
  *  dateno-enrich function as data.hits).
  *
  *  The flat hit shape follows the documented API shapes: { dataset: {...} },
  *  but enrichment strips nested lookups out. This builder reassembles the
  *  full provenance record from the flattened fields so every schema field
  *  is materialised from the enrichment output, not from raw API internals.
  *
  *  mapDatenoHitToEntity() serialises the full nested hit object so it can be
  *  materialised as a DatenoLedger entity; raw non-serialisable values are
  *  JSON-stringified. Objects always pass through (caller must mask values).
  */
 export function toLedgerRecord(hit, lookup = {}) {
   // The enrichment output is a flattened record (no nested _source);
   // reassemble from the flat fields.
   const dataset = hit?.dataset || {};

   return {
     // Source system that produced the enrichment record.
     source: "dateno",
     // Provenance
     source_name: hit?.source_name || hit?._source?.source?.name || null,
     source_url: hit?.source_url || hit?._source?.source?.url || null,
     source_record_id: dataset?.id || hit?.dataset_id || null,
     source_record_order: null,
     retrieved_at: new Date().toISOString(),
     // Dataset
     dataset_id: dataset?.id || hit?.dataset_id || null,
     dataset_int_id: dataset?.int_id || hit?.dataset_int_id || null,
     dataset_title: dataset?.title || hit?.dataset_title || null,
     dataset_url: dataset?.url || hit?.dataset_url || null,
     dataset_description: dataset?.description || hit?.dataset_description || null,
     dataset_datatypes: dataset?.datatypes || hit?.dataset_datatypes || [],
     dataset_formats: dataset?.formats || hit?.dataset_formats || [],
     dataset_tags: dataset?.tags || hit?.dataset_tags || [],
     dataset_topics: dataset?.topics || hit?.dataset_topics || [],
     dataset_topics_original: dataset?.topics_original || hit?.dataset_topics_original || [],
     dataset_license_id: dataset?.license_id || hit?.dataset_license_id || null,
     dataset_num_resources: dataset?.num_resources ?? hit?.dataset_num_resources ?? null,
     dataset_has_archive: dataset?.has_archive ?? hit?.dataset_has_archive ?? false,
     // Source metadata
     source_uid: hit?.source_uid || hit?._source?.uid || null,
     source_countries: Array.isArray(hit?.source_countries) ? hit.source_countries : Array.isArray(hit?._source?.countries) ? hit._source.countries : [],
     source_macroregions: Array.isArray(hit?.source_macroregions) ? hit.source_macroregions : Array.isArray(hit?._source?.macroregions) ? hit._source.macroregions : [],
     source_software: hit?.source_software || hit?._source?.software || null,
     source_langs: Array.isArray(hit?.source_langs) ? hit.source_langs : Array.isArray(hit?._source?.langs) ? hit._source.langs : [],
     // Hit metadata
     hit_id: hit?._id || hit?.hit_id || null,
     hit_score: hit?._score ?? hit?.hit_score ?? null,
     hit_index: hit?._index || hit?.hit_index || null,
     // Jurisdiction / country
     jurisdiction: lookup?.jurisdiction || hit?.jurisdiction || null,
     country: lookup?.country || hit?.country || null,
     // Matching
     match_type: hit?.match_type || "catalog_search",
     matched_fields: hit?.matched_fields || [],
     // Intelligence status (never auto-fraud)
     confidence: hit?.confidence || "lead_only",
     classification: hit?.classification || "unconfirmed",
   };
 }

// ── Masking / redaction helpers (for UI / logs) ─────────────────────────────

/** Mask a string value for display in logs or non-moderated UI (e.g. emails). */
export function maskValue(value, maskLength = 4) {
  if (!value) return value;
  const n = Math.max(0, Math.min(maskLength, value.length));
  if (n <= 1) return value;
  return value.slice(0, n) + "•".repeat(value.length - n) + value.slice(-n);
}

/** Redact a JSON-safe string; objects pass through (caller must mask values). */
export function redactJson(value, maxLen = 8) {
  if (typeof value !== "string") return JSON.stringify(value);
  if (value.length <= maxLen * 2) return value;
  const head = value.slice(0, maxLen / 2);
  const tail = value.slice(-maxLen / 2);
  return `${head}…${tail}`;
}
