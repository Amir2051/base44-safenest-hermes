import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * uae-intel-sync — SafeNestT UAE Intelligence sync.
 *
 * Phase 1 (VARA Public Register): retrieves the official VARA public register
 * HTML table and persists structured VASP records to the database with full
 * provenance. Phase 2 (Dubai Pulse) is documented but NOT executed because the
 * portal API is unreachable from this sandbox.
 *
 * Every record carries provenance: source_url, source_name, retrieved_at,
 * source_record_order, source_record_id. No data is fabricated.
 *
 * Contract (UI→function):
 *   { action: "sync", source: "vara" | "dubai-pulse" }
 * Response:
 *   { ok: boolean, source, records, created, updated, status, error?, retrieved_at? }
 */

// ── VARA Public Register HTML table parser (Phase 1) ────────────────────

const VARA_REGISTER_URL =
  'https://www.vara.ae/en/licenses-and-register/public-register/';

function normaliseCell(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.charAt(0) === '@' ? text.slice(1).trim() : text;
}

function findVASPRegisterTable(html: string): string {
  const marker = 'VASP Name';
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(
      `VARA register table marker not found: ${marker}. Received ${html.length} characters.`
    );
  }
  let tableStart = html.lastIndexOf('<table', markerIndex);
  if (tableStart === -1) throw new Error('Could not locate VARA register <table>');
  const tableEnd = html.indexOf('</table>', markerIndex);
  if (tableEnd === -1) throw new Error('Could not locate end of VARA register <table>');
  return html.slice(tableStart, tableEnd + '</table>'.length);
}

function splitRows(tableFragment: string): string[] {
  const rows: string[] = [];
  const re = /<tr[\s\S]*?<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tableFragment)) !== null) {
    const row = m[0];
    if (!row.endsWith('</tr>')) {
      throw new Error(
        `Malformed VARA register table row: missing </tr>. First 120 chars: ${row.slice(0, 120)}`
      );
    }
    rows.push(row);
  }
  if (rows.length === 0) {
    throw new Error('VARA register table contained no <tr> rows');
  }
  return rows;
}

function extractCells(rowFragment: string): string[] {
  const cells: string[] = [];
  const re = /<t[dh][\s\S]*?<\/t[dh]>/gis;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowFragment)) !== null) {
    cells.push(m[0]);
  }
  return cells;
}

function cellText(cell: string): string | null {
  const text = cell.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

function buildRecord(headers: string[], rowFragment: string, rowIndex: number): Record<string, string> | null {
  const cells = extractCells(rowFragment);
  const label = cellText(cells[0]);
  if (!label) return null;

  const record: Record<string, string> = {
    source_record_order: String(rowIndex),
  };

  headers.forEach((header, i) => {
    const value = i < cells.length ? cellText(cells[i]) : null;
    const normalised = normaliseCell(value);
    record[header] = normalised !== null ? normalised : value || '';
  });

  return record;
}

function parseVASPRegister(html: string): { records: Record<string, string>[]; headers: string[] } {
  if (html === null || html === undefined) {
    throw new TypeError('html must be provided');
  }
  const trimmed = String(html).trim();
  if (trimmed.length === 0) {
    throw new Error('VARA register HTML is empty');
  }

  const table = findVASPRegisterTable(trimmed);
  const rows = splitRows(table);

  let headerIndex = -1;
  let headers: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = extractCells(rows[i]);
    const labels = cells.map(cellText).filter(Boolean) as string[];
    if (labels.includes('VASP Name')) {
      headerIndex = i;
      headers = labels.map((h) => h.trim());
      break;
    }
  }

  if (headerIndex === -1) {
    throw new Error(
      'VARA register table has no VASP Name header. Header labels: ' +
        JSON.stringify(
          rows
            .map((r) => extractCells(r).map(cellText).filter(Boolean))
            .flat()
        )
    );
  }

  const records: Record<string, string>[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const record = buildRecord(headers, rows[i], i);
    if (!record || !record['VASP Name']) continue;

    const required = ['VASP Name', 'Reference', 'Licence Type', 'Status'];
    const missing = required.filter((f) => !record[f]);
    if (missing.length) {
      throw new Error(
        `VARA record at row ${i} is missing required field(s): ${missing.join(', ')}`
      );
    }
    records.push(record);
  }

  return { records, headers };
}

// ── Sync function ──────────────────────────────────────────────────────

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json().catch(() => ({}));
    const { source } = payload || {};

    if (!source || !['vara', 'dubai-pulse'].includes(source)) {
      return Response.json({
        ok: false,
        error: 'Missing or unsupported source. Allowed: vara, dubai-pulse.',
      });
    }

    if (source === 'dubai-pulse') {
      return Response.json({
        ok: false,
        source: 'dubai-pulse',
        status: 'not_reachable',
        error: 'Dubai Pulse portal API is unreachable from this environment. See base44/functions/uae-intel/README.md.',
      });
    }

    // Phase 1: VARA Public Register
    const sourceUrl = VARA_REGISTER_URL;
    const retrievedAt = new Date().toISOString();

    const regRes = await fetch(sourceUrl, {
      headers: { Accept: 'text/html' },
      signal: AbortSignal.timeout(25000),
    });

    if (!regRes.ok) {
      return Response.json({
        ok: false,
        source,
        status: 'http_error',
        upstream_status: regRes.status,
        error: `VARA public register returned HTTP ${regRes.status}`,
      });
    }

    const html = await regRes.text();
    const { records } = parseVASPRegister(html);

    const seen = new Map<string, boolean>();
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const raw of records) {
      const varaRef = raw['Reference'] || '';
      const key = varaRef.trim();
      if (!key) {
        skipped += 1;
        continue;
      }

      const existing = await base44.entities.Vasp.filter({ vara_reference: key }).exec();
      const provenance: Record<string, string> = {
        vara_reference: key,
        name: raw['VASP Name'] || '',
        licence_type: raw['Licence Type'] || 'VASP Licence',
        licence_date: raw['Licence Issued'] || '',
        status: raw['Status'] || 'Active',
        cma_registration: raw['CMA Registration Number'] || '',
        licensed_activities: raw['Licensed Activities'] ? [raw['Licensed Activities']] : [],
        source_url: sourceUrl,
        source_name: 'VARA Public Register',
        retrieved_at: retrievedAt,
        source_record_order: raw['source_record_order'] || '',
        source_record_id: '',
        regulated_on: raw['Licence Issued'] || '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (existing.length > 0) {
        const rec = existing[0];
        const changed =
          rec.source_url !== sourceUrl ||
          rec.source_name !== 'VARA Public Register' ||
          rec.retrieved_at !== retrievedAt ||
          rec.source_record_order !== provenance.source_record_order;
        if (changed) {
          await base44.entities.Vasp.update(rec.id, {
            ...provenance,
            updated_at: new Date().toISOString(),
          });
          updated += 1;
        } else {
          skipped += 1;
        }
      } else {
        await base44.entities.Vasp.create(provenance);
        created += 1;
      }

      seen.set(key, true);
    }

    return Response.json({
      ok: true,
      source,
      records: records.length,
      created,
      updated,
      skipped,
      status: 'synced',
      retrieved_at: retrievedAt,
    });
  } catch (error: any) {
    return Response.json({
      ok: false,
      source: 'vara',
      status: 'error',
      error: error?.message || String(error),
    });
  }
}
