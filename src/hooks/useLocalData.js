const memory = {
  cases: [
    { id: 'case-1', case_number: 'CASE-1001', title: 'Client intake fraud review', status: 'open', priority: 'high', client_name: 'John Doe', client_email: 'john@example.com', issue_type: 'Fraud', created_date: new Date(Date.now() - 86400000 * 2).toISOString() },
    { id: 'case-2', case_number: 'CASE-1002', title: 'Crypto wallet tracing', status: 'in_progress', priority: 'critical', client_name: 'Maria Smith', client_email: 'maria@example.com', issue_type: 'Crypto', created_date: new Date(Date.now() - 86400000 * 5).toISOString() },
    { id: 'case-3', case_number: 'CASE-1003', title: 'Identity exposure cleanup', status: 'pending', priority: 'medium', client_name: 'Client A', client_email: 'client@example.com', issue_type: 'Identity', created_date: new Date(Date.now() - 86400000 * 1).toISOString() },
    { id: 'case-4', case_number: 'CASE-1004', title: 'Deed fraud alert NYS', status: 'open', priority: 'high', client_name: 'Elena Rossi', client_email: 'elena@example.com', issue_type: 'Deed Fraud', created_date: new Date(Date.now() - 86400000 * 3).toISOString() },
    { id: 'case-5', case_number: 'CASE-1005', title: 'Reported scam follow-up', status: 'resolved', priority: 'low', client_name: 'Mark T.', client_email: 'mark@example.com', issue_type: 'Scam', created_date: new Date(Date.now() - 86400000 * 7).toISOString() },
  ],
  reports: [
    { id: 'report-1', title: 'Weekly security posture', status: 'ready', format: 'pdf', audience: 'User', report_type: 'weekly', score_snapshot: 84, summary: 'Security score improved; 2 critical alerts closed.', total_alerts: 18, resolved_alerts: 14, period_start: new Date(Date.now() - 86400000 * 7).toISOString().slice(0,10), period_end: new Date().toISOString().slice(0,10), created_date: new Date(Date.now() - 86400000 * 1).toISOString() },
    { id: 'report-2', title: 'Monthly privacy audit', status: 'draft', format: 'html', audience: 'Admin', report_type: 'monthly', score_snapshot: 78, summary: 'Data broker exposure increased in 2 catalogs.', total_alerts: 34, resolved_alerts: 21, period_start: new Date(Date.now() - 86400000 * 30).toISOString().slice(0,10), period_end: new Date().toISOString().slice(0,10), created_date: new Date(Date.now() - 86400000 * 3).toISOString() },
    { id: 'report-3', title: 'Incident response summary', status: 'ready', format: 'pdf', audience: 'Admin', report_type: 'on_demand', score_snapshot: 66, summary: 'Active incident requires follow-up within 48 hours.', total_alerts: 12, resolved_alerts: 7, period_start: new Date(Date.now() - 86400000 * 14).toISOString().slice(0,10), period_end: new Date().toISOString().slice(0,10), created_date: new Date(Date.now() - 86400000 * 5).toISOString() },
  ],
  users: [
    { id: 'user-1', full_name: 'John Doe', email: 'john@example.com', role: 'admin' },
    { id: 'user-2', full_name: 'Maria Smith', email: 'maria@example.com', role: 'user' },
    { id: 'user-3', full_name: 'Elena Rossi', email: 'elena@example.com', role: 'user' },
    { id: 'user-4', full_name: 'Mark T.', email: 'mark@example.com', role: 'user' },
    { id: 'user-5', full_name: 'Admin User', email: 'admin@safenestt.local', role: 'admin' },
  ]
};

export async function localList(type) {
  await new Promise(r => setTimeout(r, 180));
  const data = memory[type];
  if (!Array.isArray(data)) return [];
  if (type === 'reports') return [...data].sort((a,b) => new Date(b.created_date) - new Date(a.created_date));
  if (type === 'cases') return [...data].sort((a,b) => new Date(b.created_date) - new Date(a.created_date));
  if (type === 'users') return [...data];
  return data;
}

export async function localCreate(type, item) {
  await new Promise(r => setTimeout(r, 180));
  const record = { id: `${type}-${Date.now()}`, created_date: new Date().toISOString(), ...item };
  if (!memory[type]) memory[type] = [];
  memory[type].unshift(record);
  return record;
}

export async function localStats() {
  await new Promise(r => setTimeout(r, 120));
  return {
    totalCases: memory.cases.length,
    openCases: memory.cases.filter(c => c.status === 'open').length,
    reports: memory.reports.length,
    users: memory.users.length,
  };
}
