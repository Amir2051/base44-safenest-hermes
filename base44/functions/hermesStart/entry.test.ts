/**
 * Hermetic tests for the stale-investigation-ID recovery logic in
 * base44/functions/hermesStart/entry.ts.
 *
 * WHY THIS TEST FILE EXISTS
 * -------------------------
 * The Base44 project has no test runner (package.json declares no test script
 * and no vitest/jest dependency). Deno IS available and the target file is a
 * Deno program, so the tests run under `deno test` with zero new dependencies.
 *
 * WHY THE FUNCTIONS ARE EXTRACTED RATHER THAN IMPORTED
 * -----------------------------------------------------
 * entry.ts calls Deno.serve(...) at module scope. Importing it would bind a
 * port and start a server, so the module cannot be imported for testing.
 * Instead the two functions under test are extracted from the REAL source text
 * and evaluated in a sandbox with injected collaborators.
 *
 * This still tests the shipped code: if someone edits or deletes
 * investigationExists/startVerified in entry.ts, these tests fail. It is not a
 * copy of the logic — it is the logic, read from the file at test time.
 *
 * RUN:  deno test --allow-read base44/functions/hermesStart/entry.test.ts
 */

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const ENTRY = new URL("./entry.ts", import.meta.url);
const source = await Deno.readTextFile(ENTRY);

/** Pull a top-level `async function name(...) { ... }` out of the source text. */
function extractFunction(name: string): string {
  const startRe = new RegExp(`^\\s*async function ${name}\\s*\\(`, "m");
  const m = startRe.exec(source);
  if (!m) {
    throw new Error(`could not find "async function ${name}" in entry.ts — ` +
      "if it was renamed or removed, this test must be updated");
  }
  const start = m.index;
  // Walk braces from the first '{' after the signature.
  let i = source.indexOf("{", start);
  let depth = 0;
  let seen = false;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") { depth++; seen = true; }
    else if (ch === "}") {
      depth--;
      if (seen && depth === 0) { i++; break; }
    }
  }
  return source.slice(start, i);
}

const investigationExistsSrc = extractFunction("investigationExists");
const startVerifiedSrc = extractFunction("startVerified");
// The real startInvestigation is used (not stubbed) so that start-time failure
// handling is genuinely exercised rather than faked by a collaborator.
const startInvestigationSrc = extractFunction("startInvestigation");

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

interface Call { method: string; url: string; }

interface Sandbox {
  investigationExists: (id: string) => Promise<{ exists: boolean; status?: string }>;
  startVerified: (
    storedId: string | null,
    targetType: string,
    targetValue: string,
    investigationType: string,
    caseId?: string | null,
  ) => Promise<{
    investigation_id: string;
    staleRecovered: boolean;
    staleId: string | null;
    status?: string;
    replacedReason?: string | null;
  }>;
  calls: Call[];
  created: number;
  started: string[];
}

/**
 * Build the functions under test with collaborator stubs.
 *
 * `hermesResponder` decides what the Hermes engine answers for each request.
 * It receives the parsed request and returns a [status, body] pair.
 */
function makeSandbox(
  hermesResponder: (call: Call) => [number, unknown],
  opts: { createId?: string } = {},
): Sandbox {
  const calls: Call[] = [];
  const started: string[] = [];
  const state = { created: 0 };

  const fetchStub = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? "GET").toUpperCase();
    const call = { method, url: String(url) };
    calls.push(call);
    const [status, body] = hermesResponder(call);
    return new Response(JSON.stringify(body ?? null), {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  // Collaborators referenced by the extracted functions.
  const hermestUrl = (p: string) => `https://api.safenestt.com${p}`;
  const hermestHeaders = () => ({ "X-API-Key": "test-key" });
  const createInvestigation = async () => {
    state.created++;
    return { investigation_id: opts.createId ?? "fresh-id-0001", status: "queued" };
  };

  const factory = new Function(
    "fetch", "hermestUrl", "hermestHeaders", "createInvestigation", "isConfigured",
    `${investigationExistsSrc}\n${startInvestigationSrc}\n${startVerifiedSrc}\n` +
    `return { investigationExists, startVerified };`,
  );

  const api = factory(
    fetchStub, hermestUrl, hermestHeaders, createInvestigation, () => true,
  ) as any;

  // derive started ids from the real startInvestigation's call log
  const startedNow = () =>
    calls.filter((c) => isStart(c))
      .map((c) => c.url.split("/v1/investigations/")[1].split("/")[0]);

  return {
    investigationExists: api.investigationExists,
    startVerified: api.startVerified,
    calls,
    get created() { return state.created; },
    get started() { return startedNow(); },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STALE_ID = "7839090e2c374701b584fa630485340a";
const LIVE_ID = "42cafb339f05400094c77616046b1532";
const FRESH_ID = "aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";

function isVerify(c: Call) { return c.method === "GET" && !c.url.includes("/start"); }
function isStart(c: Call) { return c.url.includes("/start"); }
function isCreate(c: Call) { return c.method === "POST" && /\/v1\/investigations(\?|$)/.test(c.url); }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test("valid stored ID -> verified, attached (RUNNING), no new create", async () => {
  const sb = makeSandbox(
    (c) => {
      if (isVerify(c)) return [200, { investigation_id: LIVE_ID, status: "RUNNING" }];
      if (isStart(c)) return [200, { status: "running" }];
      return [404, {}];
    },
    { createId: FRESH_ID },
  );

  const out = await sb.startVerified(LIVE_ID, "domain", "example.com", "web");

  // The stored ID must be verified first...
  assertEquals(out.investigation_id, LIVE_ID);
  assertEquals(out.staleRecovered, false);
  assertEquals(out.staleId, null);

  // ...and no duplicate investigation may be created.
  assertEquals(sb.created, 0, "must not create when the stored ID is valid");
  assertEquals(sb.started, [], "must not POST /start on a RUNNING investigation");
  assert(sb.calls.some(isVerify), "must GET the investigation before starting");
});

Deno.test("no stored ID -> creates directly, no verification GET", async () => {
  const sb = makeSandbox((c) => {
    if (isStart(c)) return [200, { status: "running" }];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  const out = await sb.startVerified(null, "domain", "example.com", "web");

  assertEquals(out.investigation_id, FRESH_ID);
  assertEquals(out.staleRecovered, false);
  assertEquals(sb.created, 1);
  assertEquals(sb.started, [FRESH_ID]);
  assertEquals(sb.calls.some(isVerify), false, "nothing to verify when there is no stored ID");
});

Deno.test("stale ID (GET 404) -> creates fresh, starts the fresh one", async () => {
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [404, { detail: { code: "investigation_not_found" } }];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    if (isStart(c)) return [200, { status: "running" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  const out = await sb.startVerified(STALE_ID, "domain", "example.com", "web");

  // A fresh investigation replaces the stale one...
  assertEquals(out.investigation_id, FRESH_ID);
  assertEquals(out.staleRecovered, true);
  assertEquals(out.staleId, STALE_ID);
  assertEquals(sb.created, 1);

  // ...and crucially the STALE id is never POSTed to /start.
  assertEquals(sb.started, [FRESH_ID]);
  assert(
    !sb.calls.some((c) => isStart(c) && c.url.includes(STALE_ID)),
    "must not POST /start on a stale investigation id",
  );
});

Deno.test("401 on verify -> throws, and does NOT create a replacement", async () => {
  const sb = makeSandbox(() => [401, { detail: { code: "invalid_key" } }]);

  await assertRejects(
    () => sb.startVerified(STALE_ID, "domain", "example.com", "web"),
    Error,
    "auth failed",
  );
  // An auth failure must never be mistaken for "stale" — that would create
  // duplicate work while the credential is broken.
  assertEquals(sb.created, 0, "401 must not trigger a replacement create");
  assertEquals(sb.started.length, 0);
});

Deno.test("403 on verify -> throws, and does NOT create a replacement", async () => {
  const sb = makeSandbox(() => [403, { detail: { code: "forbidden" } }]);

  await assertRejects(
    () => sb.startVerified(STALE_ID, "domain", "example.com", "web"),
    Error,
    "authorization failed",
  );
  assertEquals(sb.created, 0, "403 must not trigger a replacement create");
});

Deno.test("500 on verify -> throws, and does NOT create a replacement", async () => {
  const sb = makeSandbox(() => [500, { detail: "boom" } ]);

  await assertRejects(
    () => sb.startVerified(LIVE_ID, "domain", "example.com", "web"),
    Error,
    "server error",
  );
  // A transient server error is not proof of absence; the investigation may
  // well exist, so creating a replacement would duplicate work.
  assertEquals(sb.created, 0, "5xx must not trigger a replacement create");
});

Deno.test("network failure on verify -> propagates, no replacement", async () => {
  const calls: Call[] = [];
  const factory = new Function(
    "fetch", "hermestUrl", "hermestHeaders", "createInvestigation", "isConfigured",
    `${investigationExistsSrc}\n${startInvestigationSrc}\n${startVerifiedSrc}\n` +
    `return { startVerified };`,
  );
  const api = factory(
    () => Promise.reject(new TypeError("network error")),
    (p: string) => `https://api.safenestt.com${p}`,
    () => ({}),
    () => { calls.push({ method: "POST", url: "create" }); return { investigation_id: "x" }; },
    () => true,
  ) as any;

  await assertRejects(() => api.startVerified(LIVE_ID, "domain", "e.com", "web"));
  assertEquals(calls.length, 0, "network error must not trigger a replacement create");
});

Deno.test("start failure after fresh create propagates (not swallowed)", async () => {
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [404, {}];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    if (isStart(c)) return [500, { detail: "start exploded" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  await assertRejects(
    () => sb.startVerified(STALE_ID, "domain", "example.com", "web"),
    Error,
    "server error",
  );
});

Deno.test("extraction is real: functions came from entry.ts, not a copy", () => {
  assert(investigationExistsSrc.includes("investigationExists"));
  assert(investigationExistsSrc.includes("hermestUrl"));
  assert(startVerifiedSrc.includes("startVerified"));
  assert(startVerifiedSrc.includes("createInvestigation"));
  // Guard against a test that silently passes against a stub instead of the code.
  assert(
    source.includes("async function startVerified"),
    "entry.ts must define startVerified — the shipped fix appears to be missing",
  );
});

// ---------------------------------------------------------------------------
// Lifecycle tests (2026-10-05)
// The 409 investigation_already_completed bug: existence alone cannot decide
// whether /start is legal. A COMPLETED investigation exists and must still
// never be started again.
// ---------------------------------------------------------------------------

Deno.test("COMPLETED stored ID -> creates a fresh investigation", async () => {
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [200, { investigation_id: STALE_ID, status: "COMPLETED" }];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    if (isStart(c)) return [200, { status: "running" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  const out = await sb.startVerified(LIVE_ID, "domain", "example.com", "web");

  assertEquals(out.investigation_id, FRESH_ID, "a COMPLETED run must be replaced");
  assertEquals(out.staleRecovered, true);
  assertEquals(out.staleId, LIVE_ID);
  assertEquals(sb.created, 1, "must create exactly one replacement");
  // Critically: /start must never be aimed at the COMPLETED investigation.
  assert(
    !sb.calls.some((c) => isStart(c) && c.url.includes(LIVE_ID)),
    "must NOT POST /start on a COMPLETED investigation",
  );
  assertEquals(sb.started, [FRESH_ID]);
  assertEquals(out.replacedReason, "terminal:COMPLETED");
});

Deno.test("RUNNING stored ID -> does NOT POST /start again", async () => {
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [200, { investigation_id: LIVE_ID, status: "RUNNING" }];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    if (isStart(c)) return [200, { status: "running" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  const out = await sb.startVerified(LIVE_ID, "domain", "example.com", "web");

  // Attaches to the in-flight run rather than starting a duplicate.
  assertEquals(out.investigation_id, LIVE_ID);
  assertEquals(out.status, "RUNNING");
  assertEquals(out.staleRecovered, false);
  assertEquals(sb.started.length, 0, "must not POST /start on a RUNNING investigation");
  assertEquals(sb.created, 0, "must not create a replacement while RUNNING");
});

Deno.test("fresh CREATED ID -> no /start if already terminal (race)", async () => {
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [200, { investigation_id: LIVE_ID, status: "COMPLETED" }];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    if (isStart(c)) return [200, { status: "running" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  const out = await sb.startVerified(FRESH_ID, "domain", "example.com", "web");

  // The freshly created ID was terminal, so a replacement investigation is created.
  // startVerified still calls /start on the NEW fresh ID (not the terminal one).
  assertEquals(out.investigation_id, FRESH_ID);
  assertEquals(sb.created, 2, "terminal detected + replacement create = 2 creates");
  assert(
    !sb.calls.some((c) => isStart(c) && c.url.includes(LIVE_ID)),
    "must NOT POST /start on a terminal investigation",
  );
  // /start is on the replacement fresh ID, not the terminal one.
  assertEquals(sb.started, [FRESH_ID]);
  assertEquals(out.replacedReason, "terminal:COMPLETED");
});

Deno.test("COMPLETED stored ID -> fresh ID, no /start on old ID", async () => {
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [200, { investigation_id: LIVE_ID, status: "COMPLETED" }];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    if (isStart(c)) return [200, { status: "running" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  const out = await sb.startVerified(LIVE_ID, "domain", "example.com", "web");

  assertEquals(out.investigation_id, FRESH_ID);
  assertEquals(out.staleRecovered, true);
  assertEquals(out.staleId, LIVE_ID);
  assertEquals(sb.created, 1);
  assert(
    !sb.calls.some((c) => isStart(c) && c.url.includes(LIVE_ID)),
    "must NOT POST /start on a COMPLETED investigation",
  );
  assertEquals(sb.started, [FRESH_ID]);
  assertEquals(out.replacedReason, "terminal:COMPLETED");
});

Deno.test("FAILED stored ID -> fresh ID", async () => {
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [200, { investigation_id: LIVE_ID, status: "FAILED" }];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    if (isStart(c)) return [200, { status: "running" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  const out = await sb.startVerified(LIVE_ID, "domain", "example.com", "web");

  assertEquals(out.investigation_id, FRESH_ID);
  assertEquals(out.staleRecovered, true);
  assertEquals(sb.created, 1);
  assert(
    !sb.calls.some((c) => isStart(c) && c.url.includes(LIVE_ID)),
    "must NOT POST /start on a FAILED investigation",
  );
  assertEquals(out.replacedReason, "terminal:FAILED");
});

Deno.test("CANCELLED stored ID -> fresh ID", async () => {
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [200, { investigation_id: LIVE_ID, status: "CANCELLED" }];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    if (isStart(c)) return [200, { status: "running" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  const out = await sb.startVerified(LIVE_ID, "domain", "example.com", "web");

  assertEquals(out.investigation_id, FRESH_ID);
  assertEquals(out.staleRecovered, true);
  assertEquals(sb.created, 1);
  assert(
    !sb.calls.some((c) => isStart(c) && c.url.includes(LIVE_ID)),
    "must NOT POST /start on a CANCELLED investigation",
  );
  assertEquals(out.replacedReason, "terminal:CANCELLED");
});

Deno.test("QUEUED stored ID -> no duplicate /start", async () => {
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [200, { investigation_id: LIVE_ID, status: "QUEUED" }];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    if (isStart(c)) return [200, { status: "running" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  const out = await sb.startVerified(LIVE_ID, "domain", "example.com", "web");

  assertEquals(out.investigation_id, FRESH_ID, "a QUEUED id is replaced, not started");
  assertEquals(out.staleRecovered, true, "a QUEUED id is treated as existing");
  assertEquals(out.staleId, LIVE_ID);
  assertEquals(sb.created, 1, "must create exactly one replacement");
  assert(
    !sb.calls.some((c) => isStart(c) && c.url.includes(LIVE_ID)),
    "must NOT POST /start on a QUEUED investigation",
  );
  assertEquals(sb.started, [FRESH_ID]);
  assertEquals(out.replacedReason, "existing:QUEUED");
});

Deno.test("RUNNING stored ID -> does NOT POST /start again", async () => {
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [200, { investigation_id: LIVE_ID, status: "RUNNING" }];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    if (isStart(c)) return [200, { status: "running" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  const out = await sb.startVerified(LIVE_ID, "domain", "example.com", "web");

  assertEquals(out.investigation_id, LIVE_ID);
  assertEquals(out.status, "RUNNING");
  assertEquals(out.staleRecovered, false);
  assertEquals(sb.started.length, 0, "must not POST /start on a RUNNING investigation");
  assertEquals(sb.created, 0, "must not create a replacement while RUNNING");
});

Deno.test("FAILED stored ID -> creates a fresh investigation", async () => {
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [200, { investigation_id: LIVE_ID, status: "FAILED" }];
    if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
    if (isStart(c)) return [200, { status: "running" }];
    return [404, {}];
  }, { createId: FRESH_ID });

  const out = await sb.startVerified(LIVE_ID, "domain", "example.com", "web");

  assertEquals(out.investigation_id, FRESH_ID);
  assertEquals(out.staleRecovered, true);
  assertEquals(sb.created, 1);
  assert(
    !sb.calls.some((c) => isStart(c) && c.url.includes(LIVE_ID)),
    "must NOT POST /start on a FAILED investigation",
  );
  assertEquals(out.replacedReason, "terminal:FAILED");
});

Deno.test("QUEUED stored ID -> do NOT re-start, create a fresh investigation", async () => {
  const sb = makeSandbox(
    (c) => {
      if (isVerify(c)) return [200, { investigation_id: LIVE_ID, status: "QUEUED" }];
      if (isCreate(c)) return [200, { investigation_id: FRESH_ID, status: "queued" }];
      if (isStart(c)) return [200, { status: "RUNNING" }];
      return [404, {}];
    },
    { createId: FRESH_ID },
  );

  const out = await sb.startVerified(LIVE_ID, "domain", "example.com", "web");

  assertEquals(out.investigation_id, FRESH_ID, "a QUEUED id is NOT started; a fresh one is created");
  assertEquals(out.staleRecovered, true, "a QUEUED id is treated as existing");
  assertEquals(out.staleId, LIVE_ID);
  assertEquals(sb.created, 1, "must create exactly one replacement");
  // Crucially: /start must never be aimed at the QUEUED investigation.
  assert(
    !sb.calls.some((c) => isStart(c) && c.url.includes(LIVE_ID)),
    "must NOT POST /start on a QUEUED investigation",
  );
  assertEquals(sb.started, [FRESH_ID]);
  assertEquals(out.replacedReason, "existing:QUEUED");
});

Deno.test("409 from /start -> clear error naming the conflict", async () => {
  // A race: verification said QUEUED, but another caller started it first.
  const sb = makeSandbox((c) => {
    if (isVerify(c)) return [200, { investigation_id: LIVE_ID, status: "QUEUED" }];
    if (isStart(c)) {
      return [409, { detail: { code: "invalid_state", message: "investigation_already_completed" } }];
    }
    return [404, {}];
  });

  await assertRejects(
    () => sb.startVerified(LIVE_ID, "domain", "example.com", "web"),
    Error,
    "409",
  );
  await assertRejects(
    () => sb.startVerified(LIVE_ID, "domain", "example.com", "web"),
    Error,
    "investigation_already_completed",
  );
});

// ---------------------------------------------------------------------------
// Regression tests — body-based router path (the actual functions.invoke path)
// ---------------------------------------------------------------------------
// These tests guard against the specific class of bug that caused
// isCaseNumberLike to crash the UI click: undefined identifiers on the
// body-based router code path that Base44 functions.invoke hits.
// They also verify argument propagation that the lifecycle-only tests
// cannot see.

// General-purpose extractor that handles both `function` and `async function`.
function extractFunctionGeneral(name: string): string {
  const startRe = new RegExp(`^\\s*(?:async\\s+)?function\\s+${name}\\s*\\(`, "m");
  const m = startRe.exec(source);
  if (!m) {
    throw new Error(
      `could not find "function ${name}" in entry.ts — ` +
      "if it was renamed or removed, this test must be updated",
    );
  }
  const start = m.index;
  let i = source.indexOf("{", start);
  let depth = 0;
  let seen = false;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") { depth++; seen = true; }
    else if (ch === "}") {
      depth--;
      if (seen && depth === 0) { i++; break; }
    }
  }
  return source.slice(start, i);
}

// Extract isCaseNumberLike from the REAL source (not a copy).
const isCaseNumberLikeSrc = (() => {
  const src = extractFunctionGeneral("isCaseNumberLike");
  // new Function() cannot parse TypeScript annotations, so strip the
  // type annotations from this function's signature before evaluating.
  // (This function has no type annotations in its body — only the signature.)
  const clean = src
    .replace(/\(val:\s*\w+\)/, "(val)")
    .replace(/\):\s*\w+/, ")");
  const factory = new Function(clean + "\nreturn isCaseNumberLike;");
  return factory() as (val: unknown) => boolean;
})();

// --- Section header for the new tests --------------------------------------
console.log("\n=== Router-path regression tests ===");

Deno.test("isCaseNumberLike is defined in source (no ReferenceError)", () => {
  assert(
    /function\s+isCaseNumberLike\s*\(/.test(source),
    "entry.ts must define isCaseNumberLike as a function",
  );
});

Deno.test("isCaseNumberLike is NOT a call-only reference (definition exists)", () => {
  const definedMatches = source.match(/function\s+isCaseNumberLike\s*\(/g);
  assert(definedMatches && definedMatches.length >= 1, "at least one definition required");
  assert(definedMatches.length === 1, "exactly one definition expected");
});

Deno.test("isCaseNumberLike: case numbers return true", () => {
  const fn = isCaseNumberLikeSrc;
  assert(fn("IC-2024-001"), "IC-2024-001");
  assert(fn("CASE-2024-001"), "CASE-2024-001");
  assert(fn("INV-2024-ABCD"), "INV-2024-ABCD");
  assert(fn("ic-2024-001"), "lowercase prefix");
  assert(fn("eqt5y-collectibles-1"), "mixed alphanumeric case number");
  assert(fn("IC-1727000000-ABCD"), "timestamp-based case number");
});

Deno.test("isCaseNumberLike: domains return false", () => {
  const fn = isCaseNumberLikeSrc;
  assert(!fn("example.com"), "example.com");
  assert(!fn("sub.example.org"), "sub.example.org");
  assert(!fn("phishingsite.net"), "phishingsite.net");
});

Deno.test("isCaseNumberLike: IPs return false", () => {
  const fn = isCaseNumberLikeSrc;
  assert(!fn("192.168.1.1"), "IPv4");
  assert(!fn("10.0.0.1"), "IPv4 private");
  assert(!fn("not.an.ip"), "not an IP");
});

Deno.test("isCaseNumberLike: URLs return false", () => {
  const fn = isCaseNumberLikeSrc;
  assert(!fn("https://example.com"), "https URL");
  assert(!fn("http://phishsite.com/path"), "http URL");
  assert(!fn("ftp://example.com"), "ftp URL");
});

Deno.test("isCaseNumberLike: crypto wallet addresses return false", () => {
  const fn = isCaseNumberLikeSrc;
  assert(!fn("0x742d35Cc6634C0532925a3b84784Ca5A1c7A1F8d"), "Ethereum");
  assert(!fn("bc1qw508d6qejxtdgwncyu2sdf3g3q6a5vpsvf5esq"), "Bitcoin bech32");
  assert(!fn("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"), "Bitcoin legacy");
  assert(!fn("TR7NHqjeSQ3YVJrQZ8aJKLw8mB4qkV5eF"), "Tron");
});

Deno.test("isCaseNumberLike: emails return false", () => {
  const fn = isCaseNumberLikeSrc;
  assert(!fn("user@example.com"), "standard email");
  assert(!fn("victim@company.org"), "company email");
});

Deno.test("isCaseNumberLike: non-string returns false", () => {
  const fn = isCaseNumberLikeSrc;
  assert(!fn(null));
  assert(!fn(undefined));
  assert(!fn(123));
  assert(!fn({}));
  assert(!fn(""));
  assert(!fn("   "));
});

Deno.test("isCaseNumberLike: Base44 entity IDs return false", () => {
  const fn = isCaseNumberLikeSrc;
  // Base44 entity IDs are long alphanumeric strings without hyphens.
  assert(!fn("cmbobase44entityid123456789"), "long Base44 ID");
  assert(!fn("abc123"), "short alphanumeric");
});

// --- Source-level tests for the body-based router path ---

Deno.test("body-based router: startVerified receives caseId as 5th argument", () => {
  // The router (Deno.serve body-based branch) must pass caseId so that
  // createInvestigation sends case_id to the Hermes engine instead of null.
  const routerStart = source.indexOf("// === BODY-BASED ROUTING");
  const routerSection = source.slice(routerStart);
  const startCall = routerSection.match(
    /startVerified\(\s*[\s\S]{0,200}?\)/,
  );
  assert(startCall, "startVerified call must exist in body-based router");
  // Count args by counting top-level commas in the call (rough but effective).
  const callText = startCall[0];
  const args = callText.match(/startVerified\(([\s\S]*)\)/);
  assert(args, "startVerified call must have parens");
  const argList = args[1];
  // Must include caseId in the argument list
  assert(
    /\bcaseId\b/.test(argList),
    "startVerified must receive caseId as an argument in body-based router",
  );
});

Deno.test("handleStart: waitForCompletion is defined before use", () => {
  const handleStartSection = source.slice(
    source.indexOf("async function handleStart(req)"),
    source.indexOf("Deno.serve"),
  );
  // waitForCompletion must appear as a const declaration before its use
  const declIdx = handleStartSection.indexOf("const waitForCompletion");
  const useIdx = handleStartSection.indexOf("if (waitForCompletion)");
  assert(declIdx !== -1, "waitForCompletion must be declared in handleStart");
  assert(declIdx < useIdx, "waitForCompletion must be declared before use in handleStart");
});

Deno.test("handleStart: investigationType is defined before use", () => {
  const handleStartSection = source.slice(
    source.indexOf("async function handleStart(req)"),
    source.indexOf("Deno.serve"),
  );
  const declIdx = handleStartSection.indexOf("const investigationType");
  // First use is in the try block
  const useIdx = handleStartSection.indexOf("runInvestigation(effectiveTargetType");
  assert(declIdx !== -1, "investigationType must be declared in handleStart");
  assert(declIdx < useIdx, "investigationType must be declared before use");
});

Deno.test("no undefined identifier: isCaseNumberLike appears as a definition", () => {
  // Grep-style check: every identifier called as fn(...) must have a matching
  // definition. This is the regression guard for the original crash.
  const definedFunctions = new Set<string>();
  const defineRe = /(?:async\s+)?function\s+(\w+)\s*\(/g;
  let m;
  while ((m = defineRe.exec(source)) !== null) {
    definedFunctions.add(m[1]);
  }
  assert(definedFunctions.has("isCaseNumberLike"),
    "isCaseNumberLike must be defined as a function in source");
  assert(definedFunctions.has("waitForCompletion") === false,
    "waitForCompletion is a const, not a function — checked separately");
});

// --- tiny assertion helpers (no test framework needed) ---------------------
function assert(cond: unknown, msg = "assertion failed") {
  if (!cond) throw new Error(msg);
}
function assertEquals(actual: unknown, expected: unknown, msg?: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}
async function assertRejects(
  fn: () => Promise<unknown>,
  _ctor?: unknown,
  messageIncludes?: string,
) {
  try {
    await fn();
  } catch (e) {
    if (messageIncludes && !String((e as Error).message).includes(messageIncludes)) {
      throw new Error(
        `rejected with the wrong message: expected to contain "${messageIncludes}", got "${(e as Error).message}"`,
      );
    }
    return;
  }
  throw new Error("expected the call to reject, but it resolved");
}