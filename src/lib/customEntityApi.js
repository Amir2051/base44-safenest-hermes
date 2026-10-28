import { customAuthApi } from '@/lib/customAuthApi';

const API_BASE = (import.meta.env.VITE_CUSTOM_BACKEND_URL || '').replace(/\/$/, '');
const CUSTOM_ENTITIES = new Set(['MyCase', 'InvestigationCase']);

function entityPath(entityType, recordId) {
  const base = `/api/v1/entities/${encodeURIComponent(entityType)}`;
  return recordId === undefined ? base : `${base}/${encodeURIComponent(String(recordId))}`;
}

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    requestHeaders['X-CSRF-Token'] = await customAuthApi.csrf();
  }
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: requestHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.detail || `SafeNestT API request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function optionsFrom(args, defaultLimit = 100) {
  const [sortOrOptions, limitArg, skipArg, fieldsArg] = args;
  if (sortOrOptions && typeof sortOrOptions === 'object') {
    if (sortOrOptions.cursor || sortOrOptions.distinct) {
      throw new Error('Cursor pagination and distinct queries are not supported by the custom case API yet.');
    }
    return {
      sort: sortOrOptions.sort || '-created_date',
      limit: sortOrOptions.limit ?? defaultLimit,
      skip: sortOrOptions.skip ?? 0,
      fields: sortOrOptions.fields,
    };
  }
  return {
    sort: sortOrOptions || '-created_date',
    limit: limitArg ?? defaultLimit,
    skip: skipArg ?? 0,
    fields: fieldsArg,
  };
}

function listQuery(options, filters) {
  const params = new URLSearchParams();
  params.set('sort', options.sort);
  params.set('limit', String(Math.min(5000, Math.max(1, Number(options.limit) || 100))));
  params.set('skip', String(Math.min(100000, Math.max(0, Number(options.skip) || 0))));
  if (filters && Object.keys(filters).length) params.set('filters', JSON.stringify(filters));
  return `?${params.toString()}`;
}

export function createCustomEntityAdapter(entityType) {
  if (!CUSTOM_ENTITIES.has(entityType)) throw new Error(`Unsupported custom entity: ${entityType}`);
  return {
    async list(...args) {
      const options = optionsFrom(args);
      const rows = await request(`${entityPath(entityType)}${listQuery(options)}`);
      return Array.isArray(rows) ? rows : [];
    },
    async filter(filters = {}, ...args) {
      const options = optionsFrom(args);
      const rows = await request(`${entityPath(entityType)}${listQuery(options, filters || {})}`);
      return Array.isArray(rows) ? rows : [];
    },
    async get(id) {
      return request(entityPath(entityType, id));
    },
    async create(data) {
      return request(entityPath(entityType), { method: 'POST', body: { data } });
    },
    async update(id, data) {
      return request(entityPath(entityType, id), { method: 'PATCH', body: { data } });
    },
    async delete(id) {
      return request(entityPath(entityType, id), { method: 'DELETE' });
    },
    subscribe(callback, { pollIntervalMs = 15000 } = {}) {
      let stopped = false;
      let inFlight = false;
      let initialized = false;
      let previous = new Map();
      const poll = async () => {
        if (stopped || inFlight) return;
        inFlight = true;
        try {
          const records = await request(`${entityPath(entityType)}${listQuery({ sort: '-updated_date', limit: 5000, skip: 0 })}`);
          const next = new Map((Array.isArray(records) ? records : []).map(record => [String(record.id), record]));
          if (initialized) {
            for (const [id, record] of next) {
              const old = previous.get(id);
              if (!old) callback({ type: 'create', id, data: record });
              else if (JSON.stringify(old) !== JSON.stringify(record)) callback({ type: 'update', id, data: record });
            }
            for (const [id, record] of previous) {
              if (!next.has(id)) callback({ type: 'delete', id, data: record });
            }
          }
          previous = next;
          initialized = true;
        } catch (error) {
          console.warn(`[SafeNestT custom API] ${entityType} subscription poll failed:`, error?.message || error);
        } finally {
          inFlight = false;
        }
      };
      poll();
      const timer = setInterval(poll, Math.max(5000, pollIntervalMs));
      return () => { stopped = true; clearInterval(timer); };
    },
  };
}

export function isCustomEntity(entityType) {
  return CUSTOM_ENTITIES.has(entityType);
}


export async function invokeCustomCaseManagement(payload) {
  return request('/api/v1/case-management/', { method: 'POST', body: payload });
}

export function isCustomBackendEnabled() {
  return Boolean(import.meta.env.VITE_CUSTOM_BACKEND_URL);
}

export async function startCustomHermesInvestigation({
  caseId,
  entityType = 'MyCase',
  targetType = 'domain',
  targetValue,
  investigationType = 'web',
}) {
  if (!caseId) throw new Error('caseId is required');
  if (!targetValue) throw new Error('targetValue is required');
  const base = entityPath(entityType, caseId);
  const created = await request(`${base}/investigations`, {
    method: 'POST',
    body: { target: { type: targetType, value: targetValue }, investigation_type: investigationType },
  });
  const investigationId = created?.investigation_id || created?.hermes_investigation_id;
  if (!investigationId) throw new Error('Hermes did not return an investigation ID');
  try {
    const started = await request(`${base}/investigations/${encodeURIComponent(String(investigationId))}/start`, { method: 'POST' });
    return { ...created, ...(started || {}), success: true, hermes_investigation_id: investigationId };
  } catch (error) {
    error.investigation_id = investigationId;
    throw error;
  }
}

export async function getCustomHermesStatus(investigationId) {
  if (!investigationId) throw new Error('investigationId is required');
  return request(`/api/v1/user/investigations/${encodeURIComponent(String(investigationId))}`);
}

export async function checkCustomHermesHealth() {
  try {
    return await request('/api/v1/user/hermes/health');
  } catch (error) {
    return { status: 'unavailable', error: error?.message || 'Hermes health check failed' };
  }
}
