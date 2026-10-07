/**
 * UME — data module tests.
 * Run: node --test src/data/ume.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOURCES,
  PROVENANCE_FIELDS,
  normaliseCell,
  buildProvenance,
  mapDatenoHitToEntity,
  normaliseDatenoHit,
  maskValue,
  redactJson,
  VaspRecord,
  VASPRECORD_FIELD_MAP,
} from './ume.js';

describe('SOURCES', () => {
  it('exposes exactly the expected sources', () => {
    assert.deepEqual(Object.keys(SOURCES), ['VARA_PUBLIC_REGISTER', 'DUBAI_PULSE', 'DATENO']);
  });
});

describe('PROVENANCE_FIELDS', () => {
  it('covers the documented provenance fields', () => {
    assert.ok(PROVENANCE_FIELDS.includes('source_url'));
    assert.ok(PROVENANCE_FIELDS.includes('source_name'));
    assert.ok(PROVENANCE_FIELDS.includes('retrieved_at'));
    assert.ok(PROVENANCE_FIELDS.includes('source_record_id'));
    assert.ok(PROVENANCE_FIELDS.includes('source_record_order'));
  });
});

describe('normaliseCell', () => {
  it('strips HTML tags and collapses whitespace', () => {
    assert.equal(normaliseCell('<b>Fasset FZE</b> <em>(1)</em>  '), 'Fasset FZE (1)');
  });
  it('drops leading @ footnotes', () => {
    assert.equal(normaliseCell('@footnote'), 'footnote');
  });
  it('returns null for empty values', () => {
    assert.equal(normaliseCell(''), null);
    assert.equal(normaliseCell('   '), null);
    assert.equal(normaliseCell(null), null);
    assert.equal(normaliseCell(undefined), null);
  });
});

describe('VaspRecord', () => {
  it('returns a record with default null fields', () => {
    const r = VaspRecord();
    assert.equal(r.name, null);
    assert.equal(r.licence_type, null);
    assert.equal(r.status, 'Active');
  });
  it('applies overrides', () => {
    const r = VaspRecord({ name: 'Fasset FZE', reference: 'VL/1' });
    assert.equal(r.name, 'Fasset FZE');
    assert.equal(r.reference, 'VL/1');
  });
});

describe('VASPRECORD_FIELD_MAP', () => {
  it('maps all documented fields', () => {
    assert.ok(VASPRECORD_FIELD_MAP['VASP Name']);
    assert.ok(VASPRECORD_FIELD_MAP['Reference']);
    assert.ok(VASPRECORD_FIELD_MAP['Licence Type']);
    assert.ok(VASPRECORD_FIELD_MAP['Status']);
  });
});

describe('buildProvenance', () => {
  it('attaches provenance to a record', () => {
    const record = { name: 'Fasset FZE', reference: 'VL/23/07/002' };
    const pv = buildProvenance(record, '2026-10-06T12:00:00.000Z', 'https://www.vara.ae/en/licenses-and-register/public-register/', 'VARA Public Register');
    assert.equal(pv.name, 'Fasset FZE');
    assert.equal(pv.reference, 'VL/23/07/002');
    assert.equal(pv.source_url, 'https://www.vara.ae/en/licenses-and-register/public-register/');
    assert.equal(pv.source_name, 'VARA Public Register');
    assert.equal(pv.retrieved_at, '2026-10-06T12:00:00.000Z');
  });
});

describe('mapDatenoHitToEntity', () => {
  it('maps provenance fields to SafeNestT entity fields', () => {
    const hit = {
      _source: {
        dataset: { id: 'DS-1', title: 'Environment', url: 'https://example.com/ds' },
        source: { name: 'Publisher', url: 'https://example.com', countries: [{ id: 'US' }] },
      },
    };
    const out = mapDatenoHitToEntity(hit);
    assert.equal(out.dataset_title, 'Environment');
    assert.equal(out.source_name, 'Publisher');
    assert.ok(Array.isArray(out.source_countries));
  });
});

describe('UMe exported contract', () => {
  it('exposes exactly the documented export functions', () => {
    // Public API surface of this module.
    const api = {
      SOURCES, PROVENANCE_FIELDS, normaliseCell, buildProvenance,
      mapDatenoHitToEntity, maskValue, redactJson, VaspRecord, VASPRECORD_FIELD_MAP,
    };
    // SOURCES is an object (catalog map), PROVENANCE_FIELDS is an array.
    assert.ok(typeof api.SOURCES === "object");
    assert.ok(Array.isArray(api.PROVENANCE_FIELDS));
    assert.equal(typeof api.normaliseCell, 'function');
    assert.equal(typeof api.buildProvenance, 'function');
    assert.equal(typeof api.mapDatenoHitToEntity, 'function');
    assert.equal(typeof api.maskValue, 'function');
    assert.equal(typeof api.redactJson, 'function');
    assert.equal(typeof api.VaspRecord, 'function');
    assert.equal(typeof api.VASPRECORD_FIELD_MAP, 'object');
  });
});

describe('maskValue / redactJson', () => {
  it('masks strings', () => {
    // maskValue keeps head + tail, fills middle with blocker chars.
    const out = maskValue('alice@example.com');
    assert.equal(out.length, 4 + 13 + 4); // head(4) + middle blocked(13) + tail(4)
    assert.ok(out.startsWith('alic'));
    assert.ok(out.endsWith('.com'));
    assert.ok(out.slice(4, -4).split('').every((c) => c === '•'));
  });
  it('redacts long strings preserving head + tail + ellipsis', () => {
    const s = 'abcdefghijklmnopqrstuvwxyz';
    const out = redactJson(s);
    // Implementation: head + "…" + tail = maxLen chars (8/2=4 + 1 + 4 = 9)
    assert.equal(out.length, 9);
    assert.ok(out.startsWith('abcd…'));
    assert.ok(out.endsWith('wxyz'));
  });
  it('returns short strings unchanged', () => {
    assert.equal(redactJson('short'), 'short');
  });
});
