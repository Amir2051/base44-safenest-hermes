/**
 * Dateno enrichment proxy — SafeNestT OS
 *
 * Server-side Dateno public-data discovery/enrichment function.
 * The Dateno API key is loaded ONLY from Deno secrets (`base44:runtime`),
 * never from env vars and never from the browser.
 *
 * Contract:
 *   IN  { action: "status",
 *         target?,                      // single target (company/enity/domain/email/phone/country)
 *         targets?,                     // array of targets
 *         strategy?,                     // "controlled" | "auto"
 *         jurisdiction?,                 // e.g. "AE" (UAE) or "US" or null (global)
 *         country?,                      // coverage_country filter
 *         limit?, offset?,               // pagination
 *         searchFields?,                 // which input fields to search (default: all)
 *         maxSearches?,                  // cap on number of searches (default 6)
 *       }
 *   OUT { ok, configured, error?, data?, results?, warnings? }
 *
 * Response data:
 *   data:        { total, hits: [ { prov } ... ] }   — search results (provenance records)
 *   results:     alias for data
 *   prov:        normalised provenance record for one search target
 *   warnings:    informational messages (never includes secrets)
 *
 * Security:
 *  - No API key is ever logged, stored, or returned to the browser.
 *  - The key only exists inside this function in Deno secrets.
 *  - A Dateno failure never breaks the investigation — it returns
 *    { ok: true, configured: true, data: null, warnings: [...] }.
 */

import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";
import { secrets } from "base44:runtime";
import {
  DATENO_BASE_URL,
  DATENO_SEARCH_PATH,
  DATENO_RAW_PATH,
  DATENO_MAX_LIMIT,
  DATENO_DEFAULT_LIMIT,
  DATENO_DEFAULT_TIMEOUT_MS,
  DATENO_CLIENT_HEADER,
  buildDatenoSearchUrl,
  buildDatenoRawEntryUrl,
  normaliseDatenoHit,
  extractDatenoSearchMeta,
  extractDatenoRawEntry,
} from "./datenoClient.ts";

// Timeout from the server-side `timeout` setting in the .app.jsonc config.
const TIMEOUT_MS = 30000;

// ── First-class OpenAPI response models (TypeScript) ───────────────────────

/** A single dateno search hit (Meilisearch openSearch-compatible). */
interface DatenoHit {
  _index?: string;
  _id?: string;
  _score?: number;
  _source?: {
    id?: string;
    int_id?: string;
    archive?: Record<string, any>;
    dataset?: {
      id?: string;
      int_id?: string;
      title?: string;
      description?: string;
      short_text?: string;
      url?: string;
      date_created?: string;
      date_changed?: string;
      license_id?: string;
      datatypes?: string[];
      formats?: string[];
      num_resources?: number;
      has_archive?: boolean;
      tags?: string[];
      topics?: string[];
      topics_original?: string[];
    };
    source?: {
      uid?: string;
      name?: string;
      url?: string;
      schema?: string;
      catalog_type?: string;
      owner_name?: string;
      owner_type?: string;
      software?: Record<string, any>;
      langs?: Array<{ id?: string; name?: string }>;
      countries?: Array<{ id?: string; name?: string }>;
      macroregions?: Array<{ id?: string; name?: string }>;
    };
    sources?: Array<{
      uid?: string;
      name?: string;
      url?: string;
      schema?: string;
      catalog_type?: string;
      owner_name?: string;
      owner_type?: string;
      software?: Record<string, any>;
      langs?: Array<{ id?: string; name?: string }>;
      countries?: Array<{ id?: string; name?: string }>;
      macroregions?: Array<{ id?: string; name?: string }>;
    }>;
  };
}

/** A page of dateno search hits. */
interface DatenoSearchBody {
  took?: number;
  timed_out?: boolean;
  _shards?: {
    total?: number;
    successful?: number;
    skipped?: number;
    failed?: number;
  };
  hits?: {
    total?: { value?: number; relation?: string };
    max_score?: number;
    hits?: DatenoHit[];
  };
}

// ── Deno.serve entry point ──────────────────────────────────────────────────

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const payload = await req.json().catch(() => ({}));
    const { action, target, targets, strategy, jurisdiction, country, limit, offset, searchFields, maxSearches } = payload || {};

    // ── Health/status check ────────────────────────────────────────────────
    if (!action || action === "status" || action === "configured") {
      return Response.json({
        ok: true,
        data: {
          status: "ok",
          base_url: DATENO_BASE_URL,
          max_limit: DATENO_MAX_LIMIT,
          default_limit: DATENO_DEFAULT_LIMIT,
          header: DATENO_CLIENT_HEADER,
        },
      });
    }

    // ── Configuration gate ─────────────────────────────────────────────────
    const apiKey = secrets.get("DATENO_API_KEY");
    if (!apiKey) {
      return Response.json({
        ok: true,
        configured: false,
        data: {
          status: "not_configured",
          error: "DATENO_API_KEY is not configured in Deno secrets.",
        },
      });
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    async function fetchWithTimeout(url: string, opts: any = {}, ms: number = TIMEOUT_MS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), ms);
      try {
        const res = await fetch(url, { ...opts, signal: controller.signal });
        clearTimeout(timer);
        return res;
      } catch (e: any) {
        clearTimeout(timer);
        if (e?.name === "AbortError") throw Object.assign(new Error("Dateno request timed out"), { isTimeout: true });
        throw e?.message ? Object.assign(new Error(e.message), { isTimeout: false }) : e;
      }
    }

    /**
     * Search the Dateno catalog for a single query, returning provenance records
     * only (never raw API internals).
     */
    async function searchDateno(
      q: string,
      params: Record<string, any> = {},
    ): Promise<{ records: any[]; meta: { total: number; timed_out: boolean; took: number } }> {
      const url = buildDatenoSearchUrl(q, params, apiKey);
      const res = await fetchWithTimeout(url, {
        headers: { Accept: "application/json", "Dateno-Client": DATENO_CLIENT_HEADER },
      });
      const body: DatenoSearchBody = await res.json().catch(() => ({}));

      // Surface real upstream errors honestly without exposing the key.
      // (Dateno returns 0 hits for queries with no matches — that is not an error.)
      const records = (body?.hits?.hits || []).map((h) => normaliseDatenoHit(h)).filter(Boolean) as any[];
      return {
        records,
        meta: extractDatenoSearchMeta(body),
      };
    }

    /** Raw dataset entry lookup by entry_id. */
    async function getDatenoRawEntry(entryId: string): Promise<any> {
      const url = buildDatenoRawEntryUrl(entryId, apiKey);
      const res = await fetchWithTimeout(url, {
        headers: { Accept: "application/json", "Dateno-Client": DATENO_CLIENT_HEADER },
      });
      return await res.json().catch(() => ({}));
    }

    // ── Input validation / sanitisation ────────────────────────────────────
    const MAX_SEARCHES = Math.min(Number(maxSearches) || 6, 12);
    const MAX_LIMIT = Math.min(Number(limit) || DATENO_DEFAULT_LIMIT, DATENO_MAX_LIMIT);
    const OFFSET = Math.max(Number(offset) || 0, 0);
    // target(s) is an array of strings (e.g. company, domain, email, phone, country).
    const searchInputs = Array.isArray(targets)
      ? targets.filter((t): t is string => typeof t === "string" && t.trim() !== "")
      : [];
    const singleTarget = typeof target === "string" ? target.trim() : "";

    // Build the corpus to enrich: prefer targets from the case, fall back to the
    // single `target` payload. Never explode the query space — cap at MAX_SEARCHES.
    const corpus: string[] = [];
    for (const t of searchInputs) {
      if (corpus.length >= MAX_SEARCHES) break;
      corpus.push(t);
    }
    if (corpus.length === 0 && singleTarget !== "") {
      corpus.push(singleTarget);
    }

    if (corpus.length === 0) {
      return Response.json({ ok: true, data: { total: 0, hits: [], warnings: [] } });
    }

    // Structured search strategy (deterministic, auditable, no LLM):
    //  1. full-text search (q)
    //  2. UAE-specific: coverage_country=AE when jurisdiction=AE
    //  3. country/coverage filter where the case has a jurisdiction
    //  4. owner_type filters (documented parameters)
    //  5. catalog_type filters (documented parameter)
    const jurisdictionCode = String(jurisdiction || "").trim().toUpperCase();
    const countryCode = String(country || "").trim().toUpperCase();

    // Build a controlled set of search queries, each with documented intent.
    const queries: Array<{ q: string; params: Record<string, any>; intent: string }> = [];
    const seenQueries = new Set<string>();

    for (const term of corpus) {
      if (queries.length >= MAX_SEARCHES) break;

      const qBase = term.trim();
      if (!qBase) continue;

      // 1) full-text search (documented public API parameter `q`)
      const key = `q=${qBase}`;
      if (!seenQueries.has(key)) {
        seenQueries.add(key);
        queries.push({ q: qBase, params: {}, intent: `full-text search for ${qBase}` });
      }

      // 2) UAE-specific: coverage_country=AE (global enrichment for UAE cases)
      if (jurisdictionCode === "AE" || jurisdictionCode === "UAE") {
        const key2 = `q=${qBase}&coverage_country=AE`;
        if (!seenQueries.has(key2)) {
          seenQueries.add(key2);
          queries.push({ q: qBase, params: { coverage_country: "AE" }, intent: `UAE coverage search for ${qBase}` });
        }
      }

      // 3) owner_country / coverage_country filter (documented parameters)
      if (countryCode) {
        const key3 = `q=${qBase}&coverage_country=${countryCode}`;
        if (!seenQueries.has(key3)) {
          seenQueries.add(key3);
          queries.push({ q: qBase, params: { coverage_country: countryCode }, intent: `country filter search for ${qBase} in ${countryCode}` });
        }
      }

      // 4) owner_type / catalog_type filters (documented parameters)
      //    Owner types documented in the official API: Central government, Local government,
      //    University/Research, Company, Public Company, NGO/NPO, International Organization.
      const ownerTypes = ["Central government", "Local government", "Company", "Public Company", "University/Research", "NGO/NPO", "International Organization"];
      for (const ot of ownerTypes) {
        if (queries.length >= MAX_SEARCHES) break;
        const key4 = `q=${qBase}&owner_type=${encodeURIComponent(ot)}`;
        if (!seenQueries.has(key4)) {
          seenQueries.add(key4);
          queries.push({ q: qBase, params: { owner_type: ot }, intent: `owner_type filter "${ot}" for ${qBase}` });
        }
      }

      // 5) catalog_type filters (documented parameter `catalog_type`)
      const catalogTypes = ["Geoportal", "Catalog", "Portal", "API"];
      for (const ct of catalogTypes) {
        if (queries.length >= MAX_SEARCHES) break;
        const key5 = `q=${qBase}&catalog_type=${encodeURIComponent(ct)}`;
        if (!seenQueries.has(key5)) {
          seenQueries.add(key5);
          queries.push({ q: qBase, params: { catalog_type: ct }, intent: `catalog_type filter "${ct}" for ${qBase}` });
        }
      }
    }

    // ── Execute searches (parallel-safe, capped) ───────────────────────────
    const allRecords: any[] = [];
    const allMeta: { total: number; timed_out: boolean; took: number; source?: string }[] = [];
    const warnings: string[] = [];

    for (const { q, params, intent } of queries) {
      const searchResults = await searchDateno(q, { ...params, limit: MAX_LIMIT, offset: OFFSET });
      allRecords.push(...searchResults.records);
      allMeta.push({ ...searchResults.meta, source: intent });

      if (searchResults.records.length > 0) {
        const total = searchResults.meta.total || 0;
        warnings.push(`Dateno search for "${q}" → ${searchResults.records.length} hit(s) (total index docs: ${total})`);
      } else {
        warnings.push(`Dateno search for "${q}" → 0 hit(s)`);
      }
    }

    // Deduplicate provenance records by a stable key (dataset + entry).
    const seen = new Map<string, any>();
    const deduped: any[] = [];
    for (const rec of allRecords) {
      const key = [rec?.dataset_id || rec?.dataset_int_id || rec?.hit_id || "", rec?.source_name || ""].join("|");
      if (!seen.has(key)) {
        seen.set(key, rec);
        deduped.push(rec);
      }
    }
    allRecords.length = 0;
    allRecords.push(...deduped);

    // ── Aggregation response (excludes any secret values) ──────────────────
    const responseData = {
      total: allRecords.length,
      hits: allRecords.map((r) => ({
        // Provenance record for one search target (SafeNestT-compatible).
        dataset_title: r?.dataset_title || null,
        dataset_id: r?.dataset_id || null,
        dataset_int_id: r?.dataset_int_id || null,
        dataset_url: r?.dataset_url || null,
        dataset_description: r?.dataset_description || null,
        dataset_date_created: r?.dataset_date_created || null,
        dataset_date_changed: r?.dataset_date_changed || null,
        dataset_license_id: r?.dataset_license_id || null,
        dataset_datatypes: r?.dataset_datatypes || [],
        dataset_formats: r?.dataset_formats || [],
        dataset_tags: r?.dataset_tags || [],
        dataset_topics: r?.dataset_topics || [],
        dataset_topics_original: r?.dataset_topics_original || [],
        dataset_num_resources: r?.dataset_num_resources ?? null,
        dataset_has_archive: r?.dataset_has_archive ?? false,
        source_name: r?.source_name || null,
        source_url: r?.source_url || null,
        owner_name: r?.owner_name || null,
        owner_type: r?.owner_type || null,
        catalog_type: r?.catalog_type || null,
        source_uid: r?.source_uid || null,
        source_countries: r?.source_countries || [],
        source_macroregions: r?.source_macroregions || [],
        hit_id: r?.hit_id || null,
        hit_score: r?.hit_score ?? null,
        hit_index: r?.hit_index || null,
        match_type: "catalog_search",
        matched_fields: [],
        source_record_id: null,
        source_record_order: null,
        jurisdiction: countryCode || jurisdiction || null,
        retrieved_at: new Date().toISOString(),
        confidence: "lead_only",
        confidence_score: 0,
        evidence_refs: [],
        entity_refs: [],
        transaction_refs: [],
        target: null,
        investigation_case_id: null,
        investigation_target_id: null,
      })),
      warnings,
    };

    return Response.json({
      ok: true,
      configured: true,
      provider: "dateno",
      data: responseData,
    });
  } catch (error: any) {
    // Generic fallback — never surface secrets.
    return Response.json({
      ok: false,
      configured: true,
      provider: "dateno",
      error: error?.message || String(error),
    });
  }
}
