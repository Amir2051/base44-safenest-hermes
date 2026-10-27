const API_BASE = (import.meta.env.VITE_CUSTOM_BACKEND_URL || '').replace(/\/$/, '');

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}/api/v1/auth${path}`, {
    credentials: 'include',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.detail || `Authentication request failed (${response.status})`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export const customAuthApi = {
  async me() {
    return (await request('/me')).user;
  },
  async csrf() {
    return (await request('/csrf')).csrf_token;
  },
  async login(email, password) {
    return request('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  },
  async register(email, password, display_name) {
    return request('/register', { method: 'POST', body: JSON.stringify({ email, password, display_name }) });
  },
  async updateMe(values) {
    const token = await this.csrf();
    return (await request('/me', { method: 'PATCH', headers: { 'X-CSRF-Token': token }, body: JSON.stringify({ values }) })).user;
  },
  async logout(redirect = false) {
    try {
      const token = await this.csrf();
      await request('/logout', { method: 'POST', headers: { 'X-CSRF-Token': token } });
    } finally {
      if (redirect && typeof window !== 'undefined') window.location.assign('/login');
    }
  },
  async refresh() {
    const token = await this.csrf();
    return request('/refresh', { method: 'POST', headers: { 'X-CSRF-Token': token } });
  },
  redirectToLogin(returnTo) {
    if (typeof window === 'undefined') return;
    const target = returnTo || `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?next=${encodeURIComponent(target)}`);
  },
};
