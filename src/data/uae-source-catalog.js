/**
 * UAE Data Hub — source catalog.
 *
 * Defines the regulatory/intelligence sources SafeNestT UAE Intelligence can
 * pull from. Each source carries provenance metadata so every imported record
 * can be traced back to its origin, retrieval date, and format.
 *
 * IMPORTANT: This catalog declares the *intended* sources. Retrieval is done
 * server-side through dedicated functions (see base44/functions/uae-intel/).
 * A source marked "registration_required" or "not_reachable" MUST NOT have
 * fabricated data substituted for it.
 *
 * @module uae-source-catalog
 */

/**
 * Dataset-level descriptors (Dubai Pulse).
 * Only the fields we verified from the public portal.
 */
export const DUBAI_PULSE = {
  name: 'Dubai Pulse (Smart Dubai)',
  owner: 'Smart Dubai Office / Dubai Data',
  owner_url: 'https://www.dubaipulse.gov.ae/',
  description:
    'Dubai Pulse is the single source for data on Dubai, gathered from various public-sector sources, available in multiple formats including CSV, KML, and API-compatible files.',
  status: 'public-data-portal',
  format: 'open-data (CSV / KML / API-compatible files / API)',
  website: 'https://www.dubaipulse.gov.ae/',
  data_endpoint: 'https://gslb.dubaipulse.gov.ae/data',
  authentication: 'API tokens issued per dataset (see per-dataset pages); local access does not require a key',
  registration: 'Not required for open datasets. Per-dataset API tokens may be issued through the DevZone / dataset page.',
  source_url: 'https://www.dubaipulse.gov.ae/data',
  retrieval_date: null, // requires network access to the portal (not available in this sandbox)
  update_frequency: null, // documented per dataset; see each dataset page
  legal_access_restrictions:
    'Open data under Dubai Data Law. Accessible via the Data portal, Dubai Registers, and DevZone (free for developers).',
};

/**
 * VARA Public Register (UAE Virtual Assets Regulatory Authority).
 * Verified: HTTP 200, human-readable HTML table, 56 real records.
 */
export const VARA_PUBLIC_REGISTER = {
  name: 'VARA Public Register',
  owner: 'Virtual Assets Regulatory Authority (VARA), UAE',
  owner_url: 'https://www.vara.ae/',
  website: 'https://www.vara.ae/en/licenses-and-register/public-register/',
  description:
    'Public register of Virtual Asset Service Providers (VASPs) that are fully licensed or hold In-Principle Approval (IPA). Lists VASP name, licence type, reference, licensed activities, licence date, status, and CMA registration number.',
  status: 'verified',
  format: 'HTML table (no JSON API, no download link)',
  source_url: 'https://www.vara.ae/en/licenses-and-register/public-register/',
  retrieval_date: null, // requires network access to the VARA page
  update_frequency: 'Regulatory updates; records added/updated as licences are issued or changed',
  legal_access_restrictions:
    'Public. VARA does not publish a JSON API or downloadable file; the register is a human-readable HTML table. Retrieval must be server-side and must preserve source provenance.',
};

/**
 * UAE Data Hub source catalog.
 * The Data Hub catalog manages these sources. Each source must declare:
 *  - name
 *  - owner
 *  - owner_url
 *  - description
 *  - status
 *  - format
 *  - endpoint
 *  - authentication
 *  - registration
 *  - source_url
 *  - retrieval_date
 *  - update_frequency
 *  - legal_access_restrictions
 */
export const UAE_DATA_HUB_SOURCES = [VARA_PUBLIC_REGISTER, DUBAI_PULSE];

/** Standard fields every VASP intelligence record must carry (provenance). */
export const VASPRecordFields = [
  'VASP Name',
  'Reference',
  'Licence Type',
  'Licensed Activities',
  'Licence Issued',
  'Status',
  'CMA Registration Number',
];

/** The set of load-bearing fields a VASP record must have before import. */
export const REQUIRED_VASP_FIELDS = ['VASP Name', 'Reference', 'Licence Type', 'Status'];

/** Status values seen in the VARA register (all are 'Active' so far). */
export const VASP_STATUS_VALUES = ['Active'];
