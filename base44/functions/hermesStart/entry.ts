/**
 * SafeNestT → Hermes Investigation Bridge
 *
 * Deno serverless function that provides a secure server-to-server
 * bridge between the SafeNestT frontend and the Hermes investigation engine.
 *
 * Endpoints:
 *   POST /api/hermes/start
 *     Start an investigation for a case.
 *     Browser → Base44 function → (auth check) → Hermes engine
 *
 *   GET /api/hermes/status?id={investigation_id}
 *     Get investigation status from Hermes.
 *
 *   GET /api/hermes/health
 *     Check Hermes engine health (no auth required).
 *
 * Security:
 *   - User must be authenticated (base44.auth.me())
 *   - User must own the case or be an admin
 *   - HERMES_API_KEY is server-side only (Deno.env.get)
 *   - Case authorization is resolved from Base44 data, not from client input
 *
 * Environment variables (set in Base44 dashboard / Deno env):
 *   HERMES_BASE_URL  - Hermes engine URL (default http://127.0.0.1:8002)
 *   HERMES_API_KEY   - Server-to-server API key for Hermes
 */

import { createClientFromRequest } from "npm:@base44/sdk@0.8.6";

// ---------------------------------------------------------------------------
// Hermes Client — INLINED (cannot import from src/ in Base44 functions)
// ---------------------------------------------------------------------------
// SafeNestT → Hermes Investigation Engine client
// Server-side ONLY. Uses Deno's fetch + X-API-Key auth to call the Hermes engine.
// Auth: X-API-Key header (never exposed to browser)
// Secrets: HERMES_BASE_URL, HERMES_API_KEY via Deno.env.get()

const HERMES_BASE_URL = Deno.env.get("HERMES_BASE_URL") || "http://127.0.0.1:8002";
const HERMES_API_KEY = Deno.env.get("HERMES_API_KEY") || "";

/** True if both HERMES_BASE_URL and HERMES_API_KEY are configured */
function isConfigured() {
  return Boolean(HERMES_BASE_URL && HERMES_API_KEY);
}

/** Shared headers for all Hermes requests */
function hermestHeaders() {
  return { "X-API-Key": HERMES_API_KEY, "Content-Type": "application/json" };
}

/** Build the full Hermes API URL for a path */
function hermestUrl(path) {
  return `${HERMES_BASE_URL.replace(/\/$/, "")}${path}`;
}

/** GET /v1/health — check Hermes availability */
async function healthCheck() {
  if (!HERMES_BASE_URL) return { status: "unconfigured" };
  try {
    const res = await fetch(hermestUrl("/v1/health"), { headers: hermestHeaders() });
    if (res.status === 200) return await res.json();
    if (res.status === 401) return { status: "authenticated_but_unavailable" };
    return { status: "unavailable", http_status: res.status };
  } catch (e) {
    return { status: "unavailable", error: String(e) };
  }
}

/** POST /v1/investigations — create an investigation on Hermes */
async function createInvestigation(targetType, targetValue, investigationType = "web", caseId = null) {
  if (!isConfigured()) {
    throw new Error("Hermes not configured: HERMES_BASE_URL and HERMES_API_KEY required");
  }
  const payload = {
    target: { type: targetType, value: targetValue },
    investigation_type: investigationType,
    case_id: caseId ?? null,
  };
  const res = await fetch(hermestUrl("/v1/investigations"), {
    method: "POST",
    headers: hermestHeaders(),
    body: JSON.stringify(payload),
  });
  const reqId = "r" + Math.random().toString(36).slice(2, 6);
  console.log("Hermes[" + reqId + "]: POST /v1/investigations -> " + res.status);
  if (res.status === 200 || res.status === 201) {
    return await res.json();
  }
  if (res.status === 401) throw new Error("Hermes[" + reqId + "]: auth failed");
  if (res.status === 404) throw new Error("Hermes[" + reqId + "]: endpoint not found");
  if (res.status >= 500) {
    const t = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error("Hermes[" + reqId + "]: server error " + res.status + " — " + t);
  }
  const text = await res.text();
  throw new Error("Hermes[" + reqId + "]: " + res.status + " — " + text.slice(0, 200));
}

/**
   * Verify a stored investigation ID still exists in Hermes.
   *
   * WHY THIS EXISTS
   * ---------------
   * The Base44 `HermesInvestigation` entity can hold investigation IDs whose
   * Hermes rows no longer exist. On 2026-10-05 this happened: the
   * destructive-table incident destroyed the Hermes rows for several
   * investigations, but their IDs survived in the Base44 entity. The function
   * then called POST /v1/investigations/{stale}/start and Hermes correctly
   * answered 404 investigation_not_found — the ID was real, the row was gone.
   *
   * The engine is behaving correctly here. The defect is trusting a stored ID
   * without confirming it is still live.
   *
   * ERROR HANDLING — only 404 means "stale"
   *   404  -> stale, caller should create fresh (the recoverable case)
   *   401  -> auth failure:  must NOT be treated as stale, retrying would
   *           create duplicate work while the credential is broken
   *   403  -> authorization failure: must NOT be treated as stale
   *   5xx  -> server/network: must NOT be treated as stale; the investigation
   *           may well exist and we must not create a duplicate
   *
   * So anything other than 404 propagates as an error and the existing flow
   * aborts. Only a confirmed 404 downgrades to "stale".
   *
   * @returns {Promise<{exists: boolean}>} exists=false only on a confirmed 404
   * @throws  on 401/403/5xx/network failure
   */
  async function investigationExists(investigationId) {
    const res = await fetch(hermestUrl(`/v1/investigations/${investigationId}`), {
      method: "GET",
      headers: hermestHeaders(),
    });
    const reqId = "e" + Math.random().toString(36).slice(2, 6);
    console.log("Hermes[" + reqId + "]: GET /v1/investigations/" + investigationId + " (verify) -> " + res.status);
    if (res.ok) {
      // Return the status, not just existence. Existence alone is not enough
      // to decide whether /start is legal: a COMPLETED investigation exists
      // and still must never be started again.
      const body = await res.json().catch(() => ({}));
      return { exists: true, status: body.status };
    }
    if (res.status === 404) return { exists: false };
    if (res.status === 401) throw new Error("Hermes[" + reqId + "]: auth failed");
    if (res.status === 403) throw new Error("Hermes[" + reqId + "]: authorization failed (403)");
    if (res.status >= 500) {
      const t = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error("Hermes[" + reqId + "]: server error " + res.status + " — " + t);
    }
    const text = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error("Hermes[" + reqId + "]: verify " + res.status + " — " + text);
  }

  /**
   * Start an investigation, recovering from a stale stored ID.
   *
   * Order of operations:
   *   1. GET the referenced ID. If it exists -> start it, return it unchanged.
   *      (This is what prevents duplicate creation for a valid ID.)
   *   2. If Hermes confirms 404 -> the stored ID is stale. Create a fresh
   *      investigation, start that one, and hand the caller the new ID so it
   *      can be persisted back to the Base44 entity.
   *   3. Any other error (401/403/5xx/network) propagates. We never create a
   *      replacement on an error we cannot prove means "missing", because that
   *      would duplicate work on a transient failure.
   *
   * @param {string|null} storedId  ID from the Base44 entity, may be null/stale
   * @returns {Promise<{investigation_id: string, staleRecovered: boolean, staleId: string|null}>}
   */
  async function startVerified(storedId, targetType, targetValue, investigationType, caseId) {
    // A terminal investigation can never be started again. Hermes answers 409
    // investigation_already_completed in that case, so the check has to happen
    // BEFORE the POST, using the status returned by the verification GET.
    const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED"];
    // Why the stored ID was replaced, if it was. Tracked here so the final
    // return does not need a second verification GET.
    let replacedReason = null;

    if (storedId) {
      const { exists, status } = await investigationExists(storedId);

      if (exists && TERMINAL.includes(status)) {
        // COMPLETED / FAILED / CANCELLED -> a previous run already finished.
        // A new request is an intentional new run, so create a fresh one.
        console.warn("Hermes: stored investigation " + storedId + " is " + status +
          " (terminal); creating a fresh investigation");
        replacedReason = "terminal:" + status;
      } else if (exists && status === "RUNNING") {
        // Already executing. Never POST /start again — attach to the run.
        console.log("Hermes: stored investigation " + storedId + " is RUNNING; attaching without restart");
        return { investigation_id: storedId, staleRecovered: false, staleId: null, status };
      } else if (exists) {
        // QUEUED or any other non-terminal state -> normal start behaviour.
        const started = await startInvestigation(storedId);
        return { investigation_id: storedId, staleRecovered: false, staleId: null, status: started?.status ?? status };
      } else {
        // 404: the stored ID's row is gone (destroyed table, wiped DB, ...).
        console.warn("Hermes: stored investigation " + storedId + " is stale (404); creating a fresh investigation");
        replacedReason = "stale:404";
      }
    }

    const created = await createInvestigation(targetType, targetValue, investigationType, caseId);
    const freshId = created?.investigation_id;
    if (!freshId) throw new Error("Hermes: no investigation_id returned");
    const started = await startInvestigation(freshId);
    return {
      investigation_id: freshId,
      staleRecovered: Boolean(storedId),
      staleId: storedId || null,
      status: started?.status || created?.status,
      replacedReason,
    };
  }

  /** POST /v1/investigations/{id}/start — execute the pipeline (synchronous, blocks) */
async function startInvestigation(investigationId) {
  if (!isConfigured()) {
    throw new Error("Hermes not configured");
  }
  // wait=false: SENTRA marks the investigation RUNNING and executes it on a
  // background thread, returning 202/accepted immediately. Without it the request
  // blocks for the whole pipeline (~180-195s measured), which exceeds Cloudflare's
  // edge budget and returns 524 while the work continues server-side.
  const res = await fetch(hermestUrl(`/v1/investigations/${investigationId}/start?wait=false`), {
    method: "POST",
    headers: hermestHeaders(),
  });
  const reqId2 = "s" + Math.random().toString(36).slice(2, 6);
  console.log("Hermes[" + reqId2 + "]: POST /start " + investigationId + " -> ");
  if (res.status === 200) return await res.json();
  if (res.status === 401) throw new Error("Hermes[" + reqId2 + "]: auth failed");
      if (res.status === 404) throw new Error("Hermes[" + reqId2 + "]: investigation not found");
      if (res.status === 409) {
        // The investigation already left QUEUED — a genuine race: two clicks, or
        // another caller started it between our verification GET and this POST.
        // Surface the reason instead of an opaque "start 409" so the caller can
        // tell "already completed" apart from "already running".
        let why = "already started";
        try {
          const b = await res.json();
          const d = b?.detail;
          if (typeof d === "string") why = d;
          else if (d?.message) why = d.message;
          else if (d?.code) why = d.code;
        } catch { /* body was not JSON — keep the generic message */ }
        throw new Error("Hermes[" + reqId2 + "]: start conflict (409) — " + why);
      }
  if (res.status >= 500) {
    const t = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error("Hermes[" + reqId2 + "]: server error " + res.status + " — " + t);
  }
  const text = await res.text();
  throw new Error("Hermes[" + reqId2 + "]: start " + res.status + " — " + text.slice(0, 200));
}

/** GET /v1/investigations/{id} — get investigation status */
async function getInvestigation(investigationId) {
  if (!isConfigured()) {
    throw new Error("Hermes not configured");
  }
  const res = await fetch(hermestUrl(`/v1/investigations/${investigationId}`), { headers: hermestHeaders() });
  if (res.status === 200) return await res.json();
  if (res.status === 404) throw new Error("Hermes: investigation not found");
  const text = (await res.text().catch(() => "")).slice(0, 200);
  throw new Error("Hermes get: " + res.status + " — " + text);
}

/** GET /v1/investigations/{id}/findings — get findings (array) */
async function getFindings(investigationId) {
  if (!isConfigured()) {
    throw new Error("Hermes not configured");
  }
  const res = await fetch(hermestUrl(`/v1/investigations/${investigationId}/findings`), {
    headers: hermestHeaders(),
  });
  if (res.status === 200) {
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }
  if (res.status === 404) return [];
  const text = (await res.text().catch(() => "")).slice(0, 200);
  throw new Error("Hermes findings: " + res.status + " — " + text);
}

/** GET /v1/investigations/{id}/report — get full report */
async function getReport(investigationId) {
  if (!isConfigured()) {
    throw new Error("Hermes not configured");
  }
  const res = await fetch(hermestUrl(`/v1/investigations/${investigationId}/report`), {
    headers: hermestHeaders(),
  });
  if (res.status === 200) return await res.json();
  if (res.status === 404) throw new Error("Hermes: report not found");
  const text = (await res.text().catch(() => "")).slice(0, 200);
  throw new Error("Hermes report: " + res.status + " — " + text);
}

/**
 * Run a full investigation lifecycle: create + start + poll until completion.
 * Returns the final result with findings and report.
 */
async function runInvestigation(targetType, targetValue, investigationType = "web", pollIntervalMs = 3000, maxPolls = 120, caseId = null) {
  // 1. Create
  const created = await createInvestigation(targetType, targetValue, investigationType, caseId);
  const investigationId = created.investigation_id;
  if (!investigationId) throw new Error("Hermes: no investigation_id in response");

  // 2. Start
  await startInvestigation(investigationId);

  // 3. Poll for completion
  let polls = 0;
  while (polls < maxPolls) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    polls++;
    try {
      const status = await getInvestigation(investigationId);
      const s = status.status || "";
      if (s === "COMPLETED" || s === "COMPLETED_WITH_ERRORS" || s === "FAILED" || s === "CANCELLED" || s === "TIMEOUT") {
        // 4. Fetch findings and report
        const [findings, report] = await Promise.all([
          getFindings(investigationId).catch(() => []),
          getReport(investigationId).catch(() => null),
        ]);
        return {
          investigation_id: investigationId,
          status: s,
          target: status.target || { type: targetType, value: targetValue },
          findings,
          report,
          error: status.error || null,
          completed_at: status.completed_at || null,
        };
      }
    } catch {
      // On poll error, continue (the investigation may still be running)
    }
  }

  // Timeout — fetch whatever we have
  let finalStatus: any = {};
  try {
    finalStatus = await getInvestigation(investigationId);
  } catch {
    // Ignore
  }
  const [findings, report] = await Promise.all([
    getFindings(investigationId).catch(() => []),
    getReport(investigationId).catch(() => null),
  ]);
  return {
    investigation_id: investigationId,
    status: finalStatus.status || "TIMEOUT",
    target: finalStatus.target || { type: targetType, value: targetValue },
    findings,
    report,
    error: { code: "poll_timeout", message: "Investigation did not complete within polling window" },
    completed_at: null,
  };
}

// ---------------------------------------------------------------------------
// Base44 client & auth helpers
// ---------------------------------------------------------------------------

/** Create a Base44 client from the current request.
 * Must be called per-request inside a handler, not at module level. */
function getBase44Client(req): any {
  return createClientFromRequest(req);
}

/** Extract authenticated user from Base44. Returns null if not authenticated. */
async function getUser(base44) {
  try {
    return await base44.auth.me();
  } catch {
    return null;
  }
}

/** Check if user is an admin. Follows existing SafeNestT pattern:
 *   user.role === 'admin' || user.is_admin
 * This allows access when role is 'admin' OR is_admin flag is true. */
function isAdmin(user) {
  if (!user) return false;
  return user.role === "admin" || user.is_admin === true;
}

/**
 * Authorize: check that user owns the case or is an admin.
 * Uses Base44 entities to resolve case ownership server-side.
 */
async function authorizeCaseAccess(base44, userId, caseId) {
  const user = await getUser(base44);
  if (!user) return { authorized: false, reason: "unauthenticated" };
  if (isAdmin(user)) return { authorized: true };

  // Use asServiceRole to bypass RLS for server-side authorization checks
  const sr = base44.asServiceRole;
  const entities = [
    () => sr.entities.InvestigationCase.get(caseId),
    () => sr.entities.MyCase.get(caseId),
    () => sr.entities.ClientCase.get(caseId),
    () => sr.entities.FraudCase.get(caseId),
  ];

  for (const getEntity of entities) {
    try {
      const entity = await getEntity();
      if (!entity) continue;

      // Check ownership via multiple possible fields
      const ownerId = entity.user_id || entity.userId;
      const createdBy = entity.created_by || entity.createdBy;
      const clientEmail = entity.client_email || entity.clientEmail;
      const createdByEmail = entity.created_by_email || entity.createdByEmail;

      if (ownerId && String(ownerId) === String(userId)) return { authorized: true };
      if (createdBy && createdBy.toLowerCase() === (user.email || "").toLowerCase()) return { authorized: true };
      if (clientEmail && clientEmail.toLowerCase() === (user.email || "").toLowerCase()) return { authorized: true };
      if (createdByEmail && createdByEmail.toLowerCase() === (user.email || "").toLowerCase()) return { authorized: true };
    } catch {
      // Entity doesn't exist or error — try next
    }
  }

  return { authorized: false, reason: "not_a_case_member" };
}

/** Extract investigative targets from a case entity.
 * Returns { type, value } or null if no external target found.
 * Priority: wallet > domain > email > ip > phone > null (narrative-only) */
function extractTargetsFromCase(entity) {
  if (!entity || typeof entity !== "object") return null;

  // Wallet addresses (highest priority — blockchain investigation)
  const wallets = (
    entity.scammer_wallet
      ? [entity.scammer_wallet]
      : (entity.wallet_addresses || [])
      || (entity.crypto_wallet_addresses || [])
      || []
  ).filter(Boolean);
  for (const w of wallets) {
    const wNet = detectWalletNetwork(w);
    if (wNet) {
      return { type: "wallet", value: w, blockchain: wNet };
    }
  }

  // Domain / website targets
  const domains = [
    ...((entity.websites_platforms || []) as string[]).filter(Boolean),
    ...(entity.victim_website ? [entity.victim_website] : []),
    ...(entity.scammer_website ? [entity.scammer_website] : []),
  ];
  for (const d of domains) {
    if (typeof d === "string" && /^[a-zA-Z0-9][-a-zA-Z0-9\.]*\.[a-zA-Z]{2,}$/.test(d)) {
      return { type: "domain", value: d };
    }
  }

  // Email addresses
  const emails = [
    ...(entity.alleged_actor_information?.email_addresses || []) as string[],
    ...(entity.known_emails || []) as string[],
    entity.victim_email,
    entity.client_email,
    entity.complainant_email,
  ].filter(Boolean);
  for (const e of emails) {
    if (typeof e === "string" && e.includes("@")) {
      return { type: "email", value: e };
    }
  }

  // IP addresses
  const ips = [
    ...(entity.alleged_actor_information?.ip_addresses || []) as string[],
    entity.victim_ip,
    entity.scammer_ip,
  ].filter(Boolean);
  for (const ip of ips) {
    if (typeof ip === "string" && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
      return { type: "ip", value: ip };
    }
  }

  // Phone numbers
  const phones = [
    ...(entity.alleged_actor_information?.phone_numbers || []) as string[],
    entity.victim_phone,
    entity.client_phone,
    entity.complainant_phone,
  ].filter(Boolean);
  for (const p of phones) {
    if (typeof p === "string" && p.replace(/[^\d+]/g, "").length >= 7) {
      return { type: "phone", value: p };
    }
  }

  return null; // No external target — narrative-only case
}

/**
 * Detect whether a string looks like a case number rather than a real
 * investigation target (domain, IP, URL, wallet, email, phone).
 *
 * Case numbers in SafeNestT follow patterns like:
 *   IC-2024-001, CASE-2024-001, INV-2024-ABCD
 * i.e. an alphabetic prefix, a hyphen, then digits, with optional further
 * hyphen-separated segments.
 *
 * This function is deliberately conservative: it only returns true for
 * strings that match the case-number pattern AND do NOT look like any
 * known network/crypto target. Everything else (including plain
 * Base44 entity IDs) returns false so legitimate targets are never
 * misclassified.
 */
function isCaseNumberLike(val: unknown): boolean {
  if (typeof val !== "string") return false;
  const s = val.trim();
  if (!s) return false;
  // Bail early on anything that is unmistakably a network/crypto target.
  if (/[:@.]/.test(s)) return false;            // URL, domain, IP, email
  if (/^0x[0-9a-f]*$/i.test(s)) return false;  // Ethereum / generic hex address
  if (/^bc1[ac-hj-np-z02-9]+$/i.test(s)) return false; // Bitcoin bech32
  if (/^T[1-9A-HJ-NP-Za-km-z]{33,34}$/.test(s)) return false; // Tron T-address
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return false; // IPv4
  if (s.length < 4) return false;
  // Case numbers contain a hyphen, at least one letter, and at least one digit,
  // and are not network/crypto targets (already filtered above).
  // e.g. IC-2024-001, CASE-2024-001, eqt5y-collectibles-1, INV-2024-ABCD
  // Domains (have .), IPs (digits+dots), URLs (have :), emails (have @),
  // and crypto wallets (0x/bc1/T-prefix) are all rejected earlier.
  // Plain IDs without hyphens (e.g. Base44 entity IDs) are rejected here.
  return s.includes("-") && /[A-Za-z]/.test(s) && /\d/.test(s);
}

/** Detect blockchain network from wallet address format. */
function detectWalletNetwork(address) {
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return "ethereum";
  if (/^(1|3)[a-zA-Z0-9]{25,34}$|^bc1[a-zA-Z0-9]{39,59}$/.test(address)) return "bitcoin";
  if (/^T[a-zA-Z0-9]{33}$/.test(address)) return "tron";
  if (/^0x[a-fA-F0-9]{40}$/.test(address)) return "ethereum";
  return null;
}
async function resolveCaseEntity(base44, caseId) {
  const sr = base44.asServiceRole;
  // Try all supported entity types with service-role bypass (avoids RLS blocking server-side lookups)
  const candidates = [
    sr.entities.InvestigationCase.get(caseId),
    sr.entities.MyCase.get(caseId),
    sr.entities.ClientCase.get(caseId),
    sr.entities.FraudCase.get(caseId),
  ];
  for (const promise of candidates) {
    try {
      const entity = await promise;
      if (entity) return entity;
    } catch {
      // Continue to next
    }
  }
  return null;
}

/** Resolve case by case_number across all entity types (service-role bypass). */
async function resolveCaseByCaseNumber(base44, caseNumber) {
  const sr = base44.asServiceRole;
  const candidates = [
    sr.entities.InvestigationCase.list({ filter: { case_number: caseNumber } }),
    sr.entities.MyCase.list({ filter: { case_number: caseNumber } }),
    sr.entities.ClientCase.list({ filter: { case_number: caseNumber } }),
    sr.entities.FraudCase.list({ filter: { case_number: caseNumber } }),
  ];
  for (const promise of candidates) {
    try {
      const results = await promise;
      if (results && results.length > 0) return results[0];
    } catch {
      // Continue
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mapping helpers: Hermes → Base44
// ---------------------------------------------------------------------------

/** Map Hermes finding_type to Base44 CaseEvidenceItem.category */
function mapFindingTypeToCategory(findingType: string, ev: Record<string, unknown>): string {
  const t = (findingType || "").toUpperCase();
  if (t === "VERIFIED_EVIDENCE") return "evidence";
  if (t === "EXTERNAL_INTELLIGENCE") return "external_intelligence";
  if (t === "AI_INFERENCE") return "ai_inference";
  if (t === "INVESTIGATOR_CONCLUSION") return "conclusion";
  if (ev?.source?.toString().endsWith("_api")) return "external_intelligence";
  return "supporting";
}

/** Map Hermes confidence (0.0–1.0) to Base44 low/medium/high. */
function mapConfidence(c: number): "low" | "medium" | "high" {
  if (c == null || c <= 0) return "low";
  if (c < 0.5) return "low";
  if (c < 0.75) return "medium";
  return "high";
}

/** Build Base44 CaseEvidenceItem.data from a Hermes finding+evidence pair. */
function mapEvidenceData(
  finding: Record<string, unknown>,
  ev: Record<string, unknown>,
  findingType: string,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  if (finding.title) data.title = String(finding.title);
  if (finding.description) data.description = String(finding.description);
  if (finding.detail && typeof finding.detail === "object") data.detail = finding.detail;
  if (finding.claim) data.claim = String(finding.claim);
  if (finding.source) data.source = String(finding.source);
  if (finding.provider) data.provider = String(finding.provider);
  if (finding.target) data.target = finding.target;
  if (finding.indicator) data.indicator = finding.indicator;
  if (finding.indicator_type) data.indicator_type = String(finding.indicator_type);
  if (finding.confidence != null) data.confidence = typeof finding.confidence === "number" ? finding.confidence : parseFloat(String(finding.confidence)) || 0;

  // Preserve evidence-level metadata (provider run info, provenance, timestamps)
  if (ev.provider_run_id) data.provider_run_id = String(ev.provider_run_id);
  if (ev.run_id) data.provider_run_id = String(ev.run_id);
  if (ev.source && !data.source) data.source = String(ev.source);
  if (ev.provider && !data.provider) data.provider = String(ev.provider);
  if (ev.source_type) data.source_type = String(ev.source_type);
  if (ev.target) data.target = ev.target;
  if (typeof ev.confidence === "number") data.evidence_confidence = ev.confidence;
  if (ev.collected_at) data.collected_at = String(ev.collected_at);
  if (ev.source_timestamp) data.source_timestamp = String(ev.source_timestamp);
  if (ev.evidence_refs && Array.isArray(ev.evidence_refs)) data.evidence_refs = ev.evidence_refs;
  if (ev.entity_refs && Array.isArray(ev.entity_refs)) data.entity_refs = ev.entity_refs;
  if (ev.indicator_refs && Array.isArray(ev.indicator_refs)) data.indicator_refs = ev.indicator_refs;

  // Preserve full provenance object
  if (finding.provenance || ev.provenance) {
    data.provenance = finding.provenance || ev.provenance;
  }

  // Preserve finding metadata
  if (finding.metadata && typeof finding.metadata === "object") data.metadata = finding.metadata;

  return data;
}

// ---------------------------------------------------------------------------
// Entity graph persistence
// ---------------------------------------------------------------------------

/** Parent an entity graph from Hermes findings into Base44 GraphNode/GraphEdge. */
async function persistEntityGraph(
  base44: any,
  caseId: string,
  hermesInvestigationId: string,
  findings: Array<Record<string, unknown>>,
  evidenceArray: Array<Record<string, unknown>> = [],
) {
  for (const finding of findings) {
    const ftype = String(finding.finding_type || finding.type || "");
    const target: any = finding.target;
    const evidenceIds = (finding.evidence_ids || finding.evidence || []) as string[];

    // Find the source entity for this finding
    let sourceName = String(finding.source || "");
    let sourceType = "finding";
    let sourceId = String(finding.source_entity_id || "");
    if (ftype === "EXTERNAL_INTELLIGENCE" && finding.provider) {
      sourceType = "external_intelligence";
    }
    if (ftype === "VERIFIED_EVIDENCE") {
      sourceType = "evidence";
    }

    // Build evidence node if evidence exists in the passed evidenceArray
    for (const evId of evidenceIds) {
      const ev = evidenceArray.find((e: any) => String(e.evidence_id || e.evidenceId || "") === evId) || null;
      if (ev && typeof ev === "object") {
        const evNodeId = `gn-ev-${hermesInvestigationId}-${evId.slice(0, 12)}`;
        try {
          await base44.asServiceRole.entities.GraphNode.create({
            id: evNodeId,
            case_id: caseId,
            node_type: "evidence",
            label: String(ev.title || ev.description || ev.source || finding.title || "Evidence")?.slice(0, 200),
            node_data: {
              evidence_id: ev.evidence_id || ev.evidenceId,
              provider: ev.provider || finding.provider,
              source: ev.source || finding.source,
              source_type: ev.source_type || "tool",
              confidence: typeof ev.confidence === "number" ? ev.confidence : (finding.confidence as number) || 0,
              source_timestamp: ev.source_timestamp || finding.source_timestamp || null,
              collected_timestamp: ev.collected_at || finding.collected_at || new Date().toISOString(),
              metadata: ev,
              finding_type: ftype,
              hermes_investigation_id: hermesInvestigationId,
            },
            entity_id: caseId,
          }).catch(() => {});
        } catch {}
      }
    }

    // Build finding node
    const findingNodeId = `gn-fnd-${hermesInvestigationId}-${String(finding.id || "").slice(0, 12)}`;
    try {
      await base44.asServiceRole.entities.GraphNode.create({
        id: findingNodeId,
        case_id: caseId,
        node_type: "finding",
        label: String(finding.title || finding.claim || "Finding")?.slice(0, 200),
        node_data: {
          finding_id: finding.id,
          finding_type: ftype,
          category: mapFindingTypeToCategory(ftype, finding),
          confidence: typeof finding.confidence === "number" ? finding.confidence : parseFloat(String(finding.confidence)) || 0,
          target: target,
          source: sourceName,
          source_type: sourceType,
          provider: finding.provider || null,
          evidence_ids: evidenceIds,
          hermes_investigation_id: hermesInvestigationId,
          created_at: new Date().toISOString(),
        },
        entity_id: caseId,
      }).catch(() => {});
    } catch {}

    // Build entity node from finding target/indicator
    if (target) {
      const targetId = String(target.id || target.type || target);
      const nodeId = `gn-enty-${hermesInvestigationId}-${targetId.slice(0, 12)}`;
      try {
        await base44.asServiceRole.entities.GraphNode.create({
          id: nodeId,
          case_id: caseId,
          node_type: "entity",
          label: String(target.name || target.value || targetId).slice(0, 200),
          node_data: {
            entity_id: targetId,
            entity_type: String(target.type || target.entity_type || "unknown"),
            value: target.value || target.name || targetId,
            indicator: target.indicator || null,
            indicator_type: target.indicator_type || null,
            hermes_investigation_id: hermesInvestigationId,
          },
          entity_id: caseId,
        }).catch(() => {});
      } catch {}
    }
  }

  // Build edges: finding ↔ evidence, finding ↔ entity
  for (const finding of findings) {
    const findingNodeId = `gn-fnd-${hermesInvestigationId}-${String(finding.id || "").slice(0, 12)}`;
    const evidenceIds = (finding.evidence_ids || finding.evidence || []) as string[];
    const target: any = finding.target;
    const ftype = String(finding.finding_type || finding.type || "");

    // Edge: finding → evidence nodes
    for (const evId of evidenceIds) {
      const evNodeId = `gn-ev-${hermesInvestigationId}-${evId.slice(0, 12)}`;
      try {
        await base44.asServiceRole.entities.GraphEdge.create({
          id: `ge-fe-${hermesInvestigationId}-${evId.slice(0, 12)}`,
          case_id: caseId,
          source_node_id: findingNodeId,
          target_node_id: evNodeId,
          edge_type: "supported_by",
          edge_label: "finding_supports_evidence",
          edge_data: {
            finding_id: finding.id,
            evidence_id: evId,
            finding_type: ftype,
            hermes_investigation_id: hermesInvestigationId,
          },
          entity_id: caseId,
        }).catch(() => {});
      } catch {}
    }

    // Edge: finding → entity node
    if (target) {
      const targetId = String(target.id || target.type || target);
      const entityNodeId = `gn-enty-${hermesInvestigationId}-${targetId.slice(0, 12)}`;
      try {
        await base44.asServiceRole.entities.GraphEdge.create({
          id: `ge-fent-${hermesInvestigationId}-${targetId.slice(0, 12)}`,
          case_id: caseId,
          source_node_id: findingNodeId,
          target_node_id: entityNodeId,
          edge_type: "about",
          edge_label: "finding_related_to_entity",
          edge_data: {
            finding_id: finding.id,
            entity_id: targetId,
            finding_type: ftype,
            hermes_investigation_id: hermesInvestigationId,
          },
          entity_id: caseId,
        }).catch(() => {});
      } catch {}
    }

    // Edge: evidence → entity node (for provider-backed evidence)
    for (const evId of evidenceIds) {
      const evNodeId = `gn-ev-${hermesInvestigationId}-${evId.slice(0, 12)}`;
      const ev = evidenceArray.find((e: any) => String(e.evidence_id || e.evidenceId || "") === evId) || null;
      if (ev && typeof ev === "object" && target) {
        const targetId = String(target.id || target.type || target);
        const entityNodeId = `gn-enty-${hermesInvestigationId}-${targetId.slice(0, 12)}`;
        try {
          await base44.asServiceRole.entities.GraphEdge.create({
            id: `ge-eent-${hermesInvestigationId}-${targetId.slice(0, 12)}-${String(ev.evidence_id || "").slice(0, 8)}`,
            case_id: caseId,
            source_node_id: evNodeId,
            target_node_id: entityNodeId,
            edge_type: "supports",
            edge_label: "evidence_supports_entity",
            edge_data: {
              evidence_id: ev.evidence_id || ev.evidenceId,
              provider: ev.provider || finding.provider,
              source: ev.source || finding.source,
              finding_type: ftype,
              hermes_investigation_id: hermesInvestigationId,
            },
            entity_id: caseId,
          }).catch(() => {});
        } catch {}
      }
    }
  }
}

/** Ensure HermesInvestigation entity exists in Base44. Creates it if needed. */
async function ensureHermesEntity(base44) {
  try {
    const existing = await base44.entities.HermesInvestigation.list(null, 1);
    if (existing && existing.length > 0) return base44.entities.HermesInvestigation;
  } catch {
    // Entity doesn't exist yet
  }

  try {
    await base44.asServiceRole.entities.HermesInvestigation.create({
      name: "Hermes Investigation Bridge Entity",
      description: "Stores Hermes investigation results linked to SafeNestT cases",
      created_at: new Date().toISOString(),
    });
    return base44.entities.HermesInvestigation;
  } catch (e) {
    console.error("Failed to create HermesInvestigation entity:", e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST /api/hermes/start — Start an investigation
// ---------------------------------------------------------------------------

async function handleStart(req) {
  const base44 = getBase44Client(req);
  const user = await getUser(base44);
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Parse request body or function invocation params
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Handle function-style invocation (Base44 compat layer passes _action)
  const action = body._action;
  if (action === "status") {
    const investigationId = body.id || body.investigation_id;
    if (!investigationId) {
      return Response.json({ error: "investigation_id is required" }, { status: 400 });
    }
    return handleStatusGet(base44, user, investigationId);
  }
  if (action === "health") {
    return handleHealthGet();
  }

  const caseId = body.case_id || body.caseId || body.case_number;
  const targetType = body.target_type || body.targetType || body.target?.type || "domain";
  const targetValue = body.target_value || body.targetValue || body.target?.value;
  const investigationType = body.investigation_type || body.investigationType || body.type || "web";
  const waitForCompletion = body.wait_for_completion === true;
  // Run-scoped identifiers resolved from the request body; `run_id` is
  // nullable (null until InvestigationRun exists), `jurisdiction` defaults to null.
  const run_id = body.run_id || null;
  const jurisdiction = body.jurisdiction || null;

  if (!caseId) {
    return Response.json({ error: "case_id is required" }, { status: 400 });
  }
  // targetValue is optional — if missing, we'll extract from case data below

  // --- Security: authorize case access ---
  const access = await authorizeCaseAccess(base44, user.id, caseId);
  if (!access.authorized) {
    console.warn(`Hermes start denied: user=${user.id || "unknown"} case=${caseId} reason=${access.reason}`);
    if (access.reason === "unauthenticated") {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    return Response.json(
      { error: "You do not have access to this case", detail: access.reason },
      { status: 403 }
    );
  }

  // --- Verify case exists (lookup by id across all entity types, then by case_number) ---
  let caseEntity = await resolveCaseEntity(base44, caseId);
  if (!caseEntity) {
    // Try case_number lookup across ALL entity types
    const byNumber = await resolveCaseByCaseNumber(base44, caseId);
    if (byNumber) {
      caseEntity = byNumber;
      console.log(`Hermes: found case by case_number: ${caseId} -> id=${caseEntity.id} type=${caseEntity._entityName || 'unknown'}`);
    }
  }
  if (!caseEntity) {
    return Response.json({ error: "Case not found" }, { status: 404 });
  }

  // --- Check Hermes configuration ---
  if (!isConfigured()) {
    console.error("Hermes not configured: missing HERMES_BASE_URL or HERMES_API_KEY");
    return Response.json(
      { error: "Investigation engine not configured", detail: "Contact your administrator" },
      { status: 503 }
    );
  }

  // --- Target extraction: if targetValue is empty or looks like a case_number, extract real targets from case data ---
  let effectiveTargetType = targetType;
  let effectiveTargetValue = targetValue;
  let targetSource = "explicit";

  if (!targetValue || targetValue.trim() === "" || isCaseNumberLike(targetValue)) {
    // No valid target provided or looks like a case_number — try to extract from case data
    if (caseEntity) {
      const extracted = extractTargetsFromCase(caseEntity);
      if (extracted) {
        effectiveTargetType = extracted.type;
        effectiveTargetValue = extracted.value;
        targetSource = "extracted_from_case";
        console.log(`Hermes: extracted target from case ${caseId}: type=${effectiveTargetType} value=${effectiveTargetValue}`);
      }
    }
    if (!effectiveTargetValue || isCaseNumberLike(effectiveTargetValue)) {
      // Still no external target — use case description as narrative target
      const description = caseEntity?.description || caseEntity?.client_name || caseEntity?.case_number || "";
      if (description && description.trim()) {
        effectiveTargetType = "narrative";
        effectiveTargetValue = description.slice(0, 2000);
        targetSource = "narrative_only";
        console.log(`Hermes: no external target for case ${caseId}, using narrative mode (${effectiveTargetValue.slice(0, 80)}...)`);
      }
    }
  }

  // --- Idempotency: check if we already have a pending/active investigation for this case ---
  const hermesEntity = await ensureHermesEntity(base44);
  if (hermesEntity) {
    try {
      const pending = await hermesEntity.filter({
        case_id: caseId,
        status: { $in: ["QUEUED", "RUNNING"] },
      }).catch(() => []);
      if (pending.length > 0) {
        const existing = pending[0];
        return Response.json({
          success: true,
          case_id: caseId,
          hermes_investigation_id: existing.hermes_investigation_id,
          status: existing.status,
          message: "Investigation already in progress",
          idempotent: true,
          result: existing.result ? JSON.parse(existing.result) : null,
        });
      }
    } catch {
      // If filter fails, continue with new investigation
    }
  }

  // --- Create Hermes investigation ---
  let hermesInvestigationId = null;
  let hermesStatus = "UNKNOWN";
  let hermesResult = null;
  let error = null;

  try {
    if (waitForCompletion) {
      console.log(`Hermes: running full investigation for case=${caseId} target=${effectiveTargetValue} type=${effectiveTargetType} (source: ${targetSource})`);
      hermesResult = await runInvestigation(effectiveTargetType, effectiveTargetValue, investigationType, 3000, 120, caseId);
      hermesInvestigationId = hermesResult.investigation_id;
      hermesStatus = hermesResult.status;
    } else {
      console.log(`Hermes: creating investigation for case=${caseId} target=${effectiveTargetValue} type=${effectiveTargetType} (source: ${targetSource})`);
      const created = await createInvestigation(effectiveTargetType, effectiveTargetValue, investigationType, caseId);
      hermesInvestigationId = created.investigation_id;
      if (!hermesInvestigationId) {
        throw new Error("Hermes: no investigation_id returned");
      }
      await startInvestigation(hermesInvestigationId);
      hermesStatus = "QUEUED";

      // ── Dateno enrichment (synchronous within this request, fault-isolated) ──
      // Runs server-side ONLY; never breaks the primary investigation.
      // Keeps the existing base44/functions/dateno-enrich/entry.ts function as the
      // canonical enrichment function. Writes run-scoped Dataledger records.
      if (effectiveTargetType && effectiveTargetValue) {
        try {
          const enrichmentResult = await base44.functions.invoke(
            "dateno-enrich",
            {
              case_id: caseId,
              investigation_id: hermesInvestigationId,
              run_id: run_id,
              target: effectiveTargetValue,
              target_type: effectiveTargetType,
              strategy: "controlled",
              jurisdiction: jurisdiction,
            }
          );
          // dateno-enrich is fault-isolated: it returns { ok:true, data, warnings }
          // even on API failure, timeout, missing key, or crash. Never an error here.
          if (enrichmentResult && typeof enrichmentResult === 'object') {
            const warnings = enrichmentResult.warnings || [];
            const data = enrichmentResult.data || {};
            if (Array.isArray(warnings) && warnings.length) {
              console.log(`Dateno enrichment warnings: ${warnings.join('; ')}`);
            }
            console.log(`Dateno enrichment: ${data.total || 0} record(s) retrieved`);
          }
        } catch (e) {
          // Dateno must NEVER fail the primary investigation.
          // Catch here so an unexpected dateno-enrich crash does not propagate.
          console.log("Dateno enrichment failed (isolated):", String(e?.message || e));
        }
      }

    }
  } catch (e) {
    error = { code: e.name || "error", message: e.message };
    console.error(`Hermes error for case=${caseId}:`, e.message);
  }

  // --- Persist results to Base44 ---
  if (hermesEntity && hermesInvestigationId && hermesResult) {
  try {
  const now = new Date().toISOString();
  const caseEntityTypeId = caseEntity.id ? (caseEntity._entityName || caseEntity.entityType || "MyCase") : "MyCase";
  const recordData = {
    case_id: caseId,
    case_entity_type: caseEntityTypeId,
    case_number: (caseEntity?.case_number || caseId),
    user_id: user.id,
    user_email: user.email,
    hermes_investigation_id: hermesInvestigationId,
    target_type: effectiveTargetType,
    target_value: effectiveTargetValue,
    investigation_type: investigationType,
    status: hermesStatus || "UNKNOWN",
    started_at: now,
    completed_at: hermesResult?.completed_at || null,
    findings_count: hermesResult?.findings?.length || 0,
    error: error ? JSON.stringify(error) : null,
    result: hermesResult ? JSON.stringify(hermesResult) : null,
        metadata: JSON.stringify({
          source: "hermes-bridge",
          triggered_by: user.email,
          target_type: targetType,
          target_value: effectiveTargetValue,
        }),
      };

      // Idempotent upsert: update if exists, create if not
      try {
        const existing = await hermesEntity.get(hermesInvestigationId);
        if (existing) {
          await hermesEntity.update(hermesInvestigationId, recordData);
        } else {
          await hermesEntity.create({ ...recordData, id: hermesInvestigationId });
        }
      } catch (e) {
        // If upsert fails (e.g. entity doesn't support get by custom id), try create
        try {
          await hermesEntity.create({ ...recordData, id: hermesInvestigationId });
        } catch (e2) {
          console.error("Failed to persist Hermes result:", e2.message);
        }
      }

      // --- Persist evidence items from findings that have evidence ---
      const findings = hermesResult?.findings || [];
      for (const finding of findings) {
        const findingType = finding.finding_type || finding.type || "";
        // Only create evidence items for findings that have evidence_ids
        const evidenceIds = finding.evidence_ids || finding.evidence || [];
        if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) continue;

        for (const evId of evidenceIds) {
          // Look up the evidence in the evidence array (if present)
          const evidenceArray = hermesResult?.evidence || [];
          const ev = evidenceArray.find((e: any) => e.evidence_id === evId || e.evidenceId === evId);
          if (!ev) continue;

          // Map finding type to Base44 CaseEvidenceItem category
          const category = mapFindingTypeToCategory(findingType, ev);
          // Map confidence 0-1 to Base44 low/medium/high
          const confidence = mapConfidence(finding.confidence || ev.confidence || 0);

          try {
            await base44.asServiceRole.entities.CaseEvidenceItem.create({
              id: `ev-${hermesInvestigationId}-${evId.slice(0, 12)}`,
              case_id: caseId,
              evidence_file_id: ev.id || null,
              category,
              data: mapEvidenceData(finding, ev, findingType),
              source: "extracted",
              confidence,
              relevance: findingType === "VERIFIED_EVIDENCE" ? "primary" : "supporting",
              analyst_note: `${findingType}: ${finding.title || finding.claim || ""}`.slice(0, 500),
              status: "confirmed",
            }).catch((e: unknown) => console.warn("Evidence item create warning:", e));
          } catch (e) {
            console.warn("Failed to create evidence item:", e);
          }
        }
      }

      // --- Update case with evidence count ---
      const evidenceCount = findings.reduce((acc: number, f: any) => {
        const eids = f.evidence_ids || f.evidence || [];
        return acc + (Array.isArray(eids) ? eids.length : 0);
      }, 0);
      if (evidenceCount > 0) {
        await base44.asServiceRole.entities.InvestigationCase.update(caseEntity.id, {
          evidence_count: evidenceCount,
        }).catch(() => {});
      }

      // Also update the case entity with investigation reference
      if (caseEntity && caseEntity.id) {
        try {
          const updateData: Record<string, unknown> = {
            hermes_investigation_id: hermesInvestigationId,
            hermes_status: hermesStatus || "UNKNOWN",
            last_activity: now,
          };
          if (hermesResult?.findings?.length) {
            updateData.findings_count = hermesResult.findings.length;
          }
          if (hermesResult?.report) {
            updateData.hermes_report = JSON.stringify(hermesResult.report);
          }
          await base44.asServiceRole.entities.InvestigationCase.update(caseEntity.id, updateData).catch(() => {});
        } catch {
          // Non-critical
        }
      }

      // --- Persist entity graph from findings ---
    // DUPLICATE DECLARATION REMOVED (2026-10-04): `findings` is already
    // declared above at line 903 in this same function scope. Same value.
      if (findings.length > 0) {
        try {
          await persistEntityGraph(base44, caseId, hermesInvestigationId, findings as any, hermesResult?.evidence || []);
        } catch (e) {
          console.warn("Graph persistence non-critical:", e);
        }
      }
    } catch (e) {
      console.error("Error persisting Hermes result:", e.message);
    }
  }

  // --- Return response ---
  return Response.json({
    success: true,
    case_id: caseId,
    hermes_investigation_id: hermesInvestigationId || null,
    status: hermesStatus || "UNKNOWN",
    error: error || null,
    result: hermesResult || null,
    waitForCompletion,
  });
}

// ---------------------------------------------------------------------------
// GET /api/hermes/status — Get investigation status
// Called as: handleStatusGet(base44, user, investigationId) — used by both HTTP GET and function invocation
// ---------------------------------------------------------------------------

async function handleStatusGet(base44, user, investigationId) {
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!investigationId) {
    return Response.json({ error: "investigation_id is required" }, { status: 400 });
  }

  // --- Security: verify user has access to this investigation ---
  try {
    const hermesEntity = await ensureHermesEntity(base44);
    if (hermesEntity) {
      const records = await hermesEntity.filter({ hermes_investigation_id: investigationId }).catch(() => []);
      if (records.length > 0) {
        const record = records[0];
        const caseId = record.case_id;
        if (caseId) {
          const access = await authorizeCaseAccess(base44, user.id, caseId);
          if (!access.authorized) {
            return Response.json({ error: "Access denied to this investigation" }, { status: 403 });
          }
        }
      }
    }
  } catch {
    if (!isAdmin(user)) {
      console.warn(`Hermes status: could not verify access for user=${user.id} inv=${investigationId}`);
    }
  }

  // --- Fetch from Hermes ---
  if (!isConfigured()) {
    return Response.json({ error: "Investigation engine not configured" }, { status: 503 });
  }

  try {
    const statusResult = await getInvestigation(investigationId);
    const findings = await getFindings(investigationId).catch(() => []);
    const report = await getReport(investigationId).catch(() => null);

    return Response.json({
      success: true,
      investigation_id: investigationId,
      status: statusResult.status || "UNKNOWN",
      target: statusResult.target || null,
      findings_count: findings.length,
      findings: findings.slice(0, 50),
      report: report || null,
      error: statusResult.error || null,
      completed_at: statusResult.completed_at || null,
    });
  } catch (e) {
    return Response.json({ error: e.message, investigation_id: investigationId }, { status: 502 });
  }
}

// ---------------------------------------------------------------------------
// GET /api/hermes/health — Check Hermes engine health
// Called as: handleHealthGet() — used by both HTTP GET and function invocation
// ---------------------------------------------------------------------------

async function handleHealthGet() {
  if (!isConfigured()) {
    return Response.json({
      status: "unconfigured",
      detail: "HERMES_BASE_URL and/or HERMES_API_KEY not set",
    });
  }
  const health = await healthCheck();
  return Response.json(health);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const PORT = parseInt(Deno.env.get("PORT") || "8080", 10);

Deno.serve({ port: PORT }, async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Parse body (needed for both path-based and body-based routing)
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    // Not JSON — might be path-based GET
  }

  // === BODY-BASED ROUTING (Base44 functions.invoke) ===
  // POST with JSON body — handle by _action or investigation params
  if (req.method === "POST" && body && typeof body === "object") {
    if (body._action === "health") {
      return handleHealthGet();
    }
    if (body._action === "status") {
      const b4 = getBase44Client(req);
      const u = await getUser(b4);
      const iid = body.id || body.investigation_id;
      if (!iid) return Response.json({ error: "investigation_id required" }, { status: 400 });
      return handleStatusGet(b4, u, iid);
    }
    // No _action but has case params → start investigation
    if (body.case_id || body.caseId || body.case_number) {
      const b4 = getBase44Client(req);
      const u = await getUser(b4);
      if (!u) return Response.json({ error: "Unauthorized" }, { status: 401 });

      const caseId = body.case_id || body.caseId || body.case_number;
      const targetType = body.target_type || body.targetType || body.target?.type || "domain";
      const targetValue = body.target_value || body.targetValue || body.target?.value;

      if (!caseId) return Response.json({ error: "case_id is required" }, { status: 400 });

      // --- Resolve case (service-role bypass) ---
      const caseEntity = await resolveCaseEntity(b4, caseId);
      if (!caseEntity) return Response.json({ error: "Case not found" }, { status: 404 });

      // --- Target extraction: if no explicit target, extract from case data ---
      let effectiveTargetType = targetType;
      let effectiveTargetValue = targetValue;
      let targetSource = "explicit";
      if (!targetValue || targetValue.trim() === "" || isCaseNumberLike(targetValue)) {
        const extracted = extractTargetsFromCase(caseEntity);
        if (extracted) {
          effectiveTargetType = extracted.type;
          effectiveTargetValue = extracted.value;
          targetSource = "extracted_from_case";
        } else {
          effectiveTargetType = "narrative";
          effectiveTargetValue = (caseEntity.description || caseEntity.client_name || caseEntity.case_number || "").slice(0, 2000);
          targetSource = "narrative_only";
        }
      }

      if (!effectiveTargetValue || isCaseNumberLike(effectiveTargetValue)) return Response.json({ error: "No target or case data available" }, { status: 400 });
      const investigationType = body.investigation_type || body.investigationType || body.type || "web";
      // Default is now ASYNC: the function creates the investigation, starts it with
      // wait=false, and returns the investigation_id immediately. Polling SENTRA for
      // up to 6 minutes inside a serverless invocation is what the async start exists
      // to avoid. Callers that explicitly want the blocking behaviour opt in with
      // wait_for_completion=true (statuses are then observed via /api/hermes/status).
      const waitForCompletion = body.wait_for_completion === true;

      const access = await authorizeCaseAccess(b4, u.id, caseId);
      if (!access.authorized) {
        console.warn(`Hermes start denied: user=${u.id} case=${caseId} reason=${access.reason}`);
        return access.reason === "unauthenticated"
          ? Response.json({ error: "Unauthorized" }, { status: 401 })
          : Response.json({ error: "Access denied", detail: access.reason }, { status: 403 });
      }

      // DUPLICATE DECLARATION REMOVED (2026-10-04): caseEntity is already
      // resolved above at line 1119 in this same function scope. The second
      // `const caseEntity` made this a redeclaration error and blocked the
      // bundle, so the function could not be deployed at all.
      if (!caseEntity) return Response.json({ error: "Case not found" }, { status: 404 });

      if (!isConfigured()) {
        console.error("Hermes not configured");
        return Response.json({ error: "Investigation engine not configured" }, { status: 503 });
      }

      const hermesEntity = await ensureHermesEntity(b4);
      // Resolve any ID already stored for this case and confirm it is still live
      // in Hermes before trusting it. A stored ID whose Hermes row was destroyed
      // answers 404 here and is replaced, instead of being POSTed to /start.
      //
      // This replaces the previous "existingInv" short-circuit, which returned
      // `existingInv.id` — the Base44 ENTITY row id, not the Hermes
      // investigation id — and never verified the row still existed.
      let storedId = null;
      if (hermesEntity) {
        try {
          const linked = await hermesEntity.list({ filter: { case_id: caseId } });
          if (linked?.length > 0) {
            const latest = linked[0];
            storedId = latest.hermes_investigation_id || null;
          }
        } catch {}
      }

      console.log(`Hermes: start request for case=${caseId} storedId=${storedId || "none"}`);
      // Verify-then-start. Creates only when there is no stored ID, or the
      // stored one is confirmed stale by a 404 from Hermes.
      const outcome = await startVerified(
        storedId,
        effectiveTargetType,
        effectiveTargetValue,
        investigationType,
        caseId,
      );
      const invId = outcome.investigation_id;
      const invStatus = outcome.status || "queued";
      if (outcome.staleRecovered) {
        console.warn("Hermes: recovered from stale investigation " + outcome.staleId + " -> " + invId);
      }

      // Persist to HermesInvestigation entity. When a stale ID was replaced,
      // clear the old row and store the new valid ID so the next invocation
      // finds a live reference. The stale row is marked, never deleted.
      if (hermesEntity) {
        try {
          if (outcome.staleRecovered && outcome.staleId) {
            await hermesEntity.list({ filter: { case_id: caseId } })
              .then((rows) => Promise.all((rows || []).map((r) =>
                r.hermes_investigation_id === outcome.staleId
                  ? hermesEntity.update(r.id, { status: "stale", hermes_investigation_id: null })
                  : Promise.resolve()
              )))
              .catch((e: unknown) => console.warn("Stale-row update warning:", e));
          }
          await hermesEntity.create({
            case_id: caseId,
            case_number: (caseEntity?.case_number || caseId),
            hermes_investigation_id: invId,
            status: invStatus,
            target_type: effectiveTargetType,
            target_value: effectiveTargetValue,
            investigation_type: investigationType,
            source: targetSource,
          }).catch((e: unknown) => console.warn("Persist warning:", e));
        } catch (e) { console.warn("Persist error:", e); }
      }

      return Response.json({
        success: true,
        investigation_id: invId,
        status: invStatus,
        stale_recovered: outcome.staleRecovered,
        replaced_stale_id: outcome.staleId,
        message: outcome.staleRecovered ? "Stale investigation replaced with a fresh one" : "Investigation started",
        target: { type: effectiveTargetType, value: effectiveTargetValue },
      }, { status: 200 });
    }
    // POST with other body → 400
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  // === PATH-BASED ROUTING (direct HTTP access) ===
  if (path === "/api/hermes/start" && req.method === "POST") {
    return handleStart(req);
  }

  if (path === "/api/hermes/status" && req.method === "GET") {
    const base44 = getBase44Client(req);
    const user = await getUser(base44);
    const investigationId = url.searchParams.get("id") || url.searchParams.get("investigation_id");
    return handleStatusGet(base44, user, investigationId);
  }

  if (path === "/api/hermes/health" && req.method === "GET") {
    return handleHealthGet();
  }

  return Response.json({ error: "Not Found" }, { status: 404 });
});
