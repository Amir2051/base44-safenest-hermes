/**
 * Dateno Ledger persistence — SafeNestT OS
 *
 * Server-side function: writes server-side enriched data-discovery records
 * into the dedicated `DatenoLedger` entity. This keeps intelligence
 * provenance (source, dataset, hit, jurisdiction, matching) off the
 * EvidenceItem schema, which is designed for uploaded/processed evidence,
 * NOT for external-data provenance.
 *
 * The Dateno API key stays in the existing dateno-enrich function. This
 * function never touches DATENO_API_KEY — it only accepts validation-ready
 * enriched records produced by the dateno-enrich flow and writes them.
 *
 * Contract:
 *   IN  { action: "write", records: [ { ...DatenoEnrichmentRecord } ] }
 *   OUT { ok, created: number, ids: string[], errors?: [{ index, error }] }
 *
 * Security:
 *  - DATENO_API_KEY is NOT read by this function.
 *  - Server-side only. Never returns the key or any credential to the caller.
 *  - Malformed records are rejected with their index, never block the batch.
 */
import { createClientFromRequest } from "npm:@base44/sdk@0.8.52";

// Timeout from the server-side `timeout` setting in the .app.jsonc config.
const TIMEOUT_MS = 30000;

async function withTimeout(promise: Promise<unknown>, ms: number, label: string) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)
    ),
  ]);
}

// ── Field whitelist for a DatenoLedger record (no secrets, no raw secrets). ──
const LEDGER_MAP: Record<string, string> = {
  // association
  source: "source",
  // provenance
  source_name: "source_name",
  source_url: "source_url",
  source_record_id: "source_record_id",
  source_record_order: "source_record_order",
  retrieved_at: "retrieved_at",
  // dataset
  dataset_id: "dataset_id",
  dataset_int_id: "dataset_int_id",
  dataset_title: "dataset_title",
  dataset_url: "dataset_url",
  dataset_description: "dataset_description",
  dataset_datatypes: "dataset_datatypes",
  dataset_formats: "dataset_formats",
  dataset_tags: "dataset_tags",
  dataset_topics: "dataset_topics",
  dataset_topics_original: "dataset_topics_original",
  dataset_license_id: "dataset_license_id",
  dataset_num_resources: "dataset_num_resources",
  dataset_has_archive: "dataset_has_archive",
  // source metadata
  source_uid: "source_uid",
  source_countries: "source_countries",
  source_macroregions: "source_macroregions",
  source_software: "source_software",
  source_langs: "source_langs",
  // hit metadata
  hit_id: "hit_id",
  hit_score: "hit_score",
  hit_index: "hit_index",
  // jurisdiction / match
  jurisdiction: "jurisdiction",
  country: "country",
  match_type: "match_type",
  matched_fields: "matched_fields",
  strategy: "strategy",
  sources_count: "sources_count",
  raw: "raw",
  // Intelligence status (never auto-fraud)
  confidence: "confidence",
  classification: "classification",
};

const DEFAULTS: Record<string, unknown> = {
  confidence: "lead_only" as const,
  classification: "unconfirmed" as const,
  source: "dateno" as const,
  match_type: "catalog_search" as const,
  matched_fields: [] as string[],
};

const REQUIRED = ["case_id"] as const;
const OPTIONAL_BOOL = new Set(["dataset_has_archive", "original_import"]);
const OPTIONAL_NUM = new Set(["dataset_num_resources"]);
const ARRAY_FIELDS = new Set([
  "dataset_datatypes",
  "dataset_formats",
  "dataset_tags",
  "dataset_topics",
  "source_countries",
  "source_macroregions",
  "matched_fields",
]);

function jsonString(v: unknown): string {
  return JSON.stringify(v ?? "");
}

function normaliseString(v: unknown): string {
  return typeof v === "string" ? v : jsonString(v);
}

function normaliseArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => normaliseString(x));
  return [];
}

function normaliseNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function normaliseBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    if (v === "true" || v === "1" || v === "yes") return true;
    if (v === "false" || v === "0" || v === "no") return false;
  }
  return fallback;
}

/** Validate one enrichment record; return { ok, errors }. */
function validateRecord(rec: Record<string, unknown>, index: number): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!rec || typeof rec !== "object") {
    return { ok: false, errors: [`record[${index}] is not an object`] };
  }
  if (!rec.case_id || typeof rec.case_id !== "string" || rec.case_id.trim() === "") {
    errors.push(`record[${index}] missing/invalid case_id`);
  }
  // Confidence / classification defaults if omitted.
  if (!rec.confidence || !LEDGER_MAP[rec.confidence as keyof typeof LEDGER_MAP]) {
    rec.confidence = "lead_only";
  }
  if (!rec.classification || !LEDGER_MAP[rec.classification as keyof typeof LEDGER_MAP]) {
    rec.classification = "unconfirmed";
  }
  return { ok: errors.length === 0, errors };
}

function applyMap(
  out: Record<string, unknown>,
  src: Record<string, unknown>,
  map: Record<string, string>,
) {
  for (const [srcKey, dstKey] of Object.entries(map)) {
    if (srcKey in src) {
      const v = src[srcKey];
      if (ARRAY_FIELDS.has(dstKey)) {
        out[dstKey] = normaliseArray(v);
      } else if (OPTIONAL_NUM.has(dstKey)) {
        out[dstKey] = normaliseNumber(v, 0);
      } else if (OPTIONAL_BOOL.has(dstKey)) {
        out[dstKey] = normaliseBool(v, false);
      } else if (dstKey === "raw") {
        out[dstKey] = (v && typeof v === "object") ? v : null;
      } else if (typeof v === "string") {
        out[dstKey] = v;
      } else if (typeof v === "number" && Number.isFinite(v)) {
        out[dstKey] = v;
      } else if (typeof v === "boolean") {
        out[dstKey] = v;
      } else if (v === null || v === undefined) {
        out[dstKey] = null;
      } else {
        out[dstKey] = jsonString(v);
      }
    }
  }
}

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const payload = await req.json().catch(() => ({})) as {
      action?: string;
      records?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };

    const action = payload.action;

    // ── health/echo ────────────────────────────────────────────────────────
    if (!action || action === "status" || action === "configured") {
      return Response.json({
        ok: true,
        data: { status: "ok", provider: "dateno_ledger", fields: Object.keys(LEDGER_MAP) },
      });
    }

    // ── write ──────────────────────────────────────────────────────────────
    if (action === "write") {
      const records = Array.isArray(payload.records) ? payload.records : [];
      const created = [];
      const errors: Array<{ index: number; error: string }> = [];
      const dedup = new Map<string, Record<string, unknown>>();

      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        if (rec === null || typeof rec !== "object") {
          errors.push({ index: i, error: "record is not an object" });
          continue;
        }
        const { ok, errors: errs } = validateRecord(rec, i);
        if (!ok) {
          for (const e of errs) errors.push({ index: i, error: e });
          continue;
        }

        const out: Record<string, unknown> = {
          tenant_id: rec.tenant_id || user.tenant_id,
          case_id: String(rec.case_id).trim(),
        };

        // Association
        if (rec.investigation_id && typeof rec.investigation_id === "string" && rec.investigation_id.trim()) {
          out.investigation_id = rec.investigation_id.trim();
        }
        if (rec.investigation_target_id && typeof rec.investigation_target_id === "string" && rec.investigation_target_id.trim()) {
          out.investigation_target_id = rec.investigation_target_id.trim();
        }

        // Provenance
        applyMap(out, rec, LEDGER_MAP);

        // Confidence / classification defaults applied above are already set.

        // Dedup on stable provenance key so repeated enrichment is idempotent.
        const dupKey = String(
          [out.source_record_id || "",
           out.dataset_id || "",
           out.hit_id || ""].join("|") ||
          (out.case_id || "")
        );
        if (dedup.has(dupKey)) {
          created.push(dedup.get(dupKey));
          continue;
        }
        dedup.set(dupKey, out);

        try {
          const m = (await base44.entities.DatenoLedger.create(out)).catch(() => null);
          created.push(m || null);
        } catch (e: any) {
          errors.push({ index: i, error: e?.message || String(e) });
        }
      }

      return Response.json({
        ok: errors.length === 0,
        configured: true,
        provider: "dateno_ledger",
        created: created.filter(Boolean).length,
        ids: created.map((c) => c?.id).filter(Boolean) as string[],
        errors,
      });
    }

    // Unknown action.
    return Response.json({
      ok: false,
      configured: true,
      provider: "dateno_ledger",
      error: `unknown action: ${(action || "").toString()}`,
    });
  } catch (error: any) {
    // Generic fallback — never surface secrets.
    return Response.json({
      ok: false,
      configured: true,
      provider: "dateno_ledger",
      error: error?.message || String(error),
    });
  }
}
