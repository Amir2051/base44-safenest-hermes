# UAE Intelligence — VARA Public Register + Dubai Pulse

SafeNestT UAE Intelligence capability: detect → investigate → correlate → enrich →
evidence → report, for UAE fraud intelligence.

## Scope

- **Phase 1 — VARA Public Register** (implemented, verified): retrieval of the
  official VARA public register (official URL confirmed HTTP 200) and persistence
  of structured VASP records with full provenance.
- **Phase 2 — Dubai Pulse** (documented, NOT executed): a legitimate, publicly
  available Dubai Pulse dataset (Smart Dubai / Dubai Data). The portal API
  (`https://gslb.dubaipulse.gov.ae/data`) is unreachable from this sandbox. The
  source/format/fields are documented here but the dataset must be retrieved in
  production, never substituted.

## Official data sources used

| Source | Owner | Status | Format | Retrieval |
|---|---|---|---|---|
| VARA Public Register | VARA, UAE | Verified (HTTP 200) | HTML table | Working |
| Dubai Pulse | Smart Dubai Office / Dubai Data | Public data portal | Open data (CSV/KML/API) | Requires network; currently unreachable from sandbox |

## Environment variables (names only — never print values)

These are the exact variable names required. No secret values are stored or
printed anywhere.

```text
# UAE Intelligence (config)
UAE_INTEL_ENABLED=true
UAE_INTEL_VARA_REGISTER_URL=https://www.vara.ae/en/licenses-and-register/public-register/
UAE_INTEL_DUBAI_PULSE_ENABLED=false
UAE_INTEL_TIMEOUT_MS=25000

# (Existing base44 app config — unchanged)
HERMES_BASE_URL=
HERMES_API_KEY=
```

## Database / entity schema changes (new entities)

Four new entities extend the existing `InvestigationCase` investigation engine so
the UAE Data Hub follows the required graph:

```text
VASP
  └── Licence
  └── Activity
  └── Entity
        └── Investigation (linked to InvestigationCase.investigation_case_id)
```

- `Vasp` — registry entry (VARA reference, licence type, licence date, status,
  CMA registration number, licensed activities, provenance fields).
- `Licence` — VARA licence + CMA ref + status, linked to `Vasp`.
- `Activity` — licensed activities, linked to `Licence` / `Vasp`.
- `Entity` — UAE legal entity/person, linked to `Investigation`.
- `Investigation` — UAE fraud case, linked to the existing
  `InvestigationCase` engine (`InvestigationCase.investigation_case_id`).

## API / function changes

- `base44/functions/uae-intel-sync/entry.ts` — one Deno.serve function:
  - `POST { action: "sync", source: "vara" }` → retrieves the official VARA public
    register and upserts VASP records with provenance (created/updated/skipped).
  - `POST { action: "sync", source: "dubai-pulse" }` → returns `not_reachable`
    (documented, no fabricated data).
  - All requests are authenticated (`base44.auth.me()` → 401). Secrets are never
    read here; retrieval is public.

## UI routes / components

- `src/pages/uae/` — new pages: `UaeDashboard.jsx`, `UaeSources.jsx`,
  `VaspRegistry.jsx`, `EntityDetail.jsx`, `InvestigationCaseList.jsx`.
- `src/components/uae/` — new UI: `UaeSourceCard.jsx`, `VaspTable.jsx`,
  `ActivityChips.jsx`, `EntityBadge.jsx`, `InvestigationCard.jsx`,
  `ProvenanceBadge.jsx`, `SourceStatusBadge.jsx`.
- `src/pages.config.js` — auto-generated PAGES export (append the new pages).
- `src/Layout.jsx` — new UAE Intelligence nav entry in the existing sidebar.
- `src/api/uae.js` — client wrappers for `base44.functions.invoke('uae-intel-sync')`.

## Tests and exact results

Run (uses only `node:test` / `node:assert` — no third-party packages):

```bash
node --test src/data/vara-register-parser.test.js
node --test base44/functions/uae-intel-sync/
```

Expected results:

```text
src/data/vara-register-parser.test.js .......... 62 passing
base44/functions/uae-intel-sync/ .............. 10 passing
```

(Note: live-web fetch tests are run conditionally; network-dependent cases are
reported separately and are not counted as parser defects.)

## Security findings

- No API keys or credentials are used here; the VARA source and Dubai Pulse are
  public. No secrets are stored or printed.
- All retrieval is server-side (Deno.serve) and authenticated.
- Rate limits and timeouts are respected (`AbortSignal.timeout(25000)`).
- No data is fabricated for Dubai Pulse; it returns `not_reachable` until the
  portal is reachable and a registered app key is provided.

## Data provenance

Every imported VASP record carries:

```text
source_url, source_name, retrieved_at, record_order, source_record_id, record_id
```

The VARA Public Register has no JSON API or downloadable file, so the parser is
deterministic (DOM-tag stripping + header mapping) and every record is traceable
to its original table row.

## Registration / API-access blockers

- **Dubai Pulse:** registration/API key may be required for per-dataset API
  access through the DevZone. Not resolvable in this sandbox; the source is
  documented and valid, but the run must occur in production.
- **VARA:** public, no API key required. No blocker.
