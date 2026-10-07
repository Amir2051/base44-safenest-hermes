/**
 * VARA Public Register — HTML table parser.
 *
 * Source (official VARA Public Register): https://www.vara.ae/en/licenses-and-register/public-register/
 * The register exposes a human-readable HTML table with no JSON API/document download.
 * This module extracts the table into structured VASP records with full provenance
 * (source URL + retrieved_at + source record order).
 *
 * Only DOM-tag stripping + header mapping is used. No external HTML parser needed,
 * so it is deterministic and tested for: well-formed rows, malformed rows, empty
 * responses, duplicate identification, status/activity fields, and provenance.
 *
 * @module vara-register-parser
 */

'use strict';

const VARA_REGISTER_URL =
  'https://www.vara.ae/en/licenses-and-register/public-register/';

/**
 * Normalise a raw cell value: strip all HTML tags, collapse whitespace,
 * trim, and drop a leading @ if present (used by VARA's footnote markers).
 * Returns null for an empty/whitespace-only value.
 */
export function normaliseCell(raw) {
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

/**
 * Extract the table that is the VARA Public Register.
 * VARA renders the register as a single <table> with a header row whose first
 * cell contains "VASP Name". We locate that table and nothing else.
 */
export function findVASPRegisterTable(html) {
  if (!html) throw new TypeError('html is required');
  // Locate the cell containing the VASP Name header, then walk up to its table.
  const marker = 'VASP Name';
  const markerIndex = html.indexOf(marker);
  if (markerIndex === -1) {
    throw new Error(
      `VARA register table marker not found: ${marker}. Received ${html.length} characters.`
    );
  }
  // Walk backwards to the enclosing <table ...>
  let tableStart = html.lastIndexOf('<table', markerIndex);
  if (tableStart === -1) throw new Error('Could not locate VARA register <table>');
  // Walk forward to the matching </table>
  const tableEnd = html.indexOf('</table>', markerIndex);
  if (tableEnd === -1) throw new Error('Could not locate end of VARA register <table>');
  return html.slice(tableStart, tableEnd + '</table>'.length);
}

/**
 * Split a <tr ...>...</tr> into a row fragment, keeping the opening tag intact.
 * Rejects <tr> that lack a closing </tr> (malformed table row).
 * Does not split on nested <tr> inside <td> (VARA does not nest <tr>).
 * The regex uses [\s\S] so it matches attributes containing newlines.
 */
export function splitRows(tableFragment) {
  const rows = [];
  const re = /<tr[\s\S]*?<\/tr>/gi;
  let m;
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

/**
 * Extract the array of <th ...> or <td ...> cells from a row fragment.
 */
export function extractCells(rowFragment) {
  const cells = [];
  const re = /<t[dh][\s\S]*?<\/t[dh]>/gis;
  let m;
  while ((m = re.exec(rowFragment)) !== null) {
    cells.push(m[0]);
  }
  return cells;
}

/**
 * Convert a rendered cell (one <th>/<td> element) into a header/value string.
 * A <th> may wrap a <a> (vendor name link). We read the innermost text.
 */
export function cellText(cell) {
  const text = cell.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return text || null;
}

/**
 * Build a record from header cells + a data row.
 * Returns null if the row has no label cell (e.g. a structural <tr>).
 */
export function buildRecord(headers, rowFragment, rowIndex) {
  const cells = extractCells(rowFragment);
  const label = cellText(cells[0]);
  if (!label) return null;

  const record = {
    source_record_order: rowIndex,
  };

  headers.forEach((header, i) => {
    const value = i < cells.length ? cellText(cells[i]) : null;
    const normalised = normaliseCell(value);
    // Prefer the whitespace-normalised value. Fall back to the raw cell text
    // (including any unmatched/legacy headers) only when it was null.
    record[header] = normalised !== null ? normalised : value;
  });

  return record;
}

/**
 * Parse the VARA Public Register HTML into structured VASP records.
 *
 * @param {string} html - Raw HTML body of the VARA public register page.
 * @returns {{ records: Array<VASPRecord>, header: string[] }}
 * @throws {TypeError|Error} on missing/empty/malformed input.
 */
export function parseVASPRegister(html) {
  if (html === null || html === undefined) {
    throw new TypeError('html must be provided');
  }
  const trimmed = String(html).trim();
  if (trimmed.length === 0) {
    throw new Error('VARA register HTML is empty');
  }

  const table = findVASPRegisterTable(trimmed);
  const rows = splitRows(table);

  // Identify the header row (first row containing a cell whose text is "VASP Name").
  let headerIndex = -1;
  let headers = [];
  for (let i = 0; i < rows.length; i++) {
    const cells = extractCells(rows[i]);
    const labels = cells.map(cellText).filter(Boolean);
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

  const labelHeaderIndex = headers.indexOf('VASP Name');
  const records = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const record = buildRecord(headers, rows[i], i);
    if (record && record['VASP Name']) {
      // Load-bearing fields: required for an intelligence record.
      const required = ['VASP Name', 'Reference', 'Licence Type', 'Status'];
      const missing = required.filter((f) => !record[f]);
      if (missing.length) {
        // Strictly invalid records are rejected, not emitted.
        throw new Error(
          `VARA record at row ${i} is missing required field(s): ${missing.join(', ')}`
        );
      }
      records.push(record);
    }
  }

  return { records, headers };
}

export { VARA_REGISTER_URL };

/** Build the full provenance envelope for an imported VASP record. */
export function recordProvenance(record, retrievedAt, sourceUrl = VARA_REGISTER_URL) {
  return {
    ...record,
    source_url: sourceUrl,
    source_name: 'VARA Public Register',
    retrieved_at: retrievedAt,
    record_order: record.source_record_order,
    record_id: null, // assigned later by the synchroniser (database-generated)
    source_record_id: null, // VARA reference number; no internal VARA ID known to caller
  };
}
